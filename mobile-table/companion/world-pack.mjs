import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const types={png:'image/png',apng:'image/apng',svg:'image/svg+xml',gif:'image/gif',webp:'image/webp',avif:'image/avif',jpg:'image/jpeg',jpeg:'image/jpeg',webm:'video/webm',mp4:'video/mp4'};
export const cache=path.join(process.env.LOCALAPPDATA||os.tmpdir(),'FVTTMobileTable','world-pack-cache');
const previous=new Map();
const inFlight=new Map();
const concurrency=6;
const mime=p=>types[path.extname(p).slice(1).toLowerCase()];
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=(status,message)=>Object.assign(Error(message),{status});
export const scopeFor=(seat,origin)=>hash(origin+'\n'+seat.identity);
async function publicDirectory(world){
  const root=process.env.TABLE_WORLD_ASSETS;
  if(!root)return [];
  const dir=path.resolve(root,world);if(!dir.startsWith(path.resolve(root)+path.sep))throw Error('资源包目录无效');
  let base;try{base=await fs.promises.realpath(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const realRoot=await fs.promises.realpath(root);
  if(!base.startsWith(realRoot+path.sep))throw Error('资源包目录不能链接到外部位置');
  const out=[];
  async function walk(current){
    for(const d of await fs.promises.readdir(current,{withFileTypes:true})){
      const f=path.join(current,d.name);if(d.isSymbolicLink())continue;
      if(d.isDirectory())await walk(f);
      else if(d.isFile()&&mime(f)){
        const rel=path.relative(base,f).split(path.sep).join('/');
        const src=/^(assets|icons|modules|systems|worlds)\//.test(rel)?rel:'worlds/'+world+'/mobile-public/'+rel;
        out.push({src,label:path.basename(f),file:f,group:'公开资源目录'});
      }
    }
  }
  await walk(base);return out;
}
async function cacheFile(entry,origin,revalidate){
  const marker=entry.file||entry.url.href;
  const pending=inFlight.get(marker);
  if(pending)return pending;
  const task=readFile(entry,origin,revalidate).finally(()=>inFlight.delete(marker));
  inFlight.set(marker,task);
  return task;
}
async function readFile(entry,origin,revalidate){
  const type=mime(entry.url.pathname);if(!type)throw Error('不支持的素材类型');
  const marker=entry.file||entry.url.href;
  const old=previous.get(marker);
  let input,stamp='',etag='',modified='';
  if(entry.file){
    const stat=await fs.promises.stat(entry.file);stamp=stat.size+':'+stat.mtimeMs;
    if(old?.stamp===stamp&&fs.existsSync(old.file))return old;
    input=fs.createReadStream(entry.file);
  }else{
    if(!revalidate&&old?.checkedAt>Date.now()-5*60*1000&&fs.existsSync(old.file))return old;
    const headers={};if(old&&fs.existsSync(old.file)){
      if(old.etag)headers['If-None-Match']=old.etag;
      else if(old.modified)headers['If-Modified-Since']=old.modified;
    }
    if(entry.url.origin!==origin)throw Error('素材来源与世界地址不一致');
    const response=await fetch(entry.url,{headers,redirect:'error',signal:AbortSignal.timeout(120000)});
    if(response.status===304&&old){old.checkedAt=Date.now();return old;}
    if(!response.ok||!response.body)throw fail(response.status,'HTTP '+response.status);
    if(/text\/html|application\/json/i.test(response.headers.get('content-type')||''))throw Error('素材返回了登录页或错误页');
    etag=response.headers.get('etag')||'';modified=response.headers.get('last-modified')||'';input=Readable.fromWeb(response.body);
  }
  await fs.promises.mkdir(cache,{recursive:true});
  const tmp=path.join(cache,randomUUID()+'.part'),sha=createHash('sha256');let size=0,head=Buffer.alloc(0);
  try{
    await pipeline(input,new Transform({transform(chunk,_enc,done){sha.update(chunk);size+=chunk.length;
      if(head.length<8192)head=Buffer.concat([head,chunk.subarray(0,8192-head.length)]);done(null,chunk);}}),fs.createWriteStream(tmp,{flags:'wx'}));
    const key=sha.digest('hex'),file=path.join(cache,key);
    if(!size)throw Error('空文件');
    if(!fs.existsSync(file)){try{await fs.promises.rename(tmp,file);}catch(e){if(!fs.existsSync(file))throw e;}}
    const animated=type.startsWith('video/')||type==='image/gif'||type==='image/apng'||(type==='image/webp'&&head.subarray(12,16).toString()==='VP8X'&&(head[20]&2)!==0)||(type==='image/png'&&head.includes(Buffer.from('acTL')));
    // A content-addressed file can be shared on disk. Its manifest is private to the current seat.
    const asset={key,file,bytes:size,mime:type,animated,etag,modified,stamp,checkedAt:Date.now()};previous.set(marker,asset);return asset;
  }finally{await fs.promises.unlink(tmp).catch(()=>{});}
}
function normalize(src,origin,base){
  const url=new URL(src,base);
  if(url.origin!==origin||url.username||url.password||url.search||url.hash||!mime(url.pathname))return null;
  let localPath;try{localPath=decodeURIComponent(url.pathname);}catch{return null;}
  if(/[\\\0]/.test(localPath)||/(?:^|\/)(?:api|setup|config|logs|node_modules|\.\.?)(?:\/|$)/i.test(localPath))return null;
  return url;
}
export async function prepare(seat,args,origin){
  if(args.revision!==undefined&&args.revision!==seat.packRevision)throw fail(409,'世界资源已变化');
  if(seat.pack?.state==='building'||seat.pack?.state==='ready')return {ok:true};
  const world=seat.identity.split('/')[0];
  if(!/^[a-z0-9_-]+$/i.test(world)||args.world!==world||!Array.isArray(args.entries))throw fail(400,'世界资源清单无效');
  const base=new URL(args.base||origin,origin);if(base.origin!==origin)throw fail(400,'世界地址不匹配');
  seat.packPending=false;seat.packError='';
  const job={state:'building',total:0,done:0,bytes:0,files:new Map(),index:new Map(),errors:[],missing:[],retry:[],sourceCard:args.card,scope:scopeFor(seat,origin)};
  seat.pack=job;
  void (async()=>{
    job.atlases=new Map();
    for(const a of seat.atlases?.values()||[])if(args.atlases?.includes(a.scene)){
      job.atlases.set(a.scene,a);job.files.set(a.key,{...a,label:'受保护地图 '+a.scene,group:'加密地形'});job.bytes+=a.bytes;
    }
    const list=new Map();
    const declared=args.entries.map(item=>({src:item?.src,label:item?.label,group:item?.group}));
    for(const input of [...declared,...await publicDirectory(world)]){
      if(typeof input?.src!=='string')continue;
      let url;
      try{url=normalize(input.src,origin,base);}catch{continue;}
      if(!url)continue;
      const name=String(input.label||path.basename(decodeURIComponent(url.pathname))).slice(0,150);
      list.set(url.pathname,{...input,url,label:name});
    }
    await collect(seat,job,[...list.values()],origin,args.refresh===true);
  })().catch(err=>failJob(job,err));
  return {ok:true};
}
export function retryPack(seat,origin){
  const job=seat.pack;
  if(job?.state==='building')return true;
  if(job?.state!=='ready')return false;
  if(job.retry.length){
    const pending=job.retry.splice(0);
    job.errors=[];
    void collect(seat,job,pending,origin,true).catch(err=>failJob(job,err));
  }
  return true;
}
function failJob(job,err){
  job.state='failed';
  job.errors.push({name:'世界包',error:err.message});
}
async function collect(seat,job,entries,origin,revalidate){
  job.state='building';job.total=entries.length;job.done=0;
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(concurrency,entries.length)},async()=>{
    while(cursor<entries.length&&seat.pack===job){const entry=entries[cursor++];
      try{
        const asset=await cacheFile(entry,origin,revalidate);
        job.index.set(entry.url.pathname,asset.key);
        if(!job.files.has(asset.key)){job.files.set(asset.key,{...asset,label:entry.label,group:String(entry.group||'世界资源').slice(0,40)});job.bytes+=asset.bytes;}
      }catch(err){
        const issue={name:entry.label,error:err.message};
        if(err.status===404||err.status===410||err.code==='ENOENT'){
          job.missing.push({...issue,path:entry.url.pathname});
        }else{
          job.retry.push(entry);job.errors.push(issue);
        }
      }finally{job.done++;}
    }
  }));
  if(seat.pack!==job)return;
  if(job.sourceCard?.actorId&&Array.isArray(job.sourceCard.actions)){
      const card=structuredClone(job.sourceCard);
      const portrait=job.files.get(job.index.get(card.portraitPath));delete card.portraitPath;
      if(portrait)card.portraitAsset=publicFile(portrait);
      for(const a of [...card.actions,...(card.inventory||[])]){
        const asset=job.files.get(job.index.get(a.iconPath));delete a.iconPath;
        if(asset)a.iconAsset=publicFile(asset);
      }
      const data=Buffer.from(JSON.stringify(card)),key=hash(data),file=path.join(cache,key);
      await fs.promises.mkdir(cache,{recursive:true});
      await fs.promises.writeFile(file,data,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
      if(job.card!==key){
        if(job.card){job.bytes-=job.files.get(job.card).bytes;job.files.delete(job.card);}
        job.card=key;job.files.set(key,{key,file,bytes:data.length,mime:'application/json',animated:false,label:card.actor+' · 角色卡',group:'本机角色卡'});job.bytes+=data.length;
      }
  }
  // The phone uses this to tell whether it needs the manifest again.
  job.version=hash(JSON.stringify([[...job.files.keys()].sort(),job.card,job.missing.map(entry=>entry.name).sort(),job.errors.map(entry=>entry.name).sort()]));
  job.state='ready';
}
function publicFile({key,bytes,label,group,mime,animated}){return {key,bytes,label,group,mime,animated};}
export function packStatus(seat,role,args,origin){
  if(seat.packPending)return {state:'queued',scope:scopeFor(seat,origin),revision:seat.packRevision};
  if(seat.packError)return {state:'failed',errors:[{name:'世界包',error:seat.packError}]};
  const job=seat.pack;if(!job)return {state:'idle',scope:scopeFor(seat,origin),revision:seat.packRevision};
  const info={state:job.state,scope:job.scope,revision:seat.packRevision,version:job.version,total:job.total,done:job.done,count:job.files.size,bytes:job.bytes,errors:job.errors,
    missing:job.missing.map(({name,error,path})=>role==='host'?{name,error,path}:{name,error})};
  if(args.manifest&&job.state==='ready'){
    info.files=[...job.files.values()].map(publicFile);info.card=job.card||null;
    if(role==='host'){
      info.index=Object.fromEntries(job.index);
      info.atlases=Object.fromEntries([...(job.atlases||[])].map(([id,a])=>[id,{key:a.key,w:a.w,h:a.h,step:a.step,cols:a.cols,rows:a.rows}]));
    }
  }
  return info;
}
export async function serveFile(seat,key,res){
  const item=seat.pack?.files.get(key);
  if(!item)throw fail(404,'文件不在当前玩家的世界包内');
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':item.bytes,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  await pipeline(fs.createReadStream(item.file),res).catch(()=>{});
}
