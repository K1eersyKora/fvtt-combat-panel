export const ID='fvtt-mc-builder';
let cache, raycaster;
export function active3D(){return !!(game.Levels3DPreview?._active&&canvas.scene?.getFlag(ID,'config'));}
export function view3D(){
  const e=game.Levels3DPreview;if(!e?._ready||!e.camera)return null;
  const frame=Math.floor(performance.now()/16),revision=e.controls?._mcbCameraRevision??0;
  if(cache?.frame===frame&&cache.revision===revision&&cache.engine===e&&cache.scene===canvas.scene.id)return cache;
  const rect=e.renderer.domElement.getBoundingClientRect();if(!rect.width||!rect.height)return null;
  e.camera.updateMatrixWorld();
  return cache={engine:e,rect,frame,revision,scene:canvas.scene.id,projections:new Map()};
}
export function worldPoint(p){const e=game.Levels3DPreview;return new e.THREE.Vector3(p.x/e.factor,(p.elevation??p.z??0)*canvas.grid.size/canvas.scene.grid.distance/e.factor,p.y/e.factor);}
export function scenePoint(p){const e=game.Levels3DPreview;return {x:p.x*e.factor,y:p.z*e.factor,elevation:p.y*e.factor/canvas.grid.size*canvas.scene.grid.distance};}
export function screenPoint(point,view=view3D()){
  if(!view)return null;const p=point.clone().project(view.engine.camera),r=view.rect;
  if(![p.x,p.y,p.z].every(Number.isFinite)||p.z<-1||p.z>1)return null;
  return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
}
export function tokenProjection(token){
  const view=view3D(),e=view?.engine,t=e?.tokens[token?.id];
  if(!t?.mesh?.visible||!token?.actor||token.destroyed)return null;
  if(view.projections.has(token.id))return view.projections.get(token.id);
  t.mesh.updateWorldMatrix(true,false);const base=t.mesh.getWorldPosition(new e.THREE.Vector3()),top=base.clone();top.y+=t.d;
  const feet=screenPoint(base,view),head=screenPoint(top,view);if(!feet||!head)return null;
  const right=new e.THREE.Vector3().setFromMatrixColumn(e.camera.matrixWorld,0),radius=Math.max(t.w,t.h,canvas.grid.size/e.factor)/2;
  const points=[base,top].flatMap(p=>[-1,1].map(s=>screenPoint(p.clone().addScaledVector(right,radius*s),view))).filter(Boolean);
  const left=Math.min(...points.map(p=>p.x)),upper=Math.min(...points.map(p=>p.y));
  const result={feet,head,left,top:upper,width:Math.max(...points.map(p=>p.x))-left,height:Math.max(...points.map(p=>p.y))-upper};view.projections.set(token.id,result);return result;
}
export function rayAt(x,y){
  const view=view3D();if(!view)return null;const {engine:e,rect:r}=view;
  if(x<r.left||x>r.right||y<r.top||y>r.bottom)return null;
  raycaster??=new e.THREE.Raycaster();raycaster.setFromCamera(new e.THREE.Vector2((x-r.left)/r.width*2-1,1-(y-r.top)/r.height*2),e.camera);return {ray:raycaster,view};
}
export function* surfaceHits(r){
  const e=r.view.engine;
  const meshes=Object.values(e.tiles??{}).filter(t=>t.mesh?.visible&&t.collision).map(t=>t.mesh);
  if(e.board)meshes.push(e.board);
  for(const mesh of meshes)mesh.updateWorldMatrix(true,true);
  for(const hit of r.ray.intersectObjects(meshes,true))if(!hit.object.userData?.noIntersect&&(!e.interactionManager._clippingFilter||e.interactionManager._clippingFilter(hit)))yield hit;
}
export function surfaceAt(x,y){
  const query=rayAt(x,y),hit=query&&surfaceHits(query).next().value;return hit?scenePoint(hit.point):null;
}
export function writeStyle(el,key,value){if(el.style[key]!==value)el.style[key]=value;}
export function writeAttribute(el,key,value){value=String(value);if(el.getAttribute(key)!==value)el.setAttribute(key,value);}
