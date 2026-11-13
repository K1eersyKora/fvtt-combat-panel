import {getController} from './parent-ui-1.js';
import {STORY_ID as ID,STORY_CHOICES,STORY_GRACE_MS,storyNow,readStoryState,isStoryActive,isStoryPlayer,storyVote,storyTally} from './story-state-2.js';
import {StoryInput} from './story-input-7.js';
import {patchHTML} from './parent-ui-1.js';
import {FirstStrike} from './first-strike-2.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let controller;
const authority=()=>game.user.isGM&&game.users.activeGM?.id===game.user.id;
const phaseChanged=()=>{Hooks.callAll('combatPanelStoryChanged');Hooks.callAll('combatPanelPartyChanged');controller?.refresh();};

export function registerStorySettings(){
 game.settings.register(ID,'storyState',{scope:'world',config:false,type:Object,default:{phase:'off'},onChange:phaseChanged});
 game.settings.register(ID,'allowFirstStrike',{name:'剧情中允许先下手为强',hint:'DM 和 PL 可准备一次原生攻击，攻击后退出剧情、自动掷先攻并按正常顺序开战。',scope:'world',config:true,type:Boolean,default:true,onChange:phaseChanged});
}
export function installStoryMode(){controller??=new StoryMode();const module=game.modules.get(ID);module.api={...module.api,story:{toggle:()=>controller.toggle(),firstStrike:()=>controller.strike.request(),cancelFirstStrike:()=>controller.strike.request(true),get state(){return readStoryState();}}};return controller;}
export async function toggleStoryMode(){if(!game.user.isGM)throw Error('只有主持人可以切换剧情模式。');return controller?.toggle();}

