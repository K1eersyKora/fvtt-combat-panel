const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function cardRevision(card){
  if(!card)return '';
  const data=JSON.stringify(card);let a=2166136261,b=5381;
  for(let i=0;i<data.length;i++){const n=data.charCodeAt(i);a=Math.imul(a^n,16777619);b=Math.imul(b,33)^n;}
  return [data.length,a>>>0,b>>>0].join('-');
}

// Both endpoints acknowledge an ordered sequence. Retrying a POST after a dropped
// response must not deliver an action or an asset chunk a second time.
export class RelayChannel {
  constructor(request,epoch){
    this.request=request;this.epoch=epoch;this.transport='https';this.readyState='connecting';
    this.queue=[];this.sent=0;this.received=0;this.bufferedAmount=0;this.sending=false;
    this.abort=new AbortController();
  }
  start(){
    if(this.readyState!=='connecting')return;
    this.readyState='open';this.onopen?.();void this.read();
  }
  send(message){
    if(this.readyState!=='open')throw Error('桌位连接已关闭');
    this.queue.push(message);this.bufferedAmount+=message.length;
    if(!this.sending)void this.write();
  }
  close(){
    if(this.readyState==='closed')return;
    this.readyState='closed';this.abort.abort();this.queue=[];this.bufferedAmount=0;this.onclose?.();
  }
  async retry(e){
    if([401,403,409,413].includes(e.status)){this.close();return;}
    if(this.readyState==='open')await pause(e.status===429?180:600);
  }
  async write(){
    this.sending=true;
    // Let synchronous map updates and asset writes share a request.
    await pause(12);
    while(this.readyState==='open'&&this.queue.length){
      const batch=[];let size=0;
      for(const item of this.queue){if(batch.length&&(size+item.length>100000||batch.length>=32))break;batch.push(item);size+=item.length;}
      try{
        await this.request('relay/push',{epoch:this.epoch,first:this.sent+1,messages:batch},this.abort.signal);
        if(this.readyState!=='open')break;
        this.sent+=batch.length;this.queue.splice(0,batch.length);this.bufferedAmount-=size;
      }catch(e){await this.retry(e);}
    }
    this.sending=false;
  }
  async read(){
    while(this.readyState==='open'){
      try{
        const result=await this.request('relay/pull',{epoch:this.epoch,after:this.received},this.abort.signal);
        if(this.readyState!=='open')break;
        for(const item of result.messages){
          if(item.seq<=this.received)continue;
          this.received=item.seq;this.onmessage?.({data:item.data});
        }
      }catch(e){await this.retry(e);}
    }
  }
}
