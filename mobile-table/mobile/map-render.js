import {animationFrames} from './animation.js';
import {cacheRead, cacheWrite, packedBlob} from './asset-cache.js';
import {TerrainAtlas} from './terrain.js';
import {viewer} from './camera.js';

const animMedia = media => media instanceof HTMLVideoElement || !!media?.decoder || !!media?.frames;

export class PhoneMap {
  constructor(canvas, onReady) {
    this.canvas = canvas;
    this.onReady = onReady;
    this.assets = new Map();
    this.partial = new Map();
    this.motion = new Map();
    this.fxVideos = new Map();
    this.rendered = new Map();
    this.generation = 0;
  }
  clear() {
    this.hide();
    this.generation++;
    for (const entry of this.assets.values()) {
      entry.then(m => {
        m.media?.pause?.();
        m.media?.decoder?.close();
        m.media?.bitmap?.close?.();
        for (const f of m.media?.frames || []) f.close();
        if (m.url) URL.revokeObjectURL(m.url);
      }).catch(() => {});
    }
    this.assets.clear();
    this.partial.clear();
    this.motion.clear();
    this.rendered.clear();
    this.walk = null;
    this.grants = new Map();
  }
  hide() {
    this.latest = null;
    this.frame = null;
    cancelAnimationFrame(this.raf);
    this.canvas.hidden = true;
    for (const m of this.textures?.values() || []) if (m instanceof HTMLVideoElement) m.pause();
    for (const v of this.fxVideos.values()) v.pause();
    this.fxVideos.clear();
  }
  async decode(blob, animated) {
    if (blob.type === 'application/x-fvtt-terrain') return {media: await new TerrainAtlas(blob).init()};
    const url = URL.createObjectURL(blob);
    try {
      if (blob.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.muted = true; video.loop = true; video.playsInline = true; video.src = url;
        await video.play(); video.pause();
        return {media: video, url};
      }
      if (animated) {
        if (!globalThis.ImageDecoder) return {media: await animationFrames(blob), url};
        const decoder = new ImageDecoder({data: await blob.arrayBuffer(), type: blob.type === 'image/apng' ? 'image/png' : blob.type});
        await decoder.tracks.ready;
        const {image: bitmap} = await decoder.decode({frameIndex: 0});
        return {media: {decoder, bitmap, index: 0, until: performance.now() + 100}, url};
      }
      const img = new Image(); img.src = url; await img.decode();
      return {media: img, url};
    } catch (e) { URL.revokeObjectURL(url); throw e; }
  }
  part(chunk) {
    if (this.assets.has(chunk.key)) return;
    const bytes = Uint8Array.from(atob(chunk.part), c => c.charCodeAt(0));
    let item = this.partial.get(chunk.key);
    if (chunk.offset === 0) {
      if (chunk.total > 6 * 1024 * 1024) throw Error('素材大小超限');
      item = {bytes: new Uint8Array(chunk.total), received: 0};
      this.partial.set(chunk.key, item);
    }
    if (!item || item.received !== chunk.offset || chunk.offset + bytes.length > item.bytes.length) throw Error('素材分片不完整');
    item.bytes.set(bytes, chunk.offset);
    item.received += bytes.length;
    if (item.received === item.bytes.length) {
      this.partial.delete(chunk.key);
      const blob = new Blob([item.bytes], {type: chunk.mime});
      if (chunk.persist && this.scope && !this.protected && blob.size < 2 * 1024 * 1024) {
        cacheWrite(this.scope, chunk.key, blob, chunk.animated).catch(() => {});
      }
      const promise = this.decode(blob, chunk.animated); promise.catch(() => {});
      this.assets.set(chunk.key, promise);
    }
  }
  async apply(frame) {
    const generation = this.generation, serial = this.latest = frame.id;
    const current = () => generation === this.generation && this.latest === serial;
    const keys = [...new Set([frame.base, frame.atlas?.key, frame.sightMask, frame.templateLayer, ...frame.tiles.flatMap(t => [t.bg, t.mask]), ...frame.lights.map(l => l.image), ...frame.effects.map(e => e.image), ...Object.values(frame.sprites).map(t => t.image)].filter(Boolean))];
    const textures = new Map();
    const missing = [];
    let cursor = 0;
    await Promise.all(Array.from({length: Math.min(4, keys.length)}, async () => {
      while (current() && cursor < keys.length) {
        const key = keys[cursor++];
        const cachedAtlas = frame.atlas?.key === key && frame.atlas.cachedOnly;
        if (!this.assets.has(key)) {
          const entry = frame.library?.[key];
          if (entry) {
            const pending = packedBlob(entry, cachedAtlas).then(b => this.decode(b, entry.animated));
            pending.catch(() => {});
            this.assets.set(key, pending);
          } else if (this.scope && !this.protected) {
            const row = await cacheRead(this.scope, key).catch(() => null);
            if (!current()) return;
            if (row && !this.assets.has(key)) this.assets.set(key, this.decode(row.blob, row.animated));
          }
        }
        const asset = this.assets.get(key);
        if (!asset) { missing.push(key); continue; }
        try { textures.set(key, (await asset).media); }
        catch (error) {
          if (!current()) return;
          if (this.assets.get(key) === asset) this.assets.delete(key);
          if (cachedAtlas) missing.push(key);
          else throw error;
        }
      }
    }));
    if (!current()) return;
    if (missing.length) throw Object.assign(Error('正在补齐地图素材'), {missing});
    if (frame.atlas) {
      const grants = this.grants?.get(frame.atlas.key);
      const atlas = textures.get(frame.atlas.key);
      if (grants?.length) {
        const batch = grants.splice(0);
        atlas.pending = (atlas.pending ?? Promise.resolve()).then(() => atlas.unlock(batch));
      }
      await atlas.pending;
    }
    if (!current()) return;
    for (const m of this.textures?.values() || []) if (m instanceof HTMLVideoElement && ![...textures.values()].includes(m)) m.pause();
    const regular = [frame.base, ...Object.values(frame.sprites).map(s => s.image)];
    for (const key of regular) { const m = textures.get(key); if (m instanceof HTMLVideoElement) m.play().catch(() => {}); }
    for (const [id, v] of this.fxVideos) if (!frame.effects.some(e => e.id === id)) { v.pause(); this.fxVideos.delete(id); }
    for (const e of frame.effects) {
      const media = textures.get(e.image);
      if (media instanceof HTMLVideoElement) {
        let v = this.fxVideos.get(e.id);
        if (!v) { v = media.cloneNode(); v.muted = true; v.playsInline = true; this.fxVideos.set(e.id, v); }
        v.loop = e.loop; v.playbackRate = e.rate; if (Math.abs(v.currentTime - e.time) > 0.3) v.currentTime = e.time; v.play().catch(() => {});
      }
    }
    this.frame = frame; this.textures = textures; this.canvas.hidden = false;
    if (this.data) this.state(this.data); else this.draw();
    this.onReady(frame.id);
  }
  state(state) {
    const now = performance.now(), old = this.data;
    if (old?.scene !== state.scene) this.clear();
    this.data = state;
    for (const t of state.targets) {
      const m = this.motion.get(t.id);
      if (!m || m.to.x !== t.x || m.to.y !== t.y) {
        this.motion.set(t.id, {from: m ? this.position(m, now) : t, to: t, time: now});
      }
    }
    for (const id of this.motion.keys()) if (!state.targets.some(t => t.id === id)) this.motion.delete(id);
    if (this.frame) this.draw();
  }
  position(m, now) {
    const f = Math.min(1, (now - m.time) / 140);
    return {x: m.from.x + (m.to.x - m.from.x) * f, y: m.from.y + (m.to.y - m.from.y) * f};
  }
  previewWalk(id, path) {
    const source = this.data?.targets.find(t => t.id === id);
    if (!this.frame || !source || !path.length) return;
    let t = 0, previous = source;
    const points = [{x: source.x, y: source.y, t: 0}];
    for (const p of path) {
      const distance = Math.hypot(p.x - previous.x, p.y - previous.y);
      if (distance < 1) continue;
      t += Math.max(65, Math.min(650, 140 * distance / this.data.grid));
      points.push({x: p.x, y: p.y, t});
      previous = p;
    }
    if (points.length > 1) { this.walk = {id, points, start: performance.now(), pending: true}; this.draw(); }
  }
  walked(w, now) {
    const time = now - w.start; let i = 1;
    while (i < w.points.length - 1 && w.points[i].t < time) i++;
    const a = w.points[i - 1], b = w.points[i], f = Math.min(1, Math.max(0, (time - a.t) / Math.max(1, b.t - a.t)));
    return {x: a.x + f * (b.x - a.x), y: a.y + f * (b.y - a.y)};
  }
  settleWalk(point) {
    const w = this.walk; if (!w) return;
    const authoritative = point || this.data?.targets.find(t => t.id === w.id);
    if (!authoritative) { this.walk = null; return; }
    const now = performance.now(), from = this.walked(w, now);
    this.walk = {id: w.id, pending: false, start: now, points: [{...from, t: 0}, {x: authoritative.x, y: authoritative.y, t: 120}]};
    this.draw();
  }
  image(key, now) {
    const m = this.textures.get(key);
    if (m?.frames) { let time = (now - m.start) % m.period, i = 0; while (i < m.delays.length - 1 && time >= m.delays[i]) time -= m.delays[i++]; return m.frames[i]; }
    if (!m?.decoder) return m;
    if (now > m.until && !m.pending) {
      m.pending = true; const n = m.decoder.tracks.selectedTrack.frameCount;
      m.decoder.decode({frameIndex: (m.index + 1) % n}).then(({image}) => {
        m.bitmap.close(); m.bitmap = image; m.index = (m.index + 1) % n; m.until = performance.now() + Math.max(25, (image.duration || 100000) / 1000);
      }).catch(() => {}).finally(() => { m.pending = false; });
    }
    return m.bitmap;
  }
  draw() {
    cancelAnimationFrame(this.raf);
    const f = this.frame, data = this.data; if (!f || !data || f.scene !== data.scene) return;
    const el = this.canvas, r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
    const ctx = el.getContext('2d'), now = performance.now(), v = f.view, cam = viewer.projection(data.scene, data.view, r, f.rect);
    ctx.resetTransform(); ctx.fillStyle = '#080d0b'; ctx.fillRect(0, 0, w, h); ctx.save();
    ctx.scale(dpr, dpr); ctx.transform(cam.a, cam.b, cam.c, cam.d, cam.tx, cam.ty);
    const [a, b, c, d, tx, ty] = v, det = a * d - b * c;
    ctx.transform(d / det, -b / det, -c / det, a / det, (c * ty - d * tx) / det, (b * tx - a * ty) / det);
    if (f.fog) { ctx.beginPath(); ctx.rect(0, 0, v[6], v[7]); ctx.clip(); }
    const sx = v[6] / f.w, sy = v[7] / f.h;
    if (f.atlas) {
      const terrain = this.textures.get(f.atlas.key); ctx.save(); ctx.transform(...v.slice(0, 6)); ctx.drawImage(terrain.canvas, f.rect.x, f.rect.y, f.rect.w, f.rect.h); ctx.restore();
    } else if (f.fog) {
      for (const t of f.tiles) ctx.drawImage(this.image(t.bg, now), t.x * sx, t.y * sy, t.w * sx, t.h * sy);
    } else {
      ctx.save(); ctx.transform(...v.slice(0, 6)); ctx.fillStyle = f.baseColor; ctx.fillRect(f.rect.x, f.rect.y, f.rect.w, f.rect.h);
      if (f.base) ctx.drawImage(this.image(f.base, now), f.rect.x, f.rect.y, f.rect.w, f.rect.h); ctx.restore();
    }
    if (f.grid.type === 1 && f.grid.alpha > 0) {
      ctx.save(); ctx.transform(...v.slice(0, 6));
      ctx.beginPath(); ctx.rect(f.rect.x, f.rect.y, f.rect.w, f.rect.h); ctx.clip();
      ctx.strokeStyle = f.grid.color; ctx.globalAlpha = f.grid.alpha; ctx.lineWidth = 1 / cam.scale;
      const corners = [[0, 0], [r.width, 0], [0, r.height], [r.width, r.height]].map(p => cam.inverse(...p)), grid = f.grid.size;
      const ox = Number(f.grid.ox ?? data.gridInfo?.ox ?? 0);
      const oy = Number(f.grid.oy ?? data.gridInfo?.oy ?? 0);
      const loX = Math.max(f.rect.x, Math.min(...corners.map(p => p.x)) - grid), hiX = Math.min(f.rect.x + f.rect.w, Math.max(...corners.map(p => p.x)) + grid);
      const loY = Math.max(f.rect.y, Math.min(...corners.map(p => p.y)) - grid), hiY = Math.min(f.rect.y + f.rect.h, Math.max(...corners.map(p => p.y)) + grid);
      ctx.beginPath();
      for (let i = ox + Math.ceil((loX - ox) / grid) * grid; i <= hiX; i += grid) { ctx.moveTo(i, loY); ctx.lineTo(i, hiY); }
      for (let j = oy + Math.ceil((loY - oy) / grid) * grid; j <= hiY; j += grid) { ctx.moveTo(loX, j); ctx.lineTo(hiX, j); }
      ctx.stroke(); ctx.restore();
    }
    ctx.save(); ctx.fillStyle = 'rgba(12,17,24,' + Math.min(0.8, f.darkness * 0.78) + ')';
    ctx.save(); ctx.transform(...v.slice(0, 6)); ctx.fillRect(f.rect.x, f.rect.y, f.rect.w, f.rect.h); ctx.restore();
    ctx.globalCompositeOperation = 'screen';
    for (const l of f.lights) {
      const pulse = l.kind ? Math.sin(now * 0.001 * (0.45 + l.speed * 0.4)) * 0.012 * l.intensity : 0;
      ctx.globalAlpha = Math.max(0, Math.min(1, l.alpha + pulse));
      ctx.drawImage(this.image(l.image, now), 0, 0, v[6], v[7]);
    }
    ctx.restore();
    let moving = false;
    this.rendered.clear();
    ctx.save(); ctx.transform(...v.slice(0, 6));
    for (const area of f.templates || []) {
      const g = area.outline; ctx.save(); ctx.translate(area.x, area.y); ctx.beginPath();
      if (g.points) { for (let i = 0; i < g.points.length; i += 2) i ? ctx.lineTo(g.points[i], g.points[i + 1]) : ctx.moveTo(g.points[i], g.points[i + 1]); ctx.closePath(); }
      else if (Number.isFinite(g.radius)) ctx.arc(0, 0, g.radius, 0, Math.PI * 2); else ctx.rect(g.x, g.y, g.w, g.h);
      ctx.fillStyle = area.color + '45'; ctx.strokeStyle = area.color; ctx.lineWidth = 2; ctx.fill(); ctx.stroke(); ctx.restore();
    }
    const cssPx = Math.max(11, Math.min(14, 12.5 * Math.pow(Math.max(0.25, Math.min(2, cam.scale)), 0.18)));
    const worldPx = cssPx / cam.scale;
    for (const t of data.targets) {
      const icon = f.sprites[t.id], m = this.motion.get(t.id); if (!icon || !m) continue;
      let p = this.position(m, now); const w = this.walk;
      if (w?.id === t.id) {
        const end = w.points.at(-1), elapsed = now - w.start;
        if (!w.pending && elapsed > end.t && (Math.hypot(t.x - end.x, t.y - end.y) < 1 || elapsed > 2500)) { this.walk = null; }
        else { p = this.walked(w, now); moving ||= elapsed < end.t || !w.pending; }
      }
      this.rendered.set(t.id, {x: p.x, y: p.y});
      moving ||= now - m.time < 160;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((t.rotation || 0) * Math.PI / 180); ctx.scale(icon.flipX ? -1 : 1, icon.flipY ? -1 : 1); ctx.globalAlpha = icon.alpha;
      if (w?.pending && w.id === t.id) ctx.globalAlpha *= 0.72;
      const media = icon.image && this.image(icon.image, now);
      if (media) ctx.drawImage(media, -icon.ax * icon.w, -icon.ay * icon.h, icon.w, icon.h);
      else {
        ctx.fillStyle = '#bfcad1'; ctx.strokeStyle = '#253742'; ctx.lineWidth = 2;
        ctx.beginPath();ctx.arc(0,0,Math.min(12,t.w/5,t.h/5),0,Math.PI*2);ctx.fill();ctx.stroke();
      }
      ctx.restore();
      if (data.source?.id === t.id) {
        const theme = getComputedStyle(document.documentElement), pad = 2 / cam.scale;
        ctx.save();
        ctx.strokeStyle = theme.getPropertyValue('--a').trim() || '#9ce3df';
        ctx.shadowColor = theme.getPropertyValue('--accent').trim() || '#f0d69b';
        ctx.shadowBlur = 5 * dpr; ctx.globalAlpha = 0.9; ctx.lineWidth = 2.4 / cam.scale;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, t.w / 2 + pad, t.h / 2 + pad, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      if (t.name !== '场上目标') {
        const labelY = p.y + t.h / 2 + worldPx * 1.05;
        ctx.font = `${worldPx}px sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 3 / Math.max(0.05, cam.scale); ctx.strokeStyle = '#132017'; ctx.fillStyle = 'white';
        ctx.strokeText(t.name, p.x, labelY); ctx.fillText(t.name, p.x, labelY);
      }
    }
    for (const e of f.effects) {
      ctx.save(); ctx.transform(...e.matrix); ctx.globalAlpha = e.alpha;
      const media = this.fxVideos.get(e.id) || this.image(e.image, now);
      if (!(media instanceof HTMLVideoElement) || media.readyState >= 2) ctx.drawImage(media, -e.w * e.ax, -e.h * e.ay, e.w, e.h);
      ctx.restore();
    }
    ctx.restore();
    if (f.templateLayer) ctx.drawImage(this.image(f.templateLayer, now), 0, 0, v[6], v[7]);
    if (f.sightMask) ctx.drawImage(this.image(f.sightMask, now), 0, 0, v[6], v[7]);
    if (f.fog) { for (const t of f.tiles) ctx.drawImage(this.image(t.mask, now), t.x * sx, t.y * sy, t.w * sx, t.h * sy); }
    ctx.restore();
    if (moving || f.lights.some(l => l.kind) || [...this.textures.values()].some(animMedia)) this.raf = requestAnimationFrame(() => this.draw());
  }
}
