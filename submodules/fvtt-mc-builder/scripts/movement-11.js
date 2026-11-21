import {ID,active3D,view3D,screenPoint,worldPoint} from './combat-space-3.js';
import {stormwreck3D} from './stormwreck-view-1.js';
import {walkingPoint} from './movement-ground-1.js';
import { pickTokenVolume, installTokenVolume } from './token-volume-2.js';
import { createNavigation, sweptBodyBlocked, boxesOverlap } from './navigation-core-7.js';
import { walkingTraffic, hostileFraction, hostileIntervals, occupiedIntervals, pricedLine } from './walking-traffic-1.js';
import {barriersFor} from './scene-barriers-1.js';
import {splitWalk,askToContinue} from './movement-budget-2.js';
import {strengthJump,planJump,installJump,reserveJump,finishJump,registerJump,unregisterJump,allowsJumpUpdate} from './jump-1.js';
export {allowsJumpUpdate,strengthJump};
import {meleeActivity, approachRule, installMeleeHooks} from './melee-approach-2.js';
import { createPathVisual } from './spatial-visuals-3.js';
import { writeMovementMeter } from './movement-display-1.js';
import { anchorHint, releaseHint } from './hint-placement-2.js';
import { createMovementToggle } from './movement-toggle-3.js';
import { installGroundingAdapter, groundingStatus } from './grounding-1.js';
import {allowsSpellMove} from './spell-points-1.js';

