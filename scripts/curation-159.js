/** Pure default recommendations. Callers supply the HUD-filtered activities. */
export const CURATION_VERSION = 2;
export const REASONS = Object.freeze({
  WEAPON: 'weapon', WEAPON_LEGACY: 'weapon-legacy',
  ACTIVE_COMBAT: 'active-combat', ACTIVE_UTILITY: 'active-utility',
  CONSUMABLE_COMBAT: 'consumable-combat', CONSUMABLE_UTILITY: 'consumable-utility',
  THIRD_PARTY: 'third-party-automation', SPECIAL_USES: 'special-uses',
  PASSIVE: 'passive', NO_ACTIVITY: 'no-activity', NON_COMBAT_UTILITY: 'non-combat-utility',
  DUPLICATE: 'duplicate', UNKNOWN: 'unknown-keep',
  SPELL: 'spell', SPELL_LEGACY: 'spell-legacy', UNCERTAIN: 'uncertain',
  UNPREPARED: 'spell-unprepared', NO_SLOT_CAPACITY: 'spell-no-slot-capacity'
});

const str = x => typeof x === 'string' ? x : '';
const list = x => {
  const value = x?.contents ?? x;
  if (!value || typeof value === 'string') return [];
  try { return Array.from(value); } catch { return []; }
};
const positive = x => {
  if (typeof x !== 'number' && typeof x !== 'string') return false;
  const n = Number(x);
  return Number.isFinite(n) && n > 0;
};
// Iterative leaf inspection avoids serializing documents or following cycles.
function hasMacro(value) {
  const pending = [value], seen = new Set();
  while (pending.length) {
    const v = pending.pop();
    if (typeof v === 'string' && v.trim()) return true;
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    pending.push(...Object.values(v));
  }
  return false;
}
const groupOf = item => item?.type === 'spell' ? 'spells' : item?.type === 'feat' ? 'features'
  : ['weapon', 'equipment', 'consumable', 'tool'].includes(item?.type) ? 'equipment' : 'unknown';
const activeTypes = new Set(['action', 'bonus', 'reaction', 'reactiondamage', 'reactionmanual', 'reactionpreattack', 'legendary', 'lair']);
const combatTypes = new Set(['attack', 'save', 'damage', 'heal', 'enchant', 'summon', 'transform']);
const knownTypes = new Set([...combatTypes, 'utility', 'check']);
const idOf = item => typeof item?.id === 'string' || typeof item?.id === 'number' ? String(item.id) : null;

// Cantrips have no preparation/slot requirement. Unknown legacy preparation stays visible.
export function spellPrepared(item) {
  const system = item?.system ?? {};
  if (Number(system.level) === 0) return true;
  if (system.prepared !== undefined) return system.prepared === true || positive(system.prepared);
  const legacy = system.preparation;
  if (legacy?.mode === 'always') return true;
  if (legacy?.prepared !== undefined) return legacy.prepared === true || positive(legacy.prepared);
  return true;
}

export function hasSpellSlotCapacity(actor, level) {
  if (level < 1 || !actor) return true;
  return Object.entries(actor.system?.spells ?? {}).some(([key, pool]) => {
    if (!positive(pool?.max)) return false;
    const slotLevel = key === 'pact' ? Number(pool.level) : Number(key.match(/^spell([1-9])$/)?.[1]);
    return Number.isFinite(slotLevel) && slotLevel >= level;
  });
}

