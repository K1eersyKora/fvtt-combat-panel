import {PhoneMap} from './map-render.js';
import {installTheme, syncTheme, themeColors} from './theme.js';
import {RelayChannel, cardRevision} from './relay.js';
import {cacheKeys, clearScope, useSeat, stored, download, packedBlob, lastCardScope, readCharacter, saveCharacter, resourceSyncEnabled, setResourceSync, pruneResources} from './asset-cache.js';
import {installSettings} from './settings.js';
import {installCheckPrompt} from './check-prompt.js';
import {installPromptUI} from './prompt-ui.js';
import {installDockItems, itemCatalog, dockSearchText} from './dock-items.js';
import {createSheetUI} from './sheet-ui.js';
import {installCombatHud} from './combat-hud.js';
import {viewer} from './camera.js';
import {installChat} from './chat.js';
import {installDiceTray} from './dice.js';
import {snapMoveCenter, snapTemplatePose, hitTokenAt} from './snap.js';

const $ = id => document.getElementById(id);
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => motionPreference.matches;
const haptic = kind => { try { window.TableDisplay?.haptic?.(kind); } catch {} };
const revealTimers = new Map(), pulseTimers = new Map();
const views = new Set(['sheet', 'pair', 'lobby', 'home']);

function setReveal(el, open, exitMs, waitForTransitions = false) {
  const timer = revealTimers.get(el);
  el.inert = !open;
  if (reducedMotion() || exitMs <= 0) {
    clearTimeout(timer);
    revealTimers.delete(el);
    el.hidden = !open;
    el.classList.toggle('isOpen', open);
  } else if (open) {
    clearTimeout(timer);
    revealTimers.delete(el);
    if (!el.hidden && el.classList.contains('isOpen')) return;
    if (el.hidden) el.classList.remove('isOpen');
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('isOpen');
  } else {
    el.classList.remove('isOpen');
    if (el.hidden || timer !== undefined) return;
    const hide = () => {
      if (revealTimers.get(el) !== hideTimer) return;
      revealTimers.delete(el);
      el.hidden = true;
    };
    const hideTimer = setTimeout(() => {
      // A delayed frame can leave the dock transition running past the timer.
      const transitions = waitForTransitions ? el.getAnimations?.().filter(animation => animation.transitionProperty) : null;
      if (transitions?.length) Promise.allSettled(transitions.map(animation => animation.finished)).then(hide);
      else hide();
    }, exitMs);
    revealTimers.set(el, hideTimer);
  }
}

function pulseClass(el, name, duration) {
  clearTimeout(pulseTimers.get(el)?.timer);
  pulseTimers.delete(el);
  el.classList.remove(name);
  if (reducedMotion()) return;
  void el.offsetWidth;
  el.classList.add(name);
  const timer = setTimeout(() => { el.classList.remove(name); pulseTimers.delete(el); }, duration);
  pulseTimers.set(el, {name, timer});
}

function animateViewEnter(el) { pulseClass(el, 'viewEnter', 220); }

function show(id, on) {
  const el = $(id);
  if (!el || el.hidden === !on) return;
  el.hidden = !on;
  if (on && views.has(id)) animateViewEnter(el);
}

let toastTimer;
function tell(text, tone) {
  const status = $('status');
  clearTimeout(toastTimer);
  status.textContent = text || '';
  status.dataset.tone = tone || (/失败|不可|不足|已改变|超时|断开|无效|受阻|超出|请先|不能|尚未/.test(text) ? 'error' : 'info');
  if (text && status.dataset.tone === 'error') haptic('error');
  status.classList.toggle('toastVisible', !!text);
  if (text && status.dataset.tone === 'info') {
    toastTimer = setTimeout(() => status.classList.remove('toastVisible'), 4000);
  }
}
$('status').onclick = () => tell('');
const uid = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), x => x.toString(16)).join('-');
const delay = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const roman = level => ['0', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ'][level] ?? String(level);

if (window.TableDisplay) document.documentElement.setAttribute('data-native-fit', '');

const pending = new Map();
let auth, peer, ch, epoch, ice = [], table, card, action, mode = '', origin, points = [], centerDest = null, selected = [], anchors = {}, hover, point, angle = 0;
let route, routeTimer, lastRouteKey = '', lastTemplateKey = '', checkSeq = 0, predictSeq = 0, busy = false, aimScene, aimSource, planId = '';
let gesture, previewTimer, lastPredictAt = 0, lastPredictId = '', commit, actualTemplate, templateSeq = 0, shapeTimer;
let teleportPreviewState, teleportSeq = 0, teleportTimer, teleportKey = '', swapTarget;
let routeInFlight, templateInFlight, cameraGoal;
let cardFrom = '', cardTime = 0, inspectSeq = 0, currentInspection = null;
let modesKey = '', catalogCard, catalogRows = [];
let choiceResource, damageType, versatile = false;
const actionChoices = new Map();
let dockGroup = '全部', dockSignature = '', choiceFrom = '', savingCards = true, downloadRun = 0;
let syncingPack = false, syncedPack = '', attemptedPack = '', nextPackCheck = 0, packWatch = 0;
let dockRows = 1, dockFolded = false, dockCols = 4;
let lastHpActor, lastHpPct;
let dockFoldedBeforeAim = null, mapExpanded = false;
let enterStep = 0, enterTimer, signalAbort, fallbackTimer;
let connState = 'offline', mapUnavailable = false;
const dockPages = {全部: 0, 武器: 0, 装备: 0, 特性: 0, 法术: 0, 物品: 0};
let dockDragActive = false, suppressDockClickUntil = 0;
const fingers = new Map();
let pinch, atlasProbe;
const typeNames = {spell: '法术', weapon: '武器', feat: '特性', equipment: '装备', consumable: '消耗品'};
const map = $('stage'), overlay = $('overlay'), ctx = overlay.getContext('2d');
const targetLocks = new Map(), ripples = [];
let visualAim = null, overlayFxFrame = null;

function setMapNote(text) {
  const el = $('displayNote');
  el.textContent = text || '';
  el.hidden = !text;
}

function mountSettings(targetId) {
  const btn = $('settingsOpen'), host = $(targetId);
  if (btn && host && btn.parentElement !== host) host.append(btn);
}

const diceTray = installDiceTray({
  toggleBtn: $('diceToggle'),
  tray: $('diceTray'),
  input: $('chatInput'),
  onHaptic: haptic,
  onToggle(open) {
    if (open) requestAnimationFrame(() => $('chatEditor')?.scrollIntoView({block: 'nearest', behavior: reducedMotion() ? 'instant' : 'smooth'}));
  }
});

const chat = installChat((text, id) => rpc('postChat', {text}, 18000, id), uid, {
  onHaptic: haptic,
  onSent(sentText) { diceTray.onSent(sentText); }
});

const sheetUI = createSheetUI({
  onHaptic: haptic,
  onQuickRoll(formula, sendNow) {
    home();
    chat.fillInput(formula, sendNow);
    if (!sendNow) {
      $('chatEditor').scrollIntoView({block: 'nearest'});
      $('chatInput').focus({preventScroll: true});
      pulseClass($('chatInput'), 'inputPulse', 560);
    }
  }
});
function renderSheet() {
  sheetUI.render(card, {cardFrom, cardTime, online: !!table && !cardFrom});
}

const combatHud = installCombatHud({
  onMyTurn: () => haptic('confirm'),
  onHaptic: haptic,
  async onEndTurn() {
    const res = await rpc('endTurn', {}, 18000);
    tell(res.message);
  },
  async onSelectToken(tokenId) {
    const res = await rpc('selectToken', {tokenId}, 18000);
    tell('已切换棋子：' + res.name);
  }
});
function updateCombatHud() {
  combatHud.update(table, {aiming: !!mode, busy});
}

const localMap = new PhoneMap($('localMap'), () => {
  mapUnavailable = false;
  setMapNote('');
  if (enterStep && table) setEnterStep(0);
  syncMapLoading();
});

function syncMapLoading() {
  const loading = $('mapLoading'), connected = connState === 'webrtc' || connState === 'relay';
  const loadingMap = !map.hidden && connected && !localMap.frame && !mapUnavailable;
  setReveal(loading, loadingMap, 220);
  $('openMove').disabled = busy || !connected || !table || !localMap.frame;
  // Keep the same progress controls reachable when the stage replaces the lobby.
  const steps = $('enterSteps'), cancel = $('cancelEnter');
  if (enterStep && loadingMap) {
    if (steps.parentElement !== loading) loading.append(steps, cancel);
  } else if (steps.parentElement === loading) {
    $('packProgress').after(steps);
    $('enterWorld').after(cancel);
  }
}

function setEnterStep(step) {
  enterStep = step;
  const steps = $('enterSteps');
  steps.hidden = $('cancelEnter').hidden = !step;
  steps.dataset.step = String(step);
  for (const item of steps.children) {
    const number = Number(item.dataset.step);
    item.classList.toggle('active', number === step);
    item.classList.toggle('done', number < step);
    if (number === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
  $('enterWorld').disabled = !!step;
  $('preload').disabled = !!step || syncingPack;
  $('lobbyCard').disabled = !!step;
  if (!step) {
    clearTimeout(enterTimer);
    $('mapLoadingText').textContent = '正在载入本地地图…';
  }
  syncMapLoading();
}

function setConnState(state) {
  connState = state;
  $('connDot').dataset.state = state;
  $('mapTag').title = {offline: '未连接', connecting: '正在连接桌位', webrtc: '局域网直连 (WebRTC)', relay: '公网中继 (HTTPS)'}[state];
  syncMapLoading();
}

function blockMap(why) {
  viewer.cancelAnimation();
  clearOverlayFx();
  localMap.clear();
  mapUnavailable = true;
  closeInspection(false);
  if (mode) home();
  if (enterStep && table) setEnterStep(0);
  syncMapLoading();
  setMapNote('地图暂不可用 · ' + why);
}

async function api(op, data = {}, token = auth?.token, signal) {
  const headers = {'Content-Type': 'application/json', Accept: 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})};
  if (window.TableDisplay && /\.(?:pinggy\.net|pinggy-free\.link)$/.test(location.hostname)) headers['X-Pinggy-No-Screen'] = '1';
  const res = await fetch('/api/' + op, {method: 'POST', signal, headers, body: JSON.stringify(data)});
  const body = await res.json().catch(() => null);
  if (!res.ok || body === null) throw Object.assign(Error(body?.error || '桌面入口暂不可达，请核对当前地址（HTTP ' + res.status + '）'), {status: res.status});
  return body;
}

if (window.TableDisplay?.changeServer) {
  show('changeServer', true);
  $('changeServer').onclick = () => { closeConnection(); chat.reset(); window.TableDisplay.changeServer(); };
}

function rpc(op, extra = {}, timeout = 18000, requestId = uid()) {
  if (ch?.readyState !== 'open') return Promise.reject(Error('桌位尚未连接'));
  const id = requestId;
  const data = {op, id, scene: aimScene || table?.scene, source: aimSource || table?.source?.id, origin: origin || table?.source, ...extra};
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(Error(op === 'postChat' ? '尚未收到发送回执，可核对聊天记录后重试' : ['cast', 'move'].includes(op) ? '尚未收到结算结果，请先核对电脑画面' : '电脑端未及时响应'), {timeout: true}));
    }, timeout);
    pending.set(id, m => { clearTimeout(timer); m.ok ? resolve(m.data) : reject(Error(m.data)); });
    try { ch.send(JSON.stringify(data)); } catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });
}

// Visual viewport & soft keyboard adaptation
let baselineHeights = new Map();
function syncViewport() {
  const vv = window.visualViewport;
  const w = vv ? vv.width : window.innerWidth;
  const h = vv ? vv.height : window.innerHeight;
  const x = vv ? vv.offsetLeft : 0;
  const y = vv ? vv.offsetTop : 0;
  const root = document.documentElement.style;
  root.setProperty('--vv-x', Math.round(x) + 'px');
  root.setProperty('--vv-y', Math.round(y) + 'px');
  root.setProperty('--vv-w', Math.round(w) + 'px');
  root.setProperty('--vv-h', Math.round(h) + 'px');

  const orientKey = Math.round(w / 10);
  const prevMax = baselineHeights.get(orientKey) || h;
  const focused = document.activeElement;
  const editing = ['chatInput', 'diceBonus', 'filter', 'sheetItemSearch', 'dockItemsSearch', 'code'].includes(focused?.id);
  if (!editing || h > prevMax) baselineHeights.set(orientKey, Math.max(prevMax, h));
  const fullH = baselineHeights.get(orientKey) || h;
  const keyboardOpen = editing && (fullH - h) > Math.max(120, fullH * 0.15);
  document.body.classList.toggle('keyboardOpen', keyboardOpen);
  if (keyboardOpen) {
    const target = focused.id === 'chatInput' || focused.id === 'diceBonus' ? $('chatEditor') : focused;
    requestAnimationFrame(() => target.scrollIntoView({block: 'nearest'}));
  }
  chat.refreshHeight();
}
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);
window.addEventListener('resize', syncViewport);
document.addEventListener('focusin', syncViewport);
document.addEventListener('focusout', () => setTimeout(syncViewport, 80));
syncViewport();

// Token inspection popover (#tokenPeek)
function closeInspection(notifyDesktop = true) {
  inspectSeq++;
  const had = !!currentInspection;
  currentInspection = null;
  setReveal($('tokenPeek'), false, 120);
  if (notifyDesktop && had && ch?.readyState === 'open' && table?.scene) {
    rpc('tokenInspect', {scene: table.scene, target: null, seq: inspectSeq}).catch(() => {});
  }
}

function positionTokenPeek(tokId) {
  const peek = $('tokenPeek');
  if (peek.hidden || !table || map.hidden) return;
  const t = table.targets.find(x => x.id === tokId);
  if (!t) { closeInspection(false); return; }
  const pr = project();
  const center = pr.forward(localMap.rendered.get(t.id) || t);
  const stageW = pr.rect.width, stageH = pr.rect.height;
  if (!stageW || !stageH) return;
  const headingH = ($('mapTag')?.getBoundingClientRect().height || 0) + 12;
  const peekRect = peek.getBoundingClientRect();
  const pw = peekRect.width || 180, ph = peekRect.height || 72;
  const halfH = Math.max(14, (t.h * pr.scale) / 2);
  const halfW = Math.max(14, (t.w * pr.scale) / 2);
  const pad = 8;

  const candidates = [
    {x: center.x - pw / 2, y: center.y - halfH - ph - 8},
    {x: center.x - pw / 2, y: center.y + halfH + 8},
    {x: center.x + halfW + 8, y: center.y - ph / 2},
    {x: center.x - halfW - pw - 8, y: center.y - ph / 2}
  ];
  let chosen = candidates.find(c => c.x >= pad && c.x + pw <= stageW - pad && c.y >= headingH && c.y + ph <= stageH - pad);
  if (!chosen) {
    chosen = {
      x: clamp(center.x - pw / 2, pad, Math.max(pad, stageW - pw - pad)),
      y: clamp(center.y - halfH - ph - 8, headingH, Math.max(headingH, stageH - ph - pad))
    };
  }
  peek.style.left = Math.round(chosen.x) + 'px';
  peek.style.top = Math.round(chosen.y) + 'px';
}

function renderInspection(info) {
  if (!info || mode || $('stage').hidden) {
    setReveal($('tokenPeek'), false, 120);
    return;
  }
  currentInspection = info;
  const peek = $('tokenPeek');
  peek.querySelector('.peekName').textContent = info.name || '场上目标';
  peek.querySelector('.peekHealth').textContent = info.health?.label || '伤情未公开';
  const states = peek.querySelector('.peekStates');
  states.replaceChildren();
  const conds = Array.isArray(info.conditions) ? info.conditions : [];
  if (conds.length) {
    for (const c of conds) {
      const chip = document.createElement('span');
      chip.className = 'peekChip';
      chip.textContent = typeof c === 'string' ? c : c.label;
      states.append(chip);
    }
  } else {
    const none = document.createElement('span');
    none.className = 'peekNone';
    none.textContent = '无异常状态';
    states.append(none);
  }
  setReveal(peek, true, 120);
  positionTokenPeek(info.id);
}

