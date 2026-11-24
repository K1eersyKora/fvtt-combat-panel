export const DIE_FACES = [4, 6, 8, 10, 12, 20, 100];
export const FORMULA_FACES = [100, 20, 12, 10, 8, 6, 4];
export const MAX_CHAT_LENGTH = 2000;
const MAX_TERM_DICE = 999;
const TOO_LONG = '掷骰公式超过 2000 字符上限';
const ROLL_PREFIXES = new Map([['public', '/r '], ['gm', '/gmroll '], ['blind', '/blindroll ']]);
const ROLL_COMMAND = /^\/(?:r|roll|gmroll|blindroll)\s+/i;
const DIE_OUTLINES = {
  4: '<path d="M12 3 22 20H2Z M12 3v11L2 20m10-6 10 6"/>',
  6: '<path d="m12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5m-9 5v10"/>',
  8: '<path d="M12 2 22 12 12 22 2 12Z M2 12h20M12 2l4 10-4 10-4-10z"/>',
  10: '<path d="M12 2 22 9l-3 7-7 6-7-6-3-7Z M12 2 7 12l5 10 5-10z M2 9l5 3m10 0 5-3"/>',
  12: '<path d="M12 2 22 9 18 21H6L2 9Z M12 7l5 4-2 6H9l-2-6Z M12 2v5m10 2-5 2m1 10-3-4m-9 4 3-4M2 9l5 2"/>',
  20: '<path d="m12 2 9 5v10l-9 5-9-5V7z M12 2l9 15H3Z M3 7l4.5 3m13.5-3-4.5 3M12 22v-5"/>',
  100: '<path d="M5 19 19 5"/><circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/>'
};

function normalizeCount(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || !Number.isSafeInteger(n)) return null;
  return n;
}

function normalizeBonus(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || !Number.isSafeInteger(n)) return null;
  return n;
}

function pushChunked(terms, count, face) {
  let left = count;
  while (left > 0) {
    const step = Math.min(MAX_TERM_DICE, left);
    terms.push(`${step}d${face}`);
    left -= step;
  }
}

/**
 * Compose a native Foundry VTT roll command from a dice pool.
 * Advantage / disadvantage applies ONLY to d20, and EVERY d20 rolls independently
 * as its own `2d20kh1` or `2d20kl1` term. Other dice and modifier are applied once.
 */
export function composeRoll({ counts = {}, bonus = 0, mode = 'normal', visibility = 'public' } = {}) {
  const prefix = ROLL_PREFIXES.get(visibility);
  if (!prefix) {
    return { text: '', error: 'invalidVisibility', message: '无效的掷骰可见模式', totalDice: 0, d20Count: 0 };
  }
  if (!['normal', 'adv', 'dis'].includes(mode)) {
    return { text: '', error: 'invalidMode', message: '无效的优劣势模式', totalDice: 0, d20Count: 0 };
  }
  const allowed = new Set(DIE_FACES);
  for (const key of Object.keys(counts || {})) {
    const face = Number(key);
    if (!allowed.has(face)) {
      return { text: '', error: 'invalidFace', message: '不支持的骰子面数：d' + key, totalDice: 0, d20Count: 0 };
    }
  }
  const safeBonus = normalizeBonus(bonus);
  if (safeBonus === null) {
    return { text: '', error: 'invalidBonus', message: '加值必须为整数', totalDice: 0, d20Count: 0 };
  }

  const parsed = {};
  let totalDice = 0;
  for (const face of FORMULA_FACES) {
    const c = normalizeCount(counts?.[face] ?? counts?.[String(face)] ?? 0);
    if (c === null) {
      return { text: '', error: 'invalidCount', message: `d${face} 数量必须为非负整数`, totalDice: 0, d20Count: 0 };
    }
    parsed[face] = c;
    totalDice += c;
  }
  const d20Count = parsed[20];
  if (totalDice === 0) {
    return { text: '', error: 'emptyPool', message: '请至少选择一颗骰子', totalDice: 0, d20Count: 0 };
  }

  const tooLong = { text: '', error: 'tooLong', message: TOO_LONG, totalDice, d20Count };
  const keep = mode === 'normal' ? '' : mode === 'adv' ? '2d20kh1' : '2d20kl1';
  const termCount = FORMULA_FACES.reduce((count, face) =>
    count + (face === 20 && keep ? d20Count : Math.ceil(parsed[face] / MAX_TERM_DICE)), 0);
  // Allow at least three characters per term and three for its separator or prefix.
  if (termCount * 6 > MAX_CHAT_LENGTH) return tooLong;

  const terms = [];
  for (const face of FORMULA_FACES) {
    if (face === 20 && keep) {
      for (let i = 0; i < d20Count; i++) terms.push(keep);
    } else {
      pushChunked(terms, parsed[face], face);
    }
  }

  let text = prefix + terms.join(' + ');
  if (safeBonus > 0) text += ' + ' + safeBonus;
  else if (safeBonus < 0) text += ' - ' + Math.abs(safeBonus);

  if (text.length > MAX_CHAT_LENGTH) return tooLong;
  return { text, error: '', message: '', totalDice, d20Count };
}

