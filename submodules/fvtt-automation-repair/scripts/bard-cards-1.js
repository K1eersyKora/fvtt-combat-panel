import {inspirationChanges, PREFIX, repairBard} from './bard-2.js';
import {macroStub, isMacroStub, registerMacro} from './macro-registry-1.js';

const ID = 'fvtt-automation-repair';
const CPR = 'chris-premades';
const GRANT = 'bard.grantModern';
const INSPIRATION = 'bardicInspiration';
const CUTTING = 'cuttingWords';
const EFFECT = 'bardicInspirationEffect';
const legacyOptional = 'flags.midi-qol.optional.诗人激励.';
const queues = new Map();
const primary = () => game.user?.isGM && game.users.activeGM?.id === game.user.id;
const slug = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const idOf = item => item.flags?.[CPR]?.info?.identifier;
const stub = macroStub(GRANT);

function kind(item) {
  if (item?.type !== 'feat') return;
  const id = idOf(item);
  if (id === INSPIRATION || id === CUTTING) return id;
  if (id) return;
  const identifier = slug(item.system?.identifier);
  if (identifier === 'bardicinspiration') return INSPIRATION;
  if (identifier === 'cuttingwords') return CUTTING;
  const source = item._stats?.compendiumSource ?? item.flags?.dnd5e?.sourceId ?? '';
  if (source.endsWith('.class-abilityphb.Item.FSr7TfaoWRPpUtkD')) return INSPIRATION;
  if (source.endsWith('.classes.Item.phbbrdCuttingWor')) return CUTTING;
  const name = item.name?.trim() ?? '';
  if (/^(?:(?:吟游)?诗人激励(?:\s*Bardic Inspiration)?|Bardic Inspiration)$/i.test(name)) return INSPIRATION;
  if (/^(?:语出惊人(?:\s*Cutting Words)?|Cutting Words)$/i.test(name)) return CUTTING;
}

// The compiled macro is shared by every card. Only its tiny registry call is persisted.
registerMacro(GRANT, 'return game.modules.get("fvtt-automation-repair").api.bard.grant(workflow ?? scope.workflow);');

function bardScale(item) {
  const config = item.flags?.[CPR]?.config ?? {};
  const classId = config.classIdentifier || 'bard';
  const scales = item.actor?.system.scale?.[classId] ?? {};
  const legacy = item.system.source?.rules !== '2024';
  for (const key of [config.scaleIdentifier, ...(legacy ? ['inspiration','bardic-inspiration'] : ['bardic-inspiration','inspiration'])]) {
    if (key && scales[key]?.formula) return {classId, key, formula: scales[key].formula};
  }
}

function templateOf(item) {
  const effects = Array.from(item.effects).filter(e => !e.transfer && e.type !== 'enchantment');
  return effects.find(e => e.flags?.[CPR]?.info?.identifier === EFFECT)
    ?? effects.find(e => e.changes.some(c => c.key.startsWith(legacyOptional) || c.key.startsWith(PREFIX+'.')))
    ?? effects.find(e => /^(?:诗人激励|(?:吟游)?诗人激励\s*Bardic Inspiration|Bardic Inspiration)$/i.test(e.name));
}

async function grant(workflow) {
  if (!workflow || workflow.targets.size !== 1) return;
  const item = workflow.item;
  const marker = item.flags[ID]?.bardGrant;
  if (!marker || workflow.activity.id !== marker.activity) return;
  const scale = bardScale(item), template = templateOf(item);
  const modern = chrisPremades.utils.macroUtils.getMacro(INSPIRATION, 'modern');
  const handler = modern?.midi?.item?.find(entry => entry.pass === 'rollFinished');
  if (!scale || !template || !handler) throw Error('诗人激励缺少施放者的骰阶、效果或 CPR 2024 自动化。');

  // CPR reads the first effect and looks up the die on the caster. Feed it only
  // the selected template, without changing the owned card or copied dependents.
  const effect = template.toObject();
  effect.origin = item.uuid;
  foundry.utils.setProperty(effect, 'flags.dnd5e.dependents', []);
  for (const change of effect.changes) if (change.key === PREFIX+'.attack.fail.all') change.value = scale.formula;
  const card = item.clone({effects:[effect], ['flags.'+CPR+'.config.classIdentifier']:scale.classId,
    ['flags.'+CPR+'.config.scaleIdentifier']:scale.key}, {keepId:true});
  const {actor, activity, targets, token} = workflow;
  await handler.macro({workflow:{actor, activity, targets, token, item:card}, trigger:{entity:card}});
}

