import {active3D} from './combat-space-3.js';

const EPS=1e-8;

// Horizontal distance is charged while the base center travels inside an enemy's
// space. Vertical overlap keeps creatures on separate storeys independent.
export function hostileIntervals(start,end,size,hostiles) {
  return clippedIntervals(start,end,size,hostiles,false);
}

// Ending a move uses the whole base even though pricing uses its center.
export function occupiedIntervals(start,end,size,occupants) {
  return clippedIntervals(start,end,size,occupants,true);
}
function clippedIntervals(start,end,size,bodies,wholeBase) {
  const ranges=[];
  for(const body of bodies){
    let enter=0,leave=1;
    for(let axis=0;axis<3;axis++){
      const full=axis===1||wholeBase;
      const from=start[axis]+(full?0:size[axis]/2),delta=end[axis]-start[axis];
      const low=body.min[axis]-(full?size[axis]:0),high=body.max[axis];
      if(Math.abs(delta)<EPS){
        if(from<=low+EPS||from>=high-EPS){leave=0;break;}
      }else{
        const a=(low-from)/delta,b=(high-from)/delta;
        enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));
        if(leave-enter<=EPS)break;
      }
    }
    if(leave-enter>EPS)ranges.push([enter,leave]);
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const range of ranges){
    const last=merged.at(-1);
    if(last&&range[0]<=last[1]+EPS)last[1]=Math.max(last[1],range[1]);
    else merged.push(range);
  }
  return merged;
}

export function hostileFraction(ranges){
  return ranges.reduce((sum,[start,end])=>sum+end-start,0);
}

export function walkingTraffic(token){
  const scene=token?.document?.parent;
  if(!active3D()||scene!==canvas.scene||!scene?.getFlag('fvtt-seagrow-caves','map'))return null;
  const d=scene.getDimensions(),unit=scene.grid.size/scene.grid.distance*5,e=game.Levels3DPreview;
  const position=p=>[(p.x-d.sceneX)/unit,p.elevation/5,(p.y-d.sceneY)/unit];
  const dimensions=t=>{
    const {width,height}=t.document._source;
    return [width,Math.max(width,height,(e.tokens[t.id]?.d||0)*e.factor/unit),height];
  };
  const side=token.document.disposition,occupants=[],hostiles=[];
  for(const other of canvas.tokens.placeables){
    if(other===token||!other.visible||(!game.user.isGM&&other.document.hidden))continue;
    const min=position(other.document._source),size=dimensions(other);
    const body={id:other.id,min,max:min.map((v,i)=>v+size[i])};
    occupants.push(body);
    if(Math.abs(side)===1&&other.document.disposition===-side)hostiles.push(body);
  }
  return {position,size:dimensions(token),occupants,hostiles};
}

// Insert price changes into the drawn line only. Foundry owns the actual
// movement checkpoints and stores their evaluated costs in movement history.
export function pricedLine(points,costs,voxelPoints,size,hostiles){
  if(!hostiles.length||points.length<2)return {points,costs};
  const line=[points[0]],prices=[costs[0]];
  for(let i=1;i<points.length;i++){
    const ranges=hostileIntervals(voxelPoints[i-1],voxelPoints[i],size,hostiles);
    const unitCost=(costs[i]-costs[i-1])/(1+hostileFraction(ranges));
    for(const t of new Set(ranges.flat())){
      if(t<=EPS||t>=1-EPS)continue;
      const extra=ranges.reduce((sum,[a,b])=>sum+Math.max(0,Math.min(b,t)-a),0);
      const a=points[i-1],b=points[i];
      line.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,elevation:a.elevation+(b.elevation-a.elevation)*t});
      prices.push(costs[i-1]+unitCost*(t+extra));
    }
    line.push(points[i]);prices.push(costs[i]);
  }
  return {points:line,costs:prices};
}