class StoryMode {
 constructor(){
  this.mode='select';this.sessionId=null;this.queue=Promise.resolve();this.viewSignature='';this.bootTime=storyNow();
  this.el=document.createElement(game.user.isGM?'section':'dialog');this.el.id='cp-story-ui';this.el.hidden=true;
  this.el.setAttribute('aria-label','剧情模式');this.el.classList.toggle('is-gm',game.user.isGM);
  document.body.appendChild(this.el);this.input=new StoryInput(this);this.strike=new FirstStrike(this);
  this.el.addEventListener('cancel',e=>e.preventDefault());
  this.el.addEventListener('click',e=>{const button=e.target.closest('button');if(button)void this.click(button).catch(error=>this.error(error));e.stopPropagation();});
  for(const name of ['createChatMessage','updateChatMessage','deleteChatMessage'])Hooks.on(name,()=>this.renderChat());
  for(const name of ['updateUser','createToken','updateToken','deleteToken','updateActor','canvasReady','sightRefresh'])Hooks.on(name,()=>this.schedule());
  Hooks.on('canvasPan',()=>this.drawMarks());
  Hooks.on('updateScene',()=>{if(authority()&&isStoryActive()&&game.scenes.active?.id!==readStoryState().sceneId)void this.stop();this.schedule();});
  Hooks.on('deleteScene',scene=>{if(authority()&&readStoryState().sceneId===scene.id)void this.stop();});
  Hooks.on('updateCombat',combat=>{if(authority()&&isStoryActive()&&combat.started&&combat.scene?.id===readStoryState().sceneId)void this.stop();});
  window.addEventListener('resize',()=>this.drawMarks());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.schedule();});
  this.refresh();
 }
 error(error){console.error(`[${ID}] 剧情模式`,error);const status=this.el.querySelector('[data-story-status]');if(status)status.textContent=error.message??String(error);if(game.user.isGM)ui.notifications.error(error.message??String(error));}
 schedule(){if(this.frame)return;if(authority()){this.frame=true;queueMicrotask(()=>{this.frame=null;this.refresh();});}else if(!document.hidden)this.frame=requestAnimationFrame(()=>{this.frame=null;this.refresh();});}
 async toggle(){
  if(!game.user.isGM)throw Error('只有主持人可以切换剧情模式。');
  if(readStoryState().phase==='starting')return;
  if(isStoryActive())return this.stop();
  if(!canvas.scene||game.scenes.active?.id!==canvas.scene.id)throw Error('请先激活当前场景，再开启剧情模式。');
  const sfx=game.modules.get('fvtt-bg3-encounter-sfx');
  if(!sfx?.active||!sfx.api?.playEncounterStart)throw Error('请先启用 BG3 遭遇提示音 0.1.1 或更新版本。');
  if(!game.modules.get('fvtt-bg3-initiative')?.api?.enterStoryEncounter)throw Error('请先启用 BG3先攻栏 0.1.0 或更新版本。');
  const roster=[];
  for(const user of game.users.contents.filter(u=>!u.isGM&&u.role>0)){
   const token=canvas.scene.tokens.find(t=>t.actorId===user.character?.id)??canvas.scene.tokens.find(t=>t.actor?.testUserPermission(user,'OWNER'));
   if(token)roster.push({userId:user.id,actorId:token.actorId,tokenId:token.id});
  }
  if(!roster.length)throw Error('当前场景没有可参与剧情的玩家角色。');
  if(game.combats.some(c=>c.started&&c.scene?.id===canvas.scene.id))throw Error('请先结束当前场景的战斗。');
  const participantIds=canvas.scene.tokens.filter(t=>t.actor&&!t.hidden).map(t=>t.id);
  await game.settings.set(ID,'storyState',{id:foundry.utils.randomID(),phase:'story',sceneId:canvas.scene.id,roster,participantIds,createdAt:storyNow(),gmId:game.user.id});
 }
 async stop(){if(!game.user.isGM)throw Error('只有主持人可以退出剧情模式。');await game.settings.set(ID,'storyState',{phase:'off'});}
 refresh(){
  const state=readStoryState(),active=state.phase==='story';
  if(active&&this.sessionId!==state.id){if(this.sessionId)this.leave();this.enter(state);}
  if(!active&&this.sessionId)this.leave();
  this.strike.sync(state);
  if(active){this.render(state);if(!game.user.isGM)void this.publishView(state).catch(error=>this.error(error));}
  if(authority()&&!this.monitorBusy){
   this.monitorBusy=true;
   void (async()=>{try{if(active){await this.strike.monitor();const fresh=readStoryState();if(!fresh.opener&&!fresh.startError)await this.monitorVotes(fresh);}else if(state.phase==='starting')await this.advanceBattle(state);}catch(error){this.error(error);}finally{this.monitorBusy=false;}})();
  }
 }
 enter(state){
  this.sessionId=state.id;this.mode='select';this.selection=null;this.pendingVote=null;this.viewSignature='';this.partyHTML=null;this.enemyHTML=null;this.chatHTML=null;
  this.savedFocus=document.activeElement;
  this.savedControlled=canvas.tokens?.controlled.map(t=>t.id)??[];
  if(!game.user.isGM&&!this.savedControlled.length&&(state.createdAt<this.bootTime||state.createdAt>this.bootTime+5000)){const own=canvas.tokens?.placeables.find(t=>t.actor?.id===game.user.character?.id&&t.actor?.isOwner);if(own)this.savedControlled=[own.id];}
  if(!game.user.isGM){
   this.savedTargets=[...game.user.targets].map(t=>t.id);
   this.savedCursorsVisible=canvas.controls?.cursors?.visible;
   if(canvas.controls?.cursors)canvas.controls.cursors.visible=false;
   const panel=getController(),hud=panel?.hud;
   hud?.audio?.stop();if(!hud?.busy)hud?.cancel(false);hud?.hideTip(0);panel?._cancelDrag?.();canvas.mouseInteractionManager?.cancel?.();
   canvas.tokens.releaseAll();
   document.body.classList.add('cp-story-player');this.el.hidden=false;
   this.el.innerHTML=this.shell();this.el.showModal();
  }else{this.el.hidden=false;this.el.innerHTML='<div class="cp-story-monitor cp-story-panel cp-story-interactive" data-story-monitor></div>';}
 }
 leave(){
  this.sessionId=null;this.input.reset();this.selection=null;this.pendingVote=null;
  clearTimeout(this.graceTimer);this.graceTimer=null;this.graceDeadline=null;
  if(this.graceFrame)cancelAnimationFrame(this.graceFrame);this.graceFrame=null;
  if(this.el.open)this.el.close();this.el.hidden=true;document.body.classList.remove('cp-story-player','cp-story-armed');
  if(!game.user.isGM){
   if(canvas.controls?.cursors&&typeof this.savedCursorsVisible==='boolean')canvas.controls.cursors.visible=this.savedCursorsVisible;
   for(const id of this.savedControlled??[]){const t=canvas.tokens?.get(id);if(t?.actor?.isOwner)t.control({releaseOthers:false});}
   getController()?.refresh();
   if(this.savedFocus?.isConnected)this.savedFocus.focus?.({preventScroll:true});
  }
  this.savedFocus=null;Hooks.callAll('combatPanelStoryChanged');
 }
 shell(){return `<div class="cp-story-bar top" aria-hidden="true"></div><div class="cp-story-bar bottom" aria-hidden="true"></div><div class="cp-story-heading"><span>✦</span> 剧情模式 <span>✦</span></div>
  <nav class="cp-story-tools cp-story-panel cp-story-interactive" aria-label="剧情画布工具"><button type="button" data-story-tool="select" title="选中指示物" aria-label="选中指示物" aria-pressed="true"><i class="fa-solid fa-arrow-pointer" aria-hidden="true"></i></button><button type="button" data-story-tool="measure" title="测量距离" aria-label="测量距离" aria-pressed="false"><i class="fa-solid fa-ruler-combined" aria-hidden="true"></i></button><span data-story-tool-hint>右键按住平移地图</span></nav>
  <aside class="cp-story-party cp-story-rail cp-story-interactive" aria-label="PL 队友总览"><header>同行者</header><div data-story-party></div></aside>
  <aside class="cp-story-enemies cp-story-rail cp-story-interactive" aria-label="敌方指示物"><header>对面</header><div data-story-enemies></div></aside>
  <section class="cp-story-voting cp-story-panel cp-story-interactive" aria-label="表达态度"><div class="cp-story-countdown cp-story-panel" data-story-countdown hidden aria-live="polite"><i class="fa-solid fa-hand-fist" aria-hidden="true"></i><div><strong>准备动手</strong><small>仍可改变态度</small></div><b><span data-story-seconds>3</span><small>秒</small></b><div class="cp-story-grace-track" aria-hidden="true"><i></i></div></div><div class="cp-story-vote-caption"><span>你的态度</span><small data-story-count></small></div><div class="cp-story-vote-buttons">${Object.entries(STORY_CHOICES).map(([key,v])=>`<button type="button" data-story-vote="${key}" aria-pressed="false"><i class="fa-solid ${v.icon}" aria-hidden="true"></i><span>${v.label}</span></button>`).join('')}<button type="button" class="cp-story-first-strike" data-story-strike><i class="fa-solid fa-bolt" aria-hidden="true"></i> <span>先下手为强！</span></button></div><small data-story-strike-status></small></section>
  <section class="cp-story-chat cp-story-panel cp-story-interactive" aria-label="剧情信息"><header><span><i class="fa-regular fa-comments" aria-hidden="true"></i> 信息</span><small>Enter 发送</small></header><ol data-story-messages aria-live="polite" aria-relevant="additions"></ol><div class="cp-story-chat-compose"><textarea data-story-message rows="1" maxlength="500" aria-label="输入信息" placeholder="说点什么…"></textarea><button type="button" data-story-send aria-label="发送信息"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button></div><small data-story-status role="status"></small></section>
  <svg class="cp-story-marks" aria-hidden="true"><rect data-story-selection hidden rx="8"></rect></svg>`;}
 render(state){
  const tally=storyTally(state,game.users);
  if(game.user.isGM){
   const armed=state.opener,own=armed?.userId===game.user.id;
   patchHTML(this.el.querySelector('[data-story-monitor]'),`<i class="fa-solid fa-film" aria-hidden="true"></i><strong>剧情模式</strong><div>${state.roster.map(r=>{const u=game.users.get(r.userId),v=STORY_CHOICES[storyVote(u,state)];return `<span>${esc(u?.name??'队友')} <b>${v?.short??'未表态'}</b></span>`;}).join('')}</div><small>${armed?esc(game.scenes.get(state.sceneId)?.tokens.get(armed.tokenId)?.name)+' 正准备先手攻击':`反对 ${tally.oppose}/${tally.total} · ${tally.threshold} 票开战`}</small><b data-story-gm-grace hidden></b>${game.settings.get(ID,'allowFirstStrike')?`<button type="button" data-story-${own?'strike-cancel':'strike'} ${armed&&!own?'disabled':''}><i class="fa-solid fa-bolt" aria-hidden="true"></i> ${own?'取消先手':'先下手为强！'}</button>`:''}`);this.updateCountdown(state);return;
  }
  const own=this.pendingVote?.sessionId===state.id?this.pendingVote.choice:storyVote(game.user,state),eligible=state.roster.some(r=>r.userId===game.user.id);
  for(const button of this.el.querySelectorAll('[data-story-vote]')){const selected=button.dataset.storyVote===own;button.setAttribute('aria-pressed',String(selected));button.classList.toggle('is-selected',selected);button.disabled=!eligible||!!this.votePending;}
  this.el.querySelector('[data-story-count]').textContent=`${tally.oppose}/${tally.total} 反对 · ${tally.threshold} 票准备动手`;
  const strike=this.el.querySelector('[data-story-strike]'),ownStrike=state.opener?.userId===game.user.id;
  strike.hidden=!game.settings.get(ID,'allowFirstStrike');strike.disabled=!eligible||!!state.opener&&!ownStrike;
  strike.querySelector('span').textContent=ownStrike?'取消先手':'先下手为强！';
  this.el.querySelector('[data-story-strike-status]').textContent=state.opener?(ownStrike?'选择 HUD 中的攻击并指定目标，攻击后自动进入战斗。':'有人准备率先攻击，等待其行动。'):'';
  const portrait=(r)=>{
   const user=game.users.get(r.userId),token=canvas.tokens?.get(r.tokenId),actor=token?.actor??user?.character;
   const visible=token?.isVisible&&!token.document.hidden,own=r.userId===game.user.id;
   const image=visible||own?token?.document.texture.src??actor?.img:'icons/svg/mystery-man.svg';
   const name=actor?.testUserPermission(game.user,'LIMITED')?actor.name:user?.name??'队友';
   const vote=storyVote(user,state),info=STORY_CHOICES[vote];
   return `<div class="cp-story-companion cp-story-panel ${own?'is-self':''}" data-story-user="${esc(r.userId)}"><div class="cp-story-portrait"><img src="${esc(image)}" alt="${esc(name)}">${info?`<span class="cp-story-attitude ${vote}" title="${info.label}" aria-label="${info.label}"><i class="fa-solid ${info.icon}" aria-hidden="true"></i></span>`:'<span class="cp-story-waiting" title="尚未表态">·</span>'}</div><strong>${esc(name)}</strong><small>${info?.short??(user?.active?'未表态':'暂时离线')}${own?' · 你':''}</small></div>`;
  };
  const partyHTML=state.roster.map(portrait).join('');if(partyHTML!==this.partyHTML){this.partyHTML=partyHTML;patchHTML(this.el.querySelector('[data-story-party]'),partyHTML);}
  const enemies=this.visibleEnemies(state),enemyHTML=enemies.map((t,i)=>`<div class="cp-story-enemy cp-story-panel" aria-label="敌方指示物 ${i+1}"><div class="cp-story-portrait"><img src="${esc(t.document.texture.src||'icons/svg/mystery-man.svg')}" alt=""></div></div>`).join('');
  if(enemyHTML!==this.enemyHTML){this.enemyHTML=enemyHTML;patchHTML(this.el.querySelector('[data-story-enemies]'),enemyHTML);}
  this.el.querySelector('.cp-story-enemies').hidden=!enemies.length;this.renderChat();this.drawMarks();this.updateCountdown(state);
 }
 async monitorVotes(state){
  if(this.graceWriting||!authority())return;
  const fresh=readStoryState();if(fresh.id!==state.id||fresh.phase!=='story'||fresh.opener)return;
  const tally=storyTally(fresh,game.users),majority=tally.oppose>=tally.threshold;
  // Foundry's synchronized clock is server uptime and resets on a restart.
  const staleClock=fresh.battleAt>storyNow()+STORY_GRACE_MS+1500;
  if((majority&&(!fresh.battleAt||staleClock))||(!majority&&fresh.battleAt)){
   this.graceWriting=true;
   try{await game.settings.set(ID,'storyState',{...fresh,battleAt:majority?storyNow()+STORY_GRACE_MS:null});}
   finally{this.graceWriting=false;this.schedule();}
  }else if(majority&&fresh.battleAt<=storyNow())await this.startBattle(fresh);
 }
 updateCountdown(state){
  const tally=storyTally(state,game.users),deadline=state.battleAt&&!state.opener&&!state.startError&&tally.oppose>=tally.threshold?Number(state.battleAt):null;
  const box=this.el.querySelector('[data-story-countdown]'),gm=this.el.querySelector('[data-story-gm-grace]');
  if(box)box.hidden=!deadline;if(gm)gm.hidden=!deadline;
  if(this.graceDeadline!==deadline){
   if(this.graceFrame)cancelAnimationFrame(this.graceFrame);this.graceFrame=null;
   this.graceDeadline=deadline;clearTimeout(this.graceTimer);this.graceTimer=null;
   if(deadline&&authority())this.graceTimer=setTimeout(()=>{this.graceTimer=null;this.schedule();},Math.max(0,deadline-storyNow()+20));
  }
  if(!deadline){if(this.graceFrame)cancelAnimationFrame(this.graceFrame);this.graceFrame=null;return;}
  const paint=()=>{
   if(!this.sessionId||this.graceDeadline!==deadline){this.graceFrame=null;return;}
   const left=Math.max(0,deadline-storyNow()),seconds=Math.ceil(left/1000);
   const number=this.el.querySelector('[data-story-seconds]');if(number&&number.textContent!==String(seconds))number.textContent=seconds;
   const monitor=this.el.querySelector('[data-story-gm-grace]');if(monitor)monitor.textContent=`准备动手 ${seconds} 秒`;
   box?.style.setProperty('--story-grace-left',String(Math.min(1,left/STORY_GRACE_MS)));
   this.graceFrame=left>0?requestAnimationFrame(paint):null;
  };
  if(!this.graceFrame)paint();
 }
 visibleEnemies(state=readStoryState()){
  if(canvas.scene?.id!==state.sceneId)return [];
  const allies=new Set(state.roster?.map(r=>r.tokenId));
  return (canvas.tokens?.placeables??[]).filter(t=>t.actor&&t.isVisible&&!t.document.hidden&&!allies.has(t.id));
 }
 async publishView(state){
  if(this.viewPending||!state.roster.some(r=>r.userId===game.user.id))return;
  const enemyIds=this.visibleEnemies(state).map(t=>t.id).sort(),signature=state.id+'|'+enemyIds.join(',');
  if(signature===this.viewSignature)return;
  this.viewPending=true;
  try{await game.user.setFlag('fvtt-combat-panel','storyView',{sessionId:state.id,enemyIds});this.viewSignature=signature;}finally{this.viewPending=false;}
 }
 async click(button){
  if(button.hasAttribute('data-story-strike')||button.hasAttribute('data-story-strike-cancel')){await this.strike.request(button.hasAttribute('data-story-strike-cancel')||readStoryState().opener?.userId===game.user.id);return;}
  if(button.dataset.storyTool){this.input.reset();this.mode=button.dataset.storyTool;this.selection=null;this.drawMarks();for(const b of this.el.querySelectorAll('[data-story-tool]'))b.setAttribute('aria-pressed',String(b===button));this.el.querySelector('[data-story-tool-hint]').textContent=this.mode==='measure'?'按住左键拖动测距 · 松开取消 · 右键平移':'右键按住平移地图';}
  if(button.dataset.storyVote){
   const state=readStoryState();if(!isStoryPlayer()||this.votePending||!state.roster.some(r=>r.userId===game.user.id))return;
   const vote={sessionId:state.id,choice:button.dataset.storyVote};this.pendingVote=vote;this.votePending=true;this.render(state);
   try{await game.user.setFlag('fvtt-combat-panel','storyVote',vote);}finally{if(this.pendingVote===vote)this.pendingVote=null;this.votePending=false;this.schedule();}
  }
  if(button.hasAttribute('data-story-send'))await this.sendChat();
 }
 async sendChat(){
  const field=this.el.querySelector('[data-story-message]'),text=field?.value.trim(),state=readStoryState();if(!text||this.sending||!isStoryPlayer())return;
  this.sending=true;
  try{await ChatMessage.create({user:game.user.id,speaker:{alias:game.user.name},style:CONST.CHAT_MESSAGE_STYLES.OOC,content:esc(text).replace(/\n/g,'<br>'),flags:{[ID]:{storySession:state.id}}});field.value='';this.el.querySelector('[data-story-status]').textContent='';}
  catch(error){this.error(error);}finally{this.sending=false;}
 }
 renderChat(){
  const host=this.el.querySelector('[data-story-messages]');if(!host||!isStoryActive())return;
  const messages=game.messages.contents.filter(m=>m.visible&&m.isContentVisible!==false&&!m.blind).slice(-30);
  const html=messages.map(m=>{const template=document.createElement('template');template.innerHTML=m.content;template.content.querySelectorAll('script,style').forEach(e=>e.remove());const body=template.content.textContent.trim().replace(/\s+/g,' ').slice(0,800);if(!body)return '';return `<li data-story-message-id="${m.id}"><strong>${esc(m.author?.isGM?'主持人':m.author?.name??'信息')}</strong><p>${esc(body)}</p></li>`;}).join('');
  if(html===this.chatHTML)return;const bottom=host.scrollHeight-host.scrollTop-host.clientHeight<35;this.chatHTML=html;patchHTML(host,html);if(bottom)host.scrollTop=host.scrollHeight;
 }
 point(event){
  const view=canvas.app.canvas??canvas.app.view,rect=view.getBoundingClientRect(),screen=canvas.app.renderer.screen;
  return canvas.stage.toLocal(new PIXI.Point((event.clientX-rect.left)*screen.width/rect.width,(event.clientY-rect.top)*screen.height/rect.height));
 }
 canvasClick(event){
  if(canvas.scene?.id!==readStoryState().sceneId)return;
  const point=this.point(event);
  const tokens=[...(canvas.tokens?.placeables??[])].reverse();this.selection=tokens.find(t=>t.isVisible&&!t.document.hidden&&t.bounds.contains(point.x,point.y))?.id??null;
  this.drawMarks();
 }
 drawMarks(){
  if(game.user.isGM||!this.sessionId)return;
  const selection=this.el.querySelector('[data-story-selection]'),token=canvas.tokens?.get(this.selection);
  if(selection){const hidden=!token||!token.isVisible;selection.toggleAttribute('hidden',hidden);selection.style.display=hidden?'none':'';if(!hidden){const r=token.bounds,a=canvas.stage.toGlobal(new PIXI.Point(r.x,r.y)),b=canvas.stage.toGlobal(new PIXI.Point(r.x+r.width,r.y+r.height));for(const [key,value]of Object.entries({x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y}))selection.setAttribute(key,value);}}
 }
 async startBattle(state){
  if(!authority()||this.starting===state.id)return;this.starting=state.id;
  try{const fresh=readStoryState();if(fresh.id!==state.id||fresh.phase!=='story'||fresh.opener||!fresh.battleAt||fresh.battleAt>storyNow())return;const tally=storyTally(fresh,game.users);if(tally.oppose<tally.threshold)return;await game.settings.set(ID,'storyState',{...fresh,phase:'starting',reason:'vote',startedAt:storyNow()});await this.advanceBattle(readStoryState());}
  finally{this.starting=null;}
 }
 async advanceBattle(state){
  if(!authority()||state.phase!=='starting'||this.transition===state.id)return;this.transition=state.id;
  try{
   const api=game.modules.get('fvtt-bg3-initiative')?.api;if(!api?.enterStoryEncounter)throw Error('请启用 BG3先攻栏 0.1.0 或更新版本以自动进入遭遇。');
   const combat=await api.enterStoryEncounter(state);
   await game.settings.set(ID,'storyState',{phase:'off',lastSessionId:state.id,lastCombatId:combat.id});
  }catch(error){if(authority()&&readStoryState().id===state.id)await game.settings.set(ID,'storyState',{...readStoryState(),phase:'story',startError:String(error.message??error)});throw error;}
  finally{this.transition=null;}
 }
}
