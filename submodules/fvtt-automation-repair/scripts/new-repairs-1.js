import {usesLeft} from './feature-core-1.js';
const ID='fvtt-automation-repair',CPR='chris-premades',REVISION=4;
const array=v=>Array.from(v?.contents??v??[]),clone=v=>foundry.utils.deepClone(v);
const primary=()=>game.user?.isGM&&game.users.activeGM?.id===game.user.id;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const types={absorbElements:['CPRSpells','Absorb Elements'],twilightSanctuary:['CPRClassFeatures','Channel Divinity: Twilight Sanctuary'],dreadAmbusher:['CPRClassFeatures2024','Dread Ambusher'],wrathOfTheSea:['CPRClassFeatures2024','Wrath of the Sea']};
export function identifyRepair(item={}){
 if(item.flags?.['fvtt-combat-panel']?.freeCast)return null;
 if(item.flags?.[CPR]?.info?.identifier==='wrathOfTheSeaOngoing')return null;
 const id=String(item.system?.identifier??'').replace(/[^a-z]/gi,'').toLowerCase(),name=item.name??'';
 if(id==='absorbelements'||/吸收元素|元素吸收|Absorb Elements/i.test(name))return'absorbElements';
 if(id.includes('twilightsanctuary')||/暮色庇护所|Twilight Sanctuary/i.test(name))return'twilightSanctuary';
 if(item.system?.source?.rules==='2024'&&(id==='dreadambusher'||/恐惧伏击|Dread Ambusher/i.test(name)))return'dreadAmbusher';
 if(id==='wrathofthesea'||/^瀚海之怒|^Wrath of the Sea$/i.test(name))return'wrathOfTheSea';
 if(id==='ghostsightbow'||/幽魂视界弓|Ghost Sight Bow/i.test(name))return'ghostBow';
 if(item.system?.source?.rules==='2024'&&(id==='vowofenmity'||/仇敌誓言|Vow of Enmity/i.test(name)))return'vowOfEnmity';
 return null;
}
async function template(key){const[packId,name]=types[key],pack=game.packs.get(`${CPR}.${packId}`);if(!pack)throw Error(`缺少自动化图鉴 ${packId}`);const row=(await pack.getIndex()).find(i=>i.name===name);if(!row)throw Error(`缺少自动化模板 ${name}`);return(await pack.getDocument(row._id)).toObject();}
function cleanEffect(effect){
 delete effect.origin;delete effect._stats;
 if(effect.flags?.dnd5e)delete effect.flags.dnd5e.dependents;
 effect.duration={...effect.duration,startTime:null,startRound:null,startTurn:null,combat:null};
 return effect;
}
function setTargetSelf(activity){activity.target={override:true,prompt:false,template:{type:'',units:'ft'},affects:{type:'self',choice:false}};activity.range={override:true,units:'self'};}
function copyAutomation(source,tmpl,key){
 const old=Object.values(source.system.activities??{}),used=new Set(),mapping={};
 const activities={};
 for(const raw of Object.values(tmpl.system.activities??{})){
  const target=clone(raw),existing=old.find(a=>!used.has(a._id)&&a.type===target.type);
  if(existing){used.add(existing._id);mapping[target._id]=existing._id;target._id=existing._id;}
  target.otherActivityId='none';target.consumption.spellSlot=false;
  if(target.target)target.target.override=true;if(target.range)target.range.override=true;if(target.duration)target.duration.override=true;
  if(key==='absorbElements')target.consumption.spellSlot=true;
  if(existing&&key==='twilightSanctuary'&&target.type==='utility')target.consumption=clone(existing.consumption);
  if(key==='wrathOfTheSea'){
   const original=old.find(a=>a.consumption?.targets?.some(t=>t.type==='itemUses'));
   if(original)target.consumption=clone(original.consumption);
   setTargetSelf(target);
  }
  if(key==='absorbElements'){
   setTargetSelf(target);target.activation={...target.activation,override:true,type:'reaction',value:1};
   const labels={Acid:'强酸',Cold:'寒冷',Fire:'火焰',Lightning:'闪电',Thunder:'雷鸣'};target.name=labels[target.name]??target.name;
  }
  if(key==='twilightSanctuary')target.name=target.type==='heal'?'暮色庇护所：临时生命':'暮色庇护所：开启';
  if(key==='dreadAmbusher')target.name='恐惧伏击：首回合移动';
  if(key==='wrathOfTheSea')target.name='瀚海之怒：开启';
  activities[target._id]=target;
 }
 source.system.activities=activities;
 source.effects=clone(tmpl.effects??[]).map(cleanEffect);
 source.flags[CPR]=clone(tmpl.flags?.[CPR]??{});
 for(const [key,id]of Object.entries(source.flags[CPR].activityIdentifiers??{}))source.flags[CPR].activityIdentifiers[key]=mapping[id]??id;
 source.flags['midi-qol']={...source.flags['midi-qol'],...clone(tmpl.flags?.['midi-qol']??{})};
 if(key==='absorbElements'){
  source.system.activation=clone(tmpl.system.activation);source.system.target=clone(tmpl.system.target);source.system.duration=clone(tmpl.system.duration);
  if(source.flags.dae)delete source.flags.dae.macro;
  source.flags['midi-qol'].onUseMacroName=String(source.flags['midi-qol'].onUseMacroName??'').split(',').filter(m=>!m.includes('ItemMacro')).join(',');
  for(const effect of source.effects){effect.flags??={};effect.flags.dae??={};effect.flags.dae.selfTarget=true;effect.flags.dae.selfTargetAlways=true;}
 }
 if(key==='dreadAmbusher'){
  const oldCharge=old.find(a=>a.type==='damage'&&a.uses?.max);
  const spent=oldCharge?Number(oldCharge.uses.spent)||0:Number(source.system.uses?.spent)||0;
  source.system.uses={...clone(tmpl.system.uses),spent};
 }
 if(key==='twilightSanctuary'){
  const heal=Object.values(activities).find(a=>a.type==='heal');
  source.flags.dnd5e??={};source.flags.dnd5e.riders={...source.flags.dnd5e.riders,activity:heal?[heal._id]:[]};
 }
 if(key==='wrathOfTheSea')delete source.flags['region-attacher'];
}
export async function planRepair(item){
 const key=identifyRepair(item);if(!key)return null;
 const source=item.toObject();source.flags??={};
 if(source.flags[ID]?.automationRepair?.key===key&&source.flags[ID].automationRepair.revision===REVISION)return null;
 if(types[key])copyAutomation(source,await template(key),key);
 if(key==='ghostBow'){
  source.system.uses.recovery=[{period:'lr',type:'recoverAll'}];
  const visionEffects=new Set(source.effects.filter(e=>/幽魂视界|Ghost Sight/i.test(e.name??'')).map(e=>e._id));
  for(const a of Object.values(source.system.activities??{})){
   a.otherActivityId='none';
   a.effects=(a.effects??[]).filter(e=>!visionEffects.has(e._id));
   if(a.type==='utility'&&/幽魂视界|Ghost Sight/i.test(a.name??'')){
    a.consumption={...a.consumption,spellSlot:false,targets:[{type:'activityUses',target:'',value:'1',scaling:{}}]};
    a.uses={...a.uses,max:a.uses?.max||'1',recovery:[{period:'lr',type:'recoverAll'}]};setTargetSelf(a);
   }
  }
  source.flags['midi-qol']??={};
  source.flags['midi-qol'].onUseMacroName=String(source.flags['midi-qol'].onUseMacroName??'').split(',').filter(m=>!m.includes('MWP-BowGhostSight')).join(',');
 }
 if(key==='vowOfEnmity'){
  const main=Object.values(source.system.activities).find(a=>a._id!=='bg3VowTransfer01');if(!main)throw Error('仇敌誓言缺少原活动');
  main.effects=[];main.otherActivityId='none';main.consumption.spellSlot=false;
  main.target={override:true,prompt:false,template:{type:'',units:'ft'},affects:{type:'creature',count:'1',choice:false}};
  main.range={override:true,units:'ft',value:'30'};
  const transfer=clone(main);transfer._id='bg3VowTransfer01';transfer.name='仇敌誓言：免费转移';transfer.activation={type:'special',value:null,override:true};
  transfer.consumption={spellSlot:false,targets:[{type:'activityUses',target:'',value:'1',scaling:{}}]};
  transfer.uses={max:'1',spent:Number(source.system.activities[transfer._id]?.uses?.spent??1),recovery:[]};source.system.activities[transfer._id]=transfer;
 }
 source.flags[ID]={...source.flags[ID],automationRepair:{key,revision:REVISION}};
 const prepared=new CONFIG.Item.documentClass(source,{parent:item.actor});
 const desired=prepared.toObject();
 const patch={system:desired.system,effects:desired.effects,flags:desired.flags};
 return{key,item,patch,before:item.toObject()};
}
export async function matchAutomationRepairs({actors=[],items=[],apply=false,backup}={}){
 if(!game.user.isGM)throw Error('仅主持人可以迁移自动化');
 const documents=new Set([...items,...actors.flatMap(a=>array(a.items))]);
 const plans=[],errors=[];for(const item of documents){try{const p=await planRepair(item);if(p)plans.push(p);}catch(e){errors.push({uuid:item.uuid,name:item.name,error:e.message});}}
 if(apply&&errors.length)throw Error('自动化迁移预检失败：'+JSON.stringify(errors));
 if(apply&&plans.length){if(!backup)throw Error('自动化迁移必须先提供备份回调');await backup(plans.map(p=>({uuid:p.item.uuid,data:p.before})));for(const p of plans)await p.item.update(p.patch,{diff:false,recursive:false});}
 return{changes:plans.map(p=>({uuid:p.item.uuid,name:p.item.name,key:p.key})),errors};
}
const queues=new Map();
function serial(key,fn){const next=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(fn);queues.set(key,next);next.finally(()=>{if(queues.get(key)===next)queues.delete(key);}).catch(()=>{});return next;}
const getState=item=>item?.actor?.effects.find(e=>!e.disabled&&e.flags?.[ID]?.vow?.itemId===item.id);
function unexpired(effect){return effect&&Number(effect.flags[ID].vow.expires)>game.time.worldTime;}
export async function migrateLiveVows(actors){
 const changed=[],warnings=[];
 for(const actor of actors)for(const item of actor.items){if(identifyRepair(item)!=='vowOfEnmity'||getState(item))continue;
  const origins=new Set([item.uuid,...item.effects.map(e=>e.uuid),...item.system.activities.map(a=>a.uuid)]),matches=[];
  for(const holder of actors)for(const mark of holder.effects){if(mark.disabled||!(/仇敌|enmity/i.test(mark.name??'')))continue;if(!origins.has(mark.origin)&&mark.flags?.['midi-qol']?.dshVowSourceItemUuid!==item.uuid)continue;const remaining=Number(mark.duration?.remaining);if(remaining>0&&remaining<=60)matches.push({holder,mark,remaining});}
  if(matches.length!==1){if(matches.length>1)warnings.push({item:item.uuid,reason:'多个既有誓言标记，保持原数据'});continue;}
  const {holder,mark,remaining}=matches[0],expires=game.time.worldTime+remaining,ready=Number(holder.system.attributes.hp.value)<=0;
  const [state]=await actor.createEmbeddedDocuments('ActiveEffect',[{name:item.name,img:item.img,origin:item.uuid,duration:{seconds:remaining},changes:[],flags:{[ID]:{vow:{itemId:item.id,expires,targetActor:holder.uuid,targetToken:holder.isToken?holder.token.uuid:null,markUuid:mark.uuid,transferReady:ready}}}}]);
  const changes=mark.toObject().changes.filter(c=>c.key!=='flags.midi-qol.grants.advantage.attack.all');changes.push({key:'flags.midi-qol.grants.advantage.attack.all',mode:0,value:`workflow.actor.uuid === ${JSON.stringify(actor.uuid)}`,priority:20});
  await chrisPremades.utils.genericUtils.update(mark,{origin:state.uuid,changes,[`flags.${ID}.vowMark`]:{caster:actor.uuid,item:item.uuid,state:state.uuid}});await state.addDependent(mark);
  await item.update({'system.activities.bg3VowTransfer01.uses.spent':ready?0:1});changed.push({item:item.uuid,mark:mark.uuid,remaining,transferReady:ready});
 }
 return{changed,warnings};
}
async function validateVow(workflow){
 if(identifyRepair(workflow.item)!=='vowOfEnmity')return;
 const item=workflow.actor.items.get(workflow.item.id),target=array(workflow.targets)[0];
 if(workflow.targets.size!==1||!target?.actor||target.actor.uuid===workflow.actor.uuid||Number(target.actor.system.attributes.hp.value)<=0)return false;
 const utils=globalThis.chrisPremades?.utils;
 if(utils&&((canvas.scene.tokenVision&&!utils.tokenUtils.canSee(workflow.token,target))||utils.tokenUtils.getDistance(workflow.token,target)>30)){ui.notifications.warn('仇敌誓言需要可见且30尺内的目标。');return false;}
 if(workflow.activity.id==='bg3VowTransfer01'&&(!unexpired(getState(item))||!getState(item).flags[ID].vow.transferReady)){ui.notifications.warn('仇敌誓言尚未获得免费转移，或原誓言已结束。');return false;}
}
async function applyVow(workflow){
 const item=workflow.actor.items.get(workflow.item.id),target=array(workflow.targets)[0];if(!item||!target?.actor||workflow.aborted)return;
 return serial(item.uuid,async()=>{
  const utils=chrisPremades.utils,transfer=workflow.activity.id==='bg3VowTransfer01';let state=getState(item);
  const expires=transfer&&state?state.flags[ID].vow.expires:game.time.worldTime+60;
  if(transfer&&(!unexpired(state)||!state.flags[ID].vow.transferReady))return;
  if(state&&!transfer){await state.delete();state=null;}
  const old=state?.flags[ID]?.vow?.markUuid;if(old){const effect=await fromUuid(old);if(effect)await utils.genericUtils.remove(effect);}
  if(!state)[state]=await workflow.actor.createEmbeddedDocuments('ActiveEffect',[{name:item.name,img:item.img,origin:item.uuid,duration:{seconds:60},changes:[],flags:{[ID]:{vow:{itemId:item.id,expires}}}}]);
  const mark=await utils.effectUtils.createEffect(target.actor,{name:item.name,img:item.img,origin:state.uuid,duration:{seconds:Math.max(1,expires-game.time.worldTime)},changes:[{key:'flags.midi-qol.grants.advantage.attack.all',mode:0,value:`workflow.actor.uuid === ${JSON.stringify(workflow.actor.uuid)}`,priority:20}],flags:{[ID]:{vowMark:{caster:workflow.actor.uuid,item:item.uuid,state:state.uuid}}}});
  if(!mark)throw Error('仇敌誓言目标标记未创建');
  await state.addDependent(mark);
  await state.update({[`flags.${ID}.vow`]:{itemId:item.id,expires,targetActor:target.actor.uuid,targetToken:target.document.uuid,markUuid:mark.uuid,transferReady:false}});
  await item.update({'system.activities.bg3VowTransfer01.uses.spent':1});
 });
}
async function targetDown(actor,change,options){
 const hp=change['system.attributes.hp.value']??foundry.utils.getProperty(change,'system.attributes.hp.value');
 if(!primary()||hp===undefined||Number(hp)>0||!(Number(options?.[ID]?.previousHP)>0))return;
 const actors=new Map(game.actors.map(a=>[a.uuid,a]));for(const s of game.scenes)for(const t of s.tokens)if(t.actor)actors.set(t.actor.uuid,t.actor);
 for(const owner of actors.values())for(const state of owner.effects){const tag=state.flags?.[ID]?.vow;if(!tag||tag.targetActor!==actor.uuid||tag.transferReady||!unexpired(state))continue;
  const item=owner.items.get(tag.itemId);if(!item)continue;
  await serial(item.uuid,async()=>{if(!unexpired(state)||state.flags[ID].vow.transferReady)return;await state.update({[`flags.${ID}.vow.transferReady`]:true});await item.update({'system.activities.bg3VowTransfer01.uses.spent':0});});
 }
}
async function ghostSight(workflow){
 if(workflow.aborted||identifyRepair(workflow.item)!=='ghostBow'||workflow.activity.type!=='utility'||!/幽魂视界|Ghost Sight/i.test(workflow.activity.name??''))return;
 const source=workflow.item.effects.find(e=>/幽魂视界|Ghost Sight/i.test(e.name));if(!source)return;
 const data=cleanEffect(source.toObject());delete data._id;data.disabled=false;data.transfer=false;data.origin=workflow.actor.items.get(workflow.item.id)?.uuid;data.duration={seconds:60};
 const previous=workflow.actor.effects.filter(e=>e.origin===data.origin&&/幽魂视界|Ghost Sight/i.test(e.name??''));if(previous.length)await workflow.actor.deleteEmbeddedDocuments('ActiveEffect',previous.map(e=>e.id));
 await workflow.actor.createEmbeddedDocuments('ActiveEffect',[data]);
}
const turnKey=()=>game.combat?.started?`${game.combat.uuid}:${game.combat.round}:${game.combat.turn}`:null;
const forceCrit=w=>identifyRepair(w?.item)==='ghostBow'&&w.activity?.type==='attack'&&Number(w.activity.attack?.critical?.threshold)===1;
function validateBow(workflow){if(!forceCrit(workflow))return;const key=turnKey();if(key&&workflow.actor.items.get(workflow.item.id)?.flags?.[ID]?.bowCritTurn===key){ui.notifications.warn('幽魂视界弓：本回合已经使用过追猎重击。');return false;}}
async function attachSea(effect){
 if(!primary()||effect.flags?.[CPR]?.info?.identifier!=='wrathOfTheSeaOngoing'||effect.disabled||!effect.parent?.items)return;
 return serial('sea:'+effect.uuid,async()=>{
  const actor=effect.parent,ongoing=actor.items.find(i=>i.flags?.[CPR]?.info?.identifier==='wrathOfTheSeaOngoing');
  const configured=Number(ongoing?.system.activities.contents[0]?.range?.value),aquatic=actor.items.some(i=>i.system.identifier==='aquatic-affinity'||i.flags?.[CPR]?.info?.identifier==='aquaticAffinity');
  const distance=configured>0?configured:aquatic?10:5;
  for(const scene of game.scenes)for(const token of scene.tokens){if(token.actor?.uuid!==actor.uuid)continue;
   const x=token.x+token.width*scene.grid.size/2,y=token.y+token.height*scene.grid.size/2;
   const current=scene.templates.find(t=>t.flags?.[ID]?.seaAura?.effect===effect.uuid&&t.flags[ID].seaAura.token===token.id);
   if(current){if(current.x!==x||current.y!==y||current.distance!==distance)await current.update({x,y,distance});continue;}
   const [template]=await scene.createEmbeddedDocuments('MeasuredTemplate',[{t:'circle',user:game.user.id,x,y,distance,hidden:token.hidden,fillColor:'#258aca',borderColor:'#6cbdf5',flags:{[ID]:{seaAura:{token:token.id,effect:effect.uuid}}}}]);if(template)await effect.addDependent(template);
  }
 });
}
async function moveSea(token,change){
 if(!primary()||!['x','y','width','height','elevation','hidden'].some(k=>k in change))return;
 const templates=token.parent.templates.filter(t=>t.flags?.[ID]?.seaAura?.token===token.id);if(!templates.length)return;
 const grid=token.parent.grid.size,x=(change.x??token._source.x)+(change.width??token.width)*grid/2,y=(change.y??token._source.y)+(change.height??token.height)*grid/2;
 await token.parent.updateEmbeddedDocuments('MeasuredTemplate',templates.map(t=>({_id:t.id,x,y,hidden:change.hidden??token.hidden})));
}
export function registerAutomationRepairs(){
 Hooks.once('ready',()=>{game.modules.get(ID).api={...game.modules.get(ID).api,automationRepairs:{match:matchAutomationRepairs,plan:planRepair}};});
 Hooks.on('midi-qol.preItemRollV2',({workflow})=>validateVow(workflow));
 Hooks.on('midi-qol.preItemRollV2',({workflow})=>validateBow(workflow));
 Hooks.on('midi-qol.AttackRollComplete',async workflow=>{if(!forceCrit(workflow)||!workflow.attackRoll)return;const key=turnKey();if(key)await workflow.actor.items.get(workflow.item.id)?.update({[`flags.${ID}.bowCritTurn`]:key});});
 Hooks.on('midi-qol.postActiveEffects',async workflow=>{const key=identifyRepair(workflow?.item??{});if(key==='vowOfEnmity')await applyVow(workflow);if(key==='ghostBow')await ghostSight(workflow);});
 Hooks.on('preUpdateActor',(actor,change,options)=>{if(change['system.attributes.hp.value']!==undefined||foundry.utils.hasProperty(change,'system.attributes.hp.value'))options[ID]={...options[ID],previousHP:Number(actor.system.attributes.hp.value)};});
 Hooks.on('updateActor',(actor,change,options)=>{targetDown(actor,change,options).catch(e=>console.error(ID+' | 仇敌誓言',e));});
 Hooks.on('createActiveEffect',effect=>{attachSea(effect).catch(e=>console.error(ID+' | 瀚海范围',e));});
 Hooks.on('createItem',item=>{if(item.flags?.[CPR]?.info?.identifier==='wrathOfTheSeaOngoing')for(const effect of item.actor?.effects??[])attachSea(effect).catch(console.error);});
 Hooks.on('createToken',token=>{for(const effect of token.actor?.effects??[])attachSea(effect).catch(console.error);});
 Hooks.on('deleteToken',token=>{if(!primary()||!game.scenes.has(token.parent?.id))return;const ids=token.parent.templates.filter(t=>t.flags?.[ID]?.seaAura?.token===token.id).map(t=>t.id);if(ids.length)token.parent.deleteEmbeddedDocuments('MeasuredTemplate',ids).catch(console.error);});
 Hooks.on('updateToken',(token,change)=>{moveSea(token,change).catch(e=>console.error(ID+' | 瀚海范围跟随',e));});
 Hooks.on('moveToken',(token,movement)=>{moveSea(token,movement.destination).catch(e=>console.error(ID+' | 瀚海移动',e));});
 Hooks.on('refreshToken',token=>{for(const template of canvas.scene?.templates??[]){if(template.flags?.[ID]?.seaAura?.token!==token.id||!template.object)continue;template.object.position.set(token.center.x,token.center.y);}});
}
