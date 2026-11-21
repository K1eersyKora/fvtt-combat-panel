import {ID,active3D,view3D,surfaceAt,worldPoint} from './combat-space-2.js';
import {sceneDistance,clearSight} from './spatial-range-1.js';
let installed=false,policy;
const pending=new Map(),previews=new Set(),placedMacros=new WeakSet();
const copy=v=>foundry.utils.deepClone(v);
function disposePreview(area){
  const entity=area._mcbMesh;if(!entity)return;
  entity.destroy();const geometries=new Set(),materials=new Set();
  entity.mesh.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o!==entity.collisionMesh&&o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
  for(const g of geometries){g.disposeBoundsTree?.();g.dispose();}for(const m of materials)m.dispose();area._mcbMesh=null;
}
function unitsPerPixel(){return canvas.scene.grid.distance/canvas.grid.size;}
function updateRay(template){const d=template.document;template.ray=Ray.fromAngle(d.x,d.y,d.direction*Math.PI/180,d.distance/unitsPerPixel());template._refreshShape();}
function shapeFlags(activity,doc){
  const shape=activity.target?.template??{},kind=shape.type;
  const special=kind==='cube'?Number(shape.size):kind==='square'?.15:kind==='cylinder'?Number(shape.height):doc.t==='ray'?Number(shape.height??shape.width??doc.width??5):0;
  return {special:Number.isFinite(special)?special:0};
}
function makePreview(area,point){
  const e=game.Levels3DPreview,t=area.objects[0],d=t.document;
  const signature=JSON.stringify([d.t,d.distance,d.width,d.angle,point.special]);
  if(area._mcbMesh&&area._mcbSignature!==signature)disposePreview(area);
  if(!area._mcbMesh){
    if(!d.id)d.updateSource({_id:foundry.utils.randomID()});
    const entity=new e.Classes.Template3D(t);entity.isPreview=true;entity.temporary=true;entity.draggable=false;entity.controlIcon.visible=false;
    // The PIXI preview stays hidden. The 3D engine has its own visibility pass,
    // which must not inherit that hidden 2D parent on the next frame.
    entity.placeable=new Proxy(t,{get(target,key){if(key==='visible')return !area._mcbHidden;if(key==='controlIcon')return {visible:false};if(key==='template')return {visible:!area._mcbHidden};return Reflect.get(target,key,target);}});
    entity.mesh.userData.interactive=false;entity.mesh.userData.ignoreHover=true;
    entity.mesh.traverse(o=>{o.userData.noIntersect=true;o.userData.ignoreHover=true;});
    area._mcbMesh=entity;area._mcbSignature=signature;previews.add(area);
  }
  const entity=area._mcbMesh;entity._origin=worldPoint(point);entity.mesh.position.copy(entity._origin);entity.mesh.position.y+=0.0001;
  if(['cone','ray'].includes(d.t)){entity.templateMesh.rotation.set(0,-point.direction*Math.PI/180,0);entity.templateMesh.rotateZ(point.tilt*Math.PI/180);}
  entity.mesh.visible=true;entity.mesh.updateMatrixWorld(true);
  return entity;
}
function covers(area,token,point,walls){
  const mesh=area._mcbMesh,e=game.Levels3DPreview;if(!mesh)return false;
  if(point.personalRadius){
    const source=area.hud.panel.token,d=sceneDistance(source,token);
    return d!==null&&d<=point.personalRadius+.0001&&(!walls||clearSight(source,token));
  }
  const height=Number(e.tokens[token.id]?.d)*e.factor*unitsPerPixel()||Math.max(token.document.width,token.document.height)*canvas.scene.grid.distance;
  const pose=token.document._source,base=pose.elevation,top=base+height,levels=[base+.001,(base+top)/2,top-.001];
  const zNearest=Math.max(base+.001,Math.min(top-.001,point.elevation));levels.push(zNearest);
  for(let x=token.document.width>=1?.5:token.document.width/2;x<token.document.width;x++)for(let y=token.document.height>=1?.5:token.document.height/2;y<token.document.height;y++)for(const z of levels){
    const p={x:pose.x+x*canvas.grid.size,y:pose.y+y*canvas.grid.size,z};
    let covered;
    const template=area.objects[0],kind=area.activity.target?.template?.type;
    if(template.document.t==='rect'&&['cube','square'].includes(kind)){
      const dx=(p.x-point.x)*unitsPerPixel(),dy=(p.y-point.y)*unitsPerPixel(),rad=point.direction*Math.PI/180;
      const ex=point.distance*Math.cos(rad),ey=point.distance*Math.sin(rad),epsilon=.001;
      const inside=dx>=Math.min(0,ex)-epsilon&&dx<=Math.max(0,ex)+epsilon&&dy>=Math.min(0,ey)-epsilon&&dy<=Math.max(0,ey)+epsilon;
      if(kind==='cube')covered=inside&&top>point.elevation+epsilon&&base<point.elevation+Number(area.activity.target.template.size)-epsilon;
      else{
        const sc=canvas.scene,u=sc.grid.size,dim=sc.getDimensions(),prov=sc.getFlag(ID,'config')?.terrainProvider;
        const field=game.modules.get(prov)?.api?.movementSurface?.(sc);
        const h=field?.level((p.x-dim.sceneX)/u,(p.y-dim.sceneY)/u,point.elevation/5);
        const ground=Number.isFinite(h)?h*5:point.elevation;
        covered=inside&&Math.abs(ground-point.elevation)<=sc.grid.distance&&Math.abs(base-ground)<=.35;
      }
    }else if(mesh.shape==='sphere'){const dx=(p.x-point.x)*unitsPerPixel(),dy=(p.y-point.y)*unitsPerPixel();covered=Math.hypot(dx,dy,z-point.elevation)<=template.document.distance+1e-4;}
    else covered=mesh.contains(p);
    if(!covered)continue;
    if(!walls||!e.interactionManager.computeSightCollision({x:point.x,y:point.y,z:point.elevation+.01},p,'sight'))return true;
  }
  return false;
}
function decorate(area){
  if(!area||area._mcb)return;
  const choice=!!area.hud.selection?.plan?.areaChoice;
  area._mcb=true;const destroy=area.destroy.bind(area),hide=area.hide.bind(area);
  area.destroy=function(){previews.delete(this);disposePreview(this);destroy();};
  area.hide=function(){if(choice&&!this.disposed)return;this._mcbHidden=true;if(this._mcbMesh)this._mcbMesh.mesh.visible=false;hide();};
  area.move=function(ev,{force=false}={}){
    if(this.disposed||!this.objects[0]?.shape||!ev)return;
    const now=performance.now();if(!force&&now-(this._mcbMoveAt??0)<30)return;this._mcbMoveAt=now;
    const source=this.hud.panel.token,t=this.objects[0],d=t.document;
    const self=this.activity.range?.units==='self',kind=this.activity.target?.template?.type;
    const personalRadius=self&&['radius','emanation','emanationNoTemplate'].includes(kind)?Number(this.activity.target.template.size):0;
    const hit=personalRadius&&source?{...source.center,elevation:source.document.elevation}:surfaceAt(ev.clientX,ev.clientY);
    if(!hit||!source){this.point=null;this.targets=[];this.hide();return;}
    let pos=self?{...source.center,elevation:source.document.elevation}:{...t.getSnappedPosition(hit),elevation:hit.elevation};
    if(personalRadius){
      pos.elevation+=Math.max(source.document.width,source.document.height)*canvas.scene.grid.distance/2;
      d.updateSource({distance:personalRadius});
    }
    let direction=d.t==='rect'?45:this.rotation,tilt=0;
    if(self&&['cone','ray'].includes(d.t)){
      const dx=hit.x-pos.x,dy=hit.y-pos.y;direction=Math.atan2(dy,dx)*180/Math.PI+this.rotation;
      if(kind!=='cube')tilt=Math.atan2(hit.elevation-pos.elevation,Math.hypot(dx,dy)*unitsPerPixel())*180/Math.PI;
    }
    if(self&&kind==='cube'){
      const a=Math.atan2(hit.y-source.center.y,hit.x-source.center.x)*180/Math.PI+this.rotation;
      const side=Number(this.activity.target.template.size)/unitsPerPixel(),w=source.w/2,h=source.h/2;
      if(d.t==='rect'){
        const facing=((Math.round(a/90)%4)+4)%4;const p=[{x:source.center.x+w,y:source.center.y-side/2},{x:source.center.x-side/2,y:source.center.y+h},{x:source.center.x-w-side,y:source.center.y-side/2},{x:source.center.x-side/2,y:source.center.y-h-side}][facing];
        pos={...t.getSnappedPosition(p),elevation:source.document.elevation};direction=45;
      }else{direction=a;const r=a*Math.PI/180,dx=Math.cos(r),dy=Math.sin(r),offset=Math.abs(dx)*w+Math.abs(dy)*h;pos={x:source.center.x+dx*offset,y:source.center.y+dy*offset,elevation:source.document.elevation};}
    }
    const {special}=shapeFlags(this.activity,d);
    const point={x:pos.x,y:pos.y,elevation:Math.round(pos.elevation*10000)/10000,direction,tilt,special,distance:d.distance,mcb3d:true,...(personalRadius?{personalRadius}:{})};
    const key=JSON.stringify([point,canvas.tokens.placeables.map(t=>[t.id,t.document._source.x,t.document._source.y,t.document._source.elevation,t.visible,t.document.hidden,t.actor?._stats?.modifiedTime])]);this.point=point;this._mcbHidden=false;
    if(!force&&key===this._mcbPointKey&&this._mcbMesh){this._mcbMesh.mesh.visible=true;return;}
    this._mcbPointKey=key;
    d.updateSource({x:point.x,y:point.y,elevation:point.elevation,direction,flags:{levels:{special},'levels-3d-preview':{tilt},[ID]:{area:point,preview:true}}});
    updateRay(t);t.visible=false;makePreview(this,point);
    let settings;try{settings=MidiQOL.configSettings();}catch{settings={};}
    const override=this.activity.midiProperties?.autoTargetAction,auto=override&&override!=='default'?override:settings.autoTarget??'always';
    this.targets=canvas.tokens.placeables.filter(token=>policy.areaTargetAllowed(token,source,this.activity,auto,settings)&&covers(this,token,point,String(auto).startsWith('wallsBlock')));
  };
  if(choice)area.refresh=function(options={}){this.move(this.hud.lastPoint??{clientX:0,clientY:0},options);};
  area.rangeCheck=function(){
    if(!this.point)return {allowed:false,message:'请指向可见地形表面'};
    const r=this.activity.range??{},source=this.hud.panel.token;if(['self','any','spec',''].includes(r.units)||r.units==null)return {allowed:true};
    let max=r.units==='touch'?canvas.scene.grid.distance:Number(r.value);if(!Number.isFinite(max))return {allowed:true};
    if(r.units==='mi')max*=5280;if(r.units==='km')max*=1000;
    const distance=Math.hypot((source.center.x-this.point.x)*unitsPerPixel(),(source.center.y-this.point.y)*unitsPerPixel(),source.document.elevation-this.point.elevation);
    return {allowed:distance<=max+.001,distance,max,message:`落点超出射程（${distance.toFixed(1)} / ${max} ${canvas.scene.grid.units}）`};
  };
}
function originOf(doc){return doc.flags?.dnd5e?.origin;}
function applyPlacement(doc){
  if(!active3D())return;
  const p=pending.get(originOf(doc));if(!p||p.scene!==doc.parent?.id||p.user!==game.user.id)return;
  const point=p.point;
  doc.updateSource({x:point.x,y:point.y,elevation:point.elevation,direction:point.direction,...(point.personalRadius?{distance:point.personalRadius}:{}),flags:{levels:{special:point.special},'levels-3d-preview':{tilt:point.tilt},[ID]:{area:copy(point),cast:copy(p.cast)}}});
}
async function mount(){
  if(installed||!['0.15.7','0.15.8'].includes(game.modules.get('fvtt-combat-panel')?.version)||!globalThis.__dshCombatPanel?.hud)return;
  policy=await import('../../fvtt-automation-repair/scripts/hud-area-targeting-3.js');if(installed)return;
  libWrapper.register(ID,'globalThis.__dshCombatPanel.hud.arm',function(w,...args){const result=w(...args);if(active3D())decorate(this.area);return result;},'WRAPPER');
  libWrapper.register(ID,'globalThis.__dshCombatPanel.hud.execute',async function(w,activity,usage,dialog,session){
    const point=session?.selection?.areaPoint;if(!active3D()||!point?.mcb3d)return w(activity,usage,dialog,session);
    const source=this.panel.token,cast={id:foundry.utils.randomID(),source:source.document.uuid,origin:activity.uuid,point:copy(point),user:game.user.id};
    const entry={point:copy(point),cast,scene:canvas.scene.id,user:game.user.id};pending.set(activity.uuid,entry);
    const clone=activity.item.clone({[`system.activities.${activity.id}.midiProperties.autoTargetAction`]:'none'},{keepId:true});
    const next=clone.system.activities.get(activity.id);usage.midiOptions??={};usage.midiOptions.workflowOptions??={};usage.midiOptions.workflowOptions.mcbCast=cast;usage.midiOptions.workflowOptions.forceTemplateTargeting=false;
    try{return await w(next,usage,dialog,session);}finally{if(pending.get(activity.uuid)===entry)pending.delete(activity.uuid);}
  },'WRAPPER');
  // Height describes the box cross-section, not a diagonal increase in ray length.
  libWrapper.register(ID,'game.Levels3DPreview.Classes.Template3D.prototype.pointsFromData',function(w,...args){const result=w(...args);if(this.template?.document?.flags?.[ID]?.area&&this.template.document.t==='ray')this.B.y=this.A.y;return result;},'WRAPPER');
  let at=0;libWrapper.register(ID,'globalThis.__dshCombatPanel.hud.syncAreaTargets',function(w,...args){if(this.area?._mcb){const now=performance.now();if(now-at<15)return;at=now;if(!this.busy&&!this.panel._drag?.hudHidden&&this.lastPoint)this.area.move(this.lastPoint);}return w(...args);},'MIXED');
  libWrapper.register(ID,'MidiQOL.Workflow.prototype.callMacros',function(wrapped,item,macros,tag,pass,...rest){
    if(pass!=='templatePlaced'||!this.workflowOptions?.mcbCast||item?.uuid!==this.item?.uuid)return wrapped(item,macros,tag,pass,...rest);
    if(placedMacros.has(this))return Promise.resolve([]);
    if(!this.templateUuid)return Promise.resolve([]);
    placedMacros.add(this);return wrapped(item,macros,tag,pass,...rest);
  },'MIXED');
  installed=true;
}
export function areaStatus(){return {installed,pending:pending.size,previews:previews.size};}
export function installCombatArea(){
  Hooks.on('preCreateMeasuredTemplate',applyPlacement);
  async function placed(workflow){
    const cast=workflow.workflowOptions?.mcbCast;
    if(!cast||placedMacros.has(workflow)||workflow.workflowOptions.noOnUseMacro||!MidiQOL.configSettings().allowUseMacro)return;
    const doc=workflow.templateUuid&&fromUuidSync(workflow.templateUuid);
    if(doc?.getFlag(ID,'cast')?.id!==cast.id)return;
    const macros=workflow.onUseMacros?.getMacros('templatePlaced');
    if(macros)await workflow.callMacros(workflow.item,macros,'OnUse','templatePlaced');
  }
  // A pre-positioned dnd5e template may send Midi directly from AwaitTemplate to
  // target confirmation. Deliver its configured placement pass once, after the document exists.
  Hooks.on('midi-qol.preambleComplete',placed);
  Hooks.on('midi-qol.postActiveEffects',placed);
  function band(template){
    const p=template?.getFlag(ID,'area');if(!p)return null;
    const h=template.elevation;
    if(template.t==='rect'&&p.special>0)return {bottom:h,top:h+p.special};
    if(template.t==='circle')return p.special>0?{bottom:h,top:h+p.special}:{bottom:h-template.distance,top:h+template.distance};
    return null;
  }
  Hooks.on('preUpdateRegion',(region,changes)=>{
    const uuid=foundry.utils.getProperty(changes,'flags.region-attacher.attachedTemplate')??changes['flags.region-attacher.attachedTemplate']??region.getFlag('region-attacher','attachedTemplate');
    if(!uuid)return;const extents=band(fromUuidSync(uuid));
    if(extents&&(region.elevation.bottom!==extents.bottom||region.elevation.top!==extents.top))changes.elevation=extents;
  });
  Hooks.on('updateMeasuredTemplate',(template,changes)=>{
    if(!game.users.activeGM?.isSelf||!('elevation' in changes))return;
    const uuid=template.getFlag('region-attacher','attachedRegion'),extents=band(template),region=uuid&&fromUuidSync(uuid);
    if(extents&&region&&(region.elevation.bottom!==extents.bottom||region.elevation.top!==extents.top))void region.update({elevation:extents});
  });
  for(const h of ['ready','canvasReady','3DCanvasSceneReady'])Hooks.on(h,()=>{void mount().catch(e=>console.error(`${ID} area adapter`,e));});
  Hooks.on('canvasTearDown',()=>{for(const a of [...previews])a.destroy();pending.clear();});
}
