// Pure client-side snapping & geometry helpers matching Foundry VTT 13.351 + D&D5e 5.1.10.

/**
 * Snap a desired token center point to Foundry 13.351's valid grid destination center.
 * Matches desktop drag rounding: Math.round(topLeft) -> BaseToken.#getSnappedPositionInSquareGrid -> Math.round -> + center offset.
 *
 * @param {{x:number,y:number}} point Desired world center point
 * @param {{type?:number,size:number,ox?:number,oy?:number}} gridInfo Scene grid info
 * @param {{w:number,h:number,width?:number,height?:number,pivot?:{x:number,y:number}}} token Source token metrics
 * @returns {{x:number,y:number}} Snapped world center point
 */
export function snapMoveCenter(point, gridInfo, token) {
  const type = gridInfo?.type ?? 1;
  const s = Number(gridInfo?.size) || 100;
  const ox = Number(gridInfo?.ox) || 0;
  const oy = Number(gridInfo?.oy) || 0;
  const w = Number(token?.w) || s;
  const h = Number(token?.h) || s;
  const px = Number.isFinite(token?.pivot?.x) ? token.pivot.x : w / 2;
  const py = Number.isFinite(token?.pivot?.y) ? token.pivot.y : h / 2;
  const rawWidth = Number(token?.width) || (w / s);
  const rawHeight = Number(token?.height) || (h / s);
  const width = Math.round(rawWidth * 2) / 2;
  const height = Math.round(rawHeight * 2) / 2;
  const isSmall = (width === 0.5 && height <= 1) || (height === 0.5 && width <= 1);

  function snapAxis(center, pivot, units, originOffset) {
    const top = Math.round(center - pivot);
    if (type === 0) return top + pivot;
    if (type !== 1) return center;
    const rel = top - originOffset;
    let snapped;
    if (isSmall && units !== 1) {
      const i = Math.floor((rel / s) * 8);
      const k = ((i % 8) + 8) % 8;
      const cell = k >= 6 ? Math.ceil(i / 8)
        : k === 5 ? Math.floor(i / 8) + 0.5
        : Math.round(i / 2) / 4;
      snapped = cell * s;
    } else if (isSmall) {
      snapped = Math.round(rel / s) * s;
    } else if (Number.isInteger(units)) {
      // SquareGrid vertex snap (GRID_SNAPPING_MODES.VERTEX): matches Math.floor((x - s/2)/s + 0.5 + 0.5)?
      // Foundry SquareGrid#getSnappedPoint VERTEX: (Math.floor((x - s/2) / s) + 1) * s
      snapped = (Math.floor((rel - s / 2) / s) + 1) * s;
    } else {
      // SquareGrid VERTEX | EDGE_MIDPOINT | CENTER => nearest half-grid step
      snapped = Math.round(rel / (s / 2)) * (s / 2);
    }
    return Math.round(snapped + originOffset) + pivot;
  }

  return {
    x: snapAxis(point.x, px, width, ox),
    y: snapAxis(point.y, py, height, oy)
  };
}

/**
 * Normalize angle into [0, 360).
 */
export function normalizeAngle(deg) {
  const n = Number(deg) || 0;
  return ((n % 360) + 360) % 360;
}

/**
 * Compute immediate client-side snapped placement for an area template.
 * Matches Foundry 13.351 PlaceablesLayer#getSnappedPosition (VERTEX | EDGE_MIDPOINT | CENTER = half-grid)
 * and D&D5e 5.1.10 + Combat Panel self-origin rules.
 *
 * @param {object} spec Template specification from action/desktop
 * @param {{x:number,y:number,w:number,h:number}} caster Caster center & pixel size
 * @param {{x:number,y:number}} pointer World pointer coordinate
 * @param {number} aimDegrees Current aim angle in degrees
 * @param {{type?:number,size:number,ox?:number,oy?:number}} gridInfo Grid info
 * @returns {{x:number,y:number,direction:number}}
 */
export function snapTemplatePose(spec, caster, pointer, aimDegrees, gridInfo) {
  const type = gridInfo?.type ?? 1;
  const s = Number(gridInfo?.size) || 100;
  const ox = Number(gridInfo?.ox) || 0;
  const oy = Number(gridInfo?.oy) || 0;
  const half = s / 2;
  const snapAxis = (v, o) => (type === 1 ? Math.round((v - o) / half) * half + o : v);
  const docPoint = (x, y, useGrid) => ({
    x: Math.round(useGrid ? snapAxis(x, ox) : x),
    y: Math.round(useGrid ? snapAxis(y, oy) : y)
  });

  const cx = caster?.x ?? pointer.x;
  const cy = caster?.y ?? pointer.y;
  const hw = (Number(caster?.w) || s) / 2;
  const hh = (Number(caster?.h) || s) / 2;
  const a = normalizeAngle(aimDegrees);
  const rule = spec?.originRule || (spec?.anchored ? 'caster' : 'free');
  const t = spec?.t || (spec?.shape === 'square' ? 'rect' : spec?.shape === 'line' ? 'ray' : spec?.shape || 'circle');

  let pos;
  if (rule === 'casterCubeRect') {
    const side = Number(spec?.sidePx) || (Number(spec?.size) || 0) * s / (Number(gridInfo?.distance) || 5);
    const faces = [
      [cx + hw, cy - side / 2],
      [cx - side / 2, cy + hh],
      [cx - hw - side, cy - side / 2],
      [cx - side / 2, cy - hh - side]
    ];
    const face = Math.round(a / 90) % 4;
    pos = docPoint(faces[face][0], faces[face][1], true);
  } else if (rule === 'casterCubeRay') {
    const rad = a * Math.PI / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const offset = Math.abs(dx) * hw + Math.abs(dy) * hh;
    pos = docPoint(cx + dx * offset, cy + dy * offset, false);
  } else if (rule === 'caster') {
    pos = docPoint(cx, cy, false);
  } else {
    pos = docPoint(pointer.x, pointer.y, true);
  }

  return {
    x: pos.x,
    y: pos.y,
    direction: t === 'rect' ? 45 : a
  };
}

/**
 * Hit-test visible tokens in reverse draw order, honoring rendered interpolation centers.
 *
 * @param {{x:number,y:number}} world World point
 * @param {Array<{id:string,x:number,y:number,w:number,h:number}>} targets Visible tokens
 * @param {Map<string,{x:number,y:number}>|null} rendered Optional rendered positions
 * @returns {object|null} Topmost hit token
 */
export function hitTokenAt(world, targets, rendered = null) {
  if (!world || !Array.isArray(targets) || !targets.length) return null;
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    const pos = rendered?.get?.(t.id) || t;
    if (Math.abs(pos.x - world.x) <= t.w / 2 && Math.abs(pos.y - world.y) <= t.h / 2) {
      return t;
    }
  }
  return null;
}
