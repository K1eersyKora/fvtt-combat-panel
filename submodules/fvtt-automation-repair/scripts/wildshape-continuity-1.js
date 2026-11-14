import {namespaceSocket} from './socket-1.js';
const ID='fvtt-automation-repair',transitions=new Map(),reverting=new Set();let socket;
Hooks.once('socketlib.ready',()=>{socket=namespaceSocket('wildshape');socket.register('revert',async function({actorUuid}){
 const actor=await fromUuid(actorUuid),user=game.users.get(this.socketdata?.userId);
 if(!game.user.isGM||!user||!actor?.testUserPermission(user,'OWNER')||!actor.isPolymorphed)return null;
 const result=await actor.revertOriginalForm({renderSheet:false});return result?.uuid??null;
});});
const clone=v=>foundry.utils.deepClone(v);
const values=v=>Array.from(v?.contents??v??[]);
const concentrating=e=>!e.disabled&&e.statuses?.has(CONFIG.specialStatusEffects.CONCENTRATING);
const alive=data=>!data.duration?.seconds||data.duration.startTime==null||data.duration.startTime+data.duration.seconds>game.time.worldTime;
function remap(value,from,to){if(typeof value==='string')return value.split(from).join(to);if(Array.isArray(value))return value.map(v=>remap(v,from,to));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v,from,to)]));return value;}
function rebase(value,from,to){let out=remap(value,from,to);const a=from.startsWith('Scene.')?from.split('.Actor.')[0]:null,b=to.startsWith('Scene.')?to.split('.Actor.')[0]:null;if(a&&b&&a!==b)out=remap(out,a,b);return out;}
function permittedSpells(actor,settings){
 const allowed=new Set(),spells=actor.itemTypes.spell;
 if(settings.keep.has('spells')&&!settings.spellLists.size)for(const item of spells)allowed.add(item.id);
 for(const key of settings.spellLists){const entry=game.dnd5e.registry.spellLists.forType(...key.split(':'));if(!entry||!actor.items.some(i=>i.type===entry.metadata.type&&i.system.identifier===entry.metadata.identifier))continue;const identifiers=new Set(entry.identifiers??[]);for(const item of spells)if(identifiers.has(item.system.identifier))allowed.add(item.id);}
 const level=Number(actor.classes?.druid?.system.levels)||0;
 if(actor.items.some(i=>i.type==='subclass'&&i.system.identifier==='moon')){const ids=new Set(['cure-wounds','moonbeam','starry-wisp',...(level>=5?['conjure-animals']:[]),...(level>=7?['fount-of-moonlight']:[]),...(level>=9?['mass-cure-wounds']:[])]);for(const item of spells)if(ids.has(item.system.identifier))allowed.add(item.id);}
 if(actor.items.some(i=>i.system.identifier==='beast-spells'||i.flags?.['chris-premades']?.info?.identifier==='beastSpells'))for(const item of spells)if(!(Number(item.system.materials?.cost)>0)&&!item.system.materials?.consumed)allowed.add(item.id);
 return allowed;
}
function graph(actor){
 const roots=actor.effects.filter(concentrating),queue=[...roots],seen=new Map();
 while(queue.length){const doc=queue.shift();if(!doc||seen.has(doc.uuid))continue;seen.set(doc.uuid,doc);for(const child of doc.getDependents?.()??[])if(child)queue.push(child);const region=doc.flags?.['region-attacher']?.attachedRegion;if(typeof region==='string'){const linked=fromUuidSync(region);if(linked)queue.push(linked);}}
 // Older CPR effects may link to the root only through origin/concentrationEffectUuid.
 for(const effect of actor.effects)if(roots.some(root=>[effect.origin,effect.flags?.['chris-premades']?.concentrationEffectUuid].some(ref=>ref===root.uuid||(typeof ref==='string'&&ref.endsWith(`Actor.${actor.id}.ActiveEffect.${root.id}`)&&!fromUuidSync(ref)))))seen.set(effect.uuid,effect);
 return {roots,own:[...seen.values()].filter(d=>d.documentName==='ActiveEffect'&&d.parent?.uuid===actor.uuid),external:[...seen.values()].filter(d=>d.parent?.uuid!==actor.uuid)};
}
async function update(document,patch){return chrisPremades.utils.genericUtils.update(document,patch);}
async function detach(effects){for(const effect of effects)if(effect.flags?.dnd5e?.dependents?.length)await update(effect,{'flags.dnd5e.dependents':[]});}
async function retireCopies(effects){for(const effect of effects){const patch={'flags.dnd5e.dependents':[]};if(effect.flags?.['chris-premades']){patch['flags.chris-premades.macros']={};patch['flags.chris-premades.info']={};}await update(effect,patch);}}
async function rebindExternal(external,from,to){
 for(const old of external){const doc=await fromUuid(old.uuid);if(!doc)continue;const source=doc.toObject(),next=rebase({origin:source.origin,flags:source.flags},from,to);const patch={};if(next.origin!==source.origin&&source.origin!==undefined)patch.origin=next.origin;if(JSON.stringify(next.flags)!==JSON.stringify(source.flags))patch.flags=next.flags;if(Object.keys(patch).length)await update(doc,patch);for(const behavior of values(doc.behaviors)){const before=behavior.toObject().system,after=rebase(before,from,to);if(JSON.stringify(before)!==JSON.stringify(after))await update(behavior,{system:after});}}
}
async function restoreEffects(actor,data,from,to){
 const updates=[],creates=[];
 for(const raw of data){if(!alive(raw))continue;const source=rebase(clone(raw),from,to);delete source._stats;const existing=actor.effects.get(source._id);if(existing)updates.push(source);else creates.push(source);}
 if(updates.length)await actor.updateEmbeddedDocuments('ActiveEffect',updates,{diff:false,recursive:false});
 if(creates.length)await actor.createEmbeddedDocuments('ActiveEffect',creates,{keepId:true});
}
/** Repair only dangling same-actor synthetic references; never replace a live other token. */
export async function repairDanglingConcentration(actor){
 if(!actor.isToken||!actor.effects.some(concentrating))return[];
 const mappings=new Set();
 for(const e of actor.effects){const serialized=JSON.stringify({origin:e.origin,flags:e.flags});const re=/Scene\.([A-Za-z0-9]+)\.Token\.([A-Za-z0-9]+)\.Actor\.([A-Za-z0-9]+)/g;let m;
  while((m=re.exec(serialized))){if(m[3]!==actor.id||game.scenes.get(m[1])?.tokens.has(m[2]))continue;mappings.add(m[0]);}
 }
 const changed=[];
 for(const from of mappings){const current=graph(actor),data=current.own.map(e=>e.toObject());await restoreEffects(actor,data,from,actor.uuid);await rebindExternal(current.external,from,actor.uuid);changed.push({from,to:actor.uuid});}
 return changed;
}
export function registerWildShapeContinuity(){
 Hooks.on('midi-qol.preItemRollV2',({workflow})=>{const anchor=workflow.item?.flags?.[ID]?.concentrationAnchor;if(!anchor)return;if(anchor.initialActivities.includes(workflow.activity.id)||workflow.activity.duration?.concentration){ui.notifications.warn('兽形中可以维持这个法术，但不能重新施放。');return false;}});
 libWrapper.register(ID,'CONFIG.Actor.documentClass.prototype.endConcentration',async function(wrapped,target){
  const state=transitions.get(this.uuid);
  if(state&&target?.documentName==='Item'&&state.itemIds.has(target.id))return [];
  return wrapped(target);
 },'MIXED');
 libWrapper.register(ID,'CONFIG.Actor.documentClass.prototype.transformInto',async function(wrapped,source,settings,options={}){
  if(settings?.preset!=='wildshape')return wrapped(source,settings,options);
  const current=graph(this),from=this.uuid,raw=current.own.map(e=>e.toObject());
  for(const data of raw){if(!data.statuses?.includes(CONFIG.specialStatusEffects.CONCENTRATING))continue;const id=data.flags?.dnd5e?.item?.id,item=this.items.get(id);if(item){data.flags.dnd5e.item.data=item.toObject();}}
  const itemIds=new Set(current.roots.map(e=>e.flags?.dnd5e?.item?.id).filter(Boolean));
  const permitted=permittedSpells(this,settings);
  // Keep source spell documents until the new form exists. Otherwise native
  // Item deletion destroys their effect dependents on the GM client.
  const safeSettings=itemIds.size?new settings.constructor({...settings.toObject(),keep:[...new Set([...settings.keep,'spells'])],spellLists:[]}):settings;
  transitions.set(from,{itemIds});
  let result;
  try{result=await wrapped(source,safeSettings,options);}finally{transitions.delete(from);}
  const actor=Array.isArray(result)?result[0]?.actor:result?.actor??(result?.documentName==='Actor'?result:null);
  if(!actor)return result;
  if(itemIds.size){
   const remove=actor.itemTypes.spell.filter(i=>!permitted.has(i.id)&&!itemIds.has(i.id));if(remove.length)await actor.deleteEmbeddedDocuments('Item',remove.map(i=>i.id));
   const anchors=actor.itemTypes.spell.filter(i=>itemIds.has(i.id)&&!permitted.has(i.id));
   if(anchors.length)await actor.updateEmbeddedDocuments('Item',anchors.map(i=>({_id:i.id,'system.prepared':0,[`flags.${ID}.concentrationAnchor`]:{initialActivities:current.roots.filter(e=>e.flags?.dnd5e?.item?.id===i.id).map(e=>e.flags?.dnd5e?.activity?.id).filter(Boolean)}})));
  }
  if(raw.length){await restoreEffects(actor,raw,from,actor.uuid);await rebindExternal(current.external,from,actor.uuid);}
  await actor.update({[`flags.${ID}.shapeContinuity`]:{sourceActor:from,sourceEffectIds:raw.map(e=>e._id)}});
  if(actor.uuid!==from&&current.own.length){await retireCopies(current.own);await this.deleteEmbeddedDocuments('ActiveEffect',current.own.map(e=>e.id));}
  return result;
 },'WRAPPER');
 libWrapper.register(ID,'CONFIG.Actor.documentClass.prototype.revertOriginalForm',async function(wrapped,options={}){
  const marker=this.flags?.[ID]?.shapeContinuity;if(!marker)return wrapped(options);
  if(this.isToken&&!game.user.isGM&&!game.user.can('TOKEN_CREATE')){
   if(!game.users.activeGM)throw Error('解除未链接棋子的荒野形态需要一名在线主持人。');
   const uuid=await socket.executeAsGM('revert',{actorUuid:this.uuid});return uuid?fromUuid(uuid):null;
  }
  if(reverting.has(this.uuid))return;
  reverting.add(this.uuid);
  const from=this.uuid,current=graph(this),raw=current.own.map(e=>e.toObject());
  const spellIds=new Set(current.roots.map(e=>e.flags?.dnd5e?.item?.id).filter(Boolean));
  const spellEffectDependencies=this.items.filter(i=>spellIds.has(i.id)).flatMap(i=>i.effects.contents).filter(e=>e.flags?.dnd5e?.dependents?.length).map(e=>({effect:e,dependencies:clone(e.flags.dnd5e.dependents)}));
  for(const entry of spellEffectDependencies)await update(entry.effect,{'flags.dnd5e.dependents':[]});
  await retireCopies(current.own);
  let result;
  try{
   result=await wrapped(options);
   const actor=result?.actor??(result?.documentName==='Actor'?result:null);
   if(!actor){await restoreEffects(this,raw,from,from);return result;}
   const wanted=new Set(raw.map(e=>e._id));
   const stale=actor.effects.filter(e=>marker.sourceEffectIds.includes(e.id)&&!wanted.has(e.id));
   if(stale.length){await detach(stale);await actor.deleteEmbeddedDocuments('ActiveEffect',stale.map(e=>e.id));}
   await restoreEffects(actor,raw,from,actor.uuid);await rebindExternal(current.external,from,actor.uuid);
   await actor.update({[`flags.${ID}.-=shapeContinuity`]:null});
   return result;
  }catch(error){const live=await fromUuid(from);if(live)await restoreEffects(live,raw,from,from);for(const entry of spellEffectDependencies){const effect=await fromUuid(entry.effect.uuid);if(effect)await update(effect,{'flags.dnd5e.dependents':entry.dependencies});}throw error;}
  finally{reverting.delete(from);}
 },'WRAPPER');
}
