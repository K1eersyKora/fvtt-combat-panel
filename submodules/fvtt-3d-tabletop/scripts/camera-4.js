import {ID,active3D,legacyDefault} from './scene-view-1.js';
const codes=new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE']),keys=new Set();
const nearGrids=7,farGrids=21,degrees=Math.PI/180;
const sensitivities={
  cameraRotateSensitivity:{name:'三维镜头 · Q/E 旋转灵敏度',hint:'调整按 Q 或 E 环绕观察中心的速度。1.0 沿用默认速度。',value:1},
  cameraPanSensitivity:{name:'三维镜头 · WASD 平移灵敏度',hint:'调整用 WASD 平移镜头的速度。1.0 沿用默认速度。',value:1},
  cameraZoomSensitivity:{name:'三维镜头 · 滚轮缩放灵敏度',hint:'调整每次滚轮滚动的缩放幅度。1.0 沿用默认幅度。',value:1},
};
let state=null,frame=null,last=0;
function enabled(){return active3D()&&game.settings.get(ID,'bg3Camera');}
const maxSensitivity=6;
function clampSensitivity(value){return Math.max(.25,Math.min(maxSensitivity,Number(value)||1));}
function radiusInGrids(e,c){
  return e.camera.position.distanceTo(c.target)*e.factor/canvas.grid.size;
}
function polarAt(radius){
  const t=Math.max(0,Math.min(1,Math.log(Math.max(radius,nearGrids)/nearGrids)/Math.log(farGrids/nearGrids)));
  return (60-15*t*t*(3-2*t))*degrees;
}
function editable(event){return event.isComposing||event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');}
function stop(){keys.clear();last=0;if(frame!==null)cancelAnimationFrame(frame);frame=null;if(state)state.controls._mcbKeyboardMoving=false;}
function release(){
  stop();if(!state)return;
  const {engine:e,controls:c,original,wrapper,change,saved,freeCamera,fixedFocus}=state;c.removeEventListener('change',change);
  if(c.update===wrapper)c.update=original;
  if(e.GameCamera.onChangeFreeCamera===fixedFocus)e.GameCamera.onChangeFreeCamera=freeCamera;
  for(const [key,value]of Object.entries(saved.controls))c[key]=value;
  e.GameCamera.enabled=saved.gameCamera;e.firstPersonMode=saved.firstPerson;delete c._mcbKeyboardMoving;state=null;
}
function bind(){
  if(!enabled()){release();return;}
  const e=game.Levels3DPreview,c=e.controls;if(state?.controls===c)return;
  release();
  const saved={controls:{minPolarAngle:c.minPolarAngle,maxPolarAngle:c.maxPolarAngle,minAzimuthAngle:c.minAzimuthAngle,maxAzimuthAngle:c.maxAzimuthAngle,screenSpacePanning:c.screenSpacePanning,enableDamping:c.enableDamping,zoomSpeed:c.zoomSpeed},gameCamera:e.GameCamera.enabled,firstPerson:e.firstPersonMode};
  const original=c.update,change=()=>{c._mcbCameraRevision=(c._mcbCameraRevision??0)+1;};
  const freeCamera=e.GameCamera.onChangeFreeCamera;
  // The free camera normally reprojects its target onto terrain after a
  // debounce. Keep the same pivot for keyboard panning, orbit and wheel zoom.
  function fixedFocus(...args){
    if(!enabled())return freeCamera?.apply(this,args);
  }
  const wrapper=function(...args){
    if(!enabled())return original.apply(this,args);
    e.GameCamera.enabled=false;e.firstPersonMode=false;e._toggleCameraLockPosition=null;
    c.minAzimuthAngle=-Infinity;c.maxAzimuthAngle=Infinity;c.screenSpacePanning=false;c.enableDamping=false;
    c.zoomSpeed=saved.controls.zoomSpeed*sensitivities.cameraZoomSensitivity.value;
    const polar=polarAt(radiusInGrids(e,c));
    c.minPolarAngle=polar;c.maxPolarAngle=polar;
    const changed=original.apply(this,args);
    // OrbitControls consumes its pending dolly here. Apply the angle at the
    // resulting radius using the same target and azimuth before the frame draws.
    const zoomedPolar=polarAt(radiusInGrids(e,c));
    if(Math.abs(zoomedPolar-polar)<1e-7)return changed;
    c.minPolarAngle=zoomedPolar;c.maxPolarAngle=zoomedPolar;
    return original.apply(this,args)||changed;
  };
  state={engine:e,controls:c,saved,original,wrapper,change,freeCamera,fixedFocus};
  c.update=wrapper;e.GameCamera.onChangeFreeCamera=fixedFocus;c.addEventListener('change',change);c.update();
}
function advance(now){
  if(!state||!keys.size)return;
  const dt=Math.max(0,(now-last)/1000);
  last=now;
  if(!dt)return;
  const {engine:e,controls:c}=state;
  e.stopCameraAnimation();c._mcbKeyboardMoving=true;
  const up=new e.THREE.Vector3(0,1,0),offset=e.camera.position.clone().sub(c.target);
  const speed=Math.max(.12,Math.min(.8,offset.length()/(e.camera.zoom||1)*.3));
  // Keep the default angular speed of the previous 45° camera at each zoom.
  const radius=offset.length()*Math.SQRT1_2;
  const angularSpeed=radius>1e-6?speed/radius:0;
  const turn=(Number(keys.has('KeyE'))-Number(keys.has('KeyQ')))*angularSpeed*dt*sensitivities.cameraRotateSensitivity.value;
  if(turn){offset.applyAxisAngle(up,turn);e.camera.position.copy(c.target).add(offset);}
  const forward=c.target.clone().sub(e.camera.position);forward.y=0;forward.normalize();const right=forward.clone().cross(up);
  const move=forward.multiplyScalar(Number(keys.has('KeyW'))-Number(keys.has('KeyS'))).addScaledVector(right,Number(keys.has('KeyD'))-Number(keys.has('KeyA')));
  if(move.lengthSq()){
    move.normalize().multiplyScalar(speed*dt*sensitivities.cameraPanSensitivity.value);
    const d=canvas.dimensions,minX=d.sceneX/e.factor,minZ=d.sceneY/e.factor,maxX=(d.sceneX+d.sceneWidth)/e.factor,maxZ=(d.sceneY+d.sceneHeight)/e.factor;
    move.x=Math.max(minX,Math.min(maxX,c.target.x+move.x))-c.target.x;move.z=Math.max(minZ,Math.min(maxZ,c.target.z+move.z))-c.target.z;
    c.target.add(move);e.camera.position.add(move);
  }
  c.update();
}
function step(){
  frame=null;if(!enabled()||!keys.size){stop();return;}bind();if(!state)return;
  advance(performance.now());
  frame=requestAnimationFrame(step);
}
export function cameraStatus(){
  const e=game.Levels3DPreview,c=e?.controls;
  return {active:!!state&&enabled(),moving:keys.size>0,keys:[...keys],
    pitchDegrees:c?90-c.getPolarAngle()/degrees:null,radiusGrids:c?radiusInGrids(e,c):null,
    target:c?.target.toArray(),position:e?.camera?.position.toArray()};
}
export function installCamera(){
  Hooks.once('init',()=>{
    game.settings.register(ID,'bg3Camera',{name:'BG3式相机操作',hint:'WASD 平移，Q/E 环绕。滚轮缩放时，俯角随观察范围在 30° 到 45° 之间平滑变化。',scope:'client',config:true,type:Boolean,default:legacyDefault('bg3Camera','client'),onChange:bind});
    for(const [key,setting] of Object.entries(sensitivities)){
      game.settings.register(ID,key,{name:setting.name,hint:setting.hint,scope:'client',config:true,type:Number,default:1,
        range:{min:.25,max:maxSensitivity,step:.05},onChange:value=>{
          setting.value=clampSensitivity(value);
          if(key==='cameraZoomSensitivity')state?.controls.update();
        }});
      setting.value=clampSensitivity(game.settings.get(ID,key));
    }
  });
  // Capture precedes Foundry's window bubble handler and OrbitControls' document
  // handler, so these keys cannot also move a token or change a tile's fill mode.
  window.addEventListener('keydown',event=>{
    if(!enabled()||!codes.has(event.code)||editable(event)||event.ctrlKey||event.metaKey||event.altKey)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(keys.has(event.code))return;
    bind();
    const now=performance.now();
    state?.engine.stopCameraAnimation();
    advance(now);
    last=now;
    keys.add(event.code);
    if(frame===null)frame=requestAnimationFrame(step);
  },true);
  window.addEventListener('keyup',event=>{
    if(!keys.has(event.code))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(enabled())advance(performance.now());
    keys.delete(event.code);
    if(!keys.size)stop();
  },true);
  window.addEventListener('blur',stop);window.addEventListener('focusin',event=>{if(editable(event))stop();});document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  for(const hook of ['ready','canvasReady','3DCanvasSceneReady'])Hooks.on(hook,()=>setTimeout(bind,0));
  Hooks.on('3DCanvasToggleMode',value=>{if(value===false)release();else setTimeout(bind,0);});Hooks.on('canvasTearDown',release);
}
