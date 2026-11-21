export function splitWalk(waypoints,costs,available,{measure,ground,standing,occupied=()=>[]}){
  if(!Number.isFinite(available)||costs.at(-1)<available-.015)return {first:waypoints,rest:[],exhausted:false};
  let i=0;
  while(i+1<costs.length&&costs[i+1]<=available+.001)i++;
  if(i===waypoints.length-1&&standing(waypoints[i]))return {first:waypoints,rest:[],exhausted:true};
  for(let j=Math.min(i,waypoints.length-2);j>=0;j--){
    const a=waypoints[j],b=waypoints[j+1],first=waypoints.slice(0,j+1);
    const at=t=>t===0?a:t===1?b:ground({x:Math.round(a.x+(b.x-a.x)*t),y:Math.round(a.y+(b.y-a.y)*t),elevation:a.elevation+(b.elevation-a.elevation)*t});
    let limit=1;
    if(j===i){
      let lo=0,hi=1;
      for(let n=0;n<16;n++){
        const t=n===0?Math.min(1,(available-costs[j])/(costs[j+1]-costs[j]||1)):(lo+hi)/2;
        const p=at(Math.max(0,t)),cost=p?measure([...first,p]):Infinity;
        if(cost<=available+.005){lo=Math.max(0,t);if(Math.abs(available-cost)<=.005)break;}else hi=t;
      }
      limit=lo;
    }
    // Cost is monotone, but the ability to stop is not. Check the budget point
    // first, then the last boundary before a creature or an unsupported step.
    const candidates=[limit,...occupied(a,b).flat().filter(t=>t<limit&&t>0).sort((x,y)=>y-x),0];
    for(const t of candidates){
      const p=at(t);
      if(!p||!standing(p)||(j===i&&measure([...first,p])>available+.005))continue;
      if(p.x!==a.x||p.y!==a.y||Math.abs(p.elevation-a.elevation)>.001)first.push(p);
      return {first,rest:waypoints.slice(t===1?j+2:j+1),exhausted:true};
    }
  }
  return {first:waypoints.slice(0,1),rest:waypoints.slice(1),exhausted:true};
}
export async function askToContinue(order,unspent=0,jump=false){
  const detail=jump?'剩余移动力不足以完成这次跳跃。继续将计入超额移动。':unspent>.05?'剩余 '+unspent.toFixed(1)+' 尺，下一处可安全停留的落点超出额度。':'你已耗尽移动力，是否继续移动？';
  const answer=await foundry.applications.api.DialogV2.wait({id:'mcb-movement-budget',window:{title:'移动力已耗尽'},
    content:'<p>'+detail+'</p>',buttons:[{action:'stop',label:'停止移动',default:true,callback:()=>false},{action:'continue',label:'继续移动',callback:()=>true}],
    render:(_e,dialog)=>{order.dialog=dialog;if(order.cancelled)void dialog.close();},rejectClose:false});
  order.dialog=null;return answer===true&&!order.cancelled;
}
