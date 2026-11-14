import {registerMacro,macroStub,isMacroStub} from './macro-registry-1.js';
// Data-only repair for the existing CPR 2024 Dance Bard items.
export const VERSION = '2026-11-11.1';
export const PREFIX = 'flags.midi-qol.optional.dshBardicInspiration';
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
export function inspirationChanges(formula) {
  return [
    {key: `${PREFIX}.attack.fail.all`, mode: 5, value: formula, priority: 20},
    {key: `${PREFIX}.count`, mode: 5, value: '1', priority: 20},
    {key: `${PREFIX}.activation`, mode: 5, value: '!workflow.isCritical', priority: 20},
    {key: `${PREFIX}.label`, mode: 5, value: '诗人激励（攻击失手）', priority: 20}
  ];
}
export const inspirationMacro = `return (async () => {
  const w = scope.workflow;
  if (!w || (scope.midiData?.macroPass ?? args[0]?.macroPass) !== 'preItemRoll') return;
  const u = chrisPremades.utils.itemUtils;
  const scale = w.actor.system.scale[u.getConfig(w.item, 'classIdentifier') || 'bard']?.[u.getConfig(w.item, 'scaleIdentifier') || 'bardic-inspiration'];
  if (!scale?.formula) { ui.notifications.warn('诗人激励：缺少激励骰等级配置。'); return false; }
  const effect = w.item.effects.find(e => e.flags['chris-premades']?.info?.identifier === 'bardicInspirationEffect');
  if (!effect) { ui.notifications.warn('诗人激励：缺少激励效果模板。'); return false; }
  const changes = effect.toObject().changes.map(c => c.key === '${PREFIX}.attack.fail.all' ? {...c, value: scale.formula} : c);
  effect.updateSource({changes});
})();`;
export const unarmedMacro = `return (async () => {
  const w = scope.workflow;
  if (!w || (scope.midiData?.macroPass ?? args[0]?.macroPass) !== 'preItemRoll' || w.activity.type !== 'attack') return;
  const u = chrisPremades.utils.actorUtils;
  const eligible = !u.getEquippedArmor(w.actor) && !u.getEquippedShield(w.actor);
  const ability = eligible && w.actor.system.abilities.dex.mod >= w.actor.system.abilities.str.mod ? 'dex' : 'str';
  w.activity.updateSource({'attack.ability': ability});
})();`;

export async function repairBard(actor) {
  const changes = [];
  const id = i => i.flags['chris-premades']?.info?.identifier;
  const update = async (doc, patch) => {
    const source = doc.toObject();
    const different = Object.fromEntries(Object.entries(patch).filter(([key,value]) => {const current=foundry.utils.getProperty(source,key);return key==='flags.dae.macro'?!Object.entries(value).every(([k,v])=>same(current?.[k],v)):!same(current,value);}));
    if (!Object.keys(different).length) return;
    const fields = Object.keys(different);
    await doc.update(different);
    changes.push({uuid:doc.uuid, fields});
  };
  const attach = async (item, command) => {
    const previous = item._source.flags?.['midi-qol']?.onUseMacroName || '';
    const entries = previous.split(',').map(s=>s.trim()).filter(Boolean);
    const key=command===unarmedMacro?'bard.unarmed':'bard.inspiration';
    registerMacro(key,command);const previousCommand=item.flags.dae?.macro?.command;
    if(previousCommand && previousCommand!==command && !isMacroStub(previousCommand,key))throw Error('Existing ItemMacro must be reviewed: '+item.uuid);
    command=macroStub(key);
    if (!entries.includes('[preItemRoll]ItemMacro')) entries.push('[preItemRoll]ItemMacro');
    await update(item, {'flags.dae.macro':{name:item.name,type:'script',scope:'global',command},'flags.midi-qol.onUseMacroName':entries.join(','),'flags.midi-qol.dshBardRepair':VERSION});
  };
  const dance = actor.items.find(i=>id(i)==='dazzlingFootwork');
  if (dance) for (const item of actor.items.filter(i=>id(i)==='unarmedStrike')) {
    const activity = item.system.activities.get(item.flags['chris-premades'].activityIdentifiers?.punch);
    if (!activity || activity.type !== 'attack') continue;
    await update(item,{[`system.activities.${activity.id}.attack.ability`]:'dex'});
    await attach(item,unarmedMacro);
  }
  for (const item of actor.items.filter(i=>id(i)==='bardicInspiration' && i.system.source.rules === '2024')) {
    const u = chrisPremades.utils.itemUtils;
    const formula = actor.system.scale[u.getConfig(item,'classIdentifier') || 'bard']?.[u.getConfig(item,'scaleIdentifier') || 'bardic-inspiration']?.formula;
    if (!formula) throw Error('Missing Bard scale: '+actor.name);
    const effect = item.effects.find(e=>e.flags['chris-premades']?.info?.identifier==='bardicInspirationEffect');
    if (!effect) throw Error('Missing CPR effect: '+item.uuid);
    await update(effect, {
      changes:[...effect.toObject().changes.filter(c=>!c.key.startsWith(PREFIX+'.')), ...inspirationChanges(formula)],
      'flags.chris-premades.macros.midi.actor':(effect.flags['chris-premades']?.macros?.midi?.actor || []).filter(x=>x!=='bardicInspirationEffect'),
      'flags.midi-qol.dshBardRepair':VERSION
    });
    const patch={};
    for (const a of item.system.activities) if(a.type==='utility') {
      patch[`system.activities.${a.id}.target.affects.type`]='ally';
      patch[`system.activities.${a.id}.target.affects.count`]='1';
    }
    await update(item,patch);
    await attach(item,inspirationMacro);
  }
  return changes;
}
export async function repairExistingInspiration(actor) {
  const changes=[];
  for(const e of actor.effects) {
    if(e.flags['chris-premades']?.info?.identifier!=='bardicInspirationEffect')continue;
    const formula=e.flags['chris-premades']?.bardicInspiration?.formula;
    if(!formula)continue;
    const desired=[...e.toObject().changes.filter(c=>!c.key.startsWith(PREFIX+'.')), ...inspirationChanges(formula)];
    const macros=(e.flags['chris-premades']?.macros?.midi?.actor || []).filter(x=>x!=='bardicInspirationEffect');
    if(same(desired,e.toObject().changes)&&same(macros,e.flags['chris-premades']?.macros?.midi?.actor))continue;
    await e.update({changes:desired,'flags.chris-premades.macros.midi.actor':macros,'flags.midi-qol.dshBardRepair':VERSION});
    changes.push(e.uuid);
  }
  return changes;
}

registerMacro('bard.unarmed',unarmedMacro);registerMacro('bard.inspiration',inspirationMacro);
