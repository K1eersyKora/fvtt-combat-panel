import {ID,active3D,worldPoint,screenPoint} from './scene-view-1.js';
import {ORIGINAL_PLAYBACK_RATE, setVideoPlaybackRate} from './animation-rate-1.js';
const active=new Map(), seen=new Map(), history=[];
const waitingImpact=new Map(),warm=new Map();
let frame,layer;
const assets='/modules/'+ID+'/assets/fx/';
function release(fx) {
  if(active.get(fx.data.id)!==fx)return;
  active.delete(fx.data.id);clearTimeout(fx.timeout);clearTimeout(fx.flightTimer);
  fx.video.onended=fx.video.onerror=fx.video.onplaying=fx.video.onloadedmetadata=null;fx.video.pause();fx.video.removeAttribute('src');fx.video.load();fx.video.remove();
  if(!active.size) {layer?.remove();layer=null;if(frame)cancelAnimationFrame(frame);frame=null;}
}
function anchor(fallback,id){
  const e=game.Levels3DPreview,t=id&&e.tokens[id];
  if(t?.mesh && t.mesh.visible){
    const v=t.mesh.getWorldPosition(new e.THREE.Vector3());v.y+=t.d*.6;return v;
  }
  return worldPoint(fallback);
}
function project(fx) {
  const {data,video}=fx,e=game.Levels3DPreview;
  if(!active3D()||canvas.scene.id!==data.scene){release(fx);return;}
  const t=data.targetId&&canvas.tokens.get(data.targetId);
  if(t&&!game.user.isGM&&!t.visible){video.hidden=true;return;}
  const a=screenPoint(anchor(data.from,data.sourceId)),end=anchor(data.to,data.targetId),b=screenPoint(end);
  if(!a||!b){video.hidden=true;return;}
  video.hidden=false;
  const unit=canvas.grid.size/e.factor;
  const right=new e.THREE.Vector3().setFromMatrixColumn(e.camera.matrixWorld,0);
  const edge=screenPoint(end.clone().addScaledVector(right,unit));
  const grid=edge?Math.max(4,Math.hypot(edge.x-b.x,edge.y-b.y)):40;
  let x,y,w,h,angle=0;
  if(fx.impact){
    w=h=Math.max(grid*.8,grid*(data.radius??4)/5*2);x=b.x-w/2;y=b.y-h/2;
  }else{
    const dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy);
    angle=Math.atan2(dy,dx)*180/Math.PI;
    if(data.kind==='melee'){w=Math.max(grid*1.3,dist*1.65);h=w*.75;x=(a.x+b.x)/2-w/2;y=(a.y+b.y)/2-h/2;}
    else{w=Math.max(grid*.55,dist*4/3);h=w*.25;x=(a.x+b.x)/2-w/2;y=(a.y+b.y)/2-h/2;}
  }
  video.style.width=w+'px';video.style.height=h+'px';video.style.transform='translate('+x+'px,'+y+'px) rotate('+angle+'deg)';
  fx.projected={start:[a.x,a.y],end:[b.x,b.y],width:w,height:h};
}
function tick(){frame=null;for(const fx of active.values())project(fx);if(active.size)frame=requestAnimationFrame(tick);}
export function warmSpells(){
  if(!active3D())return;
  for(const name of ['fireball-flight','fireball-burst','firebolt','force','arcane-burst','frost','frost-burst']){
    if(warm.has(name))continue;
    const v=document.createElement('video');v.preload='auto';v.muted=true;v.src=assets+name+'.webm';v.load();warm.set(name,v);
  }
}
function burst(fx){
  if(fx.impact||active.get(fx.data.id)!==fx)return;
  fx.impact=true;clearTimeout(fx.flightTimer);project(fx);
  media(fx,fx.data.burst??({fire:'fireball-burst',cold:'frost-burst'}[fx.data.damage]??'arcane-burst'));
  event('impact',fx);
}
function requestImpact(fx) {
  fx.impactReady = true;
  if (fx.flightFinished) burst(fx);
}
export function syncFlatImpact(id,scene){
  if(!active3D()||canvas.scene.id!==scene||typeof id!=='string')return false;
  const fx=active.get(id);
  if(fx?.data.shape){requestImpact(fx);return true;}
  if(!seen.has(id)){waitingImpact.set(id,performance.now());if(waitingImpact.size>80)waitingImpact.delete(waitingImpact.keys().next().value);}
  return false;
}
function media(fx,name){
  const v=fx.video;
  v.src=name.startsWith('modules/')||name.startsWith('worlds/')?'/'+name:assets+name+'.webm';
  setVideoPlaybackRate(v);
  clearTimeout(fx.timeout);
  fx.timeout=setTimeout(()=>release(fx),10000);
  v.onloadedmetadata=()=>{
    if (!Number.isFinite(v.duration)) return;
    clearTimeout(fx.timeout);
    fx.timeout=setTimeout(()=>release(fx),Math.max(10000, v.duration*1000/ORIGINAL_PLAYBACK_RATE + 3500));
  };
  v.onplaying=()=>{if(fx.impact&&!fx.visibleImpact){fx.visibleImpact=true;event('burst-playing',fx);}};
  v.onended=()=>{
    if (!fx.impact&&fx.data.shape) {
      fx.flightFinished=true;
      if (!fx.data.followRoll||fx.impactReady) burst(fx);
      else fx.flightTimer=setTimeout(()=>requestImpact(fx),2400);
      return;
    }
    if (!fx.impact)event('impact',fx);
    release(fx);
  };
  v.onerror=()=>{event('media-error',fx);release(fx);};
  const request=v.src;
  v.play().catch(err=>{if(active.get(fx.data.id)===fx&&v.src===request&&err?.name!=='AbortError'){event('media-error',fx);release(fx);}});
}
function event(phase,fx){
  const e={id:fx.data.id,scene:fx.data.scene,phase,kind:fx.data.kind,asset:fx.video.currentSrc?.split('/').at(-1),rate:fx.video.playbackRate,from:fx.data.from,point:fx.data.to};
  history.push(e);if(history.length>64)history.shift();Hooks.callAll('mcBuilderSpellVFX',e);
}
export function playFlat(data){
  if(!data?.id||!data.from||!data.to||!active3D()||data.scene!==canvas.scene.id||seen.has(data.id)||!game.settings.get(ID,'spellVfx'))return false;
  const now=performance.now();for(const [id,time] of seen)if(now-time>60000)seen.delete(id);
  seen.set(data.id,now);
  if(!layer){layer=document.createElement('div');layer.className='mcb-screen-effects';layer.style.cssText='position:fixed;inset:0;z-index:68;pointer-events:none;overflow:hidden;';document.body.append(layer);}
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.dataset.kind=data.kind;
  video.style.cssText='position:absolute;top:0;left:0;pointer-events:none;object-fit:fill;transform-origin:center center;';layer.append(video);
  const fx={data,video,impact:false};active.set(data.id,fx);project(fx);
  const regular=data.kind==='melee'?'blade':data.kind==='ranged'?'arrow':({fire:'firebolt',cold:'frost'}[data.damage]??'force');
  media(fx,data.clip??(data.shape&&data.damage==='fire'?'fireball-flight':regular));
  event('flight',fx);
  if(data.shape&&waitingImpact.delete(data.id))requestImpact(fx);
  if(!frame)frame=requestAnimationFrame(tick);return true;
}
export function clearFlat(){for(const fx of [...active.values()])release(fx);seen.clear();waitingImpact.clear();}
export function flatStatus(){return {running:active.size,records:[...history],projection:[...active.values()].map(f=>({kind:f.data.kind,impact:f.impact,...f.projected}))};}
