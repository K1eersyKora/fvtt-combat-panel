let database;
function db(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('fvtt-mobile-assets',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('assets',{keyPath:['scope','key']});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  return database;
}
async function record(mode,op){
  const store=await db();
  return new Promise((resolve,reject)=>{
    const tx=store.transaction('assets',mode),req=op(tx.objectStore('assets'));
    tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error||Error('本机缓存写入中断'));tx.onerror=()=>reject(tx.error);
  });
}
export const cacheKeys=async scope=>{
  if(window.TableAssets)return [];
  try{return (await record('readonly',s=>s.getAllKeys(IDBKeyRange.bound([scope,''],[scope,'\uffff']),256))).map(k=>k[1]);}
  catch{return [];}
};
export const cacheRead=(scope,key)=>record('readonly',s=>s.get([scope,key]));
export const cacheWrite=(scope,key,blob,animated=false)=>window.TableAssets&&!scope.startsWith('pack/')?Promise.resolve():record('readwrite',s=>s.put({scope,key,blob,animated}));
export async function clearScope(scope){
  try{await record('readwrite',s=>s.delete(IDBKeyRange.bound([scope,''],[scope,'\uffff'])));}catch{}
}
const nativeJobs=new Map();
window.addEventListener('table-resource',e=>{
  const d=e.detail,job=nativeJobs.get(d?.id);if(!job)return;
  if(d.error){nativeJobs.delete(d.id);job.reject(Error(d.error));}
  else {job.progress(d.bytes);if(d.done){nativeJobs.delete(d.id);job.resolve();}}
});
let seat;
export function useSeat(saved){seat=saved;window.TableAssets?.openScope(saved?.scope||'');if(saved?.scope)localStorage.setItem('table-last-assets',saved.scope);}
export function lastCardScope(){return window.TableAssets?.lastCardScope?window.TableAssets.lastCardScope():(localStorage.getItem('table-last-character')||'');}
export async function readCharacter(scope){
  if(!scope)return null;
  try{if(window.TableAssets)return JSON.parse(window.TableAssets.readCard(scope)||'null');
    return (await cacheRead('sheet/'+scope,'current'))?.snapshot||null;}catch{return null;}
}
export async function saveCharacter(scope,snapshot){
  if(!scope||scope!==seat?.scope)return;
  if(window.TableAssets){if(!window.TableAssets.saveCard(JSON.stringify(snapshot)))throw Error('角色卡未能存入手机');}
  else await record('readwrite',s=>s.put({scope:'sheet/'+scope,key:'current',snapshot}));
  localStorage.setItem('table-last-character',scope);
}
export async function stored(entry){
  if(!seat?.scope)return false;
  if(window.TableAssets)return window.TableAssets.has(entry.key,entry.bytes);
  return !!await record('readonly',s=>s.getKey(['pack/'+seat.scope,entry.key]));
}
export function resourceSyncEnabled(scope) {
  if (!scope) return false;
  if (window.TableAssets?.resourceSyncEnabled) return window.TableAssets.resourceSyncEnabled();
  return localStorage.getItem('table-resource-sync/' + scope) === '1';
}
export function setResourceSync(scope, value) {
  if (!scope) return;
  if (window.TableAssets?.setResourceSync) window.TableAssets.setResourceSync(value);
  else if (value) localStorage.setItem('table-resource-sync/' + scope, '1');
  else localStorage.removeItem('table-resource-sync/' + scope);
}
export async function pruneResources(scope, keys) {
  const current = seat;
  if (!scope || scope !== current?.scope || keys.some(key => !/^[a-f0-9]{64}$/.test(key))) return;
  if (window.TableAssets) {
    const id = window.TableAssets.prune?.(JSON.stringify(keys));
    if (id) return new Promise((resolve, reject) => storageJobs.set(id, {resolve, reject}));
    return;
  }
  const keep = new Set(keys);
  let removed = 0;
  await record('readwrite', store => {
    const request = store.openKeyCursor(IDBKeyRange.bound(['pack/' + scope, ''], ['pack/' + scope, '\uffff']));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || seat !== current) return;
      if (!keep.has(cursor.primaryKey[1])) { store.delete(cursor.primaryKey); removed++; }
      cursor.continue();
    };
    return request;
  });
  return {removed};
}
const downloads=new Map(),controllers=new Map(),storageJobs=new Map();
window.addEventListener('table-storage',e=>{const {id,result}=e.detail,job=storageJobs.get(id);if(!job)return;storageJobs.delete(id);result.error?job.reject(Error(result.error)):job.resolve(result);});
export async function manageStorage(range,clear=false,includeCard=false){
  const scope=seat?.scope||localStorage.getItem('table-last-assets')||lastCardScope();
  const applies=s=>range==='all'||!!scope&&(s==='pack/'+scope||s==='sheet/'+scope||s.startsWith(scope+'/'));
  if(clear)for(const [id,c] of controllers)if(range==='all'||id.startsWith(scope+'/'))c.abort();
  let result={files:0,bytes:0,cards:0,cardBytes:0,freed:0,location:'当前网站的 IndexedDB → fvtt-mobile-assets → assets'};
  if(window.TableAssets?.storage){
    const id=window.TableAssets.storage(clear?'clear':'inspect',range,includeCard);
    if(!id)throw Error('无法读取本机缓存');
    result=await new Promise((resolve,reject)=>storageJobs.set(id,{resolve,reject}));
  }
  const local=await db().catch(e=>{if(window.TableAssets?.storage)return null;throw e;});if(!local)return result;
  let mostRecent=null;
  await new Promise((resolve,reject)=>{
    const tx=local.transaction('assets',clear?'readwrite':'readonly'),req=tx.objectStore('assets').openCursor();
    req.onsuccess=()=>{const cursor=req.result;if(!cursor)return;
      const row=cursor.value,isCard=row.scope.startsWith('sheet/'),hit=applies(row.scope);
      if(hit){
        const bytes=isCard?new Blob([JSON.stringify(row.snapshot||{})]).size:row.blob?.size||0;
        if(clear&&(!isCard||includeCard)){cursor.delete();result.freed+=bytes;}
        else if(isCard){result.cards++;result.cardBytes+=bytes;}else{result.files++;result.bytes+=bytes;}
      }
      if(isCard&&!(hit&&clear&&includeCard)&&(!mostRecent||row.snapshot.time>mostRecent.time))mostRecent={scope:row.scope.slice(6),time:row.snapshot.time};
      cursor.continue();
    };
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  if(clear&&includeCard&&!window.TableAssets){if(mostRecent)localStorage.setItem('table-last-character',mostRecent.scope);else localStorage.removeItem('table-last-character');}
  return result;
}
export function download(entry,progress=()=>{}){
  const id=seat.scope+'/'+entry.key;if(downloads.has(id))return downloads.get(id);
  const current=seat,controller=new AbortController();controllers.set(id,controller);
  const task=(async()=>{
    if(await stored(entry)){progress(entry.bytes);return;}
    if(window.TableAssets){
      const request=window.TableAssets.download(entry.key,entry.bytes,current.token);
      if(!request)throw Error('无法开始下载到手机');
      return new Promise((resolve,reject)=>nativeJobs.set(request,{resolve,reject,progress}));
    }
    const res=await fetch('/api/pack/file',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',Accept:'application/octet-stream',Authorization:'Bearer '+current.token},body:JSON.stringify({key:entry.key})});
    if(!res.ok)throw Error('下载失败（HTTP '+res.status+'）');
    let count=0;const chunks=[],reader=res.body.getReader();
    while(true){const {done,value}=await reader.read();if(done)break;
      if(seat!==current){await reader.cancel();throw Error('桌位已改变');}
      count+=value.length;if(count>entry.bytes){await reader.cancel();throw Error('文件长度不符');}
      chunks.push(value);progress(count);
    }
    if(count!==entry.bytes)throw Error('下载未完成，请重试');
    const blob=new Blob(chunks,{type:entry.mime});
    if(crypto.subtle){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));
      if(Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')!==entry.key)throw Error('文件校验失败');}
    if(controller.signal.aborted)throw Error('下载已停止');await cacheWrite('pack/'+current.scope,entry.key,blob,entry.animated);
  })().finally(()=>{downloads.delete(id);controllers.delete(id);});
  downloads.set(id,task);return task;
}
export async function packedBlob(entry, cachedOnly = false){
  if (cachedOnly) {
    if (!await stored(entry)) throw Error('本机没有这份地图缓存');
  } else await download(entry);
  if(window.TableAssets){const r=await fetch('/__pack/'+entry.key+'?type='+encodeURIComponent(entry.mime));if(!r.ok)throw Error('读取手机资源失败');return r.blob();}
  const row=await cacheRead('pack/'+seat.scope,entry.key);if(!row)throw Error('本地文件已清除，请重新下载');return row.blob;
}
