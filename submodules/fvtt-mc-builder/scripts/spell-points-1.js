import {ID,active3D,surfaceAt} from './combat-space-2.js';

const moveCloud='920bfa86-2a3a-4e6a-ae7d-3d420c2c5992';
const accepted=new Map(),permits=new WeakMap();
let picker,teleports;
const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const origin=t=>({x:t.document._source.x+t.w/2,y:t.document._source.y+t.h/2,elevation:t.document._source.elevation});
const distance=(a,b)=>Math.hypot((a.x-b.x)*canvas.scene.grid.distance/canvas.grid.size,(a.y-b.y)*canvas.scene.grid.distance/canvas.grid.size,a.elevation-b.elevation);
const near=(a,b)=>Math.abs(a.x-b.x)<.7&&Math.abs(a.y-b.y)<.7&&Math.abs(a.elevation-b.elevation)<.04;
const documentTopLeft=(p,w,h)=>({x:Math.round(p.x-w*canvas.grid.size/2),y:Math.round(p.y-h*canvas.grid.size/2),elevation:p.elevation});
function teleportKind(activity){
  if(!activity?.item||activity.type!=='utility')return null;
  const item=activity.item,flags=item.flags?.['chris-premades'];
  if(flags?.macros?.midi?.item?.includes('mistyStep')&&game.modules.get('chris-premades')?.active)return 'cpr';
  if(norm(item.system.identifier)==='cloudsjaunt'&&teleports?.teleportWorkflow(activity)?.source?.startsWith('aa:'))return 'aa';
  return null;
}
function ownCloud(actor){
  return canvas.scene.templates.find(t=>{
    const cast=t.getFlag(ID,'cast'),r=t.getFlag('region-attacher','attachedRegion');
    return cast&&r&&fromUuidSync(cast.source)?.actor?.uuid===actor.uuid&&
      fromUuidSync(r)?.getFlag('region-attacher','actorUuid')===actor.uuid&&Number(t.getFlag('gambits-premades','codCastLevel'))>=2;
  });
}
function visibility(token,point,eye){
  const from=origin(token);from.z=from.elevation+Math.max(token.document.width,token.document.height)*canvas.scene.grid.distance*.65;
  const end={x:point.x,y:point.y,z:point.elevation+eye};
  const im=game.Levels3DPreview.interactionManager;
  if(im.computeSightCollision(from,end,'sight'))return false;
  return canvas.scene.walls.some(w=>w.dir&&w.sight)||!im.computeSightCollision(end,from,'sight');
}
function inspect(spec,surface){
  if(!surface)return {reason:'请指向三维场景中的表面'};
  const scene=canvas.scene,u=scene.grid.size,unit=scene.grid.distance,dim=scene.getDimensions(),p={...surface};
  const {token,width=1,height=1,solid=false}=spec;
  if(solid){
    const terrain=game.modules.get(scene.getFlag(ID,'config')?.terrainProvider)?.api?.movementSurface?.(scene);
    const x=(p.x-dim.sceneX)/u,z=(p.y-dim.sceneY)/u,level=terrain?.level(x,z,p.elevation/unit),size=[width,Math.max(width,height),height];
    if(terrain){
      if(!Number.isFinite(level)||Math.abs(level*unit-p.elevation)>unit*.42||!terrain.standing([x-width/2,level,z-height/2],size))return {reason:'落点容不下指示物'};
      p.elevation=level*unit;
    }
    for(const other of scene.tokens){
      if(other.id===token.id||!other.actor)continue;
      const d=other._source;
      if(p.x+width*u/2>d.x+.2&&p.x-width*u/2<d.x+d.width*u-.2&&p.y+height*u/2>d.y+.2&&p.y-height*u/2<d.y+d.height*u-.2&&
        d.elevation+Math.max(d.width,d.height)*unit>p.elevation+.02&&p.elevation+Math.max(width,height)*unit>d.elevation+.02)return {reason:'落点已被占用'};
    }
  }
  const feet=distance(spec.from,p);if(feet>spec.range+.001)return {feet,reason:'超出 '+spec.range+' 尺范围'};
  if(spec.sight&&!visibility(token,p,Math.max(width,height)*unit*.65))return {feet,reason:'实体地形遮挡了落点'};
  return {point:{x:p.x,y:p.y,elevation:Math.round(p.elevation*10000)/10000},feet};
}
function pick(spec){
  picker?.cancel();const scene=canvas.scene,board=game.Levels3DPreview.renderer.domElement;
  const badge=document.createElement('div');badge.id='mcb-spell-point';badge.setAttribute('role','status');
  Object.assign(badge.style,{position:'fixed',pointerEvents:'none',zIndex:'150',background:'#15282bee',color:'#ecfaf6',padding:'5px 9px',border:'1px solid #70ccbb',borderRadius:'4px',left:'48%',top:'25%'});
  const hint=spec.elevate?' · Alt＋滚轮调高度':'';
  badge.textContent=spec.label+' · 左键选择落点，右键取消'+hint;document.body.append(badge);
  return new Promise(resolve=>{
    const abort=new AbortController(),options={capture:true,signal:abort.signal};let last=-100,height=0;
    function close(value){abort.abort();badge.remove();picker=null;resolve(value);}
    function read(ev){const floor=surfaceAt(ev.clientX,ev.clientY);return inspect(spec,floor&&{...floor,elevation:floor.elevation+height});}
    function draw(ev,res){badge.textContent=spec.label+' · '+(Number.isFinite(res.feet)?res.feet.toFixed(1)+' / '+spec.range+' 尺 · ':'')+(res.reason??'左键确认')+(height?' · 离地 '+height+' 尺':hint);badge.style.borderColor=res.point?'#70ccbb':'#f39581';badge.style.left=Math.min(innerWidth-250,ev.clientX+14)+'px';badge.style.top=Math.max(2,ev.clientY-39)+'px';}
    picker={cancel:()=>close(null),scene};
    if(spec.elevate)window.addEventListener('wheel',ev=>{if(ev.target!==board||!ev.altKey)return;ev.preventDefault();ev.stopImmediatePropagation();
      height=Math.max(0,Math.min(Math.max(0,spec.from.elevation)+spec.range,height-Math.sign(ev.deltaY)*canvas.scene.grid.distance));draw(ev,read(ev));
    },{...options,passive:false});
    window.addEventListener('pointermove',ev=>{if(ev.target!==board||performance.now()-last<40)return;last=performance.now();draw(ev,read(ev));},options);
    window.addEventListener('pointerdown',ev=>{if(ev.target!==board||![0,2].includes(ev.button))return;ev.preventDefault();ev.stopImmediatePropagation();if(ev.button===2){close(null);return;}
      const res=read(ev);draw(ev,res);if(res.point)close(res.point);},options);
    window.addEventListener('contextmenu',ev=>{if(ev.target===board){ev.preventDefault();ev.stopImmediatePropagation();close(null);}},options);
    window.addEventListener('keydown',ev=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();close(null);}},options);
  });
}
export function allowsSpellMove(doc,changes,options){
  const s=permits.get(doc);return !!s&&doc.isOwner&&!doc.locked&&options?.mcbSpellMove===s.id&&near(doc._source,s.start)&&near({...doc._source,...changes},s.end);
}
async function blink(entry){
  const d=entry.token.document,p=entry.point,end=documentTopLeft(p,d.width,d.height);
  if(!active3D()||d.parent!==canvas.scene||!d.isOwner||d.locked||!near(origin(entry.token),entry.spec.from)||!inspect(entry.spec,p).point)return false;
  const permit={id:foundry.utils.randomID(),start:{x:d._source.x,y:d._source.y,elevation:d._source.elevation},end};permits.set(d,permit);
  try{await d.move([{...end,action:'blink',snapped:false,explicit:true,checkpoint:true}],{mcbSpellMove:permit.id,method:'paste',teleport:true,isPaste:true,animate:false,autoRotate:false,showRuler:false,constrainOptions:{ignoreCost:true,ignoreWalls:true}});
    const landed=near(d._source,end);if(!landed)ui.notifications.warn('传送落点已变化，请重新选择');return landed;
  }finally{permits.delete(d);}
}
function burst(token){
  if(!globalThis.Sequencer?.Database?.entryExists?.('jb2a.misty_step.01.blue'))return;
  try{void new Sequence().effect().file('jb2a.misty_step.01.blue').atLocation(token).scaleToObject(1.15).play();}catch{}
}
async function start({workflow}){
  if(!active3D()||!workflow?.token?.isOwner)return;
  const token=workflow.token,a=workflow.activity,item=a?.item;
  if(!item)return;
  const cloud=item.getFlag('gambits-premades','gpsUuid')===moveCloud,kind=cloud?'cloud':teleportKind(a);
  if(!kind)return;
  let template,range,from;
  if(cloud){
    const command=item.getFlag('dae','macro')?.command??'';
    if(!command.includes('Sequencer.Crosshair.show')||!command.includes('template.document.update'))return;
    template=ownCloud(workflow.actor);if(!template||!template.isOwner){ui.notifications.warn('场景中没有可移动的匕首之云');return false;}
    from={x:template.x,y:template.y,elevation:template.elevation};range=30;
  }else{
    if(token.document.locked)return false;from=origin(token);
    range=kind==='cpr'?Number(chrisPremades.utils.itemUtils.getConfig(item,'range')):Number(a.range?.value??item.system.range?.value);
  }
  if(!Number.isFinite(range)||range<=0)return;
  const spec={label:item.name,token,from,range,width:token.document.width,height:token.document.height,solid:!cloud,sight:!cloud,elevate:cloud};
  const point=await pick(spec);if(!point)return false;
  const entry={workflow,token,template,kind,point,spec};accepted.set(token.id,entry);

}
function finish(workflow){
  const e=accepted.get(workflow?.token?.id);if(!e||e.workflow!==workflow)return;
  if(e.kind==='aa'&&!workflow.aborted){
    burst(e.token);void blink(e).then(moved=>{if(moved)burst(e.token);}).catch(err=>ui.notifications.error(err.message));
  }
  // CPR finishes its asynchronous rollFinished macro before RollComplete, while AA
  // resolves the original item asynchronously from its own hooks.
  if(e.kind==='aa'||e.kind==='cpr')return setTimeout(()=>{if(accepted.get(e.token.id)===e)accepted.delete(e.token.id);},1500);
  if(accepted.get(e.token.id)===e)accepted.delete(e.token.id);
}
export function installSpellPoints(){
  Hooks.once('ready',async()=>{
    if(game.modules.get('fvtt-automation-repair')?.active)teleports=await import('../../fvtt-automation-repair/scripts/hud-teleport-1.js');
    const cpr=globalThis.chrisPremades?.utils;
    if(cpr?.crosshairUtils){
      libWrapper.register(ID,'chrisPremades.utils.crosshairUtils.aimCrosshair',function(w,opts){
        const e=accepted.get(opts.token?.id);if(!active3D()||e?.kind!=='cpr'||e.crosshair||e.token!==opts.token||Number(opts.maxRange)!==e.spec.range)return w(opts);
        e.crosshair=true;return Promise.resolve({...e.point,direction:e.token.document.rotation,cancelled:false,valid:true});
      },'MIXED');
      libWrapper.register(ID,'chrisPremades.utils.genericUtils.updateEmbeddedDocuments',async function(w,scene,kind,updates,opts,...rest){
        const u=updates?.length===1?updates[0]:null,e=u&&accepted.get(u._id);
        if(!e||e.kind!=='cpr'||!e.crosshair||e.moved||kind!=='Token'||scene!==canvas.scene||!opts?.isPaste)return w(scene,kind,updates,opts,...rest);
        const dest=documentTopLeft(e.point,e.token.document.width,e.token.document.height);
        if(Math.abs(dest.x-u.x)>.7||Math.abs(dest.y-u.y)>.7)return w(scene,kind,updates,opts,...rest);
        e.moved=true;return await blink(e)?[e.token.document]:[];
      },'MIXED');
    }
    if(globalThis.MidiQOL?.Workflow)libWrapper.register(ID,'MidiQOL.Workflow.prototype.callMacro',async function(w,item,name,data,...args){
      const e=accepted.get(this.token?.id);
      if(!e||e.kind!=='cloud'||e.workflow!==this||name!=='ItemMacro'||data?.macroPass!=='preActiveEffects'||item?.getFlag('gambits-premades','gpsUuid')!==moveCloud)return w(item,name,data,...args);
      // The stock Move macro captures the previous cast's template ID and writes only XY.
      // Resolve this actor's current cast and update the original template atomically.
      if(!e.moved&&e.template===ownCloud(this.actor)&&e.template.isOwner&&near(e.spec.from,e.template)&&inspect(e.spec,e.point).point){
        e.moved=true;await e.template.update({x:e.point.x,y:e.point.y,elevation:e.point.elevation});
      }
    },'MIXED');
    if(game.gps?.cloudOfDaggers2024)libWrapper.register(ID,'game.gps.cloudOfDaggers2024',function(w,options){
      if(active3D()&&options.regionScenario==='tokenEnter'&&options.movementScenario){
        const region=fromUuidSync(options.regionUuid),uuid=region?.getFlag('region-attacher','attachedTemplate');
        const move=fromUuidSync(options.tokenUuid)?.movement;
        if(uuid&&fromUuidSync(uuid)?.getFlag(ID,'area')&&(!move?.user?.isSelf||!['pending','paused'].includes(move.state)))return w({...options,movementScenario:undefined});
      }
      return w(options);
    },'MIXED');
    if(CONFIG.DND5E?.activityTypes?.summon?.documentClass)libWrapper.register(ID,'CONFIG.DND5E.activityTypes.summon.documentClass.prototype.getPlacement',async function(w,prototype,profile,opts){
      const token=this.actor?.getActiveTokens?.().find(t=>t.controlled)??this.actor?.getActiveTokens?.().find(t=>t.isOwner&&t.document.parent===canvas.scene);
      if(!active3D()||!token||this.range?.units!=='ft'||!(Number(this.range.value)>0))return w(prototype,profile,opts);
      const sz=this.creatureSizes?.size&&(this.creatureSizes.has(opts?.creatureSize)?opts.creatureSize:this.creatureSizes.first());
      if(sz){const n=CONFIG.DND5E.actorSizes[sz]?.token??1;prototype=prototype.clone({width:n,height:n});}
      const count=await new Roll(profile.count||'1',this.getRollData()).evaluate(),placements=[];
      for(let i=0;i<Math.trunc(count.total);i++){
        const pt=await pick({label:this.item.name,token,from:origin(token),range:Number(this.range.value),width:prototype.width,height:prototype.height,sight:true,elevate:true});
        if(!pt)return [];placements.push({prototypeToken:prototype,...documentTopLeft(pt,prototype.width,prototype.height),rotation:prototype.rotation??0});
      }
      return placements;
    },'MIXED');
  });
  Hooks.on('midi-qol.preItemRollV2',start);
  Hooks.on('midi-qol.RollComplete',finish);
  Hooks.on('AutomatedAnimations-WorkflowStart',(data,anim)=>{
    if(!active3D()||((anim?.presetType??anim?.animationData?.presetType)!=='teleportation'))return;
    const source=data.sourceToken??data.token,entry=accepted.get(source?.id);
    if(entry&&['aa','cpr'].includes(entry.kind)&&data.item?.id===entry.workflow.item?.id)data.stopWorkflow=true;
  });
  Hooks.on('preUpdateMeasuredTemplate',(doc,changes)=>{
    const e=[...accepted.values()].find(x=>x.kind==='cloud'&&x.template===doc);
    if(e&&'x' in changes&&'y' in changes&&Math.abs(changes.x-e.point.x)<.7&&Math.abs(changes.y-e.point.y)<.7)changes.elevation=e.point.elevation;
    const p=doc.getFlag(ID,'area');if(!p||!['x','y','elevation'].some(k=>k in changes))return;
    foundry.utils.setProperty(changes,'flags.'+ID+'.area',{...p,x:changes.x??p.x,y:changes.y??p.y,elevation:changes.elevation??p.elevation});
  });
  Hooks.on('canvasTearDown',()=>{picker?.cancel();accepted.clear();});
  Hooks.on('3DCanvasToggleMode',on=>{if(!on)picker?.cancel();});
}
