import { ID, active3D, worldPoint, screenPoint, view3D } from './combat-space-2.js';
import {anchorHint,releaseHint} from './hint-placement-2.js';
import {writeMovementMeter} from './movement-display-1.js';

// Carbon supplied the visual direction; the renderer uses triangle meshes rather
// than WebGL line widths. Only this module's geometry/materials are ever disposed.
const DEFAULTS = { width: 3.5, opacity: 0.12 };
const COLORS = { route: 0x78e6ca, over: 0xff666d, outline: 0xffdb91, halo: 0x142329 };
const templates = new Set(), paths = new Set();
let installed = false, settingsReady = false;

function config(key, fallback) {
  try { return game.settings.get(ID, key); } catch { return fallback; }
}
function engine() { return globalThis.game?.Levels3DPreview; }
function enabled() { return active3D() && config('spatialTemplates', true); }
function point(p) { return { x: Number(p.x), y: Number(p.y), elevation: Number(p.elevation ?? 0) }; }
function finitePoint(p) { return p && [p.x, p.y, p.elevation ?? 0].every(Number.isFinite); }
function interpolate(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
    elevation: (a.elevation ?? 0) + ((b.elevation ?? 0) - (a.elevation ?? 0)) * t };
}

/** Pure helper: a budget boundary inside a segment gets its own exact vertex. */
export function splitPathBudget(points, costs, budget, valid = true) {
  const result = [], allowance = Number.isFinite(budget) ? Math.max(0, budget) : Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = point(points[i - 1]), b = point(points[i]);
    if (!finitePoint(a) || !finitePoint(b)) continue;
    const start = Number(costs[i - 1] ?? 0), end = Number(costs[i] ?? start);
    if (valid && start < allowance && end > allowance && end > start) {
      const middle = interpolate(a, b, (allowance - start) / (end - start));
      result.push({ a, b: middle, over: false }, { a: middle, b, over: true });
    } else result.push({ a, b, over: !valid || start >= allowance && end > allowance || end > allowance });
  }
  return result;
}

/** Canonical contours, not every triangulation edge of a sphere or cone. */
export function canonicalContours(shape, p = {}, divisions = 64) {
  const segments = [], line = (a, b) => segments.push({ a, b });
  const ring = (radius, y, axis = 1) => {
    for (let i = 0; i < divisions; i++) {
      const make = t => axis === 0 ? [y, radius * Math.cos(t), radius * Math.sin(t)]
        : axis === 2 ? [radius * Math.cos(t), radius * Math.sin(t), y]
          : [radius * Math.cos(t), y, radius * Math.sin(t)];
      line(make(i * Math.PI * 2 / divisions), make((i + 1) * Math.PI * 2 / divisions));
    }
  };
  const radius = Number(p.radius ?? p.radiusBottom ?? p.radiusTop ?? 0), height = Number(p.height ?? 0);
  if (shape === 'sphere') { ring(radius, 0, 0); ring(radius, 0, 1); ring(radius, 0, 2); }
  else if (shape === 'cone') {
    ring(radius, -height / 2);
    for (let i = 0; i < 4; i++) { const angle = i * Math.PI / 2; line([0, height / 2, 0], [radius * Math.cos(angle), -height / 2, radius * Math.sin(angle)]); }
  } else if (shape === 'cylinder') {
    ring(radius, -height / 2); ring(radius, height / 2);
    for (let i = 0; i < 4; i++) { const angle = i * Math.PI / 2, x = radius * Math.cos(angle), z = radius * Math.sin(angle); line([x, -height / 2, z], [x, height / 2, z]); }
  } else {
    const half = [Number(p.width ?? 0) / 2, height / 2, Number(p.depth ?? 0) / 2];
    for (let axis = 0; axis < 3; axis++) for (const s of [-1, 1]) for (const t of [-1, 1]) {
      const a = [], b = [], other = [0, 1, 2].filter(i => i !== axis);
      a[axis] = -half[axis]; b[axis] = half[axis];
      a[other[0]] = b[other[0]] = half[other[0]] * s;
      a[other[1]] = b[other[1]] = half[other[1]] * t; line(a, b);
    }
  }
  return segments.filter(s => s.a.every(Number.isFinite) && s.b.every(Number.isFinite) && s.a.some((v, i) => Math.abs(v - s.b[i]) > 1e-9));
}