$('tokenPeek').addEventListener('dismiss', () => closeInspection(true));

async function inspectTokenAt(tok) {
  if (!tok || !table) return;
  haptic('light');
  const seq = ++inspectSeq;
  try {
    const res = await rpc('tokenInspect', {scene: table.scene, target: tok.id, seq});
    if (seq !== inspectSeq || mode || $('stage').hidden) return;
    if (res?.inspection) renderInspection(res.inspection);
    else closeInspection(false);
  } catch {
    if (seq === inspectSeq) closeInspection(false);
  }
}

function setMapExpanded(on) {
  const wasExpanded = mapExpanded;
  mapExpanded = !!on;
  document.body.classList.toggle('mapExpanded', mapExpanded);
  const button = $('mapExpandBtn');
  button.setAttribute('aria-pressed', String(mapExpanded));
  button.setAttribute('aria-label', mapExpanded ? '还原地图浏览' : '展开地图浏览');
  button.textContent = mapExpanded ? '⤡' : '⤢';
  if (mapExpanded) $('pageScroll').scrollTop = 0;
  else if (wasExpanded && !$('home').hidden) animateViewEnter($('home'));
  window.TableDisplay?.mapExpanded?.(mapExpanded);
  localMap.draw();
  render();
}

function resetMap() {
  const wasAiming = document.body.classList.contains('aiming');
  viewer.cancelAnimation();
  clearOverlayFx();
  clearTeleport(); mode = ''; planId = ''; checkSeq++; predictSeq++; templateSeq++;
  clearTimeout(shapeTimer); clearTimeout(routeTimer); lastRouteKey = ''; lastTemplateKey = '';
  lastPredictId = ''; aimScene = aimSource = origin = null; centerDest = null; gesture = null;
  clearTimeout(previewTimer); fingers.clear(); pinch = null; route = null; actualTemplate = null;
  document.body.classList.remove('aiming');
  setReveal($('mapControls'), false, 140);
  show('mapInfo', false);
  show('coveredList', false);
  $('coveredList').textContent = '';
  if (dockFoldedBeforeAim !== null) {
    setDockLayout(dockRows, dockFoldedBeforeAim, false);
    dockFoldedBeforeAim = null;
  }
  if (wasAiming) window.TableDisplay?.mapExpanded?.(false);
  show('mapExpandBtn', true);
  updateCombatHud();
  render();
}

function home() {
  resetMap();
  sheetUI.closeQuickRoll();
  show('home', !!table);
  show('stage', !!table);
  show('sheet', false);
  hideChoice();
  if (table) mountSettings('homeSettingsMount');
  syncMapLoading();
  updateDock();
  tell('');
}

const renderDesktopPrompt = installPromptUI(payload => rpc('desktopPrompt', payload, 25000), {onHaptic: haptic});
const renderCheckPrompt = installCheckPrompt(options => rpc('bg3Check', options));
function closeConnection() {
  epoch = '';
  clearTimeout(fallbackTimer);
  signalAbort?.abort();
  const oldChannel = ch, oldPeer = peer;
  ch = peer = signalAbort = null;
  oldChannel?.close();
  oldPeer?.close();
  for (const finish of pending.values()) finish({ok: false, data: '桌位已断开'});
  pending.clear();
}

function disconnectView(keepSeat = false) {
  closeConnection();
  if (mapExpanded) setMapExpanded(false);
  setConnState('offline');
  setEnterStep(0);
  renderCheckPrompt(null); renderDesktopPrompt(null);
  sheetUI.closeQuickRoll();
  if (keepSeat) chat.connecting();
  else chat.reset();
  diceTray.reset();
  closeInspection(false);
  table = null; busy = false; cardFrom = ''; atlasProbe = null; mapUnavailable = false;
  localMap.clear(); viewer.reset(); setMapNote('');
  $('mapTagText').textContent = ''; show('mapTag', false);
  if (!keepSeat) {
    auth = null; card = null; cardTime = 0; downloadRun++; packWatch++;
    syncingPack = false;
    useSeat(null);
  }
  resetMap();
  hideChoice();
  for (const id of ['stage', 'home', 'sheet']) show(id, false);
  show('lobby', keepSeat); show('pair', !keepSeat);
  show('lobbyCard', keepSeat && !!card);
  show('offlineCard', !!lastCardScope());
  mountSettings(keepSeat ? 'lobbySettingsMount' : 'pairSettingsMount');
  syncMapLoading();
  updateDock();
  tell('');
}

function bindChannel(channel, transport) {
  ch = channel;
  atlasProbe = null;
  chat.connecting();
  const fragments = new Map();
  let firstFrame;
  localMap.clear();
  mapUnavailable = false;
  setMapNote('');
  syncMapLoading();
  channel.onopen = () => {
    if (ch === channel && epoch) {
      clearTimeout(fallbackTimer);
      setConnState(transport);
      if (enterStep) setEnterStep(2);
      tell('正在同步玩家状态…');
      rpc('join').then(result => {
        if (ch === channel && !result.chat) chat.unavailable();
      }).catch(e => { if (ch === channel) tell(e.message, 'error'); });
    }
  };
  channel.onmessage = ev => {
    if (ch !== channel || !epoch) return;
    let msg = JSON.parse(ev.data);
    if (msg.event === 'messagePart') {
      const {id, i, total, part} = msg.data;
      if (typeof id !== 'string' || !Number.isInteger(total) || total < 1 || total > 1024 || !Number.isInteger(i) || i < 0 || i >= total || typeof part !== 'string' || part.length > 20000) return;
      if (i === 0) fragments.set(id, []);
      const pieces = fragments.get(id);
      if (!pieces || i !== pieces.length) return;
      pieces.push(part);
      if (pieces.length !== total) return;
      fragments.delete(id);
      msg = JSON.parse(pieces.join(''));
    }
    if (msg.id) { pending.get(msg.id)?.(msg); pending.delete(msg.id); return; }
    if (msg.event === 'chat') {
      if (enterStep) setEnterStep(3);
      if (!table) {
        show('pair', false); show('home', true);
        if (!enterStep) { show('lobby', false); mountSettings('homeSettingsMount'); }
        tell('');
      }
      chat.receive(msg.data);
      return;
    }
    if (msg.event === 'desktopPrompt') { renderDesktopPrompt(msg.data); return; }
    if (msg.event === 'bg3Check') { renderCheckPrompt(msg.data); return; }
    if (msg.event === 'mapUnavailable') { firstFrame = null; blockMap(msg.data); return; }
    if (msg.event === 'mapReset') {
      viewer.cancelAnimation();
      clearOverlayFx();
      firstFrame = null;
      atlasProbe = null;
      localMap.clear();
      mapUnavailable = false;
      localMap.scope = auth.scope + '/' + msg.data.scope;
      localMap.protected = msg.data.protected;
      setMapNote('');
      syncMapLoading();
      const {epoch: mapEpoch, protected: restricted} = msg.data, scope = localMap.scope;
      if (restricted) clearScope(scope);
      else cacheKeys(scope).then(keys => { if (ch === channel) return rpc('cacheKeys', {epoch: mapEpoch, keys}); }).catch(() => {});
      return;
    }
    if (msg.event === 'atlasCacheProbe') {
      atlasProbe = {...msg.data, channel};
      void checkAtlasCache();
      return;
    }
    if (msg.event === 'sheetReady') {
      if (cardRevision(card) !== msg.data.rev) requestSheet();
      else acceptCard(card);
      return;
    }
    if (msg.event === 'sheet') { acceptCard(msg.data); return; }
    if (msg.event === 'sheetPatch') {
      const {actorId, from, rev, patch} = msg.data;
      if (!card || card.actorId !== actorId || cardRevision(card) !== from) {
        requestSheet();
        return;
      }
      const next = {...card};
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'actions' || key === 'inventory') {
          const idKey = key === 'actions' ? 'key' : 'id', m = new Map(next[key].map(r => [r[idKey], r]));
          for (const k of value.remove) m.delete(k);
          for (const r of value.set) m.set(r[idKey], r);
          next[key] = value.order ? value.order.map(k => m.get(k)) : [...m.values()];
        } else next[key] = value;
      }
      if (cardRevision(next) !== rev) { requestSheet(); return; }
      acceptCard(next);
      return;
    }
    if (msg.event === 'terrainKeys') {
      localMap.grants ??= new Map();
      const key = msg.data.atlas, list = localMap.grants.get(key) || [];
      list.push(...msg.data.keys);
      localMap.grants.set(key, list);
      return;
    }
    if (msg.event === 'asset') { try { localMap.part(msg.data); } catch (e) { blockMap(e.message); } return; }
    if (msg.event === 'localMap') {
      if (table) applyFrame(msg.data);
      else firstFrame = msg.data;
      return;
    }
    if (msg.event === 'wait') return tell(msg.data);
    if (msg.event === 'patch' && table) {
      const {changed = [], removed = [], ...fields} = msg.data;
      const rows = new Map(table.targets.map(t => [t.id, t]));
      for (const id of removed) rows.delete(id);
      for (const t of changed) rows.set(t.id, t);
      msg.data = {...table, ...fields, targets: [...rows.values()]};
    } else if (msg.event !== 'state') return;

    const first = !table;
    const prevScene = table?.scene;
    table = msg.data;
    syncTheme(table.theme);
    localMap.state(table);
    if (firstFrame) { applyFrame(firstFrame); firstFrame = null; }
    $('mapTagText').textContent = table.sceneName || '';
    show('mapTag', !!table.sceneName);
    updateCombatHud();
    if (prevScene && prevScene !== table.scene) {
      clearOverlayFx();
      mapUnavailable = false; setMapNote(''); closeInspection(false);
    }
    if (currentInspection) {
      if (table.inspection && table.inspection.id === currentInspection.id) renderInspection(table.inspection);
      else if (!table.targets.some(t => t.id === currentInspection.id) || table.inspection === null) closeInspection(false);
    }
    if (mode && (table.scene !== aimScene || table.source?.id !== aimSource)) {
      home();
      tell('场景或角色已改变，请重新选择');
    }
    if (first || (enterStep && !$('lobby').hidden)) {
      show('pair', false); show('lobby', false); home();
      $('pageScroll').scrollTop = 0;
    }
    if (enterStep) setEnterStep(localMap.frame || mapUnavailable ? 0 : 3);
    syncMapLoading();
    render();
  };
  function applyFrame(frame) {
    if (frame.scene !== table.scene) return;
    const generation = localMap.generation;
    localMap.apply(frame).catch(e => {
      if (ch !== channel || generation !== localMap.generation || localMap.latest !== frame.id) return;
      if (e.missing) rpc('cacheMiss', {epoch: frame.epoch, keys: e.missing}).catch(() => {});
      else blockMap(e.message);
    });
  }
  function requestSheet() {
    rpc('sheet').then(snapshot => {
      if (ch === channel) return acceptCard(snapshot);
    }).catch(e => { if (ch === channel) tell(e.message, 'error'); });
  }
}

function startTransport() {
  closeConnection();
  signalAbort = new AbortController();
  epoch = uid();
  setConnState('connecting');
  if (enterStep) {
    setEnterStep(1);
    if ($('lobby').hidden) {
      sheetUI.closeQuickRoll();
      show('stage', false); show('home', false); show('sheet', false); show('lobby', true);
      mountSettings('lobbySettingsMount');
    }
  }
  return epoch;
}

function connectionFailed(error) {
  const retry = !!enterStep && ![401, 403].includes(error.status);
  if (!retry) sessionStorage.removeItem('seat');
  disconnectView(retry);
  tell(error.message || '桌位连接失败，请重试', 'error');
}

async function compatible(saved, previous) {
  if (epoch !== previous) return;
  chat.connecting();
  const id = startTransport();
  tell('正在同步世界数据…');
  const transport = (op, data, signal) => api(op, data, saved.token, signal);
  try {
    await transport('signal', {type: 'relayOpen', epoch: id, protocol: 2, cardRevision: cardRevision(card), atlasCache:true}, signalAbort.signal);
    if (epoch !== id) return;
    const link = new RelayChannel(transport, id); bindChannel(link, 'relay');
    link.onclose = () => {
      if (epoch !== id) return;
      connectionFailed(Error(enterStep ? '桌位连接已断开，可重试进入' : '桌位连接已结束，可用原码重新进入'));
    };
    link.start();
  } catch (e) {
    if (epoch === id) connectionFailed(e);
  }
}

async function connect(saved) {
  auth = saved;
  const myEpoch = startTransport(), signal = signalAbort.signal;
  if (new URLSearchParams(location.search).get('connection') === 'https' || (location.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname))) {
    void compatible(saved, myEpoch); return;
  }
  let pc;
  try { pc = new RTCPeerConnection({iceServers: saved.iceServers}); } catch { void compatible(saved, myEpoch); return; }
  peer = pc;
  const queue = [];
  const channel = pc.createDataChannel('table'); bindChannel(channel, 'webrtc'); tell('正在连接玩家桌位…');
  const fallback = () => { if (epoch === myEpoch) void compatible(saved, myEpoch); };
  channel.onclose = fallback;
  fallbackTimer = setTimeout(() => { if (channel.readyState !== 'open') fallback(); }, 6500);
  pc.onicecandidate = e => { if (epoch === myEpoch && e.candidate) api('signal', {type: 'candidate', epoch: myEpoch, candidate: e.candidate.toJSON()}, saved.token, signal).catch(() => {}); };
  pc.onconnectionstatechange = () => { if (peer === pc && ['failed', 'disconnected'].includes(pc.connectionState)) fallback(); };
  const poll = async () => {
    while (epoch === myEpoch) {
      try {
        const messages = await api('poll', {}, saved.token, signal);
        for (const m of messages) {
          if (epoch !== myEpoch || m.epoch !== myEpoch) continue;
          if (m.type === 'answer') { await pc.setRemoteDescription(m.sdp); for (const c of queue.splice(0)) await pc.addIceCandidate(c).catch(() => {}); }
          else if (m.type === 'candidate') { if (pc.remoteDescription) await pc.addIceCandidate(m.candidate).catch(() => {}); else queue.push(m.candidate); }
        }
        if (['failed', 'disconnected'].includes(pc.connectionState) && epoch === myEpoch) { fallback(); return; }
      } catch (e) {
        if (epoch !== myEpoch) return;
        if (e.status === 401) { connectionFailed(e); return; }
        await delay(1100);
      }
    }
  };
  poll();
  try {
    await pc.setLocalDescription(await pc.createOffer());
    if (epoch === myEpoch) await api('signal', {type: 'offer', epoch: myEpoch, protocol: 2, sdp: pc.localDescription.toJSON(), cardRevision: cardRevision(card), atlasCache:true}, saved.token, signal);
  } catch { fallback(); }
}

const codeInput = $('code');
function normalizeCode() {
  const value = codeInput.value.normalize('NFKC').replace(/[\s-]/g, '').toUpperCase().slice(0, 10);
  if (codeInput.value !== value) codeInput.value = value;
  return value;
}
codeInput.addEventListener('input', normalizeCode);
$('pasteCode').onclick = async () => {
  try {
    const text = await navigator.clipboard?.readText?.();
    if (typeof text !== 'string') throw Error();
    codeInput.value = text;
    normalizeCode();
  } catch {
    tell('无法读取剪贴板，请长按输入框粘贴', 'error');
  }
  codeInput.focus();
};
$('pairForm').onsubmit = async e => {
  e.preventDefault();
  const button = $('pairSubmit');
  if (button.disabled) return;
  button.disabled = true; tell('正在配对…');
  try {
    const saved = await api('pair', {code: normalizeCode()}, '');
    if (!saved.localOnly) throw Error('请让 DM 更新到 0.5.0');
    sessionStorage.setItem('seat', JSON.stringify(saved));
    chat.reset();
    lobby(saved);
  } catch (e) { tell(e.message, 'error'); } finally { button.disabled = false; }
};
$('pairSubmit').textContent = '连接桌位'; $('pairSubmit').disabled = false;

