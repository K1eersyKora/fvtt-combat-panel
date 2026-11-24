// Reuse the browser's static image decoders when WebCodecs is unavailable on LAN HTTP.
const text=(bytes,i,n)=>String.fromCharCode(...bytes.subarray(i,i+n));
const u16=(b,i)=>b[i]|b[i+1]<<8;
const u24=(b,i)=>u16(b,i)|b[i+2]<<16;
const u32=(b,i)=>new DataView(b.buffer,b.byteOffset+i,4).getUint32(0,true);
function blocks(b,i){while(i<b.length){const n=b[i++];if(!n)return i;i+=n;}throw Error('动图片段无效');}
function gif(b){
  const width=u16(b,6),height=u16(b,8),header=13+(b[10]&128?3*(2<<(b[10]&7)):0),frames=[];
  let i=header,gce;
  while(i<b.length){
    if(b[i]===59)break;
    if(b[i]===33){const end=blocks(b,i+2);if(b[i+1]===249)gce=b.slice(i,end);i=end;continue;}
    if(b[i]!==44)throw Error('GIF 图像块无效');
    const x=u16(b,i+1),y=u16(b,i+3),w=u16(b,i+5),h=u16(b,i+7),flags=b[i+9];
    const end=blocks(b,i+11+(flags&128?3*(2<<(flags&7)):0)),desc=b.slice(i,end),head=b.slice(0,header);
    head.set([w&255,w>>8,h&255,h>>8],6);desc.fill(0,1,5);
    frames.push({x,y,w,h,delay:Math.max(20,(gce?u16(gce,4):10)*10),dispose:gce?(gce[3]>>2)&7:0,
      blob:new Blob([head,...(gce?[gce]:[]),desc,new Uint8Array([59])],{type:'image/gif'})});
    i=end;gce=null;
  }return {width,height,frames};
}
function webp(b){
  let width,height;const frames=[];
  for(let i=12;i+8<=b.length;){const name=text(b,i,4),len=u32(b,i+4),p=i+8,end=p+len;if(end>b.length)throw Error('WebP 图像块无效');
    if(name==='VP8X'){width=u24(b,p+4)+1;height=u24(b,p+7)+1;}
    if(name==='ANMF'){
      const x=2*u24(b,p),y=2*u24(b,p+3),w=u24(b,p+6)+1,h=u24(b,p+9)+1,frame=b.subarray(p+16,end);
      const header=new Uint8Array(30);header.set([82,73,70,70],0);header.set([87,69,66,80,86,80,56,88,10],8);
      new DataView(header.buffer).setUint32(4,header.length-8+frame.length,true);header[20]=16;
      for(let n=0;n<3;n++){header[24+n]=(w-1)>>(n*8);header[27+n]=(h-1)>>(n*8);}
      frames.push({x,y,w,h,delay:Math.max(20,u24(b,p+12)),dispose:b[p+15]&1?2:0,clear:!!(b[p+15]&2),blob:new Blob([header,frame],{type:'image/webp'})});
    }i=end+(len&1);
  }return {width,height,frames};
}
export async function animationFrames(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const spec=text(bytes,0,3)==='GIF'?gif(bytes):text(bytes,0,4)==='RIFF'?webp(bytes):null;
  if(!spec?.frames.length||spec.width*spec.height*spec.frames.length>12000000||spec.frames.length>160)throw Error('此动态素材需要桌面解码');
  const canvas=document.createElement('canvas');canvas.width=spec.width;canvas.height=spec.height;const ctx=canvas.getContext('2d');
  const frames=[],delays=[];let prev,restore;
  try{
    for(const f of spec.frames){
      if(prev?.dispose===2)ctx.clearRect(prev.x,prev.y,prev.w,prev.h);
      if(prev?.dispose===3&&restore)ctx.putImageData(restore,0,0);
      restore=f.dispose===3?ctx.getImageData(0,0,canvas.width,canvas.height):null;
      if(f.clear)ctx.clearRect(f.x,f.y,f.w,f.h);
      const part=await createImageBitmap(f.blob);ctx.drawImage(part,f.x,f.y);part.close();
      frames.push(await createImageBitmap(canvas));delays.push(f.delay);prev=f;
    }
    return {frames,delays,period:delays.reduce((a,b)=>a+b,0),start:performance.now()};
  }catch(e){for(const f of frames)f.close();throw e;}
}
