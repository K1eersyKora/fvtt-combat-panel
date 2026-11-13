import {installHUDTheme} from './hud-theme-200.js';
import {readPerformance, PERFORMANCE_HOOK} from './performance-199.js';
import {openHUDSettings} from './hud-settings-200.js';
import { PanelAudio } from './panel-audio-199.js';
import { classInfo } from './class-icons-163.js';
import { readDisplay, saveDisplay, normalizeScale, MIN_SCALE, MAX_SCALE } from './hud-display-172.js';
import { patchHTML } from './hud-dom-172.js';
import { matchesFreeSource, canManageFree, freeConsumptionTargets } from './free-use-161.js';
import { targetPlan, rayActivity, missileBolt, eldritchBlastBeam, prepareMultiActivity } from './multitarget-176.js';
import { AreaAim, activityTargetKind, bindConfirmedPlacement, prepareAreaActivity } from './area-targeting-173.js';
import { teleportWorkflow, teleportTargetKind, prepareTeleportActivity } from './teleport-workflow-192.js';
import { areaChoicePlan, AreaChoiceAim, prepareAreaChoiceActivity } from './area-choice-188.js';
import { getPredictionPolicy, PREDICTION_POLICY_HOOK, PREDICTION_MODE_LABELS } from './prediction-policy-156.js';
import {
  weaponSlots, normalAttackActivity, otherAttackActivities, topbarHTML,
  nameParts, shortName, resourceChipHTML, navHTML, emptyHTML, spellShapeHTML,
} from './hud-parts-152.js';
import { itemFreeUseOption, resourceMeta, usesLeft as featureUsesLeft, isTransferActivity } from './feature-core-147.js';
import { curateGroup } from './curation-159.js';
import {
  MAX_ROWS, hudRows, maxRowsFor, normalizeRows, clampRow, scrollForRow, columnCount, overflowState,
} from './skill-layout-151.js';
import { buildTooltipModel, renderTooltipHTML } from './tooltip-172.js';
/* Local BG3-style HUD. All committed uses remain owned by dnd5e/midi-qol. */
const ID = 'fvtt-combat-panel';
const GROUPS = ['equipment', 'features', 'spells'];
const GROUP_LABEL = {equipment: '装备', features: '特性', spells: '法术'};
const DEFAULT_RATIOS = [0.8, 1, 1.4];
const HUD_WIDTH = {min:620,max:1280,initial:960};
const HUD_EDGE=12, HUD_SAFE_RIGHT=380;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const levelMark=n=>'0ⅠⅡⅢⅣⅤⅥⅦⅧⅨ'[n]??String(n);
function readHudWidth(){try{const n=parseFloat(localStorage.getItem('bg3-hud-width'));if(Number.isFinite(n))return clamp(n,HUD_WIDTH.min,HUD_WIDTH.max);}catch{}return HUD_WIDTH.initial;}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list = value => Array.from(value?.contents ?? value ?? []);
const roman = n => ['0','I','II','III','IV','V','VI','VII','VIII','IX'][n] ?? String(n);
const fallback = 'icons/svg/book.svg';
const actions = {action:'动作',bonus:'附赠动作',reaction:'反应',special:'特殊',none:'无需动作'};
const periods = {lr:'长休恢复',sr:'短休恢复',day:'每日恢复',manual:'手动恢复'};

export function usesLeft(item) {
  const uses = item?.system?.uses ?? {};
  const max = Math.max(0, Number(uses.max) || 0);
  return { max, value: Math.max(0, Math.min(max, Number.isFinite(Number(uses.value)) ? Number(uses.value) : max - (Number(uses.spent) || 0))) };
}

export function spellOptions(actor, item, activity) {
  const level = Number(item.system?.level) || 0;
  if (activity.type === 'forward') {
    const resource = resourceMeta(actor, item, [activity]);
    return [{key:'native',kind:'native',level,label:activity.name || '免费施法',
      value:resource?.value ?? 1,max:resource?.max ?? 1}];
  }
  const consumes = activity.requiresSpellSlot && activity.consumption?.spellSlot;
  const out = [];
  if (consumes) for (const [key, slot] of Object.entries(actor.system?.spells ?? {})) {
    const n = Number(slot.level) || Number(key.match(/^spell(\d)$/)?.[1]) || 0;
    if (n < level || n < 1 || (Number(slot.max) || 0) < 1) continue;
    out.push({key,level:n,label:`${n} 环${key==='pact'?' · 契约':''}`,value:Number(slot.value)||0,max:Number(slot.max)||0,kind:'slot'});
  }
  if (!consumes) out.push({key:'native',level,label:item.type!=='spell'?'使用':level?`${level} 环 · 原生施放`:'戏法',kind:'native',value:1,max:1});
  // A feature's own charges already belong to its normal-use route.
  const itemFree = item.type==='spell' ? itemFreeUseOption(item, level) : null;
  if (itemFree) out.push(itemFree);
  for (const resource of list(actor.items)) {
    const meta = resource.flags?.[ID]?.freeCast;
    if (!matchesFreeSource(resource,item) || meta.disabled) continue;
    const uses = usesLeft(resource);
    out.push({key:resource.id,level,kind:'free',label:meta.source || resource.name,...uses,period:meta.period || 'lr'});
  }
  const rank = o => o.kind === 'free' ? 2 : o.kind === 'item' ? 1 : 0;
  return out.sort((a,b)=>rank(a)-rank(b) || a.level-b.level);
}

export class BottomHUD {
  constructor(panel) {
    this.panel=panel;this.audio=new PanelAudio();this._soundInput=0;
    this.enabled=true;
    // Workflow state belongs to this client's actor, never to the shared HUD view.
    this._sessions=new Map();this._session=this.createSession(null);this._targetOperation=null;
    this.filterActivation=null;
    this.filterLevel=null;this.pendingPrefs=new Map();this.saveQueue=Promise.resolve();this.resizing=null;this.vResize=null;
    this.suppressUntil=0; this.actorId=null; this.lastPoint=null;
    this.preferredScale=readDisplay().scale;this.scale=this.preferredScale;this.hudWidth=readHudWidth();this.widthResize=null;
    this.rows=3; this.pages={equipment:0,features:0,spells:0}; this.layout={}; this.curation={};
    this._layoutSig=null; this._relayoutTimer=null; this._tipTimer=null; this._tipHideTimer=null;
    this._tipBtn=null; this.tipItem=null; this._scrollFrame=null; this._tipLocked=false;
    this.el=document.createElement('section'); this.el.id='dsh-bg3-hud'; this.el.hidden=true;
    this.el.setAttribute('aria-label','战斗技能栏'); document.body.appendChild(this.el);
    this.tip=document.createElement('aside');this.tip.id='dsh-bg3-tooltip';this.tip.hidden=true;document.body.appendChild(this.tip);
    this.badges=document.createElement('div');this.badges.id='dsh-bg3-target-badges';document.body.appendChild(this.badges);
    this.install();this.bind();installHUDTheme(this);
  }

  createSession(actorUuid) {
    return {actorUuid,page:'list',selection:null,busy:false,aborting:false,activeWorkflow:null,
      _activeSeq:null,_activeUsage:null,operation:null,cancelExecution:null};
  }