let adapter, installed = false, enabled = false, visual, button, frame, pointer, preview, cached, navigation, moving;
let consumeUntil=0, revision=0, generation=0, groundOrder=0, debounce, cameraControls, aimKey='', pendingAttack=null;
const perf={picks:0,searches:0,previews:0,idleTicks:0};
let idlePulse,jumpMode=false,journey=null,previewBusy=false,suppressRight=0,jumpCache,groundPending=false;
let meleeRequest;
const actualTravel = new WeakMap();
let nativeMeter, rulerBinding;
const approvedUpdates = new WeakMap();
const samePoint = (a, b) => Math.abs(a.x - b.x) < .01 && Math.abs(a.y - b.y) < .01 && Math.abs(a.elevation - b.elevation) < .001;
function sourcePosition(token) { const { x, y, elevation } = token.document._source; return { x, y, elevation }; }
function onSegment(p, a, b) {
  const fields = ['x', 'y', 'elevation'], axis = fields.reduce((best, key) => Math.abs(b[key] - a[key]) > Math.abs(b[best] - a[best]) ? key : best, 'x');
  const delta = b[axis] - a[axis]; if (Math.abs(delta) < 1e-6) return samePoint(p, a);
  const t = (p[axis] - a[axis]) / delta;
  return t >= -1e-5 && t <= 1 + 1e-5 && fields.every(key => Math.abs(p[key] - (a[key] + (b[key] - a[key]) * t)) < (key === 'elevation' ? .001 : .02));
}
const observatoryMap = 'fvtt-seagrow-caves';
const observatoryPortals = new Set(['library-down', 'library-up', 'bridge-east', 'bridge-west']);
function isObservatoryPortalCheckpoint(doc, move, target, point) {
  // Foundry rounds its automatic Region entry to integer pixels. Recompute that
  // precise checkpoint from the approved leg before validating its actual collision path.
  if (doc.parent.getFlag(observatoryMap, 'map') !== 'obs' || point.explicit || !point.checkpoint ||
      point !== move.passed.waypoints.at(-1) || point.action !== 'walk') return false;
  const next = move.pending.waypoints.find(waypoint => waypoint.explicit);
  if (!next || !samePoint(next, target)) return false;
  return doc.parent.regions.some(region => {
    const key = region.getFlag(observatoryMap, 'observatoryPortal');
    if (!observatoryPortals.has(key) || !region.behaviors.some(behavior =>
      !behavior.disabled && behavior.type === 'executeScript' &&
      behavior.getFlag(observatoryMap, 'observatoryPortal') === key &&
      behavior.hasEvent(CONST.REGION_EVENTS.TOKEN_MOVE_IN))) return false;
    const leg = [move.origin, {...target, action: point.action}];
    return doc.segmentizeRegionMovementPath(region, leg).some(segment =>
      segment.type === CONST.REGION_MOVEMENT_SEGMENTS.ENTER && samePoint(point, segment.to));
  });
}
function engine() { return game.Levels3DPreview; }
function aiming() { const panel = globalThis.__dshCombatPanel; return !!(panel?._drag?.started || panel?.hud?.selection || canvas.templates?.preview?.children?.length); }
function usable(allowAim=false) { return active3D() && !adapter.isEditing() && canvas.tokens?.active && !ui.controls?.isRuler && (allowAim || !aiming()); }
function inputTarget(target) { return !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'); }
function canvasTarget(target) { return !!target && target === engine()?.renderer?.domElement; }
function pointerOnCanvas() { return pointer && canvasTarget(pointer.target) && canvasTarget(document.elementFromPoint(pointer.x, pointer.y)); }
function selected() { const tokens = canvas.tokens?.controlled ?? []; return tokens.length === 1 && tokens[0].isOwner && !tokens[0].document.locked ? tokens[0] : null; }
function bodyFor(token, bounds) {
  const body = bounds?.get(token.id) ?? adapter.tokenBounds().find(b => b.id === token.id); if (!body) return null;
  const height = Number(engine().tokens[token.id]?.d) * engine().factor / adapter.scale();
  return { ...body, min: [...body.min], max: [body.max[0], body.min[1] + Math.max(body.max[1] - body.min[1], height || 0), body.max[2]] };
}
function otherBodies(token) {
  const bounds=new Map(adapter.tokenBounds().map(b=>[b.id,b]));
  return canvas.tokens.placeables.filter(t=>t.id!==token.id&&t.visible&&(game.user.isGM||!t.document.hidden)).map(t=>bodyFor(t,bounds)).filter(Boolean);
}
function footPoint(p) { const [x, z] = adapter.origin(), unit = adapter.scale(); return { x: x + p[0] * unit, y: z + p[2] * unit, elevation: p[1] * 5 }; }
function centerPoints(points, token) { const unit = adapter.scale(); return points.map(p => ({ ...p, x: p.x + token.document.width * unit / 2, y: p.y + token.document.height * unit / 2 })); }
function budgetFor(token, action = 'walk') {
  const speeds = token.actor?.system?.attributes?.movement;
  let speed = Number(speeds?.[action]) || 0;
  const type = CONFIG.DND5E?.movementTypes?.[action];
  if (!type || type.walkFallback) speed = Math.max(speed, Number(speeds?.walk) || 0);
  speed = Math.max(0, speed);
  const combat=token.document.combatant?.parent;
  const inCombat=!!combat?.started,history=inCombat?token.document.movementHistory??[]:[];
  const spent = history.reduce((s, w) => s + (w.cost === null || !Number.isFinite(Number(w.cost)) ? Infinity : Math.max(0, Number(w.cost))), 0);
  return {speed,spent,budget:inCombat?Math.max(0,speed-spent):Infinity,history,inCombat,turn:inCombat?combat.id+'/'+combat.round+'/'+combat.turn:null};
}
function movementMeter(token, action, distance = 0) {
  const {inCombat, spent, speed} = budgetFor(token, action);
  return {action, used: inCombat ? spent : distance, total: inCombat ? speed : Infinity};
}

function detachRuler() {
  const {ruler, original, wrapper} = rulerBinding ?? {};
  if (ruler?.update === wrapper && original) ruler.update = original;
  ruler?.textElement.classList.remove('mcb-native-ruler');
  rulerBinding = null;
  nativeMeter?.hud.remove();
  nativeMeter = null;
  releaseHint('native-move');
}

function attachRuler() {
  const ruler = stormwreck3D() && engine().ruler;
  if (ruler === rulerBinding?.ruler) return;
  detachRuler();
  if (!ruler?.update) return;
  const original = ruler.update;
  function wrapper(...args) {
    const result = original.apply(this, args);
    if (this.isToken) requestTick();
    return result;
  }
  ruler.update = wrapper;
  rulerBinding = {ruler, original, wrapper};
}

function syncNativeMeter() {
  if (!stormwreck3D() || !rulerBinding) return false;
  const {ruler} = rulerBinding, dragged = ruler.isToken && engine().interactionManager.draggable?.userData?.entity3D?.token;
  ruler.textElement.classList.toggle('mcb-native-ruler', !!dragged);
  const token = dragged || selected();
  const traveled = token && actualTravel.get(token.document);
  const recent = !preview && traveled && performance.now() - traveled.at < 1800;
  const show = !!dragged || !!recent;
  if (!show) {
    if (nativeMeter) nativeMeter.hud.hidden = true;
    releaseHint('native-move');
    return false;
  }
  if (!nativeMeter) {
    const hud = document.createElement('div'), icon = document.createElement('span'), text = document.createElement('strong');
    hud.className = 'mcb-path-hud is-meter';
    icon.className = 'mcb-movement-icon';
    hud.append(icon, text);
    document.body.append(hud);
    nativeMeter = {hud, icon, text};
  }
  const view = view3D(), point = dragged ? ruler.getTargetPos() : worldPoint({...token.center, elevation:token.document.elevation});
  const anchor = view && screenPoint(point, view);
  const {hud, icon, text} = nativeMeter;
  hud.hidden = !anchor || anchor.x < view.rect.left || anchor.x > view.rect.right || anchor.y < view.rect.top || anchor.y > view.rect.bottom;
  if (!hud.hidden) {
    const action = dragged ? token.document.movementAction : traveled.action;
    writeMovementMeter(icon, text, movementMeter(token, action, dragged ? 0 : traveled.distance));
    anchorHint('native-move', hud, anchor.x + 19, anchor.y - 28);
  }
  return show;
}
function nativeCosts(token, points, fallback) {
  const history = budgetFor(token).history, action = CONFIG.Token.movement.actions.walk ? 'walk' : token.document.movementAction;
  const path = points.map(p => ({ ...p, action, snapped: false }));
  try {
    const measurement = token.measureMovementPath([...history, ...path], { preview: true });
    const costs = [0];
    for (let i = 1; i < path.length; i++) costs.push(costs.at(-1) + Number(measurement.waypoints[history.length + i].backward.cost));
    return costs.every(Number.isFinite)?costs:fallback;
  } catch (error) { console.warn(`${ID}: movement measurement fallback`, error); }
  const traffic=walkingTraffic(token);
  if(!traffic)return fallback;
  const costs=[0],voxels=points.map(traffic.position);
  for(let i=1;i<voxels.length;i++){
    const a=voxels[i-1],b=voxels[i],rate=1+hostileFraction(hostileIntervals(a,b,traffic.size,traffic.hostiles));
    costs.push(costs.at(-1)+Math.hypot(...b.map((v,k)=>v-a[k]))*5*rate);
  }
  return costs;
}
function getNavigation() {
  const world = adapter.world(), config = adapter.config(), height = game.settings.get(ID, 'maxStepHeight') / 5;
  const provider = config.terrainProvider && game.modules.get(config.terrainProvider)?.api?.movementSurface;
  const surface = provider?.(canvas.scene);
  const barriers=barriersFor(canvas.scene);
  const signature = `${canvas.scene.id}:${world.signature}:${surface?.revision ?? ''}:${height}:${barriers.revision}`;
  if (navigation?.signature !== signature) navigation = { signature, nav: createNavigation({ boxes: world.boxes,
    bounds: { min: [0, config.minY, 0], max: [config.width, config.maxY, config.height] }, surface, barriers,snapHorizontal:n=>Math.round(n*adapter.scale())/adapter.scale(), maxRise: height, maxDrop: height }), surface,barriers };
  return navigation;
}
function invalid(token, target, reason) {
  const origin = { x: token.center.x, y: token.center.y, elevation: token.document.elevation };
  const budget = budgetFor(token);
  return { valid: false, reason, points: [target??origin], costs:[0], budget: budget.budget, speed: budget.speed, spent: budget.spent, cost: 0, tokenId: token.id };
}

export function planMovementTo(token, target, {targetToken,activity,stale}={}) {
  if (!token?.isOwner || token.document.locked) return null;
  if (game.paused && !game.user.isGM) return invalid(token, target, '游戏已暂停');
  if (token.actor?.statuses?.has('flying') || engine().tokens[token.id]?.wasFreeMode) return invalid(token, target, '一键移动当前使用地面走行，请切回地面移动');
  if (!target) return invalid(token, null, '请指向可站立的地面或方块顶部');
  const body = bodyFor(token), unit = adapter.scale(), [ox, oz] = adapter.origin();
  if (!body) return invalid(token, target, '指示物尚未加载');
  const destination = [(target.x - ox) / unit - token.document.width / 2, target.elevation / 5, (target.y - oz) / unit - token.document.height / 2];
  const terrain = getNavigation(), traffic=walkingTraffic(token), bodies=traffic?.occupants??otherBodies(token), budget = budgetFor(token);
  const obstacles=traffic?[]:bodies, occupants=traffic?.occupants??[], hostiles=traffic?.hostiles??[];
  if(terrain.surface){destination[0]=Math.round(destination[0]*unit)/unit;destination[2]=Math.round(destination[2]*unit)/unit;}
  if (!terrain.surface) {
    destination[0] = body.min[0] + Math.round((destination[0] - body.min[0]) * 2) / 2;
    destination[2] = body.min[2] + Math.round((destination[2] - body.min[2]) * 2) / 2;
  }
  const enemy = targetToken && bodies.find(b=>b.id===targetToken.id);
  if (targetToken && !enemy) return invalid(token,target,'目标已离开当前视野');
  const approach = enemy && approachRule(token,targetToken,body,enemy,activity,adapter);
  const context=JSON.stringify([terrain.signature,token.id,body,bodies,hostiles.map(b=>b.id),budget.turn,budget.speed,budget.spent,revision,targetToken?.id,approach?.feet]);
  // Cache the exact destination accepted by Foundry, not a quarter-cell bucket.
  // Two clicks on opposite sides of an edge can share the old bucket.
  const hash=JSON.stringify(destination);
  if(cached?.context===context&&cached.hash===hash)return cached.preview;
  function finish(result) {
  if(!result || stale?.())return null;
  const waypoints = result.points.map(footPoint), costs = result.valid ? nativeCosts(token, waypoints, result.costs) : result.costs;
  const value = { ...result, points: centerPoints(waypoints, token), costs, cost: costs.at(-1), waypoints,
    tokenId: token.id, source: sourcePosition(token),
    budget: budget.budget, speed: budget.speed, spent: budget.spent, terrainSignature: terrain.signature };
  if (!result.valid) {value.points=[target];value.costs=[0];}
  else if(traffic&&hostiles.length)value.line=pricedLine(value.points,costs,result.points,traffic.size,hostiles);
  cached = {context,hash,preview:value,destination,raw:result};return value;
  }
  if(!approach&&terrain.surface&&cached?.context===context&&cached.raw.valid&&cached.raw.points.length>1){
    const prior=cached.raw.points,last=prior.at(-1),base=prior.at(-2),size=body.max.map((v,i)=>v-body.min[i]);
    const h=terrain.surface.level(destination[0]+size[0]/2,destination[2]+size[2]/2,destination[1]);
    const end=[destination[0],h,destination[2]];
    if(Number.isFinite(h)&&Math.abs(h-destination[1])<=.42&&Math.hypot(end[0]-last[0],end[2]-last[2])<=(terrain.surface.step??.25)
      &&Math.hypot(end[0]-base[0],end[2]-base[2])<=Math.SQRT2+.005&&terrain.nav.standing(end,size,bodies)
      &&terrain.nav.transition(last,end,size,obstacles)&&terrain.nav.transition(base,end,size,obstacles)){
      const costs=cached.raw.costs.slice(0,-1),rate=1+hostileFraction(hostileIntervals(base,end,size,hostiles));
      costs.push(costs.at(-1)+Math.hypot(...end.map((v,i)=>v-base[i]))*5*rate);
      return finish({...cached.raw,points:[...prior.slice(0,-1),end],costs,cost:costs.at(-1)});
    }
  }
  perf.searches++;
  const rules={obstacles,occupants,hostiles,approach};
  return stale?terrain.nav.planAsync(body,destination,rules,stale).then(finish):finish(terrain.nav.plan(body,destination,rules));
}

function clearPreview() { preview = null; visual?.clear(); }
function drawPreview(value) {
  if(value && value===preview)return;
  perf.previews++;
  preview = value; if (!value) return visual?.clear();
  visual ??= createPathVisual();
  if(stormwreck3D()){
    const token=canvas.tokens.get(value.tokenId);
    if(token)visual.update({...value,...value.line,meter:movementMeter(token,value.jump||jumpMode?'jump':'walk')});
    return;
  }
  const limit=Number.isFinite(value.budget)?'可用 '+value.budget.toFixed(1).replace(/\.0$/,'')+' 尺':'非战斗 · 自由移动';
  const what=value.jump?'跳跃 · '+value.height+' 尺限高 · ':'';
  visual.update({...value,...value.line,label:value.valid?what+value.cost.toFixed(1).replace(/\.0$/,'')+' 尺 · '+limit:value.reason});
}
function tick() {
  frame = null; updateButton();
  if (moving) {
    watchContinuation(moving);
    if (!active3D() || adapter.isEditing() || (game.paused && !game.user.isGM) || !moving.token.isOwner) stopMovement({ force: true });
    else if (moving.submitted && ['completed', 'stopped'].includes(moving.token.document.movement.state) && !moving.token.movementAnimationPromise) { moving = null; cached = null; clearPreview(); }
  }
  const displayingNative = syncNativeMeter();
  if (moving || displayingNative) frame=requestAnimationFrame(tick);
}
function requestTick() { if (frame === null || frame === undefined) frame = requestAnimationFrame(tick); }

function targetPoint(target){const d=target.document._source;return {x:d.x+target.w/2,y:d.y+target.h/2,elevation:d.elevation};}
export function previewMeleeRoute(token,activity,target){
  const armed=meleeActivity();
  if(!armed||!target||target===token||!target.visible||selected()!==token||
    activity?.id!==armed.id||activity.item?.id!==armed.item.id)return null;
  return meleeRoute(token,armed,target);
}
function meleeRoute(token,activity,target){
  const scene=canvas.scene,source=sourcePosition(token),enemy=sourcePosition(target);
  const stamp=JSON.stringify([scene.id,token.id,source,target.id,enemy,activity.uuid,revision,game.paused]);
  if(meleeRequest?.stamp===stamp)return meleeRequest.promise;
  const request=meleeRequest={stamp},version=revision;
  const stale=()=>meleeRequest!==request||revision!==version||canvas.scene!==scene||!target.visible||
    canvas.tokens.get(target.id)!==target||selected()!==token;
  request.promise=(async()=>{
    const body=bodyFor(token),other=bodyFor(target);
    if(body&&other&&approachRule(token,target,body,other,activity,adapter).accepts(body.min)){
      const budget=budgetFor(token);
      return {valid:true,reason:'',cost:0,costs:[0],waypoints:[source],points:centerPoints([source],token),
        source,tokenId:token.id,budget:budget.budget,speed:budget.speed,spent:budget.spent,terrainSignature:getNavigation().signature};
    }
    const plan=await planMovementTo(token,targetPoint(target),{targetToken:target,activity,stale});
    return stale()?null:plan;
  })();
  return request.promise;
}
function schedulePreview(delay=32,idle=false){
  if(!idle)generation++;
  if(moving||journey||pendingAttack||document.hidden)return;
  if(!enabled&&!jumpMode&&!meleeActivity()){clearPreview();return;}
  if(debounce!==undefined||previewBusy)return;
  debounce=setTimeout(async()=>{
    debounce=undefined;const serial=generation;
    if(moving||journey||pendingAttack||!pointerOnCanvas()){if(!journey)clearPreview();return;}
    const token=selected(),act=meleeActivity();
    if(!token||!usable(!!act)){clearPreview();return;}
    const target=pickTokenVolume(pointer.x,pointer.y);
    if(act ? (!target || target===token) : !!target){clearPreview();return;}
    if(!act)perf.picks++;
    const point=act?targetPoint(target):walkingPoint(pointer.x,pointer.y,getNavigation().surface);
    previewBusy=true;
    try{
      const value=act?await meleeRoute(token,act,target):jumpMode?jumpTo(token,point,true):await planMovementTo(token,point,{stale:()=>generation!==serial});
      if(serial===generation)drawPreview(value);
    }finally{previewBusy=false;if(serial!==generation)schedulePreview(16,true);}
  },delay);
}
function cameraChanged(){if(!moving&&(enabled||jumpMode||meleeActivity()))schedulePreview(32);}
function pulse(){
  clearInterval(idlePulse);idlePulse=null;
  if(enabled||jumpMode)idlePulse=setInterval(()=>{perf.idleTicks++;if(pointer&&!document.hidden&&!moving&&!journey&&!pendingAttack&&!previewBusy)schedulePreview(0,true);},200);
}
function rememberPointer(ev) {
  if(!ev.isTrusted&&pointer)return;
  if(!canvasTarget(ev.target)) { if(pointer){pointer=null;++generation;clearPreview();} return; }
  if(pointer?.x===ev.clientX&&pointer?.y===ev.clientY&&pointer.target===ev.target)return;
  pointer={x:ev.clientX,y:ev.clientY,target:ev.target}; if(enabled||jumpMode||meleeActivity())schedulePreview();
}
function cancelAttack(){if(pendingAttack){pendingAttack.cancelled=true;if(moving)stopMovement();}meleeRequest=null;aimKey='';++generation;clearPreview();}
async function beforeAttack(hud,act,target){
  if(pendingAttack||moving)return false;
  const token=selected(),sel=hud.selection,scene=canvas.scene,id=target.id;
  if(!token||!usable(true)||!target.visible)return false;
  const here=bodyFor(token),there=bodyFor(target);
  if(here&&there&&approachRule(token,target,here,there,act,adapter).accepts(here.min))return true;
  const entry=pendingAttack={cancelled:false};++generation;clearTimeout(debounce);debounce=undefined;
  const valid=()=>!entry.cancelled&&hud.selection===sel&&canvas.scene===scene&&selected()===token&&canvas.tokens.get(id)===target&&target.visible;
  try {
    const plan=await meleeRoute(token,act,target);
    if(!valid())return false;
    if(!plan?.valid){hud.status(plan?.reason??'无法到达目标');if(plan)drawPreview(plan);return false;}
    if(plan.waypoints.length>1){
      if(!await executeMovement(plan,true))return false;
      while(moving&&valid())await new Promise(resolve=>setTimeout(resolve,30));
    }
    const own=bodyFor(token),other=bodyFor(target);
    if(!valid()||!own||!other||!approachRule(token,target,own,other,act,adapter).accepts(own.min)){hud.status('目标或路线发生变化，请重新选择');return false;}
    return true;
  } finally {if(pendingAttack===entry)pendingAttack=null;clearPreview();}
}

function jumpTo(token,target,useCache=false){
  if(!token?.isOwner||token.document.locked)return null;
  if(!target||(!game.user.isGM&&game.paused))return invalid(token,target,'请指向可落脚的地面');
  const body=bodyFor(token);if(!body)return invalid(token,target,'指示物尚未就绪');
  const key=[revision,token.id,target.x.toFixed(1),target.y.toFixed(1),target.elevation.toFixed(2)].join('/');
  if(useCache&&jumpCache?.key===key)return jumpCache.value;
  const value=planJump({token,target,body,obstacles:otherBodies(token),terrain:getNavigation(),adapter,budget:budgetFor(token)});
  if(useCache&&value.valid)jumpCache={key,value};
  if(!value.valid)return invalid(token,target,value.reason);
  return value;
}
export function planJumpTo(token,target){return jumpTo(token,target);}
export function setJumpEnabled(value){
  if(journey||moving)return false;
  if(value&&!selected()){ui.notifications.info('请先选中要跳跃的指示物。');return false;}
  jumpMode=!!value;if(jumpMode){enabled=false;globalThis.__dshCombatPanel?.hud?.cancel?.();}
  cached=null;clearPreview();pulse();updateButton();schedulePreview(0);
  return jumpMode;
}
function orderIsCurrent(order){
  return !order.cancelled&&canvas.scene===order.scene&&selected()===order.token&&order.token.isOwner&&!order.token.document.locked&&
    (game.user.isGM||!game.paused)&&budgetFor(order.token).turn===order.turn;
}
function splitFor(token,points,costs,available){
  const terrain=getNavigation(),size=bodyFor(token),dims=size.max.map((v,i)=>v-size.min[i]),obs=otherBodies(token);
  const [ox,oz]=adapter.origin(),u=adapter.scale();
  const voxel=p=>[(p.x-ox)/u,p.elevation/5,(p.y-oz)/u];
  return splitWalk(points,costs,available,{measure:ps=>nativeCosts(token,ps,ps.map(()=>0)).at(-1),
    ground:p=>{if(!terrain.surface)return p;const v=voxel(p),h=terrain.surface.level(v[0]+dims[0]/2,v[2]+dims[2]/2,v[1]);return Number.isFinite(h)?{...p,elevation:h*5}:null;},
    occupied:(a,b)=>occupiedIntervals(voxel(a),voxel(b),dims,obs),
    standing:p=>terrain.nav.standing(voxel(p),dims,obs)});
}
export async function executeMovement(value=preview,melee=false,manual=false){
  const token=selected();
  if(!token||!value?.valid||value.tokenId!==token.id||journey||moving||(!enabled&&!melee&&!jumpMode&&!manual)||!usable(melee))return false;
  if(!samePoint(value.source,sourcePosition(token))||value.terrainSignature!==getNavigation().signature)return false;
  const budget=budgetFor(token),order=journey={token,scene:canvas.scene,turn:budget.turn,cancelled:false,allowExtra:false};
  if(stormwreck3D()){
    actualTravel.delete(token.document);
    visual?.setMeter(movementMeter(token,value.jump?'jump':'walk'));
  }
  try{
    if(value.jump){
      if(value.cost>budget.budget+.005){if(!await askToContinue(order,budget.budget,true)||!orderIsCurrent(order))return false;}
      const verified=jumpTo(token,value.target);if(!verified.valid||!orderIsCurrent(order)){if(verified.reason)ui.notifications.warn(verified.reason);return false;}
      const reservation=await reserveJump(token);let committed=false;
      const command=foundry.utils.randomID(),duration=Math.min(690,Math.max(350,verified.cost*33));
      try{
        if(!orderIsCurrent(order)||!samePoint(verified.source,sourcePosition(token))||getNavigation().signature!==verified.terrainSignature)return false;
        registerJump(token.document,{command,source:verified.source,goal:verified.goal,cost:verified.cost});
        const result=await token.document.move([{...verified.goal,action:'jump',cost:verified.cost,explicit:true,snapped:false,checkpoint:true}],
          {method:'api',autoRotate:false,showRuler:false,constrainOptions:{ignoreCost:true,ignoreWalls:true},
          mcbJump:{command,apex:verified.apex,duration},animation:{duration}});
        committed=!!result&&samePoint(verified.goal,sourcePosition(token));return committed;
      }finally{unregisterJump(token.document);await finishJump(reservation,committed);}
    }
    const traffic=walkingTraffic(token);
    if(traffic&&occupiedEnd(traffic,value.waypoints.at(-1))){ui.notifications.warn('落点已被其他角色占据');return false;}
    const costs=traffic?nativeCosts(token,value.waypoints,value.costs):value.costs;
    const split=splitFor(token,value.waypoints,costs,budget.budget);
    if(split.first.length>1){
      const ok=await submitLeg(value,split.first,melee);
      if(!ok&&!order.limitChanged)return false;
      while(moving&&!order.cancelled)await new Promise(r=>setTimeout(r,25));
      if(!orderIsCurrent(order))return false;
      if(!samePoint(sourcePosition(token),split.first.at(-1))&&!order.limitChanged)return false;
    }
    if(!split.exhausted&&!order.limitChanged)return orderIsCurrent(order);
    if(!orderIsCurrent(order))return false;
    if(!await askToContinue(order,budgetFor(token).budget)||!orderIsCurrent(order))return false;
    order.allowExtra=true;
    const goal=value.waypoints.at(-1);if(samePoint(sourcePosition(token),goal))return true;
    const center=centerPoints([goal],token)[0],next=await planMovementTo(token,center,{stale:()=>!orderIsCurrent(order)});
    if(!next?.valid||!orderIsCurrent(order)){if(next?.reason)ui.notifications.warn(next.reason);return false;}
    if(!await submitLeg(next,next.waypoints,melee))return false;
    while(moving&&!order.cancelled)await new Promise(r=>setTimeout(r,25));
    return orderIsCurrent(order)&&samePoint(goal,sourcePosition(token));
  }catch(error){ui.notifications.warn(error.message??String(error));return false;}
  finally{
    if(journey===order)journey=null;
    if(value.jump)jumpMode=false;
    clearPreview();pulse();updateButton();schedulePreview(50);
  }
}
async function submitLeg(value,waypoints,melee) {
  const token = selected();
  if (!usable(melee) || moving || !token || !value?.valid || value.tokenId !== token.id) return false;
  if (game.paused && !game.user.isGM) return false;
  if (!samePoint(value.source, sourcePosition(token)) || getNavigation().signature !== value.terrainSignature) { cached = null; clearPreview(); return false; }
  if (waypoints.length < 2) return true;
  const action = CONFIG.Token.movement.actions.walk ? 'walk' : token.document.movementAction;
  const points = waypoints.slice(1).map(p => ({ ...p, action, snapped: false, explicit: true, checkpoint: true }));
  const state = moving = { token, submitted: false, signature: value.terrainSignature, started: performance.now(),
    command: foundry.utils.randomID(), nativeIds: new Set(), route: waypoints.map(p => ({ ...p })), cursor: 0, lastPosition: { ...value.source } };
  requestTick();
  try {
    const result = await token.document.move(points, { method: 'api', autoRotate: false, showRuler: false,
      constrainOptions: { ignoreCost: true }, mcbPathMovement: true, mcbPathCommand: state.command, animation: { movementSpeed: 3 } });
    state.submitted = true;
    if (!result && moving === state) { moving = null; clearPreview(); }
    return result;
  } catch (error) {
    if (moving === state) moving = null;
    clearPreview(); ui.notifications.error(`移动失败：${error.message}`); console.error(`${ID}: one-click movement`, error); return false;
  }
}
export function stopMovement({ force = false,retainOrder=false } = {}) {
  groundOrder++;groundPending=false;
  if(journey&&!retainOrder){journey.cancelled=true;journey.dialog?.close();if(pendingAttack)pendingAttack.cancelled=true;}
  const state = moving, doc = state?.token.document;
  if (state && !force && active3D() && doc.parent === canvas.scene && state.token.isOwner && !doc.locked
    && (!game.paused || game.user.isGM) && !adapter.isEditing() && doc.movement.user.isSelf
    && doc.movement.state === 'pending' && doc.movement.pending.waypoints.length && state.nativeIds.has(doc.movement.id)
    && getNavigation().signature === state.signature) {
    const body = bodyFor(state.token), size = body?.max.map((n, i) => n - body.min[i]);
    if (body && !getNavigation().nav.standing(body.min, size, walkingTraffic(state.token)?.occupants)) {
      // A climb has a short, intentionally unsupported lift checkpoint. A user
      // cancellation finishes only the next already-validated landing segment.
      state.stopRequested = true; cached = null; clearPreview(); updateButton(); requestTick(); return true;
    }
  }
  moving = null;
  if (doc?.movement.user.isSelf) doc.stopMovement();
  cached = null; clearPreview(); updateButton(); return !!state;
}
export function setMovementEnabled(value) {
  enabled = !!value;
  if(enabled)jumpMode=false;
  if (!enabled) stopMovement();
  pulse();updateButton(); schedulePreview(0);
  return enabled;
}
export function movementStatus() {
  return { enabled,jump:jumpMode,waiting:!!journey?.dialog, moving: !!moving, performance:{...perf}, stopRequested: !!moving?.stopRequested, tokenId: moving?.token.id ?? selected()?.id ?? null, grounding: groundingStatus(),
    preview: preview ? { valid: preview.valid, points: preview.points, costs: preview.costs, cost: preview.cost, budget: preview.budget,
      speed: preview.speed, spent: preview.spent, reason: preview.reason, visited: preview.visited, tokenId: preview.tokenId } : null };
}
function updateButton() {
  if (!button) return;
  const token=selected();
  button.update({ available: active3D() && !adapter.isEditing(), enabled,jump:jumpMode,jumpLimits:token?strengthJump(token):null,moving: !!moving, stopping: !!moving?.stopRequested });
}
function mount() {
  attachRuler();
  const controls=engine()?.controls;if(cameraControls!==controls){cameraControls?.removeEventListener('change',cameraChanged);cameraControls=controls;controls?.addEventListener('change',cameraChanged);}
  button ??= createMovementToggle({ onClick: () => moving ? stopMovement() : setMovementEnabled(!enabled),onJump:()=>setJumpEnabled(!jumpMode) });
  updateButton();
  button.refresh();
}
function ownCommand(doc, move, options) {
  const state = moving;
  if (!state || state.token.document !== doc) return false;
  return (options.mcbPathMovement && options.mcbPathCommand === state.command)
    || (doc.movement.user.isSelf && move.chain.some(id => state.nativeIds.has(id)));
}
function cancelRejected(state, doc, movementId, reason) {
  if (moving !== state || state.token.document !== doc || doc.movement.id !== movementId) return;
  if (reason) ui.notifications.warn(reason);
  if (doc.movement.user.isSelf) stopMovement({ force: true });
  else { moving = null; cached = null; clearPreview(); }
}
function watchContinuation(state) {
  const doc = state.token.document, continuation = doc._movementContinuation;
  if (doc.movement.state !== 'pending' || !state.nativeIds.has(doc.movement.id)
    || continuation?.movementId !== doc.movement.id || !continuation.continuePromise || state.watched === continuation.continuePromise) return;
  const promise = state.watched = continuation.continuePromise, movementId = doc.movement.id;
  Promise.resolve(promise).then(allowed => {
    if (allowed === false) cancelRejected(state, doc, movementId, '后续移动被规则或障碍拒绝，路线已停止');
  }, error => { console.error(`${ID}: native movement continuation`, error); cancelRejected(state, doc, movementId, '后续移动失败，路线已停止'); });
}
function authorizeGrounding(doc, updates, options) {
  if(allowsSpellMove(doc,updates,options))return true;
  const evidence = options && approvedUpdates.get(options), state = moving;
  if (!active3D() || game.user.isGM || !evidence || evidence.state !== state || state.token.document !== doc
    || evidence.doc !== doc || !evidence.intermediate || !evidence.unsupported || options._movement?.[doc.id]?.id !== evidence.moveId
    || !doc.isOwner || doc.locked || game.paused || adapter.isEditing() || getNavigation().signature !== state.signature) return false;
  if (!['x', 'y', 'elevation'].some(key => key in updates)) return false;
  const actual = { ...sourcePosition(state.token), ...Object.fromEntries(['x', 'y', 'elevation'].filter(key => key in updates).map(key => [key, updates[key]])) };
  return samePoint(actual, evidence.destination) && samePoint(sourcePosition(state.token), evidence.origin);
}
function validateNativeMove(doc, move, options) {
  if (!active3D() || doc.parent !== canvas.scene) return;
  if(!ownCommand(doc,move,options)){
    if(!doc.isOwner||!doc.object||options.teleport||options.isUndo||options.mcbJump||!['dragging','keybinding','keyboard','ruler'].includes(move.method))return;
    const token=doc.object,[ox,oz]=adapter.origin(),u=adapter.scale(),dim=[doc.width,Math.max(doc.width,doc.height),doc.height];
    const toVoxel=p=>[(p.x-ox)/u,p.elevation/5,(p.y-oz)/u];
    const path=[move.origin,...move.passed.waypoints];
    const traffic=walkingTraffic(token);
    if(traffic&&occupiedEnd(traffic,move.pending.waypoints.at(-1)??move.destination)){
      ui.notifications.warn('落点已被其他角色占据');return false;
    }
    if(path.slice(1).some((p,i)=>getNavigation().barriers.blocks(toVoxel(path[i]),toVoxel(p),dim))){ui.notifications.warn('墙体或关闭的门挡住了去路');return false;}
    const budget=budgetFor(token),cost=nativeCosts(token,path,path.map(()=>0)).at(-1);
    if(budget.inCombat&&cost>=budget.budget-.005&&cost>0&&selected()===token&&!journey){
      const end=move.pending.waypoints.at(-1)??move.destination;
      setTimeout(async()=>{if(journey||selected()!==token)return;const plan=await planMovementTo(token,centerPoints([end],token)[0],{stale:()=>selected()!==token});if(plan?.valid)void executeMovement(plan,false,true);},0);
      return false;
    }
    return;
  }
  function reject(reason) {
    const state = moving, movementId = doc.movement.id;
    if (reason) ui.notifications.warn(reason);
    // Reject the current update first. Then cancel this exact native command;
    // never cancel a new order submitted before this callback gets its turn.
    if (state?.token.id === doc.id) setTimeout(() => {
      cancelRejected(state, doc, movementId);
    }, 0);
    return false;
  }
  const token = doc.object, body = token && bodyFor(token);
  if (!body || !token.isOwner || doc.locked || (game.paused && !game.user.isGM)) return reject('移动权限或暂停状态已改变，移动已停止');
  if (moving?.token.id === doc.id && moving.signature !== getNavigation().signature) return reject('地形或门已改变，请重新选择路线');
  const state = moving, target = state.route[state.cursor + 1];
  if(journey&&!journey.allowExtra&&Number.isFinite(budgetFor(token).budget)){
    const cost=nativeCosts(token,[move.origin,move.destination],[0,0]).at(-1);
    if(cost>budgetFor(token).budget+.035){
      journey.limitChanged=true;setTimeout(()=>{if(moving===state)stopMovement({force:true,retainOrder:true});},0);return false;
    }
  }
  if (!target || !samePoint(move.origin, state.lastPosition) || move.constrained
    || !move.passed.waypoints.every(point => onSegment(point, move.origin, target)
      || isObservatoryPortalCheckpoint(doc, move, target, point))) return reject('实际移动与已验证路线不一致，路线已停止');
  const [ox, oz] = adapter.origin(), unit = adapter.scale(), size = body.max.map((n, i) => n - body.min[i]);
  const traffic=walkingTraffic(token),bodies=traffic?.occupants??otherBodies(token),obstacles=traffic?[]:bodies;
  const toVoxel = p => [(p.x - ox) / unit, p.elevation / 5, (p.y - oz) / unit];
  let from = toVoxel(move.origin);
  for (const point of move.passed.waypoints) {
    const to = toVoxel(point), sweep = { min: from.map((n, i) => Math.min(n, to[i])), max: from.map((n, i) => Math.max(n, to[i]) + size[i]) };
    const nearby = getNavigation().nav.query(sweep).concat(obstacles);
    if(getNavigation().barriers.blocks(from,to,size))return reject('墙体或关闭的门挡住了去路');
    if (getNavigation().surface && !getNavigation().surface.traversable(from, to, size)) return reject('路径离开可行走地面');
    if (sweptBodyBlocked(from, to, size, nearby)) return reject('路线被构件或其他角色阻挡');
    const a = footPoint(from), b = footPoint(to), eye = Math.max(.1, size[1] * 5 * .7);
    if (!samePoint(a, b) && engine().interactionManager.computeSightCollision(
      { x: a.x + token.w / 2, y: a.y + token.h / 2, z: a.elevation + eye },
      { x: b.x + token.w / 2, y: b.y + token.h / 2, z: b.elevation + eye }, 'collision')) return reject('路线被场景障碍阻挡');
    from = to;
  }
  const intermediate = !samePoint(move.destination, state.route.at(-1));
  const supported = getNavigation().nav.standing(toVoxel(move.destination), size, obstacles);
  const standing = supported&&(!traffic||!occupiedEnd(traffic,move.destination));
  if ((!intermediate && !standing) || (intermediate && !move.pending.waypoints.length)) return reject('路线终点缺少站立支撑，移动已停止');
  state.nativeIds.add(move.id);
  approvedUpdates.set(options, { state, doc, moveId: move.id, origin: { ...move.origin }, destination: { ...move.destination }, intermediate, unsupported: !supported });
}

function occupiedEnd(traffic,point){
  const min=traffic.position(point),body={min,max:min.map((v,i)=>v+traffic.size[i])};
  return traffic.occupants.some(other=>boxesOverlap(body,other));
}

export function installMovement(options) {
  if (installed) return; installed = true; adapter = options; installTokenVolume(adapter); installGroundingAdapter(authorizeGrounding);installJump();
  Hooks.once('init', () => {
    game.settings.register(ID, 'maxStepHeight', { name: '一键移动：最大攀升／下降高度', hint: '单次允许上下的方块高度（尺）。路线仍检查支撑与身体碰撞。', scope: 'world', config: true, type: Number, default: 5, range: { min: 2.5, max: 10, step: 2.5 }, onChange: () => { navigation = cached = null; revision++; } });
    game.keybindings.register(ID, 'toggleMovement', { name: '切换一键移动', hint: 'MC三维场景中切换鼠标点击移动。', editable: [{ key: 'KeyM' }], onDown: context => { if (!active3D() || adapter.isEditing() || aiming() || inputTarget(context?.event?.target ?? document.activeElement)) return false; setMovementEnabled(!enabled); return true; }, precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL });
  });
  installMeleeHooks({beforeAttack,cancel:cancelAttack,hover(ev,hud){rememberPointer(ev);const key=hud.selection?.activityId;if(key!==aimKey){aimKey=key;schedulePreview(0);}}});
  window.addEventListener('pointermove',rememberPointer,true);
  window.addEventListener('resize',cameraChanged);
  window.addEventListener('pointerdown', event => {
    if(!canvasTarget(event.target))return;
    const native=event.button===2?selected()?.document:null,ownNative=native?.movement?.user?.isSelf&&native.movement.state==='pending';
    if(event.button===2&&(journey||moving||pendingAttack||jumpMode||groundPending||ownNative)){
      event.preventDefault();event.stopImmediatePropagation();suppressRight=performance.now()+650;
      cancelAttack();if(ownNative&&!moving)native.stopMovement();stopMovement();if(jumpMode)setJumpEnabled(false);return;
    }
    if ((!enabled&&!jumpMode) || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !usable()) return;
    const provider=canvas.scene.getFlag(ID,'config')?.terrainProvider;
    if(game.modules.get(provider)?.api?.doorAt?.(event.clientX,event.clientY))return;
    if (pickTokenVolume(event.clientX, event.clientY)) { consumeUntil = 0; return; }
    const token = selected(); if (!token) return;
    event.preventDefault(); event.stopImmediatePropagation(); consumeUntil = performance.now() + 600;
    if (moving) return;
    ++generation;clearTimeout(debounce);debounce=undefined;
    const order=++groundOrder, scene=canvas.scene, goal=walkingPoint(event.clientX,event.clientY,getNavigation().surface);groundPending=true;
    const changed=()=>order!==groundOrder||(!enabled&&!jumpMode)||selected()!==token||canvas.scene!==scene||!usable();
    Promise.resolve(jumpMode?jumpTo(token,goal):planMovementTo(token,goal,{stale:changed})).then(plan=>{
      if(!plan||changed())return;drawPreview(plan);if(plan.valid)void executeMovement(plan);else if(plan.reason)ui.notifications.warn(plan.reason);
    }).finally(()=>{if(order===groundOrder)groundPending=false;});
  }, true);
  for(const type of ['mousedown','mouseup','pointerup','contextmenu','auxclick'])window.addEventListener(type,event=>{
    if((event.button===2||type==='contextmenu')&&performance.now()<suppressRight&&canvasTarget(event.target)){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  window.addEventListener('keydown',e=>{if(e.code==='Escape'&&(jumpMode||journey?.dialog)&&!inputTarget(e.target)){stopMovement();setJumpEnabled(false);}},true);
  for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) window.addEventListener(type, event => {
    if (event.button === 0 && performance.now() < consumeUntil && canvasTarget(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('keydown', event => { if (event.code !== 'Escape' || (!enabled && !moving) || inputTarget(event.target) || aiming()) return; event.preventDefault(); event.stopImmediatePropagation(); if (moving) stopMovement(); else { setMovementEnabled(false); clearPreview(); } }, true);
  Hooks.on('preMoveToken', validateNativeMove);
  Hooks.on('preUpdateToken',(doc,change,options)=>{
    // 3D Canvas submits a ground drag as a plain document update with its free-mode marker.
    if(!active3D()||options.mcbJump||options.mcbPathMovement||options.teleport||options.isUndo||journey||doc.object!==selected()
      ||change.flags?.['levels-3d-preview']?.wasFreeMode!==false||!['x','y','elevation'].some(k=>k in change))return;
    const token=doc.object,budget=budgetFor(token);
    const from=sourcePosition(token),to={x:change.x??from.x,y:change.y??from.y,elevation:change.elevation??from.elevation};
    const traffic=walkingTraffic(token);
    if(traffic&&occupiedEnd(traffic,to)){engine().tokens[doc.id]?.setPosition(true);ui.notifications.warn('落点已被其他角色占据');return false;}
    if(!budget.inCombat)return;
    const cost=nativeCosts(token,[from,to],[0,0]).at(-1);
    if(cost<=0||cost<budget.budget-.005)return;
    setTimeout(async()=>{if(selected()!==token||journey)return;engine().tokens[doc.id]?.setPosition(true);
      const v=await planMovementTo(token,centerPoints([to],token)[0],{stale:()=>selected()!==token});if(v?.valid)void executeMovement(v,false,true);},0);
    return false;
  });
  Hooks.on('moveToken', (doc, move, options, user) => {
    if(stormwreck3D() && doc.parent===canvas.scene && user.isSelf && !options.isUndo && !options.teleport){
      const action=move.passed.waypoints.at(-1)?.action ?? doc.movementAction;
      if(!CONFIG.Token.movement.actions[action]?.teleport && Number.isFinite(move.passed.distance) && move.passed.distance>0){
        const prior=journey?.token.document===doc ? actualTravel.get(doc)?.distance??0 : move.history.unrecorded.distance;
        const distance=prior+move.passed.distance;
        actualTravel.set(doc,{action,distance,at:performance.now()});
        if(preview?.tokenId===doc.id)visual?.setMeter(movementMeter(doc.object,preview.jump||jumpMode?'jump':'walk',distance));
        requestTick();
      }
    }
    const state = moving;
    if (!state || state.token.document !== doc || !state.nativeIds.has(move.id)) return;
    state.lastPosition = { ...move.destination };
    if (state.route[state.cursor + 1] && samePoint(move.destination, state.route[state.cursor + 1])) state.cursor++;
    if (state.stopRequested) {
      const body = bodyFor(state.token), size = body?.max.map((n, i) => n - body.min[i]);
      if (body && getNavigation().nav.standing(body.min, size, walkingTraffic(state.token)?.occupants)) stopMovement({ force: true });
    }
  });
  for (const event of ['ready', 'canvasReady', '3DCanvasSceneReady']) Hooks.on(event, () => setTimeout(mount, 0));
  for (const event of ['controlToken','createToken','updateToken','updateCombat','deleteCombat','deleteToken','updateActor','updateItem','createActiveEffect','updateActiveEffect','deleteActiveEffect','updateTile','createTile','deleteTile','updateWall','createWall','deleteWall']) Hooks.on(event,()=>{
    cached=null;meleeRequest=null;revision++;
    if(journey?.dialog&&!orderIsCurrent(journey))stopMovement();
    if(meleeActivity()&&/Wall|Tile/.test(event))globalThis.__dshCombatPanel?._invalidatePreview?.();
    if(enabled||jumpMode||meleeActivity())schedulePreview();
  });
  Hooks.on('3DCanvasToggleMode', value => {
    if (value) { mount(); return; }
    const scoped = stormwreck3D();
    detachRuler();
    jumpMode=false;
    stopMovement({force:true});
    setMovementEnabled(false);
    visual?.destroy();
    visual=null;
    // The 3D Canvas toggle hook runs just before its close updates _active.
    if (scoped) queueMicrotask(updateButton);
  });
  Hooks.on('canvasTearDown', () => {detachRuler();jumpMode=false; cancelAttack();cameraControls?.removeEventListener('change',cameraChanged);cameraControls=null;stopMovement({ force: true }); setMovementEnabled(false);visual?.destroy();visual=null;navigation=cached=null;pointer=null;clearTimeout(debounce);debounce=undefined;clearInterval(idlePulse);if(frame!==undefined)cancelAnimationFrame(frame);frame=null; });
}