function lobby(saved) {
  auth = saved; card = null; cardTime = 0; cardFrom = ''; useSeat(saved);
  syncedPack = ''; attemptedPack = ''; nextPackCheck = 0; packWatch++;
  setEnterStep(0);
  show('pair', false); show('lobby', true);
  mountSettings('lobbySettingsMount');
  $('enterWorld').disabled = false; $('preload').disabled = false; show('lobbyCard', false);
  readCharacter(saved.scope).then(row => {
    if (auth === saved && row && !table) { card = row.data; cardTime = row.time; show('lobbyCard', true); updateDock(); }
  });
  $('lobbyWorld').textContent = saved.worldTitle || '世界准备';
  $('lobbyPlayer').textContent = saved.player || '玩家桌位';
  updateDock();
  tell('');
}

const sizeText = n => n < 1048576 ? Math.ceil(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
async function checkAtlasCache() {
  const probe = atlasProbe;
  if (!probe?.asset?.key || probe.channel !== ch) return;
  try {
    const available = await stored(probe.asset);
    if (atlasProbe !== probe || probe.channel !== ch || available === probe.reported) return;
    probe.reported = available;
    await rpc('atlasCache', {epoch:probe.epoch, key:probe.asset.key, available});
  } catch {
    probe.reported = undefined;
  }
}
$('preload').onclick = () => {
  if (!auth || syncingPack) return;
  setResourceSync(auth.scope, true);
  void syncResources({manual: true});
};
$('settingsOpen').addEventListener('click', () => { $('packFullCheck').hidden = !auth || !!enterStep || $('lobby').hidden; });
$('packFullCheck').onclick = () => {
  if (!auth || syncingPack || enterStep || $('lobby').hidden) return;
  $('settings').close();
  setResourceSync(auth.scope, true);
  void syncResources({manual: true, refresh: true});
};
async function syncResources({manual = false, refresh = false, initial} = {}) {
  if (!auth || syncingPack) return;
  const who = auth, run = ++downloadRun, button = $('preload'), status = $('packStatus'), bar = $('packProgress'); savingCards = true;
  syncingPack = true;
  button.disabled = true;
  if (manual) $('enterWorld').disabled = true;
  bar.hidden = false; bar.removeAttribute('value');
  status.textContent = refresh ? '正在完整核对源文件…' : '正在读取资源清单…';
  const sameSeat = () => who === auth && run === downloadRun;
  try {
    let job = initial || await api('pack/request', refresh ? {refresh: true} : {});
    const deadline = Date.now() + 30 * 60 * 1000;
    while (job.state !== 'ready' || !job.files) {
      if (!sameSeat()) return;
      if (job.state === 'failed') throw Error(job.errors?.[0]?.error || '生成世界包失败');
      if (job.state === 'building' && job.total) status.textContent = '电脑正在整理资源 ' + job.done + ' / ' + job.total;
      if (Date.now() > deadline) throw Error('电脑整理资源超时，可以重试');
      if (job.state !== 'ready') await delay(450);
      job = await api('pack/status', {manifest: true}, who.token);
    }
    if (!sameSeat()) return;
    if (!refresh && job.version && job.version === syncedPack && !job.errors?.length) {
      bar.hidden = true;
      status.textContent = '资源已是最新 · 已保存 ' + job.count + ' 个文件'
        + (job.missing?.length ? ' · 源站找不到 ' + job.missing.length + ' 项' : '');
      button.textContent = '检查资源更新';
      nextPackCheck = Date.now() + 4000;
      return;
    }
    attemptedPack = job.version || '';
    if (job.card) job.files.sort((a, b) => Number(b.key === job.card) - Number(a.key === job.card));
    let cursor = 0, done = 0, bytes = 0, reused = 0; const running = new Map(), failed = [];
    const draw = () => {
      if (!sameSeat()) return;
      const received = bytes + [...running.values()].reduce((a, b) => a + b, 0);
      bar.max = job.bytes || 1; bar.value = job.bytes ? received : 1;
      status.textContent = '世界资源 ' + done + ' / ' + job.count + ' · ' + sizeText(received) + ' / ' + sizeText(job.bytes);
    };
    draw();
    await Promise.all([0, 1].map(async () => {
      while (cursor < job.files.length && sameSeat()) {
        const f = job.files[cursor++];
        try {
          if (await stored(f)) reused++;
          else await download(f, n => { running.set(f.key, n); draw(); });
          if (f.key === job.card) {
            const snapshot = JSON.parse(await (await packedBlob(f)).text());
            if (!sameSeat()) return;
            if (!table) await acceptCard(snapshot);
            show('lobbyCard', true);
          }
          bytes += f.bytes; done++;
        } catch (e) { failed.push(f.label + '：' + e.message); } finally { running.delete(f.key); draw(); }
      }
    }));
    if (!sameSeat()) return;
    const errors = [...(job.errors || []).map(e => e.name + '：' + e.error), ...failed];
    const missing = job.missing || [];
    let removed = 0;
    if (!errors.length && job.version) {
      const latest = await api('pack/status', {}, who.token);
      if (!sameSeat() || !resourceSyncEnabled(who.scope)) return;
      if (latest.state === 'ready' && latest.version === job.version && latest.revision === job.revision) {
        const result = await pruneResources(who.scope, job.files.map(file => file.key));
        if (!sameSeat()) return;
        removed = result?.removed || 0; syncedPack = job.version;
      }
    }
    const summarize = entries => entries.slice(0, 5).join('、') + (entries.length > 5 ? ' 等' : '');
    status.textContent = (errors.length ? '已保存 ' : '下载完成 · ') + done + ' 个文件（' + sizeText(bytes) + '），复用 ' + reused + ' 个'
      + (removed ? '，移除 ' + removed + ' 个旧文件' : '')
      + (missing.length ? '。源站找不到 ' + missing.length + ' 项：' + summarize(missing.map(e => e.name + '：' + e.error)) : '')
      + (errors.length ? '。' + errors.length + ' 项未完成：' + summarize(errors) : '');
    button.textContent = errors.length ? '重试下载' : '检查资源更新'; dockSignature = ''; updateDock();
    void checkAtlasCache();
    nextPackCheck = Date.now() + (errors.length ? 15000 : 4000);
  } catch (e) {
    if (sameSeat()) { status.textContent = e.message; button.textContent = '重试下载'; nextPackCheck = Date.now() + 15000; }
  } finally {
    if (sameSeat()) { syncingPack = false; button.disabled = !!enterStep; if (manual) $('enterWorld').disabled = !!enterStep; }
  }
}
let checkingPack = false;
setInterval(async () => {
  const who = auth, watch = packWatch;
  if (checkingPack || syncingPack || document.hidden || !who || Date.now() < nextPackCheck || !resourceSyncEnabled(who.scope)) return;
  checkingPack = true;
  try {
    let status = await api('pack/status', {}, who.token);
    if (auth !== who || watch !== packWatch || syncingPack || status.state !== 'ready' || !status.version || status.version === syncedPack) return;
    if (status.version === attemptedPack && status.errors?.length) status = await api('pack/request', {}, who.token);
    if (auth === who && watch === packWatch && !syncingPack) void syncResources({initial: status});
  } catch {
    nextPackCheck = Date.now() + 15000;
  } finally { checkingPack = false; }
}, 4000);
$('enterWorld').onclick = () => {
  if (!auth || enterStep) return;
  savingCards = true;
  setEnterStep(1);
  tell('正在进入世界…');
  enterTimer = setTimeout(() => {
    const hint = '仍在等待' + $('enterSteps').querySelector('[aria-current="step"]').textContent + '，可继续等待或取消进入';
    if (!$('mapLoading').classList.contains('isOpen')) tell(hint);
    else $('mapLoadingText').textContent = hint;
  }, 17000);
  const attempt = connect(auth), attemptEpoch = epoch;
  attempt.catch(e => { if (epoch === attemptEpoch) connectionFailed(e); });
};
$('cancelEnter').onclick = () => {
  if (!enterStep) return;
  disconnectView(true);
  $('enterWorld').focus({preventScroll: true});
};
$('changeSeat').onclick = $('disconnect').onclick = async () => {
  const old = auth; sessionStorage.removeItem('seat'); disconnectView();
  if (old?.token) await api('leave', {}, old.token).catch(() => {});
};

async function acceptCard(data) {
  card = data; cardTime = Date.now();
  updateDock();
  renderSheet();
  if (modesKey) {
    const row = dockCatalog().find(row => row.key === modesKey);
    if (row?.activities.length > 1 && dockItems.isVisible(modesKey)) showModes(row); else hideChoice();
  } else if ($('choice').classList.contains('isOpen') && !busy && action) {
    const row = dockCatalog().find(row => row.key === action.key.split('/')[0]);
    const fresh = row?.activities.find(a => a.key === action.key) || (row && !row.activities.length && action.mode === 'passive' ? passiveAction(row) : null);
    if (fresh && (choiceFrom !== 'dock' || dockItems.isVisible(row.key))) {
      const scroll = $('choice').querySelector('.choiceBody').scrollTop;
      choose(fresh, choiceFrom, row); $('choice').querySelector('.choiceBody').scrollTop = scroll;
    } else hideChoice();
  }
  if (auth?.scope && savingCards) {
    const seat = auth;
    await saveCharacter(seat.scope, {data, time: cardTime}).catch(e => { if (auth === seat && card === data) tell(e.message, 'error'); });
  }
}

async function offlineSheet(from) {
  if (enterStep) return;
  const seat = auth, scope = seat?.scope || lastCardScope(), saved = await readCharacter(scope);
  if (auth !== seat || enterStep || table || $(from).hidden) return;
  if (!saved) return tell('本机还没有这个角色的快照', 'error');
  if (!auth) useSeat({scope});
  cardFrom = from; card = saved.data; cardTime = saved.time;
  show(from, false); show('sheet', true); renderSheet(); updateDock(); tell('');
}
$('offlineCard').onclick = () => offlineSheet('pair');
$('lobbyCard').onclick = () => offlineSheet('lobby');
show('offlineCard', !!lastCardScope());

// Lazy icon loader with synchronous resolved cache (prevents fallback letter flicker across swipes & row resizes)
const icons = new Map(), resolvedIcons = new Map(), iconQueue = []; let loadingIcons = 0;
function iconAssetFor(key) {
  if (!card) return null;
  if (key === '@actor') return card.portraitAsset || null;
  return card.actions.find(a => a.key === key)?.iconAsset ?? card.inventory?.find(i => i.id === key.split('/')[0])?.iconAsset ?? null;
}
function iconCacheKey(key) {
  if (!card) return '';
  const art = iconAssetFor(key);
  return art?.key || (card.actorId + '|' + key.split('/')[0]);
}
function mountCachedIcon(holder, key) {
  const ck = iconCacheKey(key);
  const uri = ck && resolvedIcons.get(ck);
  if (typeof uri === 'string' && (uri.startsWith('blob:') || uri.startsWith('data:image/webp;base64,'))) {
    if (holder.firstElementChild?.getAttribute('src') === uri) return true;
    const img = new Image(); img.alt = ''; img.src = uri; holder.replaceChildren(img);
    return true;
  }
  return false;
}
async function nextIcons() {
  while (loadingIcons < 6 && iconQueue.length) {
    const holder = iconQueue.shift(); if (!holder.isConnected) continue;
    if (!card) continue;
    const key = holder.dataset.iconKey;
    if (mountCachedIcon(holder, key)) continue;
    loadingIcons++;
    const cache = card.actorId + '|' + key.split('/')[0], localOnly = !!cardFrom || !table;
    const art = iconAssetFor(key);
    const ck = art?.key || cache;
    let job = icons.get(ck);
    if (!job) {
      job = (art ? (localOnly ? stored(art).then(has => has ? packedBlob(art) : null) : packedBlob(art)).then(b => b ? URL.createObjectURL(b) : null) : localOnly ? Promise.resolve(null) : rpc(key === '@actor' ? 'portrait' : 'icon', {key})).catch(() => null);
      icons.set(ck, job);
      job.then(uri => {
        if (typeof uri === 'string' && (uri.startsWith('blob:') || uri.startsWith('data:image/webp;base64,'))) {
          resolvedIcons.set(ck, uri);
        } else if (icons.get(ck) === job) {
          icons.delete(ck);
        }
      });
      if (icons.size > 220) {
        const oldest = icons.keys().next().value;
        icons.get(oldest).then(u => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u); });
        icons.delete(oldest);
        resolvedIcons.delete(oldest);
      }
    }
    job.then(uri => {
      if (holder.isConnected && holder.dataset.iconKey === key && iconCacheKey(key) === ck
        && typeof uri === 'string' && (uri.startsWith('blob:') || uri.startsWith('data:image/webp;base64,'))) {
        resolvedIcons.set(ck, uri);
        const img = new Image(); img.alt = ''; img.src = uri; holder.replaceChildren(img);
      }
    }).finally(() => { loadingIcons--; nextIcons(); });
  }
}
const iconObserver = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { iconObserver.unobserve(e.target); iconQueue.push(e.target); }
  nextIcons();
}, {rootMargin: '80px'});

function mountIcon(thumb, row) {
  thumb.dataset.iconKey = row.key;
  if (!mountCachedIcon(thumb, row.key)) {
    thumb.textContent = Array.from(row.name || '')[0] || '';
    iconObserver.observe(thumb);
  }
}

// Dock layout: top-edge drag handle (1/2/3 rows + fold) & persistence
const configurableDockGroups = ['武器', '装备', '特性', '法术'];
const dockGroups = ['全部', ...configurableDockGroups, '物品'];
let dockMask = 15;
try {
  const saved = window.TableDisplay?.getDockGroups?.() ?? localStorage.getItem('fvtt-mobile-dock-groups');
  if (saved !== null && Number.isInteger(Number(saved)) && Number(saved) >= 0 && Number(saved) <= 15) dockMask = Number(saved);
} catch {}
const dockGroupVisible = group => {
  const index = configurableDockGroups.indexOf(group);
  return index < 0 || (dockMask & (1 << index)) !== 0;
};
function setMask(mask) {
  dockMask = mask;
  try {
    if (window.TableDisplay?.saveDockGroups) window.TableDisplay.saveDockGroups(mask);
    else localStorage.setItem('fvtt-mobile-dock-groups', String(mask));
  } catch {}
}
const dockItems = installDockItems({
  onHaptic: haptic,
  profile: () => card && {scope: auth?.scope || (cardFrom ? lastCardScope() : ''), actorId: card.actorId},
  catalog: dockCatalog, groups: dockGroups, configurableGroups: configurableDockGroups,
  getMask: () => dockMask, setMask, groupOf, titleOf: abilityTitle, mountIcon,
  change: () => {
    if (!dockGroupVisible(dockGroup)) dockGroup = '全部';
    if (modesKey && !dockRowsForGroup(dockGroup).some(row => row.key === modesKey)) hideChoice();
    if (!modesKey && action && (!dockGroupVisible(groupOf(action)) || (choiceFrom === 'dock' && !dockItems.isVisible(action.key)))) hideChoice();
    dockSignature = '';
    updateDock();
  }
});
function setDockLayout(rows, folded, save = false) {
  const count = [1, 2, 3].includes(Number(rows)) ? Number(rows) : 1;
  dockRows = count;
  dockFolded = !!folded;
  $('charDock').style.setProperty('--slot-rows', String(count));
  $('charDock').dataset.rows = String(count);
  $('charDock').dataset.folded = String(dockFolded);
  const dockDragging = $('charDock').classList.contains('dragging');
  setReveal($('dockContents'), !dockFolded, dockDragging || $('charDock').hidden ? 0 : 200, true);
  const handle = $('dockHandle');
  handle.setAttribute('aria-expanded', String(!dockFolded));
  handle.setAttribute('aria-label', dockFolded ? '能力栏已收起，上拖或点击展开' : `能力栏 ${count} 行，上下拖动调节行数或收起`);
  $('dockHandleLabel').textContent = dockFolded ? '能力栏 · 上拖展开' : `能力栏 · ${count} 行`;
  if (save) {
    try {
      if (window.TableDisplay?.saveDockLayout) window.TableDisplay.saveDockLayout(count, dockFolded);
      else localStorage.setItem('fvtt-mobile-dock', JSON.stringify({rows: count, folded: dockFolded}));
    } catch {}
  }
  if (!dockFolded && card) {
    dockSignature = '';
    updateDock();
  }
  render();
  localMap.draw();
}

