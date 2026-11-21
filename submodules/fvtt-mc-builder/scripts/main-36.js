import {installPing} from './lolping-3d-1.js';
import {installSpatialRange} from './spatial-range-1.js';
import {installSpellPoints,allowsSpellMove} from './spell-points-1.js';
import { ALL_STYLES as STYLES } from './storm-catalog-1.js';
import { poseKitDoor } from './kit-model-3.js';
import { MATERIALS } from './core-1.js';
import { CHUNK as CHUNK_SIZE, COUNT as CELL_COUNT, CATALOG, CATEGORIES, address, encode, decodeChunk, entriesOf, definition, blockCode, cellKey, geometryBoxes, collisionBoxes, overlaps, supports, ascends, validateCell, indexOf } from './shapes-core-3.js';
import { createModel, disposeModel, applyDoorPose } from './shapes-model-6.js';
import { installHighGround, highGroundStatus, forTokens, attackPreview } from './high-ground-4.js';
import { installCombatView, combatViewStatus, targetPresentation } from './combat-view-8.js';
import { installCombatArea, areaStatus } from './combat-area-7.js';
import { installSpellVfx, spellVfxStatus } from './spell-vfx-7.js';
import { installCamera, cameraStatus } from './camera-2.js';
import { installSpatialVisuals, spatialVisualStatus } from './spatial-visuals-3.js';
import { installMovement, movementStatus, previewMeleeRoute, allowsJumpUpdate, planJumpTo } from './movement-11.js';

