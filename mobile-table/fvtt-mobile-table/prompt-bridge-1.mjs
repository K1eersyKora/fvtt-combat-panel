// Desktop -> phone on join, change or close: {event: 'desktopPrompt', data: snapshot | null}.
// Snapshot: {id, revision, kind, title, subtitle, body, timer, controls, actions, canDismiss, dismissLabel}.
// timer is null or {remaining, total} in seconds. Ticks preserve revision and local edits.
// controls: {key, type, label, value, options?: [{value, label, disabled}], min?, max?, step?, disabled}.
// actions: {key, label, sublabel?, tone, disabled}. All titles and labels are plain text.
// Phone -> desktop: {id: rpcId, op: 'desktopPrompt', promptId: snapshot.id, revision,
//   actionKey: action.key | 'dismiss', values: {[control.key]: value}}. Omit unchanged controls.
// Reply: {id: rpcId, ok: true, data: {ok: true}} or {id: rpcId, ok: false, data: errorText}.
// Use opaque keys only for the shown revision. Wait for the desktop snapshot (or null)
// after replying; a successful native click may open another dialog in the same cast.
const reaction = '.midi-qol.dialog.reaction, [id$="-dialog-reaction"], #dialog-reaction';
const optional = '.midi-qol.dialog.optional, [id$="-dialog-optional"], #dialog-optional';
const resource = 'dialog.bg3-reaction-dialog, dialog.bg3-smite-dialog';
const dnd = '.activity-usage, .activity-choice, .roll-configuration';
const frames = '.application, .window-app, dialog';
const candidates = ['dialog[open]', '.application.dialog', '.window-app.dialog', '.midi-qol-dialog',
  '.cpr-dialog', reaction, optional, '.application.activity-usage', '.application.activity-choice',
  '.application.roll-configuration'].join(', ');
const excluded = ['.bg3-player-overlay', '[data-mobile-table-pair="1"]', '.sheet', '.actor-sheet', '.item-sheet',
  '.journal-sheet', '.journal-entry', '.compendium', '.settings', '.settings-config', '#settings-config',
  '#client-settings', '#game-settings', '#sidebar', '.sidebar-popout', '.chat-popout', '#combat',
  '#combat-tracker', '#chat', '#hud', '#dsh-bg3-hud', '#dsh-cp-root'].join(', ');
const privateParts = '[hidden], [inert], [aria-hidden="true"], .secret:not(.revealed), .gm-only, .midi-qol-gm-only, [data-visibility="gm"]';
const fields = 'select:not([multiple]), input:is([type="radio"], [type="checkbox"], [type="number"], [type="text"], :not([type]))';
const buttons = 'button, input[type="button"], input[type="submit"], a.dialog-button';
const closeButton = '.window-header [data-action="close"], .window-header .close, [data-action="close"]';
const clean = value => (value || '').replace(/\s+/g, ' ').trim();
const disabled = el => el.matches(':disabled, [readonly]') || !!el.closest('[aria-disabled="true"]');

function visible(el) {
  return !!el?.isConnected && !el.closest(privateParts) && el.checkVisibility({opacityProperty: true, visibilityProperty: true});
}

// Read rendered text nodes in-place. innerText on a hidden element falls back
// to textContent and can include hidden rolls, inactive tabs or secret notes.
function words(el, omit = '', limit = 300) {
  if (!el || !visible(el)) return '';
  const skip = [privateParts, excluded, 'script, style, template, select, textarea', omit].filter(Boolean).join(', ');
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts = [];
  let node, length = 0;
  while ((node = walker.nextNode()) && length < limit) {
    const parent = node.parentElement;
    if (!node.textContent.trim() || parent.closest(skip) || !visible(parent)) continue;
    parts.push(node.textContent.trim());
    length += parts.at(-1).length;
  }
  return clean(parts.join(' ')).slice(0, limit);
}

function titleNode(root) {
  return [...root.querySelectorAll('.window-title, h1, h2, h3')].find(visible);
}

