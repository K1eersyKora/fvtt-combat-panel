import {ID,active3D} from './combat-space-2.js';
import {sweptBodyBlocked} from './navigation-core-4.js';
const run=new Map(),permits=new WeakMap(),clips=new Map();
const epoch=(fight)=>fight?.started?fight.id+'/'+fight.round:null;
const fightFor=t=>t.document.combatant?.parent?.started?t.document.combatant.parent:null;
const footprint=(b)=>b.max.map((n,i)=>n-b.min[i]);
const near=(a,b)=>Math.abs(a.x-b.x)<.6&&Math.abs(a.y-b.y)<.6&&Math.abs(a.elevation-b.elevation)<.025;
function runway(token){
  const last=run.get(token.document.uuid);if(!last||last.turn!==epoch(fightFor(token))||!near(last.end,token.document._source))return 0;return last.distance;
}
export function strengthJump(token){
  const a=token.actor?.system?.abilities?.str??{},running=runway(token)>=9.95,ratio=running?1:.5;
  return {height:Math.max(0,3+Number(a.mod??0))*ratio,length:Math.max(0,Number(a.value??10))*ratio,running};
}
function allocation(t){
  const a=t.actor,f=fightFor(t);if(!f)return {available:true,fight:null};
  const used=Number(a.getFlag('midi-qol','actions')?.bonusActionsUsed??0),max=Math.max(1,Number(a.getFlag('midi-qol','actions')?.bonusActionsMax??1));
  const reservations=a.effects.filter(e=>e.getFlag(ID,'jumpSpend')?.turn===epoch(f)).length;
  const slot=Math.max(used,reservations),hud=globalThis.__dshCombatPanel?._actionState;
  return {available:slot<max&&!(max===1&&hud?.read(a)?.bonus),fight:f,slot,turn:epoch(f)};
}
export function bonusAvailable(t){return allocation(t).available;}
function hashSlot(text){let a=2166136261,b=5381;for(const c of text){a=Math.imul(a^c.charCodeAt(0),16777619)>>>0;b=(Math.imul(b,33)+c.charCodeAt(0))>>>0;}return [a,b].map(x=>x.toString(16).padStart(8,'0')).join('');}
export async function reserveJump(token){
  const a=allocation(token);
  if(!a.fight)return {actor:token.actor,explore:true};
  if(!a.available)throw Error('本轮附赠动作已经使用。');
  const actor=token.actor,id=hashSlot(actor.uuid+'/'+a.turn+'/'+a.slot),command=foundry.utils.randomID();
  if(actor.effects.has(id))throw Error('本轮附赠动作已被使用。');
  const [effect]=await actor.createEmbeddedDocuments('ActiveEffect',[{_id:id,name:'跳跃 · 本轮附赠动作',img:'icons/svg/jump.svg',transfer:false,
    flags:{[ID]:{jumpSpend:{turn:a.turn,combat:a.fight.id,command,slot:a.slot}}}}],{keepId:true});
  if(effect?.getFlag(ID,'jumpSpend')?.command!==command)throw Error('附赠动作未能预留。');
  return {actor,effect,command,turn:a.turn};
}
export async function finishJump(reservation,success){
  if(!reservation||reservation.explore)return;
  const {actor,effect,command}=reservation;
  if(effect.getFlag(ID,'jumpSpend')?.command!==command)return;
  if(!success){if(actor.effects.has(effect.id))await effect.delete();return;}
  const entry=effect.getFlag(ID,'jumpSpend');
  try{if(globalThis.MidiQOL?.setBonusActionUsed)await MidiQOL.setBonusActionUsed(actor);}catch(error){console.warn(ID,'原生附赠动作记录',error);}
  if(actor.effects.has(effect.id)&&Number(actor.getFlag('midi-qol','actions')?.bonusActionsUsed??0)<entry.slot+1){
    await effect.update({changes:[{key:'flags.midi-qol.actions.bonusActionsUsed',mode:CONST.ACTIVE_EFFECT_MODES.UPGRADE,value:String(entry.slot+1)}]});
  }
  globalThis.__dshCombatPanel?._actionState?.mark(actor,'bonus');
}
function pointAt(a,b,apex,t){
  const up=Math.sqrt(Math.max(0,apex-a[1])),down=Math.sqrt(Math.max(0,apex-b[1]));
  return [a[0]+(b[0]-a[0])*t,apex-(up-(up+down)*t)**2,a[2]+(b[2]-a[2])*t];
}
function boxAt(p,size){return {min:p,max:p.map((v,i)=>v+size[i])};}
export function planJump({token,target,body,obstacles,terrain,adapter,budget}){
  const {height,length,running}=strengthJump(token),unit=adapter.scale(),[ox,oz]=adapter.origin();
  const size=footprint(body),a=body.min,goal=[(target.x-ox)/unit-size[0]/2,target.elevation/5,(target.y-oz)/unit-size[2]/2];
  // TokenDocument stores its horizontal coordinates in whole scene pixels.
  goal[0]=Math.round(goal[0]*unit)/unit;goal[2]=Math.round(goal[2]*unit)/unit;
  const field=terrain.surface,land=field?field.level(goal[0]+size[0]/2,goal[2]+size[2]/2,goal[1]):goal[1];
  const fail=reason=>({valid:false,reason,cost:0,points:[],costs:[],budget:budget.budget});
  if(!Number.isFinite(land)||Math.abs(land-goal[1])>.24)return fail('这里没有可落脚的支撑面');
  goal[1]=land;
  const horizontal=Math.hypot(goal[0]-a[0],goal[2]-a[2])*5,rise=(land-a[1])*5;
  if(rise>height+.035||horizontal>length+.04||height<=0)return fail('超出力量跳跃范围：高度 '+height+' 尺，水平 '+length+' 尺');
  if(!terrain.nav.standing(a,size,obstacles)||!terrain.nav.standing(goal,size,obstacles))return fail('起跳或落点被占用，或缺少完整支撑');
  if(!bonusAvailable(token))return fail('本轮附赠动作已经使用');
  const apex=a[1]+height/5;
  const cost=Math.max(horizontal,Math.max(0,rise),horizontal<.08?height:0);
  const count=Math.max(10,Math.ceil((horizontal+height+Math.abs(rise))/.75));
  let prev=a;const points=[],costs=[],e=game.Levels3DPreview;
  const world=(p)=>({x:ox+(p[0]+size[0]/2)*unit,y:oz+(p[2]+size[2]/2)*unit,elevation:p[1]*5});
  for(let i=0;i<=count;i++){
    const t=i/count,p=pointAt(a,goal,apex,t),b=boxAt(p,size),prior=boxAt(prev,size);
    const query={min:p.map((n,k)=>Math.min(n,prev[k])),max:b.max.map((n,k)=>Math.max(n,prior.max[k]))};
    if(terrain.barriers.blocks(prev,p,size)||sweptBodyBlocked(prev,p,size,terrain.nav.query(query).concat(obstacles)))return fail('跳跃轨迹会碰到墙、门或指示物');
    if(i>0){
      const before=world(prev),after=world(p);
      const midHeight=size[1]*5;
      for(const [dx,dz,h] of [[0,0,.22],[0,0,midHeight-.15],[-.36,0,midHeight*.45],[.36,0,midHeight*.45],[0,-.36,midHeight*.45],[0,.36,midHeight*.45]]){
        const ray=q=>({x:q.x+dx*size[0]*unit,y:q.y+dz*size[2]*unit,z:q.elevation+h});
        if(e.interactionManager.computeSightCollision(ray(before),ray(after),'collision'))return fail('跳跃轨迹碰到实体地形，或头顶净空不足');
      }
    }
    points.push(world(p));costs.push(cost*t);prev=p;
  }
  return {valid:true,jump:true,height,length,running,cost,costs,points,budget:budget.budget,tokenId:token.id,
    source:{x:ox+a[0]*unit,y:oz+a[2]*unit,elevation:a[1]*5},goal:{x:ox+goal[0]*unit,y:oz+goal[2]*unit,elevation:land*5},apex:apex*5,
    terrainSignature:terrain.signature,target};
}
export function registerJump(doc,entry){permits.set(doc,entry);}
export function unregisterJump(doc){permits.delete(doc);}
export function allowsJumpUpdate(doc,changes,opts){
  const s=permits.get(doc);if(!s||opts?.mcbJump?.command!==s.command||!doc.isOwner||doc.locked||!near(doc._source,s.source))return false;
  return near({...doc._source,...changes},s.goal)&&opts._movement?.[doc.id]?.destination&&near(opts._movement[doc.id].destination,s.goal);
}
function animate(doc,move,opts){
  const data=opts?.mcbJump;if(!data||!active3D()||doc.parent!==canvas.scene)return;
  const e=game.Levels3DPreview,model=e.tokens[doc.id]?.model;if(!model||!Number.isFinite(data.apex)||!Number.isFinite(data.duration))return;
  const prior=clips.get(doc.id);if(prior)prior();
  const original=model.position.y,duration=Math.max(160,Math.min(950,data.duration)),t0=performance.now(),scale=canvas.grid.size/e.factor/5;
  const a=move.origin.elevation,b=move.destination.elevation,apex=Math.min(Math.max(a,b)+10,Math.max(a,b,data.apex));
  let handle;const finish=()=>{cancelAnimationFrame(handle);model.position.y=original;clips.delete(doc.id);};clips.set(doc.id,finish);
  function frame(now){const t=Math.min(1,(now-t0)/duration);if(t>=1||!active3D()||doc.parent!==canvas.scene)return finish();
    const arcy=pointAt([0,a,0],[0,b,0],apex,t)[1];model.position.y=original+(arcy-(a+(b-a)*t))*scale;handle=requestAnimationFrame(frame);}
  handle=requestAnimationFrame(frame);
}
export function installJump(){
 Hooks.once('ready',()=>{
   libWrapper.register(ID,'CONFIG.Token.objectClass.prototype.measureMovementPath',function(wrapped,points,options){
     const result=wrapped(points,options),order=permits.get(this.document);
     if(!order||!active3D()||result.waypoints.length!==points.length)return result;
     // Core rebuilds the path and assigns its measured cost after document movement
     // is prepared. Change only the segment of the specific committed jump.
     for(let i=points.length-1;i>0;i--){
       if(points[i].action!=='jump'||!near(points[i],order.goal)||!near(points[i-1],order.source))continue;
       const segment=result.waypoints[i].backward,delta=order.cost-segment.cost;segment.cost=order.cost;
       for(let j=i;j<result.waypoints.length;j++)result.waypoints[j].cost+=delta;
       result.cost+=delta;break;
     }
     return result;
   },'WRAPPER');
 });
 Hooks.on('moveToken',(doc,move,opts)=>{
  if(!doc.object)return;
  const id=doc.uuid,turn=epoch(fightFor(doc.object)),last=run.get(id),grid=doc.parent.grid,from=move.origin,end=move.destination;
  const list=move.passed?.waypoints??[];
  if(opts?.mcbJump||opts?.teleport||!list.length||list.some(p=>p.action!=='walk'))run.delete(id);
  else {const extra=Math.hypot(end.x-from.x,end.y-from.y)*grid.distance/grid.size;run.set(id,{turn,end:{...end},distance:Math.min(10,(last?.turn===turn&&near(last.end,from)?last.distance:0)+extra)});}
  animate(doc,move,opts);
 });
 async function clean(c,deleted=false){
  if(game.users.activeGM&&!game.users.activeGM.isSelf)return;
  const actors=new Set([...c.combatants].map(x=>x.actor).filter(a=>a?.isOwner));
  for(const a of actors){const ids=a.effects.filter(e=>{const f=e.getFlag(ID,'jumpSpend');return f?.combat===c.id&&(deleted||f.turn!==epoch(c));}).map(e=>e.id);if(ids.length)await a.deleteEmbeddedDocuments('ActiveEffect',ids);}
 }
 Hooks.on('updateCombat',c=>void clean(c));Hooks.on('deleteCombat',c=>void clean(c,true));
 Hooks.on('canvasTearDown',()=>{for(const f of clips.values())f();run.clear();});
}