function previousGrant(command) {
  // Adopt the one-off 2026-11-18 card, including copies whose embedded IDs changed.
  return typeof command === 'string' && command.includes('const grant = modern?.midi?.item?.find(entry => entry.pass === "rollFinished");')
    && command.includes('const bonusKey = "flags.midi-qol.optional.dshBardicInspiration.attack.fail.all";')
    && command.trim().endsWith('await grant.macro({workflow: w, trigger: {entity: w.item}});\n})();');
}

function field(source, patch, path, value) {
  if (!foundry.utils.objectsEqual({value:foundry.utils.getProperty(source,path)}, {value})) patch[path] = value;
}

function inspirationPatch(item, scale) {
  const src = item.toObject();
  const command = src.flags.dae?.macro?.command ?? src.flags.itemacro?.macro?.command;
  if (command && !isMacroStub(command,GRANT) && !previousGrant(command)) return;
  const activities = Object.values(src.system.activities);
  const utilities = activities.filter(a => a.type === 'utility');
  const saved = src.flags[ID]?.bardGrant?.activity;
  let activity = utilities.find(a => a._id === saved)
    ?? utilities.find(a => a.activation?.type === 'bonus' && /@scale\./.test(a.roll?.formula ?? ''))
    ?? (utilities.length === 1 ? utilities[0] : undefined);
  if (!activity && activities.length) return;
  const patch = {};
  if (!activity) {
    activity = {_id:foundry.utils.randomID(), type:'utility', activation:{type:'bonus',value:1},
      target:{affects:{type:'ally',count:'1'}}, range:{value:'60',units:'ft'},
      duration:src.system.source?.rules === '2024' ? {value:'1',units:'hour'} : {value:'10',units:'minute'},
      consumption:{targets:[{type:'itemUses',target:'',value:'1'}]}, effects:[], roll:{formula:''}};
  }
  const existing = templateOf(item);
  const template = existing ? existing.toObject() : {_id:foundry.utils.randomID(),name:'诗人激励',img:item.img,type:'base',transfer:false,changes:[],flags:{}};
  const changes = template.changes.filter(c => !c.key.startsWith(legacyOptional) && !c.key.startsWith(PREFIX+'.'));
  template.changes = [...changes, ...inspirationChanges(scale.formula)];
  const cpr = template.flags[CPR] ??= {};
  cpr.info = {...cpr.info, identifier:EFFECT};
  cpr.rules = 'modern';
  const macros = cpr.macros ??= {};
  for (const key of ['check','save','skill']) macros[key] = [...new Set([...(macros[key] ?? []), EFFECT])];
  if (macros.midi?.actor?.includes(EFFECT)) macros.midi.actor = macros.midi.actor.filter(m => m !== EFFECT);
  template.flags.dae = {...template.flags.dae, dontApply:true, stackable:'noneNameOnly'};
  if (!existing || !foundry.utils.objectsEqual(template, existing.toObject())) {
    patch.effects = existing ? src.effects.map(e => e._id === template._id ? template : e) : [...src.effects,template];
  }
  const base = 'system.activities.'+activity._id;
  if (!src.system.activities[activity._id]) {
    activity.effects = [{_id:template._id}];
    patch[base] = activity;
  } else {
    if (!activity.effects.some(e => e._id === template._id)) patch[base+'.effects'] = [...activity.effects,{_id:template._id}];
    if (activity.roll?.formula) patch[base+'.roll.formula'] = '';
  }
  field(src,patch,'flags.'+CPR+'.info.identifier', INSPIRATION);
  field(src,patch,'flags.'+ID+'.bardGrant',{activity:activity._id});
  if (command !== stub) patch['flags.dae.macro'] = {...src.flags.dae?.macro,name:item.name,type:'script',scope:'global',command:stub};
  const onUse = (src.flags['midi-qol']?.onUseMacroName ?? '').split(',').map(s=>s.trim()).filter(Boolean);
  if (!onUse.includes('[postActiveEffects]ItemMacro')) patch['flags.midi-qol.onUseMacroName'] = [...onUse,'[postActiveEffects]ItemMacro'].join(',');
  return patch;
}