let savedDock;
try { savedDock = JSON.parse(window.TableDisplay?.getDockLayout?.() || localStorage.getItem('fvtt-mobile-dock') || '{}'); } catch {}
setDockLayout(savedDock?.rows, savedDock?.folded === true);

// Top-edge drag handle pointer interaction (isolated from icon area and map)
(function installDockHandle() {
  const handle = $('dockHandle');
  let drag = null;
  let suppressHandleClick = 0;

  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const startState = dockFolded ? 0 : dockRows;
    drag = {
      id: e.pointerId, startY: e.clientY,
      startRows: dockRows, startFolded: dockFolded, startState,
      currentRows: dockRows, currentFolded: dockFolded,
      moved: false
    };
    $('charDock').classList.add('dragging');
  });

  handle.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const dy = drag.startY - e.clientY; // positive = drag upward
    if (Math.abs(dy) >= 6) drag.moved = true;
    if (!drag.moved) return;
    let level;
    if (drag.startState === 0) {
      if (dy < 12) level = 0;
      else if (dy < 60) level = 1;
      else if (dy < 108) level = 2;
      else level = 3;
    } else {
      level = clamp(drag.startState + Math.round(dy / 48), 0, 3);
    }
    const nextFolded = level === 0;
    const nextRows = nextFolded ? drag.startRows : level;
    if (nextFolded !== drag.currentFolded || nextRows !== drag.currentRows) {
      drag.currentFolded = nextFolded;
      drag.currentRows = nextRows;
      setDockLayout(nextRows, nextFolded, false);
    }
  });

  function finish(e, cancelled) {
    if (!drag || drag.id !== e.pointerId) return;
    const ended = drag;
    drag = null;
    $('charDock').classList.remove('dragging');
    if (handle.hasPointerCapture?.(e.pointerId)) {
      try { handle.releasePointerCapture(e.pointerId); } catch {}
    }
    if (cancelled) {
      setDockLayout(ended.startRows, ended.startFolded, false);
      return;
    }
    suppressHandleClick = performance.now() + 350;
    if (!ended.moved) {
      // Short tap toggles folded <-> last expanded rows
      setDockLayout(dockRows, !dockFolded, true);
    } else {
      setDockLayout(ended.currentRows, ended.currentFolded, true);
    }
  }

  handle.addEventListener('pointerup', e => finish(e, false));
  handle.addEventListener('pointercancel', e => finish(e, true));
  handle.addEventListener('lostpointercapture', e => finish(e, true));
  handle.addEventListener('click', e => {
    if (performance.now() < suppressHandleClick) { e.preventDefault(); return; }
    setDockLayout(dockRows, !dockFolded, true);
  });
  handle.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const cur = dockFolded ? 0 : dockRows;
    const next = clamp(cur + (e.key === 'ArrowUp' ? 1 : -1), 0, 3);
    setDockLayout(next === 0 ? dockRows : next, next === 0, true);
  });
})();

function groupOf(a) { return ({weapon: '武器', equipment: '装备', feat: '特性', spell: '法术'})[a.group] || '物品'; }
let indexedActions;
const multiActivityItems = new Set();
function abilityTitle(a) {
  if (!a.activity || a.activity === a.name) return a.name;
  if (['weapon', 'equipment', 'tool', 'consumable', 'loot'].includes(a.group)) return a.activity;
  if (indexedActions !== card?.actions) {
    indexedActions = card?.actions;
    multiActivityItems.clear();
    const first = new Map();
    for (const row of indexedActions || []) {
      const item = row.key.split('/')[0], name = row.activity || row.name;
      if (!first.has(item)) first.set(item, name);
      else if (first.get(item) !== name) multiActivityItems.add(item);
    }
  }
  return multiActivityItems.has(a.key.split('/')[0]) ? a.activity : a.name;
}
function hideChoice() {
  modesKey = ''; setReveal($('itemModes'), false, 140);
  setReveal($('choice'), false, 140);
  for (const b of $('dockSlots').querySelectorAll('[aria-pressed="true"]')) b.setAttribute('aria-pressed', 'false');
}

function dockCatalog() {
  if (card !== catalogCard) { catalogCard = card; catalogRows = itemCatalog(card); }
  return catalogRows;
}

function dockRowsForGroup(group) {
  const query = $('filter').value.trim().toLowerCase();
  return dockItems.rows().filter(a => {
    const category = groupOf(a);
    return dockGroupVisible(category) && (group === '全部' || category === group) && dockSearchText(a).includes(query);
  });
}

function computeDockMetrics() {
  const gap = 5;
  const w = $('dockSlots').clientWidth || 240;
  const cols = Math.max(1, Math.floor((w - 2 + gap) / (58 + gap)));
  const size = Math.max(44, Math.floor((w - 2 - (cols - 1) * gap) / cols));
  return {cols, size};
}
function computeDockCols() { return computeDockMetrics().cols; }
if (typeof ResizeObserver === 'function') {
  let lastSlotW = 0;
  new ResizeObserver(() => {
    const w = $('dockSlots')?.clientWidth || 0;
    if (w && w !== lastSlotW) { lastSlotW = w; updateDock(); }
  }).observe($('dockSlots'));
}

function buildSlotButton(a) {
  const b = document.createElement('button');
  const h = document.createElement('span');
  const title = document.createElement('span');
  b.type = 'button';
  b.className = 'dockSlot';
  b.dataset.key = a.key;
  const fullName = a.name;
  b.setAttribute('aria-label', a.activities.length > 1 ? fullName + ' · ' + a.activities.length + ' 种使用方式' : fullName);
  b.classList.toggle('depleted', !!a.activities.length && a.activities.every(activityDepleted));
  b.setAttribute('aria-pressed', String(modesKey === a.key || ($('choice').classList.contains('isOpen') && action?.key.split('/')[0] === a.key)));
  h.className = 'abilityIcon';
  mountIcon(h, a);
  title.className = 'dockLabel';
  const name = abilityTitle(a);
  title.textContent = name === a.name ? fullName : name;
  b.append(h, title);
  if (a.activities.length > 1) {
    const modes = document.createElement('small'); modes.className = 'modeBadge'; modes.setAttribute('aria-hidden', 'true'); modes.textContent = a.activities.length + '▾'; b.append(modes);
  }
  let badge = '';
  if (a.group === 'spell' && (a.isCantrip || a.level > 0)) badge = a.isCantrip ? '戏' : roman(a.level);
  else if (a.group !== 'consumable') badge = {bonus: '附', reaction: '反'}[a.activities[0]?.activation?.type] || '';
  if (badge) {
    const label = document.createElement('small');
    label.className = 'slotBadge';
    label.textContent = badge;
    b.append(label);
  }
  if (a.resourceSummary?.primary || (a.charge?.max > 0 && !['weapon', 'spell'].includes(a.group))) {
    const count = document.createElement('small');
    count.className = 'charge';
    count.textContent = a.resourceSummary?.primary ? [a.resourceSummary.primary, a.resourceSummary.extra].filter(Boolean).join(' · ') : a.charge.value + '/' + a.charge.max;
    b.append(count);
  }
  return b;
}

function buildPageGrid(group, pageIndex, cols, rowsCount, inert = false) {
  const all = dockRowsForGroup(group);
  const perPage = Math.max(1, cols * rowsCount);
  const totalPages = Math.max(1, Math.ceil(all.length / perPage));
  const idx = clamp(pageIndex, 0, totalPages - 1);
  const slice = all.slice(idx * perPage, (idx + 1) * perPage);

  const grid = document.createElement('div');
  grid.className = 'dockPageGrid';
  grid.style.setProperty('--slot-cols', String(cols));
  grid.dataset.group = group;
  grid.dataset.page = String(idx);
  if (inert) { grid.setAttribute('aria-hidden', 'true'); grid.inert = true; }
  if (slice.length) {
    for (const a of slice) grid.append(buildSlotButton(a));
  } else {
    const empty = document.createElement('small');
    empty.className = 'dockEmpty';
    empty.textContent = '没有此类能力';
    grid.append(empty);
  }
  return {grid, idx, totalPages, all};
}

function openSlotByKey(key) {
  if (busy || !card || !key) return;
  const rows = dockRowsForGroup(dockGroup);
  const target = rows.find(r => r.key === key);
  if (!target) return;
  haptic('light');
  if (mode) { resetMap(); show('stage', true); show('home', true); }
  if (modesKey === key) { hideChoice(); return; }
  if (target.activities.length > 1) showModes(target);
  else choose(target.activities[0] || passiveAction(target), 'dock', target);
}

function updateDock(highlightMs = 0) {
  const visible = !!card && (!!table || !$('lobby').hidden || !!cardFrom);
  show('charDock', visible);
  document.body.classList.toggle('hasDock', visible);
  dockItems.update();
  if (!visible) { dockSignature = ''; lastHpActor = lastHpPct = undefined; return; }

  $('dockActor').textContent = card.actor;
  const hp = card.hp;
  $('dockHp').textContent = hp ? 'HP ' + hp.value + ' / ' + hp.max + (hp.temp > 0 ? ' +' + hp.temp : '') : '';
  $('dockArmor').textContent = [card.ac != null ? 'AC ' + card.ac : '', card.level ? 'Lv ' + card.level : ''].filter(Boolean).join(' · ');
  const fraction = hp ? clamp(hp.value / Math.max(1, hp.max), 0, 1) : 0;
  const line = $('charDock').querySelector('.hpLine');
  line.dataset.hpState = hp && fraction <= 0.25 ? 'low' : hp && fraction <= 0.5 ? 'warn' : 'ok';
  // Unlinked tokens from the same actor can have different health pools.
  const actor = (card.actorId ?? card.actor ?? '') + '/' + (card.source ?? '');
  const nextPct = fraction * 100;
  if (actor !== lastHpActor || nextPct !== lastHpPct) {
    const trail = line.querySelector('.hpTrail');
    const syncTrail = actor !== lastHpActor || !hp || lastHpPct == null || nextPct >= lastHpPct || reducedMotion();
    line.classList.toggle('noTrail', syncTrail);
    line.querySelector('b').style.width = trail.style.width = nextPct + '%';
    if (syncTrail) {
      void trail.offsetWidth;
      line.classList.remove('noTrail');
    }
    lastHpActor = actor;
    lastHpPct = nextPct;
  }
  const conditions = (card.conditions || []).map(c => typeof c === 'string' ? c : c?.label).filter(Boolean);
  const condition = $('dockCond');
  condition.hidden = !conditions.length;
  condition.textContent = (conditions[0] || '') + (conditions.length > 1 ? ' +' + (conditions.length - 1) : '');
  condition.title = conditions.join('、');
  for (const b of $('dockKinds').children) {
    b.hidden = !dockGroupVisible(b.textContent);
    const pressed = String(b.textContent === dockGroup);
    if (b.getAttribute('aria-pressed') === pressed) continue;
    let from;
    if (highlightMs && !reducedMotion() && b.animate) {
      const style = getComputedStyle(b);
      from = {offset: 0, color: style.color, boxShadow: style.boxShadow};
    }
    for (const animation of b.getAnimations?.() || []) if (animation.id === 'dockKindHighlight') animation.cancel();
    b.setAttribute('aria-pressed', pressed);
    if (from) b.animate([from, {offset: 1}], {id: 'dockKindHighlight', duration: highlightMs, easing: 'ease-out'});
  }
  syncMapLoading();
  if (dockFolded) return;

  const {cols, size} = computeDockMetrics();
  dockCols = cols;
  $('dockSlots').style.setProperty('--slot-h', size + 'px');
  const rows = dockRowsForGroup(dockGroup);
  const perPage = Math.max(1, dockCols * dockRows);
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  dockPages[dockGroup] = clamp(dockPages[dockGroup] || 0, 0, totalPages - 1);
  const pageIdx = dockPages[dockGroup];
  $('dockPage').textContent = totalPages > 1 ? `${pageIdx + 1}/${totalPages}` : '';
  show('dockPrevPage', totalPages > 1); show('dockNextPage', totalPages > 1);
  $('dockPrevPage').disabled = pageIdx === 0;
  $('dockNextPage').disabled = pageIdx === totalPages - 1;
  if (dockDragActive) return;

  const signature = JSON.stringify([
    card.actorId, card.portraitAsset?.key, dockGroup, pageIdx, dockCols, dockRows, size, !!table,
    (card.slots || []).map(s => [s.level, s.value]),
    rows.map(a => [a.key, a.name, a.group, a.level, a.isCantrip, a.resourceSummary, a.charge, a.iconAsset?.key,
      a.activities.map(child => [child.key, child.activation?.type, activityDepleted(child)])])
  ]);
  if (signature === dockSignature) return;
  dockSignature = signature;

  const portrait = $('dockPortrait');
  iconObserver.unobserve(portrait);
  mountIcon(portrait, {key: '@actor', name: card.actor});

  const slots = $('dockSlots');
  for (const h of slots.querySelectorAll('.abilityIcon')) iconObserver.unobserve(h);
  slots.replaceChildren();
  const {grid} = buildPageGrid(dockGroup, pageIdx, dockCols, dockRows, false);
  grid.classList.add('current');
  slots.append(grid);
}

