import { active3D, rayAt, screenPoint } from './combat-space-2.js';
import { stormwreck3D } from './stormwreck-view-1.js';

// A real volume is intentional: transparent token portraits and gaps between model
// triangles are still part of the token's occupied space.
export function rayBoxDistance(origin, direction, min, max) {
  let near = 0, far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-12) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
      continue;
    }
    let a = (min[axis] - origin[axis]) / direction[axis];
    let b = (max[axis] - origin[axis]) / direction[axis];
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a); far = Math.min(far, b);
    if (far < near) return null;
  }
  return Number.isFinite(near) ? near : null;
}

export function selectionBounds({ center, width, depth, height }) {
  if (![...center, width, depth, height].every(Number.isFinite) || Math.min(width, depth, height) <= 0) return null;
  return { min: [center[0] - width / 2, center[1], center[2] - depth / 2],
    max: [center[0] + width / 2, center[1] + height, center[2] + depth / 2] };
}

export function tokenVolume(token, engine) {
  const entity = engine.tokens[token?.id];
  if (!token || token.destroyed || !token.visible || !entity?.mesh?.visible
    || (!game.user.isGM && (token.document.hidden || token.isVisible === false))) return null;
  const unit = canvas.grid.size / engine.factor;
  const center = entity.mesh.getWorldPosition(new engine.THREE.Vector3()).toArray();
  const width = Number(token.document.width) * unit, depth = Number(token.document.height) * unit;
  const height = Math.max(Number(entity.d) || 0, width, depth);
  const bounds = selectionBounds({ center, width, depth, height });
  return bounds && {token, entity, center, bounds};
}

function terrainSurfaces(view) {
  if (view.tokenBlockers) return view.tokenBlockers;
  const {engine} = view;
  const surfaces = Object.values(engine.tiles ?? {}).filter(t => t.mesh?.visible && (t.sight ?? t.collision)).map(t => t.mesh);
  surfaces.push(...Object.values(engine.walls ?? {}).filter(w => w.mesh?.visible).map(w => w.mesh));
  if (stormwreck3D()) {
    const doors = engine.scene.getObjectByName('Stormwreck interactive doors');
    if (doors?.visible) surfaces.push(doors);
  }
  if (engine.board?.visible) surfaces.push(engine.board);
  for (const mesh of surfaces) mesh.updateWorldMatrix(true, true);
  return view.tokenBlockers = surfaces;
}

function terrainHit(ray, view) {
  const masked = stormwreck3D();
  return ray.intersectObjects(terrainSurfaces(view), true).find(hit => {
    const object = hit.object;
    if (object.userData?.noIntersect || object.userData?.ignoreIntersect) return false;
    if (masked) for (let node = object; node; node = node.parent) {
      if (!node.visible || node.userData?.noIntersect || node.userData?.ignoreIntersect) return false;
    }
    return view.engine.interactionManager._clippingFilter?.(hit) ?? true;
  }) ?? null;
}

export function footCorners({min, max}, lift = 0) {
  const y = min[1] + lift;
  return [[min[0], y, min[2]], [max[0], y, min[2]], [max[0], y, max[2]], [min[0], y, max[2]]];
}

export function projectFeet(volume, view) {
  const {engine, rect} = view;
  const lift = canvas.grid.size / engine.factor * .018;
  const corners = footCorners(volume.bounds, lift).map(p => new engine.THREE.Vector3(...p));
  const points = corners.map(p => screenPoint(p, view));
  if (points.some(p => !p)) return null;
  const left = points.reduce((min, p, i) => p.x < points[min].x || (p.x === points[min].x && p.y > points[min].y) ? i : min, 0);
  const bottom = points.reduce((max, p, i) => p.y > points[max].y ? i : max, 0);
  const a = (bottom + 3) % 4, b = (bottom + 1) % 4;
  const neighbor = points[a].y > points[b].y ? a : b;
  const edgeCenter = corners[bottom].clone().lerp(corners[neighbor], .5);

  // HTML overlays cannot use the 3D depth buffer. Test their world anchors with
  // the same terrain ray and clipping rules used by pointer targeting.
  function unobstructed(point) {
    const screen = screenPoint(point, view);
    if (!screen || screen.x < rect.left || screen.x > rect.right || screen.y < rect.top || screen.y > rect.bottom) return null;
    const query = rayAt(screen.x, screen.y);
    if (!query) return null;
    const limit = point.distanceTo(query.ray.ray.origin) - lift * .25;
    if (limit <= 0) return null;
    const far = query.ray.far;
    query.ray.far = limit;
    try { return terrainHit(query.ray, view) ? null : screen; }
    finally { query.ray.far = far; }
  }
  const leftPoint = unobstructed(corners[left]);
  const bottomPoint = unobstructed(edgeCenter);
  return {left: leftPoint, bottom: bottomPoint && {x: bottomPoint.x, y: points[bottom].y}};
}