const ID = 'fvtt-mc-builder', VERSION = '0.6.8', EDGE_FEET = 5, PREFIX = 'mcbuilder://';
installHighGround({previewMeleeRoute});
installSpatialRange();
installSpellPoints();
installCombatView();
installCombatArea();
installSpellVfx();installPing();
installCamera();
installSpatialVisuals();
const BASE = `modules/${ID}`, MAX_HISTORY = 100;
let kitStyle = 'village', searchText = '';
let serial = Promise.resolve(), selectedMaterial = 1, selectedRotation = 0, category = 'blocks', cameraMode = false, editing = false, layer = 0;
let panel, launcher, hotbar, savedControls, preview, previewEngine, previewCode, lastPick, registered = false, lastScene;
const undoStack = [], redoStack = [], materialCache = new Map(), modelMetrics = new Map();
const worldCaches = new Map(); let doorAdapter;
const stateOf = scene => scene?.getFlag(ID, 'config');
const chunkOf = tile => tile?.getFlag(ID, 'chunk');
const ownsScene = scene => [1, 2, 3].includes(stateOf(scene)?.schema);
const current = () => canvas.scene;
const engine = () => game.Levels3DPreview;
installMovement({world:()=>world(current()),tokenBounds:()=>tokenBounds(current()),origin:()=>origin(current()),scale:()=>scale(current()),isEditing:()=>editing,sweepBlocked:(a,b)=>sweepBlocked(current(),a,b),config:()=>stateOf(current())});
function requireGM() {
  if (!game.user?.isGM) throw new Error('只有主持人可以编辑方块');
  if (game.users.activeGM && game.users.activeGM.id !== game.user.id) throw new Error('请由当前主主持人编辑，避免同时修改');
}
function requireScene(scene = current()) {
  const c = stateOf(scene);
  if (!c || ![1, 2, 3].includes(c.schema) || c.blockFeet !== EDGE_FEET || c.chunkSize !== CHUNK_SIZE) throw new Error('请先新建方块地图');
  if (scene.grid.type !== 1 || scene.grid.distance !== EDGE_FEET) throw new Error('方块地图必须保持 5 英尺方格');
  return c;
}
function scale(scene) { return scene.grid.size / scene.grid.distance * EDGE_FEET; }
function origin(scene) { const d = scene.getDimensions(); return [d.sceneX, d.sceneY]; }
function chunks(scene) { return scene?.tiles?.filter(t => [1, 2, 3].includes(chunkOf(t)?.schema)) ?? []; }
function findChunk(scene, key, kind = 'solid', instance) { return chunks(scene).find(t => { const c = chunkOf(t); return c.position.join(',') === key && (c.kind ?? 'solid') === kind && (!instance || c.instance === instance); }); }
function world(scene) {
  const tiles = chunks(scene), signature = tiles.map(t => `${t.id}:${chunkOf(t).revision}:${t.getFlag('levels-3d-preview', 'doorState')}`).join('|');
  const old = worldCaches.get(scene?.id); if (old?.signature === signature) return old;
  const data = { signature, entries: [], byKey: new Map(), boxes: [], reserved: [], micro: new Map(), decorations: [] };
  for (const tile of tiles) {
    const flag = chunkOf(tile), kind = flag.kind ?? 'solid', open = kind === 'door' && Number(tile.getFlag('levels-3d-preview', 'doorState')) === 1;
    for (const entry of entriesOf(decodeChunk(flag), flag.position)) {
      Object.assign(entry, { tile, kind, open }); data.entries.push(entry); data.byKey.set(`${kind}:${cellKey(entry.cell)}`, entry);
      for (const box of collisionBoxes(entry.code, entry.cell, open)) data.boxes.push({ ...box, entry });
      for (const box of geometryBoxes(entry.code, entry.cell)) {
        data.reserved.push({ ...box, entry });
        if (kind === 'door' || entry.def.kit) continue;
        for (let y = Math.round(box.min[1] * 2); y < Math.round(box.max[1] * 2); y++) for (let z = Math.round(box.min[2] * 2); z < Math.round(box.max[2] * 2); z++) for (let x = Math.round(box.min[0] * 2); x < Math.round(box.max[0] * 2); x++) data.micro.set(`${x},${y},${z}`, entry);
      }
      if (kind === 'decor') data.decorations.push(entry);
    }
  }
  worldCaches.set(scene?.id, data); return data;
}
function entryAt(scene, cell, kind) { const w = world(scene), key = cellKey(cell); if (kind) return w.byKey.get(`${kind}:${key}`); for (const k of ['decor', 'door', 'solid', 'glass', 'water']) { const e = w.byKey.get(`${k}:${key}`); if (e) return e; } }
function readCell(scene, cell, kind) { return entryAt(scene, cell, kind)?.code ?? 0; }
function checkBounds(scene, cell, code = 0) {
  validateCell(cell); const c = requireScene(scene);
  const physical = geometryBoxes(code, cell);
  if (physical.some(b => b.min[0] < 0 || b.min[2] < 0 || b.max[0] > c.width || b.max[2] > c.height)) throw Error('旋转后的构件超出地图边界');
  if (cell[0] < 0 || cell[2] < 0 || cell[0] >= c.width || cell[2] >= c.height || cell[1] < c.minY || cell[1] + definition(code).height > c.maxY || cell[1] >= c.maxY) throw new Error('构件超出地图范围，请调整位置或高度');
}
function tokenBounds(scene, override) {
  const unit = scale(scene), [ox, oz] = origin(scene);
  return scene.tokens.map(doc => {
    // Token x/y can temporarily contain animation interpolation. Physical
    // collision checks must start at the authoritative document checkpoint.
    const d = override?.id === doc.id ? { ...doc._source, ...override } : doc._source;
    const foot = Number(d.elevation ?? 0) / EDGE_FEET;
    const height = Math.max(Number(d.width || 1), Number(d.height || 1));
    return { id: doc.id, min: [(d.x - ox) / unit, foot, (d.y - oz) / unit], max: [(d.x - ox) / unit + d.width, foot + height, (d.y - oz) / unit + d.height] };
  });
}
function decorBox(cell) { return { min: [cell[0] + .1, cell[1], cell[2] + .1], max: [cell[0] + .9, cell[1] + .5, cell[2] + .9] }; }
function checkPlacement(scene, cell, code, kind, state = 0) {
  const w = world(scene), before = entryAt(scene, cell, kind), tokens = tokenBounds(scene), def = definition(code);
  const boxes = collisionBoxes(code, cell, state === 1);
  if (boxes.some(b => tokens.some(t => overlaps(b, t)))) throw Error(kind === 'door' ? '门口有角色，不能关闭或放置门' : '这里有角色，构件不能占据角色的空间');
  if (before) for (const t of tokens) {
    if (collisionBoxes(before.code, cell, before.open).some(b => supports(b, t)) && !boxes.some(b => supports(b, t))) throw Error('有角色站在这件构件上，请先移开角色');
  }
  if (!code) return;
  const buildBoxes = def.kind === 'decor' && !def.kit ? [decorBox(cell)] : geometryBoxes(code, cell);
  for (const b of buildBoxes) {
    if (w.reserved.some(other => other.entry !== before && !(def.kind === 'decor' && !other.entry.def.collision) && overlaps(b, other))) throw Error('这里已有重叠构件');
    if (def.kind !== 'decor' && def.kind !== 'water' && w.decorations.some(e => e !== before && overlaps(b, decorBox(e.cell)))) throw Error('请先移除这里的装饰品');
  }
}
function tileData(scene, position, cells, kind = 'solid', previous) {
  if (!cells.some(Boolean)) return null;
  const built = createModel(engine().THREE, cells, kind, position, makeMaterial), b = built.bounds;
  disposeModel(built.model); if (!b) return null;
  const unit = scale(scene), [ox, oz] = origin(scene);
  const low = b.min.map((v, i) => v + position[i] * CHUNK_SIZE);
  const revision = foundry.utils.randomID(), instance = kind === 'door' ? chunkOf(previous)?.instance ?? foundry.utils.randomID() : undefined;
  const collision = !['decor', 'water'].includes(kind), sight = ['solid', 'door'].includes(kind);
  return {
    x: Math.round(ox + low[0] * unit), y: Math.round(oz + low[2] * unit),
    width: Math.max(1, Math.round(b.size[0] * unit)), height: Math.max(1, Math.round(b.size[2] * unit)), elevation: low[1] * EDGE_FEET,
    rotation: 0, locked: kind !== 'door', hidden: false, alpha: 1, texture: { src: `${BASE}/assets/placeholder.svg` },
    flags: {
      [ID]: { chunk: { schema: 3, blockFeet: EDGE_FEET, kind, position, cells: encode(cells), revision, ...(instance ? { instance } : {}) } },
      'levels-3d-preview': { model3d: `${PREFIX}${scene.id}/${position.join('/')}/${revision}/${kind}${instance ? '/' + instance : ''}`, fillType: 'stretch', depth: b.size[1] * unit, autoGround: false, autoCenter: true, collision, sight, cameraCollision: false, enableGravity: 'none', enableAnim: false, sightMeshComplexity: 1, imageTexture: '', noiseType: 'none', castShadow: false, doorType: kind === 'door' ? 1 : 0, doorState: kind === 'door' ? previous?.getFlag('levels-3d-preview', 'doorState') ?? 0 : 0, doorStyle: 0 }
    }
  };
}
function enqueue(fn) { const run = serial.then(fn); serial = run.catch(() => {}); return run; }
async function writeCell(scene, cell, material, { record = true, kind, doorState } = {}) {
  requireGM(); checkBounds(scene, cell, material); const def = definition(material);
  kind ??= material ? def.kind : entryAt(scene, cell)?.kind ?? 'solid';
  const a = address(cell), prior = entryAt(scene, cell, kind), tile = kind === 'door' ? prior?.tile : findChunk(scene, a.key, kind), data = tile ? Uint16Array.from(decodeChunk(chunkOf(tile))) : new Uint16Array(CELL_COUNT);
  const before = data[a.index]; if (before === material) return { changed: false };
  const beforeState = Number(tile?.getFlag('levels-3d-preview', 'doorState') ?? 0), afterState = doorState ?? beforeState;
  checkPlacement(scene, cell, material, kind, afterState); data[a.index] = material;
  const spec = tileData(scene, a.chunk, data, kind, tile);
  if (spec && kind === 'door') spec.flags['levels-3d-preview'].doorState = afterState;
  if (stateOf(scene).schema !== 3) await scene.update({ [`flags.${ID}.config.schema`]: 3 });
  if (!spec) await scene.deleteEmbeddedDocuments('Tile', [tile.id], { mcbEdit: true });
  else if (tile) await scene.updateEmbeddedDocuments('Tile', [{ _id: tile.id, ...spec }], { mcbEdit: true });
  else await scene.createEmbeddedDocuments('Tile', [spec], { mcbEdit: true });
  if (record) { undoStack.push({ scene: scene.id, cell: cell.slice(), kind, before, after: material, beforeState, afterState }); if (undoStack.length > MAX_HISTORY) undoStack.shift(); redoStack.length = 0; }
  refreshPanel(); return { changed: true, cell, before, after: material };
}
function edit(cell, material, scene = current(), options = {}) { requireGM(); return enqueue(() => writeCell(scene, cell, material, options)); }
function undo(redo = false) {
  requireGM(); return enqueue(async () => {
    const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack, op = from.at(-1);
    if (!op || op.scene !== current()?.id) return { changed: false };
    const expected = redo ? op.before : op.after, target = redo ? op.after : op.before;
    if (readCell(current(), op.cell, op.kind) !== expected) throw new Error('此处已被其他操作修改，无法撤销');
    const result = await writeCell(current(), op.cell, target, { record: false, kind: op.kind, doorState: redo ? op.afterState : op.beforeState });
    from.pop(); to.push(op); refreshPanel(); return result;
  });
}

