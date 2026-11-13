import {getController} from './parent-ui-1.js';
import {peerInfo,placePeerCard} from './peer-info-3.js';
import {spellShapeHTML} from './parent-ui-1.js';
import {isStoryActive} from './story-state-2.js';
const ID='fvtt-party-tools';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const romans=['','Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ','Ⅶ','Ⅷ','Ⅸ'];
const animated=()=>game.modules.get('fvtt-combat-panel')?.api?.ui?.performance?.read().animate!==false;
const portrait=actor=>actor.img||actor.prototypeToken?.texture?.src||'icons/svg/mystery-man.svg';
let inspector;
export function installPeerInspector(){if(game.user.isGM)return;inspector??=new PeerInspector();}

class PeerInspector {
 constructor(){
  this.point=null;this.candidate=null;this.token=null;this.ratio=1;this.mediaCache=new Map();
  this.el=document.createElement('aside');this.el.id='cp-peer-inspector';this.el.setAttribute('role','tooltip');this.el.setAttribute('aria-label','队友角色信息');this.el.hidden=true;document.body.appendChild(this.el);
  this.resize=new ResizeObserver(()=>{if(this.token)this.layout();});this.resize.observe(this.el);
  window.addEventListener('pointermove',e=>this.move(e),{capture:true,passive:true});
  window.addEventListener('pointerdown',()=>this.dismiss(),{capture:true});
  window.addEventListener('keydown',()=>this.dismiss(),{capture:true});
  window.addEventListener('blur',()=>this.dismiss());
  window.addEventListener('resize',()=>{if(this.token)this.layout();this.schedule();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.dismiss();});
  document.addEventListener('pointerleave',()=>this.dismiss());
  Hooks.on('combatPanelStoryPointerMove',e=>this.move(e));Hooks.on('combatPanelStoryPointerDown',()=>this.dismiss());
  Hooks.on('combatPanelStoryChanged',()=>this.dismiss());
  Hooks.on('canvasTearDown',()=>this.dismiss());
  for(const hook of ['dnd5e.preUseActivity','dnd5e.preUseItem','midi-qol.preTargeting','midi-qol.preItemRoll'])Hooks.on(hook,()=>{this.dismiss();});
  for(const hook of ['updateActor','updateItem','createItem','deleteItem','updateActiveEffect','createActiveEffect','deleteActiveEffect','updateToken','updateUser'])Hooks.on(hook,()=>this.schedule(true));
  for(const hook of ['refreshToken','sightRefresh','canvasPan','controlToken','bg3DownedIndicatorsChanged'])Hooks.on(hook,()=>this.schedule());
  Hooks.on('combatPanelPerformanceChanged',()=>{this.signature=null;this.schedule(true);});
  Hooks.once('shutdown',()=>{this.dismiss();this.resize.disconnect();this.el.remove();for(const entry of this.mediaCache.values())this.releaseMedia(entry);this.mediaCache.clear();});
 }
 schedule(update=false){
  if(!this.point||document.hidden)return;
  this.needsUpdate=this.needsUpdate||update;
  if(this.frame!=null)return;
  this.frame=requestAnimationFrame(()=>{this.frame=null;const refresh=this.needsUpdate;this.needsUpdate=false;this.poll();if(this.token){if(refresh)this.update();else this.position();}});
 }
 preparing(){
  const panel=getController(),hud=panel?.hud;
  return !!(hud?.selection||hud?.busy||(hud?.page&&hud.page!=='list')||panel?._drag||hud?.area||[...(hud?._sessions?.values()??[])].some(s=>s.busy)
   ||canvas.templates?.preview?.children?.length||document.querySelector('.application.activity-usage:not([hidden]),.application.roll-configuration:not([hidden]),.dnd5e2.activity-usage:not([hidden])'));
 }
 pointOnCanvas(){
  if(!this.point||!canvas.ready||document.hidden||this.preparing())return false;
  const hit=document.elementFromPoint(this.point.x,this.point.y);
  if(isStoryActive())return !!hit?.closest?.('#cp-story-ui')&&!hit.closest('.cp-story-interactive');
  return hit===(canvas.app?.canvas??canvas.app?.view)||hit?.id==='board';
 }
 eligible(token){
  if(!token||token.destroyed||!token.document||!token.actor||!token.isVisible||token.visible===false||token.document.hidden||token.renderable===false)return false;
  if(token.actor.id===game.user.character?.id)return false;
  return game.users.some(u=>!u.isGM&&u.role>0&&u.id!==game.user.id&&token.actor.testUserPermission(u,'OWNER'));
 }
 atPoint(){
  if(!this.pointOnCanvas())return null;
  const view=canvas.app?.canvas??canvas.app?.view,rect=view.getBoundingClientRect(),screen=canvas.app.renderer.screen;
  const p=canvas.stage.toLocal(new PIXI.Point((this.point.x-rect.left)*screen.width/rect.width,(this.point.y-rect.top)*screen.height/rect.height));
  const tokens=canvas.tokens.objects?.children??canvas.tokens.placeables;
  for(let i=tokens.length-1;i>=0;i--){const token=tokens[i];if(token?.document&&token.isVisible&&token.visible!==false&&!token.document.hidden&&token.bounds?.contains(p.x,p.y))return this.eligible(token)?token:null;}
  return null;
 }
 move(event){if(event.buttons){this.dismiss();return;}this.point={x:event.clientX,y:event.clientY};this.schedule();}
 poll(){
  const token=this.atPoint();
  if(token?.id===this.candidate?.id){if(this.token&&this.preparing())this.dismiss();return;}
  this.hide();clearTimeout(this.timer);this.timer=null;this.candidate=token;
  if(!token)return;
  this.preload(portrait(token.actor));
  this.started=performance.now();
  this.timer=setTimeout(()=>{this.timer=null;const current=this.atPoint();if(current?.id===token.id&&performance.now()-this.started>=990)this.show(token);},1000);
 }
 dismiss(){this.point=null;this.candidate=null;clearTimeout(this.timer);this.timer=null;cancelAnimationFrame(this.frame);this.frame=null;this.needsUpdate=false;this.hide();}
 hide(){this.el.hidden=true;this.token=null;this.signature=null;this.el.querySelector('video')?.pause();if(this.el.parentElement!==document.body)document.body.appendChild(this.el);}
 preload(src){
  if(this.mediaCache.has(src)){const entry=this.mediaCache.get(src);this.mediaCache.delete(src);this.mediaCache.set(src,entry);return;}
  // Keep metadata for recent portraits without retaining every visited video
  // and decoded image for the lifetime of the client.
  if(this.mediaCache.size>=16){const key=this.mediaCache.keys().next().value;this.releaseMedia(this.mediaCache.get(key));this.mediaCache.delete(key);}
  const video=/\.(webm|mp4|m4v)(?:[?#]|$)/i.test(src),media=document.createElement(video?'video':'img');
  if(video){media.preload='metadata';media.muted=true;}
  const entry={ratio:1,media};this.mediaCache.set(src,entry);
  media.addEventListener(video?'loadedmetadata':'load',()=>{const w=video?media.videoWidth:media.naturalWidth,h=video?media.videoHeight:media.naturalHeight;entry.ratio=w&&h?w/h:1;if(this.token&&portrait(this.token.actor)===src){this.ratio=entry.ratio;this.layout();}},{once:true});
  media.src=src;
 }
 releaseMedia(entry){entry.media.pause?.();entry.media.removeAttribute('src');entry.media.load?.();}
 show(token){
  if(!this.eligible(token)||this.preparing())return;
  this.token=token;const parent=isStoryActive()?document.getElementById('cp-story-ui'):document.body;parent.appendChild(this.el);
  this.el.hidden=false;this.el.style.visibility='hidden';this.update();
 }
 update(){
  const token=this.token;if(!token)return;if(!this.eligible(token)||this.preparing()){this.dismiss();return;}
  const data=peerInfo(token.actor),signature=JSON.stringify(data);
  if(signature===this.signature){this.position();return;}this.signature=signature;
  this.preload(data.img);this.ratio=this.mediaCache.get(data.img)?.ratio??1;
  const media=/\.(webm|mp4|m4v)(?:[?#]|$)/i.test(data.img)?`<video src="${esc(data.img)}" ${animated()?'autoplay loop':''} preload="metadata" muted playsinline aria-label="${esc(data.name)} 的立绘"></video>`:`<img src="${esc(data.img)}" alt="${esc(data.name)} 的立绘">`;
  const total=data.hp.max+data.hp.temp,pct=total>0?Math.min(100,Math.max(0,data.hp.value/total*100)):0,tempPct=total>0?Math.min(100-pct,data.hp.temp/total*100):0;
  this.el.dataset.tokenId=token.id;this.el.dataset.actorId=token.actor.id;this.el.dataset.resourceCount=data.resources.length;
  this.el.querySelector('video')?.pause();
  this.el.innerHTML=`<div class="cp-peer-portrait">${media}</div><div class="cp-peer-body"><header><span class="cp-peer-label">队友档案</span><strong>${esc(data.name)}</strong><b>${esc(data.levelLabel)}</b></header>
   <div class="cp-peer-class"><span>职业</span><strong>${esc(data.classes.map(c=>data.classes.length>1?`${c.name} ${c.level}`:c.name).join(' · ')||'—')}</strong><span>子职</span><strong>${esc(data.subclasses.join(' · ')||'—')}</strong></div>
   <div class="cp-peer-vitals bg3-vitals"><span class="bg3-ac" aria-label="护甲等级 ${esc(data.ac)}">AC <b>${esc(data.ac)}</b></span><span class="bg3-hp" aria-label="生命值 ${data.hp.value}/${data.hp.max}${data.hp.temp?'，临时生命 '+data.hp.temp:''}"><i style="width:${pct}%"></i>${data.hp.temp?`<i class="temp" style="left:${pct}%;width:${tempPct}%"></i>`:''}<b>${data.hp.value}/${data.hp.max}${data.hp.temp?` <em>+${data.hp.temp}</em>`:''}</b></span></div>
   <section><h3>关键特性资源</h3>${data.resources.length?`<div class="cp-peer-resources ${data.resources.length>10?'many':''}">${data.resources.map(r=>`<div class="cp-peer-resource ${r.value===0?'empty':''}" aria-label="${esc(r.label)}，剩余 ${r.value}，上限 ${r.max}"><span>${esc(r.label)}</span><b><span>${r.value}</span><small>/</small><span>${r.max}</span></b></div>`).join('')}</div>`:'<p class="cp-peer-empty">无可消耗特性资源</p>'}</section>
   <section><h3>法术位资源</h3>${data.slots.length?`<div class="cp-peer-slots">${data.slots.map(s=>`<div class="cp-peer-slot bg3-spell-level ${s.pact?'bg3-level-pact':''} ${s.value===0?'empty':''}" data-peer-slot="${s.key}" role="img" aria-label="${s.pact?'契约':''}${s.level}环，剩余 ${s.value}，上限 ${s.max}"><b class="bg3-lvl">${s.pact?'契 ':''}${romans[s.level]??s.level}</b>${spellShapeHTML(s.max,s.value,s.pact?'pact':'normal')}</div>`).join('')}</div>`:'<p class="cp-peer-empty">无法术位</p>'}</section></div>`;
  this.el.querySelector('img')?.addEventListener('error',event=>{const image=event.currentTarget;if(!image.src.endsWith('icons/svg/mystery-man.svg')){image.src='icons/svg/mystery-man.svg';this.ratio=1;this.layout();}},{once:true});
  this.layout();
 }
 layout(){
  if(this.el.hidden)return;
  const body=this.el.querySelector('.cp-peer-body');if(!body)return;
  const width=Math.min(Number(this.el.dataset.resourceCount)>10?380:320,Math.max(220,innerWidth*.53));
  this.el.style.setProperty('--peer-body-width',width+'px');
  const height=body.offsetHeight;
  this.el.style.setProperty('--peer-art-width',`${Math.max(100,Math.min(400,height*this.ratio,innerWidth-width-32))}px`);
  this.position();
 }
 position(){
  const token=this.token;if(!token||this.el.hidden)return;
  if(!this.eligible(token)||this.preparing()){this.dismiss();return;}
  const view=canvas.app?.canvas??canvas.app?.view;if(!view)return;const r=view.getBoundingClientRect(),screen=canvas.app.renderer.screen,rx=r.width/screen.width,ry=r.height/screen.height;
  const bounds=token.bounds,a=canvas.stage.toGlobal(new PIXI.Point(bounds.x,bounds.y)),b=canvas.stage.toGlobal(new PIXI.Point(bounds.x+bounds.width,bounds.y+bounds.height));
  const anchor={left:r.left+a.x*rx,top:r.top+a.y*ry,right:r.left+b.x*rx,bottom:r.top+b.y*ry};anchor.cx=(anchor.left+anchor.right)/2;anchor.cy=(anchor.top+anchor.bottom)/2;
  const rects=selector=>[...document.querySelectorAll(selector)].filter(e=>!e.hidden&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none').map(e=>e.getBoundingClientRect()).filter(b=>b.width&&b.height);
  const death=rects('.bg3-downed-indicator');
  const chrome=rects('#cp-party-panel,#dsh-bg3-hud,#sidebar,#cp-initiative-bar,.cp-story-interactive,.cp-story-countdown:not([hidden])');
  const bar=isStoryActive()?document.querySelector('.cp-story-bar.top')?.getBoundingClientRect().height??0:0;
  const area={left:10,right:innerWidth-10,top:10+bar,bottom:innerHeight-10-bar};area.width=area.right-area.left;area.height=area.bottom-area.top;
  if(area.width<180||area.height<180){this.el.style.visibility='hidden';return;}
  const placement=placePeerCard({width:this.el.offsetWidth,height:this.el.offsetHeight},anchor,area,death,chrome);
  if(!placement||placement.blocked>0){this.el.style.visibility='hidden';return;}
  this.el.style.visibility='';this.el.style.left=placement.left+'px';this.el.style.top=placement.top+'px';this.el.style.transform=`scale(${placement.scale})`;
 }
}
