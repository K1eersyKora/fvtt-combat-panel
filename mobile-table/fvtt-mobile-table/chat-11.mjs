import {displayIcon} from './game-13.mjs';

// Mirror the sidebar after Foundry, the system and other modules have rendered it for this PL.
// A hidden tab still has a log. innerText on a hidden ancestor can expose collapsed content.
const historySize = 60;
function hidden(element) {
  if (element.matches('[hidden],[aria-hidden="true"],.secret:not(.revealed),[data-visibility="gm"],script,style,template,iframe,object')) return true;
  if (element.matches('.dice-roll:not(.expanded) .dice-tooltip,.dice-roll:not(.expanded) .dice-tooltip-collapser,.collapsible.collapsed .collapsible-content')) return true;
  const style = getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0'
    || (style.maxHeight === '0px' && style.overflowY === 'hidden');
}
function displayed(root, row) {
  for (let node = root; node && node !== row; node = node.parentElement) if (hidden(node)) return false;
  return !!root;
}
// Send semantic elements, never the desktop HTML, document UUIDs, links or event handlers.
const richTags = new Set('p div section span br strong b em i u s sup sub blockquote ul ol li h1 h2 h3 h4 h5 h6 table thead tbody tr td th hr pre code'.split(' '));
const cardClasses = new Set(('dice-roll dice-result dice-formula dice-total dice-tooltip dice-tooltip-collapser dice-rolls roll part-header part-formula part-total '
  + 'critical success failure fumble inline-roll content-link chat-card card-header summary name-stacked title subtitle gold-icon card-content card-footer '
  + 'pills pill supplement card-buttons').split(' '));
