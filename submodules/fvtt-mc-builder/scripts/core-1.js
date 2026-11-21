// This layer uses integer cube coordinates only. Physical dimensions belong
// to the Foundry adapter; no operation can create fractions or scale a cube.
export const CHUNK_SIZE = 8;
export const CELL_COUNT = CHUNK_SIZE ** 3;
export const MATERIALS = Object.freeze([
  { id: 0, key: 'air', label: '空气', color: '#000000' },
  { id: 1, key: 'grass', label: '草地', color: '#769551' },
  { id: 2, key: 'dirt', label: '泥土', color: '#947050' },
  { id: 3, key: 'stone', label: '岩石', color: '#99968a' },
  { id: 4, key: 'wood', label: '木材', color: '#ac8450' },
  { id: 5, key: 'brick', label: '石砖', color: '#b4a48d' },
  { id: 6, key: 'sand', label: '沙地', color: '#d4bf82' }
]);

function integer(value, label) {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须是整数`);
  return value;
}
export function validateCell(cell) {
  if (!Array.isArray(cell) || cell.length !== 3) throw new Error('方块坐标必须包含三个整数');
  return cell.map((v, i) => integer(v, `坐标${i + 1}`));
}
export function validateMaterial(value) {
  if (!Number.isInteger(value) || value < 0 || value >= MATERIALS.length) throw new Error('未知方块材质');
  return value;
}
export const keyOf = (cell) => validateCell(cell).join(',');
export function parseKey(key) {
  if (typeof key !== 'string' || !/^-?\d+,-?\d+,-?\d+$/.test(key)) throw new Error('无效区块坐标');
  return validateCell(key.split(',').map(Number));
}
export function address(cell) {
  const c = validateCell(cell);
  const chunk = c.map(v => Math.floor(v / CHUNK_SIZE));
  const local = c.map((v, i) => v - chunk[i] * CHUNK_SIZE);
  return { chunk, key: chunk.join(','), local, index: indexOf(...local) };
}
export function indexOf(x, y, z) {
  for (const v of [x, y, z]) if (!Number.isInteger(v) || v < 0 || v >= CHUNK_SIZE) throw new Error('区块内坐标越界');
  return x + CHUNK_SIZE * (z + CHUNK_SIZE * y);
}
export function localOf(index) {
  integer(index, '方块索引');
  if (index < 0 || index >= CELL_COUNT) throw new Error('方块索引越界');
  return [index % CHUNK_SIZE, Math.floor(index / (CHUNK_SIZE ** 2)), Math.floor(index / CHUNK_SIZE) % CHUNK_SIZE];
}

// A bounded run-length format avoids serializing one Document per cube.
export function encode(cells) {
  if (!(cells instanceof Uint8Array) || cells.length !== CELL_COUNT) throw new Error('区块数据长度错误');
  const runs = [];
  for (let i = 0; i < cells.length;) {
    const material = validateMaterial(cells[i]);
    let end = i + 1;
    while (end < cells.length && cells[end] === material) end++;
    runs.push(`${(end - i).toString(36)}:${material.toString(36)}`);
    i = end;
  }
  return runs.join(',');
}
export function decode(value) {
  if (typeof value !== 'string' || !value.length || value.length > CELL_COUNT * 6) throw new Error('无效区块数据');
  const cells = new Uint8Array(CELL_COUNT);
  let cursor = 0;
  for (const pair of value.split(',')) {
    if (!/^[0-9a-z]+:[0-9a-z]$/.test(pair)) throw new Error('区块编码错误');
    const [run, material] = pair.split(':').map(s => parseInt(s, 36));
    validateMaterial(material);
    if (!Number.isSafeInteger(run) || run < 1 || cursor + run > CELL_COUNT) throw new Error('区块编码越界');
    cells.fill(material, cursor, cursor + run);
    cursor += run;
  }
  if (cursor !== CELL_COUNT) throw new Error('区块数据不完整');
  return cells;
}
export function boundsOf(cells) {
  if (!(cells instanceof Uint8Array) || cells.length !== CELL_COUNT) throw new Error('区块数据长度错误');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    validateMaterial(cells[i]);
    count++;
    const cell = localOf(i);
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], cell[a]); max[a] = Math.max(max[a], cell[a] + 1); }
  }
  return count ? { min, max, size: max.map((v, i) => v - min[i]), count } : null;
}

// Greedy surface meshing. All faces are on integer cube boundaries; internal
// faces within a chunk are omitted. Chunk borders remain closed independently
// so a delayed network update cannot open a collision hole in a neighboring tile.
export function meshChunk(cells) {
  const bounds = boundsOf(cells);
  if (!bounds) return { bounds: null, groups: [], quads: 0, triangles: 0 };
  const groups = new Map();
  let quads = 0;
  const sample = p => p.some(v => v < 0 || v >= CHUNK_SIZE) ? 0 : cells[indexOf(...p)];
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    for (const sign of [-1, 1]) for (let plane = 0; plane <= CHUNK_SIZE; plane++) {
      const mask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
      for (let j = 0; j < CHUNK_SIZE; j++) for (let i = 0; i < CHUNK_SIZE; i++) {
        const p = [0, 0, 0]; p[axis] = plane - (sign > 0 ? 1 : 0); p[u] = i; p[v] = j;
        const neighbor = p.slice(); neighbor[axis] += sign;
        const mat = sample(p);
        if (mat && !sample(neighbor)) mask[j * CHUNK_SIZE + i] = mat;
      }
      for (let j = 0; j < CHUNK_SIZE; j++) for (let i = 0; i < CHUNK_SIZE;) {
        const material = mask[j * CHUNK_SIZE + i];
        if (!material) { i++; continue; }
        let width = 1, height = 1;
        while (i + width < CHUNK_SIZE && mask[j * CHUNK_SIZE + i + width] === material) width++;
        outer: while (j + height < CHUNK_SIZE) {
          for (let dx = 0; dx < width; dx++) if (mask[(j + height) * CHUNK_SIZE + i + dx] !== material) break outer;
          height++;
        }
        const face = axis === 1 ? (sign > 0 ? 'top' : 'bottom') : 'side';
        const key = `${material}:${face}`;
        if (!groups.has(key)) groups.set(key, { material, face, positions: [], normals: [], uvs: [], indices: [] });
        const group = groups.get(key), start = group.positions.length / 3;
        for (const [du, dv] of [[0, 0], [width, 0], [width, height], [0, height]]) {
          const point = [0, 0, 0]; point[axis] = plane; point[u] = i + du; point[v] = j + dv;
          const normal = [0, 0, 0]; normal[axis] = sign;
          group.positions.push(...point); group.normals.push(...normal); group.uvs.push(du, dv);
        }
        const order = sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        group.indices.push(...order.map(n => start + n));
        for (let dy = 0; dy < height; dy++) mask.fill(0, (j + dy) * CHUNK_SIZE + i, (j + dy) * CHUNK_SIZE + i + width);
        quads++; i += width;
      }
    }
  }
  return { bounds, groups: [...groups.values()], quads, triangles: quads * 2 };
}

export function intersectAABB(a, b, epsilon = 1e-6) {
  return [0, 1, 2].every(i => a.min[i] < b.max[i] - epsilon && a.max[i] > b.min[i] + epsilon);
}

// A footprint touching a neighboring cube is legal; actual volume overlap is not.
export function overlapsToken(cell, tokenBounds) {
  validateCell(cell);
  return tokenBounds.some(b => intersectAABB({ min: cell, max: cell.map(v => v + 1) }, b));
}