function makeMaterial(T, id, face) {
  const key = `${id}:${face}`; if (materialCache.has(key)) return materialCache.get(key);
  if (id === 14 || id === 15) {
    const m = new T.MeshStandardMaterial({ color: id === 14 ? '#ffffff' : '#438fbd', transparent: true, opacity: id === 14 ? .72 : .48, roughness: id === 14 ? .15 : .35, depthWrite: false, side: T.DoubleSide });
    if (id === 14) {
      const pixels = new Uint8Array(16 * 16 * 4);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const edge = x === 0 || y === 0 || x === 15 || y === 15, n = (y * 16 + x) * 4; pixels.set(edge ? [62, 120, 139, 245] : [178, 226, 238, 48], n); }
      const map = new T.DataTexture(pixels, 16, 16); map.wrapS = map.wrapT = T.RepeatWrapping; map.magFilter = map.minFilter = T.NearestFilter; map.needsUpdate = true; m.map = map;
    }
    materialCache.set(key, m); return m;
  }
  const sideGrass = id === 1 && face !== 'top';
  const base = new T.Color(MATERIALS[sideGrass ? 2 : id].color), data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const noise = (((x * 37 + y * 59 + id * 17) ^ (x * y * 13)) % 19 - 9) / 110;
    const edge = x === 0 || y === 0 ? -0.15 : 0;
    const color = sideGrass && face === 'side' && y > 12 ? new T.Color(MATERIALS[1].color) : base;
    const timber = id === 4 && x % 4 === 0 ? -0.1 : 0;
    const k = (y * 16 + x) * 4;
    data[k] = Math.max(0, Math.min(255, (color.r + noise + edge + timber) * 255));
    data[k + 1] = Math.max(0, Math.min(255, (color.g + noise + edge + timber) * 255));
    data[k + 2] = Math.max(0, Math.min(255, (color.b + noise + edge + timber) * 255)); data[k + 3] = 255;
  }
  const map = new T.DataTexture(data, 16, 16); map.wrapS = map.wrapT = T.RepeatWrapping; map.magFilter = map.minFilter = T.NearestFilter; map.needsUpdate = true;
  const material = new T.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
  materialCache.set(key, material); return material;
}
function loadChunkModel(path) {
  const match = /^mcbuilder:\/\/([A-Za-z0-9]+)\/(-?\d+)\/(-?\d+)\/(-?\d+)\/([A-Za-z0-9]+)(?:\/(solid|glass|water|decor|door)(?:\/([A-Za-z0-9]+))?)?$/.exec(path);
  if (!match) throw new Error('无效方块模型引用');
  const scene = game.scenes.get(match[1]); requireScene(scene);
  const tile = findChunk(scene, match.slice(2, 5).map(Number).join(','), match[6] ?? 'solid', match[7]);
  if (!tile) throw new Error('方块区块不存在');
  const started = performance.now(), flag = chunkOf(tile), kind = flag.kind ?? 'solid', built = createModel(engine().THREE, decodeChunk(flag), kind, flag.position, makeMaterial), model = built.model;
  if (!built.bounds) throw new Error('空区块不应生成模型');
  model.position.y -= built.bounds.min[1];
  modelMetrics.set(tile.id, { cubes: built.stats.count, kind, quads: built.stats.quads, triangles: built.stats.triangles, buildMs: performance.now() - started, revision: flag.revision });
  return { scene: model, model, object: model };
}
function installAdapter() {
  if (registered) return;
  if (!engine()?.helpers?.loadModel || !globalThis.libWrapper) throw new Error('方块建造需要兼容的 3D Canvas 与 libWrapper');
  libWrapper.register(ID, 'game.Levels3DPreview.helpers.loadModel', function (wrapped, path, ...args) {
    return typeof path === 'string' && path.startsWith(PREFIX) ? Promise.resolve(loadChunkModel(path)) : wrapped(path, ...args);
  }, 'MIXED');
  registered = true;
  doorAdapter ??= Promise.all([import('../../levels-3d-preview/scripts/entities/tile3d.js'), import('../../levels-3d-preview/scripts/lib/socket.js')]).then(([{ Tile3D }, { Socket }]) => {
    globalThis.MCBTileClass = Tile3D;
    globalThis.MCB3DSocket = Socket;
    libWrapper.register(ID, 'globalThis.MCB3DSocket.toggleDoor', function (wrapped, data, options) {
      const tile = game.scenes.get(data?.sceneId)?.tiles.get(data?.tileId);
      if (chunkOf(tile)?.kind !== 'door') return wrapped(data, options);
      const gm = game.users.activeGM;
      if (!gm) ui.notifications.warn('需要在线主持人处理门的开关');
      const base = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
      return wrapped(data, { ...base, users: gm ? [gm.id] : [] });
    }, 'WRAPPER');
    libWrapper.register(ID, 'globalThis.MCBTileClass.prototype.setupDoor', function (wrapped, ...args) { const result = wrapped(...args); if (chunkOf(this.document)?.kind === 'door') applyDoorPose(this); return result; }, 'WRAPPER');
    libWrapper.register(ID, 'globalThis.MCBTileClass.prototype._onClickLeft', function (wrapped, event) {
      if (chunkOf(this.document)?.kind === 'door') {
        const entry = world(this.document.parent).entries.find(e => e.tile.id === this.document.id);
        try { if (entry) checkPlacement(this.document.parent, entry.cell, entry.code, 'door', entry.open ? 0 : 1); } catch (error) { ui.notifications.warn(error.message); return; }
      }
      return wrapped(event);
    }, 'MIXED');
  }).catch(showError);
}

