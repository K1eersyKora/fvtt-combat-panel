import {ID,active3D} from './combat-space-2.js';

const EPS_FEET=0.0001;
const rangedTypes=new Set(['rwak','rsak','rpak']);
let installed=false,nativeRange,nativeDistance;
export function attackKind(activity,mode){
  const current=mode??activity?.item?.flags?.dnd5e?.last?.[activity.id]?.attackMode;
  return activity?.getActionType?.(current)??activity?.actionType;
}
export function weaponReach(activity){
  const item=activity.item,reach=Number(item?.system?.range?.reach),explicit=Number(activity.range?.value);
  if(item?.type==='weapon'&&item.system?.properties?.has('thr')&&!rangedTypes.has(attackKind(activity))){
    return reach>0?reach:item.system.properties.has('rch')?10:5;
  }
  return activity.range?.units==='ft'&&explicit>0?explicit:reach>0?reach:item?.system?.properties?.has('rch')?10:5;
}

function tokenOf(value){
  const entity=typeof value==='string'?globalThis.fromUuidSync?.(value):value;
  if(entity?.document?.documentName==='Token')return entity;
  return entity?.documentName==='Token'?entity.object:null;
}
function pair(source,target){
  const a=tokenOf(source),b=tokenOf(target);
  return active3D()&&a?.document.parent===canvas.scene&&b?.document.parent===canvas.scene?[a,b]:null;
}
function dimensions(token){
  const doc=token.document,u=canvas.grid.size;
  const visual=game.Levels3DPreview.tokens[token.id];
  const height=Math.max(Number(doc.width),Number(doc.height),Number(visual?.d)*game.Levels3DPreview.factor/u||0);
  return {min:[doc.x/u,doc.elevation/canvas.scene.grid.distance,doc.y/u],size:[doc.width,height,doc.height]};
}
// Shortest straight line between occupied cell centers. For ordinary one-square tokens
// this is the Euclidean distance between centers, including their elevation difference.
export function occupiedDistance(a,b,unit=5){
  const offsets=a.min.map((v,i)=>{
    const centers=v+a.size[i]/2-b.min[i]-b.size[i]/2;
    const padding=(Math.max(0,a.size[i]-1)+Math.max(0,b.size[i]-1))/2;
    return Math.max(0,Math.abs(centers)-padding);
  });
  return Math.hypot(...offsets)*unit;
}
export function sceneDistance(source,target){
  const t=pair(source,target);return t?occupiedDistance(dimensions(t[0]),dimensions(t[1]),canvas.scene.grid.distance):null;
}
function aimPoints(t){
  const d=t.document,sz=dimensions(t).size,feet=canvas.scene.grid.distance,u=canvas.grid.size;
  return [[.5,.5,.65],[.21,.21,.65],[.79,.21,.65],[.21,.79,.65],[.79,.79,.65],[.5,.5,.85]].map(([x,y,h])=>({
    x:d.x+x*sz[0]*u,y:d.y+y*sz[2]*u,z:d.elevation+h*sz[1]*feet
  }));
}
export function clearSight(source,target){
  const t=pair(source,target);if(!t||t[0].id===t[1].id)return true;
  const a=aimPoints(t[0]),b=aimPoints(t[1]),im=game.Levels3DPreview.interactionManager;
  // A visible corner still permits a shot. Cover modifiers stay with the original workflow.
  const directional=canvas.scene.walls.some(w=>w.dir&&w.sight);
  for(const p of a)for(const q of b){
    if(im.computeSightCollision(p,q,'sight'))continue;
    // Thin imported floors and cliff faces can have one-sided triangles. A solid
    // surface blocks in both directions unless the map contains directional sight walls.
    if(directional||!im.computeSightCollision(q,p,'sight'))return true;
  }
  return false;
}
function ignoreCover(activity,source){
  return !!activity?.midiProperties?.ignoreFullCover||!!source.actor?.flags?.['midi-qol']?.ignoreWalls;
}
function applicable(activity){
  const affects=activity?.target?.affects?.type;
  return !!activity&&!activity.target?.template?.type&&affects!=='self'&&
    (activity.type==='attack'||['ally','enemy','creature','creatureOrObject','object','willing'].includes(affects)||
    (!affects&&activity.type==='utility'&&['ft','touch','mi'].includes(activity.range?.units)));
}
function fmt(distance){return Number(distance.toFixed(2));}
function assess(activity,source,targets,original){
  if(!applicable(activity)||!targets.length)return original;
  const nativeSourceToken=tokenOf(original.attackingToken);
  const testSource=nativeSourceToken&&nativeSourceToken.id!==source.id?nativeSourceToken:source;
  if(!targets.every(t=>pair(testSource,t)))return original;
  const kind=activity.type==='attack'?attackKind(activity):null;
  const meleeThrown=kind==='mwak'&&activity.item?.system?.properties?.has('thr');
  const sourceRange=activity.range??{};
  const layOnHands=activity.item?.getFlag('fvtt-automation-repair','abilityAutomation')?.key==='layOnHands';
  const declared=layOnHands||sourceRange.units==='touch'?5:Number(sourceRange.value)*(sourceRange.units==='mi'?5280:1);
  // Midi does not populate its range fields for several utility target types, including
  // willing creatures, objects and a point. Their actual activity still declares a range.
  const nativeLimit=Number(original.range),range=meleeThrown?weaponReach(activity):nativeLimit>0?nativeLimit:declared;
  const long=meleeThrown?0:Number(original.longRange??sourceRange.long)||0;
  const isAttack=activity.type==='attack';
  const limits=Number.isFinite(range)&&range>0&&(layOnHands||['ft','touch','mi'].includes(sourceRange.units));
  const nativeSource=testSource.actor?.flags?.['midi-qol']??{};
  if(nativeSource.rangeOverride?.attack?.all||nativeSource.rangeOverride?.attack?.[activity.actionType])return original;
  let result='normal',reason='',longest=0;
  if(original.result==='fail'&&!limits)return original;
  for(const t of targets){
    if(t.id===testSource.id)continue;
    const d=sceneDistance(testSource,t);longest=Math.max(longest,d);
    if((isAttack||activity.item?.getFlag('chris-premades','info')?.identifier==='cuttingWords')&&
      !ignoreCover(activity,testSource)&&!clearSight(testSource,t)){
      return {...original,result:'fail',reason:'实体地形遮挡了攻击或反应的视线',spatialBlock:'cover',distance:d};
    }
    if(!limits)continue;
    const maximum=Math.max(range,long);
    if(d>maximum+EPS_FEET){
      const cfg=globalThis.MidiQOL?.configSettings?.();
      if(!(rangedTypes.has(kind)&&!cfg?.toggleOptionalRules&&cfg?.optionalRules?.checkRange==='longdisadv')){
        return {...original,result:'fail',spatialBlock:'range',reason:'三维距离 '+fmt(d)+' 尺，超出 '+fmt(maximum)+' 尺范围',distance:d};
      }
    }
    if(d>range+EPS_FEET){result='dis';reason='三维距离 '+fmt(d)+' 尺，超出正常射程 '+fmt(range)+' 尺';}
    // Keep non-distance restrictions (conditions and other providers' full cover).
    if(original.result==='fail'){
      const opts={wallsBlock:!ignoreCover(activity,testSource),includeCover:!ignoreCover(activity,testSource)};
      const previous=nativeDistance?.(testSource,t,opts);
      const blocked=globalThis.MidiQOL?.WallsBlockConditions??[];
      if((previous!==undefined&&previous<0)||[...blocked].some(s=>t.actor?.statuses?.has(s)))return original;
    }
  }
  return {...original,result,reason,range,longRange:long,distance:longest,spatial:true};
}
export function activityRange(activity,source,target){
  if(!nativeRange||!pair(source,target)||!applicable(activity))return null;
  const native=nativeRange(activity,source,new Set([target]),false);
  return assess(activity,source,[target],native);
}
function gate({workflow,usage}){
  if(!active3D()||!workflow?.activity||!applicable(workflow.activity))return;
  const source=tokenOf(workflow.token??workflow.tokenUuid);
  if(!source)return;
  const targets=workflow.targets?.size?[...workflow.targets]:[...(usage?.midiOptions?.targetUuids??[])].map(tokenOf).filter(Boolean);
  for(const target of targets){
    const decision=activityRange(workflow.activity,source,target);
    if(decision?.result==='fail'){
      ui.notifications.warn(decision.reason||'目标不满足活动的范围条件');return false;
    }
    if(decision?.result==='dis'&&rangedTypes.has(attackKind(workflow.activity))){
      workflow.disadvantage=true;workflow.attackAdvAttribution?.add?.('DIS:三维远射程');
      workflow.workflowOptions??={};workflow.workflowOptions.mcbLongRange=true;
    }
  }
}
export function installSpatialRange(){
  Hooks.once('ready',()=>{
    const api=globalThis.MidiQOL;if(installed||!api?.checkActivityRange||!api.computeDistance||!api.findNearby)return;
    nativeRange=api.checkActivityRange.bind(api);nativeDistance=api.computeDistance.bind(api);
    libWrapper.register(ID,'MidiQOL.computeDistance',function(wrapped,source,target,opts){
      const exact=sceneDistance(source,target);if(exact===null)return wrapped(source,target,opts);
      const walls=opts===true||opts?.wallsBlock;
      if(walls||opts?.includeCover){const old=wrapped(source,target,opts);if(old<0)return old;}
      return exact;
    },'MIXED');
    libWrapper.register(ID,'MidiQOL.findNearby',function(wrapped,disposition,source,radius,opts){
      const t=tokenOf(source);if(!t||!active3D()||t.document.parent!==canvas.scene||!Number.isFinite(radius)||radius<0)return wrapped(disposition,source,radius,opts);
      // Let Midi apply its original disposition, incapacitation, size and sense filters.
      const nearby=wrapped(disposition,source,Infinity,opts);
      return nearby.filter(other=>{const d=sceneDistance(t,other);return d!==null&&d<=radius+EPS_FEET&&
        (!(opts?.canSee||opts?.isSeen||api.configSettings().optionalRules?.wallsBlockRange==='center')||clearSight(t,other));});
    },'MIXED');
    libWrapper.register(ID,'MidiQOL.canSee',function(wrapped,source,target,...args){
      const native=wrapped(source,target,...args);return native&&pair(source,target)?clearSight(source,target):native;
    },'MIXED');
    libWrapper.register(ID,'MidiQOL.checkActivityRange',function(wrapped,activity,source,targets,show=true){
      if(!active3D()||!applicable(activity))return wrapped(activity,source,targets,show);
      const token=tokenOf(source),list=Array.from(targets??[],tokenOf);
      if(!token||!list.length||list.some(t=>!t||!pair(token,t)))return wrapped(activity,source,targets,show);
      const result=assess(activity,token,list,wrapped(activity,source,targets,false));
      if(show&&result.result==='fail')ui.notifications.warn(result.reason||'目标超出作用范围');
      return result;
    },'MIXED');
    libWrapper.register(ID,'MidiQOL.Workflow.prototype.setTargets',function(wrapped,targets){
      const shape=this.activity?.target?.template,source=tokenOf(this.token);
      if(!active3D()||!source||shape?.type!=='emanationNoTemplate')return wrapped(targets);
      const keep=[],walls=String(api.configSettings().rangeTarget).startsWith('wallsBlock');
      for(const t of targets){
        const d=sceneDistance(source,t);
        if(d===null||d<=Number(shape.size)+EPS_FEET&&(!walls||clearSight(source,t)))keep.push(t);
        else if(game.user.targets.has(t))t.setTarget(false,{releaseOthers:false,user:game.user});
      }
      return wrapped(keep);
    },'MIXED');
    installed=true;
  });
  Hooks.on('midi-qol.preItemRollV2',gate);
}
