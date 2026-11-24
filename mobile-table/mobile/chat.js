const clock = new Intl.DateTimeFormat('zh-CN', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const CHAT_THEME_KEY = 'fvtt-mobile-chat-theme';
const EXPANDED_ROLLS_KEY = 'fvtt-mobile-expanded-rolls';
const EXPANDED_ROLLS_LIMIT = 120;
const HEIGHT_PRESETS = [160, 260, 400];
const RESIZE_THRESHOLD = 6;
const BOTTOM_THRESHOLD = 36;
const allowedTags = new Set('p div section span br strong b em i u s sup sub blockquote ul ol li h1 h2 h3 h4 h5 h6 table thead tbody tr td th hr pre code'.split(' '));
const structuredCard = '.fv-chat-card, .fv-midi-chat-card, .fv-midi-results, .fv-dice-roll, .fv-card-header, .fv-evaluation, '
  + '.fv-targets-tray, .fv-midi-qol-hits-display, .fv-midi-qol-single-hit-card, .fv-midi-qol-saves-display, .fv-midi-qol-player-damage-card';
const diceBreakdown = '.fv-dice-tooltip, .fv-dice-tooltip-collapser, .fv-midi-dice-tooltip';
const rollSections = ['attack', 'damage', 'other-damage', 'bonus-damage', 'utility'].map(name => ({
  name, selector: `.fv-midi-qol-${name}-roll, .fv-midi-${name}-roll`
}));

function thumbnail(key, alt, avatar = false) {
  const box = document.createElement('span');
  box.className = avatar ? 'chatAvatar' : 'chatImage';
  const fallback = document.createElement('span');
  fallback.textContent = avatar ? (Array.from(alt.trim())[0] || '·') : alt;
  box.append(fallback);
  if (key) { box.dataset.chatImage = key; box.dataset.imageAlt = alt; }
  return box;
}
function renderPart(part) {
  if (typeof part === 'string') return document.createTextNode(part);
  const [tag, classes, children, key] = part;
  const element = tag === 'img' ? thumbnail(key, children) : document.createElement(allowedTags.has(tag) ? tag : 'span');
  for (const name of classes) if (/^[a-z][a-zA-Z0-9-]*$/.test(name)) element.classList.add('fv-' + name);
  if ((tag === 'td' || tag === 'th') && Number.isInteger(key) && key > 1) element.colSpan = key;
  if (tag !== 'img') for (const child of children) element.append(renderPart(child));
  return element;
}
function messageElement(message) {
  const row = document.createElement('li');
  row.dataset.messageId = message.id;
  row.className = 'chatMessage';
  row.dataset.kind = message.kind || '';
  if (message.edge && /^(#[a-f\d]{3,8}|rgba?\([\d.,% /]+\))$/i.test(message.edge)) row.style.borderColor = message.edge;
  const head = document.createElement('div'); head.className = 'chatHead';
  head.append(thumbnail(message.avatar, message.sender || '', true));
  const names = document.createElement('div'); names.className = 'chatNames';
  const sender = document.createElement('strong'); sender.textContent = message.sender; names.append(sender);
  const subtitle = [...new Set([message.subtitle, message.to].filter(Boolean))].join(' · ');
  if (subtitle) { const sub = document.createElement('small'); sub.textContent = subtitle; names.append(sub); }
  head.append(names);
  if (Number.isFinite(message.time)) {
    const date = new Date(message.time);
    const time = document.createElement('time');
    time.dateTime = date.toISOString();
    time.textContent = clock.format(message.time);
    time.title = date.toLocaleString('zh-CN');
    head.append(time);
  }
  row.append(head);
  for (const key of ['flavor', 'body']) {
    const parts = message[key + 'Rich'];
    if (!message[key] && !parts?.length) continue;
    const block = document.createElement('div');
    block.className = key === 'flavor' ? 'chatRich chatFlavor' : 'chatRich chatBody';
    if (Array.isArray(parts) && parts.length) { for (const part of parts) block.append(renderPart(part)); }
    else block.textContent = message[key];
    if (block.querySelector(structuredCard)) block.classList.add('isRichCard');
    row.append(block);
  }
  return row;
}

function animateMessage(row) {
  row.classList.add('isEntering');
  const finish = event => {
    if (event && event.target !== row) return;
    clearTimeout(timer);
    row.removeEventListener('animationend', finish);
    row.classList.remove('isEntering');
  };
  const timer = setTimeout(finish, 220);
  row.addEventListener('animationend', finish);
}

export function installChat(post, uid, hooks = {}) {
  const log = document.getElementById('chatLog');
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  const button = document.getElementById('sendChat');
  const status = document.getElementById('chatStatus');
  const resizeBtn = document.getElementById('chatResize');
  const resizeBar = document.getElementById('chatResizeBar');
  const jumpBottom = document.getElementById('chatJumpBottom');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  let ready = false, sending = false, attempt = null, seat = 0;
  let preferredHeight = 0;
  let unread = 0, drag = null, jumpHideTimer = null;
  const thumbnails = new Map();
  const expandedRolls = new Set();
  const rollDetails = new WeakMap();
  try {
    const stored = JSON.parse(sessionStorage.getItem(EXPANDED_ROLLS_KEY));
    if (Array.isArray(stored)) {
      for (const key of stored.slice(-EXPANDED_ROLLS_LIMIT)) {
        if (typeof key === 'string') expandedRolls.add(key);
      }
    }
  } catch {}

  function saveExpandedRolls() {
    try {
      if (expandedRolls.size) {
        sessionStorage.setItem(EXPANDED_ROLLS_KEY, JSON.stringify([...expandedRolls].slice(-EXPANDED_ROLLS_LIMIT)));
      } else sessionStorage.removeItem(EXPANDED_ROLLS_KEY);
    } catch {}
  }

  let chatTheme = 'dark';
  try {
    if (localStorage.getItem(CHAT_THEME_KEY) === 'paper') chatTheme = 'paper';
  } catch {}
  log.dataset.chatTheme = chatTheme;

  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight <= BOTTOM_THRESHOLD;

  function setRollExpanded(roll, trigger, expanded) {
    roll.classList.toggle('isExpanded', expanded);
    trigger.setAttribute('aria-expanded', String(expanded));
    for (const element of rollDetails.get(roll)) element.hidden = !expanded;
  }

  function prepareRolls(row) {
    for (const element of row.querySelectorAll('.fv-expanded')) element.classList.remove('fv-expanded');
    const counts = new Map();
    for (const roll of row.querySelectorAll('.fv-dice-roll')) {
      const section = rollSections.find(({selector}) => roll.closest(selector))?.name || 'roll';
      const index = counts.get(section) || 0;
      counts.set(section, index + 1);
      const breakdowns = [...roll.querySelectorAll(diceBreakdown)].filter(element =>
        element.closest('.fv-dice-roll') === roll && (element.childElementCount || element.textContent.trim()));
      if (!breakdowns.length) continue;
      const details = new Set(breakdowns);
      for (const element of breakdowns) {
        if (element.parentElement.matches('.fv-dice-result > .fv-tooltip-part')) details.add(element.parentElement);
      }
      rollDetails.set(roll, details);
      const summary = [...roll.querySelectorAll('.fv-dice-total, .fv-dice-formula')].filter(element =>
        element.closest('.fv-dice-roll') === roll && !roll.contains(element.closest(diceBreakdown)));
      const trigger = summary.find(element => element.classList.contains('fv-dice-total')) || summary[0] || roll;
      const key = `${row.dataset.messageId}:${section}/${index}`;
      roll.dataset.rollKey = key;
      roll.classList.add('isExpandable');
      trigger.classList.add('rollToggle');
      trigger.tabIndex = 0;
      trigger.setAttribute('role', 'button');
      if (trigger === roll) trigger.setAttribute('aria-label', '掷骰明细');
      setRollExpanded(roll, trigger, expandedRolls.has(key));
    }
  }

  function toggleRoll(roll, trigger) {
    const key = roll.dataset.rollKey;
    const expanded = !expandedRolls.has(key);
    if (expanded) expandedRolls.add(key);
    else expandedRolls.delete(key);
    saveExpandedRolls();
    setRollExpanded(roll, trigger, expanded);
    hooks.onHaptic?.('light');
    updateJumpButton();
  }

  log.addEventListener('click', event => {
    const roll = event.target.closest?.('.fv-dice-roll');
    if (!roll?.classList.contains('isExpandable') || roll.contains(event.target.closest(diceBreakdown)) ||
        rollDetails.get(roll).has(event.target.closest('.fv-tooltip-part'))) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.containsNode(roll, true)) return;
    const trigger = roll.classList.contains('rollToggle') ? roll : roll.querySelector('.rollToggle');
    toggleRoll(roll, trigger);
  });
  log.addEventListener('keydown', event => {
    if (!event.target.classList?.contains('rollToggle') || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) toggleRoll(event.target.closest('.fv-dice-roll'), event.target);
  });

  function updateJumpButton() {
    const bottom = atBottom();
    if (bottom) unread = 0;
    if (!jumpBottom) return;
    const label = unread ? `↓ ${unread} 条新消息` : '↓ 回到底部';
    if (jumpBottom.textContent !== label) jumpBottom.textContent = label;
    jumpBottom.inert = bottom;
    if (!bottom) {
      clearTimeout(jumpHideTimer);
      jumpHideTimer = null;
      if (jumpBottom.hidden) {
        jumpBottom.hidden = false;
        if (!reducedMotion?.matches) jumpBottom.getBoundingClientRect();
      }
      jumpBottom.classList.add('isVisible');
    } else {
      jumpBottom.classList.remove('isVisible');
      if (reducedMotion?.matches) {
        clearTimeout(jumpHideTimer);
        jumpHideTimer = null;
        jumpBottom.hidden = true;
      } else if (!jumpBottom.hidden && jumpHideTimer === null) {
        jumpHideTimer = setTimeout(() => {
          jumpHideTimer = null;
          jumpBottom.hidden = true;
        }, 150);
      }
    }
  }

  log.addEventListener('scroll', updateJumpButton, {passive: true});
  jumpBottom?.addEventListener('click', () => {
    unread = 0;
    log.scrollTo({top: log.scrollHeight, behavior: reducedMotion?.matches ? 'auto' : 'smooth'});
    updateJumpButton();
  });

  function loadHeight() {
    let px = 0;
    try {
      if (typeof window.TableDisplay?.getChatHeight === 'function') {
        px = Number(window.TableDisplay.getChatHeight()) || 0;
      } else {
        px = Number(localStorage.getItem('fvtt-mobile-chat-height')) || 0;
      }
    } catch {}
    preferredHeight = Number.isFinite(px) && px >= 100 ? Math.round(px) : 0;
    applyChatHeight();
  }

  function saveHeight(px) {
    preferredHeight = Math.round(px);
    try {
      if (typeof window.TableDisplay?.saveChatHeight === 'function') {
        window.TableDisplay.saveChatHeight(preferredHeight);
      } else {
        localStorage.setItem('fvtt-mobile-chat-height', String(preferredHeight));
      }
    } catch {}
  }

  function clampHeight(px) {
    const vh = window.visualViewport?.height || window.innerHeight || 700;
    const min = Math.min(112, Math.round(vh * 0.35));
    const max = Math.max(min + 60, Math.min(560, Math.round(vh * 0.65)));
    return Math.max(min, Math.min(max, Math.round(px)));
  }

  function applyChatHeight(px = preferredHeight, follow = atBottom()) {
    if (px > 0) log.style.height = clampHeight(px) + 'px';
    else log.style.removeProperty('height');
    if (follow) log.scrollTop = log.scrollHeight;
    updateJumpButton();
  }

  function cycleHeight() {
    hooks.onHaptic?.('light');
    saveHeight(HEIGHT_PRESETS.find(px => px > preferredHeight) ?? HEIGHT_PRESETS[0]);
    applyChatHeight();
  }

  function bindResizer(handle, tapCycles = false) {
    if (!handle) return;
    handle.style.touchAction = 'none';
    const threshold = tapCycles ? RESIZE_THRESHOLD : 1;
    const ownsDrag = e => drag?.handle === handle && drag.id === e.pointerId;
    const move = e => {
      const delta = e.clientY - drag.startY;
      if (!drag.moved && Math.abs(delta) < threshold) return;
      drag.moved = true;
      drag.current = clampHeight(drag.startHeight + delta);
      applyChatHeight(drag.current, drag.follow);
    };
    handle.addEventListener('pointerdown', e => {
      if (drag || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const startHeight = log.getBoundingClientRect().height || 220;
      drag = {handle, id: e.pointerId, startY: e.clientY, startHeight, current: startHeight, follow: atBottom(), moved: false};
      handle.classList.add('active');
    });
    handle.addEventListener('pointermove', e => {
      if (!ownsDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      move(e);
    });
    const finishDrag = (e, cancelled) => {
      if (!ownsDrag(e)) return;
      if (!cancelled) move(e);
      const ended = drag;
      drag = null;
      handle.classList.remove('active');
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      if (cancelled) applyChatHeight(preferredHeight, ended.follow);
      else if (ended.moved) saveHeight(ended.current);
      else if (tapCycles) cycleHeight();
    };
    handle.addEventListener('pointerup', e => finishDrag(e, false));
    handle.addEventListener('pointercancel', e => finishDrag(e, true));
    handle.addEventListener('lostpointercapture', e => finishDrag(e, true));
    if (tapCycles) handle.addEventListener('click', e => {
      if (e.detail === 0) cycleHeight();
    });
    handle.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const cur = log.getBoundingClientRect().height || preferredHeight || 220;
      saveHeight(clampHeight(cur + (e.key === 'ArrowDown' ? 28 : -28)));
      applyChatHeight();
    });
  }

  bindResizer(resizeBtn, true);
  bindResizer(resizeBar);
  loadHeight();
  window.addEventListener('resize', () => applyChatHeight());
  window.visualViewport?.addEventListener('resize', () => applyChatHeight());

  function controls() {
    button.disabled = !ready || sending || !input.value.trim();
  }
  input.addEventListener('input', controls);
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      if (input.tagName === 'INPUT') event.preventDefault();
      return;
    }
    event.preventDefault();
    form.requestSubmit();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim(), currentSeat = seat;
    if (!text || !ready || sending) return;
    if (attempt?.text !== text) attempt = {text, id: uid()};
    sending = true; controls(); status.textContent = '正在发送…';
    try {
      await post(text, attempt.id);
      if (currentSeat !== seat) return;
      if (input.value.trim() === text) input.value = '';
      attempt = null; status.textContent = '';
      hooks.onSent?.(text);
    } catch (error) {
      if (currentSeat !== seat) return;
      if (!error.timeout) attempt = null;
      status.textContent = error.message;
    } finally {
      if (currentSeat === seat) { sending = false; controls(); }
    }
  });

  return {
    connecting() {
      ready = false; unread = 0; thumbnails.clear(); log.replaceChildren();
      status.textContent = '正在同步聊天记录…'; controls(); updateJumpButton();
    },
    unavailable() { status.textContent = '请将电脑端「掌上跑团」模组更新至 0.5.0 并刷新玩家窗口'; },
    receive({order, rows, images = {}}) {
      const follow = !ready || atBottom();
      const animateNew = ready && !reducedMotion?.matches;
      const entries = new Map(Array.from(log.children, node => [node.dataset.messageId, node]));
      const keep = new Set(order);
      const expandedCount = expandedRolls.size;
      for (const key of expandedRolls) if (!keep.has(key.slice(0, key.lastIndexOf(':')))) expandedRolls.delete(key);
      if (expandedRolls.size !== expandedCount) saveExpandedRolls();
      for (const [id, node] of entries) if (!keep.has(id)) node.remove();
      for (const message of rows) {
        const node = messageElement(message);
        prepareRolls(node);
        const previous = entries.get(message.id);
        if (!previous && keep.has(message.id)) {
          if (!follow) unread++;
          if (animateNew) animateMessage(node);
        }
        previous?.replaceWith(node);
        entries.set(message.id, node);
      }
      for (let i = 0; i < order.length; i++) {
        const node = entries.get(order[i]);
        if (node && log.children[i] !== node) log.insertBefore(node, log.children[i] || null);
      }
      for (const [key, uri] of Object.entries(images)) {
        if (typeof uri === 'string' && uri.length <= 48000 && /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(uri)) thumbnails.set(key, uri);
      }
      const used = new Set();
      for (const box of log.querySelectorAll('[data-chat-image]')) {
        const key = box.dataset.chatImage; used.add(key);
        if (!thumbnails.has(key) || box.querySelector('img')) continue;
        const img = new Image(); img.alt = box.dataset.imageAlt; img.src = thumbnails.get(key);
        img.onload = () => { box.classList.add('loaded'); }; box.append(img);
      }
      for (const key of thumbnails.keys()) if (!used.has(key)) thumbnails.delete(key);
      if (!ready) status.textContent = '';
      ready = true; controls();
      if (follow) log.scrollTop = log.scrollHeight;
      updateJumpButton();
    },
    getChatTheme() { return chatTheme; },
    setChatTheme(mode) {
      if (mode !== 'dark' && mode !== 'paper') return;
      chatTheme = mode;
      log.dataset.chatTheme = mode;
      try { localStorage.setItem(CHAT_THEME_KEY, mode); } catch {}
    },
    fillInput(text, sendNow = false) {
      input.value = text;
      input.dispatchEvent(new Event('input', {bubbles: true}));
      if (sendNow) form.requestSubmit();
    },
    refreshHeight() { applyChatHeight(); },
    reset() {
      seat++; ready = false; sending = false; attempt = null; unread = 0;
      thumbnails.clear(); expandedRolls.clear(); input.value = ''; log.replaceChildren();
      saveExpandedRolls();
      status.textContent = ''; controls(); updateJumpButton();
    }
  };
}
