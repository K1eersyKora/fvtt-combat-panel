const ID='fvtt-bg3-initiative';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function resolveCombat(collection,sceneId,preferredId){
 const applies=c=>c&&(!c.scene||c.scene.id===sceneId);
 const preferred=collection.get(preferredId);
 if(preferred?.active&&applies(preferred))return preferred;
 return [collection.active,collection.viewed].find(applies)??null;
}
export function chineseCharacterName(value){
 return (String(value??'').normalize('NFKC').match(/\p{Script=Han}+(?:[·・]\p{Script=Han}+)*/gu)??[]).join(' ');
}
const dieShape='<svg class="cp-init-die-shape" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path class="cp-init-die-outline" d="M16 1.5 29 8.5V23.5L16 30.5 3 23.5V8.5Z"/><path class="cp-init-die-facets" d="M16 1.5 16 9 3 8.5M16 9 29 8.5M3 23.5 8 23 16 30.5 24 23 29 23.5M8 23 16 9 24 23Z"/></svg>';
let bar;
export function registerBarSettings(){
 game.settings.register(ID,'enabled',{name:'显示顶部先攻栏',scope:'client',config:true,type:Boolean,default:true,onChange:()=>bar?.schedule()});
 game.settings.register(ID,'portraitSize',{name:'先攻栏立绘宽度',scope:'client',config:true,type:Number,default:70,range:{min:44,max:110,step:2},onChange:()=>bar?.schedule()});
 game.settings.register(ID,'hideEnemyInitiative',{name:'向玩家隐藏敌方先攻数值',scope:'world',config:true,type:Boolean,default:true,onChange:()=>bar?.schedule()});
}
export class InitiativeBar{
 constructor(parentUI){
  bar=this;this.ui=parentUI;this.el=document.createElement('section');this.el.id='cp-initiative-bar';this.el.hidden=true;
  this.el.setAttribute('data-combat-panel-theme','');this.el.setAttribute('aria-label','先攻顺序');document.body.appendChild(this.el);
  this.el.addEventListener('error',event=>{const img=event.target;if(img.tagName==='IMG'&&!img.src.endsWith('/icons/svg/mystery-man.svg'))img.src='icons/svg/mystery-man.svg';},true);
  this.el.addEventListener('click',e=>{const button=e.target.closest('button');if(button)void this.click(button).catch(error=>ui.notifications.error(error.message));});
  const ContextMenu=foundry.applications.ux.ContextMenu.implementation;
  this.contextMenu=new ContextMenu(this.el,'.cp-init-card[data-combatant]',[{
   name:'设为当前回合',icon:'<i class="fa-solid fa-hourglass-start"></i>',classes:'cp-init-set-turn',
   condition:target=>this.canSetCurrentTurn(this.el.dataset.combatId,target.dataset.combatant),
   callback:()=>{const target=this.menuTarget;if(target)void this.setCurrentTurn(target.combatId,target.combatantId).catch(error=>ui.notifications.error(error.message));}
  }],{fixed:true,jQuery:false,
   onOpen:target=>{this.menuTarget={combatId:this.el.dataset.combatId,combatantId:target.dataset.combatant};},
   onClose:()=>{this.menuTarget=null;}
  });
  for(const name of ['createCombat','updateCombat','deleteCombat','createCombatant','updateCombatant','deleteCombatant','controlToken','canvasReady','canvasTearDown','renderCombatTracker','updateUser','combatPanelStoryChanged','sightRefresh'])Hooks.on(name,()=>this.schedule());
  Hooks.on('updateActor',actor=>{if(this.combat()?.combatants.some(c=>c.actor?.uuid===actor.uuid))this.schedule();});
  Hooks.on('updateToken',token=>{if(this.combat()?.combatants.some(c=>c.token?.uuid===token.uuid))this.schedule();});
  Hooks.on('combatPanelStoryEncounterStarted',c=>{this.preferredId=c.id;this.schedule();});
  Hooks.on('renderSceneNavigation',()=>this.schedule());
  window.addEventListener('resize',()=>this.schedule());
  this.schedule();
 }
 combat(){return resolveCombat(game.combats,canvas.scene?.id,this.preferredId);}
 schedule(){if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.render();});}
 visible(c){return game.user.isGM||(!c.hidden&&c.visible!==false&&(!c.token?.object||c.token.object.isVisible));}
 canSetCurrentTurn(combatId,combatantId){
  const c=this.combat();
  return !!(game.user.isGM&&!this.pending&&c?.id===combatId&&c.started&&c.combatants.has(combatantId));
 }
 async setCurrentTurn(combatId,combatantId){
  if(!this.canSetCurrentTurn(combatId,combatantId))return false;
  const c=this.combat(),turn=c.turns.findIndex(entry=>entry.id===combatantId);
  if(turn<0||c.turn===turn)return false;
  this.pending=true;this.render();
  try{
   // Resolve the native index at click time, never the rotated portrait index.
   // One document update runs native turn hooks without advancing the round or
   // visiting the skipped combatants' turns.
   await c.update({turn});return true;
  }finally{this.pending=false;this.schedule();}
 }
 render(){
  const c=this.combat(),visible=!!c&&!!canvas.scene&&game.settings.get(ID,'enabled');
  if(ui.context===this.contextMenu&&(!visible||this.menuTarget?.combatId!==c.id||!c.combatants.has(this.menuTarget?.combatantId)))void this.contextMenu.close({animate:false});
  this.el.hidden=!visible;document.body.classList.toggle('cp-initiative-active',visible);if(!visible)return;
  this.el.dataset.combatId=c.id;
  const turns=c.turns.filter(x=>this.visible(x)),current=c.combatant;
  const at=turns.indexOf(current),offset=at>=0?at-Math.floor(turns.length/2):0;
  const ordered=turns.map((_,i)=>turns[(i+offset+turns.length)%turns.length]);
  this.el.style.setProperty('--initiative-size',game.settings.get(ID,'portraitSize')+'px');
  const gm=game.user.isGM,owner=!!current?.isOwner;
  const first=turns[0]?.id;
  const round=`<div id="cp-init-round-${esc(c.id)}" class="cp-init-round" data-round-before="${esc(first)}" aria-label="第 ${c.round} 轮"><i class="fa-solid fa-angle-right" aria-hidden="true"></i><b>${c.round}</b><small>轮</small></div>`;
  const cards=ordered.map(x=>{
   const active=x.id===current?.id,own=x.isOwner,token=x.token?.object,disposition=x.token?.disposition??0;
   const pc=x.actor?.type==='character';
   const name=pc?(chineseCharacterName(x.name)||chineseCharacterName(x.actor?.name)):'';
   const label=name||(pc?'玩家角色':disposition<0?'敌方单位':disposition===0?'中立单位':'友方单位');
   const show=gm||own||!game.settings.get(ID,'hideEnemyInitiative')||x.actor?.hasPlayerOwner;
   const initiative=x.initiative===null?'—':Number.isInteger(x.initiative)?x.initiative:Number(x.initiative).toFixed(2);
   const hp=x.actor?.system.attributes?.hp,showHP=gm||own;
   const percent=hp?.max?Math.max(0,Math.min(100,hp.value/hp.max*100)):0;
   const title=[name,show?'先攻 '+initiative:'',active?'当前回合':''].filter(Boolean).join(' · ');
   return (x.id===first?round:'')+`<button type="button" id="cp-init-card-${esc(c.id)}-${esc(x.id)}" class="cp-init-card ${active?'is-current':''} ${x.isDefeated?'is-defeated':''} ${token?.controlled?'is-controlled':''}" data-combatant="${esc(x.id)}" data-disposition="${disposition}" ${gm&&c.started?'aria-haspopup="menu"':''} aria-current="${active?'step':'false'}" aria-label="${esc(label)}${show?'，先攻 '+initiative:''}${active?'，当前回合':''}" title="${esc(title)}"><img class="cp-init-image" src="${esc(x.actor?.img??x.img??'icons/svg/mystery-man.svg')}" alt="">${showHP?`<span class="cp-init-health"><i style="width:${percent}%"></i></span>`:''}<span class="cp-init-footer"><span class="cp-init-die">${dieShape}<b class="cp-init-number">${show?esc(initiative):'?'}</b></span></span>${name?`<span class="cp-init-name">${esc(name)}</span>`:''}${active?'<i class="fa-solid fa-caret-up cp-init-current" aria-hidden="true"></i>':''}</button>`;
  }).join('');
  const button=(action,icon,title,disabled=false)=>`<button type="button" data-init-action="${action}" title="${title}" aria-label="${title}" ${disabled||this.pending?'disabled':''}><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`;
  this.ui.patchHTML(this.el,`<div class="cp-init-controls">${gm?button('roll','fa-dice-d20','掷未投先攻')+button('previous','fa-chevron-left','上个回合',!c.started):''}</div><div class="cp-init-track">${cards||'<span class="cp-init-empty">将角色加入遭遇</span>'}</div><div class="cp-init-controls">${button('next','fa-chevron-right',gm?'下个回合':'结束我的回合',!c.started||(!gm&&!owner))}${gm?button(c.started?'end':'start',c.started?'fa-flag-checkered':'fa-play',c.started?'结束战斗':'开始战斗'):''}</div>`);
  this.positionControls();
 }
 positionControls(){
  const top=this.el.getBoundingClientRect().top;
  // v13's inactive navigation menu fills the screen even while empty. Only
  // actual scene entries and controls occupy pointer space near these buttons.
  const navigation=[...document.querySelectorAll('#scene-navigation :is(a,button,li.scene),#navigation :is(a,button,li.scene)')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect());
  for(const controls of this.el.querySelectorAll('.cp-init-controls')){
   const bounds=controls.getBoundingClientRect();let offset=48;
   for(const nav of navigation)if(nav.left<bounds.right&&nav.right>bounds.left)offset=Math.max(offset,nav.bottom-top+8);
   controls.style.paddingTop=Math.ceil(offset)+'px';
  }
 }
 async click(button){
  const c=this.combat();if(!c||this.pending)return;
  const id=button.dataset.combatant;
  if(id){const entry=c.combatants.get(id);if(!entry||!this.visible(entry))return;const token=entry.token?.object;if(!token)return;if(entry.isOwner)token.control({releaseOthers:true});if(token.isVisible)await canvas.animatePan(token.center);return;}
  const action=button.dataset.initAction;if(!action)return;
  if(!game.user.isGM&&(action!=='next'||!c.started||!c.combatant?.isOwner))return;
  this.pending=true;this.render();
  try{
   if(action==='next')await c.nextTurn();
   if(action==='previous')await c.previousTurn();
   if(action==='roll'){const ids=c.combatants.filter(x=>x.initiative===null).map(x=>x.id);if(ids.length)await c.rollInitiative(ids);}
   if(action==='start')await c.startCombat();
   if(action==='end')await c.endCombat();
  }finally{this.pending=false;this.schedule();}
 }
}
