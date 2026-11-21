// Shared by previews, native movement and jump arcs. Coordinates are five-foot grid units.
const entries=new WeakMap(),epochs=new WeakMap();
const eps=1e-6;
const clamp=t=>Math.max(0,Math.min(1,t));
function pointDistance(x,z,a,b,c,d){
  const dx=c-a,dz=d-b,t=clamp(((x-a)*dx+(z-b)*dz)/(dx*dx+dz*dz||1));
  return (x-a-t*dx)**2+(z-b-t*dz)**2;
}
function crossed(ax,az,bx,bz,cx,cz,dx,dz){
  const u=bx-ax,v=bz-az,w=dx-cx,y=dz-cz,k=u*y-v*w;
  if(Math.abs(k)<eps)return false;
  const t=((cx-ax)*y-(cz-az)*w)/k,s=((cx-ax)*v-(cz-az)*u)/k;
  return t>=0&&t<=1&&s>=0&&s<=1;
}
export function makeBarriers(faces){
  const cells=new Map();
  for(const w of faces){
    const [ax,az,bx,bz,,,width=0]=w,r=width/2;
    for(let x=Math.floor(Math.min(ax,bx)-r);x<=Math.floor(Math.max(ax,bx)+r);x++)
      for(let z=Math.floor(Math.min(az,bz)-r);z<=Math.floor(Math.max(az,bz)+r);z++){
        const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(w);
      }
  }
  function blocks(start,end,size){
    const [sx,sy,sz]=size,px=start[0]+sx/2,pz=start[2]+sz/2,qx=end[0]+sx/2,qz=end[2]+sz/2;
    const dx=qx-px,dz=qz-pz,dy=end[1]-start[1],tested=new Set();
    for(let x=Math.floor(Math.min(px,qx)-sx/2);x<=Math.floor(Math.max(px,qx)+sx/2);x++)
      for(let z=Math.floor(Math.min(pz,qz)-sz/2);z<=Math.floor(Math.max(pz,qz)+sz/2);z++)
        for(const wall of cells.get(x+','+z)??[]){
          if(tested.has(wall))continue;tested.add(wall);
          const [a,b,c,d,bottom,top,width=0,edge=false]=wall;
          const lo=bottom-sy+.015,hi=top-.015;
          let t0=0,t1=1;
          if(Math.abs(dy)<eps){if(start[1]<=lo||start[1]>=hi)continue;}
          else {const u=(lo-start[1])/dy,v=(hi-start[1])/dy;t0=Math.max(0,Math.min(u,v));t1=Math.min(1,Math.max(u,v));if(t0>t1)continue;}
          const rx=(edge ? .12 : Math.max(.03,sx/2-.018))+width/2,rz=(edge ? .12 : Math.max(.03,sz/2-.018))+width/2;
          const ax=(px+dx*t0)/rx,az=(pz+dz*t0)/rz,bx=(px+dx*t1)/rx,bz=(pz+dz*t1)/rz,cx=a/rx,cz=b/rz,ex=c/rx,ez=d/rz;
          if(crossed(ax,az,bx,bz,cx,cz,ex,ez)||Math.min(pointDistance(ax,az,cx,cz,ex,ez),pointDistance(bx,bz,cx,cz,ex,ez),
            pointDistance(cx,cz,ax,az,bx,bz),pointDistance(ex,ez,ax,az,bx,bz))<1-eps)return true;
        }
    return false;
  }
  return {blocks,faces};
}
export function touchBarriers(scene){if(scene){entries.delete(scene);epochs.set(scene,(epochs.get(scene)??0)+1);}}
export function barriersFor(scene){
  if(entries.has(scene))return entries.get(scene);
  const area=scene.getDimensions(),u=scene.grid.size,dist=scene.grid.distance,faces=[];
  for(const w of scene.walls){
    if(!w.move || (w.door&&w.ds===CONST.WALL_DOOR_STATES.OPEN))continue;
    const [a,b,c,d]=w.c,h=w.flags?.['wall-height']??{},f=w.flags?.['fvtt-seagrow-caves']??{};
    faces.push([(a-area.sceneX)/u,(b-area.sceneY)/u,(c-area.sceneX)/u,(d-area.sceneY)/u,(h.bottom??-1e7)/dist,(h.top??1e7)/dist,
      Math.max(0,Number(f.solidWidth??0)),f.kind==='edge']);
  }
  const value={...makeBarriers(faces),revision:epochs.get(scene)??0};entries.set(scene,value);return value;
}
for(const name of ['createWall','updateWall','deleteWall'])globalThis.Hooks?.on(name,wall=>touchBarriers(wall.parent));
