import { view3D, writeStyle } from './combat-space-2.js';
import { stormwreck3D, sceneDistanceUnits } from './stormwreck-view-1.js';
import { tokenVolume, footCorners, projectFeet } from './token-volume-2.js';
import { setMovementIcon, formatMovementNumber } from './movement-display-1.js';
import { wideLines } from './spatial-visuals-3.js';

const colors = {base: 0x37d9e5, hover: 0xffe078, selected: 0xffa05b};
const edges = [[0,1], [1,2], [2,3], [3,0]];
let state, frame = 0, terrainRevision = 0;

function makeBadge(id) {
  const badge = document.createElement('div');
  badge.className = 'mcb-token-feet';
  badge.dataset.tokenId = id;
  badge.hidden = true;
  const elevation = document.createElement('span');
  const icon = document.createElement('span');
  icon.className = 'mcb-movement-icon';
  badge.append(elevation, icon);
  document.body.append(badge);
  return {badge, icon, elevation};
}

function tokenEdges(volume, lift, highlight, base, locks) {
  const corners = footCorners(volume.bounds, lift);
  const color = colors[highlight ?? 'base'];
  const segments = highlight ? locks : base;
  for (const [i,j] of edges) segments.push({a:corners[i], b:corners[j], color});
  if (!highlight) return;
  const top = corners.map(([x,,z]) => [x,volume.bounds.max[1],z]);
  for (const [i,j] of edges) segments.push({a:top[i], b:top[j], color});
  for (let i = 0; i < corners.length; i++) segments.push({a:corners[i], b:top[i], color});
}

function draw(state, view, highlights, now) {
  const {engine, rect} = view;
  const {badges, footprint, wireframe} = state;
  const live = new Set(), feet = new Map(), next = [];
  const camera = [view.revision, rect.left, rect.top, rect.width, rect.height, terrainRevision].join('/');
  for (const token of canvas.tokens.placeables) {
    const volume = engine.scene.visible && tokenVolume(token, engine);
    if (!volume) continue;
    const highlight = highlights.get(token.id);
    const stamp = [...volume.bounds.min, ...volume.bounds.max].join('/');
    next.push({volume, highlight, stamp});
    live.add(token.id);
    let entry = badges.get(token.id);
    if (!entry) badges.set(token.id, entry = makeBadge(token.id));
    const projectionKey = `${camera}/${stamp}`;
    if (entry.key !== projectionKey || now - entry.projectedAt > 160) {
      entry.key = projectionKey;
      entry.projectedAt = now;
      entry.feet = projectFeet(volume, view);
    }
    if (entry.feet?.bottom) feet.set(token.id, entry.feet.bottom);
    const anchor = entry.feet?.left;
    entry.badge.hidden = !anchor;
    if (!anchor) continue;
    writeStyle(entry.badge, 'left', `${(anchor.x - 4).toFixed(2)}px`);
    writeStyle(entry.badge, 'top', `${(anchor.y + 5).toFixed(2)}px`);
    const elevation = `${formatMovementNumber(token.document.elevation)} ${sceneDistanceUnits()}`;
    if (entry.elevation.textContent !== elevation) entry.elevation.textContent = elevation;
    setMovementIcon(entry.icon, token.document.movementAction);
  }
  for (const [id, entry] of badges) if (!live.has(id)) {
    entry.badge.remove();
    badges.delete(id);
  }
  const signature = next.map(({volume, highlight, stamp}) => `${volume.token.id}/${highlight ?? ''}/${stamp}`).join('|');
  if (state.signature !== signature) {
    const base = [], locks = [];
    const lift = canvas.grid.size / engine.factor * .018;
    for (const {volume, highlight} of next) tokenEdges(volume, lift, highlight, base, locks);
    footprint.update(base);
    wireframe.update(locks);
    state.signature = signature;
  }
  return feet;
}

export function installTokenHUD({highlights, drawPredictions, resetPredictions}) {
  function release() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!state) return;
    for (const entry of state.badges.values()) entry.badge.remove();
    state.footprint.destroy();
    state.wireframe.destroy();
    state = null;
    document.body.classList.remove('mcb-stormwreck-3d');
    resetPredictions();
  }
  function tick(now) {
    frame = 0;
    if (!stormwreck3D() || state?.scene !== game.Levels3DPreview.scene) { release(); return; }
    const view = view3D();
    if (view) drawPredictions(draw(state, view, highlights(), now));
    frame = requestAnimationFrame(tick);
  }
  function mount() {
    if (!stormwreck3D() || !game.Levels3DPreview._ready) return;
    const {scene, THREE} = game.Levels3DPreview;
    if (scene === state?.scene) return;
    release();
    const footprint = wideLines(THREE, colors.base, () => 2.25, true);
    const wireframe = wideLines(THREE, colors.selected, () => 3.5, true);
    footprint.mesh.name = 'mcb-token-footprints';
    wireframe.mesh.name = 'mcb-token-locks';
    footprint.mesh.visible = wireframe.mesh.visible = false;
    scene.add(footprint.mesh, wireframe.mesh);
    state = {scene, footprint, wireframe, badges: new Map()};
    document.body.classList.add('mcb-stormwreck-3d');
    frame = requestAnimationFrame(tick);
  }
  for (const hook of ['sightRefresh', 'updateWall', 'updateTile', 'createTile', 'deleteTile']) {
    Hooks.on(hook, () => { terrainRevision++; });
  }
  Hooks.on('3DCanvasSceneReady', mount);
  Hooks.on('canvasReady', () => setTimeout(mount, 0));
  Hooks.on('canvasTearDown', release);
  Hooks.on('3DCanvasToggleMode', on => on === false ? release() : setTimeout(mount, 0));
}
