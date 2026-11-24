const fault=(status,message)=>Object.assign(Error(message),{status});
const inbox=()=>({last:0,items:[],bytes:0,wait:null});
export function createRelay(epoch){return {epoch,host:inbox(),phone:inbox()};}
export function closeRelay(seat){
  const r=seat.relay;if(!r)return;
  seat.relay=null;
  for(const box of [r.host,r.phone])box.wait?.();
}
function waitFor(box,res,ms=10000){
  box.wait?.();
  return new Promise(resolve=>{
    const done=()=>{clearTimeout(timer);res.off('close',done);if(box.wait===done)box.wait=null;resolve();};
    const timer=setTimeout(done,ms);box.wait=done;res.once('close',done);
  });
}
export async function exchange(seat,role,route,args,res){
  const relay=seat.relay;if(!relay||relay.epoch!==args.epoch)throw fault(409,'连接已被替换');
  const same=()=>{if(seat.relay!==relay)throw fault(409,'连接已被替换');};
  if(route==='/api/relay/push'){
    const box=relay[role==='host'?'phone':'host'],{first,messages}=args;
    if(!Number.isSafeInteger(first)||first<1||first>box.last+1||!Array.isArray(messages)||!messages.length||messages.length>32||
        messages.some(m=>typeof m!=='string'||m.length>(role==='phone'?24000:200000)))throw fault(400,'传输序号或大小无效');
    const fresh=messages.slice(Math.max(0,box.last-first+1));
    const bytes=fresh.reduce((sum,m)=>sum+m.length,0);
    if(box.bytes+bytes>1_500_000||box.items.length+fresh.length>320)throw fault(429,'等候另一端接收');
    for(const data of fresh)box.items.push({seq:++box.last,data});
    box.bytes+=bytes;if(fresh.length)box.wait?.();return {ok:true};
  }
  if(route==='/api/relay/pull'){
    const box=relay[role],after=args.after;
    if(!Number.isSafeInteger(after)||after<0||after>box.last)throw fault(400,'传输序号无效');
    while(box.items.length&&box.items[0].seq<=after)box.bytes-=box.items.shift().data.length;
    if(!box.items.length){await waitFor(box,res);same();}
    let bytes=0;const messages=[];
    for(const item of box.items){if(messages.length&&(bytes+item.data.length>160000||messages.length>=48))break;messages.push(item);bytes+=item.data.length;}
    return {messages};
  }
  throw fault(404,'未找到');
}
