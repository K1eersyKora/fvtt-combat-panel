import {createHash,createHmac,createCipheriv,randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {deflateSync} from 'node:zlib';

const STEP=16,zeroIV=Buffer.alloc(12);
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function pngChunk(name,data){
  const buf=Buffer.alloc(12+data.length);buf.writeUInt32BE(data.length);buf.write(name,4,'ascii');data.copy(buf,8);
  let c=0xffffffff;for(const n of buf.subarray(4,-4))c=crcTable[(c^n)&255]^(c>>>8);
  buf.writeUInt32BE((c^0xffffffff)>>>0,buf.length-4);return buf;
}
function png(w,h,raw){
  const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(raw,{level:3})),pngChunk('IEND',Buffer.alloc(0))]);
}
const derive=(seed,i)=>createHmac('sha256',seed).update(String(i)).digest();
export function releasedKeys(atlas,indices){
  if(!Array.isArray(indices)||indices.length>1024)throw Error('视野密钥请求过大');
  return indices.map(i=>{if(!Number.isInteger(i)||i<0||i>=atlas.cols*atlas.rows)throw Error('无效的地图块');return [i,derive(atlas.seed,i).toString('base64')];});
}
let master;
async function atlasSecret(cache){
  if(master)return master;
  const file=path.join(cache,'terrain-master.key');await fs.promises.mkdir(cache,{recursive:true});
  try{await fs.promises.writeFile(file,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  master=await fs.promises.readFile(file);return master;
}
export async function stageAtlas(req,seat,cache,scope,query,revision){
  const scene=query.get('scene'),w=Number(query.get('w')),h=Number(query.get('h'));
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(scene)||![w,h].every(n=>Number.isInteger(n)&&n>0&&n<=2048))throw Error('地图尺寸无效');
  const chunks=[];let length=0;for await(const b of req){length+=b.length;if(length>w*h*4)throw Error('地图数据过长');chunks.push(b);}
  if(length!==w*h*4)throw Error('地图数据不完整');const raw=Buffer.concat(chunks);
  const content=createHash('sha256').update(raw).digest('hex');
  const seed=createHmac('sha256',await atlasSecret(cache)).update([scope,scene,w,h,content].join('/')).digest();
  const old=seat.atlases?.get(scene);if(old?.seed.equals(seed)&&fs.existsSync(old.file))return;
  const cols=Math.ceil(w/STEP),rows=Math.ceil(h/STEP),count=cols*rows;
  const header=Buffer.alloc(20+4*(count+1));header.write('FMA1');header.writeUInt32LE(w,4);header.writeUInt32LE(h,8);header.writeUInt32LE(STEP,12);header.writeUInt32LE(count,16);
  const parts=[header];let offset=header.length;
  for(let i=0;i<count;i++){
    if((i&127)===0){
      await new Promise(r=>setImmediate(r));
      if(revision!==seat.packRevision)return;
    }
    const x=(i%cols)*STEP,y=Math.floor(i/cols)*STEP,tw=Math.min(STEP,w-x),th=Math.min(STEP,h-y),pixels=Buffer.alloc(th*(tw*4+1));
    for(let j=0;j<th;j++)raw.copy(pixels,j*(tw*4+1)+1,((y+j)*w+x)*4,((y+j)*w+x+tw)*4);
    // Each cell has a distinct key scoped to the exact full raster and dimensions.
    const cipher=createCipheriv('aes-256-gcm',derive(seed,i),zeroIV);
    const sealed=Buffer.concat([cipher.update(png(tw,th,pixels)),cipher.final(),cipher.getAuthTag()]);
    header.writeUInt32LE(offset,20+4*i);parts.push(sealed);offset+=sealed.length;
  }
  header.writeUInt32LE(offset,20+count*4);
  const bytes=Buffer.concat(parts),key=createHash('sha256').update(bytes).digest('hex'),file=path.join(cache,key);
  await fs.promises.writeFile(file,bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const atlas={key,file,bytes:bytes.length,mime:'application/x-fvtt-terrain',animated:false,w,h,step:STEP,cols,rows,scene,seed};
  if(revision!==seat.packRevision)return;
  seat.atlases??=new Map();seat.atlases.set(scene,atlas);
}