function topRoot() {
  if (!globalThis.game?.user || game.user.isGM) return null;
  // A native modal makes every underlying window inert, including when the
  // modal is itself excluded (e.g. a BG3 check).
  const modals = [...document.querySelectorAll('dialog:modal')];
  let modal = document.activeElement?.closest('dialog:modal');
  if (!modal && modals.length) {
    const rect = modals.at(-1).getBoundingClientRect();
    modal = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('dialog:modal');
    modal ??= modals.at(-1);
  }
  const roots = new Set();
  for (const part of document.querySelectorAll(candidates)) {
    const root = part.closest(frames) ?? part;
    if (modal && modal !== root) continue;
    if (!visible(root)) continue;
    // Dialog5e renders some <dialog> windows as ordinary ApplicationV2
    // frames. Their native open flag stays false even with a visible form.
    if (root.matches('dialog:not([open])') && !(root.matches('.application:is(' + dnd + ')')
        && globalThis.foundry?.applications?.instances?.get(root.id)?.element === root)) continue;
    if (root.matches('.minimized, .minimizing, .closing')) continue;
    roots.add(root);
  }
  // Foundry raises non-modal windows with z-index. DOM order breaks ties.
  const ordered = [...roots].sort((a,b) => (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0)
    || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1));
  for (const root of ordered) {
    if (root.closest(excluded) || root.querySelector('.bg3-player-overlay, [data-mobile-table-pair="1"]')
        || /^手机配对\s*·/.test(words(titleNode(root)))) return null;
    if (root.querySelector('input[type="password"]')) return null;
    if ([...root.querySelectorAll(buttons + ', ' + fields)].some(el => !el.closest('.window-header') && visible(el))) return root;
  }
  return null;
}

function kindOf(root) {
  if (root.matches(resource)) return 'reactionResource';
  if (root.matches(reaction) || root.querySelector(reaction)) return 'reaction';
  if (root.matches('.cpr-dialog') || root.querySelector('.cpr-dialog')) return 'cpr';
  if (root.matches(dnd + ', .dnd5e, .dnd5e2')) return 'dnd5e';
  return 'dialog';
}

function labelFor(el, root) {
  const explicit = [...(el.labels ?? [])].find(label => root.contains(label) && visible(label));
  const group = el.closest('.form-group')?.querySelector('label');
  return words(explicit) || clean(el.getAttribute('aria-label')) || words(group) || clean(el.placeholder || el.name);
}

function optionVisible(option) {
  const group = option.closest('optgroup');
  return !option.closest(privateParts) && getComputedStyle(option).display !== 'none'
    && getComputedStyle(option).visibility !== 'hidden' && (!group || getComputedStyle(group).display !== 'none');
}

