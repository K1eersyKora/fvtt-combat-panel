import {ID,active3D,worldPoint} from './combat-space-2.js';
import {playFlat as play,clearFlat,flatStatus,syncFlatImpact,warmSpells} from './flat-effects-2.js';
const workflowIds=new WeakMap();
const signalled=new WeakSet();
let installed=false;
function tokenWorld(uuid){if(typeof uuid!=='string')return null;const d=fromUuidSync(uuid),e=game.Levels3DPreview,t=e?.tokens[d?.id];if(!t)return null;const p=t.mesh.getWorldPosition(new e.THREE.Vector3());p.y+=t.d*.7;return {x:p.x*e.factor,y:p.z*e.factor,elevation:p.y*e.factor/canvas.grid.size*canvas.scene.grid.distance};}
function templateDoc(value){try{const v=typeof value==='string'?fromUuidSync(value):value;return v?.documentName==='MeasuredTemplate'?v:v?.document?.documentName==='MeasuredTemplate'?v.document:null;}catch{return null;}}
export async function templateReady(doc,timeout=2500){
  const scene=doc.parent?.id,start=performance.now();
  while(active3D()&&canvas.scene.id===scene&&performance.now()-start<timeout){
    if(!canvas.scene.templates.has(doc.id))return null;
    const entity=game.Levels3DPreview.templates[doc.id];if(entity?._effectOrigin&&entity.mesh)return entity;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  return null;
}
function publish(data){if(play(data))game.socket.emit(`module.${ID}`,{type:'spell',...data});}
async function areaFX(template,cast,activity,allowMissing=false){
  if(!cast?.id||cast.user!==game.user.id||!active3D()||!game.settings.get(ID,'spellVfx'))return;
  const area=template?.getFlag(ID,'area')??cast.point,from=tokenWorld(cast.source);if(!area||!from)return;
  const type=template?.t??activity?.target?.template?.type,shape=type==='circle'&&area.special>0?'cylinder':({sphere:'circle',radius:'circle',cube:'rect',line:'ray'}[type]??type);
  const data={kind:'area',followRoll:true,sourceId:fromUuidSync(cast.source)?.id,id:`mcb-area-${cast.id}`,scene:canvas.scene.id,from,to:{x:area.x,y:area.y,elevation:area.elevation},damage:Array.from(activity?.damage?.parts?.[0]?.types??[])[0]??'force',shape,radius:shape==='rect'?(template?.width||area.distance/Math.SQRT2):area.distance,width:template?.width??activity?.target?.template?.width??5,height:area.special||5,angle:template?.angle??53.130102,direction:area.direction,tilt:area.tilt};
  if(template&&!allowMissing&&!await templateReady(template))return;
  publish(data);
}
function workflowFX(w,settling=false){
  if(!active3D()||!game.settings.get(ID,'spellVfx')||w.aborted||!w.item||(w.userId&&w.userId!==game.user.id))return;
  const activity=w.activity??w.item.system.activities.contents[0];if(!activity||!['attack','save','damage','heal'].includes(activity.type))return;
  const cast=w.workflowOptions?.mcbCast,template=templateDoc(w.templateUuid);
  const area=template?.getFlag(ID,'area')??cast?.point??(template && {x:template.x,y:template.y,elevation:template.elevation??0,distance:template.distance,direction:template.direction});
  if(activity.target?.template?.type&&!area)return;
  const source=w.token?.document??w.token??(cast?.source?fromUuidSync(cast.source):null);if(!source)return;
  const from=tokenWorld(source.uuid);if(!from)return;
  if(area){
    const context=cast??template?.getFlag(ID,'cast')??{id:template.uuid,user:game.user.id,source:source.uuid,point:area};
    void areaFX(template,context,activity,true).catch(e=>console.error(`${ID} spell animation`,e));
    if(settling&&!signalled.has(w)){
      signalled.add(w);const id='mcb-area-'+context.id,scene=canvas.scene.id;
      syncFlatImpact(id,scene);game.socket.emit('module.'+ID,{type:'spell-impact',id,scene});
    }
    return;
  }
  if(activity.type==='attack'&&!w.attackRoll)return;
  if(!workflowIds.has(w))workflowIds.set(w,w.itemCardUuid??`mcb-roll-${foundry.utils.randomID()}`);
  const damage=Array.from(activity.damage?.parts?.[0]?.types??[])[0]??'force',id=workflowIds.get(w);
  const kind=activity.attack?.type?.value==='melee'?'melee':w.item.type==='weapon'?'ranged':'spell';
  const aa=w.item.flags?.autoanimations?.primary?.video;
  const custom=aa?.enableCustom ? aa.customPath : null;
  const clip=typeof custom==='string' && /^(modules|worlds)\/(?!.*\.\.)(?:[^?#:]+)\.(webm|mp4)$/i.test(custom)?custom:undefined;
  const targets=Array.from(w.targets??[]);for(const [index,target]of targets.entries()){const to=tokenWorld(target.document?.uuid??target.uuid);if(to)publish({id:`${id}:${index}`,scene:canvas.scene.id,kind,clip,sourceId:source.id,targetId:target.id,from,to,damage,radius:1.4,shape:null});}
}
function mount(){
  if(installed||!game.Levels3DPreview?.particleSystem)return;
  libWrapper.register(ID,'game.Levels3DPreview.particleSystem.constructor.prototype.effect',async function(w,from,to,params){
    if(!active3D())return w(from,to,params);
    const targets=Array.isArray(to)?to:[to],docs=targets.map(templateDoc).filter(Boolean);
    // HUD casts use one coherent flight/impact sequence instead of the generic
    // template fire. Other template effects retain their provider after readiness.
    if(docs.length&&game.settings.get(ID,'spellVfx')&&docs.every(d=>d.getFlag(ID,'cast')))return;
    for(const doc of docs)if(!await templateReady(doc))return;
    return w(from,to,params);
  },'MIXED');
  installed=true;
}
export function spellVfxStatus(){return {installed,...flatStatus()};}
export function installSpellVfx(){
  Hooks.once('init',()=>game.settings.register(ID,'spellVfx',{name:'3D施法动画',hint:'在方块场景显示法术发射与落点效果。',scope:'world',config:true,type:Boolean,default:true}));
  Hooks.on('ready',()=>{game.socket.on(`module.${ID}`,data=>{if(data?.type==='spell')play(data);else if(data?.type==='spell-impact')syncFlatImpact(data.id,data.scene);});mount();});
  Hooks.on('3DCanvasReady',mount);Hooks.on('3DCanvasSceneReady',()=>{mount();warmSpells();});
  Hooks.on('createMeasuredTemplate',doc=>{const cast=doc.getFlag(ID,'cast');if(cast?.user===game.user.id)void areaFX(doc,cast,fromUuidSync(cast.origin)).catch(e=>console.error(`${ID} template animation`,e));});
  Hooks.on('midi-qol.AttackRollComplete',w=>workflowFX(w));
  for(const hook of ['preCheckSaves','DamageRollComplete','postCheckSaves','RollComplete'])Hooks.on('midi-qol.'+hook,w=>workflowFX(w,true));
  Hooks.on('canvasTearDown',clearFlat);
}