function sweepBlocked(scene, oldBounds, newBounds) {
  const start = oldBounds.min, delta = newBounds.min.map((v, i) => v - start[i]), size = oldBounds.max.map((v, i) => v - start[i]);
  for (const box of world(scene).boxes) {
      let enter = 0, exit = 1, miss = false;
      for (let i = 0; i < 3; i++) {
        const lo = box.min[i] - size[i] + 1e-5, hi = box.max[i] - 1e-5;
        if (Math.abs(delta[i]) < 1e-10) { if (start[i] <= lo || start[i] >= hi) { miss = true; break; } }
        else { const a = (lo - start[i]) / delta[i], b = (hi - start[i]) / delta[i]; enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); if (enter > exit) { miss = true; break; } }
      }
      if (!miss && enter <= exit && exit >= 0 && enter <= 1) return true;
  }
  return false;
}
function walkingStep(scene, oldBody, nextBody, detailed = false) {
  const boxes = world(scene).boxes, dx = nextBody.min[0] - oldBody.min[0], dz = nextBody.min[2] - oldBody.min[2];
  if (Math.abs(dx) + Math.abs(dz) < 1e-6 || !boxes.some(b => supports(b, oldBody))) return null;
  const count = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 4)), size = oldBody.max.map((v, i) => v - oldBody.min[i]);
  let currentBody = oldBody; const path = [oldBody];
  for (let step = 1; step <= count; step++) {
    const min = [oldBody.min[0] + dx * step / count, currentBody.min[1], oldBody.min[2] + dz * step / count], max = min.map((v, i) => v + size[i]);
    const candidates = boxes.filter(b => [0, 2].every(i => min[i] < b.max[i] - 1e-6 && max[i] > b.min[i] + 1e-6) && b.max[1] <= currentBody.min[1] + .5 + 1e-6 && b.max[1] >= currentBody.min[1] - 1 - 1e-6);
    if (!candidates.length) return null;
    const top = Math.max(...candidates.map(b => b.max[1]));
    const support = candidates.find(b => Math.abs(b.max[1] - top) < 1e-6);
    if (top > currentBody.min[1] + 1e-6 && support.entry.def.shape === 'stairs' && !ascends(support.entry.def.rotation, dx, dz)) return null;
    const next = { min: [min[0], top, min[2]], max: [max[0], top + size[1], max[2]] };
    const middle = top >= currentBody.min[1] ? { min: [currentBody.min[0], top, currentBody.min[2]], max: [currentBody.max[0], top + size[1], currentBody.max[2]] } : { min: [min[0], currentBody.min[1], min[2]], max: [max[0], currentBody.max[1], max[2]] };
    if (sweepBlocked(scene, currentBody, middle) || sweepBlocked(scene, middle, next)) return null;
    path.push(middle, next);
    currentBody = next;
  }
  return detailed ? { height: currentBody.min[1] * EDGE_FEET, path } : currentBody.min[1] * EDGE_FEET;
}
async function shapeKeyboardMovement(layerObject, options) {
  const e = engine(), scene = current(), { dx = 0, dy = 0, dz = 0, rotate, ids, includeLocked } = options;
  if (!e?._active || !ownsScene(scene) || rotate || dz || (!dx && !dy) || (game.paused && !game.user.isGM)) return null;
  if (![-1, 0, 1].includes(dx) || ![-1, 0, 1].includes(dy)) return null;
  const tokens = layerObject._getMovableObjects(ids, includeLocked); if (!tokens.length) return [];
  const bodies = tokenBounds(scene), boxes = world(scene).boxes;
  if (tokens.some(t => t.actor?.statuses?.has('flying') || e.tokens[t.id]?.wasFreeMode || !boxes.some(b => supports(b, bodies.find(v => v.id === t.id))))) return null;
  const forward = e.camera.getWorldDirection(new e.THREE.Vector3()); forward.y = 0;
  if (forward.lengthSq() < 1e-12) forward.set(0, 0, -1); else forward.normalize();
  const vx = -forward.z * dx - forward.x * dy, vz = forward.x * dx - forward.z * dy;
  const directions = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const direction = directions[(Math.round(Math.atan2(vz, vx) / (Math.PI / 4)) + 8) % 8], plans = new Map(), unit = scale(scene), [ox, oz] = origin(scene);
  for (const token of tokens) {
    const oldBody = bodies.find(b => b.id === token.id), next = { min: oldBody.min.map((v, i) => v + (i === 0 ? direction[0] : i === 2 ? direction[1] : 0)), max: oldBody.max.map((v, i) => v + (i === 0 ? direction[0] : i === 2 ? direction[1] : 0)) };
    const plan = walkingStep(scene, oldBody, next, true);
    if (!plan) { ui.notifications.warn('移动路径被构件阻挡'); return tokens; }
    const eye = (Number(token.losHeight) || token.document.elevation + 4.5) - token.document.elevation;
    const position = b => ({ x: ox + (b.min[0] + token.document.width / 2) * unit, y: oz + (b.min[2] + token.document.height / 2) * unit, z: b.min[1] * 5 + eye });
    for (let i = 1; i < plan.path.length; i++) {
      const a = position(plan.path[i - 1]), b = position(plan.path[i]);
      if (a.x === b.x && a.y === b.y && a.z === b.z) continue;
      if (e.interactionManager.computeSightCollision(a, b, 'collision')) { ui.notifications.warn('移动路径被场景障碍阻挡'); return tokens; }
    }
    plans.set(token.id, plan);
  }
  layerObject.hud?.close();
  const [data, updateOptions = {}] = layerObject._prepareKeyboardMovementUpdates(tokens, dx, dy, 0);
  for (const token of tokens) {
    const movement = updateOptions.movement[token.id], template = movement.waypoints[0], points = [];
    for (const body of plans.get(token.id).path.slice(1)) {
      const p = { ...template, x: ox + body.min[0] * unit, y: oz + body.min[2] * unit, elevation: body.min[1] * 5 }, previous = points.at(-1);
      if (!previous || p.x !== previous.x || p.y !== previous.y || p.elevation !== previous.elevation) points.push(p);
    }
    movement.waypoints = points;
  }
  await scene.updateEmbeddedDocuments('Token', data, updateOptions); return tokens;
}