const vertexShader = `
  attribute vec3 segmentStart;
  attribute vec3 segmentEnd;
  attribute float lineAlong;
  attribute float lineSide;
  attribute vec3 lineColor;
  uniform vec2 resolution;
  uniform float lineWidth;
  uniform float haloWidth;
  varying float vSide;
  varying vec3 vColor;
  #ifdef MCB_TOKEN_FRAME
    varying vec2 vFootXZ;
  #endif
  void main() {
    vec4 startClip = projectionMatrix * modelViewMatrix * vec4(segmentStart, 1.0);
    vec4 endClip = projectionMatrix * modelViewMatrix * vec4(segmentEnd, 1.0);
    vec2 a = startClip.xy / max(abs(startClip.w), 0.00001);
    vec2 b = endClip.xy / max(abs(endClip.w), 0.00001);
    vec2 delta = (b - a) * resolution;
    vec2 normal = length(delta) > 0.0001 ? normalize(vec2(-delta.y, delta.x)) : vec2(1.0, 0.0);
    vec4 clip = mix(startClip, endClip, lineAlong);
    clip.xy += normal * lineSide * (lineWidth + 2.0 * haloWidth) / resolution * clip.w;
    gl_Position = clip;
    vSide = lineSide;
    vColor = lineColor;
    #ifdef MCB_TOKEN_FRAME
      vFootXZ = (modelMatrix * vec4(mix(segmentStart, segmentEnd, lineAlong), 1.0)).xz;
    #endif
  }
`;
const fragmentShader = `
  uniform float lineWidth;
  uniform float haloWidth;
  uniform vec3 haloColor;
  varying float vSide;
  varying vec3 vColor;
  #ifdef MCB_TOKEN_FRAME
    varying vec2 vFootXZ;
    uniform bool maskVision;
    uniform sampler2D visionTexture;
    uniform vec2 visionSize;
    uniform vec2 visionOrigin;
  #endif
  void main() {
    float edge = abs(vSide);
    float core = lineWidth / (lineWidth + 2.0 * haloWidth);
    float halo = smoothstep(core - 0.08, core + 0.08, edge);
    float alpha = 1.0 - smoothstep(0.88, 1.0, edge);
    #ifdef MCB_TOKEN_FRAME
      if (maskVision && all(greaterThanEqual(vFootXZ, visionOrigin))
          && all(lessThanEqual(vFootXZ, visionSize - visionOrigin))
          && texture2D(visionTexture, vFootXZ / visionSize).r < 0.74) discard;
      gl_FragColor = vec4(mix(vec3(1.0), vColor, 0.62 + 0.38 * halo), alpha * (1.0 - 0.78 * halo));
    #else
      gl_FragColor = vec4(mix(vColor, haloColor, halo), alpha);
    #endif
  }
`;

