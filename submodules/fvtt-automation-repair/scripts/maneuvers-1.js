import {namespaceSocket} from './socket-1.js';
const MODULE_ID='fvtt-automation-repair', ID='fvtt-battle-master';
const list = value => Array.from(value?.contents ?? value ?? []);
const normalized = value => String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
const SAVE_ID = 'BmFearSave000001';
const EFFECT_ID = 'BmMenacingFear01';
let runtime;
const costQueues = new Map();

function onOwner(actor, name, data) {
  const controller = runtime.owner(actor);
  if (!controller) return null;
  return controller.id === game.user.id ? handlers[name](data) : runtime.socket.executeAsUser(name, controller.id, data);
}

function serializeCost(actor, operation) {
  const previous = costQueues.get(actor.uuid) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  costQueues.set(actor.uuid, current);
  current.finally(() => {if(costQueues.get(actor.uuid) === current)costQueues.delete(actor.uuid);}).catch(() => {});
  return current;
}

async function spendOnOwner(request) {
  const actor = await fromUuid(request.actorUuid), item = await fromUuid(request.featureUuid);
  const user = game.users.get(this?.socketdata?.userId ?? game.user.id);
  if (!actor?.isOwner || !actor.testUserPermission(user,'OWNER') || item?.actor?.uuid !== actor.uuid || attackManeuverKind(item) !== request.kind) return null;
  return serializeCost(actor, async()=>{
    const resource = runtime.superiority(actor,item,request.resourceUuid);
    if(!resource || runtime.sourceLocks.has(resource.resource.uuid))return null;
    runtime.sourceLocks.add(resource.resource.uuid);
    try {
      const spent=Number(resource.resource.system.uses.spent)||0;
      const nonce=foundry.utils.randomID();
      await resource.resource.update({'system.uses.spent':spent+1,[`flags.${MODULE_ID}.battleMaster.pendingCosts.${nonce}`]:{actorUuid:actor.uuid,attackId:request.attackId}});
      return {uuid:resource.resource.uuid,nonce,die:resource.die};
    } finally {runtime.sourceLocks.delete(resource.resource.uuid);}
  });
}

async function settleOnOwner(request) {
  const actor=await fromUuid(request.actorUuid),resource=await fromUuid(request.uuid);
  const user=game.users.get(this?.socketdata?.userId??game.user.id);
  if(!actor?.isOwner || !actor.testUserPermission(user,'OWNER') || resource?.actor?.uuid!==actor.uuid)return;
  return serializeCost(actor,async()=>{
    const current=actor.items.get(resource.id)??resource;
    const pending=current._source.flags?.[MODULE_ID]?.battleMaster?.pendingCosts?.[request.nonce];
    if(pending?.actorUuid!==actor.uuid)return;
    const patch={[`flags.${MODULE_ID}.battleMaster.pendingCosts.-=${request.nonce}`]:null};
    if(request.refund && Number(current.system.uses.spent)>0)patch['system.uses.spent']=Number(current.system.uses.spent)-1;
    await current.update(patch,{[ID]:{settlingCost:true}});
  });
}
const handlers={spendAttackManeuver:spendOnOwner,settleAttackManeuver:settleOnOwner};

export function attackManeuverKind(item) {
  if (item?.type !== 'feat') return null;
  const identifiers = [item.system?.identifier, item.flags?.['chris-premades']?.info?.identifier, item.flags?.[MODULE_ID]?.battleMaster?.kind].map(normalized);
  if (identifiers.some(value => ['precisionattack', 'maneuversprecisionattack', 'precision'].includes(value)) || /精准攻击|精确攻击|precision attack/i.test(item.name)) return 'precision';
  if (identifiers.some(value => ['menacingattack', 'maneuversmenacingattack', 'menacing'].includes(value)) || /恐吓攻击|威吓攻击|menacing attack/i.test(item.name)) return 'menacing';
  return null;
}

function feature(actor, kind) {
  return actor?.items.find(item => attackManeuverKind(item) === kind);
}

