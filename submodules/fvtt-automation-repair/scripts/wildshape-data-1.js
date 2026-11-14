import{registerMacro,macroStub,isMacroStub}from'./macro-registry-1.js';
const wsGuardSource="return (async()=>{\n const wf=scope?.workflow??scope?.midiData?.workflow??workflow;\n const pass=scope?.midiData?.macroPass??args?.[0]?.macroPass;\n const activity=wf?.activity;\n if(!activity||activity.type!=='transform')return;\n if(pass==='postActiveEffects'){\n  const original=wf.wsOriginal;\n  if(!original)return;\n  for(const uuid of wf.transformedActorUuids??[]){\n   const transformed=await fromUuid(uuid);if(!transformed)continue;\n   // NPC druids with class HP advancements otherwise add their class HP twice after native keep-HP.\n   if(transformed.type==='npc'){\n    const updates=transformed.itemTypes.class.filter(i=>i.system.advancement.some(a=>a.type==='HitPoints')).map(i=>({_id:i.id,'system.advancement':i.toObject().system.advancement.filter(a=>a.type!=='HitPoints')}));\n    if(updates.length)await transformed.updateEmbeddedDocuments('Item',updates);\n    if(transformed.system.attributes.hp.max!==original.hpMax)await transformed.update({'system.attributes.hp.max':original.hpMax});\n   }\n  }\n  // Some installations do not register the native subclass:moon spell list.\n  const level=original.level;\n  if(!original.moon)return;\n  const allowed=new Set(['cure-wounds','moonbeam','starry-wisp',...(level>=5?['conjure-animals']:[]),...(level>=7?['fount-of-moonlight']:[]),...(level>=9?['mass-cure-wounds']:[])]);\n  for(const uuid of wf.transformedActorUuids??[]){\n   const transformed=await fromUuid(uuid);if(!transformed)continue;\n   const missing=original.spells.filter(i=>allowed.has(i.system.identifier)&&!transformed.items.some(j=>j.type==='spell'&&j.system.identifier===i.system.identifier));\n   if(missing.length)await transformed.createEmbeddedDocuments('Item',missing,{keepId:true});\n  }\n  return;\n }\n if(pass!=='preItemRoll')return;\n if(wf.actor.isPolymorphed){ui.notifications.warn('请先使用「解除荒野形态」，再选择新的形态。');return false;}\n if(!activity.canTransform){ui.notifications.warn('荒野形态需要允许玩家变形及创建角色权限。');return false;}\n if(!wf.token){ui.notifications.warn('请先将角色放到场景中，并选中自己的 Token。');return false;}\n const profiles=activity.availableProfiles;\n if(profiles.length!==1){ui.notifications.warn('当前等级没有唯一可用的荒野形态配置，请联系主持人。');return false;}\n const profile=profiles[0];\n const pack=game.packs.get('dnd5e.actors24');\n if(!pack||!pack.visible){ui.notifications.warn('无法访问 SRD 2024 野兽图鉴，请联系主持人。');return false;}\n const maxCR=new Roll(Roll.replaceFormulaData(profile.cr,activity.getRollData(),{missing:'0'})).evaluateSync().total;\n const index=await pack.getIndex({fields:['system.details.type','system.details.cr','system.attributes.movement']});\n const shapes=index.filter(e=>e.type==='npc'&&e.system?.details?.type?.value==='beast'&&!e.system.details.type.swarm&&e.system.details.cr!=null&&e.system.details.cr<=maxCR&&![...profile.movement].some(m=>Number(e.system.attributes?.movement?.[m])>0)).sort((a,b)=>a.name.localeCompare(b.name));\n if(!shapes.length){ui.notifications.warn('图鉴中没有符合等级限制的野兽。');return false;}\n const escape=s=>String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));\n const uuid=await foundry.applications.api.DialogV2.wait({\n  window:{title:'荒野形态 · 选择野兽'},position:{width:440},\n  content:`<p>最高挑战等级：${maxCR}。请选择角色已知的野兽形态。</p><div class=\"form-group\"><label>野兽</label><select name=\"shape\">${shapes.map(e=>`<option value=\"${escape(e.uuid)}\">${escape(e.name)} · CR ${e.system.details.cr}</option>`).join('')}</select></div>`,\n  buttons:[{action:'transform',label:'变形',icon:'fa-solid fa-paw',default:true,callback:(event,button)=>button.form.elements.shape.value},{action:'cancel',label:'取消',callback:()=>null}],\n  close:()=>null,render:(event,app)=>{app.element.style.zIndex='100100';},rejectClose:false\n });\n if(!uuid)return false;\n const beast=await fromUuid(uuid);\n if(!beast||beast.type!=='npc'||beast.system.details.type.value!=='beast'||beast.system.details.type.swarm||beast.system.details.cr==null){ui.notifications.warn('请选择单只野兽，不能选择兽群或召唤模板。');return false;}\n wf.wsOriginal={hpMax:wf.actor.system.attributes.hp.max,level:wf.actor.classes?.druid?.system.levels??0,moon:wf.actor.itemTypes.subclass.some(i=>i.system.identifier==='moon'),spells:wf.actor.itemTypes.spell.map(i=>i.toObject())};\n // Resolve selection before resource consumption; only modify this workflow's transient activity.\n const data=activity.toObject();\n data.transform.mode='';\n data.profiles=[{...data.profiles.find(p=>p._id===profile._id),uuid}];\n activity.updateSource({'transform':data.transform,'profiles':data.profiles});\n const usage=scope?.midiData?.usage??scope?.usage;\n if(usage){usage.transform??={};usage.transform.profile=profile._id;}\n return true;\n})();\n";
registerMacro('wildshape.guard',wsGuardSource);
const wsGuard=macroStub('wildshape.guard');
export const wsRepair = async function(actor,{dryRun=false}={}) {
 const pack=game.packs.get('chris-premades.CPRClassFeatures2024');
 const index=await pack.getIndex();
 const mapping={'wild-shape':'Wild Shape','circle-forms':'Circle Forms','improved-circle-forms':'Improved Circle Forms','beast-spells':'Beast Spells','lunar-form':'Lunar Form'};
 const changes=[];
 const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
 function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
 for(const item of actor.items){
  const name=mapping[item.system.identifier];if(!name)continue;
  if(item.system.source.rules!=='2024')continue;
  const entry=index.find(e=>e.name===name);if(!entry)throw Error('Missing template: '+name);
  const template=(await pack.getDocument(entry._id)).toObject();
  const patch={};
  if(name==='Wild Shape'&&wsGuard){
   const existing=item._source.flags?.dae?.macro?.command;
   if(existing&&!existing.includes('Resolve selection before resource consumption')&&!isMacroStub(existing,'wildshape.guard'))throw Error('Existing item macro needs manual review');
   if(existing!==wsGuard)patch['flags.dae.macro']={name:'Wild Shape: safe selection',type:'script',command:wsGuard};
   const oldMacros=item._source.flags?.['midi-qol']?.onUseMacroName??'';
   const macros=oldMacros.split(',').filter(Boolean);for(const entry of ['[preItemRoll]ItemMacro','[postActiveEffects]ItemMacro'])if(!macros.includes(entry))macros.push(entry);
   if(macros.join(',')!==oldMacros)patch['flags.midi-qol.onUseMacroName']=macros.join(',');
  }
  if(!same(item._source.flags?.['chris-premades']?.info,template.flags['chris-premades'].info))patch['flags.chris-premades.info']=template.flags['chris-premades'].info;
  if(name!=='Circle Forms'&&template.flags['chris-premades'].macros&&!same(item._source.flags?.['chris-premades']?.macros,template.flags['chris-premades'].macros))patch['flags.chris-premades.macros']=template.flags['chris-premades'].macros;
  if(name==='Wild Shape'){
   const old=Object.values(item.toObject().system.activities);
   if(old.length>1)throw Error('Multiple activities need review: '+item.uuid);
   const target=foundry.utils.deepClone(Object.values(template.system.activities)[0]);
   target._id=old[0]?._id??target._id;
   target.name=name==='Wild Shape'?'荒野形态：变形':'结社形态：变形';
   if(name==='Wild Shape'){
    target.consumption=foundry.utils.deepClone(old[0]?.consumption??target.consumption);
    target.consumption.spellSlot=false;
    target.uses={spent:0,recovery:[],max:''};
    target.activation=foundry.utils.deepClone(old[0]?.activation??target.activation);
   }
   // Compare prepared schema to prepared schema to avoid repeated default-field updates.
   const temp=new CONFIG.Item.documentClass({...item.toObject(),system:{...item.toObject().system,activities:{[target._id]:target}}},{parent:actor});
   const desired=temp.toObject().system.activities;
   if(!same(item.toObject().system.activities,desired))patch['system.activities']=desired;
  }
  if(Object.keys(patch).length){
   changes.push({item:item.id,name:item.name,fields:Object.keys(patch)});
   if(!dryRun){const data=item.toObject();for(const [key,value] of Object.entries(patch))foundry.utils.setProperty(data,key,value);await item.update({system:data.system,flags:data.flags},{recursive:false});}
  }
 }
 return changes;
};