// Dual-axis swipe paging inside #dockSlots (isolated from handle & map)
(function installDockPager() {
  const viewport = $('dockSlots');
  let swipe = null;
  let animTimer = null;

  function removeIncoming() {
    for (const grid of viewport.querySelectorAll('.dockPageGrid.incoming')) {
      for (const icon of grid.querySelectorAll('.abilityIcon')) iconObserver.unobserve(icon);
      grid.remove();
    }
  }

  function cleanupIncoming() {
    clearTimeout(animTimer);
    animTimer = null;
    removeIncoming();
    const cur = viewport.querySelector('.dockPageGrid.current');
    if (cur) {
      cur.classList.remove('animating');
      cur.style.transform = cur.style.transitionDuration = '';
      cur.inert = false;
      cur.removeAttribute('aria-hidden');
    }
    dockDragActive = false;
  }

  function finishTransition() {
    cleanupIncoming();
    updateDock();
  }

  function appendIncoming(group, page, cols) {
    const {grid} = buildPageGrid(group, page, cols, dockRows, true);
    grid.classList.add('incoming');
    viewport.append(grid);
    return grid;
  }

  function shiftGrid(grid, axis, offset, duration = 0) {
    if (!grid) return;
    grid.classList.toggle('animating', duration > 0);
    grid.style.transitionDuration = duration ? duration + 'ms' : '';
    grid.style.transform = axis === 'x' ? `translate3d(${offset}px,0,0)` : `translate3d(0,${offset}px,0)`;
  }

  function animateDockTransition({nextGroup, nextPage, axis, dir, duration = 160}) {
    const dragging = !!swipe;
    if (dragging) {
      const {id} = swipe;
      swipe = null;
      if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
      suppressDockClickUntil = performance.now() + 350;
    }
    if (dragging || animTimer !== null) finishTransition();
    if (nextGroup === dockGroup && nextPage === dockPages[dockGroup]) {
      if (dockDragActive) finishTransition();
      return;
    }

    const cur = viewport.querySelector('.dockPageGrid.current');
    const animate = !dragging && !reducedMotion() && duration > 0 && !dockFolded && card && cur;
    const extent = axis === 'x' ? viewport.clientWidth : viewport.clientHeight;
    let incoming = viewport.querySelector('.dockPageGrid.incoming');
    if (animate && !incoming) {
      incoming = appendIncoming(nextGroup, nextPage, computeDockCols());
      shiftGrid(incoming, axis, dir * extent);
    }

    dockGroup = nextGroup;
    dockPages[nextGroup] = nextPage;
    if (!animate) { finishTransition(); return; }
    // Publish the new tab and page now, but keep both grids until their slide ends.
    dockDragActive = true;
    cur.inert = true;
    cur.setAttribute('aria-hidden', 'true');
    updateDock(axis === 'x' ? duration : 0);
    void viewport.offsetWidth;
    shiftGrid(cur, axis, -dir * extent, duration);
    shiftGrid(incoming, axis, 0, duration);
    animTimer = setTimeout(finishTransition, duration);
  }

  for (const name of dockGroups) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.onclick = () => {
      haptic('light');
      const dir = Math.sign(dockGroups.indexOf(name) - dockGroups.indexOf(dockGroup));
      animateDockTransition({nextGroup: name, nextPage: dockPages[name], axis: 'x', dir});
    };
    $('dockKinds').append(button);
  }
  for (const [id, dir] of [['dockPrevPage', -1], ['dockNextPage', 1]]) {
    $(id).onclick = () => {
      haptic('light');
      animateDockTransition({nextGroup: dockGroup, nextPage: dockPages[dockGroup] + dir, axis: 'y', dir});
    };
  }
  $('filter').addEventListener('input', () => { if (animTimer !== null) finishTransition(); });
  motionPreference.addEventListener('change', () => {
    if (!reducedMotion()) return;
    for (const animation of $('dockKinds').getAnimations?.({subtree: true}) || []) {
      if (animation.id === 'dockKindHighlight') animation.cancel();
    }
    if (animTimer !== null) finishTransition();
    else if (swipe?.axis) {
      cleanupIncoming();
      swipe.incoming = null;
      swipe.dir = 0;
      dockDragActive = true;
    }
  });

  viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !card) return;
    if (swipe) { cleanupIncoming(); swipe = null; return; }
    e.stopPropagation();
    if (animTimer !== null) finishTransition();
    const btn = document.elementFromPoint(e.clientX, e.clientY)?.closest('.dockSlot');
    const rect = viewport.getBoundingClientRect();
    viewport.setPointerCapture(e.pointerId);
    const cols = computeDockCols();
    const all = dockRowsForGroup(dockGroup);
    const perPage = Math.max(1, cols * dockRows);
    const totalPages = Math.max(1, Math.ceil(all.length / perPage));
    const pageIdx = clamp(dockPages[dockGroup] || 0, 0, totalPages - 1);
    swipe = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
      samples: [{t: performance.now(), x: e.clientX, y: e.clientY}],
      width: Math.max(1, rect.width), height: Math.max(1, rect.height),
      axis: null, dir: 0, targetGroup: null, targetPage: null, incoming: null,
      pressedKey: btn?.dataset.key || null, cols, totalPages, pageIdx
    };
  });

  function ensureNeighbor(s, axis, dir) {
    if (s.dir === dir) return s.incoming;
    removeIncoming();
    s.incoming = null; s.targetGroup = null; s.targetPage = null; s.dir = dir;
    if (axis === 'x') {
      const groups = dockGroups.filter(dockGroupVisible);
      const idx = groups.indexOf(dockGroup) + dir;
      if (idx < 0 || idx >= groups.length) return null;
      s.targetGroup = groups[idx];
      s.targetPage = dockPages[s.targetGroup];
    } else {
      const nextPage = s.pageIdx + dir;
      if (nextPage < 0 || nextPage >= s.totalPages) return null;
      s.targetGroup = dockGroup;
      s.targetPage = nextPage;
    }
    if (!reducedMotion()) s.incoming = appendIncoming(s.targetGroup, s.targetPage, s.cols);
    return s.incoming;
  }

  viewport.addEventListener('pointermove', e => {
    if (!swipe || swipe.id !== e.pointerId) return;
    e.stopPropagation();
    const dx = e.clientX - swipe.startX;
    const dy = e.clientY - swipe.startY;
    const absX = Math.abs(dx), absY = Math.abs(dy), dist = Math.hypot(dx, dy);
    swipe.lastX = e.clientX; swipe.lastY = e.clientY;
    const now = performance.now();
    swipe.samples.push({t: now, x: e.clientX, y: e.clientY});
    while (swipe.samples.length > 2 && now - swipe.samples[0].t > 90) swipe.samples.shift();

    if (swipe.axis === null) {
      if (dist < 8) return;
      if (absX >= absY * 1.25) swipe.axis = 'x';
      else if (absY >= absX * 1.25) swipe.axis = 'y';
      else if (dist >= 20) { swipe.axis = 'cancel'; return; }
      else return;
      dockDragActive = true;
    }
    if (swipe.axis === 'cancel') return;
    e.preventDefault();

    const cur = viewport.querySelector('.dockPageGrid.current');
    if (!cur) return;
    const offset = swipe.axis === 'x' ? dx : dy;
    const extent = swipe.axis === 'x' ? swipe.width : swipe.height;
    const dir = offset < 0 ? 1 : -1;
    const neighbor = ensureNeighbor(swipe, swipe.axis, dir);
    if (reducedMotion()) return;
    const travel = neighbor ? offset : clamp(offset * .24, -extent * .18, extent * .18);
    shiftGrid(cur, swipe.axis, travel);
    shiftGrid(neighbor, swipe.axis, offset + dir * extent);
  });

  function finishSwipe(e, cancelled) {
    if (!swipe || swipe.id !== e.pointerId) return;
    const s = swipe;
    swipe = null;
    if (viewport.hasPointerCapture?.(e.pointerId)) {
      try { viewport.releasePointerCapture(e.pointerId); } catch {}
    }

    const dx = e.clientX - s.startX, dy = e.clientY - s.startY;
    const dist = Math.hypot(dx, dy);

    if (cancelled || s.axis === 'cancel') {
      cleanupIncoming();
      updateDock();
      return;
    }
    if (s.axis === null && dist < 8) {
      cleanupIncoming();
      suppressDockClickUntil = performance.now() + 350;
      const releaseEl = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.dockSlot');
      const key = releaseEl?.dataset.key || s.pressedKey;
      if (key && key === s.pressedKey) openSlotByKey(key);
      return;
    }

    suppressDockClickUntil = performance.now() + 350;
    const cur = viewport.querySelector('.dockPageGrid.current');
    const neighbor = s.incoming;
    const oldest = s.samples[0], dt = Math.max(1, performance.now() - oldest.t);
    const vx = (e.clientX - oldest.x) / dt;
    const vy = (e.clientY - oldest.y) / dt;

    let commitSwipe = false;
    if (s.axis === 'x' && s.targetGroup) {
      const thresh = clamp(s.width * 0.25, 32, 80);
      const flick = Math.abs(dx) >= 18 && Math.sign(vx) === Math.sign(dx) && Math.abs(vx) >= 0.45;
      commitSwipe = Math.abs(dx) >= thresh || flick;
    } else if (s.axis === 'y' && s.targetPage !== null) {
      const thresh = clamp(s.height * 0.28, 22, 56);
      const flick = Math.abs(dy) >= 14 && Math.sign(vy) === Math.sign(dy) && Math.abs(vy) >= 0.4;
      commitSwipe = Math.abs(dy) >= thresh || flick;
    }

    if (commitSwipe) {
      animateDockTransition({nextGroup: s.targetGroup, nextPage: s.targetPage, axis: s.axis, dir: s.dir});
    } else if (reducedMotion() || !cur || !s.axis) {
      finishTransition();
    } else {
      const extent = s.axis === 'x' ? s.width : s.height;
      shiftGrid(cur, s.axis, 0, 140);
      shiftGrid(neighbor, s.axis, s.dir * extent, 140);
      animTimer = setTimeout(finishTransition, 140);
    }
  }

  viewport.addEventListener('pointerup', e => finishSwipe(e, false));
  viewport.addEventListener('pointercancel', e => finishSwipe(e, true));
  viewport.addEventListener('lostpointercapture', e => finishSwipe(e, true));
  // Keyboard / screen-reader / non-pointer click fallback
  viewport.addEventListener('click', e => {
    if (performance.now() < suppressDockClickUntil) return;
    const btn = e.target.closest?.('.dockSlot');
    if (btn?.dataset.key) openSlotByKey(btn.dataset.key);
  });
})();

async function openSheet() {
  if (mapExpanded) setMapExpanded(false);
  if (busy) return;
  closeInspection(true);
  if (!table) { if (!cardFrom) await offlineSheet(!$('lobby').hidden ? 'lobby' : 'pair'); return; }
  const channel = ch, source = table.source?.id ?? null;
  try {
    if (!card || card.source !== source) {
      const snapshot = await rpc('sheet');
      if (ch !== channel || (table?.source?.id ?? null) !== source) return;
      void acceptCard(snapshot);
    }
    resetMap(); show('home', false); show('stage', false); hideChoice(); show('sheet', true);
    renderSheet(); syncMapLoading(); updateDock(); tell('');
  } catch (e) { if (ch === channel) tell(e.message, 'error'); }
}

function passiveAction(row) { return {...row, key: row.key + '/passive', activity: row.name, mode: 'passive'}; }
function resourceOptions(a) {
  const regular = a.needsSlot ? (card?.slots || []).filter(s => s.level >= a.level && s.value > 0).map(s => ({...s, key: s.id, kind: 'slot', label: (s.kind === 'pact' || s.id === 'pact' ? '契约 ' : '') + roman(s.level) + ' 环'}))
    : [{...(a.charge || {}), kind: 'native', key: 'native', level: a.level || 0, label: '正常使用'}];
  return [...regular, ...(a.freeOptions || []).filter(o => o.value > 0)];
}
function usableResource(a, option) {
  return !!option && !(a.consumesUses && a.charge?.value <= 0 && !(option.kind === 'free' && a.group !== 'spell'));
}
function activityDepleted(a) { return !resourceOptions(a).some(option => usableResource(a, option)); }
function selectedResourceOption() { return choiceResource; }
function resourcePayload() {
  const resourceOption = selectedResourceOption();
  return {resourceOption, ...(resourceOption?.kind === 'slot' ? {slot: resourceOption.key} : {})};
}
function showModes(row) {
  if (modesKey !== row.key) hideChoice();
  modesKey = row.key; setReveal($('itemModes'), true, 140);
  $('itemModesTitle').textContent = row.name;
  $('itemModesMeta').textContent = [groupOf(row), row.activities.length + ' 种使用方式', row.resourceSummary?.primary, row.resourceSummary?.extra].filter(Boolean).join(' · ');
  $('itemModesList').replaceChildren(...row.activities.map(activity => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'itemModeBtn'; button.classList.toggle('depleted', activityDepleted(activity));
    button.setAttribute('aria-pressed', String(action?.key === activity.key));
    const top = document.createElement('span'), name = document.createElement('strong'), act = document.createElement('small'), detail = document.createElement('small');
    top.className = 'itemModeTop'; name.className = 'itemModeName'; name.textContent = activity.activity || activity.name;
    act.className = 'modeAct'; const type = activity.activation?.type;
    act.dataset.act = ['action','bonus','reaction','special'].includes(type) ? type : 'other'; act.textContent = activity.activation?.label || '其他';
    detail.className = 'itemModeDetail'; detail.textContent = [activity.range?.label, activity.damageFormula, activity.charge ? '次数 ' + activity.charge.value + '/' + activity.charge.max : ''].filter(Boolean).join(' · ');
    top.append(name, act); button.append(top, detail); button.onclick = () => choose(activity, 'dock', row); return button;
  }));
  for (const b of $('dockSlots').querySelectorAll('.dockSlot')) b.setAttribute('aria-pressed', String(b.dataset.key === row.key));
}
$('itemModesClose').onclick = () => hideChoice();
function toggleChoices(id, choices, selectedValue, change) {
  const list = $(id);
  list.replaceChildren(...choices.map(({id: value, label}) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.setAttribute('aria-pressed', String(value === selectedValue));
    button.onclick = () => { change(value); for (const other of list.children) other.setAttribute('aria-pressed', String(other === button)); };
    return button;
  }));
}
function choose(a, from, row) {
  if (busy) return;
  modesKey = ''; setReveal($('itemModes'), false, 140);
  choiceFrom = from || (!$('sheet').hidden ? 'sheet' : 'dock');
  action = a;
  setReveal($('choice'), true, 140);
  $('chosen').textContent = abilityTitle(a);
  for (const b of $('dockSlots').querySelectorAll('.dockSlot')) b.setAttribute('aria-pressed', String(b.dataset.key === a.key.split('/')[0]));
  const item = row || card.inventory?.find(i => i.id === a.key.split('/')[0]), offline = !!cardFrom || !table;
  $('description').textContent = item?.description || a.description || '角色卡上未填写这项能力的描述。';
  const chargeText = a.charge && a.charge.max > 0 ? `次数 ${a.charge.value}/${a.charge.max}` : '';
  $('actionMeta').textContent = [
    typeNames[a.group] || '物品',
    a.activity !== a.name ? (abilityTitle(a) === a.name ? a.activity : a.name) : '',
    a.level ? roman(a.level) + ' 环' : (a.isCantrip ? '戏法' : ''),
    a.activation?.label, a.range?.label, a.concentration ? '专注' : '',
    a.damageFormula, a.duration,
    chargeText,
    offline ? '离线查看' : a.mode === 'passive' ? '常驻或无可用活动' : ''
  ].filter(Boolean).join(' · ');

  const remembered = actionChoices.get(a.key) || {};
  actionChoices.set(a.key, remembered);
  const free = !!a.freeOptions?.length, options = resourceOptions(a), slots = $('slot');
  show('slotBox', !offline && (a.needsSlot || free)); $('slotBoxLabel').textContent = free ? '施法资源' : '施法环位';
  slots.replaceChildren(...options.map(option => {
    const el = document.createElement('option'); el.value = option.key; el.textContent = option.label + (option.value != null ? ' · 剩余 ' + option.value + '/' + option.max : ''); return el;
  }));
  if (remembered.resourceKey && (a.needsSlot || free)) slots.value = remembered.resourceKey;
  else if (options.length) slots.value = (options.find(o => usableResource(a, o)) || options[0]).key;
  function refresh() {
    const option = options.find(o => o.key === slots.value);
    choiceResource = option ? {kind: option.kind, key: option.key, level: option.level} : null;
    if (option) remembered.resourceKey = option.key;
    $('aim').disabled = offline || busy || a.mode === 'passive' || !usableResource(a, option);
    tell(!offline && a.mode !== 'passive' && !usableResource(a, option) ? options.length && !option ? '资源已变动，请重新选择' : '当前资源不足' : '');
  }
  slots.onchange = refresh; $('aim').textContent = '使用'; refresh();
  const damage = !offline && a.damageChoices?.length > 1, grip = !offline && !!a.versatile;
  damageType = damage ? (a.damageChoices.find(c => c.id === remembered.damage)?.id || a.damageChoices[0].id) : '';
  versatile = grip && !!remembered.versatile;
  show('choiceOptions', !!(damage || grip)); show('damageTypeBox', !!damage); show('versatileBox', grip);
  if (damage) toggleChoices('damageChoices', a.damageChoices, damageType, v => { damageType = remembered.damage = v; });
  if (grip) toggleChoices('versatileChoices', [{id: false, label: '单手 (' + (a.damageFormula || '默认') + ')'}, {id: true, label: '双手 (' + (a.versatileFormula || '万能') + ')'}], versatile, v => { versatile = remembered.versatile = v; });
}