export function installDiceTray({ toggleBtn, tray, input, onToggle, onHaptic }) {
  const counts = Object.fromEntries(DIE_FACES.map(f => [f, 0]));
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let open = !tray.hidden;
  let openFrame = null, hideTimer = null;
  let bonus = 0;
  let mode = 'normal';
  let visibility = 'public';
  let lastGenerated = '';
  let draftBeforeDice = null;

  const grid = document.createElement('div');
  grid.className = 'diceGrid';
  const outputs = new Map();
  const decButtons = new Map();

  for (const face of DIE_FACES) {
    const cell = document.createElement('div');
    cell.className = 'diceCell';
    cell.dataset.face = String(face);

    const dieBtn = document.createElement('button');
    dieBtn.type = 'button';
    dieBtn.className = 'diceFaceBtn';
    dieBtn.dataset.dieAdd = String(face);
    dieBtn.setAttribute('aria-label', `增加一颗 d${face}`);
    dieBtn.innerHTML = `<svg class="dieSvg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${DIE_OUTLINES[face]}</svg><strong>d${face}</strong>`;
    dieBtn.onclick = () => changeDie(face, 1);

    const stepper = document.createElement('div');
    stepper.className = 'diceStepper';

    const dec = document.createElement('button');
    dec.type = 'button';
    dec.className = 'diceStepBtn';
    dec.dataset.dieDec = String(face);
    dec.setAttribute('aria-label', `减少一颗 d${face}`);
    dec.textContent = '−';
    dec.onclick = () => changeDie(face, -1);

    const out = document.createElement('output');
    out.className = 'diceCount';
    out.dataset.dieCount = String(face);
    out.textContent = '0';

    const inc = document.createElement('button');
    inc.type = 'button';
    inc.className = 'diceStepBtn';
    inc.dataset.dieInc = String(face);
    inc.setAttribute('aria-label', `增加一颗 d${face}`);
    inc.textContent = '+';
    inc.onclick = () => changeDie(face, 1);

    outputs.set(face, out);
    decButtons.set(face, dec);
    stepper.append(dec, out, inc);
    cell.append(dieBtn, stepper);
    grid.append(cell);
  }

  const controlsRow = document.createElement('div');
  controlsRow.className = 'diceControls';

  const bonusGroup = document.createElement('div');
  bonusGroup.className = 'diceBonusGroup';
  const bonusLabel = document.createElement('label');
  bonusLabel.htmlFor = 'diceBonus';
  bonusLabel.textContent = '加值';
  const bonusDec = document.createElement('button');
  bonusDec.type = 'button';
  bonusDec.id = 'diceBonusDec';
  bonusDec.className = 'diceStepBtn';
  bonusDec.setAttribute('aria-label', '加值减 1');
  bonusDec.textContent = '−';
  const bonusInput = document.createElement('input');
  bonusInput.id = 'diceBonus';
  bonusInput.type = 'number';
  bonusInput.step = '1';
  bonusInput.value = '0';
  bonusInput.inputMode = 'text';
  bonusInput.setAttribute('aria-label', '固定加值');
  const bonusInc = document.createElement('button');
  bonusInc.type = 'button';
  bonusInc.id = 'diceBonusInc';
  bonusInc.className = 'diceStepBtn';
  bonusInc.setAttribute('aria-label', '加值加 1');
  bonusInc.textContent = '+';
  bonusGroup.append(bonusLabel, bonusDec, bonusInput, bonusInc);

  const modeGroup = document.createElement('div');
  modeGroup.className = 'diceModeGroup';
  modeGroup.setAttribute('role', 'group');
  modeGroup.setAttribute('aria-label', 'd20 优劣势');
  const modeButtons = new Map();
  for (const [key, label] of [['normal', '普通'], ['adv', '优势'], ['dis', '劣势']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.diceMode = key;
    b.textContent = label;
    b.setAttribute('aria-pressed', String(key === mode));
    b.onclick = () => {
      onHaptic?.('light');
      mode = key;
      sync(true);
    };
    modeButtons.set(key, b);
    modeGroup.append(b);
  }

  const visGroup = document.createElement('div');
  visGroup.className = 'diceVisGroup';
  visGroup.setAttribute('role', 'group');
  visGroup.setAttribute('aria-label', '掷骰可见性');
  const visButtons = new Map();
  for (const [key, label] of [['public', '公开'], ['gm', '仅GM'], ['blind', '盲骰']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.diceVis = key;
    button.textContent = label;
    button.onclick = () => {
      onHaptic?.('light');
      visibility = key;
      sync(true);
    };
    visButtons.set(key, button);
    visGroup.append(button);
  }

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.id = 'diceClear';
  clearBtn.className = 'diceClearBtn';
  clearBtn.textContent = '清空';
  clearBtn.onclick = () => {
    onHaptic?.('light');
    resetPool(true);
  };

  controlsRow.append(bonusGroup, clearBtn, modeGroup, visGroup);

  const note = document.createElement('div');
  note.id = 'diceNote';
  note.className = 'diceNote';
  note.setAttribute('role', 'status');

  tray.replaceChildren(grid, controlsRow, note);

  bonusDec.onclick = () => {
    onHaptic?.('light');
    bonus = Math.max(-9999, bonus - 1);
    bonusInput.value = String(bonus);
    sync(true);
  };
  bonusInc.onclick = () => {
    onHaptic?.('light');
    bonus = Math.min(9999, bonus + 1);
    bonusInput.value = String(bonus);
    sync(true);
  };
  bonusInput.addEventListener('input', () => {
    const raw = bonusInput.value.trim();
    if (raw === '' || raw === '-' || raw === '+') {
      bonus = 0;
      sync(true);
      return;
    }
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && Math.abs(parsed) <= 9999) {
      bonus = parsed;
      sync(true);
    }
  });

  function changeDie(face, delta) {
    onHaptic?.('light');
    const next = Math.max(0, Math.min(200, counts[face] + delta));
    if (next === counts[face]) return;
    counts[face] = next;
    sync(true);
  }

  function updateUI(result) {
    for (const face of DIE_FACES) {
      const c = counts[face];
      outputs.get(face).textContent = String(c);
      decButtons.get(face).disabled = c <= 0;
      outputs.get(face).closest('.diceCell')?.classList.toggle('hasCount', c > 0);
    }
    for (const [key, b] of modeButtons) {
      b.setAttribute('aria-pressed', String(key === mode));
    }
    for (const [key, button] of visButtons) {
      button.setAttribute('aria-pressed', String(key === visibility));
    }
    if (result.error === 'tooLong') {
      note.textContent = result.message;
    } else if (result.totalDice === 0) {
      note.textContent = bonus !== 0 ? '请至少选择一颗骰子（加值需搭配骰子）' : '点击骰子或 +/− 组合公式，点「发送」才真正掷骰';
    } else if (mode !== 'normal' && result.d20Count === 0) {
      note.textContent = '优劣势仅作用于 d20（当前未选 d20，其余骰子照常计算）';
    } else if (mode !== 'normal') {
      note.textContent = `每颗 d20 独立取${mode === 'adv' ? '高 (2d20kh1)' : '低 (2d20kl1)'}，可继续在输入框手改`;
    } else {
      note.textContent = '已同步到输入框，可继续手改后点「发送」掷骰';
    }
  }

  function commentOf(value) {
    if (ROLL_COMMAND.test(value)) return value.match(/\s+#[\s\S]*$/)?.[0] || '';
    if (/^\s*#/.test(lastGenerated) && /^\s*#/.test(value)) {
      return value.startsWith('#') ? ' ' + value : value;
    }
    return '';
  }

  function sync(writeInput) {
    const result = composeRoll({ counts, bonus, mode, visibility });
    const current = input.value;
    const comment = writeInput ? commentOf(current) : '';
    const text = result.text && result.text + comment;
    if (text.length > MAX_CHAT_LENGTH) {
      result.error = 'tooLong';
      result.message = TOO_LONG;
    }
    updateUI(result);
    if (!writeInput) return;

    if (draftBeforeDice === null && current !== lastGenerated) {
      draftBeforeDice = current;
    }

    if (text && !result.error) {
      input.value = lastGenerated = text;
    } else if (comment) {
      // Leave the note editable until the pool has a valid formula again.
      input.value = lastGenerated = comment;
    } else if (result.error === 'emptyPool') {
      if (current === lastGenerated || !current.trim()) {
        input.value = draftBeforeDice && draftBeforeDice !== lastGenerated ? draftBeforeDice : '';
      }
      lastGenerated = '';
      draftBeforeDice = null;
    } else if (result.error === 'tooLong' && current === lastGenerated) {
      input.value = lastGenerated = '';
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function resetPool(writeInput) {
    for (const face of DIE_FACES) counts[face] = 0;
    bonus = 0;
    mode = 'normal';
    bonusInput.value = '0';
    sync(writeInput);
  }

  function setOpen(next, immediate = false) {
    open = next;
    const reduce = reducedMotion?.matches;
    if (open || immediate || reduce) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (openFrame !== null) cancelAnimationFrame(openFrame);
    openFrame = null;

    const wasHidden = tray.hidden;
    if (open) tray.hidden = false;
    toggleBtn.setAttribute('aria-expanded', String(open));
    tray.inert = !open;
    if (open) {
      // Give the previously hidden tray a collapsed layout before the opening frame.
      if (wasHidden && !reduce) tray.getBoundingClientRect();
      openFrame = requestAnimationFrame(() => {
        openFrame = null;
        tray.classList.add('isOpen');
      });
    } else {
      tray.classList.remove('isOpen');
      if (immediate || reduce) tray.hidden = true;
      else if (!tray.hidden && hideTimer === null) {
        hideTimer = setTimeout(() => {
          hideTimer = null;
          tray.hidden = true;
        }, 140);
      }
    }
    onToggle?.(open);
  }

  tray.classList.toggle('isOpen', open);
  tray.inert = !open;
  toggleBtn.onclick = () => setOpen(!open);
  sync(false);

  return {
    isOpen: () => open,
    close: () => setOpen(false),
    onSent(sentText) {
      if (ROLL_COMMAND.test(sentText)) {
        lastGenerated = '';
        draftBeforeDice = null;
        resetPool(false);
      }
    },
    reset() {
      lastGenerated = '';
      draftBeforeDice = null;
      visibility = 'public';
      resetPool(false);
      setOpen(false, true);
    }
  };
}
