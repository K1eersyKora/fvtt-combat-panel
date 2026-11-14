import{macroStub,registerMacro}from'./macro-registry-1.js';
const ID='fvtt-automation-repair',CPR='chris-premades',clone=v=>foundry.utils.deepClone(v);
const cache=new Map();
registerMacro('legacy.healersKit',"const wf=scope?.workflow??workflow;const target=wf?.targets?.first()?.actor;const death=target?.system?.attributes?.death;const valid=!!death&&Number(target.system.attributes.hp.value)===0&&Number(death.failure??0)<3&&!target.statuses?.has('dead');const pass=scope?.midiData?.macroPass??args?.[0]?.macroPass??wf?.macroPass;if(pass==='preItemRoll'){if(!valid)ui.notifications.warn('请选择一名仍存活、生命值为0的目标。');return valid;}if(valid)await chrisPremades.utils.genericUtils.update(target,{'system.attributes.death.success':3});");
async function repairLegacyHealersKit(item){
 const source=item.toObject(),activities=clone(source.system.activities??{}),garbage=Object.entries(activities).filter(([id,a])=>!a||a._id!==id||!a.type);
 // A historical import embedded the entire Item inside its activities dictionary.
 if(garbage.length){if(activities.system?.identifier!==source.system.identifier)throw Error('Unknown malformed healer kit activities');for(const[id]of garbage)delete activities[id];}
 const action=Object.values(activities).find(a=>a.type==='utility');if(!action)throw Error('Healer kit requires its original utility activity');
 action.consumption={...action.consumption,spellSlot:false};
 const command=macroStub('legacy.healersKit'),entries=String(source.flags?.['midi-qol']?.onUseMacroName??'').split(',').filter(Boolean);
 for(const entry of ['[preItemRoll]ItemMacro','[postActiveEffects]ItemMacro'])if(!entries.includes(entry))entries.push(entry);
 const flags={...source.flags,dae:{...source.flags?.dae,macro:{...source.flags?.dae?.macro,name:'Healer kit stabilization',type:'script',command}},'midi-qol':{...source.flags?.['midi-qol'],onUseMacroName:entries.join(',')},[ID]:{...source.flags?.[ID],legacyTemplate:{key:'healerskit',version:'1'}}};
 const system={...source.system,activities};
 if(same(source.system,system)&&same(source.flags,flags))return[];
 await item.update({system,flags},{diff:false,recursive:false});
 return[{uuid:item.uuid,kind:'legacyHealersKit',removedMalformedActivityKeys:garbage.map(([id])=>id)}];
}
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const known={bless:['Bless','spells'],alert:['Alert','feats'],healerskit:["Healer's Kit",'items'],charmperson:['Charm Person','spells'],protectionfromevilandgood:['Protection from Evil and Good','spells'],faeriefire:['Faerie Fire','spells']};
export async function repairLegacyCard(item){
 if(item.flags?.['fvtt-combat-panel']?.freeCast)return[];
 const key=String(item.flags?.[CPR]?.info?.identifier??item.system?.identifier??'').replace(/[^a-z]/gi,'').toLowerCase();
 const match=known[key];if(!match)return[];
 const [name,type]=match,modern=item.system.source?.rules==='2024';
 if(key==='healerskit'&&!modern)return repairLegacyHealersKit(item);
 const packNames={spells:'CPRSpells',feats:'CPRFeats',items:'CPRItems'};
 const packId=`${CPR}.${packNames[type]}${modern?'2024':''}`;
 const pack=game.packs.get(packId);if(!pack)throw Error('缺少图鉴 '+packId);
 const cacheKey=packId+':'+name;let template=cache.get(cacheKey);
 if(!template){const row=(await pack.getIndex()).find(r=>r.name===name);if(!row)throw Error('缺少模板 '+cacheKey);template=(await pack.getDocument(row._id)).toObject();cache.set(cacheKey,template);}
 const info=item.flags?.[CPR]?.info,latest=template.flags?.[CPR]?.info;
 if(info&&latest&&info.version===latest.version&&info.identifier===latest.identifier&&same(item.flags[CPR].macros??{},template.flags[CPR].macros??{}))return[];
 const source=item.toObject(),oldActivities=Object.values(source.system.activities??{}),map={},used=new Set();
 const system=clone(template.system);system.description=clone(source.system.description);system.source=clone(source.system.source);
 for(const field of ['uses','quantity','prepared','method','attunement','equipped'])if(field in source.system)system[field]=clone(source.system[field]);
 const activities={};for(const raw of Object.values(system.activities??{})){const match=oldActivities.find(a=>!used.has(a._id)&&a.type===raw.type);if(match){used.add(match._id);map[raw._id]=match._id;raw._id=match._id;}activities[raw._id]=raw;}system.activities=activities;
 const cpr=clone(template.flags[CPR]);for(const[key,id]of Object.entries(cpr.activityIdentifiers??{}))cpr.activityIdentifiers[key]=map[id]??id;
 if(source.flags[CPR]?.config)cpr.config={...cpr.config,...clone(source.flags[CPR].config)};
 const effects=clone(template.effects??[]).map(e=>{delete e.origin;delete e._stats;if(e.flags?.dnd5e)delete e.flags.dnd5e.dependents;return e;});
 const flags={...source.flags,[CPR]:cpr,[ID]:{...source.flags[ID],legacyTemplate:{key,version:latest?.version??''}}};
 await item.update({system,effects,flags},{diff:false,recursive:false});
 return[{uuid:item.uuid,kind:'legacyTemplate',key,from:info?.version??null,to:latest?.version??null}];
}
export async function repairLegacyWeapon(item){
 const changes=[],patch={},raw=item.toObject();
 if(/方天画戟/.test(item.name)){
  patch['system.uses.max']='4';patch['system.uses.recovery']=[{period:'lr',type:'recoverAll'}];
  const hooks='[preItemRoll]MWP-HalberdChargeGate,[preAttackRoll]MWP-HalberdSpendFeint,[preAttackRollConfig]MWP-HalberdFeintAdvantage,[preCheckHits]MWP-HalberdPrecision,[postActiveEffects]MWP-HalberdMarkUtility';
  patch['flags.midi-qol.onUseMacroName']=hooks;
  for(const a of item.system.activities){patch[`system.activities.${a.id}.otherActivityId`]='none';if(/诡诈攻击|反击|精准攻击/.test(a.name??''))patch[`system.activities.${a.id}.consumption.targets`]=[];}
 }
 if(item.system?.identifier==='great-weapon-fighting'&&item.system.source.rules==='2024'){
  for(const e of item.effects){const current=e.toObject().changes,next=current.map(c=>c.key==='flags.midi-qol.onUseMacroName'?{...c,value:'ItemMacro,preDamageRollConfig'}:c);if(!same(next,current)){await e.update({changes:next});changes.push({uuid:e.uuid,kind:'gwfStage'});}}
 }
 const GWM='item.itemType === "weapon" && ["simpleM", "martialM", "simpleR", "martialR"].includes(item.type?.value) && item.properties?.has("hvy") && activity.type === "attack" && activity.activation?.type === "action" && activity.attack?.type?.classification === "weapon"';
 if(item.system?.source?.rules==='2024'&&/巨武器大师|Great Weapon Master/i.test(item.name))for(const e of item.effects){const current=e.toObject().changes,next=current.map(c=>c.key==='flags.midi-qol.optional.GWM.count'?{...c,value:'every'}:c.key==='flags.midi-qol.optional.GWM.activation'?{...c,value:GWM}:c);if(!same(next,current)){await e.update({changes:next});changes.push({uuid:e.uuid,kind:'gwmPerAttack'});}}
 for(const[key,value]of Object.entries(patch))if(JSON.stringify(foundry.utils.getProperty(raw,key))===JSON.stringify(value))delete patch[key];
 if(Object.keys(patch).length){const fields=Object.keys(patch);await item.update(patch);changes.push({uuid:item.uuid,kind:'legacyWeapon',fields});}
 return changes;
}
export async function repairLegacyActor(actor){
 const changes=[],wands=actor.items.filter(i=>/星辉秘银魔杖/.test(i.name));
 if(wands.length){
  const obsolete=new Set(wands.flatMap(w=>[w.uuid,game.actors.get(actor.id)?.items.get(w.id)?.uuid].filter(Boolean)).flatMap(uuid=>[`[postDamageRoll]ItemMacro.${uuid}`,`[postDamageRoll]ItemMacro.${uuid}|${uuid}`]));
  const before=actor._source.flags?.['midi-qol']?.onUseMacroName??'',after=before.split(',').filter(p=>!obsolete.has(p.trim())).join(',');if(before!==after){await actor.update({'flags.midi-qol.onUseMacroName':after});changes.push({uuid:actor.uuid,kind:'mithralMacroCleanup'});}
  for(const effect of actor.effects.filter(e=>e.name==='秘银爆 · 星辉蓄能'&&wands.some(w=>w.uuid===e.origin))){const current=effect.toObject().changes,next=current.map(c=>c.key==='flags.midi-qol.onUseMacroName'?{...c,value:'MWP-MithralConsume,postDamageRoll'}:c);if(!same(next,current)){await effect.update({changes:next});changes.push({uuid:effect.uuid,kind:'mithralChargeConsumption'});}}
 }
 if(actor.items.some(i=>i.system.source?.rules==='2024'&&/巨武器大师|Great Weapon Master/i.test(i.name))&&actor._source.flags?.['midi-qol']?.optional?.GWM){
  const current=actor._source.flags['midi-qol'].optional.GWM,patch={},condition='item.itemType === "weapon" && ["simpleM", "martialM", "simpleR", "martialR"].includes(item.type?.value) && item.properties?.has("hvy") && activity.type === "attack" && activity.activation?.type === "action" && activity.attack?.type?.classification === "weapon"';
  for(const[key,value]of Object.entries({count:'every',activation:condition,force:true}))if(current[key]!==value)patch[`flags.midi-qol.optional.GWM.${key}`]=value;
  if(Object.keys(patch).length){await actor.update(patch);changes.push({uuid:actor.uuid,kind:'gwmStoredFlags'});}
 }
 return changes;
}