function begin(next) {
  viewer.cancelAnimation();
  if (mapExpanded) setMapExpanded(false);
  if (!table?.source) throw Error('请先在电脑玩家窗口选中自己的棋子');
  if (next !== 'self' && !localMap.frame) throw Error($('displayNote').textContent || '地图尚未就绪');
  if (next !== 'self') {
    if (dockFoldedBeforeAim === null) dockFoldedBeforeAim = dockFolded;
    if (!dockFolded) setDockLayout(dockRows, true, false);
  }
  closeInspection(true);
  sheetUI.closeQuickRoll();
  clearTeleport(); mode = next;
  clearOverlayFx();
  planId = uid();
  aimScene = table.scene;
  aimSource = table.source.id;
  origin = {x: table.source.x, y: table.source.y};
  selected = []; anchors = {}; points = []; centerDest = null; hover = null; point = null; angle = 0; route = null; commit = null; actualTemplate = null;
  clearTimeout(routeTimer); clearTimeout(shapeTimer); lastRouteKey = ''; lastTemplateKey = '';
  checkSeq++; predictSeq++; templateSeq++; lastPredictId = '';
  $('prediction').textContent = '';
  $('coveredList').textContent = '';
  show('coveredList', false);
  hideChoice();
  updateCombatHud();
  if (mode !== 'self') {
    show('stage', true); show('home', false); show('sheet', false); setReveal($('mapControls'), true, 140); show('mapInfo', true);
    document.body.classList.add('aiming');
    show('mapExpandBtn', false);
    syncMapLoading();
    window.TableDisplay?.mapExpanded?.(true);
    const center = viewportCenterWorld();
    const zoom = matchMedia('(orientation: portrait)').matches && table.grid > 0 ? Math.max(viewer.zoom, 40 / table.grid) : viewer.zoom;
    const recenter = mode === 'move' || mode === 'teleport' || mode === 'areaChoice' || (mode === 'area' && !action?.anchored && (!center || !selectable(center)));
    const focus = recenter ? origin : center;
    if (mode === 'areaChoice') {
      point = {...origin}; requestTemplatePreview(true);
    } else if (mode === 'area') {
      if (action?.anchored && !['cone', 'line', 'square'].includes(action.shape)) {
        point = {x: origin.x, y: origin.y};
        lastTemplateKey = tplKey(point, angle);
        requestTemplatePreview(true);
      } else {
        syncCenterAim(true, focus);
      }
    }
    if (recenter || zoom !== viewer.zoom) centerCameraOn(focus, {zoom, duration: 160});
    localMap.draw();
  }
  $('actionName').textContent = next === 'move' ? '规划移动' : action?.name || '';
  $('confirm').textContent = next === 'move' ? '确认移动' : action?.group === 'spell' ? '确认施放' : '确认使用';
  $('undo').textContent = next === 'teleport' ? '重选目标' : next === 'target' ? '撤销上一个' : '撤销上一点';
  show('undo', next === 'move' || (next === 'target' && (action?.repeat || action?.multiPlan)) || (next === 'teleport' && action.teleport?.movesTarget));
  tell('');
  render();
}

function project() {
  return viewer.projection(table.scene, table.view, overlay.getBoundingClientRect(), localMap.frame?.rect);
}

function sameWorld(a, b) {
  return !!(a && b && Math.hypot(a.x - b.x, a.y - b.y) <= 1);
}

function viewportCenterWorld() {
  if (!table || !localMap.frame) return null;
  const pr = project();
  if (!pr.rect.width || !pr.rect.height) return null;
  return pr.inverse(pr.rect.width / 2, pr.rect.height / 2);
}

function centerCameraOn(worldPt, {animate = true, zoom = viewer.zoom, duration = 240} = {}) {
  if (!worldPt || !table || !localMap.frame) return;
  const pr = project();
  if (!pr.rect.width || !pr.rect.height) return;
  cameraGoal = {x: worldPt.x, y: worldPt.y, zoom};
  viewer.animateTo(cameraGoal, {
    rect: pr.rect, duration: animate ? duration : 0,
    onFrame: () => { localMap.draw(); render(); },
    onDone: () => {
      cameraGoal = null;
      localMap.draw();
      if (mode && !(mode === 'teleport' && swapTarget)) syncCenterAim(true);
      render();
    }
  });
}

function effectiveMovePoints() {
  const out = points.slice();
  const last = out.at(-1) || origin;
  if (centerDest && !sameWorld(centerDest, last)) out.push(centerDest);
  return out;
}

function moveKey(list) {
  return list.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(';');
}

function tplKey(pt, dir) {
  return pt ? `${Math.round(pt.x)},${Math.round(pt.y)},${Math.round(dir)}` : '';
}

function clearTeleport() {
  clearTimeout(teleportTimer); teleportSeq++; teleportKey = ''; teleportPreviewState = null; swapTarget = null;
}
function teleportInput() {
  if (swapTarget) return {swapTarget, targets: [swapTarget], anchors};
  return {...(action.teleport?.movesTarget ? {targets: selected, anchors} : {}), point};
}
function previewTeleport(immediate) {
  if (!swapTarget && !point) return;
  const input = {...teleportInput(), ...resourcePayload()}, signature = JSON.stringify(input);
  if (signature === teleportKey && (!immediate || !teleportTimer)) return;
  clearTimeout(teleportTimer); teleportTimer = null; teleportKey = signature; teleportPreviewState = null;
  const myPlan = planId, seq = ++teleportSeq, key = action.key;
  async function run() {
    teleportTimer = null;
    try {
      const reply = await rpc('teleportPreview', {planId: myPlan, seq, key, ...input});
      if (planId !== myPlan || seq !== teleportSeq || reply.planId !== myPlan || reply.seq !== seq) return;
      teleportPreviewState = reply.swapTarget && reply.swapTarget.id !== swapTarget ? {...reply, valid:false, reason:'请轻点目标确认换位'} : reply;
    } catch (e) {
      if (planId !== myPlan || seq !== teleportSeq) return;
      teleportKey = ''; teleportPreviewState = {planId, seq, valid:false, reason:e.message};
    }
    render();
  }
  if (immediate) void run(); else teleportTimer = setTimeout(run, 65);
}
function teleportReady() { return teleportPreviewState?.valid && teleportPreviewState.planId === planId && teleportPreviewState.seq === teleportSeq; }
function teleportPoint(world, immediate) {
  if (action.teleport?.kind === 'swap' || (action.teleport?.movesTarget && !selected.length)) return;
  if (swapTarget) { swapTarget = null; anchors = {}; }
  const moving = action.teleport?.movesTarget && table.targets.find(tok => tok.id === selected[0]);
  point = snapMoveCenter(world, table.gridInfo || {type: 1, size: table.grid, distance: table.unit}, moving || table.source);
  previewTeleport(immediate);
}
function syncCenterAim(immediate = false, destination) {
  if (!mode || busy || !table?.source || !localMap.frame) return;
  const c = destination || viewportCenterWorld();
  if (!c || !selectable(c)) {
    if (mode === 'teleport' && action.teleport?.kind !== 'swap') { clearTeleport(); point = null; }
    return;
  }
  const gInfo = table.gridInfo || {type: 1, size: table.grid, distance: table.unit, ox: 0, oy: 0};

  if (mode === 'move') {
    const snapped = snapMoveCenter(c, gInfo, table.source);
    const last = points.at(-1) || origin;
    centerDest = sameWorld(snapped, last) ? null : snapped;
    const eff = effectiveMovePoints();
    const k = moveKey(eff);
    if (k !== lastRouteKey) {
      lastRouteKey = k;
      route = null;
      if (eff.length) validateRoute(immediate);
      else { clearTimeout(routeTimer); checkSeq++; }
    } else if (immediate && eff.length && !route && routeInFlight !== checkSeq) {
      validateRoute(true);
    }
    return;
  }

  if (mode === 'teleport') {
    teleportPoint(c, immediate);
    return;
  }

  if (mode === 'area' && action) {
    if (action.anchored) {
      if (!['cone', 'line', 'square'].includes(action.shape)) return;
      if (Math.hypot(c.x - origin.x, c.y - origin.y) <= Math.max(12, table.grid * 0.25)) return;
      const nextAngle = ((Math.atan2(c.y - origin.y, c.x - origin.x) * 180 / Math.PI) % 360 + 360) % 360;
      const pose = snapTemplatePose(action.templateSpec || action, table.source, c, nextAngle, gInfo);
      angle = nextAngle;
      point = pose;
      const quantDir = action.shape === 'square' ? Math.round(angle / 90) * 90 : Math.round(angle / 3) * 3;
      const k = tplKey(point, quantDir);
      if (k !== lastTemplateKey) {
        lastTemplateKey = k;
        requestTemplatePreview(immediate);
      } else if (immediate && !actualTemplate && templateInFlight !== templateSeq) {
        requestTemplatePreview(true);
      }
      return;
    }
    const snapped = snapTemplatePose(action.templateSpec || action, table.source, c, angle, gInfo);
    const nextPt = {x: snapped.x, y: snapped.y};
    const k = tplKey(nextPt, angle);
    if (k !== lastTemplateKey) {
      lastTemplateKey = k;
      point = nextPt;
      requestTemplatePreview(immediate);
    } else if (immediate && !actualTemplate && templateInFlight !== templateSeq) {
      requestTemplatePreview(true);
    }
  }
}

function selectable(world) {
  const f = localMap.frame; if (!f) return false;
  if (world.x < f.rect.x || world.y < f.rect.y || world.x >= f.rect.x + f.rect.w || world.y >= f.rect.y + f.rect.h) return false;
  if (!f.fog) return true;
  const [a, b, c, d, tx, ty, w, h] = f.view, x = a * world.x + c * world.y + tx, y = b * world.x + d * world.y + ty;
  return x >= 0 && y >= 0 && x < w && y < h;
}

function hit(p) {
  if (!p || !table?.targets) return null;
  return hitTokenAt(p, table.targets, localMap.rendered);
}

const easeOutCubic = t => 1 - (1 - t) ** 3;

function clearOverlayFx() {
  if (overlayFxFrame !== null) cancelAnimationFrame(overlayFxFrame);
  overlayFxFrame = null;
  targetLocks.clear();
  ripples.length = 0;
  visualAim = null;
}

function scheduleOverlayFx() {
  if (overlayFxFrame !== null || reducedMotion() || !(targetLocks.size || visualAim?.from || ripples.length)) return;
  overlayFxFrame = requestAnimationFrame(() => {
    overlayFxFrame = null;
    render();
  });
}

// Only the painted footprint and dot follow this point. Rules, hit tests and RPCs use the original coordinates.
function visualAimAt(target, now) {
  if (!target || reducedMotion()) { visualAim = null; return target; }
  const {x, y} = target;
  if (!visualAim) visualAim = {from: null, to: {x, y}, start: now};
  const {from, to, start} = visualAim;
  let current = to;
  if (from) {
    const t = clamp((now - start) / 75, 0, 1);
    if (t === 1) visualAim.from = null;
    else {
      const k = easeOutCubic(t);
      current = {x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k};
    }
  }
  if (to.x !== x || to.y !== y) visualAim = {from: current, to: {x, y}, start: now};
  return current;
}

function drawRipples(pr, now) {
  if (!ripples.length) return;
  ctx.save();
  ctx.strokeStyle = themeColors().highlight;
  ctx.lineWidth = 2;
  for (let i = ripples.length - 1; i >= 0; i--) {
    const ripple = ripples[i], t = (now - ripple.start) / ripple.duration;
    if (t >= 1 || reducedMotion()) { ripples.splice(i, 1); continue; }
    const pos = pr.forward(ripple);
    ctx.globalAlpha = .8 * (1 - t);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 5 + (ripple.maxR - 5) * easeOutCubic(t), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTokenOutline(pr, tok, strokeColor, fillColor = null, lineWidth = 2.5, size = 1) {
  const pos = localMap.rendered.get(tok.id) || tok;
  const hw = tok.w * size / 2, hh = tok.h * size / 2;
  const corners = [
    pr.forward({x: pos.x - hw, y: pos.y - hh}),
    pr.forward({x: pos.x + hw, y: pos.y - hh}),
    pr.forward({x: pos.x + hw, y: pos.y + hh}),
    pr.forward({x: pos.x - hw, y: pos.y + hh})
  ];
  ctx.save();
  ctx.beginPath();
  corners.forEach((c, i) => i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y));
  ctx.closePath();
  if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function drawTemplate(pr, pose, displayPoint) {
  if (!pose || !action) return;
  const pos = pr.forward(displayPoint);
  if (actualTemplate?.outline && (mode === 'area' || mode === 'areaChoice')) {
    const g = actualTemplate.outline;
    ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(Math.atan2(pr.b, pr.a)); ctx.scale(pr.scale, pr.scale);
    ctx.lineWidth = 2 / pr.scale; ctx.strokeStyle = themeColors().highlight; ctx.fillStyle = themeColors().highlight + '39'; ctx.beginPath();
    if (g.points) { for (let i = 0; i < g.points.length; i += 2) i ? ctx.lineTo(g.points[i], g.points[i + 1]) : ctx.moveTo(g.points[i], g.points[i + 1]); ctx.closePath(); }
    else if (Number.isFinite(g.radius)) ctx.arc(0, 0, g.radius, 0, Math.PI * 2);
    else ctx.rect(g.x, g.y, g.w, g.h);
    ctx.fill(); ctx.stroke(); ctx.restore();
    // Highlight visible tokens covered by the authoritative template
    for (const cov of actualTemplate.eligible || actualTemplate.covered || []) {
      const tok = table.targets.find(x => x.id === cov.id);
      if (tok) {
        const locked = mode === 'areaChoice' && selected.includes(tok.id);
        drawTokenOutline(pr, tok, locked ? themeColors().edgeStart : themeColors().highlight + 'a0', themeColors().highlight + (locked ? '55' : '20'), locked ? 4 : 2);
      }
    }
    return;
  }
  const spec = action.templateSpec;
  const size = (spec?.size || action.size) * table.grid / table.unit * pr.scale;
  ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(pose.direction * Math.PI / 180 + Math.atan2(pr.b, pr.a)); ctx.beginPath();
  ctx.strokeStyle = themeColors().highlight; ctx.fillStyle = themeColors().highlight + '39';
  if ((spec?.t || action.shape) === 'cone') {
    const halfRad = ((spec?.angle || 53.13) / 2) * Math.PI / 180;
    ctx.moveTo(0, 0); ctx.arc(0, 0, size, -halfRad, halfRad); ctx.closePath();
  } else if (spec?.t === 'ray' || action.shape === 'line') {
    const wPx = (spec?.templateType === 'cube' ? size : (spec?.width || action.width) * table.grid / table.unit * pr.scale);
    ctx.rect(0, -wPx / 2, size, wPx);
  } else if (spec?.t === 'rect' || action.shape === 'square') {
    ctx.rotate(-pose.direction * Math.PI / 180);
    ctx.rect(0, 0, size, size);
  } else {
    ctx.arc(0, 0, size, 0, Math.PI * 2);
  }
  ctx.fill(); ctx.stroke(); ctx.restore();
}

function drawCenterReticle(pr, snappedWorldPt, showFootprint = false, footprint = table.source, col = themeColors().highlight) {
  const cx = pr.rect.width / 2, cy = pr.rect.height / 2;
  if (showFootprint && snappedWorldPt && footprint) {
    const hw = footprint.w / 2, hh = footprint.h / 2;
    const corners = [
      pr.forward({x: snappedWorldPt.x - hw, y: snappedWorldPt.y - hh}),
      pr.forward({x: snappedWorldPt.x + hw, y: snappedWorldPt.y - hh}),
      pr.forward({x: snappedWorldPt.x + hw, y: snappedWorldPt.y + hh}),
      pr.forward({x: snappedWorldPt.x - hw, y: snappedWorldPt.y + hh})
    ];
    ctx.save();
    ctx.beginPath();
    corners.forEach((c, i) => i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y));
    ctx.closePath();
    ctx.fillStyle = col + '26';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.restore();
  }

  // Subtle fixed crosshair ticks marking exact viewport center
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.68)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 15, cy); ctx.lineTo(cx - 8, cy);
  ctx.moveTo(cx + 8, cy); ctx.lineTo(cx + 15, cy);
  ctx.moveTo(cx, cy - 15); ctx.lineTo(cx, cy - 8);
  ctx.moveTo(cx, cy + 8); ctx.lineTo(cx, cy + 15);
  ctx.stroke();

  // The ring follows the visual snap while the four ticks mark the exact viewport center.
  const dot = snappedWorldPt ? pr.forward(snappedWorldPt) : {x: cx, y: cy};
  ctx.beginPath();
  ctx.arc(dot.x, dot.y, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = '#17202b';
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = col;
  ctx.stroke();
  ctx.restore();
}