function eligible(workflow, kind) {
  if (!workflow?.activity?.attack || !workflow.actor?.isOwner || workflow.aborted || workflow.abort) return false;
  if (workflow.item?.flags?.[MODULE_ID]?.battleMaster?.attack || workflow[ID]?.maneuverUsed) return false;
  const item = feature(workflow.actor, kind);
  const resource = item && runtime.superiority(workflow.actor, item);
  if (!resource) return false;
  const previous = workflow[ID]?.poolAtStart;
  if (previous?.uuid === resource.resource.uuid && Number(resource.resource.system.uses.spent) > previous.spent) return false;
  const classification = workflow.activity.attack.type?.classification;
  if (kind === 'precision' && item.system.source?.rules !== '2014') return true;
  return classification === 'weapon' || classification === 'unarmed' && item.system.source?.rules !== '2014';
}

async function requestUse(request) {
  const actor = await fromUuid(request.actorUuid);
  const item = await fromUuid(request.featureUuid);
  const user = game.users.get(this?.socketdata?.userId ?? game.user.id);
  if (!actor?.isOwner || !actor.testUserPermission(user, 'OWNER') || item?.actor?.uuid !== actor.uuid || attackManeuverKind(item) !== request.kind) return false;
  const resource = runtime.superiority(actor, item);
  if (!resource) return false;
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'bm-resource-dialog';
    dialog.dataset.maneuver = request.kind;
    dialog.style.cssText = 'width:400px;max-width:90vw;padding:20px;background:#1a1511;color:#f4e8d1;border:1px solid #b7985e;border-radius:8px';
    const heading = document.createElement('h2');heading.textContent = item.name;
    const text = document.createElement('p');
    text.textContent = request.kind === 'precision'
      ? `本次攻击未命中。是否消耗一枚卓越骰，将1${resource.die}加入本次攻击检定？`
      : `本次武器攻击命中。是否消耗一枚卓越骰，加1${resource.die}伤害，并令目标进行感知豁免抵抗恐惧？`;
    const footer = document.createElement('footer');footer.style.cssText = 'display:flex;gap:12px';
    let settled = false;
    const finish = value => {if(settled)return;settled=true;clearTimeout(timer);dialog.remove();resolve(value);};
    for (const [label, value] of [['不使用', false], ['使用战技', true]]) {
      const button = document.createElement('button');button.type = 'button';button.dataset.bmUse = String(value);button.textContent = label;
      button.addEventListener('click', () => finish(value));footer.append(button);
    }
    dialog.addEventListener('cancel', event => {event.preventDefault();finish(false);});
    dialog.addEventListener('close', () => finish(false));
    const timer = setTimeout(() => finish(false), 60000);
    dialog.append(heading, text, footer);document.body.append(dialog);dialog.showModal();
  });
}

async function choose(workflow, kind) {
  const item = feature(workflow.actor, kind);
  const controller = runtime.owner(workflow.actor);
  if (!controller) return false;
  const request = {kind, actorUuid: workflow.actor.uuid, featureUuid: item.uuid};
  return controller.id === game.user.id ? requestUse(request) : runtime.socket.executeAsUser('requestManeuverUse', controller.id, request);
}

async function spend(workflow, kind) {
  if (workflow.aborted || workflow.abort || workflow[ID]?.aborting) return null;
  const item = feature(workflow.actor, kind);
  const resource = runtime.superiority(workflow.actor, item);
  if (!resource) return null;
  const cost=await onOwner(workflow.actor,'spendAttackManeuver',{actorUuid:workflow.actor.uuid,featureUuid:item.uuid,resourceUuid:resource.resource.uuid,kind,attackId:workflow.sequenceId??workflow.id});
  if(!cost)return null;
  const state=workflow[ID]??={};state.maneuverUsed=kind;state.cost=cost;
  if(workflow.aborted||workflow.abort||state.aborting){await refund(workflow);return null;}
  return {item,die:cost.die,state};
}

async function refund(workflow) {
  const state = workflow?.[ID];
  if (!state?.cost || state.refunded || state.completed) return;
  state.refunded = true;
  await onOwner(workflow.actor,'settleAttackManeuver',{actorUuid:workflow.actor.uuid,...state.cost,refund:true});
}

