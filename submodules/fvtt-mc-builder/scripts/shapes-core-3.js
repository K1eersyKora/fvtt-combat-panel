import { STORM_CATALOG } from './storm-catalog-1.js';
import { KIT_CATALOG } from './kit-catalog-1.js';
import { MATERIALS, decode as decodeLegacy, localOf as legacyLocal } from './core-1.js';
export const CHUNK = 8, LAYERS = 16, COUNT = 1024;
export const CATEGORIES = [{ id: 'blocks', label: '基础' }, { id: 'structures', label: '旧结构' }, { id: 'architecture', label: '建筑' }, { id: 'terrain', label: '地形' }, { id: 'mechanisms', label: '机关' }, { id: 'furniture', label: '陈设' }, { id: 'decor', label: '装饰' }];
export const CATALOG = Object.freeze([
  { id: 0, label: '空气', shape: 'air', height: 0, kind: 'solid', collision: false },
  ...MATERIALS.slice(1).map(m => ({ ...m, category: 'blocks', shape: 'cube', height: 1, material: m.id, kind: 'solid', collision: true, sight: true })),
  { id: 7, label: '石阶', color: '#99968a', category: 'structures', shape: 'stairs', height: 1, material: 3, kind: 'solid', collision: true, sight: true, rotate: true },
  { id: 8, label: '半高土块', color: '#947050', category: 'structures', shape: 'slab', height: .5, material: 2, kind: 'solid', collision: true, sight: true },
  { id: 9, label: '半高石块', color: '#99968a', category: 'structures', shape: 'slab', height: .5, material: 3, kind: 'solid', collision: true, sight: true },
  { id: 10, label: '石板', color: '#b4a48d', category: 'structures', shape: 'slab', height: .5, material: 5, kind: 'solid', collision: true, sight: true },
  { id: 11, label: '蘑菇', color: '#c74d43', category: 'decor', shape: 'mushroom', height: .5, kind: 'decor', collision: false, sight: false, rotate: true, icon: '🍄' },
  { id: 12, label: '花卉', color: '#eabf6d', category: 'decor', shape: 'flower', height: .5, kind: 'decor', collision: false, sight: false, rotate: true, icon: '✿' },
  { id: 13, label: '小石子', color: '#aaa591', category: 'decor', shape: 'pebbles', height: .5, kind: 'decor', collision: false, sight: false, rotate: true, icon: '●' },
  { id: 14, label: '玻璃', color: '#a7e2e9', category: 'blocks', shape: 'glass', height: 1, material: 14, kind: 'glass', collision: true, sight: false },
  { id: 15, label: '水体', color: '#4da4cc', category: 'blocks', shape: 'water', height: 1, material: 15, kind: 'water', collision: false, sight: false },
  { id: 16, label: '木门', color: '#ac8450', category: 'structures', shape: 'door', height: 2, material: 4, kind: 'door', collision: true, sight: true, rotate: true },
  ...KIT_CATALOG, ...STORM_CATALOG
]);
const types = new Map(CATALOG.map(t => [t.id, t]));
export function definition(code) {
  if (!Number.isInteger(code) || code < 0 || code > 65535) throw Error('未知构件编码');
  const id = code < 128 ? code & 31 : 17 + Math.floor((code - 128) / 4);
  const rotation = code < 128 ? code >> 5 : (code - 128) % 4;
  const type = types.get(id);
  if (!type || (code < 128 && id > 16) || (rotation && !type.rotate)) throw Error('构件朝向无效');
  return { ...type, rotation, code };
}
export function blockCode(id, rotation = 0) {
  if (!Number.isInteger(id) || !types.has(id) || !Number.isInteger(rotation)) throw Error('未知构件类型');
  const r = (rotation % 4 + 4) % 4, code = id < 17 ? id + r * 32 : 128 + (id - 17) * 4 + r;
  definition(code); return code;
}
export function validateCell(c) {
  if (!Array.isArray(c) || c.length !== 3 || !Number.isSafeInteger(c[0]) || !Number.isSafeInteger(c[2]) || !Number.isSafeInteger(c[1] * 2)) throw Error('水平位置须对齐 5 英尺网格，高度须对齐 2.5 英尺网格');
  return c;
}
export function cellKey(c) { validateCell(c); return `${c[0]},${c[1] * 2},${c[2]}`; }
export function indexOf(x, y2, z) {
  if (![x, y2, z].every(Number.isInteger) || x < 0 || x >= 8 || z < 0 || z >= 8 || y2 < 0 || y2 >= 16) throw Error('区块位置越界');
  return x + 8 * (z + 8 * y2);
}
export function localOf(i) { return [i % 8, Math.floor(i / 64) / 2, Math.floor(i / 8) % 8]; }
export function address(c) {
  validateCell(c); const chunk = c.map(v => Math.floor(v / 8)), local = c.map((v, i) => v - chunk[i] * 8);
  return { chunk, local, key: chunk.join(','), index: indexOf(local[0], local[1] * 2, local[2]) };
}
export function encode(cells) {
  if ((!(cells instanceof Uint8Array) && !(cells instanceof Uint16Array)) || cells.length !== COUNT) throw Error('构件数据长度错误');
  const runs = []; for (let i = 0; i < COUNT;) { const code = cells[i]; definition(code); let end = i + 1; while (end < COUNT && cells[end] === code) end++; runs.push(`${(end - i).toString(36)}:${code.toString(36)}`); i = end; } return runs.join(',');
}
export function decodeChunk(flag) {
  const cells = flag.schema === 3 ? new Uint16Array(COUNT) : new Uint8Array(COUNT);
  if (flag.schema === 1) { const old = decodeLegacy(flag.cells); for (let i = 0; i < old.length; i++) if (old[i]) { const [x, y, z] = legacyLocal(i); cells[indexOf(x, y * 2, z)] = old[i]; } return cells; }
  if (![2, 3].includes(flag.schema) || typeof flag.cells !== 'string' || flag.cells.length > COUNT * 8) throw Error('构件存档格式无效');
  let cursor = 0;
  for (const part of flag.cells.split(',')) {
    if (!/^[0-9a-z]+:[0-9a-z]{1,4}$/.test(part)) throw Error('构件编码损坏');
    const [run, code] = part.split(':').map(s => parseInt(s, 36));
    if (flag.schema === 2 && code >= 128) throw Error('旧存档不能包含扩展构件');
    const def = definition(code);
    if (!Number.isSafeInteger(run) || run < 1 || cursor + run > COUNT || (code && def.kind !== flag.kind)) throw Error('构件编码越界或分类不符');
    cells.fill(code, cursor, cursor + run); cursor += run;
  }
  if (cursor !== COUNT) throw Error('构件存档不完整'); return cells;
}
export function entriesOf(cells, origin = [0, 0, 0]) {
  const result = []; for (let i = 0; i < cells.length; i++) if (cells[i]) { const local = localOf(i); result.push({ code: cells[i], local, cell: local.map((v, a) => v + origin[a] * 8), def: definition(cells[i]) }); } return result;
}
export function rotatePoint(x, z, r) { return r === 1 ? [z, 1 - x] : r === 2 ? [1 - x, 1 - z] : r === 3 ? [1 - z, x] : [x, z]; }
export function geometryBoxes(code, cell = [0, 0, 0]) {
  const d = definition(code); if (!code || (d.kind === 'decor' && !d.kit)) return [];
  let boxes = d.parts ?? (d.shape === 'stairs' ? [{ min: [0, 0, 0], max: [1, .5, 1] }, { min: [0, .5, .5], max: [1, 1, 1] }] : [{ min: [0, 0, 0], max: [1, d.height, d.shape === 'door' ? .16 : 1] }]);
  return boxes.map(b => {
    const p = []; for (const x of [b.min[0], b.max[0]]) for (const z of [b.min[2], b.max[2]]) p.push(rotatePoint(x, z, d.rotation));
    return { min: [Math.min(...p.map(v => v[0])) + cell[0], b.min[1] + cell[1], Math.min(...p.map(v => v[1])) + cell[2]], max: [Math.max(...p.map(v => v[0])) + cell[0], b.max[1] + cell[1], Math.max(...p.map(v => v[1])) + cell[2]] };
  });
}
export function collisionBoxes(code, cell, open = false) { const d = definition(code); return !d.collision || (d.kind === 'door' && open) ? [] : geometryBoxes(code, cell); }
export function overlaps(a, b) { return [0, 1, 2].every(i => a.min[i] < b.max[i] - 1e-6 && a.max[i] > b.min[i] + 1e-6); }
export function supports(box, body) { return Math.abs(body.min[1] - box.max[1]) < 1e-5 && [0, 2].every(i => body.min[i] < box.max[i] - 1e-5 && body.max[i] > box.min[i] + 1e-5); }
export function ascends(rotation, dx, dz) { return (rotation === 0 ? dz : rotation === 1 ? dx : rotation === 2 ? -dz : -dx) > 1e-6; }

