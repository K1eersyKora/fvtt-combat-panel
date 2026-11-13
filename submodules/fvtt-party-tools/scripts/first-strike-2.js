import {STORY_ID as ID,readStoryState,storyNow,isStoryActive,isStoryStriker} from './story-state-2.js';
import {getController} from './parent-ui-1.js';
const authority=()=>game.user.isGM&&game.users.activeGM?.id===game.user.id;
const actorOf=activity=>activity?.actor??activity?.item?.actor;
export function openingActivity(activity){
 if(!['attack','save','damage'].includes(activity?.type))return false;
 const types=(activity.damage?.parts??[]).flatMap(p=>[...(p.types??[])]);
 return !types.length||types.some(t=>!['healing','temphp'].includes(t));
}
export class FirstStrike{
 constructor(story){
  this.story=story;
  Hooks.on('dnd5e.preUseActivity',activity=>{
   if(!isStoryStriker())return;
   const s=readStoryState();
   if(this.sent===s.opener.id||game.user.getFlag(ID,'strikeResult')?.openerId===s.opener.id||actorOf(activity)?.id!==s.opener.actorId||!openingActivity(activity)){
    ui.notifications.warn('先手准备中：请用当前角色的攻击活动；也可以取消先手。');return false;
   }
  });
  const captureAttack=workflow=>{
   if(workflow?.aborted||!workflow?.attackRoll||!Number.isFinite(workflow.attackRoll.total))return;
   const s=readStoryState();if(!isStoryStriker()||workflow.actor?.id!==s.opener.actorId)return;
   // A first strike miss is already a committed attack. Let Midi finish its
   // normal miss branch rather than leave the HUD waiting for manual damage.
   if(workflow.targets?.size&&!workflow.hitTargets?.size&&!workflow.hitTargetsEC?.size){workflow.workflowOptions??={};workflow.workflowOptions.forceCompletion=true;}
   void this.commit(workflow.activity??workflow.item?.system.activities?.find(a=>a.type==='attack'),workflow.attackRoll.total,workflow.targets).catch(e=>story.error(e));
  };
  Hooks.on('midi-qol.AttackRollComplete',captureAttack);
  Hooks.on('midi-qol.RollComplete',workflow=>{
   if(workflow?.aborted)return;
   if(workflow?.attackRoll)return captureAttack(workflow);
   if(openingActivity(workflow?.activity)&&workflow.activity.type!=='attack')void this.commit(workflow.activity,null,workflow.targets).catch(e=>story.error(e));
  });
  Hooks.on('dnd5e.postUseActivity',(activity,usage,result)=>{
   if(!game.modules.get('midi-qol')?.active&&activity.type!=='attack'&&openingActivity(activity)&&result?.message)void this.commit(activity,null,game.user.targets).catch(e=>story.error(e));
  });
  // Native hook rollAttackV2 runs BEFORE ammo is committed. Wrap the public
  // activity method instead so this signal follows its normal consumption.
  if(!game.modules.get('midi-qol')?.active&&game.modules.get('lib-wrapper')?.active){
   const self=this;
   libWrapper.register(ID,'CONFIG.DND5E.activityTypes.attack.documentClass.prototype.rollAttack',async function(wrapped,...args){
    const rolls=await wrapped(...args);
    if(rolls?.length&&Number.isFinite(rolls[0].total))await self.commit(this,rolls[0].total,game.user.targets);
    return rolls;
   },'WRAPPER');
  }
 }
 async request(cancel=false){
  const s=readStoryState();if(s.phase!=='story'||!game.settings.get(ID,'allowFirstStrike'))return;
  if(!game.users.activeGM)throw Error('需要一位在线主持人来接续先手攻击。');
  if(cancel&&getController()?.hud?.busy)throw Error('当前攻击正在结算，请稍候。');
  if(!game.modules.get('fvtt-bg3-initiative')?.api?.enterStoryEncounter)throw Error('请启用 BG3先攻栏 0.1.0 或更新版本。');
  if(game.user.isGM&&authority()){
   if(cancel&&s.opener?.userId===game.user.id)return this.cancel(s);
   const token=canvas.tokens.controlled.find(t=>t.actor);
   if(!token)throw Error('请先选中准备率先攻击的怪物或角色。');
   return this.arm(s,game.user,token.id,foundry.utils.randomID());
  }
  const roster=s.roster.find(r=>r.userId===game.user.id),tokenId=game.user.isGM?canvas.tokens.controlled.find(t=>t.actor)?.id:roster?.tokenId;
  if(!tokenId)throw Error(game.user.isGM?'请先选中准备率先攻击的怪物或角色。':'你没有参加当前剧情。');
  await game.user.setFlag(ID,'strikeRequest',{sessionId:s.id,id:foundry.utils.randomID(),tokenId,cancel,at:storyNow()});
 }
 async arm(s,user,tokenId,requestId){
  if(!authority()||readStoryState().id!==s.id||readStoryState().phase!=='story')return;
  if(s.opener)throw Error('已有单位准备先下手为强。');
  const token=game.scenes.get(s.sceneId)?.tokens.get(tokenId);
  if(!token?.actor||(!user.isGM&&(!s.roster.some(r=>r.userId===user.id&&r.tokenId===tokenId)||!token.actor.testUserPermission(user,'OWNER'))))throw Error('无法控制准备先手的角色。');
  await game.settings.set(ID,'storyState',{...s,battleAt:null,startError:null,handledStrikes:[...(s.handledStrikes??[]),requestId].slice(-30),opener:{id:requestId,userId:user.id,tokenId,actorId:token.actorId,armedAt:storyNow()}});
 }
 async cancel(s){
  if(!authority())return;
  const pending=game.users.contents.map(u=>u.getFlag(ID,'strikeRequest')).filter(r=>r?.sessionId===s.id&&!r.cancel).map(r=>r.id);
  const next={...s,opener:null,battleAt:null,handledStrikes:[...new Set([...(s.handledStrikes??[]),...pending])].slice(-30)};delete next.strikeResult;await game.settings.set(ID,'storyState',next);
 }
 async monitor(){
  if(!authority())return;
  let s=readStoryState();if(s.phase!=='story'||s.startError)return;
  if(s.opener){
   const pending=game.users.contents.map(u=>u.getFlag(ID,'strikeRequest')).filter(r=>r?.sessionId===s.id&&!r.cancel&&!(s.handledStrikes??[]).includes(r.id)).map(r=>r.id);
   if(pending.length){s={...s,handledStrikes:[...new Set([...(s.handledStrikes??[]),...pending])].slice(-30)};await game.settings.set(ID,'storyState',s);}
   if(!game.settings.get(ID,'allowFirstStrike'))return this.cancel(s);
   const user=game.users.get(s.opener.userId),result=user?.getFlag(ID,'strikeResult'),request=user?.getFlag(ID,'strikeRequest');
   if(result?.sessionId===s.id&&result.openerId===s.opener.id&&result.actorId===s.opener.actorId){
    const activity=fromUuidSync(result.activityUuid),actor=actorOf(activity);
    const committed=activity?.type==='attack'?Number.isFinite(result.attackTotal):result.kind==='offensive-use';
    if(!committed||!openingActivity(activity)||actor?.id!==s.opener.actorId||!actor.testUserPermission(user,'OWNER'))return;
    await game.settings.set(ID,'storyState',{...s,phase:'starting',reason:'first-strike',strikeResult:result,startedAt:storyNow(),battleAt:null});
    return this.story.advanceBattle(readStoryState());
   }
   if(!user?.active||(request?.sessionId===s.id&&request.cancel&&request.at>=s.opener.armedAt))return this.cancel(s);
   return;
  }
  if(!game.settings.get(ID,'allowFirstStrike'))return;
  const requests=game.users.contents.filter(u=>u.isGM||s.roster.some(r=>r.userId===u.id)).map(user=>({user,request:user.getFlag(ID,'strikeRequest')}))
   .filter(({user,request:r})=>user?.active&&r?.sessionId===s.id&&!r.cancel&&!(s.handledStrikes??[]).includes(r.id)).sort((a,b)=>a.request.at-b.request.at);
  const first=requests[0];if(!first)return;
  // All concurrent requests are claimed together; a losing click is never
  // silently replayed after the winner cancels or finishes.
  s={...s,handledStrikes:[...(s.handledStrikes??[]),...requests.slice(1).map(x=>x.request.id)].slice(-30)};
  await this.arm(s,first.user,first.request.tokenId,first.request.id);
 }
 sync(s){
  const own=s.phase==='story'&&s.opener?.userId===game.user.id;
  if(own&&!this.active){
   this.active=s.opener.id;
   if(this.story.el.open)this.story.el.close();
   if(!game.user.isGM)this.story.el.show();
   document.body.classList.remove('cp-story-player');document.body.classList.add('cp-story-armed');
   if(canvas.controls?.cursors&&typeof this.story.savedCursorsVisible==='boolean')canvas.controls.cursors.visible=this.story.savedCursorsVisible;
   const token=canvas.tokens.get(s.opener.tokenId);if(token?.actor?.isOwner)token.control({releaseOthers:true});
   getController()?.refresh();
  }else if(!own&&this.active){
   this.active=null;document.body.classList.remove('cp-story-armed');
   if(s.phase==='story'&&!game.user.isGM){canvas.tokens.releaseAll();document.body.classList.add('cp-story-player');if(this.story.el.open)this.story.el.close();this.story.el.showModal();}
  }
  this.story.el.classList.toggle('is-armed',own);
 }
 async commit(activity,total,targets){
  const s=readStoryState(),actor=actorOf(activity);
  if(!isStoryStriker()||!openingActivity(activity)||actor?.id!==s.opener.actorId||this.sent===s.opener.id)return;
  this.sent=s.opener.id;
  try{
   await game.user.setFlag(ID,'strikeResult',{sessionId:s.id,openerId:s.opener.id,actorId:actor.id,activityUuid:activity.uuid,kind:activity.type==='attack'?'attack-roll':'offensive-use',attackTotal:total,targetIds:[...(targets??[])].map(t=>t.id??t.document?.id).filter(Boolean),at:storyNow()});
   this.story.schedule();
  }catch(error){this.sent=null;throw error;}
 }
}
