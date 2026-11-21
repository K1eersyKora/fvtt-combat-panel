// Scene pixels in x/y, scene distance units in elevation. Use the requested document pose
// for a projected attack preview, independently of token animation and screen projection.
const planes=new WeakMap();
export function footPoint(token,pose={}){
  const doc=token.document??token, grid=doc.parent.grid;
  const width=pose.width??doc.width,height=pose.height??doc.height;
  return {x:(pose.x??doc.x)+width*grid.size/2,y:(pose.y??doc.y)+height*grid.size/2,elevation:pose.elevation??doc.elevation};
}
export function picturePoint(token,pose={}){
  const doc=token.document??token,grid=doc.parent.grid,point=footPoint(doc,pose);
  const engine=globalThis.game?.Levels3DPreview,entity=engine?.tokens?.[doc.id];
  if(entity?.mesh && entity.token?.document?.parent===doc.parent){
    const model=entity.model;
    let plane=model&&planes.get(model);
    if(!plane&&entity.standupFace&&model){
      model.traverse(child=>{if(child.userData.standupModel&&child.geometry)plane=child;});
      if(plane)planes.set(model,plane);
    }
    const T=engine.THREE;
    if(plane){
      if(!plane.geometry.boundingBox)plane.geometry.computeBoundingBox();
      const center=plane.geometry.boundingBox.getCenter(new T.Vector3());
      const pivot=entity.mesh.getWorldPosition(new T.Vector3());
      const offset=plane.localToWorld(center).sub(pivot).multiplyScalar(engine.factor);
      return {x:point.x+offset.x,y:point.y+offset.z,elevation:point.elevation+offset.y*grid.distance/grid.size};
    }
    if(Number.isFinite(entity.d))return {...point,elevation:point.elevation+entity.d*engine.factor*grid.distance/grid.size/2};
  }
  return {...point,elevation:point.elevation+Math.max(pose.width??doc.width,pose.height??doc.height)*grid.distance/2};
}