// CPR can replace its whole form and dnd5e can replace individual parts.
// Preserve keys only for unambiguous named controls and actions.
function formKeys(root, state, nodeKey) {
  const identities = new Map(), seen = new Set(), repeated = new Set();
  for (const el of root.querySelectorAll(fields + ', ' + buttons)) {
    if (!visible(el) || !(el.id || el.name || el.dataset.action)) continue;
    const identity = JSON.stringify([el.tagName, el.type, el.id, el.name, el.dataset.action,
      el.dataset.activityId, el.type === 'radio' ? el.value : null]);
    identities.set(el, identity);
    if (seen.has(identity)) repeated.add(identity);
    seen.add(identity);
  }
  return el => {
    const identity = identities.get(el);
    if (!identity || repeated.has(identity)) return nodeKey(el);
    if (!state.keys.has(identity)) state.keys.set(identity, nodeKey(el));
    return state.keys.get(identity);
  };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const changeSettleMs = 50;
const renderTimeoutMs = 5000;

async function applyChange(root, change) {
  const instance = foundry.applications?.instances?.get(root.id);
  const app = instance?.element === root ? instance : null;
  const rendering = foundry.applications?.api?.ApplicationV2?.RENDER_STATES?.RENDERING;
  const render = app?.render, ownRender = app && Object.getOwnPropertyDescriptor(app, 'render');
  const pending = new Set();
  let failed = false;

  // ApplicationV2 stays RENDERED while preparing context, and marks the DOM
  // RENDERED before its async render hooks finish. Track the actual render promise.
  function trackRender(...args) {
    let result;
    try { result = render.apply(this, args); }
    catch (error) { failed = true; throw error; }
    const completion = Promise.resolve(result);
    pending.add(completion);
    completion.then(() => pending.delete(completion), () => { failed = true; pending.delete(completion); });
    return result;
  }
  const trackable = typeof render === 'function' && (ownRender ? ownRender.configurable : Object.isExtensible(app));
  if (trackable) Object.defineProperty(app, 'render', {configurable:true, writable:true, value:trackRender});
  try {
    change();
    // Allow form submit handlers, microtasks and a deferred frame to run. A
    // plain input or a synchronous DOM update can complete without any render.
    const deadline = performance.now() + renderTimeoutMs;
    await wait(changeSettleMs);
    while (root.isConnected && !failed && (pending.size || (rendering != null && app?.state === rendering))) {
      if (performance.now() >= deadline) throw Error('桌面表单仍在更新，请重新确认');
      await wait(16);
    }
    if (failed) throw Error('桌面表单更新失败，请重新确认');
  } finally {
    if (trackable && app.render === trackRender) {
      if (ownRender) Object.defineProperty(app, 'render', ownRender);
      else delete app.render;
    }
  }
}

function readFields(root, keyFor) {
  const bindings = new Map();
  const radios = new Map();
  for (const el of root.querySelectorAll(fields)) {
    if (!visible(el) || el.closest(excluded) || el.closest('multi-select, file-picker')) continue;
    const type = el.tagName === 'SELECT' ? 'select' : el.type;
    const label = labelFor(el, root);
    if (type === 'radio') {
      const group = el.name && radios.get(el.form)?.get(el.name);
      if (group) { group.push(el); continue; }
    }
    const key = keyFor(el), nodes = [el];
    const view = {key, type, label, value: type === 'checkbox' ? el.checked : el.value, disabled: disabled(el)};
    bindings.set(key, {view, nodes});
    if (type === 'radio' && el.name) {
      if (!radios.has(el.form)) radios.set(el.form, new Map());
      radios.get(el.form).set(el.name, nodes);
    }
    if (type === 'select') {
      view.options = [...el.options].filter(optionVisible).map(o => ({value:o.value, label:clean(o.label), disabled:disabled(o)}));
      if (!view.options.some(o => o.value === view.value)) view.value = '';
    } else if (type === 'number') {
      if (Number.isFinite(el.valueAsNumber)) view.value = el.valueAsNumber;
      for (const attr of ['min', 'max', 'step']) if (el[attr] && Number.isFinite(Number(el[attr]))) view[attr] = Number(el[attr]);
    }
  }
  for (const {view, nodes} of bindings.values()) {
    if (view.type !== 'radio') continue;
    const first = nodes[0];
    view.label = words(first.closest('fieldset')?.querySelector('legend')) || first.name || '选择';
    view.value = nodes.find(n => n.checked)?.value ?? '';
    view.disabled = nodes.every(disabled);
    view.options = nodes.map(n => ({value:n.value, label:labelFor(n, root) || n.value, disabled:disabled(n)}));
  }
  return bindings;
}

function readActions(root, keyFor, kind) {
  const actions = new Map();
  for (const el of root.querySelectorAll(buttons)) {
    if (el.closest(excluded) || el.closest('.window-header, .controls-dropdown, file-picker, multi-select') || el.matches('[data-action="close"]') || !visible(el)) continue;
    const detailSelector = 'small, .subtitle, .sublabel, .hint';
    let sublabel = words(el.querySelector(detailSelector));
    let label = words(el, detailSelector) || clean(el.getAttribute('aria-label') || el.title || el.value);
    if (!label) continue;
    if (kind === 'reaction' && el.dataset.button) {
      const data = foundry.applications.instances.get(root.id)?.data;
      const uuid = data?.buttons?.[el.dataset.button]?.key;
      const a = uuid && data.activities?.find(activity => activity.uuid === uuid);
      const meta = a?.item.flags?.['fvtt-mobile-table']?.freeReaction;
      if (meta) {
        label = a.item.name;
        sublabel = [a.name, a.actor.items.get(meta.sourceId)?.name].filter(Boolean).join(' · ');
      }
    }
    if (kind === 'reaction' && !sublabel) {
      const parts = /^(.+?)[:：]\s*(.+)$/.exec(label);
      if (parts) { label = parts[1].trim(); sublabel = parts[2].trim(); }
    }
    const key = keyFor(el);
    const tone = el.matches('.danger, [data-choice="cancel"], [data-action="no"], [data-button="no"]') ? 'danger'
      : el.matches('.default, .primary, [type="submit"], [data-action="yes"]') ? 'primary' : 'neutral';
    actions.set(key, {el, view:{key, label, ...(sublabel && {sublabel}), tone, disabled:disabled(el)}});
  }
  return actions;
}

function prepareValue(binding, value) {
  if (!binding) throw Error('桌面表单选项已更新');
  const {view, nodes} = binding;
  let el = nodes[0];
  if (view.value === value || (view.type === 'number' && String(view.value) === value)) return null;
  if (view.disabled) throw Error('桌面表单选项已禁用');
  if (view.options) {
    if (!view.options.some(o => o.value === value && !o.disabled)) throw Error('该选项已不可用');
    if (view.type === 'radio') el = nodes.find(n => n.value === value && !disabled(n));
  } else if (view.type === 'checkbox') {
    if (typeof value !== 'boolean') throw Error('复选框需要布尔值');
  } else {
    if (typeof value !== 'string' && !(view.type === 'number' && Number.isFinite(value))) throw Error('输入值无效');
    const probe = el.cloneNode();
    probe.value = String(value);
    if (probe.value !== String(value) || !probe.checkValidity() || (el.maxLength >= 0 && probe.value.length > el.maxLength)) throw Error('输入值不符合桌面表单要求');
  }
  return () => {
    if (!visible(el) || disabled(el)) throw Error('表单已变化，请重新确认');
    if (view.type === 'checkbox' || view.type === 'radio') el.checked = view.type === 'radio' || value;
    else el.value = String(value);
    el.dispatchEvent(new Event('input', {bubbles:true, composed:true}));
    if (el.isConnected) el.dispatchEvent(new Event('change', {bubbles:true}));
  };
}

export class PlayerPromptBridge {
  #keys = new WeakMap();
  #key = el => {
    if (!this.#keys.has(el)) this.#keys.set(el, foundry.utils.randomID());
    return this.#keys.get(el);
  };
  #timers = new WeakMap();
  #active;
  #observer;
  #timeout;
  #notify;
  #desktopInput = event => {
    const state = this.#active;
    if (!state?.root.contains(event.target) || !event.isTrusted) return;
    if (state.busy) state.interrupted = true;
    const button = event.type === 'click' && event.target.closest(buttons + ', ' + closeButton);
    if (!button) return;
    const prompt = this.#read();
    if (prompt?.state !== state || (prompt.close !== button && ![...prompt.buttons.values()].some(b => b.el === button))) return;
    if (button.type === 'submit' && !button.formNoValidate && !button.form?.noValidate && button.form?.matches(':invalid')) return;
    state.submitted = state.revision;
  };

  #read() {
    const root = topRoot();
    if (!root) { this.#active = null; return null; }
    if (this.#active?.root !== root) this.#active = {root, id:foundry.utils.randomID(), revision:0, keys:new Map()};
    const state = this.#active, kind = kindOf(root);
    const header = titleNode(root);
    let title = words(header) || clean(root.getAttribute('aria-label')) || '玩家确认';
    let timer = null;
    const timed = kind === 'reaction' || root.matches(optional) || root.querySelector(optional);
    const app = timed && foundry.applications?.instances?.get(root.id);
    const duration = app?.element === root && Number(app.data?.timeout);
    const match = timed && (/\s+-+\s*(\d+)\s*$/.exec(title) || ((duration || this.#timers.has(root)) && /\s+(0)\s*$/.exec(title)));
    if (match) {
      const remaining = Number(match[1]), total = Math.max(remaining, duration || 0, this.#timers.get(root) || 0);
      this.#timers.set(root, total);
      title = title.slice(0, match.index).trim();
      timer = {remaining, total};
    }
    const keyFor = ['cpr', 'dnd5e'].includes(kind) ? formKeys(root, state, this.#key) : this.#key;
    const bindings = readFields(root, keyFor);
    const buttons = readActions(root, keyFor, kind);
    const close = [...root.querySelectorAll(closeButton)].find(visible)
      ?? [...root.querySelectorAll('[data-choice="cancel"], [data-action="cancel"], [data-button="cancel"], [data-button="no"], [data-no], [data-close]')].find(visible);
    const subtitle = words(root.querySelector('.window-subtitle, .dialog-subtitle, .subtitle'));
    const body = words(root.querySelector('.window-content') ?? root,
      '.window-header, h1, h2, h3, .subtitle, label, footer, button, .dialog-buttons, .form-footer', 2600);
    const view = {id:state.id, revision:0, kind, title, subtitle, body, timer:null,
      controls:[...bindings.values()].map(b => b.view), actions:[...buttons.values()].map(b => b.view),
      canDismiss:close ? !disabled(close) : root.matches('dialog[open]'),
      dismissLabel:kind === 'reaction' ? '不使用反应' : '关闭'};
    const signature = JSON.stringify(view);
    if (state.signature !== signature) { state.signature = signature; state.revision++; }
    view.revision = state.revision;
    view.timer = timer;
    return {state, view, bindings, buttons, close};
  }

  snapshot() {
    const state = this.#active;
    // Avoid publishing the intermediate field values while a phone submission
    // is applying a series of changes to the same native form.
    if (state?.busy && topRoot() === state.root) return state.submitting;
    return this.#read()?.view ?? null;
  }

  async respond({promptId, revision, actionKey, values = {}}) {
    let prompt = this.#read();
    if (!prompt || prompt.state.id !== promptId) throw Error('桌面弹窗已关闭或切换');
    const {state, view, bindings, buttons, close} = prompt;
    if (revision !== state.revision) throw Error('桌面弹窗已更新，请重新确认');
    if (state.busy || state.submitted === revision) throw Error('此弹窗操作已提交');
    const dismiss = actionKey === 'dismiss', button = dismiss ? close : buttons.get(actionKey)?.el;
    if (dismiss ? !view.canDismiss : !button || disabled(button)) throw Error('该弹窗操作已不可用');
    if (!values || Array.isArray(values) || typeof values !== 'object') throw Error('弹窗参数无效');
    const changes = dismiss ? [] : Object.entries(values).filter(([key, value]) => prepareValue(bindings.get(key), value));
    state.busy = true;
    state.submitting = view;
    state.interrupted = false;
    try {
      for (const [key, value] of changes) {
        const binding = prompt.bindings.get(key);
        if (binding?.view.label !== bindings.get(key).view.label) throw Error('表单选项已变化，请重新确认');
        const change = prepareValue(binding, value);
        if (change) await applyChange(state.root, change);
        prompt = this.#read();
        if (prompt?.state !== state || state.interrupted) throw Error('桌面弹窗已切换或已由玩家操作');
      }
      for (const [key, value] of changes) {
        const binding = prompt.bindings.get(key);
        if (binding?.view.label !== bindings.get(key).view.label || prepareValue(binding, value)) {
          throw Error('桌面表单的取值已变化，请重新确认');
        }
      }
      const action = prompt.buttons.get(actionKey);
      const live = dismiss ? prompt.close : action?.el;
      if ((dismiss ? !prompt.view.canDismiss : !live || action.view.label !== buttons.get(actionKey)?.view.label)
          || (live && (!state.root.contains(live) || disabled(live) || !visible(live)))) throw Error('桌面弹窗已变化，请重新确认');
      if (!dismiss && live.type === 'submit' && live.form && !live.formNoValidate && !live.form.noValidate && !live.form.checkValidity()) throw Error('请检查桌面表单的必填项和取值');
      state.submitted = state.revision;
      if (live) live.click();
      else state.root.close();
      return {ok:true};
    } finally { state.busy = false; state.submitting = null; }
  }

  observe(onChange) {
    this.close();
    if (!globalThis.game?.user || game.user.isGM) return;
    this.#notify = () => {
      if (!this.#timeout) this.#timeout = setTimeout(() => { this.#timeout = null; onChange(); }, 40);
    };
    this.#observer = new MutationObserver(records => {
      for (const record of records) {
        const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        if (this.#active?.root.contains(target) || target?.matches(frames) || target?.closest(candidates)
            || [...record.addedNodes, ...record.removedNodes].some(node => node.matches?.(candidates) || node.querySelector?.(candidates))) {
          this.#notify();
          return;
        }
      }
    });
    this.#observer.observe(document.body, {childList:true, subtree:true, characterData:true, attributes:true});
    for (const event of ['change', 'input']) document.body.addEventListener(event, this.#notify, true);
    for (const event of ['click', 'input', 'change']) document.body.addEventListener(event, this.#desktopInput, true);
  }

  close() {
    this.#observer?.disconnect();
    if (this.#notify) for (const event of ['change', 'input']) document.body.removeEventListener(event, this.#notify, true);
    for (const event of ['click', 'input', 'change']) document.body.removeEventListener(event, this.#desktopInput, true);
    clearTimeout(this.#timeout);
    this.#timeout = this.#observer = this.#notify = this.#active = null;
  }
}
