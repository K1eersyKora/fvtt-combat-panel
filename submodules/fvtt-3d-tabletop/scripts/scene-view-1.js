export const ID='fvtt-3d-tabletop';

export function active3D(){
  return !!(game.Levels3DPreview?._active && canvas?.scene);
}

export function legacyDefault(key,scope){
  return game.settings.storage.get(scope)?.getItem('fvtt-mc-builder.'+key)!=='false';
}

export function castFlag(doc,key){
  return doc?.flags?.['fvtt-seagrow-caves']?.[key]??doc?.flags?.['fvtt-mc-builder']?.[key];
}

export function worldPoint(point){
  const e=game.Levels3DPreview;
  const height=(point.elevation??point.z??0)*canvas.grid.size/canvas.scene.grid.distance;
  return new e.THREE.Vector3(point.x/e.factor,height/e.factor,point.y/e.factor);
}

export function screenPoint(point){
  const {camera,renderer,_ready}=game.Levels3DPreview;
  if(!_ready||!camera)return null;
  const rect=renderer.domElement.getBoundingClientRect();
  if(!rect.width||!rect.height)return null;
  camera.updateMatrixWorld();
  const projected=point.clone().project(camera);
  if(![projected.x,projected.y,projected.z].every(Number.isFinite)||Math.abs(projected.z)>1)return null;
  return {x:rect.left+(projected.x+1)*rect.width/2,y:rect.top+(1-projected.y)*rect.height/2};
}