function getMeshes() { return chunks(current()).map(t => engine()?.tiles[t.id]?.mesh?.children[0]).filter(Boolean); }
function pick(event, action = 'place') {
  if (!ownsScene(current()) || !engine()?._active || !engine()?._ready) return null;
  const T = engine().THREE, rect = engine().renderer.domElement.getBoundingClientRect();
  const mouse = new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new T.Raycaster(); ray.setFromCamera(mouse, engine().camera);
  const hits = ray.intersectObjects(getMeshes(), true).filter(h => h.object.isMesh && h.face), unit = scale(current()) / engine().factor, [ox, oz] = origin(current()), w = world(current());
  const toGrid = p => [(p.x - ox / engine().factor) / unit, p.y / unit, (p.z - oz / engine().factor) / unit];
  let hit, entry, normal;
  for (const h of hits) {
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld), tag = h.object.userData;
    const inside = toGrid(h.point.clone().addScaledVector(n, -unit * 1e-4));
    const e = tag.mcbAnchor ? entryAt(current(), tag.mcbAnchor, tag.mcbKind) : w.micro.get(inside.map(v => Math.floor(v * 2)).join(','));
    if (!e || (action === 'place' && e.kind === 'decor')) continue;
    hit = h; entry = e; normal = n; break;
  }
  const code = action === 'remove' ? entry?.code ?? 0 : blockCode(selectedMaterial, selectedRotation), def = definition(code);
  let cell, kind = action === 'remove' ? entry?.kind : def.kind;
  if (entry) {
    cell = entry.cell.slice();
    if (action === 'place') {
      if (Math.abs(normal.y) > .7) { const p = toGrid(hit.point); cell = [Math.floor(p[0] + 1e-6), Math.round(p[1] * 2) / 2 - (normal.y < 0 ? def.height : 0), Math.floor(p[2] + 1e-6)]; }
      else if (Math.abs(normal.x) > Math.abs(normal.z)) cell[0] += Math.sign(normal.x);
      else cell[2] += Math.sign(normal.z);
    }
  } else if (action === 'place') {
    const p = ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -layer * unit), new T.Vector3()); if (!p) return null;
    const q = toGrid(p); cell = [Math.floor(q[0]), layer, Math.floor(q[2])];
  } else return null;
  let reason = '';
  try { checkBounds(current(), cell, action === 'remove' ? 0 : code); if (action === 'place' && readCell(current(), cell, kind) && kind !== 'decor') throw Error('这里已有构件'); checkPlacement(current(), cell, action === 'remove' ? 0 : code, kind); } catch (e) { reason = e.message; }
  return { cell, action, code, kind, open: entry?.open ?? false, valid: !reason, reason };
}
function clearPreview() {
  if (preview) { preview.removeFromParent(); disposeModel(preview); preview.traverse(o => { if (o.isMesh) o.material.dispose(); }); preview = null; }
  previewEngine = null; previewCode = null; lastPick = null;
}
function showPreview(target) {
  if (!target) { if (preview) preview.visible = false; return; }
  const e = engine(), T = e.THREE, unit = scale(current()) / e.factor, [ox, oz] = origin(current());
  const signature = `${target.code}:${target.open}`;
  if (!preview || previewEngine !== e.scene || previewCode !== signature) {
    clearPreview(); const data = new Uint16Array(CELL_COUNT); data[0] = target.code;
    preview = createModel(T, data, definition(target.code).kind, [0, 0, 0], makeMaterial).model;
    preview.traverse(o => { o.userData.noShaders = true; if (o.isMesh) o.material = new T.MeshBasicMaterial({ color: 0x9bcf70, transparent: true, opacity: .3, depthWrite: false, side: T.DoubleSide }); });
    if (target.open) { poseKitDoor(preview, true); const hinge = preview.getObjectByName('mcb-door-pivot'); if (hinge) hinge.rotation.y = -Math.PI / 2; }
    preview.scale.setScalar(unit); e.scene.add(preview); previewEngine = e.scene; previewCode = signature;
  }
  preview.visible = true; const tint = target.valid ? target.action === 'remove' ? 0xf5b36b : 0xa3e07d : 0xec6155;
  if (preview.userData.tint !== tint) { preview.traverse(o => { if (o.isMesh) o.material.color.set(tint); }); preview.userData.tint = tint; }
  preview.position.set(ox / e.factor + target.cell[0] * unit, target.cell[1] * unit, oz / e.factor + target.cell[2] * unit);
  lastPick = target;
  const status = panel?.querySelector('[data-status]'), text = target.reason || `位置 ${target.cell[0]}, ${target.cell[2]} · 底面 ${target.cell[1] * EDGE_FEET} 英尺`; if (status && status.textContent !== text) status.textContent = text;
}
function intercept(event) {
  return editing && !cameraMode && game.user.isGM && engine()?._active && [0, 2].includes(event.button) && !event.target.closest?.('#mcb-panel, #mcb-open, #mcb-hotbar, .application, #sidebar, #ui-left, #ui-top, #ui-bottom, #interface');
}
function onPointerDown(event) {
  if (!intercept(event)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const action = event.button === 2 ? 'remove' : 'place';
  const result = pick(event, action); showPreview(result);
  if (result?.valid) edit(result.cell, action === 'remove' ? 0 : result.code, current(), { kind: result.kind }).catch(showError);
  else if (result?.reason) ui.notifications.warn(result.reason);
}
function showError(error) { console.error(`${ID}:`, error); ui.notifications.error(error.message); }
function applyControlMode() {
  if (editing && engine()?.controls) {
    const controls = engine().controls, interaction = engine().interactionManager;
    if (!savedControls) savedControls = { controls, interaction, enabled: controls.enabled, rotate: controls.enableRotate, pan: controls.enablePan, zoom: controls.enableZoom, buttons: controls.mouseButtons, preventSelect: interaction.preventSelect };
    if (!cameraMode) {
      // Consume OrbitControls inertia without moving the view the user chose.
      const position = engine().camera.position.clone(), target = controls.target.clone(), damping = controls.enableDamping;
      controls.enableDamping = false; controls.update();
      engine().camera.position.copy(position); controls.target.copy(target); controls.update(); controls.enableDamping = damping;
    }
    controls.enabled = cameraMode;
    // The v13 renderer defaults to middle-button rotation. Use its existing
    // OrbitControls with explicit camera-only bindings for this editing session.
    controls.mouseButtons = cameraMode ? { ...savedControls.buttons, LEFT: engine().THREE.MOUSE.ROTATE, RIGHT: engine().THREE.MOUSE.PAN } : savedControls.buttons;
    if (cameraMode) { controls.enableRotate = true; controls.enablePan = true; controls.enableZoom = true; }
    interaction.preventSelect = true;
  } else if (savedControls) {
    const s = savedControls; s.controls.enabled = s.enabled; s.controls.enableRotate = s.rotate; s.controls.enablePan = s.pan; s.controls.enableZoom = s.zoom; s.controls.mouseButtons = s.buttons; s.interaction.preventSelect = s.preventSelect; savedControls = null;
  }
}
function toggleControlMode() { requireGM(); if (!editing) return; cameraMode = !cameraMode; clearPreview(); applyControlMode(); refreshPanel(); }
function stopEditing() { editing = false; cameraMode = false; applyControlMode(); clearPreview(); refreshPanel(); }
function categoryItems() { return CATALOG.filter(t => t.category === category && (!t.kit || t.style === kitStyle) && (!searchText || (t.label + ' ' + (t.use ?? '')).includes(searchText))); }
const thumbs = new Map(); let thumbRenderer;
function thumbnail(id) {
  if (thumbs.has(id)) return thumbs.get(id);
  const T = engine()?.THREE; if (!T) return '';
  thumbRenderer ??= new T.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
  thumbRenderer.setSize(96, 80, false); thumbRenderer.setClearColor(0, 0);
  thumbRenderer.toneMapping = T.ACESFilmicToneMapping; thumbRenderer.toneMappingExposure = 1;
  const cells = new Uint16Array(CELL_COUNT), code = blockCode(id), def = definition(code); cells[0] = code;
  const built = createModel(T, cells, def.kind, [0,0,0], makeMaterial), scene = new T.Scene(); scene.add(built.model);
  scene.add(new T.HemisphereLight(0xfff5de, 0x586374, .65));
  const light = new T.DirectionalLight(0xffffff, .9); light.position.set(-3,6,-4); scene.add(light);
  const box = new T.Box3().setFromObject(built.model), center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
  const radius = Math.max(size.x,size.y,size.z)*.85, camera = new T.OrthographicCamera(-radius*1.2,radius*1.2,radius,-radius,.01,50);
  camera.position.copy(center).add(new T.Vector3(5,Math.sqrt(50),-5)); camera.lookAt(center);
  thumbRenderer.render(scene,camera); const url = thumbRenderer.domElement.toDataURL('image/png');
  disposeModel(built.model); thumbs.set(id,url); return url;
}
function selectType(id) { const d = definition(blockCode(id)); selectedMaterial = id; selectedRotation = 0; category = d.category; clearPreview(); refreshPanel(); }
function rotateSelection() { if (!definition(blockCode(selectedMaterial)).rotate) return; selectedRotation = (selectedRotation + 1) % 4; clearPreview(); refreshPanel(); }
function renderHotbar() {
  document.body.classList.toggle('mcb-editing', !!editing);
  if (!game.user?.isGM) return;
  if (!hotbar && editing) {
    hotbar = document.createElement('section'); hotbar.id = 'mcb-hotbar'; hotbar.setAttribute('aria-label', '方块栏');
    hotbar.innerHTML = `<div class="mcb-control-mode" data-control-mode></div><div class="mcb-categories">${CATEGORIES.map(c => `<button type="button" class="mcb-category" data-category="${c.id}">${c.label}</button>`).join('')}<button type="button" class="mcb-rotate" data-rotate></button></div><div class="mcb-library-filter"><label>样式 <select data-style>${STYLES.map(s=>`<option value="${s.id}">${s.label}</option>`).join('')}</select></label><input data-search type="search" placeholder="搜索当前分类" aria-label="搜索构件"><span data-results></span></div><div class="mcb-slots" role="toolbar" aria-label="可用构件">${CATALOG.filter(m => m.id).map(m => `<button type="button" data-material="${m.id}" aria-label="${m.label}" title="${m.use ?? m.label}" style="--swatch:${m.color}"><kbd></kbd><i data-shape="${m.shape}">${m.icon ?? ''}</i><span>${m.shortLabel ?? m.label}</span></button>`).join('')}</div><div class="mcb-hotbar-help" data-hotbar-help></div>`;
    hotbar.addEventListener('click', event => { const b = event.target.closest('button'); if (!b) return; if (b.dataset.category) { category = b.dataset.category; const first = categoryItems()[0]; if (first) selectType(first.id); else refreshPanel(); } else if (b.dataset.material) selectType(Number(b.dataset.material)); else if (b.hasAttribute('data-rotate')) rotateSelection(); });
    hotbar.querySelector('[data-style]').value = kitStyle;
    hotbar.querySelector('[data-style]').addEventListener('change', event => { const key = definition(blockCode(selectedMaterial)).key; kitStyle = event.target.value; const item = categoryItems().find(t=>t.key===key) ?? categoryItems()[0]; if (item) selectType(item.id); else refreshPanel(); });
    hotbar.querySelector('[data-search]').addEventListener('input', event => { searchText = event.target.value.trim(); refreshPanel(); });
    document.body.append(hotbar);
  }
  if (!hotbar) return;
  hotbar.hidden = !editing;
  hotbar.dataset.controlMode = cameraMode ? 'camera' : 'build';
  hotbar.querySelector('[data-control-mode]').textContent = cameraMode ? '视角控制 · Alt 切回鼠标建造' : '鼠标建造 · Alt 切换视角控制';
  const items = categoryItems();
  hotbar.querySelector('[data-results]').textContent = `${items.length} 件`;
  hotbar.querySelector('[data-style]').value = kitStyle;
  hotbar.querySelector('[data-hotbar-help]').textContent = cameraMode ? `WASD 平移 · Q/E 旋转 · 滚轮缩放 · 1–${Math.min(9, items.length)} 选择` : `左键放置 · 右键移除 · 1–${Math.min(9, items.length)} 选择 · Esc 退出`;
  for (const b of hotbar.querySelectorAll('[data-material]')) {
    const id = Number(b.dataset.material), index = items.findIndex(t => t.id === id), active = id === selectedMaterial;
    b.hidden = index < 0; b.querySelector('kbd').textContent = index >= 0 && index < 9 ? String(index + 1) : ''; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
    if (index >= 0 && items[index].kit && !b.dataset.thumb) {
      try { const url = thumbnail(id); if (url) { b.querySelector('i').style.backgroundImage = `url("${url}")`; b.classList.add('mcb-has-thumb'); b.dataset.thumb = '1'; } } catch (error) { console.warn('MC catalogue thumbnail', error); }
    }
  }
  for (const b of hotbar.querySelectorAll('[data-category]')) b.classList.toggle('active', b.dataset.category === category);
  const rotation = hotbar.querySelector('[data-rotate]'); rotation.hidden = !definition(blockCode(selectedMaterial)).rotate; rotation.textContent = `↻ R · ${selectedRotation * 90}°`;
}
function snapshot(scene = current()) {
  const tiles = chunks(scene), entries = world(scene).entries;
  return { version: VERSION, blockFeet: EDGE_FEET, verticalStepFeet: 2.5, scene: scene?.id, chunks: tiles.length, cubes: entries.filter(e => e.kind !== 'decor').length, decorations: entries.filter(e => e.kind === 'decor').length, doors: entries.filter(e => e.kind === 'door').map(e => ({ tileId: e.tile.id, cell: e.cell, open: e.open, rotation: e.def.rotation })), editing, mode: cameraMode ? 'camera' : 'build', category, selectedMaterial, selectedRotation, layer, undo: undoStack.length, redo: redoStack.length, lastPick, modelMetrics: tiles.map(t => ({ id: t.id, ...modelMetrics.get(t.id) })) };
}
function refreshPanel() {
  renderHotbar();
  if (!panel || panel.hidden) return;
  const ready = ownsScene(current());
  panel.querySelector('[data-edit]').textContent = editing ? '退出建造' : '开始建造';
  panel.querySelector('[data-edit]').disabled = !ready;
  const stats = ready ? snapshot() : null, d = definition(blockCode(selectedMaterial));
  panel.querySelector('[data-count]').textContent = ready ? `${stats.cubes} 构件 · ${stats.decorations} 装饰 · 自动保存` : '新建一张地图开始搭建';
  panel.querySelector('[data-shape-info]').textContent = d.kit ? `${d.label} · ${d.extent.map(n=>+(n*5).toFixed(2)).join(' × ')} 英尺（宽/高/深）\n${d.use}${d.kind === 'decor' ? ' · 不阻挡移动/视线' : ''}` : d.kind === 'decor' ? `${d.label} · 不阻挡移动和视线` : d.kind === 'door' ? '木门 · 宽 5 英尺、高 10 英尺；退出建造后在标记图层单击开关' : `${d.label} · 5 × 5 × ${d.height * 5} 英尺${d.kind === 'glass' ? ' · 透明但阻挡移动' : d.kind === 'water' ? ' · 半透明、可穿过' : ''}`;
  panel.querySelector('[data-height]').max = String((Math.floor(((stateOf(current())?.maxY ?? 24) - d.height) * 2) / 2) * 5);
  panel.querySelector('[data-undo]').disabled = !undoStack.length;
  panel.querySelector('[data-redo]').disabled = !redoStack.length;
}
function open() {
  requireGM(); if (panel) { panel.hidden = !panel.hidden; if (panel.hidden) stopEditing(); else refreshPanel(); return; }
  panel = document.createElement('section'); panel.id = 'mcb-panel'; panel.setAttribute('aria-label', '方块建造');
  panel.innerHTML = `<header><div><small>MC BUILDER</small><h2>方块建造</h2></div><button type="button" data-close aria-label="关闭">×</button></header><p class="mcb-rule">基础网格 <strong>5 × 5</strong> 英尺</p><div class="mcb-row"><button type="button" data-new>新建方块地图</button><button type="button" data-edit>开始建造</button></div><p class="mcb-input-guide">左键放置 · 右键移除<br>数字选择当前分类 · R 旋转</p><p class="mcb-shape-info" data-shape-info></p><label class="mcb-height">空白处建造高度 <input type="number" data-height value="0" step="2.5" min="-40" max="117.5"> 英尺</label><div class="mcb-row"><button type="button" data-undo>↶ 撤销</button><button type="button" data-redo>↷ 重做</button></div><p data-status>按 Alt 切换视角／鼠标建造 · Esc 退出</p><footer><span data-count></span><span>主持人编辑 · 玩家同步</span></footer>`;
  document.body.append(panel);
  panel.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.hasAttribute('data-close')) { panel.hidden = true; stopEditing(); }
    if (button.hasAttribute('data-new')) createScene().catch(showError);
    if (button.hasAttribute('data-edit')) { try { requireScene(); if (!engine()?._active || !engine()?._ready) throw new Error('请等候 3D 场景加载完成'); if (editing) stopEditing(); else { editing = true; cameraMode = false; applyControlMode(); } } catch (e) { showError(e); } }
    if (button.hasAttribute('data-undo')) undo().catch(showError);
    if (button.hasAttribute('data-redo')) undo(true).catch(showError);
    refreshPanel();
  });
  panel.querySelector('[data-height]').addEventListener('change', event => { const value = Number(event.target.value); if (Number.isInteger(value / 2.5) && value >= -40 && value <= Number(event.target.max)) layer = value / EDGE_FEET; else { event.target.value = layer * EDGE_FEET; ui.notifications.warn('高度须按 2.5 英尺对齐，并位于构件允许范围内'); } });
  refreshPanel();
}

