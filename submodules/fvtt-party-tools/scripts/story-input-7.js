import {STORY_ID as ID,isStoryPlayer,isStoryStriker,isStoryActive,readStoryState} from './story-state-2.js';

export class StoryInput {
 constructor(controller){
  this.controller=controller;
  this.handle=this.handle.bind(this);
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','mousedown','mousemove','mouseup','click','dblclick','contextmenu','wheel','keydown','keyup','keypress','dragstart','dragover','drop','touchstart','touchmove','touchend','beforeinput','paste','cut','submit'])window.addEventListener(type,this.handle,{capture:true,passive:false});
  window.addEventListener('blur',()=>this.reset());
  window.addEventListener('resize',()=>this.reset());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.reset();});
  Hooks.on('canvasTearDown',()=>this.reset());
  Hooks.on('combatPanelStoryChanged',()=>{if(!isStoryPlayer())this.reset();});
  for(const type of Object.keys(CONFIG).filter(key=>CONFIG[key]?.documentClass)){
   for(const verb of ['Create','Update','Delete'])Hooks.on(`pre${verb}${type}`,(doc,data)=>{
    if(!isStoryPlayer())return;
    if(type==='User'&&verb==='Update'&&doc.id===game.user.id&&this.allowedUserWrite(data))return;
    if(type==='ChatMessage'&&verb==='Create'&&doc.getFlag(ID,'storySession')===readStoryState().id&&!doc.rolls?.length&&doc.author?.id===game.user.id)return;
    return false;
   });
  }
  const reject=()=>isStoryPlayer()?false:undefined;
  Hooks.on('preMoveToken',()=>isStoryStriker()?false:undefined);
  Hooks.on('preUpdateToken',(doc,data)=>isStoryStriker()&&['x','y','elevation'].some(k=>k in data)?false:undefined);
  for(const name of ['dnd5e.preShortRest','dnd5e.preLongRest'])Hooks.on(name,()=>isStoryActive()?false:undefined);
  for(const hook of ['preMoveToken','dnd5e.preUseActivity','dnd5e.preUseItem','dnd5e.preRollAttack','dnd5e.preRollDamage','dnd5e.preRollAbilityCheck','dnd5e.preRollAbilitySave','dnd5e.preRollSkill','dnd5e.preRollToolCheck','dnd5e.preRollDeathSave','dnd5e.preRollInitiative','dnd5e.preShortRest','dnd5e.preLongRest','midi-qol.preTargeting','midi-qol.preItemRoll','midi-qol.preAttackRoll','midi-qol.preDamageRoll'])Hooks.on(hook,reject);
 }
 allowedUserWrite(data){
  const keys=Object.keys(foundry.utils.flattenObject(data??{}));
  const allowed=['flags.fvtt-combat-panel.storyVote','flags.fvtt-combat-panel.storyView',`flags.${ID}.strikeRequest`];
  return keys.length>0&&keys.every(key=>(key==='_id'&&data._id===game.user.id)||allowed.some(prefix=>key===prefix||key.startsWith(prefix+'.')));
 }
 stop(event,prevent=true){if(prevent&&event.cancelable)event.preventDefault();event.stopImmediatePropagation();}
 capture(pointerId){try{this.controller.el.setPointerCapture(pointerId);}catch{/* A synthetic or already-released pointer. */}}
 release(pointerId){try{if(this.controller.el.hasPointerCapture(pointerId))this.controller.el.releasePointerCapture(pointerId);}catch{/* The modal may already be closing. */}}
 startPan(event){
  if(!canvas.ready||typeof canvas._onDragRightMove!=='function')return;
  const origin=this.controller.point(event);
  this.pan={pointerId:event.pointerId,screenOrigin:{x:event.clientX,y:event.clientY},origin,started:false};
  this.capture(event.pointerId);
 }
 queuePan(event){
  this.panPoint={clientX:event.clientX,clientY:event.clientY,nativeEvent:event};
  if(this.panFrame!=null)return;
  this.panFrame=requestAnimationFrame(()=>{this.panFrame=null;this.applyPan();});
 }
 panEvent(point){
  return {nativeEvent:point.nativeEvent,interactionData:{origin:this.pan.origin,destination:this.controller.point(point),screenOrigin:this.pan.screenOrigin}};
 }
 applyPan(){
  const pan=this.pan,point=this.panPoint;if(!pan||!point)return;
  this.panPoint=null;
  if(!canvas.ready||!isStoryPlayer()){this.reset();return;}
  const event=this.panEvent(point);
  if(!pan.started){
   const threshold=foundry.canvas.interaction.MouseInteractionManager.DEFAULT_DRAG_RESISTANCE_PX;
   if(Math.hypot(point.clientX-pan.screenOrigin.x,point.clientY-pan.screenOrigin.y)<threshold)return;
   canvas._onDragRightStart(event);pan.started=true;
  }
  // Use Foundry's own right-drag handler, including camera constraints and dragSpeedModifier.
  // The modal only adapts coordinates/events; it never computes or writes the camera position.
  canvas._onDragRightMove(event);
 }
 finishPan(event,cancelled=false){
  const pan=this.pan;if(!pan)return;
  if(event&&!cancelled){this.panPoint={clientX:event.clientX,clientY:event.clientY,nativeEvent:event};this.applyPan();}
  if(this.pan!==pan)return;
  cancelAnimationFrame(this.panFrame);this.panFrame=null;
  try{if(pan.started){const point=event??{clientX:pan.screenOrigin.x,clientY:pan.screenOrigin.y};canvas[cancelled?'_onDragRightCancel':'_onDragRightDrop'](this.panEvent(point));}}
  finally{this.panPoint=null;this.pan=null;this.release(pan.pointerId);}
 }
 rulerPoint(event){
  const point=this.controller.point(event),ruler=this.measure?.ruler??canvas.controls?.ruler;
  const snapped=event.shiftKey?point:ruler.constructor.getSnappedPoint(point);
  return{x:snapped.x,y:snapped.y,elevation:0};
 }
 startMeasure(event){
  const ruler=canvas.controls?.ruler;
  if(!canvas.ready||!ruler||typeof ruler.reset!=='function'||typeof ruler.constructor.getSnappedPoint!=='function')return;
  const origin=this.rulerPoint(event);ruler.reset();
  this.measure={pointerId:event.pointerId,ruler,origin};
  this.controller.el.dataset.storyMeasuring='true';ruler.hidden=!!event.altKey;
  // Native Ruler owns drawing, measurement, labels and activity broadcast.
  ruler.path=[origin,{...origin}];this.capture(event.pointerId);
 }
 moveMeasure(event){
  const state=this.measure;if(state)state.ruler.path=[state.origin,this.rulerPoint(event)];
 }
 finishMeasure(){
  const state=this.measure;this.measure=null;delete this.controller.el.dataset.storyMeasuring;
  if(state){state.ruler.reset();this.release(state.pointerId);}
 }
 handle(event){
  if(!isStoryPlayer()){if(this.pan||this.measure)this.reset();return;}
  // Canvas.pan emits an untrusted hover-only PointerEvent, without buttons.
  // It must not update the physical gesture or masquerade as a button release.
  if(event.type==='pointermove'&&event.isTrusted===false){this.stop(event);return;}
  if(event.type==='pointermove')Hooks.callAll('combatPanelStoryPointerMove',event);
  if(event.type==='pointerdown')Hooks.callAll('combatPanelStoryPointerDown',event);
  const ui=event.target?.closest?.('#cp-story-ui .cp-story-interactive');
  const typing=event.target?.matches?.('#cp-story-ui textarea');
  if(event.type.startsWith('key')){
   if(event.key==='F5'||((event.ctrlKey||event.metaKey)&&event.key?.toLowerCase()==='r'))return;
   if(event.key==='Escape'&&(this.pan||this.measure)){this.reset();this.stop(event);return;}
   if(typing){
    if(event.type==='keydown'&&event.key==='Enter'&&!event.shiftKey){this.stop(event);void this.controller.sendChat();return;}
    if(event.type==='keydown'&&event.key==='Escape'){event.target.blur();this.stop(event);return;}
    this.stop(event,false);return;
   }
   if(ui&&event.type==='keydown'&&['Tab','Enter',' '].includes(event.key))return;
   if(event.key==='Tab')return;this.stop(event);return;
  }
  if(ui&&!this.pan&&!this.measure){
   if(['dragstart','dragover','drop','contextmenu'].includes(event.type)){this.stop(event);return;}
   return;
  }
  // Only the first modal gesture may reach native audio unlock. Compatibility
  // mouse events stay blocked so native canvas handlers cannot also pan.
  if(event.type==='pointerdown'&&game.audio?.locked){if(event.cancelable)event.preventDefault();}
  else this.stop(event);
  if(event.type==='pointerdown'){
   if(this.pan||this.measure||canvas.scene?.id!==readStoryState().sceneId)return;
   if(event.button===2)this.startPan(event);
   else if(event.button===0){if(this.controller.mode==='measure')this.startMeasure(event);else this.controller.canvasClick(event);}
  }else if(event.type==='pointermove'){
   if(this.pan?.pointerId===event.pointerId){if(event.buttons&2)this.queuePan(event);else this.finishPan(event);}
   else if(this.measure?.pointerId===event.pointerId){if(event.buttons&1)this.moveMeasure(event);else this.finishMeasure();}
  }else if(event.type==='pointerup'){
   if(this.pan?.pointerId===event.pointerId)this.finishPan(event);
   if(this.measure?.pointerId===event.pointerId)this.finishMeasure();
  }else if(['pointercancel','lostpointercapture'].includes(event.type)){
   if(this.pan?.pointerId===event.pointerId||this.measure?.pointerId===event.pointerId)this.reset();
  }
 }
 reset(){this.finishPan(null,true);this.finishMeasure();}
}
