const byId = id => document.getElementById(id);

function timerSeconds(timer) {
  const text = String(timer ?? '').trim();
  const clock = /^(\d+):([0-5]\d)$/.exec(text);
  const number = /^(?:剩余\s*)?(\d+(?:\.\d+)?)\s*(?:s|秒)?$/i.exec(text);
  const seconds = clock ? Number(clock[1]) * 60 + Number(clock[2]) : Number(number?.[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

export function installCheckPrompt(send) {
  const dialog = byId('bg3CheckPrompt'), roll = byId('bg3CheckRoll');
  const resume = byId('bg3CheckResume'), progress = byId('bg3CheckProgress');
  let prompt, pending, deferred, rendered;
  let countdown, frame = 0;
  const maximums = new Map();

  async function choose(option) {
    if (!prompt || pending || option.disabled) return;
    const current = prompt, marker = {};
    pending = marker;
    renderChoices();
    try {
      await send({promptId:current.id,row:current.row,key:option.key,selected:option.selected});
    } catch (error) {
      if (prompt?.id === current.id) byId('bg3CheckNotice').textContent = error.message;
    } finally {
      if (pending === marker) {pending = null;renderChoices();}
    }
  }

  function renderChoices() {
    const keys = JSON.stringify([prompt?.id,prompt?.row,prompt?.buttons,!!pending]);
    if (keys === rendered) return;
    rendered = keys;
    const tabs = byId('bg3CheckTabs'), bonuses = byId('bg3CheckBonuses');
    tabs.replaceChildren(); bonuses.replaceChildren();
    for (const option of prompt?.buttons || []) {
      if (option.key === 'roll') continue;
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = option.text; button.disabled = option.disabled || !!pending;
      button.setAttribute('aria-pressed', String(option.selected));
      button.onclick = () => void choose(option);
      (option.key.startsWith('tab:') ? tabs : bonuses).append(button);
    }
    const choice = prompt?.buttons?.find(option => option.key === 'roll');
    roll.textContent = !choice || choice.text === '点击骰子' ? '掷骰' : choice.text;
    roll.disabled = !choice || choice.disabled || !!pending;
    roll.onclick = choice ? () => void choose(choice) : null;
  }

  function tick(now) {
    const remaining = Math.max(0, (countdown.deadline - now) / 1000);
    progress.value = remaining;
    frame = remaining > 0 ? requestAnimationFrame(tick) : 0;
  }

  function syncProgress() {
    if (!progress) return;
    cancelAnimationFrame(frame);
    frame = 0;
    if (!prompt) maximums.clear();
    const seconds = timerSeconds(prompt?.timer);
    if (seconds === null) {
      countdown = null;
      progress.hidden = true;
      return;
    }

    if (!maximums.has(prompt.id)) maximums.set(prompt.id, seconds || 1);
    const now = performance.now();
    if (!countdown || countdown.id !== prompt.id || countdown.seconds !== seconds) {
      let deadline = now + seconds * 1000;
      if (countdown && countdown.id === prompt.id && seconds < countdown.seconds) deadline = Math.min(deadline, countdown.deadline);
      countdown = {id: prompt.id, seconds, deadline};
    }
    progress.max = maximums.get(prompt.id);
    progress.hidden = !dialog.open;
    if (!progress.hidden) tick(now);
  }

  function renderPrompt() {
    if (prompt && prompt.id !== deferred) {
      byId('bg3CheckTitle').textContent = prompt.title || 'BG3 检定';
      byId('bg3CheckSummary').textContent = [prompt.actor, prompt.mode, prompt.dc ? 'DC ' + prompt.dc : '', prompt.total ? '加值 ' + prompt.total : ''].filter(Boolean).join(' · ');
      byId('bg3CheckNotice').textContent = [prompt.result, prompt.notice].filter(Boolean).join(' · ');
      byId('bg3CheckTimer').textContent = prompt.timer ? prompt.timer + '后自动掷骰' : '';
      renderChoices();
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) dialog.close();
    if (resume) {
      resume.hidden = !prompt || dialog.open;
      if (!resume.hidden) resume.textContent = '待处理检定 · ' + (prompt.title || '点击恢复');
    }
    syncProgress();
  }

  function defer() {
    deferred = prompt?.id;
    renderPrompt();
  }
  byId('bg3CheckDefer').onclick = defer;
  dialog.addEventListener('cancel', event => {event.preventDefault();defer();});
  if (resume) resume.onclick = () => {
    if (!prompt || deferred !== prompt.id) return;
    deferred = null;
    renderPrompt();
  };
  renderPrompt();
  return view => {
    if (!view || view.id !== prompt?.id) pending = null;
    if (!view) deferred = null;
    prompt = view;
    renderPrompt();
  };
}