async function precision(workflow) {
  if (!eligible(workflow, 'precision') || workflow.isCritical || workflow.isFumble || workflow.targets.size !== 1 || workflow.hitTargets?.size) return;
  const state = workflow[ID] ??= {};
  if (state.precisionChecked) return;
  state.precisionChecked = true;
  if (!await choose(workflow, 'precision')) return;
  const paid = await spend(workflow, 'precision');if (!paid) return;
  try {
    const before = workflow.attackTotal;
    await globalThis.chrisPremades.utils.workflowUtils.bonusAttack(workflow, '1' + paid.die);
    state.precision = {before, after: workflow.attackTotal, bonus: workflow.attackTotal - before, die: paid.die};
    await workflow.checkHits();
    await workflow.displayAttackRoll();
  } catch (error) {await refund(workflow);throw error;}
}

async function menacing(workflow) {
  if (!eligible(workflow, 'menacing') || workflow.hitTargets?.size !== 1) return;
  const state = workflow[ID] ??= {};
  if (state.menacingChecked) return;
  state.menacingChecked = true;
  const target = [...workflow.hitTargets][0];
  if (!target?.actor || !await choose(workflow, 'menacing')) return;
  const paid = await spend(workflow, 'menacing');if (!paid) return;
  try {
    await globalThis.chrisPremades.utils.workflowUtils.bonusDamage(workflow, '1' + paid.die, {damageType: workflow.defaultDamageType});
    const choice=paid.item.flags[MODULE_ID]?.battleMaster?.saveAbility;
    const ability=['str','dex'].includes(choice)?Number(workflow.actor.system.abilities[choice].mod):Math.max(Number(workflow.actor.system.abilities.str.mod),Number(workflow.actor.system.abilities.dex.mod));
    state.menacing = {attackId:workflow.sequenceId??workflow.id,featureUuid: paid.item.uuid, sourceTokenUuid:workflow.token?.document.uuid,targetUuid: target.document.uuid, dc:8 + Number(workflow.actor.system.attributes.prof) + ability};
  } catch (error) {await refund(workflow);throw error;}
}

async function finish(workflow) {
  const state = workflow?.[ID];
  if (!state?.cost || state.completed || workflow.aborted || workflow.abort) return;
  state.completed = true;
  try{await onOwner(workflow.actor,'settleAttackManeuver',{actorUuid:workflow.actor.uuid,...state.cost,refund:false});}catch(error){console.error(`[${ID}] Cost settlement failed`,error);}
  if (!state.menacing) return;
  setTimeout(async () => {
    try {
      const feature = await fromUuid(state.menacing.featureUuid);
      const targetDoc = await fromUuid(state.menacing.targetUuid);
      const target = targetDoc?.object;
      if (!feature || !target?.actor) return;
      if (target.actor.system.traits.ci.value.has('frightened')) {state.menacing.immune = true;game.modules.get(MODULE_ID).api.battleMaster.lastMenacing={...state.menacing};return;}
      const clone = feature.clone({}, {keepId: true});
      clone.updateSource({[`system.activities.${SAVE_ID}.save.dc`]:{calculation:'',formula:String(state.menacing.dc)},[`system.activities.${SAVE_ID}.effects`]:[]});
      const source=JSON.stringify(state.menacing.sourceTokenUuid);
      const victim=JSON.stringify(state.menacing.targetUuid);
      const visible=`!!fromUuidSync(${source})?.object && !fromUuidSync(${source}).hidden && canSee((typeof workflow !== 'undefined' && workflow?.token) || fromUuidSync(${victim})?.object,fromUuidSync(${source}).object)`;
      const effects=clone.toObject().effects.map(effect=>effect._id===EFFECT_ID?{...effect,changes:[{key:'flags.midi-qol.disadvantage.attack.all',mode:0,value:visible,priority:20},{key:'flags.midi-qol.disadvantage.ability.check.all',mode:0,value:visible,priority:20}],flags:{...effect.flags,[MODULE_ID]:{battleMaster:{...effect.flags?.[MODULE_ID]?.battleMaster,fearSourceToken:state.menacing.sourceTokenUuid}}}}:effect);
      const fear=effects.find(effect=>effect._id===EFFECT_ID);
      clone.prepareFinalAttributes?.();
      const activity = clone.system.activities.get(SAVE_ID);
      const result = await MidiQOL.completeActivityUse(activity,{consume:{resources:false,spellSlot:false},midiOptions:{isTriggered:true,targetUuids:[target.document.uuid],workflowOptions:{targetConfirmation:'none',autoRollDamage:'always',autoFastAttack:true,autoFastDamage:true}}},{configure:false});
      const save = result?.workflow ?? result;
      state.menacing.failed = save?.failedSaves?.has(target) ?? false;
      if(state.menacing.failed&&!save?.aborted){delete fear._id;fear.origin=feature.uuid;await globalThis.chrisPremades.utils.effectUtils.createEffect(target.actor,fear,{identifier:'bmMenacingFear',animate:false});}
      state.menacing.rolls = save?.saveRolls?.map?.(roll=>({formula:roll.formula,total:roll.total}));
      game.modules.get(MODULE_ID).api.battleMaster.lastMenacing = {...state.menacing};
    } catch (error) {console.error(`[${ID}] Menacing save failed`,error);}
  },0);
}

