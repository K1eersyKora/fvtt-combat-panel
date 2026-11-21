import { kitProp, poseKitDoor } from './kit-model-3.js';
import { entriesOf, meshCells } from './shapes-core-3.js';
const colors = new Map();
function color(T, hex, own = false) { if (!colors.has(hex)) colors.set(hex, new T.MeshStandardMaterial({ color: hex, roughness: .9, side: T.DoubleSide })); return own ? colors.get(hex).clone() : colors.get(hex); }
function part(T, group, geometry, material, position, own = false) { const mesh = new T.Mesh(geometry, material); mesh.position.set(...position); if (own) mesh.dispose = () => material.dispose(); group.add(mesh); return mesh; }
function box(T, group, size, position, material, own = false) { return part(T, group, new T.BoxGeometry(...size), material, position, own); }
function prop(T, entry, origin) {
  const root = new T.Group(), shape = entry.def.shape;
  if (shape === 'mushroom') {
    for (const [x, z, stem, radius] of [[.5, .55, .21, .16], [.25, .3, .12, .1], [.76, .28, .1, .09]]) {
      part(T, root, new T.CylinderGeometry(.022, .03, stem, 7), color(T, '#ded3ac'), [x, stem / 2, z]);
      part(T, root, new T.SphereGeometry(radius, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), color(T, '#b94a43'), [x, stem, z]);
      for (const [dx, dz] of [[-.035, -.03], [.04, .025]]) part(T, root, new T.SphereGeometry(radius * .15, 5, 4), color(T, '#eee1c5'), [x + dx, stem + radius * .88, z + dz]);
    }
  } else if (shape === 'flower') {
    for (const [x, z, height, tint] of [[.5, .55, .36, '#e5b642'], [.25, .3, .25, '#c77f9a'], [.76, .3, .28, '#dcce8f']]) {
      part(T, root, new T.CylinderGeometry(.012, .018, height, 5), color(T, '#5d7c44'), [x, height / 2, z]);
      const leaf = part(T, root, new T.SphereGeometry(.055, 5, 4), color(T, '#5b8541'), [x + .035, height * .45, z]); leaf.scale.set(1.4, .22, .6); leaf.rotation.z = -.4;
      for (let n = 0; n < 5; n++) { const a = n * Math.PI * 2 / 5, petal = part(T, root, new T.SphereGeometry(.048, 6, 4), color(T, tint), [x + Math.cos(a) * .052, height, z + Math.sin(a) * .052]); petal.scale.y = .3; }
      part(T, root, new T.SphereGeometry(.03, 6, 4), color(T, '#87632e'), [x, height + .01, z]);
    }
  } else if (shape === 'pebbles') {
    for (const [x, z, sx, sy, sz] of [[.35, .4, .14, .07, .1], [.67, .6, .1, .05, .12], [.65, .28, .065, .04, .055], [.22, .7, .07, .035, .045]]) { const rock = part(T, root, new T.IcosahedronGeometry(1, 0), color(T, '#9b9889'), [x, sy, z]); rock.scale.set(sx, sy, sz); rock.geometry.computeBoundingBox(); rock.position.y = -rock.geometry.boundingBox.min.y * sy; }
  } else if (shape === 'door') {
    for (const x of [.04, .96]) box(T, root, [.08, 2, .16], [x, 1, .08], color(T, '#675038', true), true);
    box(T, root, [1, .1, .16], [.5, 1.95, .08], color(T, '#675038', true), true);
    const hinge = new T.Group(); hinge.name = 'mcb-door-pivot'; hinge.position.set(.08, 0, .08); root.add(hinge);
    box(T, hinge, [.84, 1.85, .075], [.42, .95, 0], color(T, '#a47a43', true), true);
    for (const x of [.14, .42, .7]) box(T, hinge, [.012, 1.81, .082], [x, .95, 0], color(T, '#725838', true), true);
    for (const y of [.35, 1.5]) box(T, hinge, [.76, .065, .095], [.42, y, 0], color(T, '#5b5548', true), true);
    part(T, hinge, new T.SphereGeometry(.035, 6, 5), color(T, '#c5ad68', true), [.72, .95, -.065], true);
  }
  const orient = new T.Group(); orient.position.set(.5, 0, .5); root.position.set(-.5, 0, -.5); orient.add(root); orient.rotation.y = entry.def.rotation * Math.PI / 2;
  const placement = new T.Group(); placement.position.set(...entry.local); placement.add(orient);
  const worldCell = entry.local.map((v, a) => v + origin[a] * 8);
  placement.traverse(o => { o.userData.mcbAnchor = worldCell; o.userData.mcbKind = entry.def.kind; });
  return placement;
}
export function createModel(T, cells, kind, origin, material) {
  const model = new T.Group(), entries = entriesOf(cells), stats = { count: entries.length, triangles: 0, quads: 0 };
  if (['decor', 'door'].includes(kind)) for (const entry of entries) model.add(entry.def.kit ? kitProp(T, entry, origin) : prop(T, entry, origin));
  else {
    for (const entry of entries.filter(e=>e.def.kit)) model.add(kitProp(T, entry, origin));
    const mesh = meshCells(cells); Object.assign(stats, { triangles: mesh.triangles, quads: mesh.quads });
    for (const g of mesh.groups) { const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(g.positions, 3)); geometry.setAttribute('normal', new T.Float32BufferAttribute(g.normals, 3)); geometry.setAttribute('uv', new T.Float32BufferAttribute(g.uvs, 2)); geometry.setIndex(g.indices); model.add(new T.Mesh(geometry, material(T, g.material, g.face))); }
  }
  model.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(model);
  if (bounds.isEmpty()) return { model, bounds: null, stats };
  stats.triangles = 0; model.traverse(o => { if (o.isMesh) stats.triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; });
  return { model, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new T.Vector3()).toArray() }, stats };
}
export function disposeModel(model) { model.traverse(o => { if (o.isMesh) { o.dispose?.(); o.geometry?.dispose(); } }); }
export function applyDoorPose(tile3d) {
  const visual = tile3d.mesh?.children[0], hinge = visual?.getObjectByName('mcb-door-pivot');
  const open = Number(tile3d.document.getFlag('levels-3d-preview', 'doorState')) === 1;
  if (hinge) hinge.rotation.y = open ? -Math.PI / 2 : 0;
  if (!hinge && !poseKitDoor(visual, open)) return;
  visual.traverse(o => { if (o.isMesh) { o.material.opacity = 1; o.material.transparent = false; o.material.depthWrite = true; o.material.needsUpdate = true; } });
  tile3d.mesh.updateMatrixWorld(true);
  tile3d.draggable = false; tile3d.mesh.userData.draggable = false;
}