const desktopControls = '.card-buttons, .chat-controls, button';
function readField(row, selector, image) {
  const root = row.querySelector(selector);
  if (!displayed(root, row) || root.closest(desktopControls)) return {nodes: [], text: ''};
  const pieces = []; let remaining = 4000, elements = 0, truncated = false;
  function text(value) {
    if (value.length > remaining) { value = value.slice(0, remaining); truncated = true; }
    remaining -= value.length; pieces.push(value); return value;
  }
  function read(node, depth) {
    if (!remaining || elements >= 300 || depth > 30) { truncated = true; return null; }
    if (node.nodeType === Node.TEXT_NODE) return text(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE || hidden(node)) return null;
    const tag = node.localName;
    if (tag === 'button' || node.matches(desktopControls)) return null;
    elements++;
    const classes = [...node.classList].filter(c => cardClasses.has(c));
    if (tag === 'img') {
      const alt = node.alt || '〔图片〕', key = image?.(node.currentSrc || node.getAttribute('src'));
      if (!key && !image) return null;
      text(alt); return ['img', classes, alt.slice(0, 160), key || ''];
    }
    if (tag === 'br' || tag === 'hr') { pieces.push('\n'); return [tag, [], []]; }
    if (tag === 'svg' || tag === 'canvas' || tag === 'input') return null;
    if (tag === 'video' || tag === 'audio') return text(tag === 'video' ? '〔视频〕' : '〔音频〕');
    const block = /^(p|div|section|header|li|tr|h[1-6]|blockquote|pre)$/.test(tag);
    if (block) pieces.push('\n');
    const children = [];
    const source = node.matches('details:not([open])') ? [node.querySelector(':scope > summary')] : node.childNodes;
    for (const child of source) {
      if (!child) continue;
      const part = read(child, depth + 1); if (part !== null && part !== '') children.push(part);
      if (truncated) break;
    }
    if (block) pieces.push('\n');
    if (!children.length) return null;
    const safeTag = richTags.has(tag) ? tag : block ? 'div' : 'span';
    return [safeTag, classes, children];
  }
  const nodes = [];
  for (const child of root.childNodes) { const part = read(child, 0); if (part !== null) nodes.push(part); if (truncated) break; }
  // Foundry indents message content in its template. Keep authored line breaks inside the message.
  while (typeof nodes[0] === 'string') {
    const first = nodes[0].trimStart();
    if (first) { nodes[0] = first; break; }
    nodes.shift();
  }
  while (typeof nodes.at(-1) === 'string') {
    const last = nodes.at(-1).trimEnd();
    if (last) { nodes[nodes.length - 1] = last; break; }
    nodes.pop();
  }
  if (truncated) { nodes.push('…'); pieces.push('…'); }
  return {nodes, text: pieces.join('').replace(/[ \t]+/g, ' ').replace(/ *\n\s*/g, '\n').trim()};
}
function readRow(row, message, image) {
  const name = row.querySelector('.message-sender .name-stacked .title') ? '.message-sender .name-stacked .title' : '.message-sender';
  const sender = readField(row, name).text;
  const subtitle = readField(row, '.message-sender .name-stacked .subtitle').text;
  const portrait = row.querySelector('.message-sender .avatar img,.message-header img.avatar,.message-sender img');
  let src = displayed(portrait, row) ? portrait.currentSrc || portrait.getAttribute('src') : '';
  if (!portrait && message.isContentVisible) {
    const actor = message.getAssociatedActor?.();
    if (actor?.name === sender && actor.testUserPermission(game.user, 'LIMITED')) src = actor.img;
    else if (message.author?.name === sender) src = message.author.avatar;
  }
  const data = {
    id: message.id, time: message.timestamp, sender, subtitle,
    stamp: readField(row, '.message-timestamp').text,
    kind: ['blind', 'whisper', 'emote'].find(kind => row.classList.contains(kind)) || '',
    edge: row.style.borderColor ? getComputedStyle(row).borderLeftColor : ''
  };
  if (!message.isContentVisible) {
    const author = message.author;
    const matches = src && author?.avatar && portrait?.getAttribute('src') === author.avatar;
    return {...data, sender: sender === author?.name ? sender : '', subtitle: '', avatar: matches ? image(author.avatar) : '', body: '私密掷骰'};
  }
  data.avatar = image(src);
  const flavor = readField(row, '.flavor-text', image), body = readField(row, '.message-content', image);
  return {
    ...data, to: readField(row, '.whisper-to').text, flavor: flavor.text, body: body.text,
    flavorRich: flavor.nodes, bodyRich: body.nodes
  };
}
export class ChatMirror {
  constructor(publish) {
    this.publish = publish;
    this.previous = null;
    this.cache = new WeakMap();
    this.assets = new Map(); this.serial = 0; this.loading = 0;
    this.observer = new MutationObserver(changes => {
      this.dirty = true;
      for (const {target} of changes) {
        const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
        const row = element?.closest('[data-message-id]');
        if (row) this.cache.delete(row);
      }
    });
  }
  image(src, used) {
    if (!src || used.size >= 10) return '';
    let url; try { url = new URL(src, document.baseURI); } catch { return ''; }
    if (!['http:', 'https:', 'blob:'].includes(url.protocol) && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src)) return '';
    let asset = this.assets.get(url.href);
    if (!asset) { asset = {key: 'i' + (++this.serial), src: url.href, state: 'new'}; this.assets.set(url.href, asset); }
    used.add(asset); return asset.key;
  }
  thumbnails(needed) {
    const images = {};
    for (const [src, asset] of this.assets) if (!needed.has(asset)) { asset.sent = false; this.assets.delete(src); }
    for (const asset of needed) {
      this.assets.set(asset.src, asset);
      if (asset.state === 'ready' && !asset.sent) { images[asset.key] = asset.uri; asset.sent = true; }
      if (asset.state !== 'new' || this.loading >= 3) continue;
      asset.state = 'loading'; this.loading++;
      displayIcon(asset.src, true).then(uri => {
        asset.uri = uri; asset.state = uri ? 'ready' : 'failed';
      }, () => { asset.state = 'failed'; }).finally(() => { this.loading--; this.dirty = true; });
    }
    return images;
  }
  sync() {
    const log = ui.chat?.element?.querySelector('.chat-log');
    if (log !== this.log || this.previous === null) {
      this.observer.disconnect(); this.log = log; this.dirty = true;
      if (log) this.observer.observe(log, {subtree: true, childList: true, characterData: true, attributes: true});
    }
    if (!this.dirty) return;
    this.dirty = false;
    const next = new Map(), needed = new Set();
    for (let row = log?.lastElementChild; row && next.size < historySize; row = row.previousElementSibling) {
      const message = game.messages.get(row.dataset.messageId);
      if (!message?.visible || hidden(row)) continue;
      let cached = this.cache.get(row);
      if (!cached || cached.allowed !== message.isContentVisible) {
        const used = new Set();
        cached = {allowed: message.isContentVisible, data: readRow(row, message, src => this.image(src, used)), used};
        this.cache.set(row, cached);
      }
      for (const asset of cached.used) needed.add(asset);
      next.set(message.id, cached.data);
    }
    const order = [...next.keys()].reverse();
    const rows = order.filter(id => JSON.stringify(next.get(id)) !== JSON.stringify(this.previous?.get(id))).map(id => next.get(id));
    const images = this.thumbnails(needed);
    if (!this.previous || rows.length || Object.keys(images).length || JSON.stringify([...this.previous.keys()]) !== JSON.stringify([...next.keys()])) {
      this.publish({order, rows, images});
    }
    this.previous = next;
  }
  close() { this.observer.disconnect(); this.previous = null; this.assets.clear(); }
}

const ROLL_COMMANDS = new Set(['roll', 'publicroll', 'gmroll', 'blindroll', 'selfroll']);
export async function postChat(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw Error('请输入 1 至 2000 个字符');
  const trimmed = text.trim();
  const [command, matches] = ui.chat.constructor.parse(trimmed);
  if (command === 'macro') throw Error('此输入框用于聊天，请在电脑运行宏');
  if (ROLL_COMMANDS.has(command) && Array.isArray(matches)) {
    const formulas = matches.map(m => String(m?.[2] ?? '').trim()).filter(Boolean);
    if (!formulas.length) throw Error('掷骰公式为空，请补充骰子表达式');
    for (const formula of formulas) {
      if (typeof Roll?.validate === 'function' && !Roll.validate(formula)) {
        throw Error('掷骰公式格式有误：' + formula);
      }
    }
  }
  await ui.chat.processMessage(text);
  return {ok: true};
}
