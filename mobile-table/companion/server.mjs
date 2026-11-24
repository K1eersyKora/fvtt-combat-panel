import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {createRelay,closeRelay,exchange} from './relay.mjs';
import {prepare,retryPack,packStatus,serveFile,scopeFor,cache} from './world-pack.mjs';
import {stageAtlas,releasedKeys} from './fog-atlas.mjs';

const publicDir = fileURLToPath(new URL('../mobile/', import.meta.url));
const origin = new URL(process.env.TABLE_FOUNDRY || 'http://127.0.0.1:30001').origin;
const port = Number(process.env.TABLE_PORT || 31940);
const address = process.env.TABLE_BIND || '0.0.0.0';
const seats = new Map(), invites = new Map(), failures = new Map();
const secret = () => randomBytes(24).toString('base64url');
const local = ip => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip);
const error = (status, message) => Object.assign(new Error(message), {status});
const iceServers = JSON.parse(process.env.TABLE_ICE || '[]');
const hostTimeout=180000;
function unpair(seat) {
  if(!seat.phone)return;
  closeRelay(seat);
  seats.delete(seat.phone);
  seat.phone=null;
  seat.wait.phone?.([]);
  seat.queue.phone.length=0;
  seat.queue.host.length=0;
  deliver(seat,'host',{type:'reset'});
  // Older desktop modules already understand an epoch-specific close.
  if(seat.epoch)deliver(seat,'host',{type:'closed',epoch:seat.epoch});
  seat.epoch=null;
}
function dispose(seat) {
  closeRelay(seat);
  seats.delete(seat.host); seats.delete(seat.phone); invites.delete(seat.code);
  for (const resolve of Object.values(seat.wait)) resolve?.([]);
}
setInterval(() => {
  for(const seat of invites.values())if(Date.now()-seat.hostSeen>hostTimeout)dispose(seat);
  for(const [ip,f] of failures) if(Date.now()-f.start>60000) failures.delete(ip);
}, 30000).unref();
async function json(req,limit=65536) {
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    if ((size+=chunk.length)>limit) throw error(413,'请求太大');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw error(400,'数据格式错误'); }
}
function deliver(seat, role, message) {
  if(seat.wait[role]) return seat.wait[role]([message]);
  const q=seat.queue[role];
  if(q.length>=128) throw error(429,'信令过多，请重新连接');
  q.push(message);
}
function poll(seat, role, res) {
  if(seat.queue[role].length) return seat.queue[role].splice(0);
  seat.wait[role]?.([]);
  return new Promise(resolve=>{
    const done=value=>{clearTimeout(timer);res.off('close',cancel);delete seat.wait[role];resolve(value);};
    const cancel=()=>done([]), timer=setTimeout(cancel,12000);
    res.once('close',cancel);seat.wait[role]=done;
  });
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json'};
async function handler(req,res,desktop=false) {
  let route;
  try{route=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400);res.end();return;}
  const requestOrigin=req.headers.origin;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(desktop && requestOrigin===origin && local(req.socket.remoteAddress)){
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Private-Network','true');
    res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  }
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  try {
    if(!route.startsWith('/api/')){
      if(req.method==='GET'&&route==='/relay.js'){res.setHeader('Content-Type',types['.js']);return res.end(await fs.promises.readFile(new URL('../fvtt-mobile-table/relay-4.mjs',import.meta.url)));}
      if(req.method!=='GET' || !['/','/index.html','/style.css','/app.js','/chat.js','/dice.js','/snap.js','/map-render.js','/asset-cache.js','/terrain.js','/animation.js','/theme.js','/settings.js','/camera.js','/check-prompt.js','/prompt-ui.js','/dock-items.js','/sheet-ui.js','/combat-hud.js'].includes(route))throw error(404,'未找到');
      const name=route==='/'?'index.html':route.slice(1);
      res.setHeader('Content-Type',types[path.extname(name)]);return res.end(await fs.promises.readFile(path.join(publicDir,name)));
    }
    if(route==='/api/pack/atlas'&&req.method==='POST'){
      const token=req.headers.authorization?.replace(/^Bearer /,''),seat=seats.get(token);
      if(!desktop||!seat||seat.host!==token||!local(req.socket.remoteAddress)||requestOrigin!==origin)throw error(403,'仅桌面可准备地形');
      const query=new URL(req.url,'http://localhost').searchParams;
      const revision=query.has('revision')?Number(query.get('revision')):seat.packRevision;
      if(revision!==seat.packRevision)throw error(409,'世界资源已变化');
      await stageAtlas(req,seat,cache,scopeFor(seat,origin),query,revision);
      res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;
    }
    if(req.method!=='POST' || !req.headers['content-type']?.startsWith('application/json'))throw error(405,'需要 JSON POST');
    if(route.startsWith('/api/relay/')&&!['/api/relay/push','/api/relay/pull'].includes(route))throw error(404,'未找到');
    if(route==='/api/pack/prepare'&&(!desktop||!local(req.socket.remoteAddress)||requestOrigin!==origin))throw error(403,'资源包由电脑端准备');
    const args=await json(req,route==='/api/relay/push'?440000:route==='/api/pack/prepare'?6000000:65536);
    let result;
    if(route==='/api/create'){
      if(!desktop||!local(req.socket.remoteAddress)||requestOrigin!==origin)throw error(403,'请从 DM 电脑上已配置的 FVTT 地址配对');
      const previous=[...invites.values()].find(s=>s.identity===String(args.identity));
      if(previous)dispose(previous);
      if(invites.size>=20)throw error(429,'桌位已满');
      let code;
      do{code=randomBytes(5).toString('hex').toUpperCase();}while(invites.has(code));
      const seat={identity:String(args.identity),title:String(args.title||'试玩世界').slice(0,100),player:String(args.player||'').slice(0,60),host:secret(),phone:null,code,hostSeen:Date.now(),epoch:null,packRevision:0,queue:{host:[],phone:[]},wait:{}};
      seats.set(seat.host,seat);invites.set(seat.code,seat);result={token:seat.host,code:seat.code,iceServers,scope:scopeFor(seat,origin)};
    }else if(route==='/api/pair'){
      const ip=req.socket.remoteAddress;
      let f=failures.get(ip);if(!f||Date.now()-f.start>60000){f={start:Date.now(),n:0};failures.set(ip,f);}
      if(f.n>=15)throw error(429,'尝试次数过多，请稍后重试');
      const code=String(args.code??'').normalize('NFKC').replace(/[\s-]/g,'').toUpperCase();
      const seat=invites.get(code);
      if(seat&&Date.now()-seat.hostSeen>hostTimeout)dispose(seat);
      if(!seat||!invites.has(code)){f.n++;throw error(403,'配对码无效或电脑桌位已关闭');}
      unpair(seat);
      seat.phone=secret();seats.set(seat.phone,seat);result={token:seat.phone,iceServers,scope:scopeFor(seat,origin),worldTitle:seat.title,player:seat.player,localOnly:true};
    }else{
      const token=req.headers.authorization?.replace(/^Bearer /,''), seat=seats.get(token);
      if(!seat)throw error(401,'桌位已断开，请重新配对');
      const role=token===seat.host?'host':'phone';
      if(role==='host' && (!desktop||!local(req.socket.remoteAddress)||requestOrigin!==origin))throw error(403,'电脑端身份无效');
      if(role==='host')seat.hostSeen=Date.now();
      if(route==='/api/poll')result=await poll(seat,role,res);
      else if(route==='/api/pack/request'&&role==='phone'){
        const refresh=args.refresh===true&&seat.pack?.state==='ready';
        if(refresh)seat.pack=null;
        if(!retryPack(seat,origin)&&!seat.packPending){
          deliver(seat,'host',{type:'preparePack',refresh});
          seat.packPending=true;
        }
        result=packStatus(seat,role,{manifest:true},origin);
      }
      else if(route==='/api/pack/prepare'&&role==='host')result=await prepare(seat,args,origin);
      else if(route==='/api/pack/fail'&&role==='host'){
        if(args.revision===undefined||args.revision===seat.packRevision){
          seat.packPending=false;seat.pack=null;seat.packError=String(args.message||'生成资源清单失败').slice(0,200);
        }
        result={ok:true};
      }
      else if(route==='/api/pack/reset'&&role==='host'){
        const revision=args.revision??seat.packRevision+1;
        if(!Number.isSafeInteger(revision)||revision<0)throw error(400,'无效的资源版本');
        if(revision>seat.packRevision){
          seat.packRevision=revision;seat.pack=null;seat.packPending=false;seat.packError='';
        }
        result={ok:true};
      }
      else if(route==='/api/pack/status')result=packStatus(seat,role,args,origin);
      else if(route==='/api/pack/keys'&&role==='host'){
        const atlas=seat.pack?.atlases?.get(args.scene);if(!atlas||atlas.key!==args.key)throw error(409,'地形包已变化');
        result=releasedKeys(atlas,args.indices);
      }
      else if(route==='/api/pack/file'&&role==='phone')return await serveFile(seat,args.key,res);
      else if(route.startsWith('/api/relay/'))result=await exchange(seat,role,route,args,res);
      else if(route==='/api/signal'){
        const allowed=role==='host'?['answer','candidate','closed']:['offer','candidate','closed','relayOpen'];
        if(!allowed.includes(args.type)||typeof args.epoch!=='string'||args.epoch.length>70)throw error(400,'无效信令');
        if(role==='phone'){
          if(args.type==='relayOpen'){
            if(seat.relay?.epoch!==args.epoch){closeRelay(seat);seat.epoch=args.epoch;seat.relay=createRelay(args.epoch);deliver(seat,'host',args);}
          }else{
            if(args.type==='offer'){closeRelay(seat);seat.epoch=args.epoch;}
            if(!seat.relay)deliver(seat,'host',args);
          }
        }else if(seat.phone&&args.epoch===seat.epoch)deliver(seat,'phone',args);
        result={ok:true};
      }else if(route==='/api/leave'){if(role==='host')dispose(seat);else unpair(seat);result={ok:true};}
      else throw error(404,'未找到');
    }
    if(res.destroyed)return;
    res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(result));
  }catch(e){if(res.destroyed)return;res.writeHead(e.status||500,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.status?e.message:'桌面服务未完成请求'}));}
}
http.createServer(handler).listen(port,address,()=>{console.log('手机桌面服务 '+port+'  已绑定 FVTT '+origin);for(const list of Object.values(networkInterfaces()))for(const ip of list||[])if(!ip.internal&&ip.family==='IPv4')console.log('局域网手机地址 http://'+ip.address+':'+port);});
http.createServer((req,res)=>handler(req,res,true)).listen(port+2,'127.0.0.1');
if(process.env.TABLE_PFX)https.createServer({pfx:fs.readFileSync(process.env.TABLE_PFX),passphrase:process.env.TABLE_PFX_PASSWORD},handler).listen(port+1,address);