function cuttingPatch(item, inspiration, scale) {
  const src = item.toObject(), cpr = src.flags[CPR] ?? {};
  if (src.system.source?.rules !== '2024') return;
  const list = Object.values(src.system.activities), useId = cpr.activityIdentifiers?.use;
  const activity = list.find(a => a._id === useId) ?? list.find(a => a.type === 'damage' && a.activation?.type === 'reaction')
    ?? (list.length === 1 && ['damage','utility'].includes(list[0].type) ? list[0] : undefined);
  if (!activity && list.length) return;
  const patch = {}, id = activity?._id ?? foundry.utils.randomID(), base='system.activities.'+id;
  const cost = activity?.consumption?.targets ?? [];
  const poolCosts = cost.filter(t => t.type === 'itemUses');
  if (poolCosts.length > 1) return;
  const priorTarget = poolCosts[0]?.target;
  if (priorTarget && priorTarget !== inspiration.id && item.actor.items.has(priorTarget) && kind(item.actor.items.get(priorTarget)) !== INSPIRATION) return;
  const targets = poolCosts.length ? cost.map(t => t === poolCosts[0] ? {...t,target:inspiration.id} : t)
    : [...cost,{type:'itemUses',value:'1',target:inspiration.id}];
  const standardPart={number:null,denomination:null,bonus:'@scale.'+scale.classId+'.'+scale.key+'.die',types:['midi-none'],custom:{enabled:false,formula:''}};
  if (!activity || activity.type !== 'damage') {
    const data = {...activity,_id:id,type:'damage',activation:{...activity?.activation,type:'reaction'},
      range:{value:'60',units:'ft',...activity?.range},target:activity?.target ?? {affects:{type:'creature',count:'1'}},
      consumption:{...activity?.consumption,targets}, damage:{critical:{allow:false},parts:[standardPart]}};
    delete data.roll;
    patch[base] = data;
  } else {
    field(src,patch,base+'.consumption.targets',targets);
    const parts=activity.damage?.parts ?? [];
    if (!parts.length) patch[base+'.damage.parts']=[standardPart];
    else if (parts.length === 1 && /^@scale\.[\w-]+\.[\w-]+\.die$/.test(parts[0].bonus) && parts[0].types?.includes('midi-none')) {
      field(src,patch,base+'.damage.parts',[{...parts[0],bonus:standardPart.bonus}]);
    }
  }
  field(src,patch,'flags.'+CPR+'.info.identifier',CUTTING);
  field(src,patch,'flags.'+CPR+'.activityIdentifiers.use',id);
  for (const path of ['midi.actor','skill','check','item']) {
    const key='flags.'+CPR+'.macros.'+path, slots=foundry.utils.getProperty(src,key) ?? [];
    if (!slots.includes(CUTTING)) patch[key]=[...slots,CUTTING];
  }
  // CPR supplies the three reaction prompts; Midi's generic reaction picker would duplicate them.
  field(src,patch,'flags.midi-qol.reactionCondition','false');
  return patch;
}

