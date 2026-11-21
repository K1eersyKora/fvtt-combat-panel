import {active3D} from './combat-space-2.js';
import {attackKind,weaponReach} from './spatial-range-1.js';

export function meleeActivity(hud=globalThis.__dshCombatPanel?.hud) {
  const selection=hud?.selection, panel=hud?.panel;
  if(!active3D() || !selection?.option || selection.plan || hud.busy || panel.actor?.uuid!==selection.actorUuid) return null;
  const item=panel.actor.items.get(selection.itemId);
  const activity=item?.system.activities.get(selection.activityId);
  return activity?.type==='attack'&&['mwak','msak','mpak'].includes(attackKind(activity))?activity:null;
}
export function meleeReachGeometry(size,enemy,feet) {
  const axes=[0,2], targetSize=enemy.max.map((n,i)=>n-enemy.min[i]), radius=feet/5;
  const aligned=enemy.min.map((v,i)=>v+(targetSize[i]-size[i])/2);
  const padding=size.map((v,i)=>Math.max(0,(v+targetSize[i])/2-1));
  const offset=(p,i)=>Math.sign(p[i]-aligned[i])*Math.max(0,Math.abs(p[i]-aligned[i])-padding[i]);
  const vertical=p=>Math.abs(offset(p,1));
  const distance=p=>Math.hypot(offset(p,0),offset(p,2),vertical(p));
  function contacts(p){
    const result=[];
    // The centers of two unsnapped tokens need not lie on the same search lattice.
    // Generate true face contacts, retaining the lateral offset where reach allows it.
    for(const axis of axes){
      const cross=2-axis;
      for(const face of [enemy.min[axis]-size[axis],enemy.max[axis]]){
        const q=[...p];q[axis]=face;
        const lateral=padding[cross]+Math.sqrt(Math.max(0,radius**2-offset(q,axis)**2-vertical(p)**2));
        q[cross]=Math.max(aligned[cross]-lateral,Math.min(aligned[cross]+lateral,p[cross]));
        result.push(q);
        if(q[cross]!==aligned[cross]){const center=[...q];center[cross]=aligned[cross];result.push(center);}
      }
    }
    // A reach weapon can stop short of physical contact.
    const x=offset(p,0),z=offset(p,2),horizontal=Math.hypot(x,z);
    const limit=Math.sqrt(Math.max(0,radius**2-vertical(p)**2));
    if(horizontal>limit&&horizontal>0){
      const fraction=1-limit/horizontal;
      result.push([p[0]-x*fraction,p[1],p[2]-z*fraction]);
    }
    return result;
  }
  return {feet,distance,remaining:p=>Math.max(0,distance(p)-radius),contacts};
}
export function approachRule(token,target,body,enemy,activity,adapter) {
  const feet=weaponReach(activity);
  const targetSize=enemy.max.map((n,i)=>n-enemy.min[i]), size=body.max.map((n,i)=>n-body.min[i]);
  const geometry=meleeReachGeometry(size,enemy,feet);
  const unit=adapter.scale(),[ox,oz]=adapter.origin(),manager=game.Levels3DPreview.interactionManager;
  const point=(p,s)=>({x:ox+(p[0]+s[0]/2)*unit,y:oz+(p[2]+s[2]/2)*unit,z:(p[1]+s[1]*.65)*5});
  const end=point(enemy.min,targetSize);
  return {...geometry,accepts(p) {
    return geometry.distance(p)<=feet/5+.00002 && !manager.computeSightCollision(point(p,size),end,'sight');
  }};
}
export function installMeleeHooks(api) {
  let installed=false;
  function mount() {
    if(installed||!globalThis.__dshCombatPanel?.hud)return;
    const hudPath='globalThis.__dshCombatPanel.hud.';
    libWrapper.register('fvtt-mc-builder',hudPath+'move',function(w,ev){
      const result=w(ev);
      if(meleeActivity(this)) api.hover(ev,this);
      return result;
    },'WRAPPER');
    libWrapper.register('fvtt-mc-builder',hudPath+'commitSelection',async function(w,target,...args){
      const act=meleeActivity(this);
      if(act && target && target!==this.panel.token && !await api.beforeAttack(this,act,target))return;
      return w(target,...args);
    },'MIXED');
    libWrapper.register('fvtt-mc-builder',hudPath+'cancel',function(w,...args){
      api.cancel();return w(...args);
    },'WRAPPER');
    installed=true;
  }
  for(const hook of ['ready','canvasReady','3DCanvasSceneReady'])Hooks.on(hook,()=>setTimeout(mount,0));
}
