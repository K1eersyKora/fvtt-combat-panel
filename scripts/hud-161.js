import { patchHTML } from './hud-dom-161.js';
import { matchesFreeSource, canManageFree, freeConsumptionTargets } from './free-use-161.js';
import { targetPlan, rayActivity, missileBolt, prepareMultiActivity } from './multitarget-147.js';
import { AreaAim, bindConfirmedPlacement } from './area-targeting-157.js';
import { getPredictionPolicy, PREDICTION_POLICY_HOOK, PREDICTION_MODE_LABELS } from './prediction-policy-156.js';
import {
  classInfo, weaponSlots, normalAttackActivity, otherAttackActivities, topbarHTML,
  nameParts, shortName, resourceChipHTML, navHTML, emptyHTML,
} from './hud-parts-152.js';
import { itemFreeUseOption, resourceMeta, usesLeft as featureUsesLeft, isTransferActivity } from './feature-core-147.js';
import { curateGroup } from './curation-159.js';
import {
  MAX_ROWS, hudRows, maxRowsFor, normalizeRows, clampRow, scrollForRow, columnCount, overflowState,
} from './skill-layout-151.js';
import { buildTooltipModel, renderTooltipHTML } from './tooltip-150.js';
/* Local BG3-style HUD. All committed uses remain owned by dnd5e/midi-qol. */
const ID = 'fvtt-combat-panel';
const GROUPS = ['equipment', 'features', 'spells'];
const GROUP_LABEL = {equipment: '装备', features: '特性', spells: '法术'};
const DEFAULT_RATIOS = [1.3, 2.9, 5.8];
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
    this.panel=panel; this.page='list'; this.selection=null; this.busy=false;
    this.aborting=false; this.activeWorkflow=null; this._activeSeq=null; this._activeUsage=null;
    this.filterActivation=null;
    this.filterLevel=null;this.pendingPrefs=new Map();this.saveQueue=Promise.resolve();this.resizing=null;this.vResize=null;
    this.suppressUntil=0; this.actorId=null; this.lastPoint=null;
    this.rows=3; this.pages={equipment:0,features:0,spells:0}; this.layout={}; this.curation={};
    this._layoutSig=null; this._relayoutTimer=null; this._tipTimer=null; this._tipHideTimer=null;
    this._tipBtn=null; this.tipItem=null; this._scrollFrame=null; this._tipLocked=false;
    this.el=document.createElement('section'); this.el.id='dsh-bg3-hud'; this.el.hidden=true;
    this.el.setAttribute('aria-label','战斗技能栏'); document.body.appendChild(this.el);
    this.tip=document.createElement('aside');this.tip.id='dsh-bg3-tooltip';this.tip.hidden=true;document.body.appendChild(this.tip);
    this.badges=document.createElement('div');this.badges.id='dsh-bg3-target-badges';document.body.appendChild(this.badges);
    this.install();this.bind();
  }

  install() {
    const p=this.panel;
    const oldList=p._activityList.bind(p);
    p._activityList=item=>{const all=oldList(item),ids=item?.flags?.['chris-premades']?.activityIdentifiers??{},hidden=item?.flags?.['chris-premades']?.hiddenActivities??[];return all.filter(a=>!hidden.some(k=>ids[k]===a.id)&&!a.midiProperties?.automationOnly);};
    const oldPosition=p._syncPosition.bind(p);p._syncPosition=()=>{oldPosition();this.syncTargets();};
    Hooks.on('canvasTearDown',()=>{if(!this.busy)this.cancel();this.badges.replaceChildren();});
    Hooks.on('deleteToken',doc=>{if(!this.busy&&this.selection?.targets?.includes(doc.id)){this.selection.targets=this.selection.targets.filter(id=>id!==doc.id);this.renderChoice();this.syncTargets();}});
    const oldCancel=p._cancelDrag.bind(p);
    this.clearVisuals=()=>{this.area?.destroy();this.area=null;this._areaGeneration=(this._areaGeneration||0)+1;this.badges.replaceChildren();oldCancel();};
    Hooks.on(PREDICTION_POLICY_HOOK,()=>{this._areaGeneration++;p._invalidatePreview();p._hideTargetOverlay();if(p.$hit){p.$hit.textContent='';p.$hit.removeAttribute('title');p.$hit.removeAttribute('aria-label');}this._areaPredictionKey=null;this.badges.replaceChildren();});
    p._cancelDrag=()=>{this.cancel();};
    p._renderMenu=()=>this.render();
    p._onPointerDown=()=>{};p._onPointerUp=()=>{};
    p._onPointerMove=ev=>this.move(ev);
    const hide=p._hideAll.bind(p);p._hideAll=()=>{hide();this.tip.hidden=true;if(this.busy){this.position();return;}this.el.hidden=true;this.position();};
    const show=p._showAll.bind(p);p._showAll=()=>{show();this.el.hidden=false;this.position();};
    const sync=p._syncDragVisuals.bind(p);
    p._syncDragVisuals=()=>{if(p._drag?.hudHidden)return;sync();};
    const refresh=p.refresh.bind(p);p.refresh=()=>{refresh();if(this.actorId!==p.actor?.uuid){this.cancel(false);this.actorId=p.actor?.uuid;this.filterLevel=null;this.filterActivation=null;this.pages={equipment:0,features:0,spells:0};this.layout={};this.curation={};if(this.resizing){this.resizing=null;this.el.classList.remove('resizing');}}};
    const create=()=>{if(p.actor){p.refresh();}};
    const invalidateCuration=item=>{if(!item?.parent||item.parent.uuid===this.actorId||item.parent===p.actor)this.curation={};};
    Hooks.on('createItem',item=>{create();invalidateCuration(item);});
    Hooks.on('updateItem',invalidateCuration);
    Hooks.on('updateActor',actor=>{if(actor?.id===p.actor?.id)delete this.curation.spells;});
    Hooks.on('deleteItem',invalidateCuration);
    Hooks.on('dnd5e.restCompleted',create);
    this.position();
    new ResizeObserver(()=>this.position()).observe(document.body);
    const sidebar=document.getElementById('sidebar');if(sidebar)new ResizeObserver(()=>this.position()).observe(sidebar);
    new ResizeObserver(()=>this.position()).observe(this.el);
    window.addEventListener('resize',()=>this.position());
  }

  bind() {
    this.el.addEventListener('error',ev=>{const img=ev.target;if(img.tagName!=='IMG')return;const replacement=img.classList.contains('bg3-token-image')?'icons/svg/mystery-man.svg':fallback;if(!img.src.endsWith(replacement))img.src=replacement;},true);
    this.el.addEventListener('click',ev=>{ev.stopPropagation();void this.click(ev).catch(err=>this.error(err));});
    this.el.addEventListener('pointerover',ev=>this.tooltip(ev));
    this.el.addEventListener('pointerleave',()=>this.hideTip(200));
    this.el.addEventListener('scroll',ev=>{const grid=ev.target?.closest?.('.bg3-grid');if(grid)this.onGridScroll(grid);},true);
    this.tip.addEventListener('pointerenter',()=>{clearTimeout(this._tipHideTimer);});
    this.tip.addEventListener('pointerleave',()=>this.hideTip(120));
    this.tip.addEventListener('click',ev=>{const b=ev.target.closest('[data-tip-sheet]');if(b){ev.preventDefault();this.tipItem?.sheet?.render(true);}});
    this.el.addEventListener('pointerdown',ev=>{this.beginResize(ev);ev.stopPropagation();});
    this.el.addEventListener('pointermove',ev=>{if(this.vResize&&this.vResize.pointer===ev.pointerId){ev.preventDefault();ev.stopPropagation();this.moveVResize(ev);return;}const d=this.resizing;if(!d||d.pointer!==ev.pointerId)return;ev.preventDefault();ev.stopPropagation();d.next=this.resizeBy(d.widths,d.index,ev.clientX-d.x);});
    this.el.addEventListener('pointerup',ev=>{if(this.vResize)this.endVResize(ev);else this.endResize(ev);});
    this.el.addEventListener('pointercancel',ev=>{if(this.vResize)this.endVResize(ev,true);else this.endResize(ev,true);});
    this.el.addEventListener('lostpointercapture',ev=>{if(this.vResize)this.endVResize(ev,true);else this.endResize(ev,true);});
    this.el.addEventListener('error',ev=>{const img=ev.target;if(img.tagName!=='IMG')return;const replacement=img.classList.contains('bg3-token-image')?'icons/svg/mystery-man.svg':fallback;if(!img.src.endsWith(replacement)){img.dataset.hudFailedSrc=img.getAttribute('src');img.src=replacement;}},true);
    this.el.addEventListener('dblclick',ev=>{if(ev.target.closest('[data-hud-height]')&&!this.busy){ev.preventDefault();void this.savePreference(this.storeActor(),'rows',null).catch(()=>{});return;}if(ev.target.closest('[data-hud-divider]')&&!this.busy){ev.preventDefault();void this.savePreference(this.storeActor(),'ratios',[...DEFAULT_RATIOS]).catch(()=>{});this.render();}});
    this.el.addEventListener('contextmenu',ev=>{
      const badge=ev.target.closest('[data-hud-class]'),slot=ev.target.closest('[data-hud-weapon]');
      if(!badge&&!slot)return;
      ev.preventDefault();ev.stopPropagation();
      if(badge){this.editClassIcon();return;}
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
      if(ev.target.closest('[data-hud-height]')&&!this.busy&&(ev.key==='ArrowUp'||ev.key==='ArrowDown')){ev.preventDefault();ev.stopPropagation();void this.nudgeRows(ev.key==='ArrowUp'?1:-1).catch(()=>{});return;}
      const handle=ev.target.closest('[data-hud-divider]');if(!handle||this.busy||!['ArrowLeft','ArrowRight'].includes(ev.key))return;
      ev.preventDefault();ev.stopPropagation();const index=Number(handle.dataset.hudDivider),widths=[...this.el.querySelectorAll('.bg3-zone')].map(z=>z.getBoundingClientRect().width);
      const next=this.resizeBy(widths,index,ev.key==='ArrowLeft'?-10:10);void this.savePreference(this.storeActor(),'ratios',next).catch(()=>{});
    });
    document.addEventListener('wheel',ev=>{if(!this.area||this.busy||!this.onCanvas(ev))return;ev.preventDefault();ev.stopImmediatePropagation();this.area.rotate(ev);this.syncAreaTargets();},{capture:true,passive:false});
    document.addEventListener('pointerdown',ev=>{
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
      if(ev.key!=='Escape')return;
      if(this.busy&&this._activeSeq){
        if(this.aborting)return;
        ev.preventDefault();ev.stopImmediatePropagation();void this.abortActive().catch(err=>this.error(err));return;
      }
      if(!this.busy&&(this.selection||this.page!=='list')){ev.preventDefault();ev.stopImmediatePropagation();this.cancel();}
    },true);
  }

  onCanvas(ev) { return ev.target===canvas.app?.view || ev.target===canvas.app?.canvas || ev.target?.tagName==='CANVAS'; }

  position() {
    const sidebar=document.getElementById('sidebar'); const r=sidebar?.getBoundingClientRect();
    // Keep clear of the native sidebar rail even when it is collapsed; otherwise the
    // right-end buttons sit on top of the native chat/roll controls.
    const right=r && r.width>0 && r.left>innerWidth*.45 ? Math.max(14,Math.round(innerWidth-r.left+12)) : 14;
    this.el.style.right=`${right}px`;
    if(!this.vResize)this.applyRows();
    document.body.classList.toggle('dsh-bg3-active',!this.el.hidden);
    this.positionChrome();
    const sig=`${this.rows}|${this.el.clientWidth}|${this.el.clientHeight}|${this.actorId}`;
    if(this._layoutSig&&this._layoutSig!==sig&&this.panel.actor&&!this.el.hidden)this.scheduleRelayout();
    this._layoutSig=sig;
  }

  scheduleRelayout() {
    if(this._relayoutTimer)return;
    this._relayoutTimer=setTimeout(()=>{this._relayoutTimer=null;this.relayout();},80);
  }

  relayout() {
    if(this.page!=='list'||!this.panel.actor)return;
    for(const group of GROUPS)this.measureLayout(group);
    this.renderNav();
  }

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

  openSettings() {
    const dialog=document.createElement('dialog');dialog.className='bg3-free-dialog bg3-settings-dialog';
    dialog.innerHTML=`<form><h2>栏位设置</h2><p>选择要编辑的栏位，可勾选显示内容并用 ↑ ↓ 调整顺序。</p><div class="bg3-settings-groups"><button type="button" data-settings-group="equipment">装备</button><button type="button" data-settings-group="features">特性</button><button type="button" data-settings-group="spells">法术</button></div><footer><button type="button" data-no>关闭</button></footer></form>`;
    const fieldset=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent='瞄准预测';fieldset.appendChild(legend);
    const rows=game.user.isGM?[['predictionProbability','概率可见性'],['predictionDamage','基础均伤可见性']]:[['hidePredictionProbability','在本机隐藏概率'],['hidePredictionDamage','在本机隐藏基础均伤']];
    for(const [key,label]of rows){const row=document.createElement('label');row.style.display='block';row.style.margin='8px 0';row.append(label+' ');const control=document.createElement(game.user.isGM?'select':'input');if(game.user.isGM){for(const [value,text]of Object.entries(PREDICTION_MODE_LABELS)){const option=document.createElement('option');option.value=value;option.textContent=text;control.append(option);}control.value=game.settings.get(ID,key);}else{control.type='checkbox';control.checked=game.settings.get(ID,key);}control.addEventListener('change',()=>{const value=game.user.isGM?control.value:control.checked;void game.settings.set(ID,key,value).catch(err=>{if(game.user.isGM)control.value=game.settings.get(ID,key);else control.checked=game.settings.get(ID,key);this.error(err);});});row.append(control);fieldset.appendChild(row);}
    const note=document.createElement('small');note.textContent='基础均伤不计命中、豁免和目标减伤。玩家只能隐藏 DM 已开放的预测。';fieldset.appendChild(note);dialog.querySelector('footer').before(fieldset);
    document.body.appendChild(dialog);dialog.addEventListener('close',()=>dialog.remove());
    dialog.querySelector('[data-no]').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',ev=>{
      const b=ev.target.closest('[data-settings-group]');if(!b)return;
      dialog.close();this.manageItems(b.dataset.settingsGroup);
    });
    dialog.showModal();
  }

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

  editClassIcon() {
    if(!game.user.isGM)return;
    const actor=this.storeActor(),info=classInfo(this.panel.actor,actor?.getFlag?.(ID,'classIcon'));
    if(!actor)return;
    const dialog=document.createElement('dialog');dialog.className='bg3-free-dialog';
    dialog.innerHTML=`<form><h2>职业图标</h2><p>${info?`当前职业：${esc(info.name)}（${info.level} 级）。`:'当前角色没有职业物品。'}留空则使用职业物品自带的图标。</p><label>图标路径<input name="path" value="${esc(actor.getFlag(ID,'classIcon')||'')}" placeholder="icons/svg/mystery-man.svg"></label><div class="bg3-form-row"><button type="button" data-browse>浏览…</button><button type="button" data-reset>恢复默认</button></div><footer><button type="button" data-no>取消</button><button type="submit">保存</button></footer></form>`;
    document.body.appendChild(dialog);dialog.addEventListener('close',()=>dialog.remove());
    const form=dialog.querySelector('form'),input=form.elements.path;
    dialog.querySelector('[data-no]').addEventListener('click',()=>dialog.close());
    dialog.querySelector('[data-reset]').addEventListener('click',()=>{input.value='';});
    dialog.querySelector('[data-browse]').addEventListener('click',()=>{
      const Picker=foundry.applications?.apps?.FilePicker?.implementation??globalThis.FilePicker;
      if(!Picker)return this.error(Error('当前环境没有文件选择器'));
      const picker=new Picker({type:'image',current:input.value.trim()||undefined,callback:path=>{input.value=path;}});
      picker.browse();
    });
    form.addEventListener('submit',async ev=>{
      ev.preventDefault();const value=input.value.trim();
      try{
        await actor.update(value?{[`flags.${ID}.classIcon`]:value}:{[`flags.${ID}.-=classIcon`]:null});
        dialog.close();
      }catch(err){this.error(err);}
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
    return list(this.panel.actor?.items).filter(i=>!i.flags?.[ID]?.freeCast&&this.groupOf(i)===group)
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
    if(this.resizing||this.vResize)return;
    const focusedDivider=document.activeElement?.dataset?.hudDivider;
    const a=this.panel.actor;if(!a){this.el.hidden=true;this.position();return;}
    this.el.hidden=false;this.el.setAttribute('aria-busy',String(this.busy));
    this.applyRows();
    this.hideTip(0);
    const hp=a.system.attributes?.hp??{},ac=a.system.attributes?.ac?.value??'—';
    const current=Number(hp.value)||0,max=Number(hp.max)||0,temp=Math.max(0,Number(hp.temp)||0),total=max+temp;
    const percent=total>0?Math.max(0,Math.min(100,current/total*100)):0,tempPercent=total>0?Math.min(100-percent,temp/total*100):0;
    const resource=this.panel._resources(a),combat=game.combat?.started;
    const chosen=a.items.get(this.selection?.itemId);this.region=this.groupOf(chosen??{})??'equipment';
    const token=this.panel.token?.document,src=token?.texture?.src||a.prototypeToken?.texture?.src||'icons/svg/mystery-man.svg';
    const name=token?.name||a.name;
    const portrait=/\.(webm|mp4|m4v)(?:[?#]|$)/i.test(src)?`<video class="bg3-token-image" src="${esc(src)}" autoplay loop muted playsinline aria-label="${esc(name)}"></video>`:`<img class="bg3-token-image" src="${esc(src)}" alt="${esc(name)}">`;
    const weaponView=this.weaponState();
    const classView=classInfo(a,this.storeActor()?.getFlag?.(ID,'classIcon'));
    const topbar=topbarHTML({resource,concentration:this.panel._isConcentrating(a),filterActivation:this.filterActivation,filterLevel:this.filterLevel,busy:this.busy,slots:this.slotData()});
    const slotMarkup=weaponView.items.map((weapon,index)=>{const wp=weapon?nameParts(weapon.name):null;return `<div class="bg3-weapon-cell"><button type="button" class="bg3-weapon-slot ${weapon?'':'empty'}" data-hud-weapon="${index}" title="${weapon?`${esc(weapon.name)} · 点击普通攻击，右键移除`:'空武器槽 · 把武器拖到这里'}" aria-label="${weapon?esc(weapon.name):`空武器槽 ${index+1}`}" ${this.busy?'disabled':''}>${weapon?`<img src="${esc(weapon.img||fallback)}" alt="">`:'<span>＋</span>'}</button><span class="bg3-weapon-name" title="${weapon?esc(weapon.name):''}">${weapon?esc(wp?.short??weapon.name):'空'}</span></div>`;}).join('');
    const classMarkup=classView?`<button type="button" class="bg3-class-badge" data-hud-class title="${esc(classView.name)} ${classView.level} 级${game.user.isGM?' · 右键更换图标':''}" aria-label="职业：${esc(classView.name)}"><img src="${esc(classView.img)}" alt=""></button>`:'';
    patchHTML(this.el,`<div class="bg3-portrait"><div class="bg3-portrait-ring">${portrait}</div><div class="bg3-vitals"><span class="bg3-ac" title="护甲等级">AC <b>${esc(ac)}</b></span><span class="bg3-hp" title="生命值 ${current}/${max}${temp?'，临时生命 '+temp:''}"><i style="width:${percent}%"></i>${temp?`<i class="temp" style="left:${percent}%;width:${tempPercent}%"></i>`:''}<b>${current}/${max}${temp?` <em>+${temp}</em>`:''}</b></span></div><span class="bg3-character" title="${esc(name)}">${esc(name)}</span>${classMarkup}</div>
      <div class="bg3-weapons" aria-label="武器槽">${slotMarkup}</div>
      <div class="bg3-center">${topbar}
      <div class="bg3-nav" data-hud-nav role="toolbar" aria-label="筛选与滚动"></div>
      <div class="bg3-zones" style="grid-template-columns:${this.preferences().ratios.map(v=>`minmax(0,${v}fr)`).join(' ')}">${GROUPS.map(k=>`<section class="bg3-zone zone-${k}${k==='equipment'&&this.otherAttackRows().length?' has-attacks':''}" aria-label="${GROUP_LABEL[k]}"><div class="bg3-deck ${this.page!=='list'&&this.region===k?'flipped':''}" data-hud-zone="${k}" ${this.region===k?'data-hud-deck':''}></div>${k==='equipment'?'<div class="bg3-other-attacks" data-hud-attacks hidden></div>':''}</section>`).join('')}
      <div class="bg3-height-grip" data-hud-height role="separator" aria-orientation="horizontal" tabindex="0" aria-label="HUD 高度" aria-valuenow="${this.rows}" aria-valuemin="1" aria-valuemax="${MAX_ROWS}" title="上下拖动调整 HUD 行数；↑/↓ 微调；双击恢复自动"></div>${[0,1].map(n=>`<div class="bg3-divider" data-hud-divider="${n}" role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整${n===0?'装备与特性':'特性与法术'}宽度" title="拖动调整宽度；方向键微调，双击恢复默认比例"><i>⋮</i></div>`).join('')}</div></div>
      <aside class="bg3-end"><button type="button" class="bg3-sheet" data-hud-sheet title="打开角色卡" aria-label="打开角色卡">♙ <span>角色卡</span></button><button type="button" class="bg3-turn-circle" ${combat?'data-hud-end':'data-hud-rest="short"'} aria-label="${combat?'结束回合':'短休'}" ${this.busy?'disabled':''}><b>${combat?'⌛':'☾'}</b><span>${combat?'结束回合':'短休'}</span></button>${!combat?'<button type="button" class="bg3-long-rest" data-hud-rest="long" title="长休">☾<small>长休</small></button>':''}<button type="button" class="bg3-settings" data-hud-settings title="编辑栏位与顺序" aria-label="编辑栏位与顺序" ${this.busy?'disabled':''}>⚙</button></aside><div class="bg3-height-tip" data-hud-height-tip hidden aria-hidden="true"></div>`,{shell:true});
    this.renderGrid();this.renderOtherAttacks();this.renderNav();if(this.page!=='list')this.renderChoice();
    this.position();
    if(focusedDivider!==undefined)this.el.querySelector(`[data-hud-divider="${focusedDivider}"]`)?.focus({preventScroll:true});
  }

  renderGrid() {
    for(const group of GROUPS){
      if(this.page!=='list'&&this.region===group)continue;
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
      }).join('')||emptyHTML({filtered})}</div>`);
      this.measureLayout(group);
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
    const zone=box.closest('.bg3-zone');
    const rows=this.otherAttackRows();
    // Keep this separate equipment strip present while any deck is flipped.
    const show=rows.length>0;
    box.hidden=!show;zone?.classList.toggle('has-attacks',show);
    if(!show){box.replaceChildren();return;}
    patchHTML(box,`<span class="bg3-other-title">其他攻击</span><div class="bg3-other-list">${rows.map(({item,activity})=>`<button type="button" class="bg3-other-attack" data-hud-other-attack="${esc(item.id)}|${esc(activity.id)}" ${this.busy?'disabled':''} title="${esc(item.name)} · ${esc(activity.name)}"><img src="${esc(item.img||fallback)}" alt=""><span>${esc(shortName(activity.name))}</span></button>`).join('')}</div>`);
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
    this.rows=normalizeRows(this.preferences().rows,globalThis.innerHeight||900,rowHeight,rowGap);
    this.el.style.setProperty('--bg3-rows',String(this.rows));
    this.el.querySelector('[data-hud-height]')?.setAttribute('aria-valuenow',String(this.rows));
    return this.rows;
  }

  showHeightTip(text,ev) {
    const tip=this.el.querySelector('[data-hud-height-tip]');if(!tip)return;
    const r=this.el.getBoundingClientRect();
    const x=ev?ev.clientX:r.left+r.width/2,y=ev?ev.clientY:r.top;
    tip.textContent=text;tip.hidden=false;
    tip.style.left=`${Math.round(x)}px`;tip.style.top=`${Math.round(Math.max(26,y-26))}px`;
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
    const limit=maxRowsFor(globalThis.innerHeight||900,drag.rowHeight,drag.rowGap);
    const next=Math.min(limit,Math.max(1,drag.startRows+Math.round((drag.y-ev.clientY)/drag.stride)));
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
    const next=Math.min(maxRowsFor(globalThis.innerHeight||900,rowHeight,rowGap),Math.max(1,this.rows+delta));
    if(next===this.rows)return Promise.resolve();
    this.rows=next;
    this.el.style.setProperty('--bg3-rows',String(next));
    this.el.querySelector('[data-hud-height]')?.setAttribute('aria-valuenow',String(next));
    this.scheduleRelayout();
    return this.savePreference(this.storeActor(),'rows',next);
  }

  positionChrome() {
    const center=this.el.querySelector('.bg3-center'),zonesEl=this.el.querySelector('.bg3-zones'),zones=[...this.el.querySelectorAll('.bg3-zone')];
    if(!center||!zonesEl||zones.length!==3)return;
    const c=center.getBoundingClientRect(),zr=zonesEl.getBoundingClientRect(),r=zones.map(z=>z.getBoundingClientRect());
    const dividerWidth=parseFloat(getComputedStyle(this.el).getPropertyValue('--bg3-divider-w'))||42;
    this.el.querySelectorAll('[data-hud-divider]').forEach((el,n)=>{el.style.left=`${(r[n].right+r[n+1].left)/2-zr.left-dividerWidth/2}px`;el.setAttribute('aria-valuenow',String(Math.round(100*r[n].width/(r[n].width+r[n+1].width))));el.setAttribute('aria-valuemin','1');el.setAttribute('aria-valuemax','99');});
  }

  beginResize(ev) {
    if(ev.target.closest('[data-hud-height]')){this.beginVResize(ev);return;}
    const handle=ev.target.closest('[data-hud-divider]');if(!handle||this.busy||ev.button!==0)return;
    ev.preventDefault();ev.stopPropagation();this.cancel();
    const widths=[...this.el.querySelectorAll('.bg3-zone')].map(z=>z.getBoundingClientRect().width);
    this.resizing={index:Number(handle.dataset.hudDivider),x:ev.clientX,widths,actor:this.storeActor(),pointer:ev.pointerId};
    this.el.setPointerCapture(ev.pointerId);this.el.classList.add('resizing');
  }

  resizeBy(widths,index,dx) {
    const pair=widths[index]+widths[index+1],minimum=Math.min(72,pair/3);
    const left=Math.max(minimum,Math.min(pair-minimum,widths[index]+dx)),next=[...widths];
    next[index]=left;next[index+1]=pair-left;
    this.el.querySelector('.bg3-zones').style.gridTemplateColumns=next.map(v=>`minmax(0,${v}fr)`).join(' ');
    this.positionChrome();return next;
  }

  endResize(ev,cancelled=false) {
    const drag=this.resizing;if(!drag||drag.pointer!==ev.pointerId)return;
    const widths=drag.next??drag.widths, moved=!!drag.next&&drag.next.some((v,i)=>Math.abs(v-drag.widths[i])>1);
    this.resizing=null;this.el.classList.remove('resizing');
    if(this.el.hasPointerCapture(ev.pointerId))this.el.releasePointerCapture(ev.pointerId);
    if(!cancelled&&moved&&this.storeActor()?.uuid===drag.actor.uuid)void this.savePreference(drag.actor,'ratios',widths.map(v=>Math.round(v*100)/100)).catch(()=>{});
    this.render();
  }

  manageItems(group) {
    this.cancel();const actor=this.storeActor(),all=this.catalog(group),selected=this.items(group,false).map(i=>i.id),lookup=new Map(all.map(i=>[i.id,i]));
    const ordered=[...selected,...all.map(i=>i.id).filter(id=>!selected.includes(id))];
    const curated=new Set(this.curatedFor(group).map(i=>i.id));
    let automatic=!Array.isArray(this.preferences()[group]);
    const title=GROUP_LABEL[group];
    const dialog=document.createElement('dialog');dialog.className='bg3-free-dialog bg3-items-dialog';
    dialog.innerHTML=`<form><h2>编辑${title}栏位</h2><p>勾选要显示的内容，用 ↑ ↓ 调整顺序。只修改快捷栏，不删除角色物品。未勾选的被动/说明条目仍会出现在本编辑器的清单中。${group==='spells'?'默认隐藏未准备或无可用环位上限的法术；在此勾选即可手动启用。环位耗尽不会改变默认显示。':''}</p><div class="bg3-editor-tools"><input type="search" data-editor-search aria-label="搜索可选内容" placeholder="搜索角色已有内容…"><button type="button" data-editor-all>全选</button><button type="button" data-editor-none>清空</button><button type="button" data-editor-auto>恢复默认推荐</button></div><ul data-editor-list>${ordered.map(id=>{const i=lookup.get(id),decision=this.curationDecision(i,group);const why=!selected.includes(id)&&decision&&decision.include===false?String(decision.label||'非战斗内容'):'';return `<li data-editor-row="${esc(id)}" data-curated="${curated.has(id)?'1':'0'}"><label><input type="checkbox" value="${esc(id)}" ${selected.includes(id)?'checked':''}><img src="${esc(i.img||fallback)}" alt=""><span>${esc(i.name)}</span>${why?`<small class="bg3-editor-why" title="${esc(why)}">${esc(why)}</small>`:group==='spells'?`<small>${Number(i.system.level)===0?'戏法':i.system.level+'环'}</small>`:''}</label><button type="button" data-editor-up aria-label="上移 ${esc(i.name)}">↑</button><button type="button" data-editor-down aria-label="下移 ${esc(i.name)}">↓</button></li>`;}).join('')||'<p>此角色暂无对应内容</p>'}</ul><p data-editor-count></p><footer><button type="button" data-editor-cancel>取消</button><button type="submit">保存栏位</button></footer></form>`;
    dialog.addEventListener('error',ev=>{const img=ev.target;if(img.tagName==='IMG'&&!img.src.endsWith(fallback))img.src=fallback;},true);document.body.appendChild(dialog);
    const rows=()=>[...dialog.querySelectorAll('[data-editor-row]')],count=()=>{dialog.querySelector('[data-editor-count]').textContent=`已选择 ${rows().filter(r=>r.querySelector('input').checked).length} / 全部 ${all.length} 件${automatic?' · 默认推荐（新增物品按分类自动收录）':''}`;};
    dialog.addEventListener('change',()=>{automatic=false;count();});
    dialog.querySelector('[data-editor-search]').addEventListener('input',ev=>{const q=ev.target.value.trim().toLocaleLowerCase();rows().forEach(r=>{const item=lookup.get(r.dataset.editorRow);r.hidden=!`${item?.name??''} ${nameParts(item?.name??'').short}`.toLocaleLowerCase().includes(q);});});
    dialog.addEventListener('click',ev=>{
      const b=ev.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-editor-cancel')){dialog.close();return;}
      if(b.hasAttribute('data-editor-up')||b.hasAttribute('data-editor-down')){
        const row=b.closest('li'),up=b.hasAttribute('data-editor-up'),sibling=up?row.previousElementSibling:row.nextElementSibling;
        if(sibling){if(up)row.parentElement.insertBefore(row,sibling);else row.parentElement.insertBefore(sibling,row);automatic=false;count();}return;
      }
      if(b.hasAttribute('data-editor-all')||b.hasAttribute('data-editor-none')||b.hasAttribute('data-editor-auto')){
        automatic=b.hasAttribute('data-editor-auto');
        rows().forEach(r=>{
          const input=r.querySelector('input');
          if(b.hasAttribute('data-editor-none'))input.checked=false;
          else if(b.hasAttribute('data-editor-auto'))input.checked=r.dataset.curated==='1';
          else input.checked=true;
        });count();
      }
    });
    dialog.querySelector('form').addEventListener('submit',ev=>{
      ev.preventDefault();const ids=rows().filter(r=>r.querySelector('input').checked).map(r=>r.dataset.editorRow);
      void this.savePreference(actor,group,automatic?null:ids).catch(()=>{});dialog.close();this.render();
    });
    dialog.addEventListener('close',()=>dialog.remove());count();dialog.showModal();
  }


  headButton(backLabel='返回') {
    if(this.busy&&this._activeSeq)return `<button type="button" class="bg3-abort" data-hud-abort ${this.aborting?'disabled':''} title="中止当前施法并立即恢复 HUD">${this.aborting?'正在取消…':'取消结算'}</button>`;
    return `<button type="button" data-hud-back ${this.busy?'disabled':''}>‹ ${backLabel}</button>`;
  }

  renderChoice() {
    const s=this.selection,deck=this.el.querySelector('[data-hud-deck]');if(!s||!deck)return;
    const item=this.panel.actor.items.get(s.itemId);if(!item){this.cancel();return;}
    const acts=this.panel._activityList(item);const act=acts.find(a=>a.id===s.activityId);
    if(s.plan&&s.option){
      const count=s.targets.length,max=s.plan.max;
      patchHTML(deck,`<div class="bg3-choice-title">${this.headButton('取消')}<b>${esc(item.name)}</b><span>${s.option.level} 环</span></div><div class="bg3-target-choice"><strong>${this.busy?'正在结算':s.plan.repeat?'分配射线':'选择目标'} <b>${count} / ${max}</b></strong><small>${s.plan.repeat?'每次点击分配一条射线，可重复选择同一目标':'每个目标只能选择一次'}</small><div class="bg3-target-buttons"><button type="button" data-hud-undo ${!count||this.busy?'disabled':''}>撤回上一次</button>${!s.plan.repeat?`<button type="button" class="bg3-cast-now" data-hud-cast ${!count||this.busy?'disabled':''}>施放（${count} / ${max}）</button>`:''}</div></div>`);
      return;
    }
    let cards='';
    if(this.page==='modes')cards=acts.map(a=>`<button type="button" class="bg3-slot" data-hud-mode="${esc(a.id)}"><img src="${esc(a.img||item.img||fallback)}" alt=""><b>${esc(a.name)}</b><small>${esc(actions[a.activation?.type]||a.activation?.type||a.type)}</small></button>`).join('');
    else cards=spellOptions(this.panel.actor,item,act).map(o=>{
      if(item.type==='feat'&&o.kind==='native')return `<button type="button" class="bg3-slot ${s.option?.key===o.key?'selected':''}" data-hud-option="native" ${this.busy?'disabled':''} aria-label="正常使用：按特性原有消耗"><img src="${esc(item.img||fallback)}" alt=""><b>正常使用</b><small>按特性原有消耗</small></button>`;
      const isFree=o.kind==='free'||o.kind==='item',title=o.kind==='free'?(item.type==='spell'?'免费施法':'免费次数'):o.kind==='item'?'免费次数':o.label,detail=o.kind==='free'?esc(o.label)+' · ':o.kind==='item'?esc(o.label)+' · ':'';const card=`<button type="button" class="bg3-slot ${isFree?'free':''} ${s.option?.key===o.key?'selected':''}" data-hud-option="${esc(o.key)}" ${o.value<1||this.busy?'disabled':''} aria-label="${esc(title)} ${o.value}/${o.max}"><span class="bg3-slot-emblem"><img src="${esc(item.img||fallback)}" alt=""><strong>${isFree?'✧':roman(o.level)}</strong></span><b>${esc(title)}</b><span class="bg3-pips">${Array.from({length:Math.min(9,o.max)},(_,n)=>`<i class="${n<o.value?'filled':''}"></i>`).join('')}</span><small>${detail}${o.value} / ${o.max}${isFree?' · '+esc(periods[o.period]||'手动恢复'):''}</small></button>`;
      if(o.kind!=='free')return card;
      return `<div class="bg3-free-option">${card}<button type="button" class="bg3-free-delete" data-hud-delete-free="${esc(o.key)}" title="删除免费施法来源：${esc(o.label)}" aria-label="删除免费施法来源：${esc(o.label)}" ${this.busy?'disabled':''}>×</button></div>`;
    }).join('');
    if(canManageFree(item,acts)&&this.page!=='modes')cards+=`<button type="button" class="bg3-slot bg3-custom" data-hud-manage ${this.busy?'disabled':''}><span>＋</span><b>${item.type==='spell'?'免费施法':'免费次数'}</b><small>管理来源与次数</small></button>`;
    patchHTML(deck,`<div class="bg3-choice-title">${this.headButton('返回')}<b>${esc(item.name)}</b><span>${this.page==='modes'?'选择使用方式':s.option?'已选择 · '+esc(s.option.kind==='free'?s.option.label:s.option.label):item.type==='spell'?'选择施放环位':'选择使用方式'}</span></div><div class="bg3-slots">${cards||'<span class="bg3-empty">没有可用方式</span>'}</div>`);
  }

  async click(ev) {
    const b=ev.target.closest('button');if(!b||b.disabled)return;
    if(b.hasAttribute('data-hud-sheet')){this.panel.actor?.sheet?.render(true);return;}
    if(b.hasAttribute('data-hud-abort')){await this.abortActive();return;}
    if(b.hasAttribute('data-hud-filter-act')){this.toggleActivation(b.dataset.hudFilterAct);return;}
    if(b.dataset.hudPage){const [group,direction]=b.dataset.hudPage.split('|');this.scrollGrid(group,Number(direction)||1);return;}
    if(b.hasAttribute('data-hud-clear-filter')){this.filterActivation=null;this.filterLevel=null;this.resetPages();this.render();return;}
    if(b.hasAttribute('data-hud-weapon')){this.activateWeapon(Number(b.dataset.hudWeapon));return;}
    if(b.dataset.hudOtherAttack){const [itemId,activityId]=b.dataset.hudOtherAttack.split('|');this.openAttack(itemId,activityId);return;}
    if(b.hasAttribute('data-hud-class')){const view=classInfo(this.panel.actor,this.storeActor()?.getFlag?.(ID,'classIcon'));if(view)this.panel.actor.items.get(view.id)?.sheet?.render(true);return;}
    if(b.hasAttribute('data-hud-settings')){this.openSettings();return;}
    if(this.busy)return;
    if(b.dataset.hudEdit){this.manageItems(b.dataset.hudEdit);return;}
    if(b.hasAttribute('data-hud-filter')){const n=Number(b.dataset.hudFilter);this.cancel(false);this.filterActivation=null;this.filterLevel=this.filterLevel===n?null:n;this.resetPages();this.render();return;}
    if(b.hasAttribute('data-hud-cast')){await this.commitSelection();return;}
    if(b.hasAttribute('data-hud-undo')){this.selection?.targets?.pop();this.renderChoice();this.syncTargets();return;}
    if(b.hasAttribute('data-hud-back')){this.cancel();return;}
    if(b.hasAttribute('data-hud-end')){await this.panel._endTurn();this.render();return;}
    if(b.dataset.hudRest){await this.panel._rest(b.dataset.hudRest);return;}
    if(b.dataset.hudDeleteFree){await this.deleteFreeSource(b.dataset.hudDeleteFree);return;}
    if(b.hasAttribute('data-hud-manage')){this.manageFree();return;}
    if(b.dataset.hudItem){
      this.cancel(false);const item=this.panel.actor.items.get(b.dataset.hudItem);const acts=this.panel._activityList(item);
      if(!acts.length){item.sheet?.render(true);this.render();return;}this.selection={actorUuid:this.panel.actor.uuid,itemId:item.id,activityId:acts.length===1?acts[0].id:null,option:null};
      if(acts.length>1){this.page='modes';this.render();return;}
      this.chooseActivity(acts[0]);return;
    }
    if(b.dataset.hudMode){const item=this.panel.actor.items.get(this.selection.itemId);this.chooseActivity(this.panel._activityList(item).find(a=>a.id===b.dataset.hudMode));return;}
    if(b.dataset.hudOption){
      const item=this.panel.actor.items.get(this.selection.itemId),act=this.panel._activityList(item).find(a=>a.id===this.selection.activityId);
      const option=spellOptions(this.panel.actor,item,act).find(o=>o.key===b.dataset.hudOption);if(!option||option.value<1)return;
      this.selection.option=option;this.arm();
    }
  }

  chooseActivity(act) {
    if(!act)return;this.selection.activityId=act.id;this.page='slots';
    if(act.item.type==='feat'){this.render();return;}
    if(act.item.type==='spell'&&act.consumption?.spellSlot===false){this.selection.option={key:'native',kind:'native',level:Number(act.item.system.level)||0};this.arm();return;}
    if(act.item.type==='spell'&&(Number(act.item.system.level)>0||spellOptions(this.panel.actor,act.item,act).some(o=>o.kind==='free'))){this.render();return;}
    this.selection.option={key:'native',kind:'native',level:Number(act.item.system.level)||0};this.arm();
  }

  arm() {
    this.clearVisuals();const s=this.selection;if(!s)return;
    const item=this.panel.actor.items.get(s.itemId);const act=this.panel._activityList(item).find(a=>a.id===s.activityId);
    const delta=Math.max(0,(s.option?.level||0)-(Number(item.system.level)||0));
    s.plan=targetPlan(item,act,s.option.level);s.targets=[];
    let preview=s.plan?.repeat?(s.plan.spell==='magicMissile'?missileBolt(item):rayActivity(item,act)):act;
    if(delta){const clone=item.clone({'flags.dnd5e.scaling':delta},{keepId:true});preview=clone.system.activities.get(preview.id);}
    this.panel._drag={item,activity:preview,started:true,kind:s.plan?'target':this.panel._dragKind(act),clientX:0,clientY:0,hudHidden:true,el:document.createElement('div')};
    const ring=this.panel._drag.el;ring.className='dsh-cp-drag bg3-cursor';ring.innerHTML=`<img src="${esc(item.img||fallback)}" alt=""><b>${s.option.kind==='free'?'✧':roman(s.option.level)}</b>`;ring.style.display='none';document.body.appendChild(ring);
    this._tipLocked=true;this.hideTip(0);
    if(this.panel._drag.kind==='area'){
      const area=this.area=new AreaAim(this,preview);this._areaPredictionKey=null;
      void area.start().then(()=>{if(this.area===area&&this.lastPoint)this.move(this.lastPoint);}).catch(err=>{if(this.area===area){this.cancel();this.error(err);}});
    }
    this.render();this.syncTargets();
  }

  move(ev) {
    this.lastPoint={clientX:ev.clientX,clientY:ev.clientY,target:ev.target};const drag=this.panel._drag;
    if(!drag||this.busy||!this.selection?.option)return;
    const on=this.onCanvas(ev);drag.hudHidden=!on;drag.el.style.display=on?'':'none';
    if(!on){this.area?.hide();if(this.area){this.badges.replaceChildren();this._areaPredictionKey=null;}this.panel._hideTargetOverlay();this.panel.$chain.style.display='none';drag.overlayKey=undefined;return;}
    this.panel._moveDrag(drag,ev);
    if(this.area){this.area.move(ev);let hint=drag.el.querySelector('.bg3-target-hint');if(!hint){hint=document.createElement('span');hint.className='bg3-target-hint';drag.el.appendChild(hint);}const range=this.area.rangeCheck();hint.textContent=range.allowed?'点击放置 · 滚轮旋转 · 右键取消':range.message;this.syncAreaTargets();return;}
    const t=this.panel._tokenAtClient(ev.clientX,ev.clientY),s=this.selection;
    const duplicate=s.plan&&!s.plan.repeat&&s.targets.includes(t?.id);
    let hint=drag.el.querySelector('.bg3-target-hint');if(!hint){hint=document.createElement('span');hint.className='bg3-target-hint';drag.el.appendChild(hint);}
    hint.textContent=duplicate?'已选择目标，请换一个':s.plan?`${s.targets.length} / ${s.plan.max}`:'';
    drag.el.classList.toggle('duplicate',!!duplicate);
  }

  cancel(render=true) {
    if(this.busy)return;
    this.clearVisuals();this.badges.replaceChildren();this.selection=null;this.page='list';this._tipLocked=false;this.hideTip(0);
    if(render&&this.panel.actor)this.render();
  }

  // busy 时也可以取消：中止当前 midi workflow 并立即解锁（按钮 / Esc）。
  finishAbort() {
    if(this.selection?.plan)for(const t of [...game.user.targets])t.setTarget(false,{releaseOthers:false,user:game.user});
    this.busy=false;this.aborting=false;this._activeSeq=null;this._activeUsage=null;this.activeWorkflow=null;
    this.clearVisuals();this.badges.replaceChildren();this.selection=null;this.page='list';this._tipLocked=false;
    try{this.panel.refresh();}catch(err){console.warn(`[${ID}] 取消后刷新失败`,err);}
    try{this.render();}catch(err){console.warn(`[${ID}] 取消后重绘失败`,err);}
    if(!this.panel.actor){this.el.replaceChildren();this.el.hidden=true;this.position();}
  }

  async abortActive() {
    if(!this.busy||this.aborting)return;
    const wf=this.activeWorkflow??this._activeUsage?.workflow??null;
    if(!wf||wf.aborted||wf.currentAction===wf.WorkflowState_Completed){this.finishAbort();return;}
    this.aborting=true;
    const state=Promise.resolve().then(()=>wf.performState(wf.WorkflowState_Abort));
    state.catch(()=>{});
    try{
      try{this.renderChoice();}catch(err){console.warn(`[${ID}] 取消结算界面刷新失败`,err);}
      wf.abort=true;
      await Promise.race([state,new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error('abort-timeout'),{abortTimeout:true})),2000))]);
    }catch(err){
      if(err?.abortTimeout)console.warn(`[${ID}] 工作流中止超时，已强制解锁 HUD`);
      else this.error(err);
    }finally{
      this.aborting=false;
      if(this.busy)this.finishAbort();
    }
  }

  async submit(ev) {
    const s=this.selection;if(!s?.option||this.busy)return;
    const actor=this.panel.actor;if(!actor?.isOwner||actor.uuid!==s.actorUuid){this.cancel();return;}
    const item=actor.items.get(s.itemId),act=this.panel._activityList(item).find(a=>a.id===s.activityId);
    if(!act)throw Error('技能已不存在，请重新选择');
    const kind=s.plan?'target':this.panel._dragKind(act);const target=kind==='target'?this.panel._tokenAtClient(ev.clientX,ev.clientY):null;
    if(kind==='target'&&!target){this.status('请指向一个可见目标');return;}
    if(s.option.kind!=='native'&&!spellOptions(actor,item,act).some(o=>o.key===s.option.key&&o.value>0)){this.status('所选环位或免费次数已耗尽，请重新选择');return;}
    if(s.plan){
      this.pruneTargets();
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
    const area=this.area;if(!area||!this.selection||this.panel._drag?.hudHidden)return;
    const policy=getPredictionPolicy();
    const targets=area.targets.filter(t=>t?.actor&&!t.destroyed&&t.visible&&!t.document.hidden&&!t.document.isSecret);
    const activeIds=new Set(targets.map(t=>t.id));for(const card of [...this.badges.children])if(!activeIds.has(card.dataset.tokenId))card.remove();
    const key=targets.map(t=>t.id).sort().join(',')+JSON.stringify(policy)+Math.floor(Date.now()/1000);
    // Positions update without rebuilding the prediction cards.
    for(const el of this.badges.children){const t=canvas.tokens.get(el.dataset.tokenId);if(!t)continue;const p=this.panel._screenOf(t.x+t.w/2,t.y);el.style.left=p.x+'px';el.style.top=(p.y-8)+'px';}
    if(key===this._areaPredictionKey)return;
    this._areaPredictionKey=key;const generation=++this._areaGeneration;
    const shared=policy.probability?null:await this.panel._computePreview(area.activity,null).catch(()=>null);
    const rows=await Promise.all(targets.map(async token=>({token,preview:policy.probability?await this.panel._computePreview(area.activity,token).catch(()=>null):shared})));
    if(this.area!==area||generation!==this._areaGeneration||this.panel._drag?.hudHidden)return;
    this.badges.replaceChildren();
    for(const {token,preview}of rows){
      if(token.destroyed||!token.visible||token.document.hidden||token.document.isSecret)continue;
      const card=document.createElement('div');card.className='bg3-area-target';card.dataset.tokenId=token.id;
      Object.assign(card.style,{position:'fixed',transform:'translate(-50%,-100%)',pointerEvents:'none',padding:'4px 7px',border:'1px solid #d9bb70',borderRadius:'5px',background:'#191710e8',color:'#fff',fontSize:'12px',textAlign:'center',whiteSpace:'nowrap'});
      const lines=[token.name];
      if(policy.probability&&['attack','save'].includes(area.activity.type))lines.push(`${preview?.kind==='save'?'豁免失败':'命中'} ${Number.isFinite(preview?.chance)?Math.round(preview.chance*100)+'%':'待判定'} · 估算`);
      if(policy.damage)lines.push(`基础均伤 ${Number.isFinite(preview?.damage)?Math.round(preview.damage*10)/10:area.activity.labels?.damages?.length?'待判定':'无直接伤害'}`);
      for(const text of lines){const line=document.createElement('div');line.textContent=text;card.appendChild(line);}
      const p=this.panel._screenOf(token.x+token.w/2,token.y);card.style.left=p.x+'px';card.style.top=(p.y-8)+'px';this.badges.appendChild(card);
    }
  }

  pruneTargets() {
    const s=this.selection;if(!s?.targets)return;
    s.targets=s.targets.filter(id=>{const t=canvas.tokens.get(id);return t?.actor&&!t.destroyed&&t.visible&&(game.user.isGM||(!t.document.hidden&&t.isVisible!==false));});
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
      const pt=this.panel._screenOf(t.x+t.w,t.y);el.style.left=pt.x+'px';el.style.top=pt.y+'px';
    }
  }

  async commitSelection(singleTarget=null) {
    const s=this.selection;if(!s?.option||this.busy)return;
    const actor=this.panel.actor;if(!actor?.isOwner||actor.uuid!==s.actorUuid){this.cancel();return;}
    const item=actor.items.get(s.itemId),act=this.panel._activityList(item).find(a=>a.id===s.activityId);
    if(!act){this.cancel();return;}
    const before=s.targets?.length;this.pruneTargets();
    if(s.plan&&(!s.targets.length||before!==s.targets.length||(s.plan.repeat&&s.targets.length!==s.plan.max))){this.renderChoice();this.status('目标已变化，请重新确认目标');return;}
    if(s.option.kind!=='native'&&!spellOptions(actor,item,act).some(o=>o.key===s.option.key&&o.value>0)){this.status('所选环位或免费次数已耗尽，请重新选择');this.cancel();return;}
    const targets=s.areaPoint?(s.areaTargets??[]).map(id=>canvas.tokens.get(id)).filter(Boolean):s.plan?s.targets.map(id=>canvas.tokens.get(id)):singleTarget?[singleTarget]:[];
    this.busy=true;this.clearVisuals();this.tip.hidden=true;this.render();
    const token=this.panel.token; const selected=s.option;
    const prior=new Set(game.user.targets);let targetRevision,releasePlacement;
    try {
    let activity=s.plan?prepareMultiActivity(item,act,s.plan):act;
    const usage={midiOptions:{targetUuids:[...new Set(targets.map(t=>t.document.uuid))],workflowOptions:{targetConfirmation:'none'}}};
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
      targetRevision=this.panel._targetRevision;
      // Do not suppress system dialogs for ambiguous multi-target/ammunition uses.
      const multi=Number(act.target?.affects?.count)>1;
      const weapon=item.type==='weapon'&&(item.system.properties?.has?.('amm')||this.panel._activityList(item).length>1);
      if(s.areaPoint){usage.create={measuredTemplate:true};releasePlacement=bindConfirmedPlacement(activity,s.areaPoint,()=>this.busy&&this.selection===s&&!this.aborting,async error=>{this.status(error.message);await this.abortActive();});}
      let result;
      if(s.plan?.repeat)result=await this.executeRays(activity,usage,targets,s.plan);
      else result=await this.execute(activity,usage,{configure:!s.plan&&(multi||weapon)});
      this.lastResult={item:item.id,activity:act.id,option:selected.kind,result:result?'returned':'cancelled',at:Date.now()};
    } finally {
      releasePlacement?.();
      // Only clear this action's own targets; never restore stale selections after new user input.
      if(s.plan){
        // Midi changes targets between rays; those changes must not bypass cleanup.
        for(const t of [...game.user.targets])t.setTarget(false,{releaseOthers:false,user:game.user});
      }else if(this.panel._targetRevision===targetRevision){
        for(const t of game.user.targets)if(!prior.has(t))t.setTarget(false,{releaseOthers:false,user:game.user});
        for(const t of prior)if(!t.destroyed)t.setTarget(true,{releaseOthers:false,user:game.user});
      }
      this.busy=false;this.badges.replaceChildren();this.selection=null;this.page='list';this._tipLocked=false;this.panel.refresh();
      if(!this.panel.actor){this.el.replaceChildren();this.el.hidden=true;this.position();}
    }
  }

  async executeRays(activity,usage,targets,plan) {
    const bolt=plan.spell==='magicMissile'?missileBolt(activity.item):rayActivity(activity.item,activity),separate=bolt.id!==activity.id;
    const results=[];let result;
    const completed=w=>!!w&&!w.aborted&&(!w.WorkflowState_Abort||w.currentAction!==w.WorkflowState_Abort);
    if(separate){const main=plan.spell==='magicMissile'?prepareMultiActivity(activity.item,activity,{...plan,bolt:true}):activity;result=await this.execute(main,usage,{configure:false});if(!completed(result))return result;}
    for(let i=0;i<targets.length;i++){
      const target=canvas.tokens.get(targets[i].id);
      if(!target?.actor||target.destroyed){this.status('目标已离开场景，停止剩余射线；已完成的攻击不会重试');break;}
      const first=!separate&&i===0;
      const ray=prepareMultiActivity(bolt.item,bolt,{...plan,bolt:true,subsequent:!first});
      const config=first?foundry.utils.deepClone(usage):{consume:{spellSlot:false,resources:false},consumeUsage:false,scaling:0,spell:{slot:usage.spell?.slot},midiOptions:{isTriggered:true,proceedChecks:{checkReaction:false,checkBonusAction:false}}};
      config.midiOptions??={};config.midiOptions.targetUuids=[target.document.uuid];config.midiOptions.targetsToUse=new Set([target]);config.midiOptions.configureDialog=false;
      config.midiOptions.workflowOptions={...config.midiOptions.workflowOptions,targetConfirmation:'none',autoRollAttack:true,autoRollDamage:'onHit',autoFastAttack:true,autoFastDamage:true};
      result=await this.execute(ray,config,{configure:false});
      results.push({target:target.id,attack:result?.attackTotal,damage:result?.damageTotal,aborted:!completed(result)});
      this.lastRays=results;
      if(!completed(result)){this.status('射线结算已中止；未执行的射线不会自动重试');break;}
    }
    return result;
  }

  async execute(activity,usage,dialog) {
    // Register the correlated lifecycle before calling use; never manufacture a workflow for hover.
    if(!game.modules.get('midi-qol')?.active)return activity.use(usage,dialog);
    if(activity.type==='attack'){
      usage.midiOptions??={};usage.midiOptions.workflowOptions??={};
      usage.midiOptions.workflowOptions.autoRollDamage='onHit';
    }
    const seq=foundry.utils.randomID();usage.sequenceId=seq;
    this._activeSeq=seq;this._activeUsage=usage;this.activeWorkflow=null;this.aborting=false;
    if(this.busy&&this.selection)this.renderChoice();
    return new Promise((resolve,reject)=>{
      let finished=false, aborted=false, timer, poll;const hooks=[];
      const capture=w=>{if(!finished&&w?.sequenceId===seq)this.activeWorkflow=w;};
      const captureStart=Hooks.on('midi-qol.preStart',capture);
      const captureRoll=Hooks.on('midi-qol.preItemRollV2',payload=>capture(payload?.workflow??payload));
      const finish=(value,err)=>{
        if(finished)return;finished=true;clearTimeout(timer);clearInterval(poll);
        for(const [n,id]of hooks)Hooks.off(n,id);
        Hooks.off('midi-qol.preStart',captureStart);Hooks.off('midi-qol.preItemRollV2',captureRoll);
        if(this.activeWorkflow?.sequenceId===seq)this.activeWorkflow=null;
        if(this._activeUsage===usage)this._activeUsage=null;
        if(this._activeSeq===seq)this._activeSeq=null;
        err?reject(err):resolve(value);
      };
      // midi 中止工作流时只会触发 preAbort，postCleanup 被跳过（performState 在 abort 分支不调 post 钩子）；
      // 必须在这里立即收尾，否则 busy 永远为 true，HUD 一直变灰无法操作。
      for(const name of ['midi-qol.postCleanup','midi-qol.preAbort'])hooks.push([name,Hooks.on(name,w=>{if(w.sequenceId!==seq)return;if(name==='midi-qol.preAbort'){aborted=true;finish(null);return;}finish(aborted?null:w);})]);
      // 兜底：装备/特性等活动的 abort 路径偶尔不带 preAbort 钩子，轮询 workflow 状态解锁
      poll=setInterval(()=>{const wf=this.activeWorkflow??usage.workflow;if(!wf)return;if(wf.aborted||wf.currentAction===wf.WorkflowState_Completed||wf.currentAction===wf.WorkflowState_Abort)finish(null);},500);
      timer=setTimeout(()=>{this.status('结算仍未结束，请检查投掷／反应窗口；不会自动重试');},30000);
      Promise.resolve(activity.use(usage,dialog)).then(result=>{
        capture(usage.workflow);
        if(!result)finish(null);
        else if(!usage.workflow&&!this.activeWorkflow)finish(result);
      },e=>finish(null,e));
    });
  }

  status(text) { if(this.lastStatus===text&&Date.now()-(this.lastStatusAt||0)<2500)return;this.lastStatus=text;this.lastStatusAt=Date.now();ui.notifications.warn(text); }
  error(err) { console.error(`[${ID}] HUD`,err);ui.notifications.error(err.message||String(err)); }

  tooltip(ev) {
    if(this._tipLocked){this.hideTip(0);return;}
    const b=ev.target.closest('[data-hud-item],[data-hud-mode],[data-hud-option]');
    if(!b){this.hideTip(200);return;}
    if(b===this._tipBtn)return;
    this._tipBtn=b;
    clearTimeout(this._tipTimer);clearTimeout(this._tipHideTimer);
    this._tipTimer=setTimeout(()=>{try{this.renderTip(b);}catch(err){console.warn(`[${ID}] 悬浮说明失败`,err);}},150);
  }

  hideTip(delay=0) {
    clearTimeout(this._tipTimer);clearTimeout(this._tipHideTimer);
    const hide=()=>{this.tip.hidden=true;this.tip.replaceChildren();this._tipBtn=null;this.tipItem=null;};
    if(delay>0)this._tipHideTimer=setTimeout(hide,delay);else hide();
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

  renderTip(btn) {
    const actor=this.panel.actor;if(!actor)return;
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
    const model=buildTooltipModel(item,{
      activities:acts,selectedActivityId:activityId,castLevel,scaledActivity,scaledItem,
      resources:this.tooltipResources(item,acts),targetPlan:plan,isOwner:!!actor.isOwner,
      shortName:nameParts(item.name).short,
    });
    if(model&&model.shortName===model.originalName)model.originalName='';
    this.tipItem=item;
    this.tip.innerHTML=renderTooltipHTML(model);
    this.tip.hidden=false;
    const width=this.tip.offsetWidth||380,rect=btn.getBoundingClientRect();
    const hudTop=this.el.getBoundingClientRect().top;
    const topbar=this.el.querySelector('.bg3-topbar')?.getBoundingClientRect();
    // 资源顶栏也是可点击筛选按钮：说明卡停在它上方，不遮住正在操作的按钮。
    const anchorTop=topbar&&topbar.height>0?Math.min(hudTop,topbar.top):hudTop;
    this.tip.style.left=`${Math.max(10,Math.min(innerWidth-width-10,rect.left+rect.width/2-width/2))}px`;
    this.tip.style.bottom=`${Math.max(10,innerHeight-anchorTop+8)}px`;
    this.tip.style.maxHeight=`${Math.max(160,Math.min(innerHeight*.72,anchorTop-20))}px`;
  }

  async deleteFreeSource(resourceId) {
    const actor=this.panel.actor,s=this.selection;
    if(this.busy||!actor?.isOwner||!s||s.actorUuid!==actor.uuid)return;
    const resource=actor.items.get(resourceId),spell=actor.items.get(s.itemId);
    if(!spell||!canManageFree(spell,this.panel._activityList(spell))||!matchesFreeSource(resource,spell))return;
    this.busy=true;
    if(s.option?.key===resourceId){
      this.clearVisuals();this.tip.hidden=true;this.badges.replaceChildren();
      s.option=null;s.plan=null;s.targets=[];
    }
    this.render();
    try { await actor.deleteEmbeddedDocuments('Item',[resourceId]); }
    finally { this.busy=false;this.render(); }
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