function noInput(object) {
  object.traverse(o => Object.assign(o.userData, { noIntersect: true, ignoreIntersect: true, ignoreHover: true, interactive: false, noShaders: true }));
  return object;
}
export function wideLines(T, color = COLORS.outline, width = () => config('spatialLineWidth', DEFAULTS.width), tokenFrame = false) {
  let geometry = new T.BufferGeometry(), capacity = 0;
  const material = new T.ShaderMaterial({
    uniforms: { resolution: { value: new T.Vector2(1, 1) }, lineWidth: { value: DEFAULTS.width },
      haloWidth: { value: tokenFrame ? 2.4 : 1.05 }, haloColor: { value: new T.Color(COLORS.halo) },
      ...(tokenFrame ? {maskVision: {value: false}, visionTexture: {value: null},
        visionSize: {value: new T.Vector2()}, visionOrigin: {value: new T.Vector2()}} : {}) },
    defines: tokenFrame ? {MCB_TOKEN_FRAME: 1} : {},
    vertexShader, fragmentShader, transparent: true, depthTest: true, depthWrite: false, side: T.DoubleSide,
  });
  const mesh = noInput(new T.Mesh(geometry, material)); mesh.frustumCulled = false;
  if (tokenFrame) mesh.raycast = () => {};
  mesh.onBeforeRender = renderer => {
    const el = renderer.domElement;
    material.uniforms.resolution.value.set(Math.max(1, el.clientWidth || innerWidth), Math.max(1, el.clientHeight || innerHeight));
    material.uniforms.lineWidth.value = Math.max(1, Math.min(8, Number(width()) || DEFAULTS.width));
    if (tokenFrame) {
      const fog = engine().fogExploration;
      const vision = !game.user.isGM && canvas.scene.tokenVision && fog?._ready && fog.fogTexture;
      material.uniforms.maskVision.value = !!vision;
      if (vision) {
        material.uniforms.visionTexture.value = vision;
        material.uniforms.visionSize.value.fromArray(fog.sceneDimensions);
        material.uniforms.visionOrigin.value.fromArray(fog.sceneOrigin);
      }
    }
  };
  function allocate(count) {
    if (count <= capacity) return;
    capacity = Math.max(16, 2 ** Math.ceil(Math.log2(count)));
    const next = new T.BufferGeometry(), vertices = capacity * 4;
    for (const name of ['position', 'segmentStart', 'segmentEnd', 'lineColor']) next.setAttribute(name, new T.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(T.DynamicDrawUsage));
    for (const name of ['lineAlong', 'lineSide']) next.setAttribute(name, new T.BufferAttribute(new Float32Array(vertices), 1));
    const indices = [];
    for (let i = 0; i < capacity; i++) {
      const n = i * 4; indices.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
      for (let j = 0; j < 4; j++) {
        next.attributes.lineAlong.setX(n + j, j < 2 ? 0 : 1);
        next.attributes.lineSide.setX(n + j, j % 2 ? 1 : -1);
      }
    }
    next.setIndex(indices); mesh.geometry = next; geometry.dispose(); geometry = next;
  }
  return {
    mesh,
    update(segments) {
      allocate(segments.length);
      const c = new T.Color();
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i], a = segment.a, b = segment.b; c.set(segment.color ?? color);
        for (let j = 0; j < 4; j++) {
          const n = i * 4 + j, p = j < 2 ? a : b;
          geometry.attributes.position.setXYZ(n, p[0], p[1], p[2]);
          geometry.attributes.segmentStart.setXYZ(n, a[0], a[1], a[2]);
          geometry.attributes.segmentEnd.setXYZ(n, b[0], b[1], b[2]);
          geometry.attributes.lineColor.setXYZ(n, c.r, c.g, c.b);
        }
      }
      for (const name of ['position', 'segmentStart', 'segmentEnd', 'lineColor']) if (geometry.attributes[name]) geometry.attributes[name].needsUpdate = true;
      geometry.setDrawRange(0, segments.length * 6); mesh.visible = segments.length > 0;
    },
    destroy() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}

function cleanupTemplate(entity) {
  const state = entity?._mcbSpatial;
  if (!state) return;
  for (const [object, visible] of state.hidden) object.visible = visible;
  state.group.removeFromParent(); state.outline.destroy(); state.fill.geometry.dispose(); state.fill.material.dispose();
  delete entity._mcbSpatial; templates.delete(entity);
}
function enhanceTemplate(entity) {
  cleanupTemplate(entity);
  if (!enabled() || entity._destroyed || entity.isFog || entity.isLight || entity.isSound || entity.isTile || entity.hasShaders || entity.template?.document?.texture) return;
  const collision = entity.collisionMesh, parent = entity.templateMesh, T = engine()?.THREE;
  if (!T || !collision?.geometry || !parent || !['sphere', 'cone', 'square', 'box', 'ray', 'boxray', 'cylinder'].includes(entity.shape)) return;
  const segments = canonicalContours(entity.shape, collision.geometry.parameters);
  if (!segments.length) return;
  const group = noInput(new T.Group()); group.name = 'mcb-template-volume';
  group.position.copy(collision.position); group.quaternion.copy(collision.quaternion); group.scale.copy(collision.scale);
  const sourceColor = entity.material?.color ?? new T.Color(COLORS.outline), fillColor = sourceColor.clone();
  const fill = noInput(new T.Mesh(collision.geometry.clone(), new T.MeshBasicMaterial({ color: fillColor,
    transparent: true, opacity: config('spatialFillOpacity', DEFAULTS.opacity), depthTest: true, depthWrite: false, side: T.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  })));
  const outline = wideLines(T); outline.update(segments);
  group.add(fill, outline.mesh);
  const hidden = parent.children.filter(child => child !== collision && (child.isMesh || child.isLine || child.isLineSegments)).map(child => [child, child.visible]);
  for (const [child] of hidden) child.visible = false;
  parent.add(group); entity._mcbSpatial = { group, outline, fill, hidden }; templates.add(entity);
}
function refreshTemplates() {
  for (const entity of new Set([...templates, ...Object.values(engine()?.templates ?? {})])) enhanceTemplate(entity);
}
function cleanupAll() {
  for (const entity of [...templates]) cleanupTemplate(entity);
  for (const path of paths) path.release();
}
function mount() {
  if (!installed && engine()?.Classes?.Template3D && globalThis.libWrapper) {
    const base = 'game.Levels3DPreview.Classes.Template3D.prototype.';
    libWrapper.register(ID, base + 'draw', function (wrapped, ...args) { cleanupTemplate(this); const result = wrapped(...args); enhanceTemplate(this); return result; }, 'WRAPPER');
    libWrapper.register(ID, base + 'destroy', function (wrapped, ...args) { cleanupTemplate(this); return wrapped(...args); }, 'WRAPPER');
    installed = true;
  }
  if (active3D()) refreshTemplates();
}

