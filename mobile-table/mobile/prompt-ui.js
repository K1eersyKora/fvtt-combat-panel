const byId = id => document.getElementById(id);
const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

export function installPromptUI(send, hooks = {}) {
  const dialog = byId('desktopPrompt'), pill = byId('desktopPromptResume'), dismiss = byId('desktopPromptDismiss');
  const fields = byId('desktopPromptControls'), actions = byId('desktopPromptActions'), notice = byId('desktopPromptNotice');
  const progress = byId('desktopPromptProgress'), timerText = byId('desktopPromptTimer');
  let current, values = new Map(), deferred = false, request, frame, timerEnd, lastSeconds;
  function timer(timer) {
    cancelAnimationFrame(frame);
    byId('desktopPromptTimerWrap').hidden = !timer;
    if (!timer) { timerEnd = lastSeconds = undefined; return; }
    const now = performance.now();
    if (timer.remaining !== lastSeconds) timerEnd = now + timer.remaining * 1000;
    lastSeconds = timer.remaining;
    function tick() {
      const remaining = Math.max(0, (timerEnd - performance.now()) / 1000);
      progress.value = Math.min(1, remaining / Math.max(1, timer.total));
      timerText.textContent = '剩余 ' + Math.ceil(remaining) + ' 秒';
      if (remaining && !deferred) frame = requestAnimationFrame(tick);
    }
    tick();
  }
  function visibility() {
    pill.hidden = !current || !deferred;
    if (current && !deferred) { if (!dialog.open) dialog.showModal(); }
    else if (dialog.open) dialog.close();
  }
  function defer() { deferred = true; visibility(); cancelAnimationFrame(frame); }
  byId('desktopPromptDefer').onclick = defer;
  dialog.oncancel = event => { event.preventDefault(); defer(); };
  pill.onclick = () => { deferred = false; visibility(); timer(current?.timer); };
  function drawFields(previous) {
    const next = new Map(); fields.replaceChildren(); fields.hidden = !current.controls.length;
    for (const control of current.controls) {
      const {key, type} = control, old = previous?.controls.find(c => c.key === key && c.type === type);
      let value = old && !control.disabled && values.has(key) && old.value !== values.get(key) ? values.get(key) : control.value;
      if (control.options && !control.options.some(o => !o.disabled && o.value === value)) value = control.value;
      const check = type === 'checkbox', radio = type === 'radio';
      const row = make(radio ? 'div' : 'label', check ? 'checkRow promptCheck' : 'promptField');
      const label = make('span', '', control.label);
      const input = make(radio ? 'div' : type === 'select' ? 'select' : 'input');
      if (radio) {
        input.className = 'promptRadioGroup'; input.setAttribute('role', 'group'); input.setAttribute('aria-label', control.label);
        for (const option of control.options) {
          const btn = make('button', '', option.label); btn.type = 'button'; btn.disabled = control.disabled || option.disabled;
          btn.setAttribute('aria-pressed', String(option.value === value));
          btn.onclick = () => { values.set(key, option.value); for (const other of input.children) other.setAttribute('aria-pressed', String(other === btn)); };
          input.append(btn);
        }
      } else {
        if (type === 'select') for (const option of control.options) {
          const el = make('option', '', option.label); el.value = option.value; el.disabled = option.disabled; input.append(el);
        } else input.type = type;
        if (type === 'number') for (const attr of ['min','max','step']) if (control[attr] != null) input[attr] = control[attr];
        if (check) input.checked = value;
        else { input.value = value; if (type === 'number' && !input.validity.valid) input.value = value = control.value; }
        input.disabled = control.disabled;
        input.oninput = input.onchange = () => values.set(key, check ? input.checked : type === 'number' && Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : input.value);
      }
      next.set(key, value);
      if (check) row.append(input, label); else row.append(label, input);
      fields.append(row);
    }
    values = next;
  }
  function lock(on) {
    fields.inert = on;
    for (const [index, button] of Array.from(actions.children).entries()) button.disabled = on || current.actions[index].disabled;
    dismiss.disabled = on;
  }
  function clearNotice() { notice.dataset.tone = ''; notice.textContent = ''; }
  async function submit(actionKey) {
    if (request || !current) return;
    if (actionKey !== 'dismiss' && [...fields.querySelectorAll('input, select')].some(el => !el.reportValidity())) return;
    const pending = request = {revision: current.revision, acknowledged: false}, changes = Object.create(null);
    if (actionKey !== 'dismiss') for (const c of current.controls) if (!c.disabled && values.get(c.key) !== c.value) changes[c.key] = values.get(c.key);
    lock(true); notice.dataset.tone = ''; notice.textContent = '正在提交…';
    try {
      await send({promptId: current.id, revision: current.revision, actionKey, values: changes});
      if (request !== pending) return;
      pending.acknowledged = true;
      if (current.revision === pending.revision) notice.textContent = '已提交，等待桌面更新';
      else { request = null; lock(false); clearNotice(); }
    } catch (error) {
      if (request === pending) { request = null; lock(false); notice.dataset.tone = 'error'; notice.textContent = error.message || '提交失败，请重试'; }
    }
  }
  dismiss.onclick = () => submit('dismiss');
  return view => {
    const previous = current, same = !!view && view.id === previous?.id;
    current = view;
    if (same && view.revision === previous.revision) { timer(view.timer); return; }
    if (!same || request?.acknowledged) { request = null; clearNotice(); }
    if (!same) { deferred = false; values.clear(); lastSeconds = undefined; }
    timer(view?.timer);
    if (!view) {
      fields.replaceChildren(); actions.replaceChildren(); lock(false);
      delete dialog.dataset.kind; delete pill.dataset.kind;
      visibility(); return;
    }
    const reaction = view.kind === 'reaction' || view.kind === 'reactionResource';
    dialog.dataset.kind = pill.dataset.kind = reaction ? 'reaction' : view.kind;
    if (!same) hooks.onHaptic?.(reaction ? 'confirm' : 'light');
    byId('desktopPromptKind').textContent = ({reaction:'反应', reactionResource:'资源选择', cpr:'能力提示', dnd5e:'角色操作'})[view.kind] || '提示';
    byId('desktopPromptTitle').textContent = view.title || '玩家确认';
    for (const [el, text] of [[byId('desktopPromptSubtitle'), view.subtitle], [byId('desktopPromptBody'), view.body]]) { el.textContent = text || ''; el.hidden = !text; }
    drawFields(same ? previous : null);
    actions.replaceChildren(...view.actions.map(action => {
      const button = make('button', 'promptActionBtn', action.label); button.type = 'button'; button.disabled = action.disabled; button.dataset.tone = action.tone || 'neutral';
      if (action.sublabel) button.append(make('small', 'promptActionSub', action.sublabel));
      button.onclick = () => submit(action.key); return button;
    }));
    dismiss.hidden = !view.canDismiss; dismiss.textContent = view.dismissLabel || '关闭';
    lock(!!request); visibility();
  };
}
