import {directlyVisible} from './game-11.mjs';

const extension=/\.(?:png|apng|webp|avif|jpe?g|gif|svg|webm|mp4)$/i;
const allowed=doc=>doc?.testUserPermission?.(game.user,'OBSERVER')||doc?.isOwner;
const gmOnlyEffect=e=>!!(e?.disabled||e?.isSuppressed||e?.isConcealed||e?.getFlag?.('core','hidden')||e?.flags?.['dfreds-convenient-effects']?.isGmOnly||e?.flags?.['fvtt-mobile-table']?.gmOnly);

export function resourcePath(src){
  if(typeof src!=='string'||!src||src.length>2048)return '';
  try{const u=new URL(src,document.baseURI);if(u.origin!==location.origin||u.search||u.hash||!extension.test(u.pathname))return '';return u.pathname;}catch{return '';}
}
export function tokenArt(token) {
  const {ring, texture: base} = token.document;
  const subject = ring?.enabled && ring.subject?.texture;
  if (!subject || subject === base.src) return {image: token.sourceElement, path: base.src};

  // A dynamic ring can replace the underlying image. Never send that hidden original.
  const texture = token.mesh?.texture;
  const image = texture?.baseTexture?.resource?.source;
  const displayedPath = resourcePath(image?.currentSrc || image?.src);
  const path = resourcePath(subject);
  const expected = foundry.canvas.getTexture(subject);
  const matchesSubject = expected?.valid && texture?.baseTexture === expected.baseTexture;
  if (!path || !texture?.valid || !image || (!matchesSubject && displayedPath !== path) || texture.trim || texture.rotate
    || texture.frame.width !== texture.baseTexture.width || texture.frame.height !== texture.baseTexture.height) return null;
  return {image, path};
}
export function worldResources(){
  const files=new Map();
  const rinse=value=>String(value||'').replace(/\s+/g,'').toLowerCase();
  const aaMenus={items:[],effects:[],templates:[]};
  if(game.modules.get('autoanimations')?.active){
    const read=key=>{try{return game.settings.get('autoanimations',key);}catch{return null;}};
    if(!read('disableAutoRec'))for(const k of ['melee','range','ontoken','templatefx','aura','preset','aefx']){
      const rows=Array.from(read('aaAutorec-'+k)||[]);(k==='aefx'?aaMenus.effects:aaMenus.items).push(...rows);
      if(k==='templatefx')aaMenus.templates.push(...rows);
    }
    for(const a of Object.values(aaMenus))a.sort((a,b)=>rinse(b.label).length-rinse(a.label).length);
  }
  function match(rows,name){const n=rinse(name);return rows.find(r=>r.advanced?.exactMatch&&r.label===name)||
    rows.find(r=>r.label&&!r.advanced?.exactMatch&&n.includes(rinse(r.label))&&!r.advanced?.excludedTerms?.some(t=>n.includes(rinse(t))));}
  function add(src,group,label){const p=resourcePath(src);if(p&&!files.has(p))files.set(p,{src:p,group,label:label||p.split('/').pop()});}
  function effectRefs(value,depth=0){
    if(depth>12||!value)return;
    if(typeof value==='string'){
      if(resourcePath(value)){add(value,'特效');return;}
      if(!/^(?:jb2a|autoanimations)\.[\w.-]+$/i.test(value))return;
      try{const db=globalThis.Sequencer?.Database;if(db?.getEntry(value,{softFail:true}))for(const path of db.getAllFileEntries(value)||[])add(path,'特效');}catch{}
    }else if(typeof value==='object'){
      if(value.enableCustom&&value.customPath)add(value.customPath,'特效');
      else if(value.dbSection&&value.menuType&&value.animation&&value.variant)effectRefs(['autoanimations',value.dbSection,value.menuType,value.animation,value.variant,value.color==='random'?'':value.color].filter(Boolean).join('.'),depth+1);
      for(const [k,v] of Object.entries(value))if(!/^(?:script|command|macro|description|secret|gmNotes)$/i.test(k))effectRefs(v,depth+1);
    }
  }
  function item(doc){
    add(doc.img,'物品与能力',doc.name);
    const aa=doc.flags?.autoanimations;
    if(!aa?.killAnim&&aa?.isEnabled!==false&&!aa?.isCustomized){effectRefs(match(aaMenus.items,doc.name));effectRefs(match(aaMenus.templates,doc.name));}
    if(aa&&!aa.killAnim&&aa.isEnabled!==false){
      effectRefs(aa);
      const v=aa.primary?.video??aa.data?.video;
      if(v?.enableCustom)add(v.customPath,'特效');
      else if(v?.dbSection&&v?.menuType&&v?.animation&&v?.variant)effectRefs(['autoanimations',v.dbSection,v.menuType,v.animation,v.variant,v.color==='random'?'':v.color].filter(Boolean).join('.'));
    }
    for(const ns of ['sequencer','chris-premades','midi-qol'])effectRefs(doc.flags?.[ns]);
    for(const a of doc.system?.activities?.values?.()||[])add(a.img,'物品与能力');
    for(const e of doc.effects||[])if(!gmOnlyEffect(e))add(e.img,'特效');
  }
  for(const actor of game.actors)if(allowed(actor)){
    add(actor.img,'角色',actor.name);add(actor.prototypeToken?.texture?.src,'棋子',actor.name);
    for(const effect of actor.effects||[]){
      if(gmOnlyEffect(effect))continue;
      if(!actor.isOwner&&effect.parent?.documentName==='Item'&&effect.parent.system?.identified===false)continue;
      add(effect.img,'角色特效');effectRefs(effect.flags?.sequencer);effectRefs(match(aaMenus.effects,effect.name));
    }
    for(const ns of ['sequencer','autoanimations','chris-premades'])effectRefs(actor.flags?.[ns]);
    for(const i of actor.items)item(i);
  }
  for(const i of game.items)if(allowed(i))item(i);
  for(const journal of game.journal)if(allowed(journal))for(const p of journal.pages)if(allowed(p)){
    add(p.src,'玩家手册',p.name);
    if(p.text?.content){const dom=new DOMParser().parseFromString(p.text.content,'text/html');
      for(const el of dom.querySelectorAll('.secret:not(.revealed),[data-visibility="gm"],script'))el.remove();
      for(const el of dom.querySelectorAll('img[src],video[src],video source[src]'))add(el.getAttribute('src'),'玩家手册',p.name);}
  }
  const customFog=['simplefog','fogmanager','perfect-vision'].some(id=>game.modules.get(id)?.active);
  for(const scene of game.scenes){
    if(scene.id!==canvas.scene?.id&&!allowed(scene))continue;
    const publicMap=!customFog&&!scene.tokenVision&&!scene.foreground&&!scene.fog?.overlay&&!scene.drawings.size&&!scene.tiles.size;
    if(publicMap)add(scene.background?.src,'公开地图',scene.name);
  }
  for(const t of canvas.tokens?.placeables||[])if(directlyVisible(t))add(tokenArt(t)?.path,'可见棋子');
  return {world:game.world.id,base:document.baseURI,entries:[...files.values()]};
}
export async function prepareAtlases(s, revision, refresh){
  const ids=[];
  const active = canvas.scene;
  const scenes = active ? [active, ...game.scenes.filter(scene => scene.id !== active.id)] : [...game.scenes];
  for(const scene of scenes){
    if (revision !== s.packRevision || s.abort.signal.aborted) break;
    if(!scene.tokenVision||scene.foreground||scene.fog?.overlay||scene.drawings.size||(!allowed(scene)&&scene.id!==canvas.scene?.id))continue;
    if(['simplefog','fogmanager','perfect-vision'].some(id=>game.modules.get(id)?.active))continue;
    try {
      const selected = scene.id === canvas.scene?.id;
      if (!selected && (scene.tiles.size || !resourcePath(scene.background?.src))) continue;
      const tiles = selected ? canvas.tiles.placeables.filter(tile => tile.visible && !tile.document.hidden) : [];
      const rect = scene.getDimensions().sceneRect;
      const signature = JSON.stringify([rect.width, rect.height, scene.background, scene.backgroundColor,
        tiles.map(tile => [tile.document.id, tile.document._stats?.modifiedTime, tile.document.texture.src])]);
      if (!refresh && s.atlasSignatures.get(scene.id) === signature) { ids.push(scene.id); continue; }
      let image;
      if(selected) image=s.map.terrainSource(canvas.primary.backgroundSource,canvas.dimensions.sceneRect);
      else {
        image=new Image();image.crossOrigin='anonymous';image.src=scene.background.src;await image.decode();
      }
      if(!image||image instanceof HTMLVideoElement)continue;
      const scale=Math.min(1,2048/Math.max(rect.width,rect.height));
      const c=document.createElement('canvas');
      c.width=Math.max(1,Math.round(rect.width*scale));c.height=Math.max(1,Math.round(rect.height*scale));
      const ctx=c.getContext('2d',{willReadFrequently:true});
      ctx.fillStyle=String(scene.backgroundColor||'#444');ctx.fillRect(0,0,c.width,c.height);
      ctx.drawImage(image,0,0,c.width,c.height);
      const bytes=ctx.getImageData(0,0,c.width,c.height).data;
      const url=new URL(s.base+'/api/pack/atlas');url.search=new URLSearchParams({scene:scene.id,w:c.width,h:c.height,revision});
      const signal = AbortSignal.any([s.abort.signal, AbortSignal.timeout(45000)]);
      const res=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+s.token,'Content-Type':'application/octet-stream'},body:bytes,signal});
      if(res.ok && revision === s.packRevision){s.atlasSignatures.set(scene.id,signature);ids.push(scene.id);}
    } catch {
      // This scene can still use the existing live, visibility-masked rendering path.
    }
  }
  return ids;
}
