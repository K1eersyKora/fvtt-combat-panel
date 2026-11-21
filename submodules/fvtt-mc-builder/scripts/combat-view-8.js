import {ID,active3D,tokenProjection,writeStyle,writeAttribute} from './combat-space-2.js';
import {pickTokenVolume} from './token-volume-2.js';
import {anchorHint,releaseHint} from './hint-placement-2.js';
import {stormwreck3D} from './stormwreck-view-1.js';
import {installTokenHUD} from './token-hud-1.js';
import {activityRange} from './spatial-range-1.js';
import {meleeActivity} from './melee-approach-2.js';
export {tokenProjection} from './combat-space-2.js';
let installed=false;
let hover, areaState, displayedFeet = new Map();
const cards = new Map(), rows = new Map();

export const targetPresentation = {
  enabled: stormwreck3D,
  showHover(panel, token, preview) {
    hover = null;
    const drag = panel._drag, hud = panel.hud;
    if (drag.hudHidden || preview?.meleePosition === 'unreachable' || preview?.meleePosition === 'blocked') return;
    if (hud.selection?.plan?.areaChoice) {
      if (!hud.area?.accepts(token, {refresh: false})) return;
    } else if (meleeActivity(hud)) {
      // The panel's melee prediction checks the attack position after approach.
      if (!preview) return;
    } else if (activityRange(drag.activity, panel.token, token)?.result === 'fail') return;
    hover = {drag, token, preview};
  },
  clearHover() { hover = null; },
  setAreaTargets(area, targets) { areaState = {area, targets}; }
};

function aiming() {
  const panel = globalThis.__dshCombatPanel, drag = panel?._drag, hud = panel?.hud;
  return drag?.started && !hud.busy ? {panel, drag, hud} : null;
}

function currentHover(context) {
  return hover && hover.drag === context?.drag && !context.drag.hudHidden ? hover : null;
}

function highlights() {
  const context = aiming(), result = new Map(), hovered = currentHover(context);
  if (hovered) result.set(hovered.token.id, 'hover');
  for (const id of context?.hud.selection?.targets ?? []) result.set(id, 'selected');
  const hud = globalThis.__dshCombatPanel?.hud;
  for (const token of hud?._session.operation?.targets ?? []) {
    if (token.document.parent === canvas.scene) result.set(token.id, 'selected');
  }
  return result;
}

function removeCard(id, card) {
  releaseHint('prediction:' + id);
  card.remove();
  cards.delete(id);
}

function clearCards() {
  for (const [id, card] of cards) removeCard(id, card);
  rows.clear();
}

function createCard(id) {
  const card = document.createElement('div');
  card.className = 'mcb-probability';
  card.dataset.tokenId = id;
  const glyph = document.createElement('span');
  glyph.className = 'mcb-roll-mode';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.append(document.createElement('i'), document.createElement('i'));
  card.append(glyph, document.createElement('span'));
  document.body.append(card);
  return card;
}

function drawPredictions(feet) {
  displayedFeet = feet;
  const context = aiming();
  if (!context?.panel.previewPolicy?.probability) { clearCards(); return; }
  const {panel, drag, hud} = context, hovered = currentHover(context);
  const area = areaState?.area === hud.area && (!drag.hudHidden || hud.selection?.plan?.areaChoice) ? areaState : null;
  const activity = area?.area.activity ?? drag.activity;
  const targets = new Map((area?.targets ?? []).map(token => [token.id, token]));
  for (const id of hud.selection?.targets ?? []) {
    const token = canvas.tokens.get(id);
    if (token) targets.set(id, token);
  }
  if (hovered) targets.set(hovered.token.id, hovered.token);
  for (const id of rows.keys()) if (!targets.has(id)) rows.delete(id);
  const drawn = new Set();
  for (const [id, token] of targets) {
    const anchor = feet.get(id);
    if (!anchor) continue;
    let preview;
    if (hovered?.token === token && hovered.preview !== null && activity === drag.activity) {
      preview = hovered.preview;
    } else if (area || hud.selection?.targets?.includes(id)) {
      let row = rows.get(id);
      if (!row || row.drag !== drag || row.activity !== activity || row.revision !== panel.previewRevision) {
        row = {drag, activity, revision: panel.previewRevision};
        rows.set(id, row);
        if (['attack','save'].includes(activity.type)) {
          const pending = row;
          void panel._computePreview(activity, token).then(value => { pending.preview = value; }).catch(() => {});
        }
      }
      preview = row.preview;
    }
    if (!['attack','save'].includes(preview?.kind) || !Number.isFinite(preview.chance)) continue;
    drawn.add(id);
    let card = cards.get(id);
    if (!card) cards.set(id, card = createCard(id));
    const mode = preview.mode === 'adv' || preview.mode === 'dis' ? preview.mode : 'normal';
    const percent = Math.round(preview.chance * 100) + '%';
    if (card.dataset.mode !== mode) card.dataset.mode = mode;
    if (card.lastElementChild.textContent !== percent) card.lastElementChild.textContent = percent;
    anchorHint('prediction:' + id, card, anchor.x, anchor.y + 8);
  }
  for (const [id, card] of cards) if (!drawn.has(id)) removeCard(id, card);
}

function resetPredictions() {
  hover = areaState = null;
  displayedFeet = new Map();
  clearCards();
}