async function createScene() {
  requireGM();
  return enqueue(async () => {
    const width = 24, height = 24, unit = 100, factor = engine()?.factor || 1000;
    const center = width * unit / factor / 2;
    const scene = await Scene.create({ name: '方块建造 · 5英尺', width: width * unit, height: height * unit, padding: 0, backgroundColor: '#26332d', grid: { type: 1, size: unit, distance: EDGE_FEET, units: 'ft', alpha: .1 }, tokenVision: true, fog: { exploration: false }, environment: { globalLight: { enabled: true } }, flags: { [ID]: { config: { schema: 3, blockFeet: EDGE_FEET, chunkSize: CHUNK_SIZE, width, height, minY: -8, maxY: 24 } }, 'levels-3d-preview': { auto3d: true, enablePlayers: true, object3dSight: true, renderBackground: false, renderTable: 'none', exr: '', exposure: 1, grounding: 'notFlying', preventNegative: false, initialPosition: { target: { x: center, y: 0, z: center }, position: { x: center + 1.8, y: 2.5, z: center + 1.8 }, firstPersonMode: false } } } });
    try {
      await scene.update({ 'flags.levels-3d-preview.ambientLightIntensity': 0.65, 'flags.levels-3d-preview.ambientLightColor': '#fff7e7', 'flags.levels-3d-preview.sunPosition': 10 });
      // Levels expects each newly created Tile to already have a canvas object.
      await scene.view();
      const specs = [];
      for (let cx = 0; cx < width / CHUNK_SIZE; cx++) for (let cz = 0; cz < height / CHUNK_SIZE; cz++) {
        const cells = new Uint16Array(CELL_COUNT);
        for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) cells[indexOf(x, (CHUNK_SIZE - 1) * 2, z)] = 1;
        specs.push(tileData(scene, [cx, -1, cz], cells));
      }
      await scene.createEmbeddedDocuments('Tile', specs, { mcbEdit: true });
    } catch (e) { await scene.delete(); throw e; }
    refreshPanel(); return scene.id;
  });
}

