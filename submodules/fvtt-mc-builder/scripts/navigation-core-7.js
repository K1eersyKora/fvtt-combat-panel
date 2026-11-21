import {hostileIntervals,hostileFraction} from './walking-traffic-1.js';

const EPS = 1e-6;
const key = p => p.map(n => Math.round(n * 1e6) / 1e6).join(',');
const bodyAt = (p, size) => ({ min: [...p], max: p.map((n, i) => n + size[i]) });
export function boxesOverlap(a, b) { return [0, 1, 2].every(i => a.min[i] < b.max[i] - EPS && a.max[i] > b.min[i] + EPS); }

export function sweptBodyBlocked(start, end, size, boxes) {
  const delta = end.map((n, i) => n - start[i]);
  return boxes.some(box => {
    let near = 0, far = 1;
    for (let i = 0; i < 3; i++) {
      const lo = box.min[i] - size[i] + EPS, hi = box.max[i] - EPS;
      if (Math.abs(delta[i]) < EPS) { if (start[i] <= lo || start[i] >= hi) return false; }
      else {
        let a = (lo - start[i]) / delta[i], b = (hi - start[i]) / delta[i];
        if (a > b) [a, b] = [b, a];
        near = Math.max(near, a); far = Math.min(far, b);
        if (near > far) return false;
      }
    }
    return near <= far && far >= 0 && near <= 1;
  });
}

// Union area, rather than a sum, prevents coincident surfaces from providing
// fictitious extra support. MC geometry is axis aligned.
export function supportArea(rectangles, footprint) {
  const rects = rectangles.map(b => [Math.max(footprint.min[0], b.min[0]), Math.min(footprint.max[0], b.max[0]),
    Math.max(footprint.min[2], b.min[2]), Math.min(footprint.max[2], b.max[2])]).filter(r => r[1] - r[0] > EPS && r[3] - r[2] > EPS);
  const xs = [...new Set(rects.flatMap(r => [r[0], r[1]]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const mid = (xs[i - 1] + xs[i]) / 2;
    const ranges = rects.filter(r => r[0] < mid && r[1] > mid).map(r => [r[2], r[3]]).sort((a, b) => a[0] - b[0]);
    let from, to, length = 0;
    for (const r of ranges) { if (from === undefined) [from, to] = r; else if (r[0] <= to + EPS) to = Math.max(to, r[1]); else { length += to - from; [from, to] = r; } }
    if (from !== undefined) length += to - from;
    area += (xs[i] - xs[i - 1]) * length;
  }
  return area;
}

class Heap {
  values = [];
  push(value) { const a = this.values; a.push(value); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p].f <= value.f) break; a[i] = a[p]; i = p; } a[i] = value; }
  pop() { const a = this.values, first = a[0], last = a.pop(); if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let child = i * 2 + 1; if (child + 1 < a.length && a[child + 1].f < a[child].f) child++; if (a[child].f >= last.f) break; a[i] = a[child]; i = child; } a[i] = last; } return first; }
  get length() { return this.values.length; }
}

function compress(points) {
  const out = [];
  for (const p of points) {
    if (out.length && key(out.at(-1)) === key(p)) continue;
    if (out.length >= 2) {
      const a = out.at(-2), b = out.at(-1), u = b.map((n, i) => n - a[i]), v = p.map((n, i) => n - b[i]);
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      // Keep at least one checkpoint per grid step. A full diagonal is one grid
      // step too: splitting it into two half diagonals can double native costs.
      // Native stopMovement stops queued checkpoints; the committed step finishes.
      if (cross.every(n => Math.abs(n) < EPS) && u.reduce((s, n, i) => s + n * v[i], 0) > 0
        && Math.max(...p.map((n, i) => Math.abs(n - a[i]))) <= 1 + EPS) out.pop();
    }
    out.push(p);
  }
  return out;
}