function patchFeature(item) {
  const kind = attackManeuverKind(item), source = item.toObject();
  if (!kind) return null;
  source.flags ??= {};
  source.flags[MODULE_ID]??={}; source.flags[MODULE_ID].battleMaster = {...source.flags[MODULE_ID].battleMaster, kind, attackAutomation: 1};
  const selectedAbility=Object.values(source.system.activities??{}).find(activity=>['str','dex'].includes(activity.save?.dc?.calculation))?.save.dc.calculation;
  if(kind==='menacing'&&selectedAbility&&!source.flags[MODULE_ID].battleMaster.saveAbility)source.flags[MODULE_ID].battleMaster.saveAbility=selectedAbility;
  const cpr = source.flags['chris-premades'];
  if (['maneuversPrecisionAttack','maneuversMenacingAttack'].includes(cpr?.info?.identifier)) delete source.flags['chris-premades'];
  source.effects = source.effects.filter(effect => !list(effect.changes).some(change => change.key.toLowerCase().includes('optional.precisionattack')) && !effect.flags?.[MODULE_ID]?.battleMaster?.menacing && !(kind==='menacing'&&(effect.flags?.['chris-premades']?.conditions?.includes('frightened')||list(effect.statuses).includes('frightened'))));
  const main = Object.values(source.system.activities ?? {}).find(activity => !activity.midiProperties?.automationOnly) ?? {_id:foundry.utils.randomID()};
  main.type = 'utility';main.name = '自动战技';main.activation = {type:'none',value:null};
  main.effects=[];
  main.target = {override:true,prompt:false,template:{type:'',units:'ft'},affects:{type:'self',count:'',special:''}};
  main.range = {override:true,units:'self'};main.consumption = {spellSlot:false,targets:[],scaling:{allowed:false}};
  main.otherActivityId = 'none';
  source.system.activities = {[main._id]:main};
  if (kind === 'menacing') {
    source.effects.push({_id:EFFECT_ID,type:'base',name:'恐吓攻击',img:source.img,transfer:false,disabled:false,statuses:['frightened'],duration:{rounds:1,turns:1},changes:[],flags:{dae:{specialDuration:['turnEndSource'],stackable:'noneName'},[MODULE_ID]:{battleMaster:{menacing:true}}}});
    source.system.activities[SAVE_ID]={_id:SAVE_ID,type:'save',name:'恐吓攻击豁免',activation:{type:'special'},range:{override:true,units:'any'},target:{override:true,prompt:false,template:{type:'',units:'ft'},affects:{type:'creature',count:'1'}},consumption:{spellSlot:false,targets:[]},save:{ability:['wis'],dc:{calculation:'',formula:'8 + @prof + max(@abilities.str.mod,@abilities.dex.mod)'}},damage:{parts:[],onSave:'none'},effects:[{_id:EFFECT_ID,onSave:false}],otherActivityId:'none',midiProperties:{automationOnly:true,autoCEEffects:'none'}};
  }
  return source;
}