Hooks.on('3DCanvasInit', () => { try { installAdapter(); } catch (e) { showError(e); } });
Hooks.once('init', () => {
  const Parent = CONFIG.Canvas.layers.tokens.layerClass;
  CONFIG.Canvas.layers.tokens.layerClass = class MCBTokenLayer extends Parent {
    async moveMany(options = {}) { const result = await shapeKeyboardMovement(this, options); return result === null ? super.moveMany(options) : result; }
  };
});
Hooks.once('ready', () => {
  // 3D Canvas can initialize after this hook on player clients. Its Init hook
  // installs the adapter at the correct time; absence here is not an error.
  if (engine()?.helpers?.loadModel) try { installAdapter(); } catch (e) { showError(e); }
  game.modules.get(ID).api = { version: VERSION, blockFeet: EDGE_FEET, createScene, open, edit, undo: () => undo(), redo: () => undo(true), readCell: (cell, kind) => readCell(current(), cell, kind), snapshot, stopEditing, toggleControlMode, whenIdle: () => serial, tokenBounds: () => tokenBounds(current()), sweepBlocked, catalog: CATALOG.map(t => ({ ...t, code: blockCode(t.id) })), blockCode, definition, geometryBoxes, collisionBoxes, entries: () => world(current()).entries.map(e => ({ cell: e.cell.slice(), code: e.code, kind: e.kind, tileId: e.tile.id, open: e.open })), toggleDoor: tileId => { requireGM(); const tile = current().tiles.get(tileId); if (chunkOf(tile)?.kind !== 'door') throw Error('此物件不是门'); return tile.setFlag('levels-3d-preview', 'doorState', Number(tile.getFlag('levels-3d-preview', 'doorState')) === 1 ? 0 : 1); }, highGround: { status: highGroundStatus, forTokens, preview: attackPreview } };
  game.modules.get(ID).api.combatView = { status: combatViewStatus, presentation: targetPresentation };
  game.modules.get(ID).api.combatArea = { status: areaStatus };
  game.modules.get(ID).api.spellVfx = { status: spellVfxStatus };
  game.modules.get(ID).api.camera = { status: cameraStatus };
  game.modules.get(ID).api.movement = { status: movementStatus,allowsJumpUpdate,allowsSpellMove,planJumpTo };
  game.modules.get(ID).api.spatialVisuals = { status: spatialVisualStatus };
  if (!game.user.isGM) return;
  launcher = document.createElement('button'); launcher.id = 'mcb-open'; launcher.textContent = '▧ 方块建造'; launcher.onclick = open; document.body.append(launcher);
  window.addEventListener('pointerdown', onPointerDown, true);
  for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) window.addEventListener(type, event => { if (intercept(event)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  window.addEventListener('pointermove', event => { if (!editing || cameraMode || !engine()?._active) return; if (event.target.closest?.('#mcb-panel, #mcb-hotbar, .application, #sidebar')) { if (preview) preview.visible = false; return; } showPreview(pick(event, event.buttons & 2 ? 'remove' : 'place')); }, true);
  window.addEventListener('keydown', event => {
    if (!editing || event.target.closest?.('input,textarea,[contenteditable]')) return;
    if (['AltLeft', 'AltRight'].includes(event.code)) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) toggleControlMode(); return; }
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
    if (digit && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopImmediatePropagation(); const item = categoryItems()[Number(digit[1]) - 1]; if (item) selectType(item.id); return; }
    if (event.code === 'KeyR' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) rotateSelection(); return; }
    if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); stopEditing(); }
    else if ((event.ctrlKey || event.metaKey) && ['KeyZ', 'KeyY'].includes(event.code)) { event.preventDefault(); event.stopImmediatePropagation(); undo(event.code === 'KeyY' || event.shiftKey).catch(showError); }
  }, true);
  window.addEventListener('keyup', event => { if (editing && ['AltLeft', 'AltRight'].includes(event.code) && !event.target.closest?.('input,textarea,[contenteditable]')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
});
Hooks.on('canvasReady', () => { if (lastScene !== current()?.id) { lastScene = current()?.id; undoStack.length = redoStack.length = 0; stopEditing(); } refreshPanel(); });
Hooks.on('canvasTearDown', () => { stopEditing(); worldCaches.clear(); });
Hooks.on('3DCanvasSceneReady', refreshPanel);
Hooks.on('3DCanvasToggleMode', enabled => { if (!enabled) stopEditing(); });
for (const name of ['createTile', 'updateTile', 'deleteTile']) Hooks.on(name, tile => { if (chunkOf(tile)) { if (name === 'deleteTile') modelMetrics.delete(tile.id); refreshPanel(); } });
Hooks.on('preUpdateTile', (tile, changes, options) => {
  if (!chunkOf(tile) || options.mcbEdit) return;
  const flat = foundry.utils.flattenObject(changes), keys = Object.keys(flat).filter(k => k !== '_id' && !k.startsWith('_stats.'));
  if (chunkOf(tile).kind === 'door' && keys.length === 1 && keys[0] === 'flags.levels-3d-preview.doorState') {
    const state = Number(flat[keys[0]]); if (![0, 1, 2].includes(state)) return false;
    const entry = world(tile.parent).entries.find(e => e.tile.id === tile.id);
    try { checkPlacement(tile.parent, entry.cell, entry.code, 'door', state); return; } catch (e) { ui.notifications.warn(e.message); return false; }
  }
  ui.notifications.warn('请通过方块建造工具修改地图构件的位置、尺寸和材质'); return false;
});
Hooks.on('preDeleteTile', (tile, options) => { if (!chunkOf(tile) || options.mcbEdit) return; ui.notifications.warn('请用方块建造工具拆除方块'); return false; });
Hooks.on('preUpdateScene', (scene, changes) => { if (!ownsScene(scene)) return; if (['width', 'height', 'padding', 'grid'].some(k => k in changes)) { ui.notifications.warn('方块地图的尺寸和 5 英尺网格已固定，请新建地图调整布局'); return false; } });
Hooks.on('preUpdateToken', (doc, changes, options) => {
  const scene = doc.parent; if (!ownsScene(scene) || !['x', 'y', 'elevation'].some(k => k in changes)) return;
  if ((options.teleport && game.user.isGM)||allowsSpellMove(doc,changes,options)) return;
  const old = tokenBounds(scene).find(t => t.id === doc.id), next = tokenBounds(scene, { id: doc.id, ...changes }).find(t => t.id === doc.id);
  if (sweepBlocked(scene, old, next)) {
    const flying = doc.actor?.statuses?.has('flying') || engine()?.tokens?.[doc.id]?.wasFreeMode;
    const height = flying ? null : walkingStep(scene, old, next);
    if (height !== null) { changes.elevation = height; return; }
    ui.notifications.warn('移动路径被构件阻挡'); return false;
  }
});
