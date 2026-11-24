const byId = id => document.getElementById(id);
const itemKey = /^[\w-]{1,80}(?:\/[\w-]{1,80})?$/;
const unique = value => Array.isArray(value) ? [...new Set(value.filter(key => typeof key === 'string' && itemKey.test(key)).map(key => key.split('/')[0]))] : [];
const defaults = () => ({order: [], hidden: [], shown: []});
const visible = (row, layout) => row.curated?.include === false ? layout.shown.includes(row.key) : !layout.hidden.includes(row.key);
export const dockSearchText = row => [row.name, ...row.activities.flatMap(a => [a.activity, a.activation?.label])].join(' ').toLowerCase();

export function itemCatalog(card) {
  const actions = card?.actions || [], byKey = new Map(actions.map(a => [a.key, a])), byItem = new Map();
  for (const a of actions) {
    const id = a.itemId || a.key.split('/')[0];
    if (!byItem.has(id)) byItem.set(id, []);
    byItem.get(id).push(a);
  }
  const items = new Map((card?.inventory || []).map(item => [item.id, item]));
  for (const [id, [a]] of byItem) if (!items.has(id)) items.set(id, {...a, id});
  return [...items.values()].map(item => {
    const activities = item.activityKeys ? item.activityKeys.map(key => byKey.get(key)).filter(Boolean) : byItem.get(item.id) || [];
    const first = activities[0];
    return {...item, key: item.id, itemId: item.id, activities, level: item.level ?? first?.level ?? 0,
      isCantrip: item.isCantrip ?? first?.isCantrip, iconAsset: item.iconAsset ?? first?.iconAsset,
      curated: item.curated ?? {include: !!first, reason: first ? '' : 'passive', label: first ? '' : '被动/无活动'}};
  });
}

function saveLayout({scope, actorId, key}, layout) {
  const json = JSON.stringify(layout);
  if (window.TableAssets?.saveDockItems) {
    if (!window.TableAssets.saveDockItems(scope, actorId, json)) throw Error('不能保存此角色');
  } else localStorage.setItem(key, json);
}
function readLayout(owner) {
  try {
    const raw = window.TableAssets?.getDockItems?.(owner.scope, owner.actorId) || localStorage.getItem(owner.key);
    if (!raw) return defaults();
    const saved = JSON.parse(raw), layout = {order: unique(saved?.order), hidden: unique(saved?.hidden), shown: unique(saved?.shown)};
    if (JSON.stringify(layout) !== raw) { try { saveLayout(owner, layout); } catch {} }
    return layout;
  } catch { return defaults(); }
}

function ordered(rows, order) {
  if (!order.length) return rows;
  const positions = new Map(order.map((key, index) => [key, index]));
  const position = row => positions.get(row.key) ?? order.length;
  return [...rows].sort((left, right) => position(left) - position(right));
}