export function pickTokenVolumeHit(clientX, clientY, { ownedOnly = false } = {}) {
  if (!active3D()) return null;
  const query = rayAt(clientX, clientY); if (!query) return null;
  const { ray, view } = query, e = view.engine;
  if (stormwreck3D() && !e.scene.visible) return null;
  const origin = ray.ray.origin.toArray(), direction = ray.ray.direction.toArray();
  let nearest = null;
  for (const token of canvas.tokens.placeables) {
    if (!token.actor || (ownedOnly && !token.isOwner)) continue;
    const volume = tokenVolume(token, e);
    if (!volume) continue;
    const {bounds, entity} = volume;
    const distance = rayBoxDistance(origin, direction, bounds.min, bounds.max);
    if (distance === null || (nearest && distance >= nearest.distance)) continue;
    const point = ray.ray.at(distance, new e.THREE.Vector3());
    const hit = { object: entity.mesh, point, distance };
    if (e.interactionManager._clippingFilter && !e.interactionManager._clippingFilter(hit)) continue;
    nearest = {...volume, point, distance};
  }
  if (!nearest) return null;
  const blocker = terrainHit(ray, view);
  return blocker && blocker.distance + 1e-5 < nearest.distance ? null : nearest;
}

export function pickTokenVolume(x, y, options) { return pickTokenVolumeHit(x, y, options)?.token ?? null; }

let binding;
export function installTokenVolume(adapter = {}) {
  function release() {
    if (binding && binding.manager.findMouseIntersect === binding.wrapper) binding.manager.findMouseIntersect = binding.original;
    binding = null;
  }
  function bind() {
    const manager = game.Levels3DPreview?.interactionManager;
    if (binding?.manager === manager) return;
    release(); if (!manager?.findMouseIntersect) return;
    const original = manager.findMouseIntersect;
    function wrapper(event) {
      if (!active3D() || !canvas.tokens?.active || adapter.isEditing?.() || ui.controls?.isRuler || this.draggable) return original.call(this, event);
      const hit = pickTokenVolumeHit(event.clientX, event.clientY);
      if (hit) {
        const group = game.Levels3DPreview.controlledGroup;
        const object = hit.entity.mesh.parent === group ? group : hit.entity.mesh;
        return { object, point: hit.point, originalObject: hit.entity.mesh,
          intersectData: { object: hit.entity.mesh, point: hit.point, distance: hit.distance } };
      }
      const result = original.call(this, event);
      // The engine prefers a token behind a wall over its nearest intersection.
      // Keep that fallback from defeating the visibility check above.
      if (result?.object?.userData?.entity3D?.token) {
        const q = rayAt(event.clientX, event.clientY), terrain = q && terrainHit(q.ray, q.view);
        if (!terrain) return null;
        let object = terrain.object;
        for (let node = object; node; node = node.parent) if (node.userData?.entity3D) { object = node; break; }
        return { object, point: terrain.point, originalObject: terrain.object, intersectData: terrain };
      }
      return result;
    }
    manager.findMouseIntersect = wrapper;
    binding = { manager, original, wrapper };
  }
  for (const event of ['ready', 'canvasReady', '3DCanvasSceneReady']) Hooks.on(event, () => setTimeout(bind, 0));
  Hooks.on('canvasTearDown', release);
  Hooks.on('3DCanvasToggleMode', value => value === false ? release() : setTimeout(bind, 0));
  return { bind, release };
}