function positionOverlay(wrapped,token){
  if(!active3D())return wrapped(token);
  if(this.targetPresentation)return;
  const p=tokenProjection(token);if(!p){this._hideTargetOverlay();return;}
  for(const [k,v] of Object.entries({left:p.left-4,top:p.top-4,width:p.width+8,height:p.height+8}))writeStyle(this.$lock,k,`${v.toFixed(2)}px`);
  if(this.$hit.classList.contains('dsh-cp-hidden'))return;
  anchorHint('hit',this.$hit,p.head.x,p.head.y-10);
}
function chainElements(panel){
  if(panel._mcbChain)return panel._mcbChain;
  const ns='http://www.w3.org/2000/svg',defs=document.createElementNS(ns,'defs'),pattern=document.createElementNS(ns,'pattern');
  const id='mcb-chain-'+foundry.utils.randomID(8);for(const [k,v]of Object.entries({id,patternUnits:'userSpaceOnUse',width:20,height:10,y:-5,viewBox:'0 0 20 10'}))pattern.setAttribute(k,v);
  for(const [x,rx,ry,color]of [[5,5,3,'#cba45f'],[15,4.5,1.6,'#ffe4a8']]){const ellipse=document.createElementNS(ns,'ellipse');for(const [k,v]of Object.entries({cx:x,cy:5,rx,ry,fill:'#19171c77',stroke:color,'stroke-width':1.45}))ellipse.setAttribute(k,v);pattern.appendChild(ellipse);}
  defs.appendChild(pattern);panel.$chain.appendChild(defs);
  const rect=document.createElementNS(ns,'rect');for(const [k,v]of Object.entries({x:0,y:-5,height:10,fill:`url(#${id})`}))rect.setAttribute(k,v);
  panel.$chainLinks.appendChild(rect);return panel._mcbChain={rect,defs,active:false};
}
function syncChain(wrapped,drag){
  if(!active3D()){if(this._mcbChain){writeStyle(this._mcbChain.rect,'display','none');this._mcbChain.active=false;}return wrapped(drag);}
  if(!this.$chain||!this.token||!drag.started)return;
  const p=tokenProjection(this.token);if(!p){writeStyle(this.$chain,'display','none');return;}
  const source=p.feet,dx=drag.clientX-source.x,dy=drag.clientY-source.y;
  const compact=!!this.targetPresentation, length=Math.max(0,Math.hypot(dx,dy)-(compact?0:27)), c=chainElements(this);
  if(!c.active){for(const node of this._chainNodes)writeStyle(node,'display','none');writeStyle(c.rect,'display','');c.active=true;}
  const show=length>=(compact?1:10);
  writeStyle(this.$chain,'display',show?'':'none');if(!show)return;
  this.$chain.classList.toggle('is-locked',compact?!!currentHover(aiming()):!!drag.overlayToken);
  drag.el?.classList.toggle('is-locked',!!drag.overlayToken);
  writeAttribute(this.$chainLinks,'transform',`translate(${source.x.toFixed(2)} ${source.y.toFixed(2)}) rotate(${(Math.atan2(dy,dx)*180/Math.PI).toFixed(3)})`);
  writeAttribute(c.rect,'width',length.toFixed(2));
}
function mount(){
  if(installed||!['0.15.5','0.15.6','0.15.7','0.15.8'].includes(game.modules.get('fvtt-combat-panel')?.version)||!globalThis.__dshCombatPanel)return;
  const root='globalThis.__dshCombatPanel.';
  libWrapper.register(ID,root+'_tokenAtClient',function(w,x,y){return active3D()?pickTokenVolume(x,y):w(x,y);},'MIXED');
  libWrapper.register(ID,root+'_tokenScreenPoint',function(w,t,corner=false){if(!active3D())return w(t,corner);if(this.targetPresentation&&!displayedFeet.has(t.id))return null;const p=tokenProjection(t);return p?{x:corner?p.left+p.width:p.head.x,y:p.head.y}:null;},'MIXED');
  libWrapper.register(ID,root+'_positionTargetOverlay',positionOverlay,'MIXED');libWrapper.register(ID,root+'_syncAttackChain',syncChain,'MIXED');
  for(const method of ['_syncPosition','_syncDragVisuals']){let last=0,revision=-1;libWrapper.register(ID,root+method,function(w,...args){if(active3D()){const now=performance.now(),interval=document.documentElement.dataset.cpPerformance==='low'?32:15,next=game.Levels3DPreview.controls._mcbCameraRevision??0;if(now-last<interval&&revision===next)return;last=now;revision=next;}return w(...args);},'MIXED');}
  installed=true;
}
export function combatViewStatus(){return {installed,active:active3D(),chainAnchor:'feet',predictionAnchor:stormwreck3D()?'footprint':'head',chainRenderer:'svg-pattern',maxRefreshHz:67};}
export function installCombatView(){
  installTokenHUD({highlights, drawPredictions, resetPredictions});
  for(const h of ['ready','canvasReady','3DCanvasSceneReady'])Hooks.on(h,()=>setTimeout(mount,0));
  Hooks.on('canvasTearDown',()=>releaseHint('hit'));
  Hooks.on('3DCanvasToggleMode',on=>{
    if(!on)releaseHint('hit');
    const panel=globalThis.__dshCombatPanel;
    if(panel?._drag)panel._invalidatePreview();
  });
}
