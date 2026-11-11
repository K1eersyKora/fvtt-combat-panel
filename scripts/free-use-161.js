const ID = 'fvtt-combat-panel';

// Keep existing spellId sources working while allowing an active feature as owner.
export function matchesFreeSource(resource, item) {
  const meta = resource?.flags?.[ID]?.freeCast;
  return Boolean(item?.id && resource?.type === 'feat' && resource.id !== item.id
    && meta && (meta.itemId ?? meta.spellId) === item.id);
}

export function canManageFree(item, activities) {
  return Boolean(item && ['spell', 'feat'].includes(item.type)
    && !item.flags?.[ID]?.freeCast && Array.from(activities ?? []).length);
}

export function freeConsumptionTargets(item, activity, sourceId) {
  const original = item.type === 'spell'
    ? Array.from(activity.consumption?.targets ?? [], t => t.toObject?.() ?? structuredClone(t)) : [];
  return [...original, {type:'itemUses', target:sourceId, value:'1', scaling:{mode:'',formula:''}}];
}
