// Pure HUD calculations; resource consumption stays with the native workflow.
const list = value => Array.from(value?.contents ?? value ?? []);
const first = value => value?.first?.() ?? list(value)[0] ?? null;

export function usesLeft(uses) {
  const max = Math.max(0, Number(uses?.max) || 0);
  const current = Number(uses?.value);
  const remaining = Number.isFinite(current) && current >= 0
    ? current : Math.max(0, max - (Number(uses?.spent) || 0));
  return { value: Math.min(max, remaining), max };
}

export function itemFreeUseOption(item, level) {
  const uses = item?.system?.uses;
  const { value, max } = usesLeft(uses);
  if (max <= 0) return null;
  return {
    key: 'item', kind: 'item',
    level: Number(level) || Number(item?.system?.level) || 0,
    label: String(uses?.label || '免费次数'), value, max,
    period: uses?.recovery?.[0]?.period || 'manual'
  };
}

export function resolveConsumptionItem(actor, target) {
  if (typeof target !== 'string' || !target.trim()) return null;
  const items = list(actor?.items);
  const direct = actor?.items?.get?.(target) ?? items.find(i => i?.id === target);
  if (direct) return direct;
  const match = target.match(/^([^:]+):([^:]+)$/);
  const type = match?.[1], identifier = match?.[2] ?? target;
  const sourced = first(actor?.sourcedItems?.get?.(target));
  if (sourced) return sourced;
  const identified = first(type
    ? actor?.identifiedItems?.get?.(identifier, { type })
    : actor?.identifiedItems?.get?.(identifier));
  if (identified) return identified;
  const seen = new Set();
  for (const i of items) {
    if (!i || (i.id != null && seen.has(i.id))) continue;
    if (i.id != null) seen.add(i.id);
    const source = i.flags?.dnd5e?.sourceId;
    if (i.id === target
      || (i.system?.identifier === identifier && (!type || i.type === type))
      || source === target
      || (target.startsWith('Compendium.') && source?.endsWith?.(target))) return i;
  }
  return null;
}

export function resourceMeta(actor, item, activities) {
  const selected = list(activities);
  if (selected.length === 1) {
    const activity = selected[0];
    const target = list(activity?.consumption?.targets).find(t => t.type === 'activityUses');
    if (target) {
      const source = target.target ? item?.system?.activities?.get?.(target.target) : activity;
      const uses = usesLeft(source?.uses);
      if (uses.max > 0) return {kind:'activity',label:source.name || item?.name,...uses,activityId:source.id};
    }
  }
  const own = usesLeft(item?.system?.uses);
  if (own.max > 0) return {
    kind: 'item', label: item?.system?.uses?.label || item?.name,
    ...own, activityId: null
  };
  const acts = list(activities);
  for (const activity of acts) {
    for (const target of list(activity?.consumption?.targets)) {
      if (target?.type !== 'itemUses') continue;
      // Empty targets refer to own uses, already checked above.
      if (!target.target) continue;
      const source = resolveConsumptionItem(actor, target.target);
      const uses = usesLeft(source?.system?.uses);
      if (uses.max > 0) return {
        kind: 'resource', label: source.name, ...uses,
        activityId: activity.id, sourceName: source.name
      };
    }
  }
  for (const activity of acts) {
    const uses = usesLeft(activity?.uses);
    if (uses.max > 0) return {
      kind: 'activity', label: activity.name || item?.name,
      ...uses, activityId: activity.id
    };
  }
  return null;
}

export function baneTargetPlan(item, activity, level) {
  if (item?.type !== 'spell' || activity?.target?.template?.type
    || activity?.type === 'forward' || /bolt/i.test(activity?.identifier || '')) return null;
  const bane = item.system?.identifier === 'bane'
    || item.flags?.['chris-premades']?.info?.identifier === 'bane'
    || /bane|灾祸术/i.test(item.name || '');
  if (!bane) return null;
  const baseLevel = Number(item.system?.level) || 1;
  const castLevel = Math.max(baseLevel, Number(level) || baseLevel);
  return { repeat: false, max: 3 + Math.max(0, castLevel - baseLevel), spell: 'bane' };
}

export function divineSmiteFormula(castLevel, extraDie = false) {
  const n = Math.max(1, Math.floor(Number(castLevel) || 1)) + 1 + (extraDie ? 1 : 0);
  return `${n}d8`;
}

export function isTransferActivity(item, activity) {
  if (!activity) return false;
  const identifier = item?.system?.identifier;
  if (identifier === 'hunters-mark') {
    const moveId = item.flags?.['chris-premades']?.activityIdentifiers?.huntersMarkMove;
    return Boolean((moveId && activity.id === moveId) || /move|转移/i.test(activity.name || ''));
  }
  return identifier === 'vow-of-enmity'
    && (/transfer|转移|换目标/i.test(activity.name || '') || activity.flags?.dsh?.transfer === true);
}
