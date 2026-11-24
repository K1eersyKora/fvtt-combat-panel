const byId = id => document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

export function installCombatHud({onEndTurn, onSelectToken, onMyTurn, onHaptic}) {
  const hud = byId('combatHud'), pill = byId('combatPill'), list = byId('combatList');
  const switcher = byId('tokenSwitcher'), switchBtn = byId('tokenSwitchBtn'), menu = byId('tokenSwitchMenu');
  const summary = element('span', 'combatSummary'), hint = element('span', 'combatHint');
  const order = element('ol', 'combatOrder'), end = element('button', 'primary', '结束回合');
  const options = element('div', 'tokenOptions');
  const combatNotice = element('small', 'hudNotice'), tokenNotice = element('small', 'hudNotice');
  for (const notice of [combatNotice, tokenNotice]) {
    notice.setAttribute('role', 'status');
    notice.hidden = true;
  }
  end.id = 'endTurnBtn';
  end.type = pill.type = switchBtn.type = 'button';
  pill.setAttribute('aria-controls', list.id);
  switchBtn.setAttribute('aria-controls', menu.id);
  pill.replaceChildren(summary, hint);
  list.replaceChildren(end, order, combatNotice);
  menu.replaceChildren(options, tokenNotice);
  list.hidden = menu.hidden = true;

  let table = null, busy = false, opened = '', pending = null;
  let orderSignature, tokenSignature;
  let previousCombatId, wasMyTurn = false, sweepTimer = null;
  const hideTimers = new Map();
  const tokens = () => table?.ownedTokens || [];
  const currentToken = () => table?.source?.id ?? tokens().find(token => token.active)?.id;

  function renderOrder() {
    const entries = table.combat.entries || [];
    const signature = JSON.stringify(entries);
    if (signature === orderSignature) return;
    orderSignature = signature;
    const rows = entries.map(entry => {
      const row = element('li', 'combatRow');
      const initiative = element('span', 'combatInit', entry.initiative ?? '—');
      initiative.setAttribute('aria-label', '先攻 ' + (entry.initiative ?? '未掷'));
      row.append(initiative, element('span', 'combatName', entry.name || '未知单位'));
      if (entry.active) {
        row.classList.add('active');
        row.setAttribute('aria-current', 'step');
        row.append(element('small', 'combatMark', '当前'));
      }
      if (entry.isMine) {
        row.classList.add('isMine');
        row.append(element('small', 'combatMark', '己方'));
      }
      if (entry.defeated) {
        row.classList.add('defeated');
        row.append(element('small', 'combatMark', '倒下'));
      }
      return row;
    });
    if (!rows.length) rows.push(element('li', 'hudEmpty', '暂无可见战斗员。'));
    order.replaceChildren(...rows);
  }

  function renderTokens() {
    const current = currentToken(), owned = tokens();
    const signature = JSON.stringify([current, owned]);
    if (signature === tokenSignature) return;
    tokenSignature = signature;
    options.replaceChildren(...owned.map(token => {
      const option = element('button', 'tokenOption', token.name || '未命名棋子');
      option.type = 'button';
      option.dataset.tokenId = token.id;
      if (token.id === current) {
        option.classList.add('active');
        option.setAttribute('aria-current', 'true');
        option.append(element('small', 'tokenMark', '当前'));
      }
      option.onclick = () => {
        if (token.id !== currentToken()) void runAction('tokens', () => onSelectToken(token.id));
      };
      return option;
    }));
  }

  function syncDisabled() {
    end.hidden = !table?.combat?.isMyTurn;
    end.disabled = busy || !!pending || end.hidden;
    for (const option of options.children) {
      option.disabled = busy || !!pending || option.classList.contains('active');
    }
  }

  function setMenuOpen(panel, open) {
    const timer = hideTimers.get(panel);
    if (open) {
      if (timer !== undefined) {
        clearTimeout(timer);
        hideTimers.delete(panel);
      }
      if (!panel.classList.contains('isOpen')) {
        panel.hidden = false;
        panel.inert = false;
        void panel.offsetWidth;
        panel.classList.add('isOpen');
      }
      return;
    }
    panel.inert = true;
    panel.classList.remove('isOpen');
    if (panel.hidden) return;
    const hide = () => {
      hideTimers.delete(panel);
      panel.hidden = true;
      if (panel === list) {
        order.replaceChildren();
        orderSignature = undefined;
      } else {
        options.replaceChildren();
        tokenSignature = undefined;
      }
    };
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      clearTimeout(timer);
      hide();
    } else if (timer === undefined) {
      hideTimers.set(panel, setTimeout(hide, 130));
    }
  }

  function showMenu(next) {
    if (next !== opened) {
      combatNotice.hidden = tokenNotice.hidden = true;
      combatNotice.textContent = tokenNotice.textContent = '';
    }
    opened = next;
    const combatOpen = next === 'combat', tokensOpen = next === 'tokens';
    if (combatOpen) renderOrder();
    if (tokensOpen) renderTokens();
    setMenuOpen(list, combatOpen);
    setMenuOpen(menu, tokensOpen);
    pill.setAttribute('aria-expanded', String(combatOpen));
    switchBtn.setAttribute('aria-expanded', String(tokensOpen));
    syncDisabled();
  }

  function close() { showMenu(''); }

  async function runAction(kind, callback) {
    if (busy || pending || opened !== kind) return;
    onHaptic?.('light');
    const request = pending = {};
    const notice = kind === 'combat' ? combatNotice : tokenNotice;
    notice.hidden = true;
    syncDisabled();
    try {
      await callback();
      if (pending === request && opened === kind) close();
    } catch (error) {
      if (pending === request && opened === kind) {
        notice.textContent = error?.message || '操作未完成，请重试。';
        notice.hidden = false;
      }
    } finally {
      if (pending === request) { pending = null; syncDisabled(); }
    }
  }

  pill.onclick = () => {
    if (hud.hidden) return;
    onHaptic?.('light');
    showMenu(opened === 'combat' ? '' : 'combat');
  };
  switchBtn.onclick = () => {
    if (switcher.hidden) return;
    onHaptic?.('light');
    showMenu(opened === 'tokens' ? '' : 'tokens');
  };
  end.onclick = () => { if (table?.combat?.isMyTurn) void runAction('combat', onEndTurn); };
  document.addEventListener('pointerdown', event => {
    if (opened && !hud.contains(event.target) && !switcher.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !opened) return;
    event.preventDefault();
    const opener = opened === 'combat' ? pill : switchBtn;
    close();
    opener.focus({preventScroll: true});
  });

  function clearTurnSweep() {
    clearTimeout(sweepTimer);
    sweepTimer = null;
    pill.classList.remove('turnSweep');
  }

  function update(nextTable, {aiming = false, busy: working = false} = {}) {
    const changedTable = !nextTable || nextTable.scene !== table?.scene || nextTable.user !== table?.user;
    if (changedTable) {
      pending = null;
      close();
    }
    table = nextTable;
    busy = !!working;
    const combat = table?.combat, mine = !!combat?.isMyTurn;
    const beganMyTurn = mine && (!wasMyTurn || changedTable || combat.id !== previousCombatId);
    previousCombatId = combat?.id;
    wasMyTurn = mine;
    hud.hidden = !combat || aiming;
    hud.classList.toggle('myTurn', mine);
    pill.classList.toggle('myTurn', mine);
    setText(summary, combat ? '第 ' + (combat.round ?? 1) + ' 轮 · 当前：' + (combat.activeName || '未知单位') : '');
    setText(hint, mine ? '轮到你了' : combat?.turnsUntilMine > 0 ? '还有 ' + combat.turnsUntilMine + ' 步' : '');
    hint.hidden = !hint.textContent;
    const owned = tokens();
    switcher.hidden = owned.length <= 1;
    setText(switchBtn, '切换棋子 (' + owned.length + ')');
    const current = currentToken(), name = owned.find(token => token.id === current)?.name;
    switchBtn.title = name ? '当前棋子：' + name : '';
    switchBtn.setAttribute('aria-label', switchBtn.textContent + (name ? '，' + switchBtn.title : ''));
    if ((hud.hidden && opened === 'combat') || (switcher.hidden && opened === 'tokens')) close();
    else showMenu(opened);
    if (beganMyTurn) {
      clearTurnSweep();
      void pill.offsetWidth;
      pill.classList.add('turnSweep');
      sweepTimer = setTimeout(clearTurnSweep, 700);
      onMyTurn?.();
    } else if (!mine && sweepTimer !== null) {
      clearTurnSweep();
    }
  }

  update(null);
  return {update, close, isOpen: () => !!opened};
}
