import {namespaceSocket} from './socket-1.js';
import {registerAttackManeuvers,matchAttackManeuvers} from './maneuvers-1.js';
const MODULE_ID='fvtt-automation-repair', ID='fvtt-battle-master',VERSION='0.1.6';
const list=x=>Array.from(x?.contents??x??[]);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jobs=new Set(),attackLocks=new Set(),sourceLocks=new Set(),dialogs=new Map(),approvals=new Map();
let socket;
function sender(context){return game.users.get(context?.socketdata?.userId??game.user.id);}
async function authorizedRequest(plan,user){
  const source=await fromUuid(plan.sourceActorUuid),feature=await fromUuid(plan.featureUuid);
  if(!source||feature?.actor?.uuid!==source.uuid||maneuverKind(feature)!==plan.kind)return false;
  if(plan.kind==='commander')return source.testUserPermission(user,'OWNER');
  const trigger=await fromUuid(plan.triggerActorUuid),target=await documentToken(plan.fixedTargetUuid);
  return plan.kind==='riposte'&&plan.attackActorUuid===source.uuid&&!!trigger?.testUserPermission(user,'OWNER')&&target?.actor?.uuid===trigger.uuid;
}
function approved(plan){
  const saved=approvals.get(plan.id);
  if(!saved||saved.until<Date.now()||saved.choice.nonce!==plan.choice?.nonce)return false;
  return ['sourceActorUuid','featureUuid','kind','attackActorUuid','attackTokenUuid','costSource','die'].every(k=>saved.plan[k]===plan[k])
    &&['weaponId','activityId','targetUuid'].every(k=>saved.choice[k]===plan.choice[k]);
}
export function maneuverKind(item){
  if(item?.type!=='feat')return null;
  const ids=[item.system?.identifier,item.flags?.['chris-premades']?.info?.identifier,item.flags?.[MODULE_ID]?.battleMaster?.kind].filter(Boolean).map(s=>String(s).replace(/[^a-z]/gi,'').toLowerCase());
  if(ids.some(s=>['riposte','maneuversriposte'].includes(s)))return 'riposte';
  if(ids.some(s=>['commandersstrike','maneuverscommandersstrike','commander'].includes(s)))return 'commander';
  if(/^(?:战技[：:]?\s*)?反击(?:\s+Riposte)?$/i.test(item.name??''))return 'riposte';
  if(/指挥官奇袭|commander.?s strike/i.test(item.name??''))return 'commander';
  return null;
}
export function superiority(actor,feature,preferred){
  const shared=list(actor?.items).filter(i=>{
    if(i.type!=='feat'||i.flags?.['fvtt-combat-panel']?.freeCast)return false;
    const id=String(i.system?.identifier??'').replace(/[^a-z]/gi,'').toLowerCase();
    return ['superioritydice','combatsuperiority'].includes(id)||i.flags?.['chris-premades']?.info?.identifier==='superiorityDice'||/卓越骰|卓越之骰/.test(i.name??'');
  });
  if(feature?.system?.uses?.max>0)shared.push(feature);
  if(preferred){const free=list(actor?.items).find(i=>(i.id===preferred||i.uuid===preferred)&&(i.flags?.['fvtt-combat-panel']?.freeCast?.itemId??i.flags?.['fvtt-combat-panel']?.freeCast?.spellId)===feature.id&&!i.flags['fvtt-combat-panel'].freeCast.disabled);if(free)shared.push(free);}
  const resource=shared.find(i=>(!preferred||i.id===preferred||i.uuid===preferred)&&Number(i.system?.uses?.value)>0);
  if(!resource)return null;
  const fighter=Number(actor.classes?.fighter?.system?.levels)||Number(actor.system?.details?.level)||3;
  const scale=actor.system?.scale?.['battle-master']?.['combat-superiority-die'];
  const raw=resource.flags?.[MODULE_ID]?.battleMaster?.die??scale?.die??(Number(scale?.faces)?'d'+scale.faces:null);
  const die=/^(?:1)?d(?:6|8|10|12)$/.test(String(raw))?String(raw).replace(/^1/,''):(fighter>=18?'d12':fighter>=10?'d10':'d8');
  return {resource,die,remaining:Number(resource.system.uses.value)};
}
function owner(actor){
  const users=list(game.users).filter(u=>u.active&&actor?.testUserPermission(u,'OWNER'));
  return users.find(u=>!u.isGM)??users.find(u=>u.id===game.users.activeGM?.id)??users[0];
}
function reactionUsed(actor){return !!MidiQOL.hasUsedReaction(actor)||list(actor.appliedEffects).some(e=>e.statuses?.has?.('incapacitated')||e.statuses?.has?.('unconscious')||e.statuses?.has?.('dead'));}
function distance(a,b){
  try{const result=MidiQOL.computeDistance(a,b,{wallsBlock:true,includeCover:false});return result>=0?result:Infinity;}catch{return Infinity;}
}
function attackRange(item,activity){
  const melee=activity.actionType==='mwak';
  if(melee)return Math.max(5,Number(activity.range?.reach)||Number(item.system?.range?.reach)||0,item.system.properties?.has?.('rch')?10:0);
  return Number(activity.range?.long)||Number(item.system?.range?.long)||Number(activity.range?.value)||Number(item.system?.range?.value)||5;
}
function weaponChoices(actor,kind){
  return list(actor?.items).filter(i=>i.type==='weapon'&&i.system.equipped).flatMap(item=>{
    const acts=list(item.system.activities).filter(a=>a.type==='attack'&&a.canUse!==false&&['mwak','rwak'].includes(a.actionType));
    const activity=acts.find(a=>a.activation?.type==='action')??acts[0];
    return activity&&(kind!=='riposte'||activity.actionType==='mwak')?[{item,activity}]:[];
  });
}
function validTarget(attacker,target,weapon,kind){
  return !!(attacker?.actor&&target?.actor&&!target.destroyed&&attacker.id!==target.id&&(game.user.isGM||target.visible)&&distance(attacker,target)<=attackRange(weapon.item,weapon.activity)+.1);
}
async function documentToken(uuid){const doc=await fromUuid(uuid);return doc?.object??null;}
async function remote(name,userId,data){
  if(userId===game.user.id)return await handlers[name](data);
  return await socket.executeAsUser(name,userId,data);
}
async function requestAttack(request){
  if(!await authorizedRequest(request,sender(this)))return null;
  const actor=await fromUuid(request.attackActorUuid),token=await documentToken(request.attackTokenUuid);
  if(!actor?.isOwner||!token||reactionUsed(actor)||attackLocks.has(actor.uuid))return null;
  const choices=weaponChoices(actor,request.kind);
  const targetsFor=weapon=>list(canvas.tokens?.placeables).filter(t=>validTarget(token,t,weapon,request.kind)&&(!request.fixedTargetUuid||t.document.uuid===request.fixedTargetUuid));
  const available=choices.filter(w=>targetsFor(w).length);
  if(!available.length)return null;
  if(dialogs.has(request.id))return null;
  return new Promise(resolve=>{
    const el=document.createElement('dialog');el.className='bm-maneuver-dialog';el.dataset.bmRequest=request.id;el.style.cssText='width:440px;max-width:90vw;padding:22px;border:1px solid #b7985e;border-radius:9px;background:#1a1511;color:#f4e8d1;z-index:10000';
    const label=request.kind==='riposte'?'反击':'指挥官奇袭';
    el.innerHTML=`<form><h2>${label} · 是否立即攻击？</h2><p>${esc(request.reason)}</p><p><strong>${esc(actor.name)}</strong> 使用反应进行一次武器攻击，命中时加入 <strong>1${esc(request.die)}</strong> 卓越骰伤害。${request.kind==='riposte'?'消耗你的 1 枚卓越骰。':'消耗指挥者的 1 枚卓越骰。'}</p><label>武器<select name="weapon" style="width:100%">${available.map((w,n)=>`<option value="${n}">${esc(w.item.name)} · ${esc(w.activity.name||'攻击')}</option>`).join('')}</select></label><label>攻击目标<select name="target" style="width:100%"></select></label><p data-bm-error role="alert"></p><footer style="display:flex;gap:10px;margin-top:18px"><button type="button" data-bm-no>不使用</button><button type="submit" data-bm-yes>使用反应攻击</button></footer></form>`;
    const form=el.querySelector('form');let done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);dialogs.delete(request.id);el.remove();resolve(value);};
    const populate=()=>{const weapon=available[Number(form.elements.weapon.value)];const targets=targetsFor(weapon).sort((a,b)=>(a.document.disposition===token.document.disposition)-(b.document.disposition===token.document.disposition));form.elements.target.innerHTML=targets.map(t=>`<option value="${esc(t.document.uuid)}">${esc(t.name)}</option>`).join('');};
    form.elements.weapon.addEventListener('change',populate);populate();
    form.addEventListener('submit',ev=>{ev.preventDefault();const weapon=available[Number(form.elements.weapon.value)],target=canvas.tokens.placeables.find(t=>t.document.uuid===form.elements.target.value);if(reactionUsed(actor)||!validTarget(token,target,weapon,request.kind)){el.querySelector('[role=alert]').textContent='反应或目标已不可用，请取消后重试。';return;}const choice={weaponId:weapon.item.id,activityId:weapon.activity.id,targetUuid:target.document.uuid,userId:game.user.id,nonce:foundry.utils.randomID(32)};approvals.set(request.id,{plan:{...request},choice,until:Date.now()+120000});setTimeout(()=>approvals.delete(request.id),120000);finish(choice);});
    el.querySelector('[data-bm-no]').addEventListener('click',()=>finish(null));el.addEventListener('cancel',ev=>{ev.preventDefault();finish(null);});el.addEventListener('close',()=>finish(null));
    const timer=setTimeout(()=>finish(null),60000);dialogs.set(request.id,el);document.body.append(el);el.showModal();
  });
}
async function performAttack(plan){
  if(!approved(plan))return {started:false,reason:'approval-missing-or-changed'};
  const source=await fromUuid(plan.sourceActorUuid);if(!source?.testUserPermission(sender(this),'OWNER'))return {started:false,reason:'source-permission-denied'};
  approvals.delete(plan.id);
  const actor=await fromUuid(plan.attackActorUuid),token=await documentToken(plan.attackTokenUuid),target=await documentToken(plan.choice.targetUuid);
  if(!actor?.isOwner||!token||reactionUsed(actor)||attackLocks.has(actor.uuid))return {started:false,reason:'reaction-unavailable'};
  const weapon=weaponChoices(actor,plan.kind).find(w=>w.item.id===plan.choice.weaponId&&w.activity.id===plan.choice.activityId);
  if(!weapon||!validTarget(token,target,weapon,plan.kind))return {started:false,reason:'weapon-or-target-unavailable'};
  attackLocks.add(actor.uuid);
  const priorTargets=new Set(game.user.targets),priorCount=Number(actor.getFlag('midi-qol','actions')?.reactionsUsed)||0;
  const reactionKey='flags.midi-qol.actions.reactionsUsed';
  const priorEffects=list(actor.effects).filter(e=>list(e.changes).some(c=>c.key===reactionKey)).map(e=>e.toObject());
  let started=false;
  const rollHook=Hooks.on('midi-qol.AttackRollComplete',wf=>{if(wf.item?.flags?.[MODULE_ID]?.battleMaster?.attack?.id===plan.id&&wf.attackRoll)started=true;});
  try{
    const clone=weapon.item.clone({}, {keepId:true});
    // Prepared damage.parts already contains the weapon base. Copy only stored
    // activity parts; includeBase will add the weapon base once on the use clone.
    const parts=list(weapon.activity.toObject().damage?.parts).map(p=>foundry.utils.deepClone(p));
    const damageType=list(weapon.item.system.damage?.base?.types)[0]??list(parts[0]?.types)[0]??'slashing';
    parts.push({number:1,denomination:Number(plan.die.replace(/\D/g,'')),bonus:'',types:[damageType],custom:{enabled:false},scaling:{mode:'',number:1}});
    clone.updateSource({[`system.activities.${weapon.activity.id}.damage.parts`]:parts,[`system.activities.${weapon.activity.id}.activation.type`]:'reactionmanual',[`flags.${MODULE_ID}.battleMaster.attack`]:{id:plan.id,kind:plan.kind,die:plan.die}});clone.prepareFinalAttributes?.();
    const activity=clone.system.activities.get(weapon.activity.id);
    await MidiQOL.setReactionUsed(actor);
    for(const t of [...game.user.targets])t.setTarget(false,{releaseOthers:false});target.setTarget(true,{releaseOthers:false});
    const raw=await MidiQOL.completeActivityUse(activity,{consume:{resources:true,spellSlot:false},midiOptions:{isReaction:true,isTriggered:true,targetUuids:[target.document.uuid],ignoreUserTargets:true,checkGMStatus:false,proceedChecks:{checkReaction:false,checkBonusAction:false},workflowOptions:{targetConfirmation:'none',autoRollAttack:true,autoRollDamage:'onHit',autoFastAttack:true,autoFastDamage:true,fastForwardAttack:true}}},{configure:false});
    const workflow=raw?.workflow??raw;
    started=started||!!workflow?.attackRoll;
    if(!started)return {started:false,reason:'attack-cancelled'};
    const result={started:true,actor:actor.uuid,weapon:weapon.item.name,target:target.document.uuid,die:plan.die,attackTotal:workflow.attackTotal??workflow.attackRoll?.total,damageTotal:workflow.damageTotal,damage:workflow.damageRolls?.map(r=>({formula:r.formula,total:r.total,type:r.options.type})),critical:workflow.isCritical,hit:list(workflow.hitTargets).map(t=>t.document.uuid)};
    game.modules.get(MODULE_ID).api.battleMaster.lastAttack=result;return result;
  }catch(error){console.error(`[${ID}] weapon workflow failed`,error);return {started,reason:String(error.message??error)};}
  finally{
    Hooks.off('midi-qol.AttackRollComplete',rollHook);
    if(!started&&(Number(actor.getFlag('midi-qol','actions')?.reactionsUsed)||0)===priorCount+1){
      const ids=list(actor.effects).filter(e=>list(e.changes).some(c=>c.key===reactionKey)).map(e=>e.id);
      if(ids.length)await actor.deleteEmbeddedDocuments('ActiveEffect',ids);
      if(priorEffects.length)await actor.createEmbeddedDocuments('ActiveEffect',priorEffects,{keepId:true});
    }
    const changed=[...game.user.targets].some(t=>t!==target&&!priorTargets.has(t));
    if(!changed){for(const t of [...game.user.targets])if(!priorTargets.has(t))t.setTarget(false,{releaseOthers:false});for(const t of priorTargets)if(!t.destroyed)t.setTarget(true,{releaseOthers:false});}
    attackLocks.delete(actor.uuid);
  }
}
async function commitManeuver(plan){
  if(jobs.has(plan.id))return {started:false,reason:'duplicate'};
  const user=sender(this);
  if(plan.kind==='commander'?!await authorizedRequest(plan,user):!approved(plan))return {started:false,reason:'source-permission-or-approval-denied'};
  const source=await fromUuid(plan.sourceActorUuid),feature=await fromUuid(plan.featureUuid),attackActor=await fromUuid(plan.attackActorUuid);
  const resource=superiority(source,feature,plan.costSource),controller=owner(attackActor);
  if(!source?.isOwner||feature?.actor?.uuid!==source.uuid||maneuverKind(feature)!==plan.kind||!resource||!controller||reactionUsed(attackActor))return {started:false,reason:'resource-or-reaction-unavailable'};
  if(sourceLocks.has(resource.resource.uuid))return {started:false,reason:'resource-busy'};
  jobs.add(plan.id);if(jobs.size>1000)jobs.delete(jobs.values().next().value);
  sourceLocks.add(resource.resource.uuid);
  try{
  const spent=Number(resource.resource.system.uses.spent)||0;
  await resource.resource.update({'system.uses.spent':spent+1});
  let result;
  try{result=await remote('performAttack',controller.id,{...plan,die:resource.die});}
  catch(error){console.error(`[${ID}] attack failed`,error);result={started:false,reason:String(error.message??error)};}
  if(!result?.started&&Number(resource.resource.system.uses.spent)===spent+1)await resource.resource.update({'system.uses.spent':spent},{[ID]:{settlingCost:true}});
  game.modules.get(MODULE_ID).api.battleMaster.lastCommit={...result,kind:plan.kind,source:source.uuid,resource:resource.resource.uuid};return result;
  }finally{sourceLocks.delete(resource.resource.uuid);}
}
const handlers={requestAttack,performAttack,commitManeuver};
async function askPlan(workflow,feature,attackToken,fixedTarget,preferred){
  const kind=maneuverKind(feature),resource=superiority(feature.actor,feature,preferred),controller=owner(attackToken?.actor);
  if(!resource||!controller||reactionUsed(attackToken.actor))return null;
  const plan={id:`${workflow.sequenceId??workflow.id??foundry.utils.randomID()}:${feature.uuid}:${attackToken.id}`,kind,sourceActorUuid:feature.actor.uuid,featureUuid:feature.uuid,triggerActorUuid:workflow.actor.uuid,attackActorUuid:attackToken.actor.uuid,attackTokenUuid:attackToken.document.uuid,fixedTargetUuid:fixedTarget?.document.uuid,die:resource.die,reason:kind==='riposte'?`${workflow.actor.name} 的近战攻击未命中 ${attackToken.name}。`:`${feature.actor.name} 选择了 ${attackToken.name} 进行指挥官奇袭。`};
  plan.costSource=resource.resource.uuid;
  const choice=await remote('requestAttack',controller.id,plan);
  if(!choice||workflow.aborted||workflow.abort)return null;
  return {...plan,choice};
}
async function onMiss(workflow){
  if(!workflow?.activity?.attack||!['mwak','msak'].includes(workflow.activity.actionType)||!workflow.token||workflow[ID]?.missChecked)return;
  workflow[ID]={...(workflow[ID]??{}),missChecked:true,plans:workflow[ID]?.plans??[]};
  for(const target of list(workflow.targets)){
    if(workflow.hitTargets?.has(target)||workflow.hitTargetsEC?.has(target)||!target.actor||reactionUsed(target.actor))continue;
    const feature=target.actor.items.find(i=>maneuverKind(i)==='riposte');if(!feature||!superiority(target.actor,feature))continue;
    if(!weaponChoices(target.actor,'riposte').some(w=>validTarget(target,workflow.token,w,'riposte')))continue;
    const plan=await askPlan(workflow,feature,target,workflow.token);if(plan)workflow[ID].plans.push(plan);
  }
}
async function beforeUse({workflow,usage}){
  const item=workflow?.item,kind=maneuverKind(item);if(kind!=='commander')return;
  // Remove the legacy Commander handler only on the per-use clone; the module owns the immediate attack.
  const cpr=list(item.flags?.['chris-premades']?.macros?.midi?.item).filter(id=>!['maneuversRiposte','maneuversCommandersStrike'].includes(id));
  item.updateSource({'flags.chris-premades.macros.midi.item':cpr});
  const targets=list(workflow.targets),target=targets[0];
  if(targets.length!==1||!target?.actor||target.actor.uuid===workflow.actor.uuid||target.document.disposition!==workflow.token?.document.disposition||target.actor.statuses?.has('deafened')){ui.notifications.warn('指挥官奇袭：请选择一名能听见你的盟友。');return false;}
  const free=list(workflow.activity.consumption.targets).find(t=>t.type==='itemUses'&&((workflow.actor.items.get(t.target)?.flags?.['fvtt-combat-panel']?.freeCast?.itemId??workflow.actor.items.get(t.target)?.flags?.['fvtt-combat-panel']?.freeCast?.spellId)===item.id));
  if(!superiority(workflow.actor,item,free?.target)){ui.notifications.warn('没有可用卓越骰或免费次数。');return false;}
  const plan=await askPlan(workflow,item,target,null,free?.target);if(!plan)return false;
  workflow[ID]={plans:[plan]};
  // Defer superiority cost until the target accepts and the parent workflow completes.
  workflow.activity.updateSource({'consumption.targets':[],'consumption.spellSlot':false});usage.consume={...usage.consume,resources:false,spellSlot:false};
}
function afterCleanup(workflow){
  const state=workflow?.[ID];if(!state?.plans?.length||state.queued||workflow.aborted||workflow.abort)return;
  state.queued=true;
  for(const plan of state.plans)setTimeout(async()=>{try{const actor=await fromUuid(plan.sourceActorUuid),controller=owner(actor);if(controller)await remote('commitManeuver',controller.id,plan);}catch(error){console.error(`[${ID}] commit failed`,error);}},0);
}
function filterReactions(activities,options,triggerType,activityUuids){
  const removed=new Set();
  for(let i=activities.length-1;i>=0;i--){const activity=activities[i];if(maneuverKind(activity?.item)==='riposte'&&superiority(activity.actor,activity.item)){removed.add(activity.uuid);activities.splice(i,1);}}
  if(Array.isArray(activityUuids))for(let i=activityUuids.length-1;i>=0;i--)if(removed.has(activityUuids[i]))activityUuids.splice(i,1);
}
Hooks.once('socketlib.ready',()=>{socket=namespaceSocket('battleMaster');for(const [name,handler]of Object.entries(handlers))socket.register(name,handler);});
Hooks.once('ready',()=>{
  if(game.modules.get('fvtt-lucky')?.active||game.modules.get('fvtt-battle-master')?.active)return;
  game.modules.get(MODULE_ID).api.battleMaster={version:VERSION,maneuverKind,superiority,weaponChoices,requestAttack,commitManeuver,matchAttackManeuvers};
  registerAttackManeuvers({socket,superiority,owner,sourceLocks});
  Hooks.on('midi-qol.preItemRollV2',beforeUse);
  Hooks.on('midi-qol.ReactionFilter',filterReactions);
  Hooks.on('midi-qol.hitsChecked',onMiss);
  Hooks.on('midi-qol.postCleanup',afterCleanup);
  Hooks.on('midi-qol.RollComplete',workflow=>{setTimeout(()=>{if(workflow.currentAction===workflow.WorkflowState_Completed)afterCleanup(workflow);},100);});
  console.log(`[${ID}] ready ${VERSION}`);
});
