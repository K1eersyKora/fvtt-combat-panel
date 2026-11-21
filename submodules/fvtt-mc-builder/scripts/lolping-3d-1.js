import {ID,active3D,surfaceAt,screenPoint,worldPoint} from './combat-space-2.js';
const moduleId='fvtt-lolping',meta=new Map(),renderers=new Set();
let sending,controls,installed=false;
const refresh=()=>{for(const renderer of renderers)if(renderer.live.size)renderer.reproject();};
function bindCamera(){
  if(controls!==game.Levels3DPreview?.controls){controls?.removeEventListener('change',refresh);controls=game.Levels3DPreview?.controls;controls?.addEventListener('change',refresh);}
}
function clear(){controls?.removeEventListener('change',refresh);controls=null;meta.clear();renderers.clear();}
function remember(msg){
  if(!msg||msg.scene!==canvas.scene?.id||typeof msg.eventId!=='string'||msg.eventId.length>128
    ||!Number.isFinite(msg.elevation)||Math.abs(msg.elevation)>10000||!Number.isFinite(msg.x)||!Number.isFinite(msg.y))return;
  meta.set(msg.eventId,msg);if(meta.size>240)meta.delete(meta.keys().next().value);refresh();
}
async function install(){
  if(installed||game.modules.get(moduleId)?.version!=='0.1.2'||!game.modules.get(moduleId)?.active)return;
  installed=true;
  const [{WheelInput},{PingRenderer}]=await Promise.all([import('/modules/fvtt-lolping/scripts/input.js'),import('/modules/fvtt-lolping/scripts/renderer.js')]);
  const input=WheelInput.prototype,render=PingRenderer.prototype;
  const original={over:input.overCanvas,start:input.start,release:input.release,spawn:render.spawn,position:render.position};
  input.overCanvas=function(){if(!active3D())return original.over.call(this);const p=this.pointer;return !!p&&document.elementFromPoint(p.x,p.y)===game.Levels3DPreview.renderer.domElement;};
  input.start=function(ev,key,...rest){
    if(!active3D())return original.start.call(this,ev,key,...rest);
    const prior=this.toScene;this.toScene=point=>surfaceAt(point.x,point.y);
    try{const result=original.start.call(this,ev,key,...rest);if(result&&this.gesture&&!this.gesture.start3d)this.gesture.start3d={t:performance.now(),x:this.pointer.x,y:this.pointer.y};return result;}
    finally{this.toScene=prior;}
  };
  input.release=function(ev,key=ev?.code){
    if(!active3D()||!this.gesture?.start3d)return original.release.call(this,ev,key);
    const g=this.gesture,releaseWheel=this.renderer.releaseWheel,base=sending; sending=g.anchor;
    this.renderer.releaseWheel=function(x,y){
      const selected=releaseWheel.call(this,x,y);
      return selected??(key==='KeyG'&&performance.now()-g.start3d.t<260&&Math.hypot(x-g.start3d.x,y-g.start3d.y)<10?{id:game.settings.get(moduleId,'slot0')}:null);
    };
    try{return original.release.call(this,ev,key);}finally{this.renderer.releaseWheel=releaseWheel;sending=base;}
  };
  render.spawn=function(msg,...args){
    if(!active3D())return original.spawn.call(this,msg,...args);
    bindCamera();renderers.add(this);
    if(sending&&msg.userId===game.user.id&&Math.abs(sending.x-msg.x)<.1&&Math.abs(sending.y-msg.y)<.1){
      const side={type:'ping-height',eventId:msg.eventId,userId:msg.userId,scene:msg.sceneId,x:msg.x,y:msg.y,elevation:sending.elevation};
      remember(side);game.socket.emit('module.'+ID,side);
    }
    const last=this._mcbPing;this._mcbPing=msg;
    try{return original.spawn.call(this,msg,...args);}finally{this._mcbPing=last;}
  };
  render.position=function(entry){
    if(!active3D())return original.position.call(this,entry);
    entry.mcbPing??=this._mcbPing;
    const msg=entry.mcbPing,hit=msg&&meta.get(msg.eventId),pt=entry.point;
    const exact=hit&&hit.userId===msg.userId&&hit.scene===msg.sceneId&&hit.x===pt.x&&hit.y===pt.y;
    const sc=canvas.scene,terrain=game.modules.get(sc.getFlag(ID,'config')?.terrainProvider)?.api?.movementSurface?.(sc),dim=sc.getDimensions();
    const ground=exact?hit.elevation:(terrain?.level((pt.x-dim.sceneX)/sc.grid.size,(pt.y-dim.sceneY)/sc.grid.size)??0)*sc.grid.distance;
    const projected=screenPoint(worldPoint({...pt,elevation:Number.isFinite(ground)?ground:0}));
    entry.root.hidden=!projected;if(projected){entry.root.style.left=projected.x+'px';entry.root.style.top=projected.y+'px';}
    entry.root.dataset.mcbElevation=String(ground);
  };
  game.socket.on('module.'+ID,msg=>{if(msg?.type==='ping-height')remember(msg);});
}
export function installPing(){
  Hooks.once('ready',()=>void install().catch(console.error));
  Hooks.on('3DCanvasSceneReady',bindCamera);
  Hooks.on('3DCanvasToggleMode',enabled=>{
    if(enabled)bindCamera();else{controls?.removeEventListener('change',refresh);controls=null;}
    refresh();
  });
  Hooks.on('canvasTearDown',clear);
}
