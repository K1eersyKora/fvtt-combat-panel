import {namespaceSocket} from './socket-1.js';
const MODULE_ID='fvtt-automation-repair', ID='fvtt-lucky', VERSION = '0.1.6';
const list = value => Array.from(value?.contents ?? value ?? []);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const locks = new Map(), claims = new Map(), prompts = new Map(), splits = new Map();
let socket;

export function isLucky(item) {
  if (item?.type !== 'feat') return false;
  if (item.flags?.[MODULE_ID]?.lucky?.enabled) return true;
  // Do not mistake Halfling Luck or Lucky Footwork for the feat.
  if(!String(item.system?.uses?.max??'').trim())return false;
  return /^lucky(?:-uses-per-day.*)?$/i.test(item.system?.identifier ?? '') || /^(?:幸运(?:专长)?(?:\s+Lucky)?|Lucky)$/i.test(item.name ?? '');
}
export function isAttack(activity) {
  return ['attack','midiAttack'].includes(activity?.type) && ['mwak','rwak','msak','rsak'].includes(activity.actionType);
}
const luckyItems = actor => list(actor?.items).filter(isLucky);
const armed = actor => list(actor?.effects).find(e => !e.disabled && !e.isSuppressed && e.flags?.[MODULE_ID]?.lucky?.armed);
const sender = context => game.users.get(context?.socketdata?.userId ?? game.user.id);
const owns = (actor,user) => !!user && !!actor?.testUserPermission(user,'OWNER');
const available = item => Number(item?.system?.uses?.value) || 0;
function owner(actor) {
  return list(game.users).find(u => u.active && !u.isGM && owns(actor,u)) ?? game.users.activeGM;
}
async function serial(key, task) {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  locks.set(key,next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}
async function gm(name, data) {
  if (!game.users.activeGM) throw new Error('幸运自动化需要一名在线 GM。');
  return game.user.id === game.users.activeGM.id ? handlers[name].call({},data) : socket.executeAsGM(name,data);
}
async function remote(name,userId,data) {
  return userId === game.user.id ? handlers[name].call({},data) : socket.executeAsUser(name,userId,data);
}
function choose({key,title,body,buttons,timeout=45000}) {
  if (prompts.has(key)) return Promise.resolve(null);
  return new Promise(resolve => {
    const el = document.createElement('dialog');
    el.className = 'fvtt-lucky-dialog'; el.dataset.luckyPrompt = key;
    el.style.cssText = 'width:440px;max-width:90vw;padding:22px;border:1px solid #8eb476;border-radius:10px;background:#132117;color:#f0f5e9;z-index:10000';
    el.innerHTML = `<h2>${esc(title)}</h2>${body}<footer style="display:flex;gap:10px;margin-top:18px">${buttons.map(b=>`<button type="button" data-lucky-choice="${esc(b.value)}" style="height:auto;min-height:38px">${esc(b.label)}</button>`).join('')}</footer>`;
    let done = false;
    const finish = value => { if(done)return; done=true;clearTimeout(timer);prompts.delete(key);el.remove();resolve(value); };
    const timer = setTimeout(()=>finish(null),timeout);
    for (const button of el.querySelectorAll('button')) button.onclick=()=>finish(button.dataset.luckyChoice);
    el.addEventListener('cancel',ev=>{ev.preventDefault();finish(null);});
    el.addEventListener('close',()=>finish(null));
    prompts.set(key,{el,finish});document.body.append(el);el.showModal();
  });
}
async function arm({itemUuid}) {
  if(!game.user.isGM)return {ok:false};
  const item=await fromUuid(itemUuid),actor=item?.actor,user=sender(this);
  if(!isLucky(item)||!owns(actor,user))return {ok:false,reason:'无角色控制权限。'};
  return serial(actor.uuid,async()=>{
    if(armed(actor))return {ok:false,reason:'已准备幸运优势，请先完成一次攻击。'};
    if(available(item)<1)return {ok:false,reason:'幸运点已耗尽。'};
    const spent=Number(item.system.uses.spent)||0;
    await item.update({'system.uses.spent':spent+1});
    try {
      const [effect]=await actor.createEmbeddedDocuments('ActiveEffect',[{
        name:'幸运：下一次攻击优势',img:item.img,origin:item.uuid,transfer:false,statuses:['fvtt-lucky-advantage'],
        description:'下一次普通武器或法术攻击检定具有优势。豁免类活动、属性检定及豁免检定不会消耗此状态。攻击骰掷出后移除；取消攻击保留。',
        flags:{[MODULE_ID]:{lucky:{armed:true,itemUuid:item.uuid}}},changes:[]
      }]);
      return {ok:true,effectUuid:effect.uuid};
    } catch(error) { await item.update({'system.uses.spent':spent});throw error; }
  });
}
async function askDefense(plan) {
  if(!sender(this)?.isGM)return false;
  const target=await fromUuid(plan.targetUuid),actor=target?.actor,item=await fromUuid(plan.itemUuid);
  if(!owns(actor,game.user)||item?.actor?.uuid!==actor.uuid||available(item)<1)return false;
  return await choose({key:plan.key,title:'幸运 · 被攻击投掷劣势',body:`<p><strong>${esc(plan.attackerName)}</strong> 正在用 <strong>${esc(plan.attackName)}</strong> 攻击 <strong>${esc(actor.name)}</strong>。</p><p>攻击骰尚未掷出。是否消耗 <strong>1 点幸运</strong>，让这一次攻击检定具有劣势？</p><p>剩余幸运点：${available(item)}。不消耗反应次数。</p>`,buttons:[{value:'no',label:'不使用'},{value:'yes',label:'使用幸运：本次攻击劣势'}]})==='yes';
}
async function closePrompt({key}) {
  if(sender(this)?.isGM)prompts.get(key)?.finish(null);
}
async function beginAttack(plan) {
  if(!game.user.isGM)return {ok:false};
  const attacker=await fromUuid(plan.actorUuid),activity=await fromUuid(plan.activityUuid),user=sender(this);
  if(!owns(attacker,user)||activity?.actor?.uuid!==attacker.uuid||!isAttack(activity))return {ok:false};
  if(claims.has(plan.key))return {ok:false};
  // All resources are owned by the GM transaction. The client's UUIDs are only selectors.
  const entry={userId:user.id,actorUuid:attacker.uuid,effectUuid:null,defense:null,settled:false};
  claims.set(plan.key,entry);
  try {
    await serial(attacker.uuid,async()=>{
      const effect=armed(attacker);
      if(effect&&!list(claims.values()).some(c=>c!==entry&&c.effectUuid===effect.uuid))entry.effectUuid=effect.uuid;
    });
    if(plan.targetUuid){
      const target=await fromUuid(plan.targetUuid),defender=target?.actor;
      if(defender&&defender.uuid!==attacker.uuid)await serial(defender.uuid,async()=>{
        const item=luckyItems(defender).find(i=>available(i)>0),controller=owner(defender);
        if(!item||!controller)return;
        const request={key:plan.key,itemUuid:item.uuid,targetUuid:target.uuid,attackerName:attacker.name,attackName:activity.item.name};
        let timer;
        const accepted=await Promise.race([remote('askDefense',controller.id,request).catch(()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),47000);})]).finally(()=>clearTimeout(timer));
        if(!accepted){await remote('closePrompt',controller.id,{key:plan.key}).catch(()=>{});return;}
        // A workflow cancelled while its owner was deciding must never spend a point.
        if(entry.settled||available(item)<1)return;
        const spent=Number(item.system.uses.spent)||0;
        await item.update({'system.uses.spent':spent+1});
        // Cancellation may arrive during the database write, after the earlier check.
        if(entry.settled){await item.update({'system.uses.spent':spent});return;}
        entry.defense={itemUuid:item.uuid,actorUuid:defender.uuid};
      });
    }
    return {ok:true,advantage:!!entry.effectUuid,disadvantage:!!entry.defense};
  }catch(error){await settle.call({socketdata:{userId:user.id}},{key:plan.key,rolled:false});throw error;}
}
async function settle({key,rolled}) {
  if(!game.user.isGM)return;
  const entry=claims.get(key);
  if(!entry||entry.userId!==sender(this)?.id||entry.settled)return;
  entry.settled=true;
  try{
    if(entry.effectUuid&&rolled)await serial(entry.actorUuid,async()=>{const effect=await fromUuid(entry.effectUuid);if(effect?.flags?.[MODULE_ID]?.lucky?.armed)await effect.delete();});
    if(entry.defense&&!rolled)await serial(entry.defense.actorUuid,async()=>{
      const item=await fromUuid(entry.defense.itemUuid);
      if(item)await item.update({'system.uses.spent':Math.max(0,(Number(item.system.uses.spent)||0)-1)});
    });
  }finally{claims.delete(key);}
}
const handlers={arm,askDefense,closePrompt,beginAttack,settle};

