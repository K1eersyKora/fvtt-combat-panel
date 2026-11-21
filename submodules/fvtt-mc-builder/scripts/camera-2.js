import {ID,active3D} from './combat-space-2.js';
import {stormwreck3D} from './stormwreck-view-1.js';
const codes=new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE']),keys=new Set(),pitch=Math.PI/4;
let state=null,frame=null,last=0;
function enabled(){return active3D()&&game.settings.get(ID,'bg3Camera');}
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
  const saved={controls:{minPolarAngle:c.minPolarAngle,maxPolarAngle:c.maxPolarAngle,minAzimuthAngle:c.minAzimuthAngle,maxAzimuthAngle:c.maxAzimuthAngle,screenSpacePanning:c.screenSpacePanning,enableDamping:c.enableDamping},gameCamera:e.GameCamera.enabled,firstPerson:e.firstPersonMode};
  const original=c.update,change=()=>{c._mcbCameraRevision=(c._mcbCameraRevision??0)+1;};
  const freeCamera=e.GameCamera.onChangeFreeCamera;
  // The free camera normally reprojects its target onto terrain after a
  // debounce. Keep the same pivot for keyboard panning, orbit and wheel zoom.
  function fixedFocus(...args){
    if(!stormwreck3D()||!enabled())return freeCamera?.apply(this,args);
  }
  const wrapper=function(...args){
    if(enabled()){
      e.GameCamera.enabled=false;e.firstPersonMode=false;e._toggleCameraLockPosition=null;
      c.minPolarAngle=pitch;c.maxPolarAngle=pitch;c.minAzimuthAngle=-Infinity;c.maxAzimuthAngle=Infinity;c.screenSpacePanning=false;c.enableDamping=false;
    }
    return original.apply(this,args);
  };
  state={engine:e,controls:c,saved,original,wrapper,change,freeCamera,fixedFocus};
  c.update=wrapper;e.GameCamera.onChangeFreeCamera=fixedFocus;c.addEventListener('change',change);c.update();
}
function advance(now){
  if(!state||!keys.size)return;
  const matched=stormwreck3D();
  const elapsed=last?Math.max(0,(now-last)/1000):1/60;
  const dt=matched?elapsed:Math.min(.05,elapsed);
  last=now;
  if(!dt)return;
  const {engine:e,controls:c}=state;
  e.stopCameraAnimation();c._mcbKeyboardMoving=true;
  const up=new e.THREE.Vector3(0,1,0),offset=e.camera.position.clone().sub(c.target);
  const speed=Math.max(.12,Math.min(.8,offset.length()/(e.camera.zoom||1)*.3));
  const radius=Math.hypot(offset.x,offset.z);
  const angularSpeed=matched?(radius>1e-6?speed/radius:0):Math.PI/2;
  const turn=(Number(keys.has('KeyE'))-Number(keys.has('KeyQ')))*angularSpeed*dt;
  if(turn){offset.applyAxisAngle(up,turn);e.camera.position.copy(c.target).add(offset);}
  const forward=c.target.clone().sub(e.camera.position);forward.y=0;forward.normalize();const right=forward.clone().cross(up);
  const move=forward.multiplyScalar(Number(keys.has('KeyW'))-Number(keys.has('KeyS'))).addScaledVector(right,Number(keys.has('KeyD'))-Number(keys.has('KeyA')));
  if(move.lengthSq()){
    move.normalize().multiplyScalar(speed*dt);
    const d=canvas.dimensions,minX=d.sceneX/e.factor,minZ=d.sceneY/e.factor,maxX=(d.sceneX+d.sceneWidth)/e.factor,maxZ=(d.sceneY+d.sceneHeight)/e.factor;
    move.x=Math.max(minX,Math.min(maxX,c.target.x+move.x))-c.target.x;move.z=Math.max(minZ,Math.min(maxZ,c.target.z+move.z))-c.target.z;
    c.target.add(move);e.camera.position.add(move);
  }
  c.update();
}
function step(now){
  frame=null;if(!enabled()||!keys.size){stop();return;}bind();if(!state)return;
  advance(stormwreck3D()?performance.now():now);
  frame=requestAnimationFrame(step);
}
export function cameraStatus(){const e=game.Levels3DPreview;return {active:!!state&&enabled(),moving:keys.size>0,keys:[...keys],pitchDegrees:e?.controls?e.controls.getPolarAngle()*180/Math.PI:null,target:e?.controls?.target.toArray(),position:e?.camera?.position.toArray()};}
export function installCamera(){
  Hooks.once('init',()=>game.settings.register(ID,'bg3Camera',{name:'BG3式相机操作',hint:'WASD平移相机，按住Q/E旋转，俯视角固定45°，滚轮缩放。指示物使用鼠标拖动。',scope:'client',config:true,type:Boolean,default:true,onChange:bind}));
  // Capture precedes Foundry's window bubble handler and OrbitControls' document
  // handler, so these keys cannot also move a token or change a tile's fill mode.
  window.addEventListener('keydown',event=>{
    if(!enabled()||!codes.has(event.code)||editable(event)||event.ctrlKey||event.metaKey||event.altKey)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(keys.has(event.code))return;
    bind();
    if(stormwreck3D()){
      const now=performance.now();
      state?.engine.stopCameraAnimation();
      advance(now);
      last=now;
    }
    keys.add(event.code);
    if(frame===null){if(!stormwreck3D())last=0;frame=requestAnimationFrame(step);}
  },true);
  window.addEventListener('keyup',event=>{
    if(!keys.has(event.code))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(stormwreck3D()&&enabled())advance(performance.now());
    keys.delete(event.code);
    if(!keys.size)stop();
  },true);
  window.addEventListener('blur',stop);window.addEventListener('focusin',event=>{if(editable(event))stop();});document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  for(const hook of ['ready','canvasReady','3DCanvasSceneReady'])Hooks.on(hook,()=>setTimeout(bind,0));
  Hooks.on('3DCanvasToggleMode',value=>{if(value===false)release();else setTimeout(bind,0);});Hooks.on('canvasTearDown',release);
}