async function repairActor(actor, options) {
  const changes=[], updates=[];
  const newlyIdentified=new Set();
  const features=actor.items.filter(i=>kind(i)===INSPIRATION);
  const cutting=actor.items.filter(i=>kind(i)===CUTTING);
  for (const item of features) {
    const scale=bardScale(item);
    if (!scale) continue;
    if (item.flags[CPR]?.macros?.midi?.item?.includes(INSPIRATION)) continue; // Native CPR grant.
    const patch=inspirationPatch(item,scale);
    if (patch && Object.keys(patch).length) {
      newlyIdentified.add(item.id);
      changes.push({uuid:item.uuid,fields:Object.keys(patch)});
      updates.push({_id:item.id,...patch});
    }
  }
  if (cutting.length) {
    // Use exactly the resource card that CPR's reaction eligibility check will consult.
    const inspiration=actor.items.find(i=>idOf(i)===INSPIRATION || newlyIdentified.has(i.id));
    const scale=inspiration && bardScale(inspiration);
    if (scale) for (const item of cutting) {
      const patch=cuttingPatch(item,inspiration,scale);
      if (patch && Object.keys(patch).length) {
        changes.push({uuid:item.uuid,fields:Object.keys(patch)});
        updates.push({_id:item.id,...patch});
      }
    }
  }
  if (updates.length) await actor.updateEmbeddedDocuments('Item',updates,{bardCardSync:true});
  if (options.footwork || features.some(i=>idOf(i)===INSPIRATION && i.system.source.rules==='2024' && !i.flags[ID]?.bardGrant))
    changes.push(...await repairBard(actor,{footwork:!!options.footwork}));
  return changes;
}

export function syncBardActor(actor, options={}) {
  if (!actor || actor.pack || !game.user.isGM || !actor.isOwner) return Promise.resolve([]);
  const key=actor.uuid, last=queues.get(key) ?? Promise.resolve();
  const next=last.catch(()=>{}).then(()=>repairActor(actor,options));
  queues.set(key,next);
  return next.finally(()=>{if(queues.get(key)===next) queues.delete(key);});
}

const relevantActor = actor => actor?.items?.some(item => !!kind(item));
function schedule(actor) {
  if (primary() && !game.modules.get(ID).api.migrating && relevantActor(actor))
    syncBardActor(actor).catch(error=>console.error(ID+' | 诗人自动化',actor.uuid,error));
}

async function scan() {
  if (!primary()) return [];
  const changes=[];
  const actors=game.actors.filter(relevantActor);
  for (const scene of game.scenes) for (const token of scene.tokens) {
    if (token.actorLink || !token.delta?._source?.items?.length) continue;
    if (relevantActor(game.actors.get(token.actorId)) || token.delta._source.items.some(item=>kind(item))) {
      if (relevantActor(token.actor)) actors.push(token.actor);
    }
  }
  for (const actor of actors) {
    try { changes.push(...await syncBardActor(actor)); }
    catch(error) { console.error(ID+' | 诗人自动化',actor.uuid,error); }
  }
  return changes;
}

export const bardAutomation={grant,syncActor:syncBardActor,scan};
export function registerBardHooks() {
  const changedItem=(item,options)=>{
    if (!options?.bardCardSync && (kind(item) || item.type==='class' || item.type==='subclass')) schedule(item.actor);
  };
  Hooks.on('createItem',(item,options)=>changedItem(item,options));
  Hooks.on('deleteItem',(item,options)=>changedItem(item,options));
  Hooks.on('updateItem',(item,change,options)=>{
    if (options?.bardCardSync || Object.keys(foundry.utils.flattenObject(change)).every(k=>k==='_id' || k.startsWith('_stats.') || k==='system.uses.spent')) return;
    changedItem(item,options);
  });
  Hooks.on('createActor',schedule);
  Hooks.on('updateActor',(actor,change)=>{if ('items' in change || change.system?.scale) schedule(actor);});
  Hooks.on('createToken',token=>{if (!token.actorLink) schedule(token.actor);});
  Hooks.on('updateToken',(token,change)=>{if (!token.actorLink && (change.delta?.items || 'actorId' in change)) schedule(token.actor);});
  Hooks.on('userConnected',user=>{if(user.isGM && primary()) scan().catch(console.error);});
  scan().catch(console.error);
}
