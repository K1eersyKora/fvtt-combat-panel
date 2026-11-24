import {displayIcon} from './game-14.mjs';

// Mirror the sidebar after Foundry, the system and other modules have rendered it for this PL.
// A hidden tab still has a log. innerText on a hidden ancestor can expose collapsed content.
const historySize = 60;
const diceBreakdown = '.dice-tooltip, .dice-tooltip-collapser, .midi-dice-tooltip';
const privateContent = '[hidden], [aria-hidden="true"], .secret:not(.revealed), [data-visibility="gm"], .gm-only, .midi-qol-gm-only, '
  + '.midi-qol-gmTokenName, .midi-qol-tooltiptext, .secret-roll, .card-header[data-concealed] .details, script, style, template, iframe, object';
const collapsedContent = '.collapsible.collapsed .collapsible-content';
const collapsedTargets = '.targets-tray.collapsed > .collapsible-content';
const midiArmor = '.midi-qol-npc-ac, .midi-qol-npc-target .midi-qol-ac';
const rollSummary = '.dice-formula, .dice-total';
function hidden(element, allowCollapsed = false) {
  if (element.matches(privateContent) || (!allowCollapsed && element.matches(collapsedContent))) return true;
  // Midi-QOL sets an explicit size of zero on dice breakdowns hidden from players.
  if (allowCollapsed && (element.style?.display === 'none' || element.style?.height === '0px' || element.style?.maxHeight === '0px')) return true;
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return true;
  return !allowCollapsed && (style.display === 'none' || (style.maxHeight === '0px' && style.overflowY === 'hidden'));
}
function displayed(root, row) {
  for (let node = root; node && node !== row; node = node.parentElement) if (hidden(node)) return false;
  return !!root;
}
// Send semantic elements, never the desktop HTML, document UUIDs, links or event handlers.
const richTags = new Set('p div section span br strong b em i u s sup sub blockquote ul ol li h1 h2 h3 h4 h5 h6 table thead tbody tr td th hr pre code'.split(' '));
const cardClasses = new Set(('dice-roll dice-result dice-formula dice-total dice-tooltip dice-tooltip-collapser midi-dice-tooltip dice-rolls dice roll '
  + 'part-header part-formula part-total part-flavor tooltip-part total label value constant sign dice-flavor '
  + 'critical success failure fumble discarded ignored exploded rerolled min max d4 d6 d8 d10 d12 d20 d100 expanded inline-roll content-link '
  + 'chat-card midi-chat-card activation-card card-header summary name-stacked title subtitle gold-icon card-content card-footer pills pill supplement '
  + 'midi-results midi-qol-attack-roll midi-qol-damage-roll midi-qol-other-damage-roll midi-qol-bonus-damage-roll midi-qol-utility-roll '
  + 'midi-qol-hits-display midi-qol-saves-display midi-qol-single-hit-card midi-qol-player-damage-card midi-attack-roll midi-damage-roll midi-dice-roll '
  + 'midi-other-damage-roll midi-bonus-damage-roll midi-bonus-damage-flavor midi-utility-roll '
  + 'flexrow evaluation target hit miss name ac midi-qol-target-name midi-qol-playerTokenName midi-qol-ac midi-qol-hit-symbol midi-qol-save-total midi-qol-npc-save-total '
  + 'description details collapsible collapsible-content wrapper card-tray targets-tray').split(' '));
// Midi-QOL can place the result and footer inside .card-buttons.
const desktopControls = 'button, select, input, textarea, .chat-controls, .midi-qol-attack-buttons, .midi-qol-damage-buttons, '
  + '.midi-dnd5e-buttons, .midi-qol-confirm-damage-roll, damage-application, midi-damage-application';
const structuredCard = '.chat-card, .midi-chat-card, .midi-results, .dice-roll, .card-header, .evaluation, '
  + '.targets-tray, .midi-qol-hits-display, .midi-qol-single-hit-card, .midi-qol-saves-display, .midi-qol-player-damage-card';