function numberText(value) { return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '—'; }
function unitText() { const u = globalThis.canvas?.scene?.grid?.units; return !u || /^(ft|feet|foot|尺|英尺)$/i.test(u) ? '尺' : u; }

/** Path points are token-foot centers in scene coordinates, not Token top-lefts. */
export function createPathVisual() {
  let state, data = null, signature = '', destroyed = false;
  const record = { release, active: () => !!data };
  paths.add(record);
  function release() {
    if (state) {
      state.controls?.removeEventListener('change', projectHUD);
      window.removeEventListener('resize', projectHUD);
      releaseHint('move');state.line.destroy(); state.group.removeFromParent(); state.hud.remove(); state = null;
    }
    data = null; signature = '';
  }
  function ensure() {
    const e = engine(); if (destroyed || !active3D() || !e?.scene || !e.THREE) return false;
    if (state?.engine === e && state.scene === e.scene) return true;
    release();
    const group = noInput(new e.THREE.Group()); group.name = 'mcb-movement-path';
    const line = wideLines(e.THREE, COLORS.route, () => Math.max(3.5, config('spatialLineWidth', DEFAULTS.width)));
    group.add(line.mesh); e.scene.add(group);
    const hud = document.createElement('div'); hud.className = 'mcb-path-hud'; hud.setAttribute('role', 'status');
    const title = document.createElement('strong'), detail = document.createElement('span'), icon = document.createElement('span');
    detail.className = 'mcb-path-detail';
    icon.className = 'mcb-movement-icon';
    icon.hidden = true;
    hud.append(icon, title, detail); document.body.append(hud);
    state = { engine: e, scene: e.scene, controls: e.controls, group, line, hud, title, detail, icon };
    e.controls?.addEventListener('change', projectHUD); window.addEventListener('resize', projectHUD);
    return true;
  }
  function projectHUD() {
    if (!state || !data || !state.group.visible || !active3D()) { if (state) state.hud.hidden = true; return; }
    const endpoint = data.points.at(-1), view = view3D();
    if (!endpoint || !view) { state.hud.hidden = true; return; }
    const p = screenPoint(worldPoint(endpoint), view);
    if (!p || p.x < view.rect.left || p.x > view.rect.right || p.y < view.rect.top || p.y > view.rect.bottom) { state.hud.hidden = true; return; }
    state.hud.hidden = false;
    anchorHint('move',state.hud,p.x+20,p.y-55);
  }
  function update(next = {}) {
    const points = (next.points ?? []).filter(finitePoint).map(point);
    if (!points.length || !ensure()) return clear();
    const costs = points.map((_, i) => Number(next.costs?.[i] ?? 0)), budget = Number(next.budget), valid = next.valid !== false;
    const newSignature = JSON.stringify([points, costs, Number.isFinite(budget) ? budget : null, valid]);
    data = { ...next, points, costs, budget, valid };
    state.group.visible = true;
    if (newSignature !== signature) {
      const e = state.engine, raise = canvas.grid.size / e.factor / canvas.scene.grid.distance * 0.10;
      const coordinates = p => { const v = worldPoint(p); v.y += raise; return v.toArray(); };
      const segments = splitPathBudget(points, costs, budget, valid).map(s => ({ a: coordinates(s.a), b: coordinates(s.b), color: s.over ? COLORS.over : COLORS.route }));
      const end = coordinates(points.at(-1)), radius = canvas.grid.size / e.factor * 0.22;
      const endColor = !valid || Number.isFinite(budget) && costs.at(-1) > Math.max(0, budget) ? COLORS.over : COLORS.route;
      for (let i = 0; i < 48; i++) {
        const a = i * Math.PI * 2 / 48, b = (i + 1) * Math.PI * 2 / 48;
        segments.push({ a: [end[0] + Math.cos(a) * radius, end[1], end[2] + Math.sin(a) * radius], b: [end[0] + Math.cos(b) * radius, end[1], end[2] + Math.sin(b) * radius], color: endColor });
      }
      if (!valid) {
        for (const direction of [-1, 1]) segments.push({ a: [end[0] - radius * .65, end[1], end[2] - direction * radius * .65], b: [end[0] + radius * .65, end[1], end[2] + direction * radius * .65], color: endColor });
      } else if (points.length > 1) {
        const before = coordinates(points.at(-2)), dx = end[0] - before[0], dz = end[2] - before[2], length = Math.hypot(dx, dz);
        if (length > 1e-8) {
          const ux = dx / length, uz = dz / length, tip = [end[0] + ux * radius * .5, end[1], end[2] + uz * radius * .5];
          for (const side of [-1, 1]) segments.push({ a: tip, b: [end[0] - ux * radius * .5 - uz * side * radius * .45, end[1], end[2] - uz * radius * .5 + ux * side * radius * .45], color: endColor });
        }
      }
      state.line.update(segments); signature = newSignature;
    }
    const total = costs.at(-1) ?? 0, remaining = Number.isFinite(budget) ? budget - total : Infinity, units = unitText();
    state.hud.classList.toggle('is-invalid', !valid); state.hud.classList.toggle('is-over', valid && remaining < -1e-6);
    state.hud.classList.toggle('is-meter', !!next.meter);
    state.icon.hidden = !next.meter;
    if (next.meter) {
      state.detail.textContent = '';
      setMeter(next.meter);
    } else {
      state.title.textContent = valid ? next.label || `移动 ${numberText(total)} ${units}` : '无法到达';
      state.detail.textContent = valid ? (Number.isFinite(remaining) ? remaining >= 0 ? `到达后剩余 ${numberText(remaining)} ${units}` : `超出移动额度 ${numberText(-remaining)} ${units}` : '单击移动 · Esc 取消') : next.reason || '该位置没有可通行路线';
    }
    projectHUD();
  }
  function setMeter(meter) {
    if (state && data?.meter) writeMovementMeter(state.icon, state.title, meter);
  }
  function clear() { data = null; signature = ''; if (state) { state.group.visible = false; state.hud.hidden = true; } }
  return { update, setMeter, clear, destroy() { if (destroyed) return; release(); paths.delete(record); destroyed = true; } };
}

