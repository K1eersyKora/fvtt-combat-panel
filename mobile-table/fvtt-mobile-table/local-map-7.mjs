import {resourcePath, tokenArt} from './world-pack-7.mjs';
import {directlyVisible} from './game-11.mjs';

// The phone receives only pixels and tokens available to the paired player.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const surface = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const isMovingImage = src => src instanceof HTMLVideoElement || /\.(gif|webm|mp4|apng)(?:[?#]|$)/i.test(src?.currentSrc || src?.src || '');
const knownMotion = new WeakMap();
async function dynamicImage(img, hint = '') {
  if (!img) return false;
  if (isMovingImage(img)) return true;
  if (knownMotion.has(img)) return knownMotion.get(img);
  const src = hint || img.currentSrc || img.src || '';
  if (/\.(gif|webm|mp4|apng)(?:[?#]|$)/i.test(src)) return true;
  if (!/\.(webp|png)(?:[?#]|$)/i.test(src)) return false;
  const task = (async () => {
    const url = new URL(src, location.href); if (url.origin !== location.origin) return false;
    const res = await fetch(url, {headers: {Range: 'bytes=0-8191'}}); if (!res.ok) return false;
    const reader = res.body.getReader(); let head;
    try { head = (await reader.read()).value; } finally { reader.cancel().catch(() => {}); }
    if (!head) return false; const text = new TextDecoder('latin1').decode(head.subarray(0, 8192));
    return (text.startsWith('RIFF') && text.includes('WEBPVP8X') && !!(head[20] & 2)) || (text.indexOf('acTL') >= 0 && text.indexOf('IHDR') >= 0);
  })().catch(() => false);
  knownMotion.set(img, task); return task;
}
const normalLight = new Set(['', 'torch', 'pulse', 'flickering', 'flame']);
const tileSize = 192;
let revision = 0;
let fogGeneration = 0;
let sightRevision = 0;
let terrainRevision = 0;
for (const name of ['canvasReady', 'updateScene', 'createTile', 'updateTile', 'deleteTile']) Hooks.on(name, () => { terrainRevision++; });
Hooks.on('visibilityRefresh', () => { sightRevision++; });
for (const hook of ['canvasTearDown', 'deleteFogExploration', 'resetFog']) Hooks.on(hook, () => { fogGeneration++; });
for (const hook of ['createSequencerEffect', 'updateSequencerEffect', 'endedSequencerEffect']) Hooks.on(hook, () => { revision++; });
for (const hook of ['canvasReady', 'canvasTearDown', 'createTile', 'updateTile', 'deleteTile', 'updateScene', 'updateAmbientLight', 'createAmbientLight', 'deleteAmbientLight', 'updateWall', 'createWall', 'deleteWall', 'updateFogExploration', 'deleteFogExploration', 'updateDrawing', 'createDrawing', 'deleteDrawing', 'createMeasuredTemplate', 'updateMeasuredTemplate', 'deleteMeasuredTemplate'])
  Hooks.on(hook, () => { revision++; });
Hooks.on('updateToken', (_doc, change) => { if (canvas.visibility?.tokenVision || ['texture', 'sight', 'light', 'width', 'height', 'ring', 'hidden', 'disposition', 'alpha'].some(k => k in change)) revision++; });
function reason(text) { throw Error(text); }
function complexity() {
  if (!canvas.ready || game.Levels3DPreview?._active) return '当前场景使用专用渲染';
  if (['simplefog', 'fogmanager', 'perfect-vision'].some(id => game.modules.get(id)?.active)) return '当前世界使用专用视野模组';
  if (canvas.scene.foreground || canvas.scene.fog?.overlay) return '场景使用自定义前景或迷雾遮罩';
  if (canvas.drawings?.placeables.some(t => t.visible && !t.document.hidden)) return '此场景的绘图遮罩暂不支持本地显示';
  if ([...canvas.effects.visionSources.values()].some(s => s.active && s.visionMode?.id && !['basic', 'darkvision'].includes(s.visionMode.id))) return '角色正在使用特殊视觉';
  if (canvas.scene.grid.type !== 0 && canvas.scene.grid.type !== 1) return '当前网格暂不支持本地显示';
  if (canvas.scene.tokenVision && isMovingImage(canvas.primary.backgroundSource)) return '动态底图与玩家迷雾需要同时合成';
  return '';
}
function readTexture(texture) {
  if (!texture?.valid) return null;
  const c = canvas.app.renderer.extract.canvas(texture), ctx = c.getContext('2d', {willReadFrequently: true});
  if (!ctx || !(c.width && c.height)) return null;
  return {w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data};
}
function sample(img, u, v) {
  if (!img || u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
  return img.data[4 * (Math.floor(v * img.h) * img.w + Math.floor(u * img.w))];
}
function fullyAllowed(img) {
  if (!img) return () => false;
  const stride = img.w + 1, integral = new Uint32Array(stride * (img.h + 1));
  for (let y = 0; y < img.h; y++) {
    let missing = 0;
    for (let x = 0; x < img.w; x++) {
      missing += img.data[4 * (y * img.w + x)] > 240 ? 0 : 1;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + missing;
    }
  }
  return (xa, ya, xb, yb) => {
    const l = Math.floor(xa * img.w) - 1, t = Math.floor(ya * img.h) - 1, r = Math.ceil(xb * img.w) + 1, b = Math.ceil(yb * img.h) + 1;
    return l >= 0 && t >= 0 && r <= img.w && b <= img.h && r > l && b > t && integral[b * stride + r] - integral[t * stride + r] - integral[b * stride + l] + integral[t * stride + l] === 0;
  };
}
function permittedCells(atlas, rect, v, vision, explored, explorer, sent) {
  const live = fullyAllowed(vision), seen = fullyAllowed(explored), indices = [];
  for (let i = 0; i < atlas.cols * atlas.rows; i++) {
    if (sent.has(i)) continue;
    const x = (i % atlas.cols) * atlas.step, y = Math.floor(i / atlas.cols) * atlas.step;
    const l = rect.x + x * rect.width / atlas.w, t = rect.y + y * rect.height / atlas.h;
    const r = rect.x + Math.min(atlas.w, x + atlas.step) * rect.width / atlas.w, b = rect.y + Math.min(atlas.h, y + atlas.step) * rect.height / atlas.h;
    const corners = [[l, t], [r, t], [l, b], [r, b]].map(([px, py]) => screenPoint(v, {x: px, y: py}));
    const left = Math.min(...corners.map(p => p.x)) / v[6], right = Math.max(...corners.map(p => p.x)) / v[6], top = Math.min(...corners.map(p => p.y)) / v[7], bottom = Math.max(...corners.map(p => p.y)) / v[7];
    if (right < 0 || left > 1 || bottom < 0 || top > 1) continue;
    if (live(left, top, right, bottom) || (explored && seen((l - explorer.x) / explorer.width, (t - explorer.y) / explorer.height, (r - explorer.x) / explorer.width, (b - explorer.y) / explorer.height))) indices.push(i);
  }
  return indices;
}
async function assetKey(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let a = 2166136261, b = 5381;
  for (const n of bytes) { a = Math.imul(a ^ n, 16777619); b = Math.imul(b, 33) ^ n; }
  return {key: bytes.length + '-' + (a >>> 0).toString(36) + '-' + (b >>> 0).toString(36), blob};
}
async function blobOf(c, type = 'image/png') { return new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(Error('图层编码失败')), type, 0.9)); }
async function imageAsset(img, limit, animated = false, hint = '') {
  if (animated && await dynamicImage(img, hint)) {
    const url = new URL(hint || img.currentSrc || img.src, document.baseURI);
    if (url.origin !== location.origin) reason('动态素材来自另一站点');
    const r = await fetch(url); if (!r.ok) reason('动态素材无法读取');
    if (Number(r.headers.get('content-length')) > 5 * 1024 * 1024) reason('动态素材超过本地缓存大小');
    const b = await r.blob();
    if (b.size > 5 * 1024 * 1024 || !/^(video\/(webm|mp4)|image\/(gif|png|apng|webp))/.test(b.type)) reason('动态素材不支持本地解码');
    return {...await assetKey(b), animated: true};
  }
  const w = img.videoWidth || img.naturalWidth || img.width, h = img.videoHeight || img.naturalHeight || img.height;
  if (!(w > 0 && h > 0)) reason('图像仍在加载');
  const k = Math.min(1, limit / Math.max(w, h)), c = surface(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return assetKey(await blobOf(c, 'image/webp'));
}
function lightData() {
  const sources = [...canvas.effects.lightSources.values()].filter(s => s.active && s !== canvas.environment?.globalLightSource && !s.isGlobal && !s.object?.document?.hidden && s.object?.document);
  if (sources.length > 12) reason('同时显示的灯光过多');
  return sources.map(s => {
    const d = s.data, animation = d.animation || s.animation || {}, kind = animation.type || '';
    if (s.isDarkness || d.negative || !normalLight.has(kind) || !s.shape?.contains) reason('灯光使用专用着色器');
    return {source: s, x: d.x, y: d.y, r: Math.max(d.bright || 0, d.dim || 0), bright: d.bright || 0, color: Number(d.color) || 0xffecbc, alpha: d.alpha ?? 0.35, kind, speed: animation.speed ?? 5, intensity: animation.intensity ?? 5};
  }).filter(l => l.r > 0);
}
function worldPoint(v, u, y) { const [a, b, c, d, tx, ty] = v, det = a * d - b * c; return {x: (d * (u - tx) - c * (y - ty)) / det, y: (a * (y - ty) - b * (u - tx)) / det}; }
function screenPoint(v, p) { return {x: v[0] * p.x + v[2] * p.y + v[4], y: v[1] * p.x + v[3] * p.y + v[5]}; }
function effects() {
  const instances = globalThis.Sequencer?.EffectManager?.getEffects?.({sceneId: canvas.scene.id}) || [];
  const out = [];
  for (const fx of instances) {
    if (fx.shouldPlayVisible === false || !fx.renderable || !fx.worldVisible) continue;
    const sm = fx.sprite, leaf = sm?.managedSprite, g = fx.data || {}, tex = leaf?.texture;
    if (!leaf || !tex?.valid || !leaf.worldAlpha) continue;
    if (g.persist || g.screenSpace || g.aboveLighting || g.xray || g.tilingTexture || g.stretchTo || g.attachTo?.active || g.moveTowards || g.fadeIn || g.fadeOut
      || Object.keys(g.filters || {}).length || g.masks?.length || g.shapes?.length || g.animations?.length || sm.textSprite || leaf.mask || leaf.filters?.length
      || tex.trim || tex.rotate || tex.frame.width !== tex.baseTexture.width || tex.frame.height !== tex.baseTexture.height) continue;
    const source = tex.baseTexture.resource?.source; if (!source) continue;
    const at = (x, y) => canvas.stage.toLocal(leaf.toGlobal(new PIXI.Point(x, y)));
    const o = at(0, 0), dx = at(1, 0), dy = at(0, 1);
    out.push({
      source, path: sm.activePath, id: fx.id || g._id, matrix: [dx.x - o.x, dx.y - o.y, dy.x - o.x, dy.y - o.y, o.x, o.y], w: tex.orig.width, h: tex.orig.height,
      ax: leaf.anchor?.x || 0, ay: leaf.anchor?.y || 0, alpha: leaf.worldAlpha, time: fx.mediaCurrentTime || 0, rate: fx.mediaPlaybackRate || 1, loop: !!fx.mediaLooping
    });
  }
  return out.slice(0, 12);
}
function templates() {
  return (canvas.templates?.placeables || []).filter(t => t.visible && !t.document.hidden).flatMap(t => {
    const g = t.shape ?? t._computeShape(), d = t.document;
    if (!g) return [];
    const outline = g.points ? {points: Array.from(g.points)} : Number.isFinite(g.radius) ? {radius: g.radius} : {x: g.x, y: g.y, w: g.width, h: g.height};
    const color = '#' + (Number(d.fillColor ?? 0xc4a3d8) >>> 0).toString(16).padStart(6, '0').slice(-6);
    return [{x: d.x, y: d.y, color, outline}];
  });
}
function paintTemplates(ctx, items) {
  for (const {x, y, outline: g, color} of items) {
    ctx.save(); ctx.translate(x, y); ctx.beginPath();
    if (g.points) { for (let i = 0; i < g.points.length; i += 2) i ? ctx.lineTo(g.points[i], g.points[i + 1]) : ctx.moveTo(g.points[i], g.points[i + 1]); ctx.closePath(); }
    else if (Number.isFinite(g.radius)) ctx.arc(0, 0, g.radius, 0, Math.PI * 2);
    else ctx.rect(g.x, g.y, g.w, g.h);
    ctx.fillStyle = color + '45'; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.fill(); ctx.stroke(); ctx.restore();
  }
}
export class LocalMap {
  constructor() { this.epoch = 0; this.sent = new Set(); this.cached = new Set(); this.images = new WeakMap(); this.serial = 0; this.sentBytes = 0; }
  reset() { this.epoch++; this.sent.clear(); this.cached.clear(); this.sentBytes = 0; this.scene = null; this.last = null; this.lastReason = ''; this.images = new WeakMap(); this.terrain = null; this.waitCache = false; }
  useCache(epoch, keys) { if (epoch === this.epoch) { this.cached = new Set(Array.isArray(keys) ? keys.filter(k => typeof k === 'string' && k.length < 64).slice(0, 256) : []); this.waitCache = false; } }
  missing(epoch, keys) { if (epoch !== this.epoch || !Array.isArray(keys)) return; for (const k of keys.slice(0, 256)) { this.cached.delete(k); this.sent.delete(k); } this.last = null; }
  async image(src, size, move, hint) {
    const packed = this.pack?.get(resourcePath(hint));
    if (packed) return {key: packed.key, packed};
    let data = this.images.get(src); if (!data) { data = imageAsset(src, size, move, hint); this.images.set(src, data); }
    return data;
  }
  async transmit(ch, asset, epoch) {
    if (asset.packed || this.sent.has(asset.key) || (asset.persist && this.cached.has(asset.key))) return;
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    for (let i = 0; i < bytes.length; i += 9000) {
      while (ch.bufferedAmount > 64000) { if (epoch !== this.epoch || ch.readyState !== 'open') return; await sleep(12); }
      if (epoch !== this.epoch || ch.readyState !== 'open') return;
      const part = bytes.subarray(i, i + 9000);
      ch.send(JSON.stringify({event: 'asset', data: {key: asset.key, offset: i, total: bytes.length, mime: asset.blob.type, animated: !!asset.animated, persist: !!asset.persist, part: btoa(String.fromCharCode(...part))}}));
    }
    this.sent.add(asset.key); this.sentBytes += asset.blob.size;
  }
  block(s, why) {
    if (this.lastReason === why) return;
    this.reset(); this.lastReason = why;
    if (s.link?.readyState === 'open') s.link.send(JSON.stringify({event: 'mapUnavailable', data: why}));
  }
  terrainSource(src, rect) {
    const tiles = (canvas.tiles?.placeables || []).filter(t => t.visible && !t.document.hidden);
    if (!tiles.length) return src;
    if (tiles.some(t => !t.sourceElement || t.isVideo || t.document.elevation > 0 || t.document.occlusion?.mode > 0 || t.document.occlusion?.modes?.some?.(n => n > 0) || t.mesh?.mask || t.mesh?.filters?.length || !['16777215', '#ffffff', '0xffffff'].includes(String(t.mesh?.tint).toLowerCase())))
      reason('当前地图使用动态或遮挡叠层，无法安全显示底图');
    if (this.terrain?.revision === terrainRevision) return this.terrain.image;
    const k = Math.min(1, 3072 / Math.max(rect.width, rect.height)), c = surface(Math.max(1, Math.round(rect.width * k)), Math.max(1, Math.round(rect.height * k))), ctx = c.getContext('2d');
    ctx.setTransform(k, 0, 0, k, -rect.x * k, -rect.y * k);
    ctx.fillStyle = String(canvas.scene.backgroundColor || '#444444'); ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (src) ctx.drawImage(src, rect.x, rect.y, rect.width, rect.height);
    tiles.sort((a, b) => a.document.elevation - b.document.elevation || a.document.sort - b.document.sort || a.document.id.localeCompare(b.document.id));
    for (const t of tiles) {
      const m = t.mesh, w = Math.abs(m.width), h = Math.abs(m.height);
      ctx.save(); ctx.translate(m.position.x, m.position.y); ctx.rotate(m.rotation); ctx.scale(m.scale.x < 0 ? -1 : 1, m.scale.y < 0 ? -1 : 1);
      ctx.globalAlpha = m.alpha; ctx.drawImage(t.sourceElement, -m.anchor.x * w, -m.anchor.y * h, w, h); ctx.restore();
    }
    this.terrain = {revision: terrainRevision, image: c}; return c;
  }
  async update(s, current) {
    const ch = s.link; if (!ch || ch.readyState !== 'open') return;
    const why = complexity(); if (why) return this.block(s, why);
    if (Date.now() < (this.retryAt || 0)) return;
    const fog = !!canvas.visibility.tokenVision, lights = lightData(), visuals = effects();
    const policy = [current.scene, fog, canvas.scene.fog?.exploration, fogGeneration].join('/');
    if (this.scene !== policy || this.sent.size > 640 || this.sentBytes > 36 * 1024 * 1024) {
      this.epoch++; this.sent.clear(); this.cached.clear(); this.sentBytes = 0; this.images = new WeakMap(); this.scene = policy; this.last = null; this.lastReason = '';
      this.unlocked = new Set(); this.waitCache = !fog && !this.pack?.size; this.cacheDeadline = Date.now() + 1000;
      ch.send(JSON.stringify({event: 'mapReset', data: {epoch: this.epoch, scope: [game.world.id, game.user.id, current.scene].join('/'), protected: fog}}));
    }
    if (this.waitCache && Date.now() < this.cacheDeadline) return;
    const placements = current.targets.map(t => {
      const token = canvas.tokens.get(t.id);
      return [t.id, fog ? t.x : 0, fog ? t.y : 0, token && tokenArt(token)?.path];
    });
    const sig = JSON.stringify([revision, fog ? sightRevision : 0, fog ? current.source?.id : null, current.view, placements, Math.round(canvas.darknessLevel * 100), lights.map(l => [l.x, l.y, l.r, l.color, l.kind]), visuals.map(e => e.id)]);
    if (sig === this.last || this.running || Date.now() < (this.retryAt || 0)) return;
    this.running = true; const epoch = this.epoch, serial = ++this.serial;
    try {
      await nextFrame(); await nextFrame();
      if (epoch !== this.epoch || !canvas.ready || current.scene !== canvas.scene.id) return;
      const now = canvas.stage.worldTransform;
      if ([now.a, now.b, now.c, now.d, now.tx, now.ty].some((n, i) => Math.abs(n - current.view[i]) > 0.01)) return;
      const expectedFogGeneration = fogGeneration, visibleVersion = sightRevision;
      const allowed = () => epoch === this.epoch && current.scene === canvas.scene?.id && fog === !!canvas.visibility.tokenVision && expectedFogGeneration === fogGeneration && (!fog || visibleVersion === sightRevision);
      const result = await this.build(current, lights, fog, visuals);
      if (!allowed()) return;
      for (const a of result.assets) { if (!allowed()) return; await this.transmit(ch, a, epoch); }
      if (!allowed()) return;
      if (result.indices?.length) {
        for (let offset = 0; offset < result.indices.length; offset += 384) {
          const keys = await this.keyRequest(result.frame.atlas.key, current.scene, result.indices.slice(offset, offset + 384));
          if (!allowed() || ch.readyState !== 'open') return;
          ch.send(JSON.stringify({event: 'terrainKeys', data: {atlas: result.frame.atlas.key, keys}}));
          for (const [i] of keys) this.unlocked.add(i);
        }
      }
      if (ch.readyState !== 'open') return;
      const id = epoch + '-' + serial; this.last = sig; this.lastReason = '';
      ch.send(JSON.stringify({event: 'localMap', data: {...result.frame, id, epoch}}));
    } catch (e) { if (epoch === this.epoch) { this.retryAt = Date.now() + 1500; this.block(s, e.message); } }
    finally { this.running = false; }
  }
  async build(current, lights, fog, visuals) {
    const v = current.view, [a, b, c, d, tx, ty, W, H] = v, k = Math.min(1, 960 / W, 680 / H), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    const scene = canvas.scene, rect = canvas.dimensions.sceneRect, original = canvas.primary.backgroundSource, src = this.terrainSource(original, rect);
    const backgroundPath = src === original ? (canvas.sceneTextures.background ?? scene.background.src) : '';
    if (fog && await dynamicImage(src, backgroundPath)) reason('动态底图与迷雾同时生效');
    const gridOrigin = canvas.grid?.getTopLeftPoint?.({i: 0, j: 0}) ?? {x: 0, y: 0};
    const assets = [], frame = {
      scene: scene.id, view: v, w, h, rect: {x: rect.x, y: rect.y, w: rect.width, h: rect.height}, fog, tiles: [], lights: [], effects: [], sprites: {},
      baseColor: String(scene.backgroundColor || '#444444'), darkness: canvas.darknessLevel || 0,
      grid: {type: scene.grid.type, size: canvas.grid.size, alpha: scene.grid.alpha ?? 0.22, color: String(scene.grid.color || '#222222'), ox: gridOrigin.x, oy: gridOrigin.y}
    };
    const areas = templates(), atlas = fog ? this.atlases?.get(scene.id) : null; let indices;
    if (!fog) { frame.templates = areas; if (src) { const bg = await this.image(src, 3072, true, backgroundPath); assets.push({...bg, persist: true}); frame.base = bg.key; } }
    const vision = fog ? readTexture(canvas.masks.vision.renderTexture) : null, explorer = canvas.fog.sprite;
    if (fog && !vision) reason('等待当前玩家视野');
    const explored = (fog && scene.fog?.exploration && explorer?.texture?.valid && ![PIXI.Texture.WHITE, PIXI.Texture.EMPTY].includes(explorer.texture)) ? readTexture(explorer.texture) : null;
    const vis = new Uint8Array(w * h);
    if (fog) {
      const terrain = surface(w, h), context = terrain.getContext('2d', {willReadFrequently: true});
      context.fillStyle = '#101613'; context.fillRect(0, 0, w, h);
      context.setTransform(a * k, b * k, c * k, d * k, tx * k, ty * k); context.fillStyle = frame.baseColor; context.fillRect(rect.x, rect.y, rect.width, rect.height);
      if (src && !atlas) context.drawImage(src, rect.x, rect.y, rect.width, rect.height);
      context.resetTransform();
      const pixels = context.getImageData(0, 0, w, h), mask = surface(w, h), mc = mask.getContext('2d'), mist = mc.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, j = i * 4, p = worldPoint(v, (x + 0.5) / k, (y + 0.5) / k);
        const live = sample(vision, (x + 0.5) / w, (y + 0.5) / h) > 240;
        const known = explored && sample(explored, (p.x - explorer.x) / explorer.width, (p.y - explorer.y) / explorer.height) > 240;
        vis[i] = live ? 255 : known ? 100 : 0;
        if (!vis[i]) { pixels.data[j] = pixels.data[j + 1] = pixels.data[j + 2] = 0; }
        mist.data[j] = mist.data[j + 1] = mist.data[j + 2] = 0; mist.data[j + 3] = live ? 0 : known ? 157 : 255;
      }
      context.putImageData(pixels, 0, 0); mc.putImageData(mist, 0, 0);
      if (areas.length) {
        const layer = surface(w, h), overlay = layer.getContext('2d', {willReadFrequently: true});
        overlay.setTransform(a * k, b * k, c * k, d * k, tx * k, ty * k); paintTemplates(overlay, areas); overlay.resetTransform();
        const raw = overlay.getImageData(0, 0, w, h); let any = false;
        for (let i = 0; i < vis.length; i++) { const j = i * 4; if (vis[i] !== 255) raw.data.fill(0, j, j + 4); else if (raw.data[j + 3]) any = true; }
        if (any) { overlay.putImageData(raw, 0, 0); const pic = await assetKey(await blobOf(layer)); frame.templateLayer = pic.key; assets.push(pic); }
      }
      if (atlas) {
        frame.atlas = {key: atlas.key, w: atlas.w, h: atlas.h, step: atlas.step, cols: atlas.cols, rows: atlas.rows};
        assets.push({key: atlas.key, packed: atlas.asset});
        const sight = await assetKey(await blobOf(mask)); assets.push(sight); frame.sightMask = sight.key;
        indices = permittedCells(atlas, rect, v, vision, explored, explorer, this.unlocked);
      } else for (let y = 0; y < h; y += tileSize) for (let x = 0; x < w; x += tileSize) {
        const tw = Math.min(tileSize, w - x), th = Math.min(tileSize, h - y), tile = surface(tw, th), tc = tile.getContext('2d');
        tc.drawImage(terrain, x, y, tw, th, 0, 0, tw, th); const bg = await assetKey(await blobOf(tile, 'image/webp'));
        tc.clearRect(0, 0, tw, th); tc.drawImage(mask, x, y, tw, th, 0, 0, tw, th); const sh = await assetKey(await blobOf(tile));
        assets.push(bg, sh); frame.tiles.push({x, y, w: tw, h: th, bg: bg.key, mask: sh.key});
      }
    }
    for (const l of lights) {
      const at = screenPoint(v, l), r = l.r * Math.hypot(a, b) * k, x = at.x * k, y = at.y * k;
      if (x + r < 0 || y + r < 0 || x - r >= w || y - r >= h) continue;
      const lc = surface(w, h), lx = lc.getContext('2d', {willReadFrequently: true});
      const color = '#' + (l.color >>> 0).toString(16).padStart(6, '0').slice(-6);
      const grad = lx.createRadialGradient(x, y, 0, x, y, Math.max(1, r)); grad.addColorStop(0, color); grad.addColorStop(Math.min(0.98, l.bright / l.r * 0.75), color); grad.addColorStop(1, color + '00');
      lx.fillStyle = grad; lx.fillRect(0, 0, w, h); const raw = lx.getImageData(0, 0, w, h);
      let any = false;
      for (let iy = 0; iy < h; iy++) for (let ix = 0; ix < w; ix++) {
        const i = iy * w + ix, alpha = 4 * i + 3; if (!raw.data[alpha]) continue;
        const p = worldPoint(v, (ix + 0.5) / k, (iy + 0.5) / k); if ((fog && vis[i] !== 255) || !l.source.shape.contains(p.x, p.y)) { raw.data[alpha] = 0; raw.data[alpha - 1] = raw.data[alpha - 2] = raw.data[alpha - 3] = 0; } else any = true;
      }
      if (!any) continue;
      lx.putImageData(raw, 0, 0); const texture = await assetKey(await blobOf(lc, 'image/webp')); assets.push(texture);
      frame.lights.push({image: texture.key, alpha: Math.min(0.85, 0.2 + l.alpha * 0.65), kind: l.kind, speed: l.speed, intensity: l.intensity});
    }
    for (const t of current.targets) {
      const token = canvas.tokens.get(t.id); if (!directlyVisible(token)) continue;
      const artwork = tokenArt(token);
      if (!artwork?.image) continue;
      // An unavailable portrait falls back to the phone's ordinary token marker.
      const art = await this.image(artwork.image, 256, true, artwork.path).catch(() => null);
      if (!art) continue;
      assets.push({...art, persist: !fog});
      const m = token.mesh; frame.sprites[t.id] = {image: art.key, w: Math.abs(m?.width || t.w), h: Math.abs(m?.height || t.h), flipX: m?.scale.x < 0, flipY: m?.scale.y < 0, ax: m?.anchor.x ?? 0.5, ay: m?.anchor.y ?? 0.5, alpha: m?.alpha ?? 1};
    }
    for (const {source, path, ...fx} of visuals) {
      const corners = [[-fx.ax, -fx.ay], [1 - fx.ax, -fx.ay], [-fx.ax, 1 - fx.ay], [1 - fx.ax, 1 - fx.ay]].map(([x, y]) => screenPoint(v, {x: fx.matrix[0] * x * fx.w + fx.matrix[2] * y * fx.h + fx.matrix[4], y: fx.matrix[1] * x * fx.w + fx.matrix[3] * y * fx.h + fx.matrix[5]}));
      if (fog) {
        const x0 = Math.floor(Math.min(...corners.map(p => p.x)) * k) - 1, y0 = Math.floor(Math.min(...corners.map(p => p.y)) * k) - 1;
        const x1 = Math.ceil(Math.max(...corners.map(p => p.x)) * k) + 1, y1 = Math.ceil(Math.max(...corners.map(p => p.y)) * k) + 1;
        if (x1 < 0 || y1 < 0 || x0 >= w || y0 >= h) continue;
        if (x0 < 0 || y0 < 0 || x1 >= w || y1 >= h) continue;
        let count = 0; for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) if (vis[j * w + i] === 255) count++;
        if (!count || count !== (x1 - x0 + 1) * (y1 - y0 + 1)) continue;
      }
      try { const media = await this.image(source, 768, true, path); assets.push(media); frame.effects.push({...fx, image: media.key}); } catch {}
    }
    frame.library = Object.fromEntries(assets.filter(a => a.packed).map(a => [a.key, a.packed]));
    return {frame, assets, indices};
  }
}