export function evaluateItem(item, options = {}) {
  options ??= {};
  const bucket = str(options.group) || groupOf(item);
  const result = (include, reasons, label, duplicateOf = null) => ({include, bucket, reasons, label, duplicateOf});
  if (options.duplicateOf != null && ['string', 'number'].includes(typeof options.duplicateOf))
    return result(false, [REASONS.DUPLICATE], '默认推荐已保留同类首项', String(options.duplicateOf));
  if (!item || typeof item !== 'object') return result(false, [REASONS.UNCERTAIN], '数据缺失，无法确定用途');
  // Do not resurrect filtered activities from item.system.activities.
  const acts = list(options.activities).filter(a => a && typeof a === 'object'
    && a.type !== 'forward' && !a.midiProperties?.automationOnly && a.canUse !== false);
  if (bucket === 'spells' || item.type === 'spell') {
    if (!spellPrepared(item))
      return result(false, [REASONS.UNPREPARED], '未准备，默认隐藏；可手动启用');
    if (!hasSpellSlotCapacity(options.actor, Number(item.system?.level) || 0))
      return result(false, [REASONS.NO_SLOT_CAPACITY], '无可用环位上限，默认隐藏；可手动启用');
    return result(true, [acts.length ? REASONS.SPELL : REASONS.SPELL_LEGACY], acts.length ? '保留法术的全部施放用途' : '旧式法术保留原生施放入口');
  }
  if (item.type === 'weapon')
    return result(true, [acts.length ? REASONS.WEAPON : REASONS.WEAPON_LEGACY], '保留武器攻击入口');
  if (!acts.length) return result(false, [REASONS.NO_ACTIVITY, ...(item.type === 'feat' ? [REASONS.PASSIVE] : [])], '无可用活动，默认不占快捷格');
  const macros = item.flags?.['chris-premades']?.macros;
  const automated = hasMacro(macros?.item) || hasMacro(macros?.midi?.item);
  const equipment = ['equipment', 'consumable', 'tool', 'container', 'loot'].includes(item.type);
  const reasons = new Set();
  for (const a of acts) {
    const activation = str(a.activation?.type);
    const uses = positive(item.system?.uses?.max) || positive(a.uses?.max);
    const consumption = list(a.consumption?.targets).length > 0;
    const effects = list(a.effects).length > 0 || list(item.effects).some(e => e && !e.disabled);
    const special = activation === 'special';
    if (special && !(uses || automated || effects)) continue;
    if (!activeTypes.has(activation) && !special) {
      if (activation && !['minute', 'hour', 'day'].includes(activation)) reasons.add(REASONS.UNKNOWN);
      continue;
    }
    const targetType = str(a.target?.affects?.type);
    const self = targetType === 'self' || (!targetType && a.range?.units === 'self');
    const target = !self && (positive(a.target?.affects?.count) || Boolean(str(a.target?.template?.type)));
    const payload = combatTypes.has(a.type) || list(a.damage?.parts).length > 0
      || list(a.save?.ability).length > 0 || positive(a.save?.dc?.value) || Boolean(str(a.save?.dc?.formula))
      || positive(a.healing?.number) || Boolean(str(a.healing?.bonus)) || list(a.healing?.types).length > 0;
    // Resource use alone does not make lamps, rope, food or tools combat actions.
    if (equipment && knownTypes.has(a.type) && !payload && !target && !effects && !automated) continue;
    if (payload || target) reasons.add(item.type === 'consumable' ? REASONS.CONSUMABLE_COMBAT : REASONS.ACTIVE_COMBAT);
    else if (special && uses) reasons.add(REASONS.SPECIAL_USES);
    else if (effects || uses || consumption || automated) reasons.add(item.type === 'consumable' ? REASONS.CONSUMABLE_UTILITY : REASONS.ACTIVE_UTILITY);
    else if (!knownTypes.has(a.type) || (!equipment && !targetType && (!self || a.target?.prompt === true))) reasons.add(REASONS.UNKNOWN);
    if (automated) reasons.add(REASONS.THIRD_PARTY);
  }
  if (reasons.size) return result(true, [...reasons], reasons.has(REASONS.UNKNOWN) ? '用途不确定，有主动迹象，暂保留' : '有主动战斗或资源效果用途');
  return result(false, [equipment ? REASONS.NON_COMBAT_UTILITY : REASONS.PASSIVE], equipment ? '普通工具用途，默认不占快捷格' : '未见主动战斗用途，默认不占格');
}

function signature(item, acts) {
  const name = str(item?.name).toLowerCase().replace(/[\s\p{P}]/gu, '');
  if (!name || !idOf(item)) return null;
  return JSON.stringify([str(item.type), name, list(acts).filter(Boolean)
    .map(a => [str(a.type), str(a.activation?.type)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}

/** decisions are in input order and include itemId for reporting. No input is sorted or changed. */
export function curateGroup(items, options = {}) {
  options ??= {};
  const input = list(items), kept = [], decisions = [], seen = new Map();
  for (const item of input) {
    const activities = typeof options.activitiesOf === 'function' ? options.activitiesOf(item) : [];
    let decision = evaluateItem(item, {group: options.group, actor: options.actor, activities});
    const key = signature(item, activities), first = key == null ? null : seen.get(key);
    if (decision.include && first != null && first !== idOf(item))
      decision = evaluateItem(item, {group: options.group, actor: options.actor, activities, duplicateOf: first});
    if (decision.include) {
      kept.push(item);
      if (key != null && first == null) seen.set(key, idOf(item));
    }
    decisions.push({itemId: idOf(item), ...decision});
  }
  return {items: kept, decisions, stats: {total: input.length, included: kept.length,
    excluded: input.length - kept.length, duplicates: decisions.filter(d => d.duplicateOf !== null).length}};
}

/** groups = {equipment: Item[], features: Item[], spells: Item[]}. */
export function curateAll(groups, options = {}) {
  return Object.fromEntries(['equipment', 'features', 'spells'].map(group =>
    [group, curateGroup(groups?.[group], {...options, group})]));
}