export function meshCells(cells) {
  const entries = entriesOf(cells), dims = [16, 18, 16], voxels = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const index = p => p[0] + dims[0] * (p[2] + dims[2] * p[1]);
  const sample = p => p.some((v, i) => v < 0 || v >= dims[i]) ? 0 : voxels[index(p)];
  for (const entry of entries) for (const b of geometryBoxes(entry.code, entry.local)) {
    if (entry.def.kind === 'door' || entry.def.kit) continue;
    for (let y = Math.round(b.min[1] * 2); y < Math.round(b.max[1] * 2); y++) for (let z = Math.round(b.min[2] * 2); z < Math.round(b.max[2] * 2); z++) for (let x = Math.round(b.min[0] * 2); x < Math.round(b.max[0] * 2); x++) voxels[index([x, y, z])] = entry.def.material;
  }
  const groups = new Map(); let quads = 0;
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3, w = dims[u], h = dims[v];
    for (const sign of [-1, 1]) for (let plane = 0; plane <= dims[axis]; plane++) {
      const mask = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const p = [0, 0, 0]; p[axis] = plane - (sign > 0 ? 1 : 0); p[u] = i; p[v] = j; const neighbor = p.slice(); neighbor[axis] += sign;
        const mat = sample(p); if (mat && !sample(neighbor)) mask[j * w + i] = mat;
      }
      for (let j = 0; j < h; j++) for (let i = 0; i < w;) {
        const material = mask[j * w + i]; if (!material) { i++; continue; }
        let width = 1, height = 1; while (i + width < w && mask[j * w + i + width] === material) width++;
        outer: while (j + height < h) { for (let dx = 0; dx < width; dx++) if (mask[(j + height) * w + i + dx] !== material) break outer; height++; }
        const face = axis === 1 ? sign > 0 ? 'top' : 'bottom' : 'side', key = `${material}:${face}`;
        if (!groups.has(key)) groups.set(key, { material, face, positions: [], normals: [], uvs: [], indices: [] });
        const g = groups.get(key), start = g.positions.length / 3;
        for (const [du, dv] of [[0, 0], [width, 0], [width, height], [0, height]]) {
          const p = [0, 0, 0], n = [0, 0, 0]; p[axis] = plane / 2; p[u] = (i + du) / 2; p[v] = (j + dv) / 2; n[axis] = sign; g.positions.push(...p); g.normals.push(...n); g.uvs.push(du / 2, dv / 2);
        }
        g.indices.push(...(sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map(n => n + start));
        for (let dy = 0; dy < height; dy++) mask.fill(0, (j + dy) * w + i, (j + dy) * w + i + width);
        quads++; i += width;
      }
    }
  }
  return { groups: [...groups.values()], quads, triangles: quads * 2, count: entries.length };
}