async function beforeUse({workflow,usage,dialog}) {
  const split=splits.get(workflow?.workflowOptions?.luckySplit);
  if(split?.consumed){usage.consume={resources:false,spellSlot:false,usage:false};usage.scaling=split.scaling;dialog.configure=false;}
  const item=workflow?.item;
  if(!isLucky(item)||!item.actor)return;
  const stored=item.actor.items.get(item.id)??item;
  if(workflow.activity?.midiProperties?.identifier==='lucky-defense'){
    ui.notifications.info('幸运受击反应已启用：有人对你进行武器／法术攻击时，会在掷骰前自动询问。无需提前消耗幸运点。');return false;
  }
  const choice=await choose({key:`use:${stored.uuid}`,title:'幸运',body:`<p>${esc(item.actor.name)} · 剩余幸运点：<strong>${available(stored)}</strong></p><p>优势：花费 1 点幸运，准备下一次武器／法术攻击优势。</p><p>被攻击劣势：受到普通武器／法术攻击时，会在掷骰前自动询问；仅影响当前这一次攻击。</p>`,buttons:[{value:'cancel',label:'取消'},{value:'advantage',label:'优势'}]});
  if(choice==='advantage'){
    try{const result=await gm('arm',{itemUuid:stored.uuid});if(!result?.ok)ui.notifications.warn(result?.reason??'无法使用幸运。');else ui.notifications.info('已准备幸运：下一次武器／法术攻击优势。');}
    catch(error){ui.notifications.error(error.message);}
  }
  return false;
}
async function beforeAttack(workflow) {
  if(!isAttack(workflow?.activity))return;
  const old=workflow[ID];
  if(old&&!old.settled){if(old.advantage)workflow.advantage=true;if(old.disadvantage)workflow.disadvantage=true;return;}
  const targets=list(workflow.targets);
  const relevant=!!armed(workflow.actor)||targets.some(t=>luckyItems(t.actor).some(i=>available(i)>0));
  if(!relevant)return;
  // A single shared roll cannot have different disadvantage per target. Never leak it.
  if(targets.length>1){ui.notifications.warn('幸运：请逐个目标进行攻击检定。此次多目标共用骰未使用幸运点。');return;}
  const state={key:`${workflow.sequenceId??workflow.id}:${foundry.utils.randomID()}`,settled:false};workflow[ID]=state;
  try{
    const result=await gm('beginAttack',{key:state.key,actorUuid:workflow.actor.uuid,activityUuid:workflow.activity.uuid,targetUuid:targets[0]?.document?.uuid??targets[0]?.uuid});
    if(workflow.aborted||workflow.abort||state.settled){await gm('settle',{key:state.key,rolled:false});return false;}
    Object.assign(state,result);
    if(result?.advantage){workflow.advantage=true;workflow.attackAdvAttribution?.add('ADV:幸运');workflow.advReminderAttackAdvAttribution?.add('ADV:幸运');}
    if(result?.disadvantage){workflow.disadvantage=true;workflow.attackAdvAttribution?.add('DIS:幸运');workflow.advReminderAttackAdvAttribution?.add('DIS:幸运');}
  }catch(error){ui.notifications.error(error.message);await finish(workflow);return false;}
}
async function finish(workflow) {
  const state=workflow?.[ID];if(!state||state.settled)return;
  state.settled=true;await gm('settle',{key:state.key,rolled:!!workflow.attackRoll});
}
function filterReactions(activities,options,trigger,uuids) {
  const removed=new Set();
  for(let i=activities.length-1;i>=0;i--)if(isLucky(activities[i].item)){removed.add(activities[i].uuid);activities.splice(i,1);}
  if(Array.isArray(uuids))for(let i=uuids.length-1;i>=0;i--)if(removed.has(uuids[i]))uuids.splice(i,1);
}
async function configureItem(item) {
  if(!game.user.isGM||!isLucky(item))return false;
  const activities=list(item.system.activities),first=activities.find(a=>a.midiProperties?.identifier!=='lucky-defense');
  const id=first?.id??'LuckyAdvantage01',defenseId='LuckyDefense0001';
  const base={type:'utility',activation:{type:'',value:null,override:false},consumption:{targets:[],spellSlot:false},target:{affects:{type:'self'},template:{type:''},prompt:false,override:false},range:{units:'self'},roll:{formula:'',prompt:false,visible:false}};
  const desired={...base,_id:id,name:'幸运',midiProperties:{identifier:'lucky-advantage'}};
  const defense={...base,_id:defenseId,name:'幸运：被攻击投掷劣势',activation:{type:'reactionmanual',value:1,override:false},midiProperties:{identifier:'lucky-defense'}};
  const changes={};
  const set=(path,value)=>{if(JSON.stringify(foundry.utils.getProperty(item._source,path))!==JSON.stringify(value))changes[path]=value;};
  set(`flags.${MODULE_ID}.lucky.enabled`,true);set(`flags.${MODULE_ID}.lucky.version`,VERSION);
  const originalDescription=String(item.system.description?.value??'');
  const description=originalDescription.replace(/<section\b[^>]*>[\s\S]*?<\/section>/gi,s=>/Foundry Note/.test(s)&&/不会强制施加|do not.*advantage/i.test(s)?'':s).replace(/<section data-fvtt-lucky="automation">[\s\S]*?<\/section>/g,'');
  set('system.description.value',description+'<section data-fvtt-lucky="automation"><p><strong>幸运自动化：</strong>点击「幸运」再选择「优势」，花费1点幸运，准备下一次普通武器／法术攻击优势；不用于豁免类活动。掷出攻击骰后移除，取消攻击保留。</p><p>被武器／法术攻击时，掷骰前自动询问是否花费1点幸运使本次攻击劣势；拒绝不扣点，确认后取消攻击退点。不消耗每轮反应次数。两种用法共用幸运点，优势与劣势正常抵消。</p></section>');
  for(const data of [desired,defense]){
    const existing=item.system.activities.get(data._id);
    if(!existing){set(`system.activities.${data._id}`,data);continue;}
    const leaves=(path,value)=>{if(value&&typeof value==='object'&&!Array.isArray(value)){for(const [k,v]of Object.entries(value))leaves(`${path}.${k}`,v);}else set(path,value);};
    for(const [key,value] of Object.entries(data))if(key!=='_id')leaves(`system.activities.${data._id}.${key}`,value);
  }
  const effectUpdates=[];
  for(const effect of list(item.effects)){
    const retained=list(effect.changes).filter(c=>!/^flags\.midi-qol\.optional\.lucky\.attack\./.test(c.key));
    if(retained.length!==effect.changes.length)effectUpdates.push({_id:effect.id,changes:retained});
  }
  if(Object.keys(changes).length)await item.update(changes);
  if(effectUpdates.length)await item.updateEmbeddedDocuments('ActiveEffect',effectUpdates);
  return Object.keys(changes).length>0||effectUpdates.length>0;
}
Hooks.once('socketlib.ready',()=>{socket=namespaceSocket('lucky');for(const [name,fn] of Object.entries(handlers))socket.register(name,fn);});
Hooks.once('ready',()=>{
  if(game.modules.get('fvtt-lucky')?.active||game.modules.get('fvtt-battle-master')?.active)return;
  game.modules.get(MODULE_ID).api.lucky={version:VERSION,isLucky,isAttack,armed,configureItem,arm:item=>gm('arm',{itemUuid:item.uuid})};
  Hooks.on('midi-qol.preItemRollV2',beforeUse);
  Hooks.on('midi-qol.preAttackRoll',beforeAttack);
  // preCheckHits is the first awaited post-roll phase, before hit-triggered reactions.
  Hooks.on('midi-qol.preCheckHits',finish);
  Hooks.on('midi-qol.AttackRollComplete',finish);
  Hooks.on('midi-qol.preAbort',finish);
  Hooks.on('midi-qol.postCleanup',finish);
  Hooks.on('midi-qol.ReactionFilter',filterReactions);
  // Use Midi's own per-target workflow. Resource consumption belongs to the activation,
  // while ammunition remains with each native attack roll.
  libWrapper.register(MODULE_ID,'CONFIG.DND5E.activityTypes.attack.documentClass.prototype.use',async function(wrapped,usage={},dialog={},message={}){
    if(usage.midiOptions?.luckySplit||!isAttack(this)||this.target?.template?.type)return wrapped(usage,dialog,message);
    let targets=list(usage.midiOptions?.targetsToUse);
    if(!targets.length&&usage.midiOptions?.targetUuids?.length)targets=(await Promise.all(usage.midiOptions.targetUuids.map(id=>fromUuid(id)))).map(d=>d?.object).filter(Boolean);
    if(!targets.length)targets=list(game.user.targets);
    if(targets.length<2||(!armed(this.actor)&&!targets.some(t=>luckyItems(t.actor).some(i=>available(i)>0))))return wrapped(usage,dialog,message);
    const key=foundry.utils.randomID(),clone=this.item.clone({}, {keepId:true});
    clone.updateSource({[`system.activities.${this.id}.attackRollPerTarget`]:'always',[`system.activities.${this.id}.target.template.type`]:''});
    clone.prepareFinalAttributes?.();
    splits.set(key,{consumed:false,scaling:0});
    const config={...usage,midiOptions:{...usage.midiOptions,workflowOptions:{...usage.midiOptions?.workflowOptions}}};
    config.midiOptions.luckySplit=key;config.midiOptions.targetsToUse=new Set(targets);
    try{return await clone.system.activities.get(this.id).use(config,dialog,message);}finally{splits.delete(key);}
  },'MIXED');
  Hooks.on('dnd5e.postActivityConsumption',(activity,usage)=>{
    const state=splits.get(usage.workflow?.workflowOptions?.luckySplit??usage.midiOptions?.luckySplit);
    if(state&&!state.consumed){state.consumed=true;state.scaling=usage.scaling??0;}
  });
  // Roll dialogs can be closed without a workflow abort; release the claim in that path.
  libWrapper.register(MODULE_ID,'CONFIG.DND5E.activityTypes.attack.documentClass.prototype.rollAttack',async function(wrapped,...args){
    try{return await wrapped(...args);}finally{
      const workflow=args[0]?.workflow??MidiQOL.Workflow.getWorkflow(this.item.uuid);
      if(workflow?.[ID]&&!workflow.attackRoll)await finish(workflow);
    }
  },'WRAPPER');
  Hooks.on('updateUser',user=>{
    if(game.user.id!==game.users.activeGM?.id||user.active)return;
    for(const [key,entry]of claims)if(entry.userId===user.id)settle.call({socketdata:{userId:user.id}},{key,rolled:false}).catch(console.error);
  });
  console.info(`[${ID}] ${VERSION} ready`);
});
