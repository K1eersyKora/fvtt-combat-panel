import {composeRoll} from './dice.js';

const byId = id => document.getElementById(id);
const abilityNames = {str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力'};
const roman = level => ['0', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ'][level] ?? String(level);
const isPact = slot => slot.kind === 'pact' || slot.id === 'pact';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(text, className) {
  const node = element('button', className, text);
  node.type = 'button';
  return node;
}

function setText(node, value) {
  const text = String(value ?? '');
  if (node.textContent !== text) node.textContent = text;
}

export function renderSpellSlots(bar, slots) {
  const previous = new Map(Array.from(bar.querySelectorAll('.slotGroup[data-slot-id]'), group =>
    [group.dataset.slotId, {group, filled: group.querySelectorAll('i.filled').length}]));
  const changedPips = [];
  let nextGroup = bar.firstElementChild;
  const list = Array.isArray(slots) ? slots.filter(Boolean) : [];
  list.sort((a, b) => Number(isPact(b)) - Number(isPact(a)) || (Number(a.level) || 0) - (Number(b.level) || 0));
  for (const slot of list) {
    const max = Math.round(Number(slot.max));
    if (!Number.isFinite(max) || max <= 0) continue;
    const value = Math.max(0, Math.min(max, Math.round(Number(slot.value) || 0)));
    const pact = isPact(slot), level = Number(slot.level) || 0;
    const cols = max <= 1 ? 1 : max <= 6 ? 2 : 3;
    const id = String(slot.id || (pact ? 'pact' : 'spell' + level));
    const old = previous.get(id), group = old?.group ?? element('span', 'slotGroup');
    previous.delete(id);
    group.classList.toggle('pact', pact);
    group.dataset.slotId = id;
    group.setAttribute('role', 'img');
    group.title = (pact ? '契约法术位' + (level ? ' ' + roman(level) + ' 环' : '') : roman(level) + ' 环法术位')
      + ' · 剩余 ' + value + '/' + max;
    group.setAttribute('aria-label', group.title);
    const label = group.firstElementChild ?? element('b', 'slotRoman');
    setText(label, pact ? '契' + (level ? roman(level) : '') : roman(level));
    label.setAttribute('aria-hidden', 'true');
    const shape = group.lastElementChild ?? element('span', 'slotShape');
    shape.dataset.cols = String(cols);
    shape.style.setProperty('--shape-cols', String(cols));
    shape.setAttribute('aria-hidden', 'true');
    while (shape.childElementCount > max) shape.lastElementChild.remove();
    for (let i = 0; i < max; i++) {
      const filled = i < value, changed = old && filled !== (i < old.filled);
      const before = shape.children[i];
      // Preserve an active pulse across snapshots, and restart only a pip that changed again.
      if (before && !changed) continue;
      const pip = element('i', filled ? 'filled' : '');
      if (changed) {
        pip.classList.add('pipChanged');
        changedPips.push(pip);
      }
      if (before) before.replaceWith(pip);
      else shape.append(pip);
    }
    if (!old) group.append(label, shape);
    if (group !== nextGroup) bar.insertBefore(group, nextGroup);
    nextGroup = group.nextElementSibling;
  }
  while (nextGroup) {
    const unused = nextGroup;
    nextGroup = unused.nextElementSibling;
    unused.remove();
  }
  if (changedPips.length) {
    setTimeout(() => { for (const pip of changedPips) pip.classList.remove('pipChanged'); }, 260);
  }
}

// Keep focused controls and expanded <details> connected when a live snapshot arrives.
function reconcileRows(list, rows, create, paint) {
  const previous = new Map(Array.from(list.children, node => [node.dataset.key, node]));
  let anchor = list.firstElementChild;
  rows.forEach((row, index) => {
    const key = String(row.id ?? (index + ':' + (row.label ?? row.name ?? '')));
    const node = previous.get(key) ?? create();
    node.dataset.key = key;
    previous.delete(key);
    paint(node, row);
    if (node !== anchor) list.insertBefore(node, anchor);
    anchor = node.nextElementSibling;
  });
  for (const node of previous.values()) node.remove();
}

const signed = n => n == null ? '—' : n >= 0 ? '+' + n : String(n);

export function createSheetUI({onQuickRoll, onHaptic}) {
  const sheet = byId('sheet'), tabs = byId('sheetTabs'), panel = byId('sheetTabPanel');
  const abilities = byId('sheetAbilities'), conditions = byId('sheetConditions'), quick = byId('sheetQuickRoll');
  const slotBar = byId('slotPips');
  const scrollers = [sheet.closest('#pageScroll') || document.scrollingElement, sheet, panel].filter(Boolean);
  let card, actorKey, sourceKey, online = false, selectedTab = 0, trigger = null, mode = 'normal';
  let closeTimer = null;

  const name = element('strong');
  name.id = 'quickRollName';
  const dismiss = button('×');
  dismiss.id = 'sheetQuickRollClose';
  dismiss.setAttribute('aria-label', '关闭快捷掷骰');
  const heading = element('div', 'rollHead');
  heading.append(name, dismiss);
  const modes = element('div', 'rollModes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', '掷骰模式');
  for (const [key, label] of [['normal', '普通'], ['adv', '优势'], ['dis', '劣势']]) {
    const option = button(label);
    option.dataset.mode = key;
    option.onclick = () => {
      if (!trigger) return;
      onHaptic?.('light');
      mode = key;
      refreshQuickRoll();
    };
    modes.append(option);
  }
  const formula = element('output', 'rollFormula');
  const fill = button('填入聊天框'), send = button('立即掷骰', 'primary');
  const actions = element('div', 'rollActions'), offline = element('small', 'rollOffline', '离线仅查看，连接桌位后可使用快捷掷骰。');
  actions.append(fill, send);
  quick.setAttribute('role', 'region');
  quick.setAttribute('aria-labelledby', name.id);
  quick.replaceChildren(heading, modes, formula, actions, offline);
  quick.hidden = true;
  quick.inert = true;
  quick.classList.remove('isOpen');

  function closeQuickRoll() {
    trigger = null;
    quick.inert = true;
    quick.classList.remove('isOpen');
    if (quick.hidden) return;
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      clearTimeout(closeTimer);
      closeTimer = null;
      quick.hidden = true;
    } else if (closeTimer === null) {
      closeTimer = setTimeout(() => { closeTimer = null; quick.hidden = true; }, 130);
    }
  }

  function dismissQuickRoll() {
    const previous = trigger;
    closeQuickRoll();
    previous?.focus({preventScroll: true});
  }

  function refreshQuickRoll() {
    if (!trigger?.isConnected || trigger.disabled) return closeQuickRoll();
    const label = trigger.dataset.rollName, bonus = Number(trigger.dataset.bonus);
    setText(name, label + ' (' + signed(bonus) + ')');
    const roll = composeRoll({counts: {20: 1}, bonus, mode});
    setText(formula, roll.text + ' # ' + label.replace(/\s+/g, ' ').trim());
    for (const option of modes.children) {
      const active = option.dataset.mode === mode;
      option.classList.toggle('active', active);
      option.setAttribute('aria-pressed', String(active));
    }
    fill.disabled = send.disabled = !online;
    offline.hidden = online;
    if (!quick.classList.contains('isOpen')) {
      clearTimeout(closeTimer);
      closeTimer = null;
      quick.hidden = false;
      quick.inert = false;
      void quick.offsetWidth;
      quick.classList.add('isOpen');
    }
  }

  function submitRoll(immediate) {
    if (!online || !trigger) return;
    onHaptic?.('light');
    const text = formula.textContent;
    closeQuickRoll();
    onQuickRoll(text, immediate);
  }

  dismiss.onclick = dismissQuickRoll;
  fill.onclick = () => submitRoll(false);
  send.onclick = () => submitRoll(true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !trigger || sheet.hidden || event.target.closest?.('dialog')) return;
    event.preventDefault();
    dismissQuickRoll();
  });

  function rollButton(className) {
    const control = button('', className);
    control.onclick = () => {
      onHaptic?.('light');
      trigger = control;
      mode = 'normal';
      refreshQuickRoll();
      dismiss.focus({preventScroll: true});
      quick.scrollIntoView({block: 'nearest'});
    };
    return control;
  }

  function bindRoll(control, label, value) {
    const n = value == null || value === '' ? null : Number(value);
    const bonus = Number.isSafeInteger(n) ? n : null;
    control.disabled = bonus == null;
    control.dataset.rollName = label;
    control.dataset.bonus = bonus == null ? '' : String(bonus);
    control.setAttribute('aria-label', label + ' (' + signed(bonus) + ')');
    return signed(bonus);
  }

  const abilityCards = Object.entries(abilityNames).map(([id, label]) => {
    const box = element('div', 'sheetAbility'), score = element('strong');
    box.dataset.ability = id;
    const check = rollButton('abilityMod'), save = rollButton('abilitySave');
    box.append(element('span', '', label), score, check, save);
    return {id, label, box, score, check, save};
  });
  abilities.style.display = 'grid';
  abilities.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
  abilities.replaceChildren(...abilityCards.map(a => a.box));

  const skillsPage = element('div'), skills = element('div', 'sheetSkillGrid');
  skills.style.display = 'grid';
  skills.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  const skillsEmpty = element('p', 'sheetEmpty', '这张角色卡还没有技能。');
  skillsPage.append(skills, skillsEmpty);
  function renderSkills() {
    const rows = card?.skills || [];
    reconcileRows(skills, rows, () => {
      const control = rollButton('sheetSkill');
      control.append(element('span'), element('b'));
      return control;
    }, (control, skill) => {
      const label = skill.label || skill.id;
      setText(control.firstElementChild, label);
      setText(control.lastElementChild, bindRoll(control, label + '检定', skill.mod));
    });
    skillsEmpty.hidden = rows.length > 0;
  }

  const itemsPage = element('div'), search = element('input'), items = element('div', 'sheetItems');
  search.id = 'sheetItemSearch';
  search.type = 'search';
  search.placeholder = '搜索物品名称';
  search.setAttribute('aria-label', search.placeholder);
  const itemsEmpty = element('p', 'sheetEmpty');
  itemsPage.append(search, items, itemsEmpty);
  function filterItems() {
    const query = search.value.trim().toLocaleLowerCase();
    let matches = 0;
    for (const item of items.children) {
      item.hidden = !item.dataset.search.includes(query);
      if (!item.hidden) matches++;
    }
    itemsEmpty.hidden = matches > 0;
    setText(itemsEmpty, items.childElementCount ? '没有找到匹配的物品。' : '这张角色卡还没有物品。');
  }
  search.oninput = filterItems;

  function renderItems() {
    const rows = [...(card?.inventory || [])].sort((a, b) => Number(!!b.equipped) - Number(!!a.equipped));
    reconcileRows(items, rows, () => {
      const item = element('details', 'sheetItem'), summary = element('summary');
      summary.append(element('span', 'itemName'), element('small', 'itemQuantity'), element('small', 'itemEquipped', '已装备'), element('small', 'itemUses'));
      item.append(summary, element('p', 'itemDescription'));
      return item;
    }, (node, item) => {
      const [title, quantity, equipped, uses] = node.firstElementChild.children;
      const label = item.name || '未命名物品';
      node.dataset.search = label.toLocaleLowerCase();
      setText(title, label);
      setText(quantity, '×' + (item.quantity ?? 1));
      equipped.hidden = !item.equipped;
      const left = item.charge?.value ?? item.uses, max = item.charge?.max;
      uses.hidden = left == null;
      setText(uses, left == null ? '' : '剩余 ' + left + (max == null ? '' : '/' + max) + ' 次');
      setText(node.lastElementChild, item.description || '暂无物品说明。');
    });
    filterItems();
  }

  const biography = element('p', 'sheetBiography');
  const pages = [
    {label: '技能', id: 'sheetTabSkills', content: skillsPage},
    {label: '物品', id: 'sheetTabItems', content: itemsPage},
    {label: '资料', id: 'sheetTabBio', content: biography}
  ];
  tabs.setAttribute('role', 'tablist');
  panel.setAttribute('role', 'tabpanel');
  panel.replaceChildren(...pages.map(p => p.content));
  function selectTab(index) {
    selectedTab = index;
    pages.forEach((page, i) => {
      const active = i === index;
      page.content.hidden = !active;
      page.tab.classList.toggle('active', active);
      page.tab.tabIndex = active ? 0 : -1;
      page.tab.setAttribute('aria-selected', String(active));
    });
    panel.setAttribute('aria-labelledby', pages[index].id);
    if (pages[index].content === itemsPage) renderItems();
  }
  tabs.replaceChildren(...pages.map((page, index) => {
    const tab = page.tab = button(page.label, 'sheetTab');
    tab.id = page.id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    tab.onclick = () => selectTab(index);
    tab.onkeydown = event => {
      const count = pages.length;
      const next = {ArrowLeft: (index + count - 1) % count, ArrowRight: (index + 1) % count, Home: 0, End: count - 1}[event.key];
      if (next == null) return;
      event.preventDefault();
      selectTab(next);
      pages[next].tab.focus({preventScroll: true});
    };
    return tab;
  }));
  selectTab(0);

  function render(nextCard, {cardFrom, cardTime, online: connected} = {}) {
    const positions = scrollers.map(node => node.scrollTop);
    const nextActor = nextCard?.actorId ?? nextCard?.actor;
    if (nextActor !== actorKey || nextCard?.source !== sourceKey) {
      closeQuickRoll();
      items.replaceChildren();
      slotBar.replaceChildren();
    }
    actorKey = nextActor;
    sourceKey = nextCard?.source;
    card = nextCard;
    online = !!connected;
    setText(byId('actor'), card?.actor || '角色卡');
    const stamp = cardFrom || !online ? '本机快照' : '已同步';
    setText(byId('sheetStamp'), card ? stamp + (cardTime ? ' · ' + new Date(cardTime).toLocaleTimeString('zh-CN') : '') : '');
    const hp = card?.hp;
    setText(byId('vitals'), [
      hp ? '生命 ' + hp.value + ' / ' + hp.max + (hp.temp > 0 ? '（临时 +' + hp.temp + '）' : '') : '',
      card?.ac != null ? 'AC ' + card.ac : '',
      card?.speed != null ? '速度 ' + card.speed + ' 尺' : ''
    ].filter(Boolean).join(' · '));
    renderSpellSlots(slotBar, card?.slots);
    const chips = (card?.conditions || []).map(c => typeof c === 'string' ? c : c?.label).filter(Boolean);
    conditions.replaceChildren(...chips.map(label => element('span', 'sheetCondition', label)));
    conditions.hidden = !chips.length;
    const stats = new Map((card?.abilities || []).map(a => [a.id, a]));
    for (const {id, label, score, check, save} of abilityCards) {
      const stat = stats.get(id);
      setText(score, stat?.value ?? '—');
      setText(check, bindRoll(check, label + '检定', stat?.mod));
      setText(save, '豁免 ' + bindRoll(save, label + '豁免', stat?.save ?? stat?.mod));
    }
    renderSkills();
    if (pages[selectedTab].content === itemsPage) renderItems();
    setText(biography, card?.biography || '这张角色卡还没有人物资料。');
    biography.classList.toggle('sheetEmpty', !card?.biography);
    if (trigger) refreshQuickRoll();
    scrollers.forEach((node, i) => { if (node.scrollTop !== positions[i]) node.scrollTop = positions[i]; });
  }

  return {render, closeQuickRoll, isQuickRollOpen: () => !sheet.hidden && !!trigger};
}