export function installDockItems({
  profile, catalog, groups, configurableGroups = ['武器', '装备', '特性', '法术'],
  getMask, setMask, groupOf, titleOf, mountIcon, change, onHaptic
}) {
  const dialog = byId('dockVisibility'), trigger = byId('dockSettingsOpen');
  const options = byId('dockOptions');
  const filter = byId('dockItemsGroup'), search = byId('dockItemsSearch'), list = byId('dockItemsList');
  const status = byId('dockItemsStatus'), reset = byId('dockItemsReset');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let current, editorKey, signature, drag;

  byId('dockItemsClose').onclick = () => dialog.close();

  filter.replaceChildren(...groups.map(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    return option;
  }));

  const groupBits = new Map(configurableGroups.map((name, index) => [name, 1 << index]));
  const allGroups = (1 << configurableGroups.length) - 1;
  const readMask = () => getMask?.() ?? allGroups;
  const isGroupVisible = (name, mask) => !groupBits.has(name) || Boolean(mask & groupBits.get(name));
  const groupInputs = new Map();

  if (options && getMask) {
    options.replaceChildren();
    for (const [name, bit] of groupBits) {
      const label = document.createElement('label'), input = document.createElement('input');
      label.className = 'checkRow';
      input.type = 'checkbox';
      input.disabled = !setMask;
      input.setAttribute('aria-label', name);
      input.onchange = () => {
        onHaptic?.('light');
        const mask = readMask();
        setMask?.(input.checked ? mask | bit : mask & ~bit);
        render();
        change?.();
      };
      groupInputs.set(name, input);
      label.append(input, name);
      options.append(label);
    }
  }

  function scopeLayout() {
    const owner = profile();
    if (!owner?.scope || !owner.actorId) { current = null; return null; }
    const key = 'fvtt-mobile-dock-items/' + owner.scope + '/' + owner.actorId;
    if (current?.key !== key) {
      current = {...owner, key};
      current.layout = readLayout(current);
    }
    return current;
  }

  function apply(context, layout, focus, reorder) {
    if (scopeLayout() !== context) return;
    try {
      saveLayout(context, layout);
    } catch {
      signature = null;
      render(focus);
      status.textContent = '本机保存失败，请重试';
      return;
    }
    context.layout = layout;
    render(focus, reorder);
    change?.();
  }

  function moveRow(context, all, rows, from, to, focus) {
    if (from === to || to < 0 || to >= rows.length) return;
    const keys = rows.map(row => row.key);
    const [movedKey] = keys.splice(from, 1);
    keys.splice(to, 0, movedKey);
    const moved = new Set(keys);
    let index = 0;
    const order = all.map(row => moved.has(row.key) ? keys[index++] : row.key);
    const reorder = reducedMotion?.matches ? undefined : {
      movedKey,
      positions: new Map(Array.from(list.querySelectorAll('li[data-key]'),
        row => [row.dataset.key, row.getBoundingClientRect().top]))
    };
    apply(context, {...context.layout, order}, focus, reorder);
  }

  function animateReorder(nodes, {movedKey, positions}) {
    const moving = [];
    for (const row of nodes) {
      const oldTop = positions.get(row.dataset.key);
      if (oldTop === undefined) continue;
      const delta = oldTop - row.getBoundingClientRect().top;
      if (Math.abs(delta) >= 1) moving.push([row, delta]);
    }
    for (const [row, delta] of moving) {
      row.style.transition = 'none';
      row.style.transform = `translateY(${delta}px)`;
    }
    if (moving.length) {
      // Commit the inverse positions before starting any transitions.
      list.getBoundingClientRect();
      for (const [row] of moving) {
        const finish = event => {
          if (event && (event.target !== row || event.propertyName !== 'transform')) return;
          clearTimeout(timer);
          row.removeEventListener('transitionend', finish);
          row.style.transition = '';
          row.style.transform = '';
        };
        const timer = setTimeout(finish, 220);
        row.addEventListener('transitionend', finish);
        row.style.transition = 'transform 180ms cubic-bezier(.22,.8,.36,1)';
        row.style.transform = '';
      }
    }
    const moved = nodes.find(row => row.dataset.key === movedKey);
    if (moved) {
      moved.classList.add('justMoved');
      setTimeout(() => moved.classList.remove('justMoved'), 420);
    }
  }

  function updateDropTarget(y) {
    const {top, bottom} = list.getBoundingClientRect();
    const pointer = Math.max(top, Math.min(bottom - 1, y));
    const target = Array.from(list.children).find(row => pointer < row.getBoundingClientRect().bottom) || list.lastElementChild;
    if (target === drag.target) return;
    drag.target.classList.remove('isDropTarget');
    drag.target = target;
    if (target !== drag.source) target.classList.add('isDropTarget');
  }

  function finishDrag(commit = false) {
    if (!drag) return;
    const {id, source, target, move} = drag;
    drag = null;
    source.classList.remove('isDragging');
    target.classList.remove('isDropTarget');
    if (list.hasPointerCapture(id)) list.releasePointerCapture(id);
    if (commit && source !== target) move(target.dataset.key);
  }

  function render(focus, reorder) {
    const context = scopeLayout();
    if (!dialog.open) return;
    const mask = readMask();
    for (const [name, input] of groupInputs) input.checked = isGroupVisible(name, mask);
    filter.disabled = search.disabled = !context;
    if (!context) {
      finishDrag();
      editorKey = signature = null;
      list.replaceChildren();
      reset.disabled = true;
      status.textContent = '选择角色后可调整栏位';
      return;
    }
    if (editorKey !== context.key) {
      editorKey = context.key;
      search.value = '';
      filter.value = groups[0];
      list.scrollTop = 0;
    }

    const {layout} = context;
    const all = ordered(catalog(), layout.order);
    const query = search.value.trim().toLowerCase();
    const rows = all.map(row => ({row, key: row.key, category: groupOf(row), name: titleOf(row)}))
      .filter(({row, category, name}) => (filter.value === groups[0] || category === filter.value)
        && dockSearchText(row).includes(query));
    const next = JSON.stringify([context.key, filter.value, query, mask, layout, all.map(row => row.key),
      rows.map(({row, category, name}) => [row.key, row.curated, dockSearchText(row), category, name])]);
    if (signature === next && !focus) return;
    finishDrag();
    signature = next;
    const scroll = list.scrollTop, nodes = [];
    let focusTarget;
    const visibleCount = rows.filter(({row, category}) => visible(row, layout) && isGroupVisible(category, mask)).length;
    status.textContent = `已显示 ${visibleCount} / ${rows.length} 项 · ${query ? '清空查找后可排序' : '修改自动保存'}`;
    reset.disabled = !layout.order.length && !layout.hidden.length && !layout.shown.length;

    for (const [index, {row, key, category, name}] of rows.entries()) {
      const entry = document.createElement('li');
      const groupHidden = !isGroupVisible(category, mask);
      entry.className = 'dockItemRow';
      entry.classList.toggle('isGroupHidden', groupHidden);
      entry.dataset.key = key;

      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'dockItemGrip';
      grip.textContent = '⋮⋮';
      grip.disabled = Boolean(query);
      grip.style.touchAction = 'none';
      grip.setAttribute('aria-label', '拖动 ' + name);
      grip.onpointerdown = event => {
        if (drag || grip.disabled || event.button !== 0) return;
        event.preventDefault();
        list.setPointerCapture(event.pointerId);
        drag = {
          id: event.pointerId, source: entry, target: entry,
          move: target => moveRow(context, all, rows, index, rows.findIndex(item => item.key === target), [key, 'drag'])
        };
        entry.classList.add('isDragging');
      };

      const thumb = document.createElement('span');
      thumb.className = 'dockItemThumb abilityIcon';
      thumb.setAttribute('aria-hidden', 'true');
      mountIcon?.(thumb, row);
      entry.append(grip, thumb);

      const label = document.createElement('label'), checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = visible(row, layout);
      checkbox.setAttribute('aria-label', '显示 ' + name);
      checkbox.onchange = () => {
        onHaptic?.('light');
        const excluded = row.curated?.include === false, field = excluded ? 'shown' : 'hidden';
        const keys = new Set(layout[field]);
        if (checkbox.checked === excluded) keys.add(key); else keys.delete(key);
        apply(context, {...layout, [field]: [...keys]}, [key, 'visible']);
      };
      const text = document.createElement('span'), detail = document.createElement('small');
      text.className = 'dockItemName'; text.textContent = name;
      detail.textContent = [
        category, ...new Set(row.activities.map(a => a.activity).filter(value => value && value !== name)),
        groupHidden ? '所属分类已隐藏' : ''
      ].filter(Boolean).join(' · ');
      text.append(detail);
      if (row.curated?.include === false) {
        const reason = document.createElement('small'); reason.className = 'dockItemReason'; reason.textContent = row.curated.label; text.append(reason);
      }
      label.append(checkbox, text); entry.append(label);
      if (focus?.[0] === key) focusTarget = focus[1] === 'drag' ? grip : checkbox;

      for (const [direction, arrow, rank, from, to] of [
        ['置顶', '⤒', all, all.indexOf(row), 0],
        ['上移', '↑', rows, index, index - 1],
        ['下移', '↓', rows, index, index + 1]
      ]) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'dockItemMove'; button.textContent = arrow;
        button.setAttribute('aria-label', direction + ' ' + name);
        button.disabled = Boolean(query) || from === to || to < 0 || to >= rank.length;
        button.onclick = () => {
          onHaptic?.('light');
          moveRow(context, all, rank, from, to, [key, direction]);
        };
        if (focus?.[0] === key && focus[1] === direction && !button.disabled) focusTarget = button;
        entry.append(button);
      }
      nodes.push(entry);
    }
    if (!nodes.length) {
      const empty = document.createElement('li');
      empty.textContent = '没有符合条件的栏位';
      nodes.push(empty);
    }
    list.replaceChildren(...nodes);
    list.scrollTop = scroll;
    focusTarget?.focus({preventScroll: true});
    if (reorder) animateReorder(nodes, reorder);
  }

  list.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    event.preventDefault();
    updateDropTarget(event.clientY);
  });
  list.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    updateDropTarget(event.clientY);
    finishDrag(true);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    list.addEventListener(type, event => { if (drag?.id === event.pointerId) finishDrag(); });
  }

  trigger.addEventListener('click', () => {
    signature = null;
    if (!dialog.open) dialog.showModal();
    render();
  });
  byId('dockSettingsClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => finishDrag());
  filter.onchange = () => { list.scrollTop = 0; render(); };
  search.oninput = () => { list.scrollTop = 0; render(); };
  reset.onclick = () => { const context = scopeLayout(); if (context) apply(context, defaults()); };
  return {
    update() {
      render();
    },
    rows() {
      const layout = scopeLayout()?.layout || defaults();
      return ordered(catalog(), layout.order).filter(row => visible(row, layout));
    },
    isVisible(key) { const row = catalog().find(row => row.key === key.split('/')[0]); return !!row && visible(row, scopeLayout()?.layout || defaults()); }
  };
}