export async function matchAttackManeuvers({actors=[],items=[],apply=false,backup,createTemplates=false}={}) {
  const all = new Set([...items,...actors.flatMap(actor=>list(actor.items))]);
  const pending = [];
  for(const item of all){if(!attackManeuverKind(item))continue;if(item.flags?.[MODULE_ID]?.battleMaster?.attackAutomation===1)continue;pending.push({item,data:patchFeature(item),before:item.toObject()});}
  if(apply&&pending.length){if(backup)await backup(pending.map(({item,before})=>({uuid:item.uuid,data:before})));else saveDataToFile(JSON.stringify(pending.map(({item,before})=>({uuid:item.uuid,data:before})),null,2),'application/json',`battle-master-backup-${Date.now()}.json`);}
  if(apply)for(const {item,data}of pending)await item.update(data,{diff:false,recursive:false});
  const changes=pending.map(({item})=>({uuid:item.uuid,name:item.name,kind:attackManeuverKind(item)}));
  if(createTemplates){
    let folder=game.folders.find(folder=>folder.type==='Item'&&/战斗大师自动化/.test(folder.name));
    for(const [kind,name,identifier]of [['precision','战技：精准攻击 Precision Attack','precision-attack'],['menacing','战技：恐吓攻击 Menacing Attack','menacing-attack']]){
      if(game.items.some(item=>item.flags[MODULE_ID]?.battleMaster?.attackTemplate===kind))continue;
      if(apply){folder??=await Folder.create({name:'战斗大师自动化',type:'Item'});const item=new CONFIG.Item.documentClass({name,type:'feat',img:'icons/skills/melee/weapons-crossed-swords-yellow.webp',system:{identifier,source:{rules:'2024'},activities:{}}});const data=patchFeature(item);delete data._id;data.folder=folder.id;data.flags[MODULE_ID].battleMaster.attackTemplate=kind;const created=await Item.create(data);changes.push({uuid:created.uuid,name,kind,template:true});}
      else changes.push({name,kind,template:true});
    }
  }
  return {changes};
}

export function registerAttackManeuvers(core) {
  runtime = core;
  runtime.socket.register('requestManeuverUse',requestUse);
  for(const [name,handler]of Object.entries(handlers))runtime.socket.register(name,handler);
  // Precision runs before Riposte's miss listener so a repaired hit cannot trigger it.
  Hooks.on('midi-qol.hitsChecked',precision);
  Hooks.on('midi-qol.DamageRollComplete',menacing);
  Hooks.on('midi-qol.preAbort',workflow=>{(workflow[ID]??={}).aborting=true;return refund(workflow);});
  Hooks.on('midi-qol.postCleanup',finish);
  Hooks.on('midi-qol.RollComplete',workflow=>{if(workflow.currentAction===workflow.WorkflowState_Completed)return finish(workflow);});
  Hooks.on('midi-qol.preItemRollV2',({workflow})=>{const kind=attackManeuverKind(workflow?.item);if(kind&&workflow.activity.id!==SAVE_ID){ui.notifications.info('战技会在本次攻击失手或命中后自动询问，无需提前消耗卓越骰。');return false;}});
  Hooks.on('midi-qol.preItemRollV2',({workflow})=>{if(!workflow?.activity?.attack)return;const item=feature(workflow.actor,'precision')??feature(workflow.actor,'menacing');const resource=item&&runtime.superiority(workflow.actor,item);if(resource)(workflow[ID]??={}).poolAtStart={uuid:resource.resource.uuid,spent:Number(resource.resource.system.uses.spent)||0};});
  Hooks.on('preCreateItem',item=>{if(['character','npc'].includes(item.parent?.type)&&attackManeuverKind(item))item.updateSource(patchFeature(item),{recursive:false});});
  Hooks.on('preUpdateItem',(item,changes,options)=>{const spent=changes['system.uses.spent']??foundry.utils.getProperty(changes,'system.uses.spent');if(spent!==undefined&&Number(spent)<Number(item.system.uses?.spent)&&!options?.[ID]?.settlingCost&&item._source.flags?.[MODULE_ID]?.battleMaster?.pendingCosts)changes[`flags.${MODULE_ID}.battleMaster.-=pendingCosts`]=null;});
}