function selectionLimit() {
  const plan = action?.multiPlan, level = selectedResourceOption()?.level ?? action?.level ?? 0;
  return (plan?.maxBase ?? plan?.max ?? action?.max ?? 1) + Math.max(0, level - (action?.level || 0)) * (plan?.maxPerUpcast ?? (action?.repeat ? 1 : 0));
}
function projectileLabel() { return action?.multiPlan?.spell === 'scorchingRay' || /scorching.?ray|灼热射线/i.test([action?.identifier, action?.name].join(' ')) ? '射线' : '飞弹'; }
function areaReady() { return actualTemplate?.ticket && actualTemplate.planId === planId && actualTemplate.seq === templateSeq; }

function render() {
  if (!table || map.hidden) return;
  const p = project(), dpr = window.devicePixelRatio || 1;
  const w = Math.round(p.rect.width * dpr), h = Math.round(p.rect.height * dpr);
  if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, p.rect.width, p.rect.height);

  const now = performance.now();
  for (const [id, start] of targetLocks) {
    if (now - start >= 120 || !selected.includes(id) || reducedMotion()) targetLocks.delete(id);
  }
  let pose = null, aim = null;
  if (mode === 'move') aim = centerDest || points.at(-1) || origin;
  else if (mode === 'teleport') aim = teleportPreviewState?.snapped || point;
  else if ((mode === 'area' || mode === 'areaChoice') && point) {
    pose = actualTemplate?.placement || snapTemplatePose(action.templateSpec || action, table.source, point, angle,
      table.gridInfo || {type: 1, size: table.grid, distance: table.unit});
    aim = pose;
  }
  const displayPoint = visualAimAt(aim, now);
  drawRipples(p, now);
  scheduleOverlayFx();

  if (currentInspection && !mode) {
    const inspectedTok = table.targets.find(t => t.id === currentInspection.id);
    if (inspectedTok) drawTokenOutline(p, inspectedTok, themeColors().edgeStart, null, 2.5);
    positionTokenPeek(currentInspection.id);
  }
  if (!mode) return;

  if (origin && (mode === 'target' || (mode === 'area' && !action?.anchored) || mode === 'teleport')) {
    const rangePx = mode === 'teleport' ? (teleportPreviewState?.rangeFt || action.teleport?.rangeFt || 30) * table.grid / Math.max(1, table.unit || 5) : Number(action?.range?.px);
    if (Number.isFinite(rangePx) && rangePx > 0) {
      const o = p.forward(origin), radius = rangePx * p.scale;
      ctx.save();
      ctx.strokeStyle = themeColors().edgeStart + '99';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(o.x, o.y, radius, 0, Math.PI * 2); ctx.stroke();
      const distance = Math.round(rangePx / Math.max(1, table.grid) * (table.unit || 5));
      const label = mode === 'teleport' ? distance + ' 尺' : action.range.label || distance + ' ' + (table.units || '尺');
      if (o.x + radius > 0 && o.x - radius < p.rect.width && o.y + radius > 0 && o.y - radius < p.rect.height) {
        ctx.fillStyle = themeColors().edgeStart;
        ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const pad = ctx.measureText(label).width / 2 + 4;
        ctx.fillText(label, clamp(o.x, pad, p.rect.width - pad), clamp(o.y - radius + 4, 4, p.rect.height - 16));
      }
      ctx.restore();
    }
  }

  ctx.lineWidth = 2; ctx.strokeStyle = themeColors().edgeStart; ctx.fillStyle = themeColors().highlight;
  const effMove = mode === 'move' ? effectiveMovePoints() : [];
  if (mode === 'move') {
    const validRoute = route && route.planId === planId && route.seq === checkSeq;
    const path = [origin, ...(validRoute && !route.reason ? route.preview : effMove)].map(p.forward);
    ctx.beginPath();
    if (validRoute && route.reason) ctx.strokeStyle = '#f0ab8a';
    path.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y));
    ctx.stroke();
    for (const q of path) { ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fill(); }
    drawCenterReticle(p, displayPoint, true);
    $('summary').textContent = (validRoute && route.reason)
      || [validRoute ? '路线 ' + Number(route.cost.toFixed(1)) + ' ' + table.units : effMove.length ? '核对路径…' : '拖动地图对准落点，轻点地图加途经点',
        table.source?.remaining != null ? '剩余 ' + table.source.remaining + ' ' + table.units : ''].filter(Boolean).join(' · ');
  } else if (mode === 'target') {
    for (const id of new Set([...selected, hover].filter(Boolean))) {
      const t = table.targets.find(tok => tok.id === id);
      if (!t || !selectable(t)) continue;
      const start = targetLocks.get(id);
      const size = start === undefined ? 1 : 1 + .14 * (1 - easeOutCubic(clamp((now - start) / 120, 0, 1)));
      drawTokenOutline(p, t, themeColors().edgeStart, null, 2.5, size);
    }
    const counts = new Map();
    for (const id of selected) counts.set(id, (counts.get(id) || 0) + 1);
    const names = [...counts].map(([id,count]) => (table.targets.find(t => t.id === id)?.name || '已离开') + (count > 1 ? ' ×' + count : '')).join('、');
    const max = selectionLimit();
    $('summary').textContent = names ? names + ' · ' + (action.repeat ? projectileLabel() + ' ' : '') + selected.length + '/' + max
      : action.repeat ? '依次点击分配 ' + max + (projectileLabel() === '射线' ? ' 道射线' : ' 枚飞弹') + '，同一目标可多次选择' : '点击或拖动准星到一个目标';
  } else if (mode === 'teleport') {
    const spec = action.teleport || {}, target = table.targets.find(tok => tok.id === (swapTarget || selected[0]));
    if (target) drawTokenOutline(p, target, themeColors().edgeStart, null, 3);
    if (!swapTarget && point) drawCenterReticle(p, teleportPreviewState?.snapped || point, true, (spec.movesTarget && target) || table.source, teleportPreviewState?.valid === false ? '#f0ab8a' : themeColors().highlight);
    $('summary').textContent = teleportPreviewState?.reason || (teleportReady() ? swapTarget ? '与 ' + target?.name + ' 互换位置' : '传送至此（已校验）' : spec.movesTarget && !selected.length ? '点击选择要传送的目标生物' : spec.kind === 'swap' && !swapTarget ? '点击选择换位目标' : point || swapTarget ? '正在核对传送落点…' : spec.kind === 'pointOrSwap' ? '轻点棋子换位，或拖动地图选择落点' : '拖动地图或轻点选择传送落点');
  } else if (mode === 'areaChoice') {
    drawTemplate(p, pose, actualTemplate?.placement || point);
    const eligible = actualTemplate?.eligible || [];
    $('summary').textContent = areaReady() ? '已选 ' + selected.length + ' / 光环内可选 ' + eligible.length + ' 个' : '正在核对光环范围…';
    $('coveredList').textContent = '已选：' + (eligible.filter(tok => selected.includes(tok.id)).map(tok => tok.name).join('、') || '无'); show('coveredList', true);
  } else if (mode !== 'self') {
    drawTemplate(p, pose, displayPoint);
    if (mode === 'area') {
      if (action?.anchored) {
        const o = p.forward(origin);
        ctx.beginPath(); ctx.arc(o.x, o.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#17202b'; ctx.fill();
        ctx.strokeStyle = themeColors().highlight; ctx.stroke();
        if (['cone', 'line', 'square'].includes(action.shape)) {
          drawCenterReticle(p, null, false);
        }
      } else {
        drawCenterReticle(p, displayPoint || viewportCenterWorld(), false);
      }
      if (point) {
        for (const grip of handles()) {
          const q = p.forward(grip);
          ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = '#17202b'; ctx.fill();
          ctx.strokeStyle = themeColors().highlight; ctx.stroke();
        }
      }
    }
    const validTpl = actualTemplate && actualTemplate.planId === planId && actualTemplate.seq === templateSeq;
    if (mode === 'area') {
      if (validTpl) {
        const cov = actualTemplate.covered || [];
        $('coveredList').textContent = cov.length ? `覆盖目标 (${cov.length})：${cov.map(c => c.name).join('、')}` : '覆盖目标：无';
        show('coveredList', true);
      } else if (point) {
        $('coveredList').textContent = '正在核对覆盖范围…';
        show('coveredList', true);
      } else {
        show('coveredList', false);
      }
    }
    $('summary').textContent = action?.anchored && ['cone', 'line', 'square'].includes(action.shape)
        ? '拖动地图将目标移入中心瞄准'
        : ['line', 'cone'].includes(action?.shape)
          ? '拖动地图移中心，拖外圆点调方向'
          : '拖动地图对准目标，双指可缩放';
  }

  const moveReady = mode === 'move' && effMove.length > 0 && route && route.planId === planId && route.seq === checkSeq && !route.reason && !!route.ticket;
  $('confirm').disabled = busy || (
    mode === 'move' ? !moveReady
      : mode === 'target' ? action.repeat ? selected.length !== selectionLimit() : !selected.length
      : mode === 'area' ? !areaReady()
      : mode === 'areaChoice' ? !areaReady() || !selected.length
      : mode === 'teleport' ? !teleportReady()
      : false
  );
  $('undo').disabled = busy || (mode === 'target' || mode === 'teleport' ? !selected.length : !points.length && !centerDest);
}

function validateRoute(immediate = true) {
  const myPlan = planId, seq = ++checkSeq;
  route = null;
  clearTimeout(routeTimer);
  const eff = effectiveMovePoints();
  render();
  if (!eff.length) return;
  const snapshot = eff.map(p => ({x: p.x, y: p.y}));
  const run = async () => {
    routeInFlight = seq;
    try {
      const r = await rpc('route', {planId: myPlan, seq, points: snapshot});
      if (myPlan === planId && seq === checkSeq) {
        route = r;
        tell('');
        render();
      }
    } catch (e) {
      if (myPlan === planId && seq === checkSeq) {
        route = null;
        tell(e.message, 'error');
        render();
      }
    } finally {
      if (routeInFlight === seq) routeInFlight = undefined;
    }
  };
  if (immediate) void run();
  else routeTimer = setTimeout(run, 85);
}

function predict(id, force = false) {
  if (!action || !id || action.repeat) { predictSeq++; lastPredictId = ''; $('prediction').textContent = ''; return; }
  if (!force && id === lastPredictId && Date.now() - lastPredictAt < 1400) return;
  const switched = lastPredictId !== id;
  lastPredictId = id; lastPredictAt = Date.now(); const seq = ++predictSeq; clearTimeout(previewTimer);
  if (switched || !$('prediction').textContent) $('prediction').textContent = '正在读取桌面预测…';
  previewTimer = setTimeout(async () => {
    try {
      const p = await rpc('predict', {key: action.key, target: id});
      if (seq !== predictSeq) return;
      const name = table.targets.find(t => t.id === id)?.name;
      $('prediction').textContent = (name && (mode === 'area' || selected.length > 1) ? name + ' · ' : '') + p.label + (Number.isFinite(p.percent) ? ' ' + p.percent + '% · 估算' : '') + (p.mode === 'adv' ? ' · 优势' : p.mode === 'dis' ? ' · 劣势' : '');
    } catch (e) { if (seq === predictSeq) $('prediction').textContent = e.message; }
  }, 70);
}

function requestTemplatePreview(immediate = false) {
  if (!['area', 'areaChoice'].includes(mode) || !point || !action) return;
  const myPlan = planId, seq = ++templateSeq;
  const reqPoint = {x: point.x, y: point.y}, reqAngle = mode === 'areaChoice' ? 0 : angle, resources = resourcePayload();
  actualTemplate = null;
  if (action.type === 'save') predict(null);
  clearTimeout(shapeTimer);
  const run = async () => {
    templateInFlight = seq;
    try {
      const shape = await rpc('template', {planId: myPlan, seq, key: action.key, ...resources, point: reqPoint, direction: reqAngle});
      if (myPlan === planId && seq === templateSeq) {
        actualTemplate = {...shape, aim: {point: reqPoint, direction: reqAngle}};
        if (mode === 'areaChoice') {
          selected = selected.filter(id => shape.eligible?.some(tok => tok.id === id));
          anchors = Object.fromEntries(selected.map(id => [id, anchors[id]]));
        }
        if (action.type === 'save') predict(shape.covered.find(target => target.id === hit(reqPoint)?.id)?.id || shape.covered[0]?.id);
        tell('');
        render();
      }
    } catch (e) {
      if (myPlan === planId && seq === templateSeq) {
        actualTemplate = null;
        tell(e.message, 'error');
        render();
      }
    } finally {
      if (templateInFlight === seq) templateInFlight = undefined;
    }
  };
  if (immediate) void run();
  else shapeTimer = setTimeout(run, 55);
}

function aimAt(p, immediate = false) {
  if (mode === 'target') { hover = hit(p)?.id || null; predict(hover || selected.at(-1)); }
  if (mode === 'area' || mode === 'teleport') {
    const gInfo = table.gridInfo || {type: 1, size: table.grid, distance: table.unit, ox: 0, oy: 0};
    if (mode === 'teleport') {
      teleportPoint(p, immediate);
    } else if (action.anchored) {
      if (Math.hypot(p.x - origin.x, p.y - origin.y) > 1) {
        angle = ((Math.atan2(p.y - origin.y, p.x - origin.x) * 180 / Math.PI) % 360 + 360) % 360;
      }
      point = snapTemplatePose(action.templateSpec || action, table.source, p, angle, gInfo);
    } else if (['line', 'cone'].includes(action.shape)) {
      if (gesture?.grip === 'direction' && gesture.before?.point) {
        point = {...gesture.before.point};
        if (Math.hypot(p.x - point.x, p.y - point.y) > 1) {
          angle = ((Math.atan2(p.y - point.y, p.x - point.x) * 180 / Math.PI) % 360 + 360) % 360;
        }
      } else {
        const snapped = snapTemplatePose(action.templateSpec || action, table.source, p, angle, gInfo);
        point = {x: snapped.x, y: snapped.y};
      }
    } else {
      const snapped = snapTemplatePose(action.templateSpec || action, table.source, p, angle, gInfo);
      point = {x: snapped.x, y: snapped.y};
    }
    if (mode === 'area') requestTemplatePreview(immediate);
  }
  render();
}

function handles() {
  if (!point || !action || mode !== 'area') return [];
  const base = action.anchored ? origin : (actualTemplate?.placement || point);
  const out = [];
  if (['line', 'cone'].includes(action.shape) || (action.anchored && action.shape === 'square')) {
    const r = angle * Math.PI / 180, len = Math.max(table.grid / 2, Number(action.size) * table.grid / table.unit || table.grid);
    out.push({x: base.x + len * Math.cos(r), y: base.y + len * Math.sin(r), grip: 'direction'});
  }
  return out;
}