  get page() { return this._session.page; }
  set page(value) { this._session.page=value; }
  get selection() { return this._session.selection; }
  set selection(value) { this._session.selection=value; }
  get busy() { return this._session.busy; }
  set busy(value) { this._session.busy=value; }
  get aborting() { return this._session.aborting; }
  set aborting(value) { this._session.aborting=value; }
  get activeWorkflow() { return this._session.activeWorkflow; }
  set activeWorkflow(value) { this._session.activeWorkflow=value; }
  get _activeSeq() { return this._session._activeSeq; }
  set _activeSeq(value) { this._session._activeSeq=value; }
  get _activeUsage() { return this._session._activeUsage; }
  set _activeUsage(value) { this._session._activeUsage=value; }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.cancel(false);
      this.hideTip();
      this.el.hidden = true;
      this.position();
    } else if (this.panel.actor) {
      this.render();
    } else {
      this.el.hidden = !this.busy;
      this.position();
    }
  }

  syncActor() {
    const uuid=this.panel.actor?.uuid??null,previous=this._session;
    // System template placement temporarily releases token control. Keep its cancel button.
    if(uuid===previous.actorUuid||(!uuid&&previous.busy))return false;
    this._soundInput++;this.audio.stop();this.clearVisuals();this.hideTip(0);this._tipLocked=false;this._targetOperation=null;
    if(!previous.busy){previous.selection=null;previous.page='list';}
    if(!this._sessions.has(uuid))this._sessions.set(uuid,this.createSession(uuid));
    this._session=this._sessions.get(uuid);
    return true;
  }

  releaseOperationTargets(operation) {
    if(!operation||this._targetOperation!==operation)return;
    this._targetOperation=null;
    if (operation.clearTargets) {
      if (operation.inputRevision !== this._targetInputRevision) {
        // A native teleport picker also consumes canvas clicks. Remove only its
        // implicit caster target; preserve new targets chosen by the user.
        const source=operation.teleportSource;
        if(source&&!operation.prior.has(source)&&game.user.targets.has(source))source.setTarget(false,{releaseOthers:false,user:game.user});
        return;
      }
      for (const token of [...game.user.targets]) {
        if (operation.ownedTargets.has(token)) token.setTarget(false,{releaseOthers:false,user:game.user});
      }
    } else if(operation.selection.plan){
      for(const t of [...game.user.targets])t.setTarget(false,{releaseOthers:false,user:game.user});
    }else if(this.panel._targetRevision===operation.targetRevision){
      for(const t of [...game.user.targets])if(!operation.prior.has(t))t.setTarget(false,{releaseOthers:false,user:game.user});
      for(const t of operation.prior)if(!t.destroyed)t.setTarget(true,{releaseOthers:false,user:game.user});
    }
  }

  install() {
    const p=this.panel;
    this._targetInputRevision = 0;
    const oldKind = p._dragKind.bind(p);
    p._dragKind = activity => teleportTargetKind(activity, a => activityTargetKind(a, oldKind));
    const oldList=p._activityList.bind(p);
    p._activityList=item=>{const all=oldList(item),ids=item?.flags?.['chris-premades']?.activityIdentifiers??{},hidden=item?.flags?.['chris-premades']?.hiddenActivities??[];return all.filter(a=>!hidden.some(k=>ids[k]===a.id)&&!a.midiProperties?.automationOnly);};
    const oldPosition=p._syncPosition.bind(p);p._syncPosition=()=>{oldPosition();this.syncTargets();};
    Hooks.on('canvasTearDown',()=>{this.audio.stop();if(!this.busy)this.cancel();this.badges.replaceChildren();});
    Hooks.on('deleteToken',doc=>{if(!this.busy&&this.selection?.targets?.includes(doc.id)){this.selection.targets=this.selection.targets.filter(id=>id!==doc.id);this.renderChoice();this.syncTargets();}});
    const oldCancel=p._cancelDrag.bind(p);
    this.clearVisuals=()=>{this.area?.destroy();this.area=null;this._areaGeneration=(this._areaGeneration||0)+1;this.badges.replaceChildren();oldCancel();};
    Hooks.on(PREDICTION_POLICY_HOOK,()=>{this._areaGeneration++;p._invalidatePreview();p._hideTargetOverlay();if(p.$hit){p.$hit.textContent='';p.$hit.removeAttribute('title');p.$hit.removeAttribute('aria-label');}this._areaPredictionKey=null;this.badges.replaceChildren();});
    p._cancelDrag=()=>{this.cancel();};
    const sync=p._syncDragVisuals.bind(p);
    p._syncDragVisuals=()=>{if(p._drag?.hudHidden)return;sync();};
    const refresh=p.refresh.bind(p);p.refresh=()=>{refresh();const changed=this.syncActor();if(this.actorId!==p.actor?.uuid){this.actorId=p.actor?.uuid;this.filterLevel=null;this.filterActivation=null;this.pages={equipment:0,features:0,spells:0};this.layout={};this.curation={};if(this.resizing){this.resizing=null;this.el.classList.remove('resizing');}}if(changed){this.closeChoice();this.render();}};
    const create=subject=>{const actor=subject?.documentName==='Item'?subject.parent:subject;if(p.actor&&(!actor||actor.uuid===p.actor.uuid))p.refresh();};
    const invalidateCuration=item=>{if(!item?.parent||item.parent.uuid===this.actorId||item.parent===p.actor)this.curation={};};
    Hooks.on('createItem',item=>{create();invalidateCuration(item);});
    Hooks.on('updateItem',invalidateCuration);
    Hooks.on('updateActor',actor=>{if(actor?.id===p.actor?.id)delete this.curation.spells;});
    Hooks.on('deleteItem',invalidateCuration);
    Hooks.on('dnd5e.restCompleted',create);
    Hooks.on('updateUser',(user,change)=>{if(user.id===game.user.id&&change.flags?.[ID]?.hudDisplay){this.preferredScale=readDisplay().scale;this.position();}});
    Hooks.on(PERFORMANCE_HOOK,()=>{p.requestRender();this.settingsSheet?.syncPerformance();});
    this.position();
    const layout=()=>this.schedulePosition(),observers=[];
    for(const target of [document.body,document.getElementById('sidebar'),this.el].filter(Boolean)){const observer=new ResizeObserver(layout);observer.observe(target);observers.push(observer);}
    const sidebar=document.getElementById('sidebar');if(sidebar){sidebar.addEventListener('transitionend',layout);const observer=new MutationObserver(layout);observer.observe(sidebar,{attributes:true,attributeFilter:['class','style','hidden']});observers.push(observer);}
    window.addEventListener('resize',layout);
    Hooks.once('shutdown',()=>{for(const observer of observers)observer.disconnect();sidebar?.removeEventListener('transitionend',layout);window.removeEventListener('resize',layout);cancelAnimationFrame(this._positionFrame);this.audio.destroy();});
  }

  bind() {
    this.el.addEventListener('error',ev=>{const img=ev.target;if(img.tagName!=='IMG')return;const replacement=img.classList.contains('bg3-token-image')?'icons/svg/mystery-man.svg':fallback;if(!img.src.endsWith(replacement))img.src=replacement;},true);
    this.el.addEventListener('click',ev=>{ev.stopPropagation();void this.click(ev).catch(err=>this.error(err));});
    this.el.addEventListener('pointerover',ev=>{this._hoverPoint={x:ev.clientX,y:ev.clientY};this.tooltip(ev);});
    this.el.addEventListener('pointermove',ev=>{this._hoverPoint={x:ev.clientX,y:ev.clientY};if(!this._tipBtn&&!this.resizing&&!this.vResize&&!this.widthResize)this.tooltip(ev);});
    this.el.addEventListener('pointerleave',()=>{this._hoverPoint=null;this.hideTip(200);});
    this.el.addEventListener('scroll',ev=>{const grid=ev.target?.closest?.('.bg3-grid');if(grid)this.onGridScroll(grid);},true);
    this.el.addEventListener('wheel', ev => {
      if (ev.ctrlKey && ev.deltaY) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!this.widthResize && !this.resizing && !this.vResize) {
          this.setHudSize(this.preferredScale + (ev.deltaY < 0 ? 0.05 : -0.05), this.hudWidth);
        }
        return;
      }
      const strip = ev.target.closest?.('.bg3-upcast-slots');
      if (!strip || strip.scrollWidth <= strip.clientWidth || ev.deltaX || !ev.deltaY) return;
      ev.preventDefault();
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? strip.clientWidth : 1;
      strip.scrollLeft += ev.deltaY * unit;
    }, {passive:false});
    this.tip.addEventListener('pointerenter',()=>{clearTimeout(this._tipHideTimer);});
    this.tip.addEventListener('pointerleave',()=>this.hideTip(120));
    this.tip.addEventListener('click',ev=>{const b=ev.target.closest('[data-tip-sheet]');if(b){ev.preventDefault();this.tipItem?.sheet?.render(true);}});
    this.el.addEventListener('pointerdown',ev=>{this._soundInput++;this.audio.stop();this.beginResize(ev);ev.stopPropagation();});
    this.el.addEventListener('pointermove',ev=>{if(this.widthResize?.pointer===ev.pointerId){ev.preventDefault();ev.stopPropagation();this.moveWidthResize(ev);return;}if(this.vResize&&this.vResize.pointer===ev.pointerId){ev.preventDefault();ev.stopPropagation();this.moveVResize(ev);return;}const d=this.resizing;if(!d||d.pointer!==ev.pointerId)return;ev.preventDefault();ev.stopPropagation();d.next=this.resizeBy(d.widths,d.index,(ev.clientX-d.x)/this.scale);});
    this.el.addEventListener('pointerup',ev=>{if(this.widthResize){this.endWidthResize(ev,false);return;}if(this.vResize)this.endVResize(ev);else this.endResize(ev);});
    this.el.addEventListener('pointercancel',ev=>{if(this.widthResize){this.endWidthResize(ev,true);return;}if(this.vResize)this.endVResize(ev,true);else this.endResize(ev,true);});
    this.el.addEventListener('lostpointercapture',ev=>{if(this.widthResize){this.endWidthResize(ev,true);return;}if(this.vResize)this.endVResize(ev,true);else this.endResize(ev,true);});
    this.el.addEventListener('error',ev=>{const img=ev.target;if(img.tagName!=='IMG')return;const replacement=img.classList.contains('bg3-token-image')?'icons/svg/mystery-man.svg':fallback;if(!img.src.endsWith(replacement)){img.dataset.hudFailedSrc=img.getAttribute('src');img.src=replacement;}},true);
    this.el.addEventListener('dblclick',ev=>{if(ev.target.closest('[data-hud-height]')&&!this.busy){ev.preventDefault();void this.savePreference(this.storeActor(),'rows',null).catch(()=>{});return;}if(ev.target.closest('[data-hud-divider]')&&!this.busy){ev.preventDefault();void this.savePreference(this.storeActor(),'ratios',[...DEFAULT_RATIOS]).catch(()=>{});this.render();}});
    this.el.addEventListener('contextmenu',ev=>{this.audio.stop();
      const badge=ev.target.closest('[data-hud-class]'),slot=ev.target.closest('[data-hud-weapon]');
      if(!badge&&!slot)return;
      ev.preventDefault();ev.stopPropagation();
      if(badge)return;
      this.removeWeaponSlot(Number(slot.dataset.hudWeapon));
    });
    this.el.addEventListener('dragstart',ev=>{
      const item=ev.target.closest('[data-hud-drag]');if(!item)return;
      ev.dataTransfer?.setData('text/plain',item.dataset.hudDrag);
      if(ev.dataTransfer)ev.dataTransfer.effectAllowed='copy';
    });
    this.el.addEventListener('dragover',ev=>{
      const slot=ev.target.closest('[data-hud-weapon]');if(!slot||this.busy)return;
      ev.preventDefault();if(ev.dataTransfer)ev.dataTransfer.dropEffect='copy';slot.classList.add('drop-target');
    });
    this.el.addEventListener('dragleave',ev=>{ev.target.closest('[data-hud-weapon]')?.classList.remove('drop-target');});
    this.el.addEventListener('drop',ev=>{
      const slot=ev.target.closest('[data-hud-weapon]');if(!slot||this.busy)return;
      ev.preventDefault();slot.classList.remove('drop-target');
      const itemId=ev.dataTransfer?.getData('text/plain'),item=this.panel.actor.items.get(itemId);
      if(!item||item.type!=='weapon'){this.status('只能把武器放进武器槽');return;}
      void this.assignWeapon(Number(slot.dataset.hudWeapon),itemId).catch(err=>this.error(err));
    });
    this.el.addEventListener('keydown',ev=>{
      const grip=ev.target.closest('[data-hud-width]');
      if(grip&&!this.busy&&['ArrowLeft','ArrowRight'].includes(ev.key)){ev.preventDefault();ev.stopPropagation();const direction=(ev.key==='ArrowRight'?1:-1)*Number(grip.dataset.hudWidth),{min,max}=this.widthBounds();if(max>min)this.setHudSize(this.preferredScale,clamp(this.el.offsetWidth+direction*24,min,max));return;}
      if(ev.target.closest('[data-hud-height]')&&!this.busy&&(ev.key==='ArrowUp'||ev.key==='ArrowDown')){ev.preventDefault();ev.stopPropagation();void this.nudgeRows(ev.key==='ArrowUp'?1:-1).catch(()=>{});return;}
      const handle=ev.target.closest('[data-hud-divider]');if(!handle||this.busy||!['ArrowLeft','ArrowRight'].includes(ev.key))return;
      ev.preventDefault();ev.stopPropagation();const index=Number(handle.dataset.hudDivider),widths=this.zoneWidths();
      const next=this.resizeBy(widths,index,(ev.key==='ArrowLeft'?-10:10));void this.savePreference(this.storeActor(),'ratios',this.zoneWeights(next)).catch(()=>{});
    });
    document.addEventListener('wheel',ev=>{if(!this.area||this.busy||!this.onCanvas(ev))return;ev.preventDefault();ev.stopImmediatePropagation();this.area.rotate(ev);this.syncAreaTargets();},{capture:true,passive:false});
    document.addEventListener('pointerdown',ev=>{
      if (this.busy && this.onCanvas(ev)) this._targetInputRevision++;
      if(this.isChoosing()){const anchor=ev.target.closest?.('[data-hud-item]')===this.choiceAnchor();if(!anchor&&!ev.target.closest?.('.bg3-choice-popover')&&!this.tip.contains(ev.target))this.cancel(false);return;}
      if(!this.selection||this.busy||!this.onCanvas(ev))return;
      if(ev.button!==0&&ev.button!==2)return;
      ev.preventDefault();ev.stopImmediatePropagation();this.suppressUntil=performance.now()+400;
      if(ev.button===2){this.cancel();return;}
      void this.submit(ev).catch(err=>this.error(err));
    },true);
    for(const name of ['pointerup','click','dblclick','contextmenu'])document.addEventListener(name,ev=>{
      if(name==='contextmenu'&&this.selection&&!this.busy&&!ev.target.closest?.('.bg3-weapons,[data-hud-class]')){ev.preventDefault();ev.stopImmediatePropagation();this.cancel();return;}
      if(performance.now()<this.suppressUntil&&this.onCanvas(ev)){ev.preventDefault();ev.stopImmediatePropagation();}
    },true);
    document.addEventListener('keydown',ev=>{
      if (this.busy && ev.key.toLowerCase() === 't'
        && !ev.target.closest?.('input,textarea,[contenteditable="true"]')) this._targetInputRevision++;
      if(ev.key!=='Escape'||!this.enabled)return;this._soundInput++;this.audio.stop();
      if(this.busy&&this._activeSeq){
        if(this.aborting)return;
        ev.preventDefault();ev.stopImmediatePropagation();void this.abortActive().catch(err=>this.error(err));return;
      }
      if(!this.busy&&(this.selection||this.page!=='list')){ev.preventDefault();ev.stopImmediatePropagation();this.cancel();}
    },true);
  }

  onCanvas(ev) { return ev.target===canvas.app?.view || ev.target===canvas.app?.canvas || ev.target?.tagName==='CANVAS'; }

  schedulePosition() {
    if(this._positionFrame!=null||document.hidden)return;
    this._positionFrame=requestAnimationFrame(()=>{this._positionFrame=null;this.position();});
  }

  position() {
    const viewport=document.documentElement.clientWidth||innerWidth;
    const sidebar=document.getElementById('sidebar')?.getBoundingClientRect();
    const players=document.getElementById('players')?.getBoundingClientRect();
    const left=viewport>760?Math.max(100,(players?.width?players.right:88)+HUD_EDGE):HUD_EDGE;
    const sidebarReserve=sidebar?.width&&sidebar.right>=viewport-24&&sidebar.left>HUD_EDGE?viewport-sidebar.left+HUD_EDGE:0;
    const compactReserve=Math.min(HUD_SAFE_RIGHT,Math.max(40,viewport-left-240));
    const reserve=Math.min(Math.max(0,viewport-left-120),Math.max(compactReserve,sidebarReserve));
    this.hudRightEdge=viewport-reserve;
    const available=Math.max(1,this.hudRightEdge-left);
    this.scaleLimit=Math.max(MIN_SCALE,Math.min(MAX_SCALE,available/240));
    this.scale=Math.min(normalizeScale(this.preferredScale),this.scaleLimit);
    this.hudFitWidth=available/this.scale;
    const width=Math.min(this.hudWidth,this.hudFitWidth),half=width*this.scale/2;
    const center=clamp(viewport/2-140,left+half,this.hudRightEdge-half);
    const style=this.el.style;
    style.setProperty('--hud-scale',String(this.scale));style.setProperty('--hud-max-w',this.hudWidth+'px');style.setProperty('--hud-fit-w',this.hudFitWidth+'px');style.setProperty('--hud-center',center+'px');
    this.el.dataset.background=readDisplay().background;
    const label=this.el.querySelector('[data-hud-scale-label]');if(label)label.value=Math.round(this.scale*100)+'%';
    this.positionScale();if(!this.vResize)this.applyRows();
    document.body.classList.toggle('dsh-bg3-active',!this.el.hidden);
    this.positionChrome();this.positionChoice();
    if(!this.tip.hidden&&this._tipBtn?.isConnected)this.positionTip(this._tipBtn);
    const sig=this.scale+'|'+this.rows+'|'+this.el.clientWidth+'|'+this.el.clientHeight+'|'+this.actorId;
    if(this._layoutSig&&this._layoutSig!==sig&&this.panel.actor&&!this.el.hidden)this.scheduleRelayout();this._layoutSig=sig;
  }

  scheduleRelayout() {
    if(this._relayoutTimer)return;
    this._relayoutTimer=setTimeout(()=>{this._relayoutTimer=null;this.relayout();},80);
  }

  relayout() {if(this.el.hidden||!this.panel.actor)return;for(const group of GROUPS){const grid=this.el.querySelector('[data-hud-zone="'+group+'"] .bg3-grid');if(grid){this.fillEmptySlots(grid);this.measureLayout(group);this.syncScrollHint(grid);}}this.renderNav();this.positionChrome();this.positionChoice();}

  measureLayout(group) {
    const grid=this.el.querySelector(`[data-hud-zone="${group}"] .bg3-grid`);
    if(!grid){this.layout[group]=null;return null;}
    const itemCount=grid.querySelectorAll('.bg3-skill').length;
    const cs=getComputedStyle(grid);
    const rowHeight=parseFloat(cs.gridAutoRows)||parseFloat(cs.getPropertyValue('--bg3-row-h'))||57;
    const rowGap=parseFloat(cs.rowGap)||5;
    const columns=columnCount(cs.gridTemplateColumns);
    const maxScroll=Math.max(0,grid.scrollHeight-grid.clientHeight);
    const first=overflowState({itemCount,columns,rows:this.rows,scrollTop:0,rowHeight,rowGap});
    const page=clampRow(this.pages[group]??0,first.totalRows,this.rows);
    const top=scrollForRow(page,rowHeight,rowGap,maxScroll);
    if(Math.abs((grid.scrollTop||0)-top)>1)grid.scrollTop=top;
    const state=overflowState({itemCount,columns,rows:this.rows,scrollTop:grid.scrollTop,rowHeight,rowGap});
    this.pages[group]=state.row;
    this.layout[group]={...state,itemCount,columns,rowHeight,rowGap,maxScroll,grid};
    return this.layout[group];
  }

  onGridScroll(grid) {
    this.hideTip(0);this.syncScrollHint(grid);this.positionChoice();this.scheduleHoverTip();
    const group=grid.dataset.hudGroup;
    const itemCount=grid.querySelectorAll('.bg3-skill').length;
    const cs=getComputedStyle(grid);
    const state=overflowState({itemCount,columns:columnCount(cs.gridTemplateColumns),rows:this.rows,scrollTop:grid.scrollTop,rowHeight:parseFloat(cs.gridAutoRows)||57,rowGap:parseFloat(cs.rowGap)||5});
    this.pages[group]=state.row;
    this.layout[group]={...(this.layout[group]??{}),...state,itemCount,grid};
    if(this._scrollFrame)return;
    this._scrollFrame=requestAnimationFrame(()=>{this._scrollFrame=null;this.syncPager(group);});
  }

  scrollGrid(group,direction) {
    const view=this.layout[group], grid=view?.grid??this.el.querySelector(`[data-hud-zone="${group}"] .bg3-grid`);
    if(!view||!grid)return;
    const row=clampRow((view.row??0)+direction,view.totalRows,this.rows);
    const top=scrollForRow(row,view.rowHeight,view.rowGap,view.maxScroll);
    this.pages[group]=row;
    try{grid.scrollTo({top,behavior:'smooth'});}catch{grid.scrollTop=top;}
    const st=overflowState({itemCount:view.itemCount,columns:view.columns,rows:this.rows,scrollTop:top,rowHeight:view.rowHeight,rowGap:view.rowGap});
    this.layout[group]={...view,...st,row};
    this.syncPager(group);
  }

  syncPager(group) {
    const view=this.layout[group];
    const el=this.el.querySelector(`[data-hud-pager="${group}"]`);
    if(!view){return;}
    if(!el){this.renderNav();return;}
    const prev=el.querySelector('.bg3-pager-prev'), next=el.querySelector('.bg3-pager-next');
    const label=el.querySelector('.bg3-pager-label'), more=el.querySelector('.bg3-pager-more');
    if(prev)prev.disabled=view.row<=0;
    if(next)next.disabled=view.row>=view.maxScrollRow;
    if(label)label.textContent=`${view.row+1}/${view.maxScrollRow+1}`;
    if(view.remaining>0){
      if(more)more.textContent=`还有 ${view.remaining} 项`;
      else{const small=document.createElement('small');small.className='bg3-pager-more';small.textContent=`还有 ${view.remaining} 项`;el.appendChild(small);}
    }else if(more){more.remove();}
    el.dataset.state=view.row<=0?'top':'more';
  }

  renderNav() {
    const host=this.el.querySelector('[data-hud-nav]');
    if(!host)return;
    const pagers=GROUPS.map(group=>({group,label:GROUP_LABEL[group],...(this.layout[group]??{})}))
      .filter(pager=>pager.hasOverflow&&pager.itemCount>0);
    patchHTML(host,navHTML({pagers}));
    host.hidden=pagers.length===0;
  }

  hasFilter() { return this.filterActivation!==null||this.filterLevel!==null; }

  resetPages() { this.pages={equipment:0,features:0,spells:0}; }

  storeActor() { return this.panel._storeActor?.() ?? this.panel.actor; }

  preferences() {
    const actor=this.storeActor(),saved=actor?.getFlag(ID,'hudLayout')??{};
    const data={...saved};
    for(const [key,pending] of this.pendingPrefs??[])if(key.startsWith(actor?.uuid+'|'))data[key.split('|')[1]]=pending.value;
    const raw=data.ratios;
    data.ratios=Array.isArray(raw)&&raw.length===3&&raw.every(v=>Number.isFinite(v)&&v>0)?raw:[...DEFAULT_RATIOS];
    return data;
  }

  savePreference(actor,key,value) {
    if(!actor?.isOwner)return Promise.reject(Error('没有修改此角色界面的权限'));
    const id=actor.uuid+'|'+key,entry={value};this.pendingPrefs.set(id,entry);
    const job=this.saveQueue.catch(()=>{}).then(()=>actor.update({[`flags.${ID}.hudLayout.${key}`]:value}));
    this.saveQueue=job;
    job.then(()=>{if(this.pendingPrefs.get(id)===entry)this.pendingPrefs.delete(id);if(this.storeActor()?.uuid===actor.uuid)this.render();},err=>{if(this.pendingPrefs.get(id)===entry)this.pendingPrefs.delete(id);this.error(err);if(this.storeActor()?.uuid===actor.uuid)this.render();});
    return job;
  }

  groupOf(item) { return item.type==='spell'?'spells':item.type==='feat'?'features':['weapon','equipment','consumable','tool'].includes(item.type)?'equipment':null; }

  weaponState() {
    const actor=this.panel.actor,store=this.storeActor()??actor;
    return weaponSlots(actor,store?.getFlag?.(ID,'weaponSlots'));
  }

  async saveWeaponSlots(ids) {
    const store=this.storeActor(); if(!store?.isOwner)throw Error('没有修改武器槽的权限');
    await store.update({[`flags.${ID}.weaponSlots`]:ids});
  }


  closeScale() {
    this.scalePopover?.remove();this.scalePopover=null;this.scaleDrag=false;
    this.el.querySelector('[data-hud-scale]')?.setAttribute('aria-expanded','false');
    document.removeEventListener('pointerdown',this._closeScaleOutside,true);
    document.removeEventListener('keydown',this._closeScaleKey,true);
  }

  toggleScale() {
    if(this.scalePopover){this.closeScale();return;}
    const pop=document.createElement('div');pop.className='bg3-scale-popover';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','整体缩放');
    pop.innerHTML='<label for="bg3-scale-slider">整体缩放 <output data-scale-output></output></label><input id="bg3-scale-slider" type="range" min="65" max="150" step="any" aria-label="HUD 缩放比例"><div class="bg3-scale-footer"><small data-scale-range></small><button type="button" data-scale-reset>恢复 100%</button></div>';
    this.scalePopover=pop;document.body.appendChild(pop);
    const slider=pop.querySelector('input');
    const commit=()=>{void saveDisplay('scale',this.preferredScale).catch(err=>{this.preferredScale=readDisplay().scale;this.position();this.error(err);});};
    slider.addEventListener('input',()=>{this.preferredScale=normalizeScale(Number(slider.value)/100);this.hideTip(0);this.position();this.relayout();});
    slider.addEventListener('pointerdown',()=>{this.scaleDrag=true;});
    slider.addEventListener('pointerup',()=>{this.scaleDrag=false;this.positionScale();});
    slider.addEventListener('pointercancel',()=>{this.scaleDrag=false;this.positionScale();});
    slider.addEventListener('change',commit);
    slider.addEventListener('keydown',ev=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(ev.key)){ev.preventDefault();this.preferredScale=normalizeScale(this.scale+(['ArrowLeft','ArrowDown'].includes(ev.key)?-.01:.01));this.position();this.relayout();commit();}});
    pop.querySelector('[data-scale-reset]').addEventListener('click',()=>{this.preferredScale=1;this.position();this.relayout();commit();});
    this._closeScaleOutside=ev=>{if(!pop.contains(ev.target)&&!ev.target.closest('[data-hud-scale]'))this.closeScale();};
    this._closeScaleKey=ev=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();this.closeScale();}};
    document.addEventListener('pointerdown',this._closeScaleOutside,true);document.addEventListener('keydown',this._closeScaleKey,true);
    this.el.querySelector('[data-hud-scale]')?.setAttribute('aria-expanded','true');this.positionScale();slider.focus({preventScroll:true});
  }

  positionScale() {
    const pop=this.scalePopover;if(!pop)return;
    const button=this.el.querySelector('[data-hud-scale]');if(this.el.hidden||!button){this.closeScale();return;}
    const slider=pop.querySelector('input');slider.max=String(this.scaleLimit*100);slider.value=String(this.scale*100);
    pop.querySelector('output').value=Math.round(this.scale*100)+'%';
    pop.querySelector('[data-scale-range]').textContent='65% – '+Math.round(this.scaleLimit*100)+'%';
    // Keep the thumb's track stationary while dragging; the HUD itself moves as it scales.
    if(this.scaleDrag)return;
    const r=button.getBoundingClientRect();
    pop.style.left=Math.max(8,Math.min(innerWidth-pop.offsetWidth-8,r.right-pop.offsetWidth))+'px';
    pop.style.top=Math.max(8,r.top-pop.offsetHeight-10)+'px';
  }

  openSettings() { openHUDSettings(this); }

  otherAttackRows() {
    const rows=[];
    for(const weapon of this.weaponState().items){
      if(!weapon)continue;
      const acts=this.panel._activityList(weapon), primary=normalAttackActivity(acts);
      for(const activity of otherAttackActivities(acts,primary))rows.push({item:weapon,activity});
    }
    return rows;
  }

  activateWeapon(index) {
    if(this.busy)return;
    const weapon=this.weaponState().items[index];
    if(!weapon)return;
    const activity=normalAttackActivity(this.panel._activityList(weapon));
    if(!activity){this.status('这把武器没有可用的攻击活动');return;}
    this.cancel(false);
    this.selection={actorUuid:this.panel.actor.uuid,itemId:weapon.id,activityId:activity.id,option:null};
    this.chooseActivity(activity);
  }

  openAttack(itemId,activityId) {
    if(this.busy)return;
    const item=this.panel.actor.items.get(itemId),activity=this.panel._activityList(item).find(a=>a.id===activityId);
    if(!item||!activity){this.status('这个攻击方式已不存在');return;}
    this.cancel(false);
    this.selection={actorUuid:this.panel.actor.uuid,itemId:item.id,activityId:activity.id,option:null};
    this.chooseActivity(activity);
  }

  async assignWeapon(index,itemId) {
    const view=this.weaponState();const ids=[...view.ids];
    if(ids[index]===itemId)return;
    const other=ids.indexOf(itemId);
    if(other>=0)ids[other]=ids[index]??null;
    ids[index]=itemId;
    try{await this.saveWeaponSlots(ids);}catch(err){this.error(err);}
  }

  removeWeaponSlot(index) {
    const weapon=this.weaponState().items[index];if(!weapon)return;
    if(!this.storeActor()?.isOwner)return;
    const dialog=document.createElement('dialog');dialog.className='bg3-free-dialog';
    dialog.innerHTML=`<form><h2>移除武器槽</h2><p>是否把「${esc(weapon.name)}」从武器槽移除？武器本身仍保留在角色物品中。</p><footer><button type="button" data-no>取消</button><button type="submit">移除</button></footer></form>`;
    document.body.appendChild(dialog);dialog.addEventListener('close',()=>dialog.remove());
    dialog.querySelector('[data-no]').addEventListener('click',()=>dialog.close());
    dialog.querySelector('form').addEventListener('submit',async ev=>{
      ev.preventDefault();const ids=[...this.weaponState().ids];ids[index]=null;dialog.close();
      try{await this.saveWeaponSlots(ids);}catch(err){this.error(err);}
    });
    dialog.showModal();
  }

  toggleActivation(kind) {
    if(this.busy)return;
    this.filterActivation=this.filterActivation===kind?null:kind;
    if(this.filterActivation)this.filterLevel=null;
    this.resetPages();
    this.render();
  }

  slotData() {
    const actor=this.panel.actor;
    const spells=this.items('spells',false);
    const slots=[{kind:'cantrip',level:0,label:'戏法',count:spells.filter(i=>Number(i.system.level)===0).length,max:0,value:0}];
    const pact=actor.system.spells?.pact;
    if(Number(pact?.max)>0)slots.push({kind:'pact',level:Number(pact.level)||0,label:`契约 ${roman(Number(pact.level)||0)}`,max:Number(pact.max)||0,value:Number(pact.value)||0});
    const levels=new Set(spells.map(i=>Number(i.system.level)).filter(n=>n>0));
    for(const [key,pool] of Object.entries(actor.system.spells??{}))if(/^spell\d$/.test(key)&&Number(pool.max)>0)levels.add(Number(key.slice(5)));
    for(const level of [...levels].sort((a,b)=>a-b)){
      const pool=actor.system.spells?.['spell'+level];
      if(!(Number(pool?.max)>0))continue;
      slots.push({kind:'normal',level,label:roman(level),max:Number(pool.max),value:Number(pool.value)||0,count:spells.filter(i=>Number(i.system.level)===level).length});
    }
    return slots;
  }

  catalog(group) {
    return list(this.panel.actor?.items).filter(i=>!i.flags?.[ID]?.freeCast&&!i.flags?.[ID]?.freeReaction&&this.groupOf(i)===group)
      .sort((a,b)=>Number(a.system?.level||0)-Number(b.system?.level||0)||String(a.name).localeCompare(String(b.name),'zh'));
  }

  curationFor(group) {
    if(this.curation[group])return this.curation[group];
    const all=this.catalog(group);
    let result={};
    try{
      result=curateGroup(all,{group,actor:this.panel.actor,activitiesOf:item=>this.panel._activityList(item)});
    }catch(err){console.warn(`[${ID}] 默认分类失败，回退全部内容`,err);}
    const decisions=list(result.decisions??[]);
    const map=new Map();
    for(const decision of decisions){const id=decision?.itemId??decision?.id;if(id)map.set(id,decision);}
    const items=Array.isArray(result.items)?result.items:all.filter(item=>{
      const decision=map.get(item.id);
      return !decision||decision.include!==false;
    });
    this.curation[group]={items,decisions,map,stats:result.stats??null};
    return this.curation[group];
  }

  curatedFor(group) { return this.curationFor(group).items; }

  items(group,filtered=true) {
    const all=this.catalog(group),ids=this.preferences()[group],byId=new Map(all.map(i=>[i.id,i]));
    let items;
    if(Array.isArray(ids)) items=[...new Set(ids)].map(id=>byId.get(id)).filter(Boolean);
    else items=this.curatedFor(group);
    if(filtered&&this.filterActivation){const kind=this.filterActivation;items=items.filter(i=>this.panel._activityList(i).some(a=>{const t=String(a.activation?.type??'');return kind==='reaction'?t.startsWith('reaction'):t===kind;}));}
    if(filtered&&group==='spells'&&this.filterLevel!==null)items=items.filter(i=>Number(i.system.level)===this.filterLevel);
    return items;
  }

  render() {
    if(!this.enabled||this.resizing||this.vResize||this.widthResize)return;
    const previousChoice=this.el.querySelector('.bg3-choice-popover');const choiceScroll=previousChoice&&this.choiceScroll(previousChoice);
    const focusedDivider=document.activeElement?.dataset?.hudDivider;
    const a=this.panel.actor;if(!a){this.audio.stop();this.el.hidden=true;this.position();return;}
    this.el.hidden=false;this.el.setAttribute('aria-busy',String(this.busy));
    this.applyRows();
    if(!this._tipBtn?.isConnected||this._tipLocked)this.hideTip(0);
    const hp=a.system.attributes?.hp??{},ac=a.system.attributes?.ac?.value??'—';
    const current=Number(hp.value)||0,max=Number(hp.max)||0,temp=Math.max(0,Number(hp.temp)||0),total=max+temp;
    const percent=total>0?Math.max(0,Math.min(100,current/total*100)):0,tempPercent=total>0?Math.min(100-percent,temp/total*100):0;
    const resource=this.panel._resources(a),combat=game.combat?.started;
    const chosen=a.items.get(this.selection?.itemId);this.region=this.groupOf(chosen??{})??'equipment';
    const token=this.panel.token?.document,src=token?.texture?.src||a.prototypeToken?.texture?.src||'icons/svg/mystery-man.svg';
    const name=token?.name||a.name;
    const portrait=/\.(webm|mp4|m4v)(?:[?#]|$)/i.test(src)?`<video class="bg3-token-image" src="${esc(src)}" ${readPerformance().animate?'autoplay loop':''} preload="metadata" muted playsinline aria-label="${esc(name)}"></video>`:`<img class="bg3-token-image" src="${esc(src)}" alt="${esc(name)}">`;
    const weaponView=this.weaponState();
    const classView=classInfo(a);
    const topbar=topbarHTML({resource,concentration:this.panel._isConcentrating(a),filterActivation:this.filterActivation,filterLevel:this.filterLevel,busy:this.busy,slots:this.slotData()});
    const slotMarkup=weaponView.items.map((weapon,index)=>{const wp=weapon?nameParts(weapon.name):null;return `<div class="bg3-weapon-cell"><button type="button" class="bg3-weapon-slot ${weapon?'':'empty'}" data-hud-weapon="${index}" title="${weapon?`${esc(weapon.name)} · 点击普通攻击，右键移除`:'空武器槽 · 把武器拖到这里'}" aria-label="${weapon?esc(weapon.name):`空武器槽 ${index+1}`}" ${this.busy?'disabled':''}>${weapon?`<img src="${esc(weapon.img||fallback)}" alt="">`:'<span>＋</span>'}</button><span class="bg3-weapon-name" title="${weapon?esc(weapon.name):''}">${weapon?esc(wp?.short??weapon.name):'空'}</span></div>`;}).join('');
    const classMarkup=classView?`<button type="button" class="bg3-class-badge" data-hud-class title="${esc(classView.name)} ${classView.level} 级 · BG3 职业预设" aria-label="职业：${esc(classView.name)}"><img src="${esc(classView.img)}" alt=""></button>`:'';
    patchHTML(this.el,`<div class="bg3-portrait"><button type="button" class="bg3-portrait-ring" data-hud-sheet title="打开角色卡" aria-label="打开 ${esc(name)} 的角色卡">${portrait}</button><div class="bg3-vitals"><span class="bg3-ac" title="护甲等级">AC <b>${esc(ac)}</b></span><span class="bg3-hp" title="生命值 ${current}/${max}${temp?'，临时生命 '+temp:''}"><i style="width:${percent}%"></i>${temp?`<i class="temp" style="left:${percent}%;width:${tempPercent}%"></i>`:''}<b>${current}/${max}${temp?` <em>+${temp}</em>`:''}</b></span></div><span class="bg3-character" title="${esc(name)}">${esc(name)}</span>${classMarkup}</div>
      <div class="bg3-weapons" aria-label="武器槽">${slotMarkup}</div>
      <div class="bg3-center">${topbar}
      <div class="bg3-nav" data-hud-nav role="toolbar" aria-label="筛选与滚动"></div>
      <div class="bg3-zones">
      ${GROUPS.map(k=>`<section class="bg3-zone zone-${k}" aria-label="${GROUP_LABEL[k]}"><div class="bg3-deck" data-hud-zone="${k}"></div></section>`).join('')}
      <div class="bg3-height-grip" data-hud-height role="separator" aria-orientation="horizontal" tabindex="0" aria-label="HUD 高度" aria-valuenow="${this.rows}" aria-valuemin="1" aria-valuemax="${MAX_ROWS}" title="上下拖动调整 HUD 行数；↑/↓ 微调；双击恢复自动"></div>${[0,1].map(n=>`<div class="bg3-divider" data-hud-divider="${n}" role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整${n===0?'装备与特性':'特性与法术'}宽度" title="拖动调整宽度；方向键微调，双击恢复默认比例"><i aria-hidden="true"></i></div>`).join('')}
      ${[-1,1].map(side=>`<div class="bg3-width-grip" data-hud-width="${side}" role="separator" aria-orientation="vertical" tabindex="0" aria-label="${side<0?'左侧':'右侧'}调整 HUD 总宽度" title="拖动调整 HUD 总宽度；方向键微调"></div>`).join('')}</div>
      <div class="bg3-other-attacks" data-hud-attacks hidden></div></div>
      <aside class="bg3-end"><button type="button" class="bg3-scale-button" data-hud-scale title="整体缩放" aria-label="整体缩放" aria-expanded="${!!this.scalePopover}"><span aria-hidden="true">↔</span> <output data-hud-scale-label>${Math.round(this.scale*100)}%</output></button><button type="button" class="bg3-turn-circle" ${combat?'data-hud-end':'data-hud-rest="short"'} aria-label="${combat?'结束回合':'短休'}" ${this.busy?'disabled':''}><b>${combat?'⌛':'☾'}</b><span>${combat?'结束回合':'短休'}</span></button>${!combat?'<button type="button" class="bg3-long-rest" data-hud-rest="long" title="长休">☾<small>长休</small></button>':''}<button type="button" class="bg3-settings" data-hud-settings title="编辑栏位与顺序" aria-label="编辑栏位与顺序" ${this.busy?'disabled':''}>⚙</button></aside><div class="bg3-height-tip" data-hud-height-tip hidden aria-hidden="true"></div><div class="bg3-choice-popover" id="dsh-bg3-choice" role="group" aria-label="选择活动与施法来源" hidden></div>`,{shell:true});
    this.setZoneRatios(this.preferences().ratios);this.renderGrid();this.renderOtherAttacks();this.renderNav();if(this.page!=='list')this.renderChoice(choiceScroll);else this.closeChoice();
    if(this._tipBtn&&!this.el.contains(this._tipBtn))this.hideTip(0);
    this.position();this.scheduleHoverTip();
    for(const video of this.el.querySelectorAll('video')){if(!readPerformance().animate)video.pause();else if(video.paused)void video.play().catch(()=>{});}
    if(focusedDivider!==undefined)this.el.querySelector(`[data-hud-divider="${focusedDivider}"]`)?.focus({preventScroll:true});
  }

  renderGrid() {
    for(const group of GROUPS){
      const deck=this.el.querySelector(`[data-hud-zone="${group}"]`);if(!deck)continue;
      const items=this.items(group),filtered=this.hasFilter();
      patchHTML(deck,`<div class="bg3-grid" role="list" data-hud-group="${group}">${items.map(i=>{
        const acts=this.panel._activityList(i),first=acts[0];
        const type=actions[first?.activation?.type]||first?.activation?.type||'查看详情';
        const badge=i.type==='spell'?roman(Number(i.system.level)||0):i.type==='weapon'?'⚔':'✦';
        const draggable=group==='equipment'&&i.type==='weapon';
        const parts=nameParts(i.name),uses=this.resourceBadges(i);
        const title=[i.name,type,uses?.title,draggable?'可拖到武器槽':''].filter(Boolean).join(' · ');
        return `<button type="button" class="bg3-skill ${this.panel._isDepleted(i)&&!this.hasFreeUses(i)?'depleted':''}" data-hud-item="${esc(i.id)}" ${draggable?`draggable="true" data-hud-drag="${esc(i.id)}"`:''} ${this.busy?'disabled':''} aria-label="${esc(i.name)}" title="${esc(title)}"><img src="${esc(i.img||fallback)}" alt=""><span class="bg3-skill-level">${badge}</span>${resourceChipHTML(i,uses)}<span class="bg3-skill-name">${esc(parts.short)}</span></button>`;
      }).join('')}</div>${!items.length?emptyHTML({filtered}):''}`);
      this.fillEmptySlots(deck.firstElementChild);this.measureLayout(group);this.syncScrollHint(deck.firstElementChild);
    }
  }

  hasFreeUses(item) {
    return list(this.panel.actor?.items).some(r=>matchesFreeSource(r,item)&&!r.flags[ID].freeCast.disabled&&usesLeft(r).value>0);
  }

  resourceBadges(item) {
    const acts=this.panel._activityList(item);
    const meta=resourceMeta(this.panel.actor,item,acts);
    const transfer=acts.find(act=>isTransferActivity(item,act)&&Number(act?.uses?.max)>0);
    const details=[];
    let primary='',extra=null;
    if(meta){primary=`${meta.value}/${meta.max}`;details.push(`${meta.label} ${meta.value}/${meta.max}`);}
    if(transfer){const uses=featureUsesLeft(transfer.uses);extra=`转${uses.value}/${uses.max}`;details.push(`转移 ${uses.value}/${uses.max}`);}
    if(!meta&&!transfer){
      const free=itemFreeUseOption(item,Number(item.system?.level)||0);
      if(free){primary=`${free.value}/${free.max}`;details.push(`${free.label} ${free.value}/${free.max}`);}
    }
    const sources=list(this.panel.actor?.items).filter(r=>matchesFreeSource(r,item)&&!r.flags[ID].freeCast.disabled);
    if(sources.length){
      const total=sources.reduce((sum,r)=>{const uses=usesLeft(r);details.push(`${r.flags[ID].freeCast.source||r.name} ${uses.value}/${uses.max}`);return {value:sum.value+uses.value,max:sum.max+uses.max};},{value:0,max:0});
      const text=`免${total.value}/${total.max}`;
      if(!primary)primary=text;else if(!extra)extra=text;
    }
    return primary||extra?{primary,extra,title:details.join(' · ')}:null;
  }

  curationDecision(item,group) {
    return this.curationFor(group).map.get(item.id)??null;
  }

  renderOtherAttacks() {
    const box=this.el.querySelector('[data-hud-attacks]');if(!box)return;
    const rows=this.otherAttackRows();
    box.hidden=rows.length===0;
    if(box.hidden){box.replaceChildren();return;}
    patchHTML(box,`<span class="bg3-other-title">其他攻击</span><div class="bg3-other-list" tabindex="0" role="group" aria-label="其他攻击，可纵向滚动">${rows.map(({item,activity})=>`<button type="button" class="bg3-other-attack" data-hud-other-attack="${esc(item.id)}|${esc(activity.id)}" ${this.busy?'disabled':''} title="${esc(item.name)} · ${esc(activity.name)}"><img src="${esc(item.img||fallback)}" alt=""><span>${esc(shortName(activity.name))}</span></button>`).join('')}</div>`);
  }

  rowMetrics() {
    const cs=getComputedStyle(this.el);
    const rowHeight=parseFloat(cs.getPropertyValue('--bg3-row-h'))||57;
    const rowGap=parseFloat(cs.getPropertyValue('--bg3-row-gap'))||5;
    return {rowHeight,rowGap,stride:rowHeight+rowGap};
  }

  /* 0.11.0: saved rows (per actor flag hudLayout.rows) win over the viewport default. */
  applyRows() {
    const {rowHeight,rowGap}=this.rowMetrics();
    this.rows=normalizeRows(this.preferences().rows??hudRows(globalThis.innerHeight||900),this.rowViewportHeight(),rowHeight,rowGap);
    this.el.style.setProperty('--bg3-rows',String(this.rows));
    this.el.querySelector('[data-hud-height]')?.setAttribute('aria-valuenow',String(this.rows));
    return this.rows;
  }

  showHeightTip(text,ev) {
    const tip=this.el.querySelector('[data-hud-height-tip]');if(!tip)return;
    const r=this.el.getBoundingClientRect();
    const x=ev?ev.clientX:r.left+r.width/2,y=ev?ev.clientY:r.top;
    tip.textContent=text;tip.hidden=false;
    tip.style.left=`${Math.round((x-r.left)/this.scale)}px`;tip.style.top=`${Math.round((Math.max(26,y-26)-r.top)/this.scale)}px`;
  }

  hideHeightTip() { const tip=this.el.querySelector('[data-hud-height-tip]');if(tip)tip.hidden=true; }

  beginVResize(ev) {
    if(this.busy||ev.button!==0)return;
    ev.preventDefault();ev.stopPropagation();this.cancel();
    const {rowHeight,rowGap,stride}=this.rowMetrics();
    this.vResize={pointer:ev.pointerId,y:ev.clientY,startRows:this.rows,rowHeight,rowGap,stride,actor:this.storeActor()};
    this.el.setPointerCapture(ev.pointerId);this.el.classList.add('resizing-v');
    this.showHeightTip(`${this.rows} 行`,ev);
  }

  moveVResize(ev) {
    const drag=this.vResize;if(!drag)return;
    const limit=maxRowsFor(this.rowViewportHeight(),drag.rowHeight,drag.rowGap);
    const next=Math.min(limit,Math.max(1,drag.startRows+Math.round((drag.y-ev.clientY)/(drag.stride*this.scale))));
    if(next!==this.rows){
      this.rows=next;
      this.el.style.setProperty('--bg3-rows',String(next));
      this.el.querySelector('[data-hud-height]')?.setAttribute('aria-valuenow',String(next));
      this.scheduleRelayout();
    }
    this.showHeightTip(`${next} 行`,ev);
  }

  endVResize(ev,cancelled=false) {
    const drag=this.vResize;if(!drag||drag.pointer!==ev.pointerId)return;
    this.vResize=null;this.el.classList.remove('resizing-v');
    if(this.el.hasPointerCapture(ev.pointerId))this.el.releasePointerCapture(ev.pointerId);
    this.hideHeightTip();
    const changed=this.rows!==drag.startRows;
    if(!cancelled&&changed&&this.storeActor()?.uuid===drag.actor?.uuid)void this.savePreference(drag.actor,'rows',this.rows).catch(()=>{});
    else this.render();
  }

  nudgeRows(delta) {
    const {rowHeight,rowGap}=this.rowMetrics();
    const next=Math.min(maxRowsFor(this.rowViewportHeight(),rowHeight,rowGap),Math.max(1,this.rows+delta));
    if(next===this.rows)return Promise.resolve();
    this.rows=next;
    this.el.style.setProperty('--bg3-rows',String(next));
    this.el.querySelector('[data-hud-height]')?.setAttribute('aria-valuenow',String(next));
    this.scheduleRelayout();
    return this.savePreference(this.storeActor(),'rows',next);
  }

  positionChrome() {
    const zones = this.el.querySelector('.bg3-zones');
    if (!zones || this.el.hidden) return;
    const bounds = zones.getBoundingClientRect();
    const resource = this.el.querySelector('.bg3-topbar');
    this.el.style.setProperty('--bg3-resource-height', `${resource?.offsetHeight || 40}px`);
    const weapons = this.el.querySelector('.bg3-weapons');
    const slots = [...(weapons?.querySelectorAll('.bg3-weapon-slot') ?? [])];
    if (weapons && slots.length) {
      const rootBounds = this.el.getBoundingClientRect();
      const weaponBounds = weapons.getBoundingClientRect();
      const iconCenter = slots.reduce((sum,slot) => {const r=slot.getBoundingClientRect();return sum+(r.top+r.bottom)/2;},0)/slots.length;
      const localIconCenter = (iconCenter-weaponBounds.top)/this.scale;
      const desiredCenter = ((bounds.top+bounds.bottom)/2-rootBounds.top)/this.scale;
      weapons.style.setProperty('--bg3-weapons-offset-y', `${desiredCenter-weapons.offsetTop-localIconCenter}px`);
    }
    const rects = [...zones.querySelectorAll('.bg3-zone')].map(zone => zone.getBoundingClientRect());
    const attacks = this.el.querySelector('[data-hud-attacks]');
    if (attacks && !attacks.hidden) attacks.style.width = `${rects[0].width/this.scale}px`;
    const width = this.el.offsetWidth;
    const {min:widthMin,max:widthMax}=this.widthBounds();
    for (const grip of zones.querySelectorAll('[data-hud-width]')) {
      grip.setAttribute('aria-valuemin',String(widthMin));
      grip.setAttribute('aria-valuemax',String(widthMax));
      grip.setAttribute('aria-valuenow',String(clamp(width,widthMin,widthMax)));
      grip.setAttribute('aria-disabled',String(widthMin===widthMax));
    }
    for (const [index, handle] of [...zones.querySelectorAll('[data-hud-divider]')].entries()) {
      const left = rects[index], right = rects[index + 1];
      const leftWidth = left.width / this.scale;
      const pair = (left.width + right.width) / this.scale;
      const min = Math.min(this.zoneBase(), pair / 2);
      handle.style.left = `${((left.right + right.left) / 2 - bounds.left)/this.scale-zones.clientLeft}px`;
      handle.setAttribute('aria-valuenow', String(Math.round(100 * leftWidth / pair)));
      handle.setAttribute('aria-valuemin', String(Math.round(100 * min / pair)));
      handle.setAttribute('aria-valuemax', String(Math.round(100 * (pair - min) / pair)));
    }
  }

  beginResize(ev) {
    if(this.widthResize||this.vResize||this.resizing)return;
    const widthGrip=ev.target.closest('[data-hud-width]');
    if(widthGrip){this.beginWidthResize(ev,widthGrip);return;}
    if(ev.target.closest('[data-hud-height]')){this.beginVResize(ev);return;}
    const handle=ev.target.closest('[data-hud-divider]');if(!handle||this.busy||ev.button!==0)return;
    ev.preventDefault();ev.stopPropagation();this.cancel();
    const widths=this.zoneWidths();
    this.resizing={index:Number(handle.dataset.hudDivider),x:ev.clientX,widths,actor:this.storeActor(),pointer:ev.pointerId};
    this.el.setPointerCapture(ev.pointerId);this.el.classList.add('resizing');
  }

  resizeBy(widths,index,dx) {
    const pair = widths[index] + widths[index + 1];
    const min = this.zoneBase();
    const next = [...widths];
    if (pair <= 2 * min) return next;
    next[index] = Math.max(min, Math.min(pair - min, widths[index] + dx));
    next[index + 1] = pair - next[index];
    this.setZoneRatios(this.zoneWeights(next));
    this.positionChrome();
    this.scheduleRelayout();
    return next;
  }

  endResize(ev,cancelled=false) {
    const drag=this.resizing;if(!drag||drag.pointer!==ev.pointerId)return;
    const widths=drag.next??drag.widths, moved=!!drag.next&&drag.next.some((v,i)=>Math.abs(v-drag.widths[i])>1);
    this.resizing=null;this.el.classList.remove('resizing');
    if(this.el.hasPointerCapture(ev.pointerId))this.el.releasePointerCapture(ev.pointerId);
    if(!cancelled&&moved&&this.storeActor()?.uuid===drag.actor?.uuid)void this.savePreference(drag.actor,'ratios',this.zoneWeights(widths)).catch(()=>{});
    this.render();
  }

  manageItems(group) { this.cancel();openHUDSettings(this,group); }

  headButton(backLabel='返回') {
    if(this.busy&&this._activeSeq)return `<button type="button" class="bg3-abort" data-hud-abort ${this.aborting?'disabled':''} title="中止当前施法并立即恢复 HUD">${this.aborting?'正在取消…':'取消结算'}</button>`;
    return `<button type="button" data-hud-back ${this.busy?'disabled':''}>‹ ${backLabel}</button>`;
  }

  renderChoice(previousScroll) {
    const s = this.selection;
    const drawer = this.el.querySelector('.bg3-choice-popover');
    if (!s || !drawer) return;
    const item = this.panel.actor.items.get(s.itemId);
    if (!item) { this.cancel(); return; }

    const choosing = this.isChoosing();
    drawer.classList.add('bg3-choice-flat');
    drawer.classList.toggle('bg3-choice-targets', !!s.plan && !!s.option);
    drawer.classList.toggle('bg3-choice-spell', item.type === 'spell');
    if (!choosing && this.page==='list' && !this._activeSeq) { this.closeChoice(); return; }
    const phase = choosing ? this.page : this.busy ? 'busy' : 'targets';
    const key = JSON.stringify([s.actorUuid, s.itemId, s.activityId, phase]);
    const scroll = previousScroll ?? this.choiceScroll(drawer);
    drawer.classList.toggle('bg3-upcast-popover', !this.busy);const acts=this.panel._activityList(item),act=acts.find(a=>a.id===s.activityId);const options=!this.busy&&this.page!=='modes'&&act?spellOptions(this.panel.actor,item,act):[];
    const header = choosing
      ? `<div class="bg3-upcast-header"><span class="bg3-upcast-title">${phase === 'modes' || item.type !== 'spell' ? '使用方式' : '施放环阶'}</span><button type="button" class="bg3-upcast-close" data-hud-back aria-label="关闭">✕</button></div>`
      : `<div class="bg3-choice-title">${this.headButton('取消')}<b>${esc(item.name)}</b></div>`;
    let body;
    if (s.plan && s.option) {
      const count = s.targets.length;
      const max = s.plan.areaChoice ? '不限数量' : s.plan.max;
      const label = this.busy ? '正在结算' : s.plan.repeat ? '分配射线' : '选择目标';
      body = `<div class="bg3-target-choice"><div class="bg3-target-summary"><strong>${label} <b>${count} / ${max}</b></strong><small>${s.plan.areaChoice?'点选范围内目标 · 再点取消 · 确认后统一结算':s.plan.spell==='eldritchBlast'?'选定候选目标后施放，可分配光束':s.plan.repeat?'可重复选择同一目标':'每个目标只能选择一次'}</small></div><div class="bg3-target-buttons"><button type="button" data-hud-undo ${!count||this.busy?'disabled':''}>撤回</button>${!s.plan.repeat?`<button type="button" class="bg3-cast-now" data-hud-cast ${!count||this.busy?'disabled':''}>${s.plan.areaChoice?'确认施放':'施放'}</button>`:''}</div></div>`;
    } else if (this.busy) {
      body = '<p class="bg3-choice-status" role="status">正在结算…</p>';
    } else {
      const acts = this.panel._activityList(item);
      const act = acts.find(a => a.id === s.activityId);
      let cards;
      if (phase === 'modes') {
        cards = acts.map(a => {
          const caption = a.name || actions[a.activation?.type] || '使用';
          return `<button type="button" class="bg3-upcast-cell" data-hud-mode="${esc(a.id)}" title="${esc(caption)}" aria-label="${esc(caption)}"><img src="${esc(a.img || item.img || fallback)}" alt=""><span class="cell-caption">${esc(caption)}</span></button>`;
        }).join('');
      } else {
        cards = act ? spellOptions(this.panel.actor,item,act).map(option => this.upcastOption(option)).join('') : '';
        if (act && canManageFree(item,acts)) cards += '<button type="button" class="bg3-upcast-cell free" data-hud-manage title="管理免费来源" aria-label="管理免费来源"><span class="cell-level">＋</span></button>';
      }
      body = `<div class="bg3-upcast-slots" role="group" aria-label="${phase === 'modes' ? '活动变体' : '环位与免费来源'}">${cards || '<p class="bg3-choice-status">没有可用选项</p>'}</div>`;
    }
    if(!choosing&&s.plan&&s.option&&options.length){const cards=options.map(o=>this.upcastOption(o)).join('')+(canManageFree(item,acts)?'<button type="button" class="bg3-upcast-cell free" data-hud-manage title="管理免费来源" aria-label="管理免费来源"><span class="cell-level">＋</span></button>':'');body+='<div class="bg3-upcast-slots" role="group" aria-label="环位与免费来源">'+cards+'</div>';}
    patchHTML(drawer,header+`<div class="bg3-choice-body">${body}</div>`);
    drawer.hidden = false;
    drawer.dataset.hudChoiceKey = key;
    drawer.scrollTop = scroll.key === key ? scroll.top : 0;
    const strip = drawer.querySelector('.bg3-upcast-slots');
    if (strip && scroll.key === key) strip.scrollLeft = scroll.left;
    if (choosing) {
      const anchor = this.choiceAnchor();
      anchor?.setAttribute('aria-controls', drawer.id);
      anchor?.setAttribute('aria-expanded', 'true');
    }
    this.positionChoice();
  }

  async click(ev) {
    const b=ev.target.closest('button');if(!b||b.disabled)return;
    const soundInput=++this._soundInput;this.audio.stop();
    try {
    if(b.hasAttribute('data-hud-sheet')){const sheet=this.panel.actor?.sheet;if(sheet){await sheet.render(true);sheet.bringToFront?.();}return;}
    if(b.hasAttribute('data-hud-scale')){this.toggleScale();return;}
    if(b.hasAttribute('data-hud-abort')){await this.abortActive();return;}
    if(b.hasAttribute('data-hud-filter-act')){this.toggleActivation(b.dataset.hudFilterAct);return;}
    if(b.dataset.hudPage){const [group,direction]=b.dataset.hudPage.split('|');this.scrollGrid(group,Number(direction)||1);return;}
    if(b.hasAttribute('data-hud-clear-filter')){this.filterActivation=null;this.filterLevel=null;this.resetPages();this.render();return;}
    if(b.hasAttribute('data-hud-weapon')){this.activateWeapon(Number(b.dataset.hudWeapon));return;}
    if(b.dataset.hudOtherAttack){const [itemId,activityId]=b.dataset.hudOtherAttack.split('|');this.openAttack(itemId,activityId);return;}
    if(b.hasAttribute('data-hud-class')){const view=classInfo(this.panel.actor);if(view)this.panel.actor.items.get(view.id)?.sheet?.render(true);return;}
    if(b.hasAttribute('data-hud-settings')){this.openSettings();return;}
    if(this.busy)return;
    if(b.dataset.hudEdit){this.manageItems(b.dataset.hudEdit);return;}
    if(b.hasAttribute('data-hud-filter')&&this.selection?.option){
      const item=this.panel.actor.items.get(this.selection.itemId),act=this.panel._activityList(item).find(a=>a.id===this.selection.activityId);
      if(item?.type==='spell'){const level=Number(b.dataset.hudFilter);const option=spellOptions(this.panel.actor,item,act).find(o=>o.kind==='slot'&&o.level===level&&o.value>0);
        if(option){this.selection.option=option;this.arm();}else this.status('该环位不可用于当前法术');return;}
    }
    if(b.hasAttribute('data-hud-filter')){const n=Number(b.dataset.hudFilter);this.cancel(false);this.filterActivation=null;this.filterLevel=this.filterLevel===n?null:n;this.resetPages();this.render();return;}
    if(b.hasAttribute('data-hud-cast')){await this.commitSelection();return;}
    if(b.hasAttribute('data-hud-undo')){this.selection?.targets?.pop();this.renderChoice();this.syncTargets();return;}
    if(b.hasAttribute('data-hud-back')){this.cancel();return;}
    if(b.hasAttribute('data-hud-end')){await this.panel._endTurn();this.render();return;}
    if(b.dataset.hudRest){await this.panel._rest(b.dataset.hudRest);return;}
    if(b.dataset.hudDeleteFree){await this.deleteFreeSource(b.dataset.hudDeleteFree);return;}
    if(b.hasAttribute('data-hud-manage')){this.manageFree();return;}
    if(b.dataset.hudItem){
      if(this.selection?.itemId===b.dataset.hudItem){this.cancel();return;}
      this.cancel(false);const item=this.panel.actor.items.get(b.dataset.hudItem);const acts=this.panel._activityList(item);
      if(!acts.length){item.sheet?.render(true);this.render();return;}this.selection={actorUuid:this.panel.actor.uuid,itemId:item.id,activityId:acts.length===1?acts[0].id:null,option:null};
      if(acts.length>1){this.page='modes';this.audio.prepare(item);this.render();return;}
      this.chooseActivity(acts[0]);return;
    }
    if(b.dataset.hudMode){const item=this.panel.actor.items.get(this.selection.itemId);this.chooseActivity(this.panel._activityList(item).find(a=>a.id===b.dataset.hudMode),true);return;}
    if(b.dataset.hudOption){
      const item=this.panel.actor.items.get(this.selection.itemId),act=this.panel._activityList(item).find(a=>a.id===this.selection.activityId);
      const option=spellOptions(this.panel.actor,item,act).find(o=>o.key===b.dataset.hudOption);if(!option||option.value<1)return;
      this.selection.option=option;this.arm(true);
    }
    } finally {
      if(soundInput===this._soundInput&&!b.hasAttribute('data-hud-back')&&!b.hasAttribute('data-hud-abort')&&!this.audio.current){this.audio.button(b);}
    }
  }

  chooseActivity(act,commitSelf=false) {
    if(!act)return;this.selection.activityId=act.id;this.page='slots';
    const teleport=teleportWorkflow(act);
    commitSelf=commitSelf||!!teleport?.direct;
    if(act.item.type==='feat'&&!teleport?.direct){this.render();return;}
    if(act.item.type==='spell'&&act.consumption?.spellSlot===false){this.selection.option={key:'native',kind:'native',level:Number(act.item.system.level)||0};this.arm(commitSelf);return;}
    if(act.item.type==='spell'&&(Number(act.item.system.level)>0||spellOptions(this.panel.actor,act.item,act).some(o=>o.kind==='free'))){
      const level=Number(act.item.system.level)||0;
      const options=spellOptions(this.panel.actor,act.item,act);
      const native=options.find(o=>o.kind==='native');
      if(native?.value>0){this.selection.option=native;this.arm(commitSelf);return;}
      const base=options.find(o=>o.kind==='slot'&&o.key===`spell${level}`&&o.value>0)??options.find(o=>o.kind==='slot'&&o.level===level&&o.value>0);
      if(base){this.selection.option=base;this.arm(commitSelf);return;}
      this.audio.prepare(act.item,act);this.render();return;
    }
    this.selection.option={key:'native',kind:'native',level:Number(act.item.system.level)||0};this.arm(commitSelf);
  }

  arm(commitSelf=false) {
    this.clearVisuals();const s=this.selection;if(!s)return;
    const item=this.panel.actor.items.get(s.itemId);const act=this.panel._activityList(item).find(a=>a.id===s.activityId);
    this.audio.prepare(item,act);
    const delta=Math.max(0,(s.option?.level||0)-(Number(item.system.level)||0));
    const teleport=teleportWorkflow(act);
    s.plan=teleport?.direct?null:areaChoicePlan(item,act)??targetPlan(item,act,s.option.level);s.targets=[];
    commitSelf=commitSelf||!!teleport?.direct;
    if(commitSelf&&!s.plan&&this.panel._dragKind(act)==='self'){this.closeChoice();this._tipLocked=true;this.hideTip(0);void this.commitSelection().catch(err=>this.error(err));return;}
    let preview=eldritchBlastBeam(item,act)??(s.plan?.repeat?(s.plan.spell==='magicMissile'?missileBolt(item,act):rayActivity(item,act)):act);
    if(delta){const clone=item.clone({'flags.dnd5e.scaling':delta},{keepId:true});preview=clone.system.activities.get(preview.id);}
    this.panel._drag={item,activity:preview,started:true,kind:s.plan?'target':this.panel._dragKind(act),clientX:0,clientY:0,hudHidden:true,el:document.createElement('div')};
    const ring=this.panel._drag.el;ring.className='dsh-cp-drag bg3-cursor';ring.innerHTML=`<img src="${esc(item.img||fallback)}" alt=""><b>${s.option.kind==='free'?'✧':roman(s.option.level)}</b>`;ring.style.display='none';document.body.appendChild(ring);
    this._tipLocked=true;this.hideTip(0);
    if(this.panel._drag.kind==='area'||s.plan?.areaChoice){
      const area=this.area=s.plan?.areaChoice?new AreaChoiceAim(this,preview):new AreaAim(this,preview);this._areaPredictionKey=null;
      void area.start().then(()=>{if(this.area===area&&this.lastPoint)this.move(this.lastPoint);}).catch(err=>{if(this.area===area){this.cancel();this.error(err);}});
    }
    this.render();this.syncTargets();this.panel._loop();
  }

  move(ev) {
    this.lastPoint={clientX:ev.clientX,clientY:ev.clientY,target:ev.target};const drag=this.panel._drag;
    if(!drag||this.busy||!this.selection?.option)return;
    const on=this.onCanvas(ev);drag.hudHidden=!on;drag.el.style.display=on?'':'none';
    if(!on){this.area?.hide();if(this.area&&!this.selection.plan?.areaChoice){this.badges.replaceChildren();this._areaPredictionKey=null;}this.panel._hideTargetOverlay();this.panel.$chain.style.display='none';drag.overlayKey=undefined;return;}
    this.panel._moveDrag(drag,ev);
    if(this.selection.plan?.areaChoice){
      this.area?.refresh();
      const target=this.panel._tokenAtClient(ev.clientX,ev.clientY),selected=this.selection.targets.includes(target?.id);
      let hint=drag.el.querySelector('.bg3-target-hint');if(!hint){hint=document.createElement('span');hint.className='bg3-target-hint';drag.el.appendChild(hint);}
      hint.textContent=target?(this.area?.accepts(target,{refresh:false})?(selected?'再次点击取消选择':'点击选择目标'):'目标不在作用范围内或不符合目标条件'):`已选 ${this.selection.targets.length} 个 · 数量不限`;
      if(target&&!this.area?.accepts(target,{refresh:false}))this.panel._hideTargetOverlay();
      this.syncAreaTargets();return;
    }
    if(this.area){this.area.move(ev);let hint=drag.el.querySelector('.bg3-target-hint');if(!hint){hint=document.createElement('span');hint.className='bg3-target-hint';drag.el.appendChild(hint);}const range=this.area.rangeCheck();hint.textContent=range.allowed?'点击放置 · 滚轮旋转 · 右键取消':range.message;this.syncAreaTargets();return;}
    const t=this.panel._tokenAtClient(ev.clientX,ev.clientY),s=this.selection;
    const duplicate=s.plan&&!s.plan.repeat&&s.targets.includes(t?.id);
    let hint=drag.el.querySelector('.bg3-target-hint');if(!hint){hint=document.createElement('span');hint.className='bg3-target-hint';drag.el.appendChild(hint);}
    hint.textContent=duplicate?'已选择目标，请换一个':s.plan?`${s.targets.length} / ${s.plan.max}`:'';
    drag.el.classList.toggle('duplicate',!!duplicate);
  }

  cancel(render=true) {
    this.audio.stop();
    if(this.busy)return;
    const selection = this.selection;
    const item = this.panel.actor?.items.get(selection?.itemId);
    const activity = item && this.panel._activityList(item).find(value => value.id === selection.activityId);
    if (activity && selection.actorUuid === this.panel.actor?.uuid
      && (this.panel._dragKind(activity) === 'self' || activity.range?.units === 'self')) {
      for (const token of [...game.user.targets]) token.setTarget(false,{releaseOthers:false,user:game.user});
    }
    this.closeChoice();this.clearVisuals();this.badges.replaceChildren();this.selection=null;this.page='list';this._tipLocked=false;this.hideTip(0);
    if(render&&this.panel.actor)this.render();
  }

  // Abort only the captured actor's operation, including when the view changes while awaiting Midi.

  finishAbort(session=this._session) {
    const operation=session.operation;
    session.cancelExecution?.();
    this.releaseOperationTargets(operation);
    Object.assign(session,{busy:false,aborting:false,_activeSeq:null,_activeUsage:null,
      activeWorkflow:null,selection:null,page:'list',operation:null,cancelExecution:null});
    if(this._session!==session)return;
    this.clearVisuals();this.badges.replaceChildren();this._tipLocked=false;
    try{this.panel.refresh();this.render();}catch(err){console.warn('['+ID+'] 取消后刷新失败',err);}
    if(!this.panel.actor){this.el.replaceChildren();this.el.hidden=true;this.position();}
  }

  async abortActive(session=this._session) {
    if(session===this._session)this.audio.stop();
    if(!session.busy||session.aborting)return;
    const operation=session.operation;
    let abortTimer;
    const wf=session.activeWorkflow??session._activeUsage?.workflow??null;
    if(!wf||wf.sequenceId!==session._activeSeq||wf.actor?.uuid!==session.actorUuid||wf.aborted||wf.currentAction===wf.WorkflowState_Completed){this.finishAbort(session);return;}
    session.aborting=true;
    const state=Promise.resolve().then(()=>wf.performState(wf.WorkflowState_Abort));
    state.catch(()=>{});
    try{
      if(this._session===session)try{this.renderChoice();}catch(err){console.warn('['+ID+'] 取消结算界面刷新失败',err);}
      wf.abort=true;
      await Promise.race([state,new Promise((_,reject)=>{abortTimer=setTimeout(()=>reject(Object.assign(new Error('abort-timeout'),{abortTimeout:true})),2000);})]);
    }catch(err){
      if(err?.abortTimeout)console.warn('['+ID+'] 工作流中止超时，已强制解锁该角色 HUD');
      else this.error(err);
    }finally{
      clearTimeout(abortTimer);
      if(session.operation===operation){session.aborting=false;if(session.busy)this.finishAbort(session);}
    }
  }

  async submit(ev) {
    const s=this.selection;if(!s?.option||this.busy)return;
    const actor=this.panel.actor;if(!actor?.isOwner||actor.uuid!==s.actorUuid){this.cancel();return;}
    const item=actor.items.get(s.itemId),act=this.panel._activityList(item).find(a=>a.id===s.activityId);
    if(!act)throw Error('技能已不存在，请重新选择');
    const kind=s.plan?'target':this.panel._dragKind(act);const target=kind==='target'?this.panel._tokenAtClient(ev.clientX,ev.clientY):null;
    if(kind==='target'&&!target){this.status('请指向一个可见目标');return;}
    if(!spellOptions(actor,item,act).some(o=>o.key===s.option.key&&o.value>0)){this.status('所选环位或免费次数已耗尽，请重新选择');return;}
    if(s.plan){
      this.pruneTargets();
      if(s.plan.areaChoice){
        if(!this.area?.accepts(target)){this.status('目标不在作用范围内或不符合目标条件');return;}
        const index=s.targets.indexOf(target.id);
        if(index>=0)s.targets.splice(index,1);else s.targets.push(target.id);
        this._areaPredictionKey=null;this.renderChoice();this.syncTargets();return;
      }
      if(!s.plan.repeat&&s.targets.includes(target.id)){this.status('已选择目标，请换一个');return;}
      if(s.targets.length>=s.plan.max)return;
      s.targets.push(target.id);this.renderChoice();this.syncTargets();
      if(s.targets.length<s.plan.max)return;
      return this.commitSelection();
    }
    if(kind==='area'){
      this.area?.move(ev,{force:true});
      if(!this.area?.snapshot()){this.status('范围模板尚未准备好');return;}
      const range=this.area.rangeCheck();if(!range.allowed){this.status(range.message);return;}
      s.areaPoint=this.area.snapshot();s.areaTargets=this.area.targets.map(t=>t.id);
    }
    return this.commitSelection(target);
  }

  async syncAreaTargets() {
    const area=this.area;if(!area||!this.selection||(this.panel._drag?.hudHidden&&!this.selection.plan?.areaChoice))return;
    const choice=!!this.selection.plan?.areaChoice;
    if(choice){area.refresh();const before=this.selection.targets.length;this.pruneTargets();if(before!==this.selection.targets.length)this.renderChoice();}
    const policy=getPredictionPolicy();
    const targets=area.targets.filter(t=>t?.actor&&!t.destroyed&&t.visible&&!t.document.hidden&&!t.document.isSecret);
    const activeIds=new Set(targets.map(t=>t.id));for(const card of [...this.badges.children])if(!activeIds.has(card.dataset.tokenId))card.remove();
    const key=targets.map(t=>t.id).sort().join(',')+JSON.stringify(policy)+'|'+this.panel._overlaySeq+'|'+(choice?this.selection.targets.join(','):'');
    // Positions update without rebuilding the prediction cards.
    for(const el of this.badges.children){const t=canvas.tokens.get(el.dataset.tokenId);if(!t)continue;const p=this.panel._tokenScreenPoint(t);el.hidden=!p;if(!p)continue;el.style.left=p.x+'px';el.style.top=(p.y-8)+'px';}
    if(key===this._areaPredictionKey)return;
    this._areaPredictionKey=key;const generation=++this._areaGeneration;
    const shared=policy.probability?null:await this.panel._computePreview(area.activity,null).catch(()=>null);
    const rows=await Promise.all(targets.map(async token=>({token,preview:policy.probability?await this.panel._computePreview(area.activity,token).catch(()=>null):shared})));
    if(this.area!==area||generation!==this._areaGeneration||(this.panel._drag?.hudHidden&&!choice))return;
    this.badges.replaceChildren();
    for(const {token,preview}of rows){
      if(token.destroyed||!token.visible||token.document.hidden||token.document.isSecret)continue;
      const card=document.createElement('div');card.className='bg3-area-target';card.dataset.tokenId=token.id;
      Object.assign(card.style,{position:'fixed',transform:'translate(-50%,-100%)',pointerEvents:'none',padding:'4px 7px',border:'1px solid #d9bb70',borderRadius:'5px',background:'#191710e8',color:'#fff',fontSize:'12px',textAlign:'center',whiteSpace:'nowrap'});
      const lines=[token.name];
      if(choice){const selected=this.selection.targets.includes(token.id);card.classList.toggle('selected',selected);card.style.borderColor=selected?'#8ce3a4':'#d9bb70';card.style.background=selected?'#183d28ed':'#191710e8';lines.push(selected?'✓ 已选择':'点击选择');}
      if(policy.probability&&['attack','save'].includes(area.activity.type))lines.push(`${preview?.kind==='save'?'豁免失败':'命中'} ${Number.isFinite(preview?.chance)?Math.round(preview.chance*100)+'%':'待判定'} · 估算`);
      if(policy.damage)lines.push(`基础均伤 ${Number.isFinite(preview?.damage)?Math.round(preview.damage*10)/10:area.activity.labels?.damages?.length?'待判定':'无直接伤害'}`);
      for(const text of lines){const line=document.createElement('div');line.textContent=text;card.appendChild(line);}
      const p=this.panel._screenOf(token.x+token.w/2,token.y);card.style.left=p.x+'px';card.style.top=(p.y-8)+'px';this.badges.appendChild(card);
    }
  }

  pruneTargets() {
    const s=this.selection;if(!s?.targets)return;
    // The committed use retains its choices after its disposable preview is gone.
    if(s.plan?.areaChoice&&!this.area)return;
    if(s.plan?.areaChoice)this.area?.refresh();
    s.targets=s.targets.filter(id=>{const t=canvas.tokens.get(id);return t?.actor&&!t.destroyed&&t.visible&&(game.user.isGM||(!t.document.hidden&&t.isVisible!==false))&&(!s.plan?.areaChoice||this.area?.accepts(t,{refresh:false}));});
  }

  syncTargets() {
    if(this.area){void this.syncAreaTargets();return;}
    const s=this.selection;if(!s?.plan){if(this.badges.childElementCount)this.badges.replaceChildren();return;}
    const before=s.targets.length;this.pruneTargets();if(before!==s.targets.length)this.renderChoice();
    const hint=this.panel._drag?.el?.querySelector('.bg3-target-hint');
    if(hint&&!this.panel._drag.el.classList.contains('duplicate'))hint.textContent=`${s.targets.length} / ${s.plan.max}`;
    const counts=new Map();for(const id of s.targets)counts.set(id,(counts.get(id)||0)+1);
    for(const el of [...this.badges.children])if(!counts.has(el.dataset.tokenId))el.remove();
    for(const [id,count] of counts){const t=canvas.tokens.get(id);let el=this.badges.querySelector(`[data-token-id="${id}"]`);
      if(!el){el=document.createElement('span');el.className='bg3-target-badge';el.dataset.tokenId=id;this.badges.appendChild(el);}
      el.textContent=s.plan.repeat?String(count):'✓';el.title=`${t.name} · ${s.plan.repeat?count+' 条射线':'已选择'}`;
      const pt=this.panel._tokenScreenPoint(t,true);el.hidden=!pt;if(!pt)continue;el.style.left=pt.x+'px';el.style.top=pt.y+'px';
    }
  }

  async commitSelection(singleTarget=null) {
    this.audio.stop();
    const s=this.selection;if(!s?.option||this.busy)return;
    const actor=this.panel.actor;if(!actor?.isOwner||actor.uuid!==s.actorUuid){this.cancel();return;}
    const item=actor.items.get(s.itemId),act=this.panel._activityList(item).find(a=>a.id===s.activityId);
    if(!act){this.cancel();return;}
    if(s.plan?.areaChoice){
      this.area?.refresh({force:true});
      if(!this.area?.snapshot()){this.status('范围尚未准备好，请稍候再确认');return;}
    }
    const before=s.targets?.length;this.pruneTargets();
    if(s.plan&&(!s.targets.length||before!==s.targets.length||(s.plan.repeat&&s.targets.length!==s.plan.max))){this.renderChoice();this.status('目标已变化，请重新确认目标');return;}
    if(!spellOptions(actor,item,act).some(o=>o.key===s.option.key&&o.value>0)){this.status('所选环位或免费次数已耗尽，请重新选择');this.cancel();return;}
    if(s.plan?.areaChoice){s.areaPoint=this.area.snapshot();s.areaTargets=[...s.targets];}
    const targets=s.areaPoint?(s.areaTargets??[]).map(id=>canvas.tokens.get(id)).filter(Boolean):s.plan?s.targets.map(id=>canvas.tokens.get(id)):singleTarget?[singleTarget]:[];
    const teleport=teleportWorkflow(act);
    const kind = this.panel._dragKind(act);
    const selfUse = kind === 'self' || act.range?.units === 'self'
      || (singleTarget === this.panel.token && ['spell','feat'].includes(item.type));
    const session=this._session,operation={selection:s,prior:new Set(game.user.targets),targetRevision:null,
      clearTargets:selfUse,inputRevision:this._targetInputRevision,
      teleportSource:teleport?this.panel.token:null,
      ownedTargets:new Set([...game.user.targets,...targets,this.panel.token].filter(Boolean))};
    session.operation=operation;this._targetOperation=operation;
    session.busy=true;this.clearVisuals();this.tip.hidden=true;this.render();
    const selected=s.option;let releasePlacement;
    try {
    let activity=teleport?prepareTeleportActivity(act):s.plan?.areaChoice?prepareAreaChoiceActivity(act):s.plan?prepareMultiActivity(item,act,s.plan):prepareAreaActivity(act);
    const usage={midiOptions:{targetUuids:[...new Set(targets.map(t=>t.document.uuid))],workflowOptions:{targetConfirmation:!teleport&&!s.plan?.areaChoice&&act.target?.affects?.choice?'always':'none'}}};
    if(selected.kind==='native'&&list(act.consumption?.targets).length)usage.consume={resources:true,spellSlot:false};
    if(selected.kind==='slot')usage.spell={slot:selected.key};
    if(selected.kind==='item'){
      const clone=activity.item.clone({}, {keepId:true});
      const consumption=list(act.consumption?.targets).map(t=>t.toObject?.()??foundry.utils.deepClone(t));
      consumption.push({type:'itemUses',target:'',value:'1',scaling:{mode:'',formula:''}});
      clone.updateSource({[`system.activities.${act.id}.consumption.targets`]:consumption,[`system.activities.${act.id}.consumption.spellSlot`]:false});
      clone.prepareFinalAttributes?.();activity=clone.system.activities.get(act.id);
      usage.consume={spellSlot:false,resources:true};usage.scaling=0;
      usage.spell={slot:`spell${Number(item.system.level)||0}`};
    }
    if(selected.kind==='free'){
      const clone=activity.item.clone({}, {keepId:true});
      // Feature freebies replace native charges/shared resources; spells retain their existing material/resource costs.
      const targets=freeConsumptionTargets(item,act,selected.key);
      clone.updateSource({[`system.activities.${act.id}.consumption.targets`]:targets,[`system.activities.${act.id}.consumption.spellSlot`]:false});
      clone.prepareFinalAttributes?.();activity=clone.system.activities.get(act.id);
      usage.consume={spellSlot:false,resources:true};usage.scaling=0;
      if(item.type==='spell')usage.spell={slot:`spell${Number(item.system.level)||0}`};
    }
      for(const t of [...game.user.targets])t.setTarget(false,{releaseOthers:false,user:game.user});
      for(const t of new Set(targets))t.setTarget(true,{releaseOthers:false,user:game.user});
      operation.targetRevision=this.panel._targetRevision;
      // Do not suppress system dialogs for ambiguous multi-target/ammunition uses.
      const multi=Number(act.target?.affects?.count)>1;
      const weapon=item.type==='weapon'&&(item.system.properties?.has?.('amm')||this.panel._activityList(item).length>1);
      if(s.areaPoint){usage.create={measuredTemplate:true};releasePlacement=bindConfirmedPlacement(activity,s.areaPoint,()=>session.busy&&session.operation===operation&&!session.aborting,async error=>{this.status(error.message);await this.abortActive(session);});}
      let result;
      if(s.plan?.repeat)result=await this.executeRays(activity,usage,targets,s.plan,session);
      else result=await this.execute(activity,usage,{configure:!s.plan&&(multi||weapon||act.consumption?.scaling?.allowed)},session);
      this.lastResult={item:item.id,activity:act.id,option:selected.kind,result:result?'returned':'cancelled',at:Date.now()};
    } finally {
      releasePlacement?.();
      // A late completion must not touch another actor or a newer operation.
      this.releaseOperationTargets(operation);
      if(session.operation===operation){
        Object.assign(session,{busy:false,aborting:false,selection:null,page:'list',operation:null});
        if(this._session===session){
          this.badges.replaceChildren();this._tipLocked=false;this.panel.refresh();
          if(!this.panel.actor){this.el.replaceChildren();this.el.hidden=true;this.position();}
        }
      }
    }
  }

  async executeRays(activity,usage,targets,plan,session=this._session) {
    const operation=session.operation;
    const bolt=plan.spell==='magicMissile'?missileBolt(activity.item,activity):rayActivity(activity.item,activity),separate=bolt.id!==activity.id;
    const results=[];let result;
    const completed=w=>!!w&&!w.aborted&&(!w.WorkflowState_Abort||w.currentAction!==w.WorkflowState_Abort);
    // The dispatcher keeps the full cast's target count; each damage bolt is narrowed below.
    if(separate){result=await this.execute(activity,usage,{configure:false},session);if(!completed(result))return result;}
    for(let i=0;i<targets.length;i++){
      if(session.operation!==operation)return null;
      const target=canvas.tokens.get(targets[i].id);
      if(!target?.actor||target.destroyed){this.status('目标已离开场景，停止剩余射线；已完成的攻击不会重试');break;}
      const first=!separate&&i===0;
      const ray=prepareMultiActivity(bolt.item,bolt,{...plan,bolt:true,subsequent:!first});
      const config=first?foundry.utils.deepClone(usage):{consume:{spellSlot:false,resources:false},consumeUsage:false,scaling:0,spell:{slot:usage.spell?.slot},midiOptions:{isTriggered:true,proceedChecks:{checkReaction:false,checkBonusAction:false}}};
      config.midiOptions??={};config.midiOptions.targetUuids=[target.document.uuid];config.midiOptions.targetsToUse=new Set([target]);config.midiOptions.configureDialog=false;
      config.midiOptions.workflowOptions={...config.midiOptions.workflowOptions,targetConfirmation:'none',autoRollAttack:true,autoRollDamage:'onHit',autoFastAttack:true,autoFastDamage:true};
      result=await this.execute(ray,config,{configure:false},session);
      results.push({target:target.id,attack:result?.attackTotal,damage:result?.damageTotal,aborted:!completed(result)});
      this.lastRays=results;
      if(!completed(result)){this.status('射线结算已中止；未执行的射线不会自动重试');break;}
    }
    return result;
  }

  async execute(activity,usage,dialog,session=this._session) {
    // Register the correlated lifecycle before calling use; never manufacture a workflow for hover.
    if(!game.modules.get('midi-qol')?.active)return activity.use(usage,dialog);
    if(activity.type==='attack'){
      usage.midiOptions??={};usage.midiOptions.workflowOptions??={};
      usage.midiOptions.workflowOptions.autoRollDamage='onHit';
    }
    const seq=foundry.utils.randomID();usage.sequenceId=seq;
    session._activeSeq=seq;session._activeUsage=usage;session.activeWorkflow=null;session.aborting=false;
    if(this._session===session&&session.busy&&session.selection)this.renderChoice();
    return new Promise((resolve,reject)=>{
      let finished=false, aborted=false, timer, poll;const hooks=[];
      const matches=w=>w?.sequenceId===seq&&w.actor?.uuid===session.actorUuid;
      const capture=w=>{if(!finished&&matches(w))session.activeWorkflow=w;};
      const captureStart=Hooks.on('midi-qol.preStart',capture);
      const captureRoll=Hooks.on('midi-qol.preItemRollV2',payload=>capture(payload?.workflow??payload));
      const finish=(value,err)=>{
        if(finished)return;finished=true;clearTimeout(timer);clearInterval(poll);
        for(const [n,id]of hooks)Hooks.off(n,id);
        Hooks.off('midi-qol.preStart',captureStart);Hooks.off('midi-qol.preItemRollV2',captureRoll);
        if(session.activeWorkflow?.sequenceId===seq)session.activeWorkflow=null;
        if(session._activeUsage===usage)session._activeUsage=null;
        if(session._activeSeq===seq){session._activeSeq=null;session.cancelExecution=null;}
        err?reject(err):resolve(value);
      };
      session.cancelExecution=()=>finish(null);
      // midi 中止工作流时只会触发 preAbort，postCleanup 被跳过（performState 在 abort 分支不调 post 钩子）；
      // 必须在这里立即收尾，否则 busy 永远为 true，HUD 一直变灰无法操作。
      for(const name of ['midi-qol.postCleanup','midi-qol.preAbort'])hooks.push([name,Hooks.on(name,w=>{if(!matches(w))return;if(name==='midi-qol.preAbort'){aborted=true;finish(null);return;}finish(aborted?null:w);})]);
      // 兜底：装备/特性等活动的 abort 路径偶尔不带 preAbort 钩子，轮询 workflow 状态解锁
      poll=setInterval(()=>{const wf=session.activeWorkflow??usage.workflow;if(!matches(wf))return;if(wf.aborted||wf.currentAction===wf.WorkflowState_Completed||wf.currentAction===wf.WorkflowState_Abort)finish(null);},500);
      timer=setTimeout(()=>{if(this._session===session)this.status('该角色结算仍未结束，请检查投掷／反应窗口；其他角色可继续操作');},30000);
      Promise.resolve().then(()=>activity.use(usage,dialog)).then(result=>{
        capture(usage.workflow);
        if(!result)finish(null);
        else if(!usage.workflow&&!session.activeWorkflow)finish(result);
      },e=>finish(null,e));
    });
  }

  status(text) { if(this.lastStatus===text&&Date.now()-(this.lastStatusAt||0)<2500)return;this.lastStatus=text;this.lastStatusAt=Date.now();ui.notifications.warn(text); }
  error(err) { console.error(`[${ID}] HUD`,err);ui.notifications.error(err.message||String(err)); }

  tooltip(ev) {
    if(this._tipLocked&&!ev.target.closest('.bg3-choice-popover')){this.hideTip(0);return;}
    const b=ev.target.closest('[data-hud-item],[data-hud-mode],[data-hud-option]');
    if(!b){this.hideTip(200);return;}
    clearTimeout(this._tipHideTimer);
    if(b===this._tipBtn)return;
    this.hideTip();
    this._tipBtn=b;
    const request = this._tipRequest = Symbol();
    this._tipTimer = setTimeout(() => {
      void this.renderTip(b,request).catch(err => {
        if (this._tipRequest === request) this.hideTip();
        console.warn(`[${ID}] 悬浮说明失败`,err);
      });
    },150);
  }

  hideTip(delay=0) {
    clearTimeout(this._hoverTipTimer);
    clearTimeout(this._tipTimer);clearTimeout(this._tipHideTimer);
    const hide=()=>{
      this._tipRequest=null;
      this.tip.hidden=true;
      this.tip.replaceChildren();
      this._tipBtn=null;
      this.tipItem=null;
    };
    if(delay>0&&!this.tip.hidden)this._tipHideTimer=setTimeout(hide,delay);else hide();
  }

  tooltipResources(item,acts) {
    // 物品自身 uses / 活动 uses 已由 tooltip-150 从活动数据读取，这里只补它读不到的外部来源与免费施法来源。
    const out=[],meta=resourceMeta(this.panel.actor,item,acts);
    if(meta?.kind==='resource')out.push({kind:'resource',label:meta.label,text:`${meta.value}/${meta.max}`,value:meta.value,max:meta.max,period:item.system?.uses?.recovery?.[0]?.period??''});
    for(const resource of list(this.panel.actor?.items)){
      const freeCast=resource.flags?.[ID]?.freeCast;
      if(!matchesFreeSource(resource,item)||freeCast.disabled)continue;
      const uses=featureUsesLeft(resource);
      out.push({kind:'free',label:freeCast.source||resource.name,text:`${uses.value}/${uses.max}`,value:uses.value,max:uses.max,period:freeCast.period??''});
    }
    return out;
  }

  async renderTip(btn,request) {
    const actor=this.panel.actor;
    const current = () => this._tipRequest === request && this.panel.actor === actor &&
      (!this._tipLocked || !!btn.closest('.bg3-choice-popover')) && !this.el.hidden && this.el.contains(btn);
    if(!actor||!current())return;
    let item=null,activityId=null,castLevel=null;
    if(btn.dataset.hudItem){
      item=actor.items.get(btn.dataset.hudItem);
      if(item&&this.selection?.itemId===item.id&&this.page!=='list'){activityId=this.selection.activityId;castLevel=Number(this.selection.option?.level)||null;}
    }else if(btn.dataset.hudMode||btn.dataset.hudOption){
      const selection=this.selection;item=actor.items.get(selection?.itemId);
      if(item){const acts=this.panel._activityList(item);const act=acts.find(a=>a.id===selection.activityId);if(btn.dataset.hudMode)activityId=btn.dataset.hudMode;else{activityId=selection.activityId;const option=spellOptions(actor,item,act).find(o=>o.key===btn.dataset.hudOption);castLevel=Number(option?.level)||null;}}
    }
    if(!item)return;
    const acts=this.panel._activityList(item),baseLevel=Number(item.system?.level)||0;
    let scaledItem=null,scaledActivity=null;
    const delta=Math.max(0,(castLevel??baseLevel)-baseLevel);
    if(delta&&activityId){
      try{scaledItem=item.clone({'flags.dnd5e.scaling':delta},{keepId:true});scaledActivity=scaledItem.system.activities.get(activityId)??null;}catch(err){scaledItem=null;scaledActivity=null;}
    }
    const act=acts.find(a=>a.id===activityId)??null;
    let plan=null;
    if(act){try{plan=targetPlan(item,act,castLevel??baseLevel);}catch(err){plan=null;}}
    if(this.tip.hidden){this.tip.innerHTML='<p class="bg3-tip-pending" role="status">正在展开说明…</p>';this.tip.hidden=false;this.positionTip(btn);}
    const model=await buildTooltipModel(item,{
      activities:acts,selectedActivityId:activityId,castLevel,scaledActivity,scaledItem,
      resources:this.tooltipResources(item,acts),targetPlan:plan,isOwner:!!actor.isOwner,
      shortName:nameParts(item.name).short,
    });
    if(!current())return;
    this.tipItem=item;
    this.tip.innerHTML=renderTooltipHTML(model);
    this.tip.hidden=false;
    this.positionTip(btn);
  }

  async deleteFreeSource(resourceId) {
    const actor=this.panel.actor,s=this.selection;
    if(this.busy||!actor?.isOwner||!s||s.actorUuid!==actor.uuid)return;
    const resource=actor.items.get(resourceId),spell=actor.items.get(s.itemId);
    if(!spell||!canManageFree(spell,this.panel._activityList(spell))||!matchesFreeSource(resource,spell))return;
    const session=this._session;session.busy=true;
    if(s.option?.key===resourceId){
      this.clearVisuals();this.tip.hidden=true;this.badges.replaceChildren();
      s.option=null;s.plan=null;s.targets=[];
    }
    this.render();
    try { await actor.deleteEmbeddedDocuments('Item',[resourceId]); }
    finally { session.busy=false;if(this._session===session)this.render(); }
  }

  setHudSize(scale,width,persist=true) {
    this.preferredScale=normalizeScale(scale);
    this.hudWidth=Math.round(clamp(width,HUD_WIDTH.min,HUD_WIDTH.max));
    this.hideTip(0);this.position();
    if(!persist)return;
    try{localStorage.setItem('bg3-hud-width',this.hudWidth+'px');}catch{}
    if(this._savedScale!==this.preferredScale){this._savedScale=this.preferredScale;void saveDisplay('scale',this.preferredScale).catch(err=>{this._savedScale=null;this.error(err);});}
  }

  widthBounds() {
    const max = Math.floor(Math.min(HUD_WIDTH.max, this.hudFitWidth));
    return {min:Math.min(HUD_WIDTH.min, max),max};
  }

  beginWidthResize(ev, grip) {
    const {min,max} = this.widthBounds();
    if (this.busy || ev.button !== 0 || min === max) return;
    ev.preventDefault();
    this.cancel(false);
    this.widthResize = {
      pointer:ev.pointerId, x:ev.clientX, side:Number(grip.dataset.hudWidth),
      start:this.el.offsetWidth, original:this.hudWidth,
    };
    this.el.setPointerCapture(ev.pointerId);
    this.el.classList.add('resizing-width');
  }

  moveWidthResize(ev) {
    const drag = this.widthResize;
    const {min,max} = this.widthBounds();
    if (min === max) return;
    const delta = (ev.clientX - drag.x) * drag.side * 2 / this.scale;
    const width = Math.round(clamp(drag.start + delta,min,max));
    this.setHudSize(this.preferredScale,width === drag.start ? drag.original : width,false);
  }

  endWidthResize(ev, cancelled) {
    const drag = this.widthResize;
    if (drag.pointer !== ev.pointerId) return;
    this.widthResize = null;
    this.el.classList.remove('resizing-width');
    if (this.el.hasPointerCapture(ev.pointerId)) this.el.releasePointerCapture(ev.pointerId);
    this.setHudSize(this.preferredScale,cancelled ? drag.original : this.hudWidth,!cancelled);
    this.render();
  }

  syncScrollHint(scroller) {
    const zone = scroller.closest('.bg3-zone');
    if (!zone) return;
    zone.toggleAttribute('data-scroll-above', scroller.scrollTop > 1);
    zone.toggleAttribute('data-scroll-below', scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 1);
  }

  fillEmptySlots(grid) {
    const columns = columnCount(getComputedStyle(grid).gridTemplateColumns);
    const slots = grid.querySelectorAll('.bg3-grid-cell');
    const occupied = grid.childElementCount - slots.length;
    const rows = Math.max(this.rows, Math.ceil(occupied / columns));
    const needed = rows * columns - occupied;
    if (needed > slots.length) {
      grid.insertAdjacentHTML('beforeend',
        '<span class="bg3-grid-cell" aria-hidden="true"></span>'.repeat(needed - slots.length));
    } else {
      for (let i = slots.length - 1; i >= needed; i--) slots[i].remove();
    }
  }

  rowViewportHeight() {
    const deck = this.el.querySelector('.bg3-deck');
    const bottom = parseFloat(getComputedStyle(this.el).bottom) || 0;
    const chrome = deck ? this.el.offsetHeight - deck.offsetHeight + (bottom + 10) / this.scale : 0;
    // maxRowsFor already reserves 150px. Account for extra chrome when controls wrap.
    return (globalThis.innerHeight || 900) / this.scale - Math.max(0, chrome - 150);
  }

  /* 0.11.0: saved rows (per actor flag hudLayout.rows) win over the viewport default. */

  zoneBase() {
    return parseFloat(getComputedStyle(this.el).getPropertyValue('--bg3-zone-base')) || 62;
  }

  zoneWidths() {
    return [...this.el.querySelectorAll('.bg3-zone')].map(zone=>zone.getBoundingClientRect().width/this.scale);
  }

  zoneWeights(widths) {
    const base = this.zoneBase();
    return widths.map(width => Math.max(0.01, width - base));
  }

  setZoneRatios(ratios) {
    const zones = this.el.querySelector('.bg3-zones');
    for (const [index, zone] of [...zones.querySelectorAll('.bg3-zone')].entries()) {
      zone.style.setProperty('--bg3-zone-weight', String(ratios[index]));
    }
  }

  isChoosing() {
    return !!this.selection && !this.selection.option && !this.busy &&
      (this.page === 'modes' || this.page === 'slots');
  }

  choiceAnchor(itemId = this.selection?.itemId) {
    return itemId ? this.el.querySelector(`[data-hud-item="${CSS.escape(itemId)}"]`) : null;
  }

  closeChoice() {
    const drawer = this.el.querySelector('.bg3-choice-popover');
    if (!drawer) return;
    drawer.hidden = true;
    drawer.replaceChildren();
    this.el.querySelector('[aria-controls="dsh-bg3-choice"]')?.removeAttribute('aria-expanded');
  }

  choiceScroll(drawer) {
    return {
      key: drawer.dataset.hudChoiceKey,
      top: drawer.scrollTop,
      left: drawer.querySelector('.bg3-upcast-slots')?.scrollLeft ?? 0,
    };
  }

  positionChoice() {
    const drawer = this.el.querySelector('.bg3-choice-popover');
    if (!drawer || drawer.hidden || this.el.hidden) return;
    const hud = this.el.getBoundingClientRect();
    const anchor = this.choiceAnchor();
    const bounds = anchor?.getBoundingClientRect();
    const grid = anchor?.closest('.bg3-grid')?.getBoundingClientRect();
    const visible = bounds && grid && bounds.bottom > grid.top && bounds.top < grid.bottom;
    if (this.isChoosing() && !visible) {
      this.cancel(false);
      return;
    }
    const resource = this.el.querySelector('.bg3-topbar')?.getBoundingClientRect() ?? hud;
    const item = this.panel.actor?.items.get(this.selection?.itemId);
    const side = this.groupOf(item ?? {}) === 'spells' ? 'right' : 'left';
    const sidebar = document.getElementById('sidebar')?.getBoundingClientRect();
    const right = sidebar?.width > 0 && sidebar.right >= innerWidth - 24 ? sidebar.left - 8 : innerWidth - 8;
    // Counter the HUD transform so labels and resource outlines stay readable.
    drawer.style.setProperty('--bg3-choice-inverse-scale', String(1 / this.scale));
    drawer.dataset.hudChoiceSide = side;
    // Let content size the cards and the whole strip. The title can truncate without
    // imposing a wide empty card; viewport limits wrap the strip only when needed.
    drawer.style.width = 'max-content';
    drawer.style.maxWidth = `${Math.max(1, right - 8)}px`;
    drawer.style.maxHeight = `${Math.max(72, Math.min(340, resource.bottom - 16))}px`;
    const width = drawer.offsetWidth;
    const x = side === 'left' ? resource.left - width - 8 : resource.right + 8;
    const left = Math.max(8, Math.min(right - width, x));
    const overlapsResource = left < resource.right && left + width > resource.left;
    const bottom = overlapsResource ? resource.top - 8 : resource.bottom;
    const top = Math.max(8, bottom - drawer.offsetHeight);
    drawer.style.left = `${(left - hud.left) / this.scale}px`;
    drawer.style.top = `${(top - hud.top) / this.scale}px`;
    drawer.style.bottom = 'auto';
  }

  upcastOption(option) {
    const isFree = option.kind === 'free' || option.kind === 'item';
    const isSlot = option.kind === 'slot';
    const item = this.panel.actor?.items.get(this.selection?.itemId);
    const isSpell = item?.type === 'spell';
    const activity = this.panel._activityList(item).find(a => a.id === this.selection?.activityId);
    const nativeResource = !isSpell && !isFree ? resourceMeta(this.panel.actor,item,activity?[activity]:[]) : null;
    const meter = isSlot || isFree ? option : nativeResource;
    const marker = !option.level ? '戏法' : levelMark(option.level);
    const label = [option.label, isSlot || isFree ? `剩余 ${option.value}/${option.max}` : '',
      isFree ? periods[option.period] : ''].filter(Boolean).join(' · ');
    const pips = meter?.max > 0 ? Array.from({length: Math.min(8, meter.max)}, (_, index) =>
      `<i class="pip ${index < meter.value ? 'filled' : 'empty'}"></i>`).join('') : '';
    const pact = option.key === 'pact' ? '<small class="cell-corner" aria-hidden="true">契</small>' : '';
    const activation = !isSpell ? actions[activity?.activation?.type] || '' : '';
    const face = isSpell ? `<span class="cell-level">${esc(marker)}</span>`
      : `<img src="${esc(item?.img || fallback)}" alt="">`;
    const shape = isSpell ? spellShapeHTML(meter?.max ? Math.min(8,meter.max) : 1,meter?.value ?? 1,!option.level&&!meter?'cantrip':option.key==='pact'||isFree?'pact':'normal') : '';
    const copy = isSpell ? shape : `<span class="cell-kind">${isFree ? '免费特性' : '使用'}</span>${activation ? `<small class="cell-activation">${esc(activation)}</small>` : ''}${pips ? `<span class="cell-pips" aria-hidden="true">${pips}</span>` : ''}`;
    const button = `<button type="button" class="bg3-upcast-cell${(isFree?' free':'')+(option.key==='pact'?' bg3-level-pact':'')+(this.selection?.option?.key===option.key?' selected':'')}" data-hud-option="${esc(option.key)}" data-level="${option.level}" title="${esc(label)}" aria-label="${esc(label)}" ${option.value<1||this.busy?'disabled':''}><span class="bg3-option-emblem">${face}${pact}</span>${copy ? `<span class="bg3-option-copy">${copy}</span>` : ''}</button>`;
    if (option.kind !== 'free') return button;
    const remove = esc(`删除免费来源：${option.label}`);
    return `<div class="bg3-upcast-source">${button}<button type="button" class="bg3-free-delete" data-hud-delete-free="${esc(option.key)}" title="${remove}" aria-label="${remove}">×</button></div>`;
  }

  focusChoice() {
    this.el.querySelector('.bg3-upcast-popover:not([hidden]) .bg3-upcast-cell:not([disabled])')?.focus();
  }

  positionTip(btn) {
    const margin = 10;
    const gap = 8;
    this.tip.style.maxWidth = `${Math.max(1,this.hudRightEdge-2*margin)}px`;
    const width = this.tip.offsetWidth || 340;
    const rect = btn.getBoundingClientRect();
    const hudTop = this.el.getBoundingClientRect().top;
    const topbar = this.el.querySelector('.bg3-topbar')?.getBoundingClientRect();
    const drawer=(btn.closest('.bg3-choice-popover')??this.el.querySelector('.bg3-choice-popover:not([hidden])'))?.getBoundingClientRect();
    const top = Math.min(hudTop, topbar?.height ? topbar.top : hudTop, drawer?.top ?? hudTop);
    let x = Math.max(margin, Math.min(this.hudRightEdge - width - margin, rect.left + (rect.width - width) / 2));
    let y = top - gap;
    if (drawer) {
      const left = drawer.left - gap - margin;
      const right = this.hudRightEdge - drawer.right - gap - margin;
      const available = Math.max(left,right);
      if (available >= width) {
        x = right >= left ? drawer.right + gap : drawer.left - gap - width;
        y = Math.min(innerHeight - margin,drawer.bottom);
      }
    }
    this.tip.style.left = `${x}px`;
    this.tip.style.bottom = `${Math.max(margin,innerHeight-y)}px`;
    this.tip.style.maxHeight = `${Math.max(0,Math.min(640,innerHeight*.72,y-margin))}px`;
  }

  scheduleHoverTip() {
    clearTimeout(this._hoverTipTimer);
    if(!this._hoverPoint)return;
    this._hoverTipTimer=setTimeout(()=>{
      const p=this._hoverPoint;if(!p||this.el.hidden||this.resizing||this.vResize||this.widthResize)return;
      const target=document.elementFromPoint(p.x,p.y);
      if(target&&this.el.contains(target))this.tooltip({target});
    },180);
  }

  manageFree() {
    const actor=this.panel.actor,item=actor?.items.get(this.selection?.itemId);if(this.busy||!actor?.isOwner||this.selection?.actorUuid!==actor.uuid||!canManageFree(item,this.panel._activityList(item)))return;
    const isSpell=item.type==='spell',label=isSpell?'免费施法':'免费次数',defaultSource=isSpell?'魔法学徒':'额外免费次数';
    this.clearVisuals();if(this.selection)this.selection.option=null;
    const resources=list(actor.items).filter(i=>matchesFreeSource(i,item));
    const dialog=document.createElement('dialog');dialog.className='bg3-free-dialog';
    dialog.innerHTML=`<form><h2>${label} · ${esc(item.name)}</h2><p>${isSpell?'将魔法学徒、种族能力等提供的次数分别记录。免费施放使用法术基础环位。':'免费使用时仅扣所选来源，不消耗此特性的原次数或关联资源。动作、附赠动作和反应照常使用。'}</p><label>编辑来源<select name="existing"><option value="">＋ 新建来源</option>${resources.map(i=>`<option value="${esc(i.id)}">${esc(i.flags[ID].freeCast.source)} · ${usesLeft(i).value}/${usesLeft(i).max}</option>`).join('')}</select></label><label>来源名称<input name="source" value="${defaultSource}" maxlength="60" required></label><div class="bg3-form-row"><label>次数上限<input name="max" type="number" min="1" max="99" step="1" value="1" required></label><label>剩余次数<input name="remaining" type="number" min="0" max="99" step="1" value="1" required></label></div><label>恢复方式<select name="period">${Object.entries(periods).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label class="bg3-checkbox"><input type="checkbox" name="disabled">停用此来源</label><p class="bg3-form-error" role="alert"></p><footer><button type="button" data-close>取消</button><button type="submit">保存来源</button></footer></form>`;
    dialog.addEventListener('error',ev=>{const img=ev.target;if(img.tagName==='IMG'&&!img.src.endsWith(fallback))img.src=fallback;},true);document.body.appendChild(dialog);const form=dialog.querySelector('form');
    form.elements.existing.addEventListener('change',()=>{
      const r=actor.items.get(form.elements.existing.value),m=r?.flags?.[ID]?.freeCast;
      form.elements.source.value=m?.source||defaultSource;form.elements.max.value=r?usesLeft(r).max:1;form.elements.remaining.value=r?usesLeft(r).value:1;form.elements.period.value=m?.period||'lr';form.elements.disabled.checked=!!m?.disabled;
    });
    dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{dialog.remove();this.render();});
    form.addEventListener('submit',async ev=>{
      ev.preventDefault();const max=Number(form.elements.max.value),remaining=Number(form.elements.remaining.value),source=form.elements.source.value.trim(),period=form.elements.period.value;
      if(!source||!Number.isInteger(max)||!Number.isInteger(remaining)||max<1||max>99||remaining<0||remaining>max){dialog.querySelector('[role=alert]').textContent='请填写名称；剩余次数须为 0 到上限之间的整数。';return;}
      const btn=form.querySelector('[type=submit]');btn.disabled=true;
      try {
        const data={name:`${label} · ${source} · ${item.name}`,type:'feat',img:item.img||fallback,system:{uses:{max:String(max),spent:max-remaining,recovery:period==='manual'?[]:[{period,type:'recoverAll'}]}},flags:{[ID]:{freeCast:{itemId:item.id,...(isSpell?{spellId:item.id}:{}),source,period,disabled:form.elements.disabled.checked}}}};
        const existing=actor.items.get(form.elements.existing.value);
        if(existing&&!matchesFreeSource(existing,item))throw Error('免费来源与当前条目不匹配');
        if(!actor.isOwner||!actor.items.has(item.id))throw Error('当前角色或条目已不可编辑');
        if(existing)await existing.update(data);else await actor.createEmbeddedDocuments('Item',[data]);
        dialog.close();
      }catch(e){dialog.querySelector('[role=alert]').textContent=e.message;btn.disabled=false;}
    });
    dialog.showModal();
  }
}
