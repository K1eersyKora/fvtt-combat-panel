export function supportsThrow(activity) {
  const item = activity?.item;
  return item?.type === 'weapon' && activity.actionType === 'mwak'
    && item.system.attackType === 'melee' && item.system.properties.has('thr');
}

function reach(activity) {
  const item = activity.item;
  return Number(item.system.range?.reach) || (item.system.properties.has('rch') ? 10 : 5);
}

export function weaponMode(activity, choice, source, target) {
  const original = activity.attackMode;
  let thrown = choice === 'thrown';
  if (choice === 'auto' && source && target) {
    const distance = MidiQOL.computeDistance(source, target, {wallsBlock: false, includeCover: false});
    thrown = Number(distance.toFixed(2)) > reach(activity);
  }
  if (thrown) return original?.endsWith('offhand') ? 'thrown-offhand' : 'thrown';
  if (original === 'thrown-offhand') return 'offhand';
  if (original && original !== 'thrown' && original !== 'ranged') return original;
  return activity.item.system.attackModes.find(m => m.value && !m.value.startsWith('thrown'))?.value ?? 'oneHanded';
}

export function asWeaponMode(activity, mode) {
  const thrown = mode.startsWith('thrown');
  const actKey = 'system.activities.' + activity.id;
  const edits = {
    [actKey + '.attackMode']: mode,
    [actKey + '.attack.type.value']: thrown ? 'ranged' : 'melee',
    ['flags.dnd5e.last.' + activity.id + '.attackMode']: mode
  };
  // A thrown melee weapon keeps its normal attack ability, including finesse.
  if (activity.ability) edits[actKey + '.attack.ability'] = activity.ability;
  if (thrown && !(activity.range?.override && activity.range?.long)) {
    edits[actKey + '.range.override'] = false;
  } else if (!thrown) {
    edits[actKey + '.range'] = {override:true, units:'ft', value:reach(activity), long:0};
  }
  const item = activity.item.clone(edits, {keepId:true});
  return item.system.activities.get(activity.id);
}
