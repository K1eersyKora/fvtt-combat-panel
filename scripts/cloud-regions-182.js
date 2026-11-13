const ID='fvtt-combat-panel';
const values=collection=>Array.from(collection?.contents??collection??[]);
export function isCloudRegion(region){
  const behaviors=values(region?.behaviors);
  return !region?.flags?.['gambits-premades']?.excludeRegionHandling&&behaviors.length>0&&behaviors.every(b=>b.type==='executeScript')&&behaviors.some(b=>/game\.gps\.cloudOfDaggers(?:2024)?\s*\(/.test(b.system?.source??''));
}
export function cloudTokenPoints(token,data={}){
  const source=token._source??token,merged={x:source.x,y:source.y,width:source.width,height:source.height,elevation:source.elevation,...data};
  const size=token.parent.grid.size,w=merged.width*size,h=merged.height*size,r=Math.min(w,h)*0.1;
  return [[r,r],[w-r,r],[r,h-r],[w-r,h-r],[w/2,r],[w/2,h-r],[r,h/2],[w-r,h/2],[w/2,h/2]].map(([x,y])=>({x:merged.x+x,y:merged.y+y,elevation:merged.elevation}));
}
export function cloudContainsToken(token,region,data={}){
  if(token.parent!==region.parent)return false;
  return cloudTokenPoints(token,data).some(point=>region.testPoint(point));
}
function cloudReady(region){
  const links=region.flags?.['region-attacher'];
  if(!links?.attachedTemplate||!links.actorUuid||!links.itemUuid)return false;
  const template=fromUuidSync(links.attachedTemplate);
  return Number(template?.flags?.['gambits-premades']?.codCastLevel)>=2;
}
let repairing=new Set();
export async function repairCloudMembership(scene){
  if(!game.user.isGM||game.gps?.disableRegionTeleport||repairing.has(scene.id))return {changed:[],skipped:true};
  const regions=values(scene.regions).filter(region=>isCloudRegion(region)&&cloudReady(region)),updates=[];
  for(const token of values(scene.tokens)){
    const old=[...(token._source._regions??[])].sort(),next=new Set(old);
    for(const region of regions)if(cloudContainsToken(token,region))next.add(region.id);else next.delete(region.id);
    const ids=[...next].sort();if(JSON.stringify(old)!==JSON.stringify(ids))updates.push({_id:token.id,_regions:ids});
  }
  if(!updates.length)return {changed:[]};
  repairing.add(scene.id);const disabled=[];
  try{
    // Rebuilding membership is bookkeeping, not a creature entering the spell.
    for(const region of regions){const entry=values(region.behaviors).filter(b=>!b.disabled&&b.system?.events?.has?.('tokenEnter')||!b.disabled&&Array.isArray(b.system?.events)&&b.system.events.includes('tokenEnter'));if(entry.length){disabled.push({region,ids:entry.map(b=>b.id)});await region.updateEmbeddedDocuments('RegionBehavior',entry.map(b=>({_id:b.id,disabled:true})));}}
    await scene.updateEmbeddedDocuments('Token',updates,{diff:false,noHook:true});
    return {changed:updates.map(u=>({id:u._id,regions:u._regions}))};
  }finally{
    for(const {region,ids}of disabled)if(game.scenes.get(scene.id)?.regions.has(region.id))await region.updateEmbeddedDocuments('RegionBehavior',ids.filter(id=>region.behaviors.has(id)).map(id=>({_id:id,disabled:false})));
    repairing.delete(scene.id);
  }
}
export function registerCloudRegions(){
  if(globalThis.__dshCloudRegions182||!game.modules.get('gambits-premades')?.active||!globalThis.libWrapper)return;
  globalThis.__dshCloudRegions182=true;
  libWrapper.register(ID,'TokenDocument.prototype.testInsideRegion',function(wrapped,region,data={}){
    if(!isCloudRegion(region))return wrapped(region,data);
    const source=this._source,full={x:source.x,y:source.y,width:source.width,height:source.height,elevation:source.elevation,shape:source.shape,...data};
    try{wrapped(region,full);}catch(error){if(globalThis.canvas?.dimensions)throw error;}
    return !game.gps?.disableRegionTeleport&&cloudContainsToken(this,region,full);
  },'WRAPPER');
  libWrapper.register(ID,'TokenDocument.prototype.segmentizeRegionMovementPath',function(wrapped,region,waypoints){
    if(!isCloudRegion(region))return wrapped(region,waypoints);
    try{wrapped(region,waypoints);}catch(error){if(globalThis.canvas?.dimensions)throw error;}
    if(game.gps?.disableRegionTeleport)return [];
    const points=cloudTokenPoints(this).map(p=>({x:p.x-this._source.x,y:p.y-this._source.y,elevation:p.elevation}));
    return region.segmentizeMovementPath(waypoints,points);
  },'WRAPPER');
  // A just-created region is populated before GP links its template/cast level.
  libWrapper.register(ID,'RegionDocument.prototype._handleEvent',async function(wrapped,event){
    if(['tokenEnter','tokenTurnEnd'].includes(event.name)&&isCloudRegion(this)&&!cloudReady(this))return;
    return wrapped(event);
  },'MIXED');
  const schedule=scene=>{if(game.users.activeGM?.isSelf&&scene&&game.scenes.has(scene.id))Promise.resolve().then(()=>repairCloudMembership(scene)).catch(error=>console.error('['+ID+'] 匕首之云区域索引恢复失败',error));};
  Hooks.on('canvasReady',canvas=>schedule(canvas.scene));
  Hooks.on('updateRegion',region=>schedule(region.parent));
  Hooks.on('updateMeasuredTemplate',template=>schedule(template.parent));
}