export function spatialVisualStatus() {
  return { installed, active: active3D(), enhancedTemplates: templates.size, activePaths: [...paths].filter(p => p.active()).length,
    lineWidth: config('spatialLineWidth', DEFAULTS.width), fillOpacity: config('spatialFillOpacity', DEFAULTS.opacity), renderer: 'screen-space-mesh' };
}
export function installSpatialVisuals() {
  if (settingsReady) return; settingsReady = true;
  Hooks.once('init', () => {
    game.settings.register(ID, 'spatialTemplates', { name: '清晰三维测量模板', hint: '为 MC 场景的普通测量模板显示粗轮廓和半透明体积。', scope: 'client', config: true, type: Boolean, default: true, onChange: refreshTemplates });
    game.settings.register(ID, 'spatialLineWidth', { name: '三维轮廓与路径线宽', hint: '使用屏幕像素宽度，缩远后仍可清楚辨认。', scope: 'client', config: true, type: Number, default: DEFAULTS.width, range: { min: 1, max: 8, step: .5 } });
    game.settings.register(ID, 'spatialFillOpacity', { name: '三维模板填充透明度', hint: '较低的数值能更清楚看到范围内的角色和地形。', scope: 'client', config: true, type: Number, default: DEFAULTS.opacity, range: { min: 0, max: .4, step: .02 }, onChange: refreshTemplates });
  });
  for (const hook of ['ready', 'canvasReady', '3DCanvasSceneReady']) Hooks.on(hook, () => setTimeout(mount, 0));
  Hooks.on('3DCanvasToggleMode', value => { if (value === false) cleanupAll(); else setTimeout(mount, 0); });
  Hooks.on('canvasTearDown', cleanupAll);
}