function selectAt(p) {
  if (busy || !selectable(p)) return;
  if (!mode) {
    const t = hit(p);
    if (t) void inspectTokenAt(t);
    else closeInspection(true);
    return;
  }
  const gInfo = table.gridInfo || {type: 1, size: table.grid, distance: table.unit, ox: 0, oy: 0};
  if (mode === 'move') {
    const snapped = snapMoveCenter(p, gInfo, table.source);
    const last = points.at(-1) || origin;
    if (points.length < 40 && !sameWorld(snapped, last)) points.push(snapped);
    centerDest = null;
    lastRouteKey = moveKey(effectiveMovePoints());
    validateRoute(true);
    centerCameraOn(snapped);
  } else if (mode === 'teleport') {
    const tok = hit(p), spec = action.teleport || {};
    if (spec.movesTarget && !selected.length) {
      if (!tok || tok.id === aimSource) { tell('点击选择要传送的目标生物'); return; }
      selected = [tok.id]; anchors = {[tok.id]: {x: tok.x, y: tok.y}}; viewer.cancelAnimation();
    } else if (['swap','pointOrSwap'].includes(spec.kind) && tok && tok.id !== aimSource) {
      viewer.cancelAnimation(); swapTarget = tok.id; point = null; anchors = {[tok.id]: {x: tok.x, y: tok.y}}; previewTeleport(true);
    } else if (spec.kind === 'swap') { clearTeleport(); point = null; anchors = {}; }
    else { teleportPoint(p, true); centerCameraOn(point); }
    render();
  } else if (mode === 'areaChoice') {
    const tok = hit(p);
    if (!areaReady() || !actualTemplate.eligible.some(row => row.id === tok?.id)) { tell('目标不在可见光环内'); return; }
    if (selected.includes(tok.id)) { selected = selected.filter(id => id !== tok.id); delete anchors[tok.id]; }
    else { selected.push(tok.id); anchors[tok.id] = {x: tok.x, y: tok.y}; }
    render();
  } else if (mode === 'area') {
    if (action?.anchored) {
      aimAt(p, true);
      lastTemplateKey = tplKey(point, action.shape === 'square' ? Math.round(angle / 90) * 90 : Math.round(angle / 3) * 3);
    } else {
      const snapped = snapTemplatePose(action.templateSpec || action, table.source, p, angle, gInfo);
      point = {x: snapped.x, y: snapped.y};
      lastTemplateKey = tplKey(point, angle);
      requestTemplatePreview(true);
      centerCameraOn(point);
      render();
    }
  } else if (mode === 'target') {
    aimAt(p, true);
    const t = hit(p);
    if (t) {
      const previousCount = selected.length;
      if (action.repeat) {
        if (selected.length < selectionLimit()) selected.push(t.id);
      } else if (!action.multiPlan && selectionLimit() === 1) selected = [t.id];
      else if (selected.includes(t.id)) selected = selected.filter(id => id !== t.id);
      else if (selected.length < selectionLimit()) selected.push(t.id);
      anchors = Object.fromEntries(selected.map(id => [id, id === t.id ? {x:t.x, y:t.y} : anchors[id]]));
      if (!reducedMotion() && selected.includes(t.id) && (!action.repeat || selected.length > previousCount)) {
        targetLocks.set(t.id, performance.now());
      }
      predict(selected.includes(t.id) ? t.id : selected.at(-1), true);
    }
    hover = null;
    render();
  }
}

const mid = (a, b) => ({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function finger(e) { const r = overlay.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; }
function undoGesture() {
  if (gesture?.state === 'aim' && gesture.before) {
    point = gesture.before.point; angle = gesture.before.angle; actualTemplate = gesture.before.template;
    templateSeq++; clearTimeout(shapeTimer);
  }
  hover = null; gesture = null; render();
}
function redrawCamera(immediate = false) { localMap.draw(); syncCenterAim(immediate); render(); }

function recordPan(samples, pos, time) {
  if (!samples) return;
  while (samples.length && time - samples[0].t > 80) samples.shift();
  samples.push({x: pos.x, y: pos.y, t: time});
}

function startBrowseMomentum(samples, pr) {
  if (!samples || samples.length < 2 || reducedMotion()) return;
  const first = samples[0], last = samples.at(-1), elapsed = last.t - first.t;
  if (elapsed <= 0 || dist(first, last) / elapsed <= .35) return;
  // The inverse projection includes rotation and scale. The camera travels opposite to the finger.
  const from = pr.inverse(first.x, first.y), to = pr.inverse(last.x, last.y);
  const redraw = () => { localMap.draw(); render(); };
  cameraGoal = null;
  viewer.startMomentum({vx: (from.x - to.x) / elapsed, vy: (from.y - to.y) / elapsed},
    {duration: 220, onFrame: redraw, onDone: redraw});
}

document.addEventListener('pointerdown', event => {
  if (event.target !== overlay) viewer.cancelAnimation();
}, {capture: true, passive: true});

overlay.onpointerdown = e => {
  viewer.cancelAnimation();
  if (!table || !localMap.frame || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const pos = finger(e); fingers.set(e.pointerId, pos); overlay.setPointerCapture(e.pointerId);
  const pr = project();
  if (fingers.size >= 2) {
    closeInspection(true);
    if (fingers.size === 2) {
      undoGesture();
      const [a, b] = [...fingers.values()], m = mid(a, b);
      pinch = {start: Math.max(1, dist(a, b)), scale: viewer.zoom, anchor: pr.inverse(m.x, m.y)};
    }
    return;
  }
  const world = pr.inverse(pos.x, pos.y); let grip;
  if ((mode === 'area' || mode === 'teleport') && point) grip = handles().find(g => dist(pr.forward(g), pos) < 23)?.grip;
  if (mode === 'area' && action?.anchored && !point && dist(pr.forward(origin), pos) < 25) grip = 'direction';
  if (mode === 'target' && selectable(world) && hit(world)) grip = 'target';
  if (busy) grip = null;
  gesture = {id: e.pointerId, state: 'tap', grip, start: world, screen: pos,
    samples: mode || reducedMotion() ? null : [{...pos, t: e.timeStamp}],
    before: {point: point && {...point}, angle, template: actualTemplate}};
};

overlay.onpointermove = e => {
  if (!fingers.has(e.pointerId)) return;
  const pos = finger(e); fingers.set(e.pointerId, pos); const pr = project();
  if (pinch && fingers.size >= 2) {
    const [a, b] = [...fingers.values()];
    viewer.anchor(pinch.anchor, mid(a, b), pr.rect, pinch.scale * dist(a, b) / pinch.start);
    redrawCamera();
    return;
  }
  if (gesture?.id !== e.pointerId) return;
  if (gesture.state === 'tap' && dist(pos, gesture.screen) >= 6) {
    gesture.state = gesture.grip ? 'aim' : 'pan';
    if (gesture.state === 'pan') closeInspection(true);
  }
  if (gesture.state === 'pan') {
    recordPan(gesture.samples, pos, e.timeStamp);
    viewer.anchor(gesture.start, pos, pr.rect);
    redrawCamera();
  }
  else if (gesture.state === 'aim') { const world = pr.inverse(pos.x, pos.y); if (selectable(world)) aimAt(world, false); }
};

function releaseFinger(e, cancelled) {
  if (!fingers.has(e.pointerId)) return;
  const ending = gesture, wasPinch = !!pinch, pos = finger(e), last = fingers.get(e.pointerId);
  fingers.delete(e.pointerId);
  if (wasPinch) {
    if (fingers.size === 1) { pinch = null; const [id, p] = [...fingers][0]; gesture = {id, state: 'pan', screen: p, start: project().inverse(p.x, p.y)}; }
    else if (fingers.size === 0) { pinch = null; gesture = null; syncCenterAim(true); render(); }
    else { const [a, b] = [...fingers.values()], m = mid(a, b); pinch = {start: Math.max(1, dist(a, b)), scale: viewer.zoom, anchor: project().inverse(m.x, m.y)}; }
    return;
  }
  if (ending?.id !== e.pointerId) return;
  if (cancelled) { undoGesture(); return; }
  if (ending.state === 'tap' && dist(pos, ending.screen) >= 6) {
    ending.state = ending.grip ? 'aim' : 'pan';
    if (ending.state === 'pan') closeInspection(true);
  }
  if (ending.state === 'tap' || ending.state === 'aim') {
    const p = project().inverse(pos.x, pos.y);
    selectAt(p);
  } else if (ending.state === 'pan') {
    const pr = project();
    if (last.x !== pos.x || last.y !== pos.y) viewer.anchor(ending.start, pos, pr.rect);
    redrawCamera(true);
    if (!mode && !wasPinch && ending.samples) {
      recordPan(ending.samples, pos, e.timeStamp);
      startBrowseMomentum(ending.samples, pr);
    }
  }
  gesture = null;
}

overlay.onpointercancel = e => releaseFinger(e, true);
overlay.onlostpointercapture = e => { if (fingers.has(e.pointerId)) releaseFinger(e, true); };
overlay.onpointerup = e => releaseFinger(e, false);

async function confirmAction() {
  if (busy || !mode) return;
  const moving = mode === 'move';
  const movePts = moving ? effectiveMovePoints() : [];
  if (moving && (!movePts.length || !route || route.planId !== planId || route.seq !== checkSeq || route.reason || !route.ticket)) return;
  if ((mode === 'area' || mode === 'areaChoice') && !areaReady()) return;
  if ((mode === 'areaChoice' || mode === 'target') && !selected.length || mode === 'teleport' && !teleportReady()) return;
  if (mode === 'target' && action?.repeat && selected.length !== selectionLimit()) return;
  const channel = ch, scene = aimScene;
  busy = true; updateCombatHud(); updateDock(); render(); tell(moving ? '移动预演 · 等待电脑确认' : '正在提交…'); $('aim').disabled = true;
  if (moving) localMap.previewWalk(aimSource, route.preview);
  try {
    const body = moving
      ? {points: movePts, ticket: route.ticket}
      : {key: action.key, ...resourcePayload(), ...(damageType ? {damageType} : {}), ...(action.versatile ? {versatile} : {}),
        ...(mode === 'teleport' ? (swapTarget ? teleportInput() : {...teleportInput(), point: teleportPreviewState.snapped}) :
          {targets: selected, anchors, ...(actualTemplate?.aim ?? {point, direction: angle}), ticket: actualTemplate?.ticket || null})};
    const signature = JSON.stringify(body);
    const impacts = moving ? [movePts.at(-1)] : mode === 'target'
      ? [...new Set(body.targets)].map(id => body.anchors[id]) : [body.point || origin];
    if (commit?.signature !== signature) commit = {signature, id: uid()};
    const r = await rpc(moving ? 'move' : 'cast', body, moving ? 90000 : 120000, commit.id);
    if (ch !== channel) return;
    const start = performance.now();
    haptic('confirm');
    if (moving) {
      if (table?.source?.id === aimSource && Number.isFinite(r.position?.x) && Number.isFinite(r.position?.y)) {
        table.source = {...table.source, ...r.position};
        impacts[0] = r.position;
      }
      localMap.settleWalk(r.position);
    }
    commit = null;
    home();
    if (table?.scene === scene && !reducedMotion()) {
      const maxR = clamp((table.grid || 0) * (viewer.zoom || 1) * .7, 22, 42);
      for (const at of impacts) {
        if (Number.isFinite(at?.x) && Number.isFinite(at.y)) ripples.push({x: at.x, y: at.y, maxR, start, duration: 240});
      }
      render();
    }
    tell(r.message);
  } catch (e) {
    if (ch !== channel) return;
    if (moving) localMap.settleWalk();
    if ((mode === 'area' || mode === 'areaChoice') && /重新确认|光环/.test(e.message)) requestTemplatePreview(true);
    tell(e.message, 'error');
  } finally {
    busy = false; $('aim').disabled = false; updateCombatHud(); updateDock(); render();
  }
}

$('confirm').onclick = confirmAction;
$('undo').onclick = () => {
  if (!mode || busy) return;
  haptic('light');
  if (mode === 'target') { const id = selected.pop(); if (!selected.includes(id)) delete anchors[id]; predict(selected.at(-1)); render(); return; }
  if (mode === 'teleport') { clearTeleport(); selected = []; anchors = {}; point = null; render(); return; }
  if (points.length) points.pop();
  centerDest = null;
  const back = points.at(-1) || origin;
  lastRouteKey = moveKey(effectiveMovePoints());
  validateRoute(true);
  if (back) centerCameraOn(back);
};
$('cancelMap').onclick = () => { if (busy || !mode) return; const was = mode, from = choiceFrom; home(); if (was !== 'move' && action) choose(action, from); };
$('openMove').onclick = () => { haptic('light'); try { begin('move'); } catch (e) { tell(e.message, 'error'); } };
$('openSheet').onclick = openSheet;
$('mapCenterBtn').onclick = () => {
  haptic('light');
  if (!table?.source) return tell('当前场景没有已选中的己方棋子', 'error');
  if (mode) syncCenterAim(true, table.source);
  centerCameraOn(table.source);
};
$('mapExpandBtn').onclick = () => {
  if (!mode && table) { haptic('light'); setMapExpanded(!mapExpanded); }
};
$('backSheet').onclick = () => {
  sheetUI.closeQuickRoll();
  hideChoice();
  if (!cardFrom) return home();
  show('sheet', false); show(cardFrom, true);
  mountSettings(cardFrom === 'lobby' ? 'lobbySettingsMount' : 'pairSettingsMount');
  if (!auth) useSeat(null);
  cardFrom = ''; updateDock();
};
$('backChoice').onclick = () => { hideChoice(); if (choiceFrom === 'sheet' && !cardFrom && table) openSheet(); };
const filter = $('filter');
function syncFilter() {
  filter.closest('.deckTools').classList.toggle('searching', document.activeElement === filter || !!filter.value);
  $('filterClear').hidden = !filter.value;
}
filter.onfocus = filter.onblur = syncFilter;
filter.oninput = () => { syncFilter(); dockPages[dockGroup] = 0; dockSignature = ''; updateDock(); };
$('filterClear').onclick = () => {
  filter.value = ''; filter.focus();
  filter.dispatchEvent(new Event('input', {bubbles: true}));
};
$('aim').onclick = () => { try { begin(action.mode); if (action.mode === 'self') confirmAction(); } catch (e) { tell(e.message, 'error'); } };


new ResizeObserver(() => { render(); localMap.draw(); }).observe(map);

motionPreference.addEventListener('change', () => {
  if (!reducedMotion()) return;
  for (const el of revealTimers.keys()) setReveal(el, false, 0);
  for (const [el, {name, timer}] of pulseTimers) { clearTimeout(timer); el.classList.remove(name); }
  pulseTimers.clear();
  const goal = viewer.isAnimating() && cameraGoal;
  viewer.cancelAnimation();
  if (goal) centerCameraOn(goal, {animate: false, zoom: goal.zoom});
  clearOverlayFx();
  render();
});

installTheme(render);
installSettings(async include => {
  if (!table) {
    for (const pendingIcon of icons.values()) pendingIcon.then(u => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u); });
    icons.clear(); dockSignature = '';
  }
  if (include) {
    savingCards = false;
    show('offlineCard', !!lastCardScope());
    show('lobbyCard', !!(auth?.scope && await readCharacter(auth.scope)));
    if (!table) {
      card = null; cardTime = 0;
      sheetUI.closeQuickRoll();
      renderSheet();
      if (cardFrom) {
        show('sheet', false); show(cardFrom, true);
        mountSettings(cardFrom === 'lobby' ? 'lobbySettingsMount' : 'pairSettingsMount');
        cardFrom = '';
      }
      hideChoice();
    }
  }
  if (!$('lobby').hidden) { $('packStatus').textContent = '本机缓存已清理，可重新下载世界资源包。'; $('preload').textContent = '下载世界资源包'; }
  updateDock();
}, (_range, include) => {
  if (include) savingCards = false;
  setResourceSync(auth?.scope, false);
  downloadRun++; packWatch++; syncingPack = false; syncedPack = '';
  $('preload').disabled = !!enterStep; $('enterWorld').disabled = !!enterStep; show('packProgress', false);
}, chat);

setInterval(() => { if (mode === 'target' && !busy && (hover || selected.length)) predict(hover || selected.at(-1)); }, 1600);
try {
  const saved = JSON.parse(sessionStorage.getItem('seat'));
  if (saved?.token && saved.localOnly) lobby(saved);
  else sessionStorage.removeItem('seat');
} catch {}
if (!$('pair').hidden) animateViewEnter($('pair'));