export function createNavigation({ boxes, bounds, surface, barriers, snapHorizontal = n=>n, step = surface?.step ?? .5, maxRise = 1, maxDrop = 1, supportFraction = .5, maxNodes = 16000 } = {}) {
  const index = new Map(),exhaustedComponents=new Map();
  for (const box of boxes) for (let x = Math.floor(box.min[0]); x <= Math.floor(box.max[0] - EPS); x++) for (let z = Math.floor(box.min[2]); z <= Math.floor(box.max[2] - EPS); z++) {
    const k = `${x},${z}`; if (!index.has(k)) index.set(k, []); index.get(k).push(box);
  }
  function query(rect) {
    const set = new Set();
    for (let x = Math.floor(rect.min[0]); x <= Math.floor(rect.max[0] - EPS); x++) for (let z = Math.floor(rect.min[2]); z <= Math.floor(rect.max[2] - EPS); z++) for (const b of index.get(`${x},${z}`) ?? []) set.add(b);
    return [...set];
  }
  function inside(p, size) { return !bounds || [0, 1, 2].every(i => p[i] >= bounds.min[i] - EPS && p[i] + size[i] <= bounds.max[i] + EPS); }
  function support(p, size, local = query(bodyAt(p, size))) {
    const body = bodyAt(p, size), cx = p[0] + size[0] / 2, cz = p[2] + size[2] / 2;
    const surfaces = local.filter(b => Math.abs(b.max[1] - p[1]) < EPS);
    if (!surfaces.some(b => cx >= b.min[0] - EPS && cx <= b.max[0] + EPS && cz >= b.min[2] - EPS && cz <= b.max[2] + EPS)) return false;
    return supportArea(surfaces, body) + EPS >= size[0] * size[2] * supportFraction;
  }
  function standing(p, size, obstacles = []) {
    const body = bodyAt(p, size), local = query(body);
    return inside(p, size) && !barriers?.blocks(p,p,size) && !local.some(b => boxesOverlap(body, b)) && !obstacles.some(b => boxesOverlap(body, b))
      && (surface ? surface.standing(p, size) : support(p, size, local));
  }
  function transition(from, to, size, obstacles = []) {
    if(barriers?.blocks(from,to,size))return null;
    const rise = to[1] - from[1]; if (rise > maxRise + EPS || -rise > maxDrop + EPS) return null;
    const distance = Math.hypot(to[0] - from[0], to[2] - from[2]); if (distance < EPS) return null;
    if(surface){
      if(!surface.traversable(from,to,size)||sweptBodyBlocked(from,to,size,obstacles))return null;
      if(index.size){
        const sweep={min:from.map((n,i)=>Math.min(n,to[i])),max:from.map((n,i)=>Math.max(n,to[i])+size[i])};
        if(sweptBodyBlocked(from,to,size,query(sweep)))return null;
      }
      return [to];
    }
    const middle = rise > EPS ? [from[0], to[1], from[2]] : rise < -EPS ? [to[0], from[1], to[2]] : null;
    const parts = middle ? [from, middle, to] : [from, to];
    const broad = { min: from.map((n, i) => Math.min(n, to[i])), max: from.map((n, i) => Math.max(n, to[i]) + size[i]) };
    const local = query(broad).concat(obstacles);
    for (let i = 1; i < parts.length; i++) if (sweptBodyBlocked(parts[i - 1], parts[i], size, local)) return null;
    // A climb may briefly have air directly under the feet, but the projected
    // route must have continuous terrain beneath it within this step's levels.
    // Check every interval where the footprint or its center crosses a terrain
    // edge. Fixed-distance samples can miss a narrow crack between two slabs.
    const events = new Set([0, 1]);
    for (const box of query(broad)) for (const axis of [0, 2]) {
      const delta = to[axis] - from[axis]; if (Math.abs(delta) < EPS) continue;
      for (const offset of [0, size[axis] / 2, size[axis]]) for (const edge of [box.min[axis], box.max[axis]]) {
        const t = (edge - offset - from[axis]) / delta; if (t > EPS && t < 1 - EPS) events.add(t);
      }
    }
    const sorted = [...events].sort((a, b) => a - b), samples = [];
    for (let i = 1; i < sorted.length; i++) samples.push((sorted[i - 1] + sorted[i]) / 2);
    for (const t of samples) {
      const x = from[0] + (to[0] - from[0]) * t, z = from[2] + (to[2] - from[2]) * t;
      const probe = bodyAt([x, Math.max(from[1], to[1]), z], size), surfaces = query(probe);
      const levels = [...new Set(surfaces.map(b => b.max[1]))].filter(y => y >= Math.min(from[1], to[1]) - EPS && y <= Math.max(from[1], to[1]) + EPS);
      if (!levels.some(y => support([x, y, z], size, surfaces))) return null;
    }
    return parts.slice(1);
  }
  function* search(startBody, target, { obstacles = [], occupants = [], hostiles = [], approach = null } = {}, spacing = step) {
    const start = [...startBody.min], size = startBody.max.map((n, i) => n - start[i]);
    const canFinish=p=>!occupants.some(b=>boxesOverlap(bodyAt(p,size),b));
    const rate=(from,to)=>hostiles.length?1+hostileFraction(hostileIntervals(from,to,size,hostiles)):1;
    // A map's passages have fixed coordinates. Connect an unsnapped starting position
    // to this map-aligned lattice with the same sweep used for every other path edge.
    const lattice=(n,axis,offset=0)=>surface?snapHorizontal((Math.round(n/spacing)+offset)*spacing):
      start[axis]+(Math.round((n-start[axis])/spacing)+offset)*spacing;
    const goal=[lattice(target[0],0),target[1],lattice(target[2],2)];
    const fail = reason => ({ valid: false, reason, points: [start, goal], costs: [0, 0], cost: 0, visited: 0 });
    if (surface && !approach) {
      const absolute = surface.level(target[0] + size[0]/2, target[2] + size[2]/2, target[1]);
      const height = surface.level(goal[0] + size[0]/2, goal[2] + size[2]/2, target[1]);
      if (!Number.isFinite(absolute) || Math.abs(absolute - target[1]) > .42) return fail('这里不是可以步行到达的地面');
      goal[1] = Number.isFinite(height)?height:absolute;
    }
    if (![...start, ...goal, ...size].every(Number.isFinite) || size.some(n => n <= 0)) return fail('指示物尺寸或目标无效');
    if (!standing(start, size, obstacles)) return fail('角色当前没有可靠的站立支撑');
    if(surface&&!approach){
      const exact=[target[0],surface.level(target[0]+size[0]/2,target[2]+size[2]/2,target[1]),target[2]];
      const span=Math.hypot(exact[0]-start[0],exact[2]-start[2]);
      if(canFinish(exact)&&standing(exact,size,obstacles)&&!barriers?.blocks(start,exact,size)&&!sweptBodyBlocked(start,exact,size,obstacles)
        &&surface.traversable(start,exact,size)){
        const n=Math.max(1,Math.ceil(span)),points=[start],costs=[0];let valid=true;
        for(let i=1;i<=n;i++){
          const t=i/n,x=snapHorizontal(start[0]+(exact[0]-start[0])*t),z=snapHorizontal(start[2]+(exact[2]-start[2])*t);
          const h=surface.level(x+size[0]/2,z+size[2]/2,start[1]+(exact[1]-start[1])*t),p=[x,h,z],last=points.at(-1);
          if(key(last)===key(p))continue;
          if(!transition(last,p,size,obstacles)){valid=false;break;}
          points.push(p);costs.push(costs.at(-1)+Math.hypot(...p.map((v,k)=>v-last[k]))*5*rate(last,p));
        }
        if(valid)return {valid:true,reason:'',points,costs,cost:costs.at(-1),visited:0};
      }
    }
    const reaches=new Map();
    if(!approach){
      if(!surface&&canFinish(goal)&&standing(goal,size,obstacles))reaches.set(key(goal),[]);
      if(surface){
        const exact=[target[0],surface.level(target[0]+size[0]/2,target[2]+size[2]/2,target[1]),target[2]];
        if(!canFinish(exact))return fail('落点已被其他角色占据');
        if(standing(exact,size,obstacles)&&standing(goal,size,obstacles)){
          if(key(goal)===key(exact))reaches.set(key(goal),[]);
          else {const last=transition(goal,exact,size,obstacles);if(last)reaches.set(key(goal),last);}
        }
        if(!reaches.has(key(exact))&&standing(exact,size,obstacles))for(const dx of [-1,0,1])for(const dz of [-1,0,1]){
          const node=[lattice(goal[0],0,dx),goal[1],lattice(goal[2],2,dz)];
          node[1]=surface.level(node[0]+size[0]/2,node[2]+size[2]/2,exact[1]);
          if(!Number.isFinite(node[1])||!standing(node,size,obstacles))continue;
          const leg=transition(node,exact,size,obstacles);
          if(leg)reaches.set(key(node),leg);
        }
      }
      if(!reaches.size){
        if(surface&&standing([target[0],surface.level(target[0]+size[0]/2,target[2]+size[2]/2,target[1]),target[2]],size,obstacles))
          return {...fail('没有可通行路线'),refine:true};
        return fail('此处无法站立，或被障碍／其他角色占据');
      }
    }
    // Only a fully exhausted component proves a disconnection. A new hover beyond
    // the same shut door can reuse that proof without flooding the map a second time.
    const componentKey=surface&&!approach?JSON.stringify([start,size,obstacles.map(b=>[b.min,b.max])]):null;
    const known=componentKey&&exhaustedComponents.get(spacing);
    if(known?.key===componentKey&&![...reaches.keys()].some(k=>known.members.has(k)))
      return {...fail('没有可通行路线'),refine:true};
    const heuristic = approach ? approach.remaining : p => Math.hypot(goal[0] - p[0], goal[2] - p[2]) + Math.abs(goal[1] - p[1]);
    const heap = new Heap(), first = { p: start, g: 0, f: heuristic(start), parent: null, segment: [] };
    heap.push(first); const records = new Map([[key(start), first]]), stood = new Map(), closed = new Set(); let visited = 0, found;
    let bestFinish=null,finishCost=Infinity;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const entering=surface&&(Math.abs(start[0]-lattice(start[0],0))>EPS||Math.abs(start[2]-lattice(start[2],2))>EPS);
    const initialDirs=entering?[[0,0],...dirs]:dirs;
    while (heap.length && visited < maxNodes) {
      const node = heap.pop(), nodeKey = key(node.p); if (closed.has(nodeKey) || records.get(nodeKey) !== node) continue;
      if(bestFinish&&node.f>=finishCost-EPS)break;
      closed.add(nodeKey); visited++;
      if (approach ? canFinish(node.p)&&approach.accepts(node.p) : reaches.has(nodeKey)) { found = node; break; }
      if(approach?.contacts&&approach.remaining(node.p)<=Math.hypot(spacing*Math.SQRT2,Math.max(maxRise,maxDrop))+.015){
        for(const candidate of approach.contacts(node.p)){
          const x=snapHorizontal(candidate[0]),z=snapHorizontal(candidate[2]);
          const dx=x-node.p[0],dz=z-node.p[2],span=Math.hypot(dx,dz);
          if(span<EPS||Math.max(Math.abs(dx),Math.abs(dz))>spacing+.011)continue;
          const local=surface?null:query(bodyAt([x,node.p[1],z],size));
          const levels=surface?(surface.levels?.(x+size[0]/2,z+size[2]/2)??[surface.level(x+size[0]/2,z+size[2]/2,node.p[1])]):new Set(local.map(b=>b.max[1]));
          for(const y of levels){
            const end=[x,y,z],cost=node.g+(span+Math.abs(y-node.p[1]))*rate(node.p,end);
            if(!Number.isFinite(cost)||cost>=finishCost||!canFinish(end)||!standing(end,size,obstacles)||!approach.accepts(end))continue;
            const segment=transition(node.p,end,size,obstacles);
            if(segment){finishCost=cost;bestFinish={p:end,g:cost,parent:node,segment};}
          }
        }
      }
      if ((visited & 15) === 0) yield;
      for (const [dx,dz] of node===first?initialDirs:dirs) {
        const x=lattice(node.p[0],0,dx),z=lattice(node.p[2],2,dz);
        const local = query(bodyAt([x, node.p[1], z], size));
        const candidates = surface ? (surface.levels?.(x+size[0]/2,z+size[2]/2) ?? [surface.level(x+size[0]/2, z+size[2]/2,node.p[1])]) : [...new Set(local.map(b => b.max[1]))];
        const levels = candidates.filter(y => Number.isFinite(y) && y <= node.p[1] + maxRise + EPS && y >= node.p[1] - maxDrop - EPS);
        for (const y of levels) {
          const p = [x, y, z], k = key(p); if (closed.has(k)) continue;
          if (!stood.has(k)) stood.set(k, standing(p, size, obstacles)); if (!stood.get(k)) continue;
          const segment = transition(node.p, p, size, obstacles); if (!segment) continue;
          const g = node.g + (Math.hypot(x-node.p[0],z-node.p[2]) + Math.abs(y-node.p[1]))*rate(node.p,p);
          if (records.has(k) && records.get(k).g <= g + EPS) continue;
          const next = { p, g, f: g + heuristic(p), parent: node, segment }; records.set(k, next); heap.push(next);
        }
      }
    }
    if(bestFinish&&(!found||finishCost<found.g))found=bestFinish;
    if(!found){
      if(componentKey&&!heap.length)exhaustedComponents.set(spacing,{key:componentKey,members:closed});
      return {...fail(visited>=maxNodes?'路线搜索范围过大，请选择较近的落点':'没有可通行路线'),visited};
    }
    const segments = []; for (let n = found; n.parent; n = n.parent) segments.push(n.segment);
    const points = compress([start, ...segments.reverse().flat(),...(reaches.get(key(found.p))??[])]), costs = [0];
    for (let i = 1; i < points.length; i++) costs.push(costs.at(-1) + Math.hypot(...points[i].map((n, j) => n - points[i - 1][j])) * 5*rate(points[i-1],points[i]));
    return { valid: true, reason: '', points, costs, cost: costs.at(-1), visited };
  }
  function* findPath(start,target,options){
    const coarse=yield* search(start,target,options);
    // Only refine a failed graph search, down to the map's authored sampling scale.
    // A blocked endpoint is checked independently of the search lattice.
    const fine=surface?.resolution?1/surface.resolution:step;
    if(coarse.valid||fine>=step||(!coarse.visited&&!coarse.refine))return coarse;
    yield;
    return yield* search(start,target,options,fine);
  }
  function plan(...args) {
    const route = findPath(...args); let part;
    do { part = route.next(); } while (!part.done);
    return part.value;
  }
  async function planAsync(start, target, options, stale) {
    const route = findPath(start,target,options);
    while (!stale()) {
      const until = performance.now()+3;
      do {
        const part=route.next();
        if (part.done) return part.value;
      } while (performance.now()<until);
      await (globalThis.scheduler?.yield?.() ?? new Promise(resolve=>setTimeout(resolve,0)));
    }
    return null;
  }
  return { plan, planAsync, standing, transition, query };
}
