import {rayAt,surfaceHits,scenePoint,worldPoint,ID} from './combat-space-3.js';

const nodeName=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
function onDeck(object,mesh){
  if(!mesh)return false;
  const name=nodeName(mesh);
  for(let p=object;p;p=p.parent)if(nodeName(p.name).includes(name))return true;
  return false;
}

// The visible frontmost surface wins. A named rope bridge can also contribute its
// continuous load-bearing deck between planks without picking through foreground walls.
export function walkingPoint(x,y,surface){
  const q=rayAt(x,y);if(!q)return null;
  const hits=surfaceHits(q),front=hits.next().value,raw=front?scenePoint(front.point):null;
  if(!surface?.pickWalkway)return raw;
  const e=q.view.engine,u=canvas.grid.size,size=canvas.scene.grid.distance,d=canvas.scene.getDimensions();
  const ratio=e.factor/u,o=q.ray.ray.origin,dir=q.ray.ray.direction;
  const walk=surface.pickWalkway([o.x*ratio-d.sceneX/u,o.y*ratio,o.z*ratio-d.sceneY/u],[dir.x,dir.y,dir.z]);
  if(!walk||walk.distance/ratio<e.camera.near)return raw;
  for(let h=front;h&&h.distance*ratio<walk.distance-.015;h=hits.next().value){
    if(!onDeck(h.object,walk.mesh))return raw;
  }
  const [vx,vy,vz]=walk.point,point={x:d.sceneX+vx*u,y:d.sceneY+vz*u,elevation:vy*size};
  const provider=canvas.scene.getFlag(ID,'config')?.terrainProvider;
  const tile=Object.values(e.tiles).find(t=>t.mesh?.visible&&t.collision&&t.tile?.document?.getFlag(provider,'part')===walk.part);
  if(!tile||e.interactionManager._clippingFilter&&!e.interactionManager._clippingFilter({object:tile.mesh,point:worldPoint(point),distance:walk.distance/ratio}))return raw;
  return point;
}