const blockTags = new Set('p div section header ul ol li table thead tbody tr td th h1 h2 h3 h4 h5 h6 blockquote pre br hr'.split(' '));
const statusIcons = new Map([
  ['fa-check', '✓'], ['fa-tick', '✓'], ['fa-check-double', '✓✓'],
  ['fa-times', '✕'], ['fa-xmark', '✕'],
  ['fa-shield-halved', '🛡'], ['fa-shield', '🛡'], ['fa-bullseye', '◎']
]);
function readField(row, selector, image, policy) {
  const root = row.querySelector(selector);
  if (!displayed(root, row) || root.closest('.chat-controls, button')) return {nodes: [], text: ''};
  const pieces = [];
  let remaining = 8000, elements = 0, truncated = false, blockBreak = false;
  function append(value) {
    if (blockBreak && pieces.length && !pieces.at(-1).endsWith('\n') && !value.startsWith('\n')) pieces.push('\n');
    blockBreak = false;
    pieces.push(value);
  }
  function text(value) {
    if (value.length > remaining) { value = value.slice(0, remaining); truncated = true; }
    remaining -= value.length;
    if (value) append(value);
    return value;
  }
  function read(node, depth, whitespace) {
    if (!remaining || elements >= 700 || depth > 30) { truncated = true; return null; }
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue;
      if (whitespace === 'pre') return text(value);
      const card = whitespace === 'card';
      if (/^[ \t\r\n\f]+$/.test(value) && (card || /[\r\n]/.test(value))) {
        const before = node.previousSibling, after = node.nextSibling;
        if (card && (!before || !after || blockTags.has(before.localName) || blockTags.has(after.localName))) return null;
        if (before?.matches?.(structuredCard) || after?.matches?.(structuredCard)) return null;
      }
      return text(card ? value.replace(/[ \t\r\n\f]+/g, ' ') : value);
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.matches(desktopControls)) return null;
    const tag = node.localName;
    if (tag === 'svg' || tag === 'canvas') return null;
    if (policy?.maskedArmor && node.matches(policy.maskedArmor)) return null;
    const tooltip = node.matches(diceBreakdown);
    const roll = tooltip ? node.parentElement?.closest('.dice-roll') : null;
    if (tooltip && (!policy || !roll || policy.hideDiceDetails)) return null;
    // Players can open these sections on desktop. Only bypass CSS collapse for
    // these containers, with privacy markers and inline masks still in effect.
    if (hidden(node, !!roll || !!policy && node.matches(collapsedTargets))) return null;
    elements++;
    const classes = [...node.classList].filter(c => cardClasses.has(c));
    if (tag === 'i' && !node.closest(rollSummary)) {
      const symbol = [...node.classList].find(name => statusIcons.has(name));
      if (symbol) return ['span', classes, [text(statusIcons.get(symbol))]];
    }
    if (tag === 'img') {
      if (node.closest(rollSummary)) return null;
      const alt = node.alt || '〔图片〕', key = image?.(node.currentSrc || node.getAttribute('src'));
      if (!key && !image) return null;
      text(alt); return ['img', classes, alt.slice(0, 160), key || ''];
    }
    if (tag === 'br' || tag === 'hr') { append('\n'); return [tag, [], []]; }
    if (tag === 'video' || tag === 'audio') return text(tag === 'video' ? '〔视频〕' : '〔音频〕');
    const cell = tag === 'td' || tag === 'th';
    const damageSummary = cell && node.closest('.midi-qol-player-damage-card');
    if (damageSummary && tag === 'th' && node.cellIndex > 0) return null;
    const block = blockTags.has(tag);
    if (block) blockBreak = true;
    const children = [];
    const source = node.matches('details:not([open])') ? [node.querySelector(':scope > summary')] : node.childNodes;
    const childWhitespace = tag === 'pre' ? 'pre' : whitespace || (node.matches(structuredCard) ? 'card' : '');
    for (const child of source) {
      if (!child) continue;
      const part = read(child, depth + 1, childWhitespace); if (part !== null && part !== '') children.push(part);
      if (truncated) break;
    }
    if (block) blockBreak = true;
    if (!children.length && (!cell || damageSummary && node.cellIndex > 0)) return null;
    const safeTag = richTags.has(tag) ? tag : block ? 'div' : 'span';
    if (cell && !damageSummary && node.colSpan > 1) return [safeTag, classes, children, node.colSpan];
    return [safeTag, classes, children];
  }
  const nodes = [];
  const rootWhitespace = root.matches(structuredCard) ? 'card' : '';
  for (const child of root.childNodes) {
    const part = read(child, 0, rootWhitespace);
    if (part !== null) nodes.push(part);
    if (truncated) break;
  }
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
  if (truncated) { nodes.push('…'); append('…'); }
  return {nodes, text: pieces.join('').trim()};
}
function readRow(row, message, image, allowed, policy) {
  const name = row.querySelector('.message-sender .name-stacked .title') ? '.message-sender .name-stacked .title' : '.message-sender';
  const sender = readField(row, name).text;
  const subtitle = readField(row, '.message-sender .name-stacked .subtitle').text;
  const portrait = row.querySelector('.message-sender .avatar img,.message-header img.avatar,.message-sender img');
  let src = displayed(portrait, row) ? portrait.currentSrc || portrait.getAttribute('src') : '';
  if (!portrait && allowed) {
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
  if (!allowed) {
    const author = message.author;
    const matches = src && author?.avatar && portrait?.getAttribute('src') === author.avatar;
    return {...data, sender: sender === author?.name ? sender : '', subtitle: '', edge: '', avatar: matches ? image(author.avatar) : '', body: '私密掷骰'};
  }
  data.avatar = image(src);
  const flavor = readField(row, '.flavor-text', image, policy), body = readField(row, '.message-content', image, policy);
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
    this.observer = new MutationObserver(changes => this.invalidate(changes));
  }
  invalidate(changes) {
    for (const {target, type} of changes) {
      const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
      const row = element?.closest('[data-message-id]');
      if (row) this.cache.delete(row);
      else if (target === this.log && type === 'attributes') this.cache = new WeakMap();
    }
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
      }, () => { asset.state = 'failed'; }).finally(() => { this.loading--; });
    }
    return images;
  }
  sync() {
    const log = ui.chat?.element?.querySelector('.chat-log');
    if (log !== this.log || this.previous === null) {
      this.observer.disconnect(); this.log = log; this.cache = new WeakMap();
      if (log) this.observer.observe(log, {subtree: true, childList: true, characterData: true, attributes: true});
    } else this.invalidate(this.observer.takeRecords());
    const midi = globalThis.MidiQOL?.configSettings?.();
    const showArmor = game.settings?.get?.('dnd5e', 'attackRollVisibility') === 'all';
    const maskedArmor = [!showArmor && '.target .ac', (!showArmor || midi && midi.autoCheckHit !== 'all') && midiArmor].filter(Boolean).join(', ');
    const next = new Map(), needed = new Set();
    for (let row = log?.lastElementChild; row && next.size < historySize; row = row.previousElementSibling) {
      const message = game.messages.get(row.dataset.messageId);
      if (!message?.visible || hidden(row)) continue;
      const flags = message.flags?.['midi-qol'];
      if (flags?.undoDamage && !flags.playerDamageCard) continue;
      const allowed = message.isContentVisible && !message.blind;
      const hideDiceDetails = !!(message.author?.isGM && flags?.messageType && midi?.hideRollDetails && midi.hideRollDetails !== 'none');
      const privacy = JSON.stringify([allowed, maskedArmor, hideDiceDetails]);
      let cached = this.cache.get(row);
      if (!cached || cached.privacy !== privacy) {
        const used = new Set();
        cached = {privacy, data: readRow(row, message, src => this.image(src, used), allowed, {maskedArmor, hideDiceDetails}), used};
        this.cache.set(row, cached);
      }
      for (const asset of cached.used) needed.add(asset);
      next.set(message.id, cached.data);
    }
    const order = [...next.keys()].reverse();
    const rows = order.filter(id => next.get(id) !== this.previous?.get(id)
      && JSON.stringify(next.get(id)) !== JSON.stringify(this.previous?.get(id))).map(id => next.get(id));
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
