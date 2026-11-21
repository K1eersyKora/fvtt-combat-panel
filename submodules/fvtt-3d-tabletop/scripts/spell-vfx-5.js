import {ID, active3D, castFlag, legacyDefault} from './scene-view-1.js';
import {playFlat as play, clearFlat, flatStatus, syncFlatImpact, warmSpells} from './flat-effects-2.js';
import {installSequencerProjection, clearSequencerProjection, nativeAnimationClaimed, sequencerStatus} from './sequencer-effects-4.js';
import {concentrationArea, areaTemplate} from './concentration-area-1.js';
import {usesWitchBoltSequence} from './witch-bolt-2.js';

const plots = new WeakMap();
const initiated = new Set();
const impactHistory = new Set();
const timers = new Set();
let installed = false;

function active() {
  return active3D() && game.settings.get(ID, 'spellVfx');
}

function documentOf(uuid) {
  if (typeof uuid !== 'string') return uuid?.document ?? uuid;
  return fromUuidSync(uuid);
}

function tokenWorld(uuid) {
  const doc = documentOf(uuid);
  const engine = game.Levels3DPreview;
  const token = engine?.tokens[doc?.id];
  if (!token) return null;
  const point = token.mesh.getWorldPosition(new engine.THREE.Vector3());
  point.y += token.d * 0.7;
  return {x: point.x * engine.factor, y: point.z * engine.factor, elevation: point.y * engine.factor / canvas.grid.size * canvas.grid.distance};
}

function templateDoc(value) {
  try {
    const doc = documentOf(value);
    return doc?.documentName === 'MeasuredTemplate' ? doc : null;
  } catch {
    return null;
  }
}

export async function templateReady(doc, timeout = 2500) {
  const scene = doc.parent?.id;
  const start = performance.now();
  while (active3D() && canvas.scene.id === scene && performance.now() - start < timeout) {
    if (!canvas.scene.templates.has(doc.id)) return null;
    const entity = game.Levels3DPreview.templates[doc.id];
    if (entity?._effectOrigin && entity.mesh) return entity;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return null;
}

function publish(data) {
  if (play(data)) game.socket.emit(`module.${ID}`, {type: 'spell', ...data});
}

function signalImpact(id, scene) {
  syncFlatImpact(id, scene);
  game.socket.emit(`module.${ID}`, {type: 'spell-impact', id, scene});
}

function bounded(set, key) {
  if (set.has(key)) return false;
  set.add(key);
  if (set.size > 500) set.delete(set.values().next().value);
  return true;
}

function publishUnmapped({id, item, source, template, roll, run}) {
  if (!bounded(initiated, id)) return;
  const start = performance.now();
  const scene = canvas.scene.id;
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (!active() || canvas.scene.id !== scene || nativeAnimationClaimed(item, source, template, start, roll)) return;
    void run().catch(error => console.error(`${ID} animation fallback`, error));
  }, game.modules.get('autoanimations')?.active ? 220 : 0);
  timers.add(timer);
}

const activityDamage = activity => Array.from(activity?.damage?.parts?.[0]?.types ?? [])[0] ?? 'force';

function areaFX(template, cast, activity, item = activity?.item, allowMissing = false) {
  if (!cast?.id || cast.user !== game.user.id || !active()) return;
  if (concentrationArea(item, activity) || areaTemplate(template)) return;
  const point = castFlag(template, 'area') ?? cast.point;
  const source = documentOf(cast.source);
  if (!point || !source) return;
  const scene = canvas.scene.id;
  const id = 'mcb-area-' + cast.id;
  publishUnmapped({id, item, source, template, run: async () => {
    if (template && !allowMissing && !await templateReady(template)) return;
    if (!active() || canvas.scene.id !== scene) return;
    const from = tokenWorld(source);
    if (!from) return;
    const type = template?.t ?? activity?.target?.template?.type;
    const shape = type === 'circle' && point.special > 0 ? 'cylinder' : ({sphere: 'circle', radius: 'circle', cube: 'rect', line: 'ray'}[type] ?? type);
    publish({
      kind: 'area', followRoll: true, sourceId: source.id, id, scene, from, damage: activityDamage(activity), shape,
      to: {x: point.x, y: point.y, elevation: point.elevation}, radius: shape === 'rect' ? (template?.width || point.distance / Math.SQRT2) : point.distance,
      width: template?.width ?? activity?.target?.template?.width ?? 5, height: point.special || 5, angle: template?.angle ?? 53.130102,
      direction: point.direction, tilt: point.tilt
    });
    if (impactHistory.has(id)) signalImpact(id, scene);
  }});
}

function castIdentity(w, roll) {
  if (!plots.has(w)) plots.set(w, {base: 'mcb-roll-' + foundry.utils.randomID(), rolls: new WeakMap()});
  const ids = plots.get(w);
  if (!roll || typeof roll !== 'object') return ids.base;
  if (!ids.rolls.has(roll)) ids.rolls.set(roll, ids.base + '-' + foundry.utils.randomID());
  return ids.rolls.get(roll);
}

function workflowFX(w, settling = false) {
  if (!active() || w.aborted || !w.item || (w.userId && w.userId !== game.user.id)) return;
  const activity = w.activity ?? w.item.system.activities.contents[0];
  if (concentrationArea(w.item, activity)) return;
  if (!activity || !['attack', 'save', 'damage', 'heal'].includes(activity.type) || activity.description?.chatFlavor?.includes('[noaa]')) return;
  if (usesWitchBoltSequence(w)) return;
  const cast = w.workflowOptions?.mcbCast;
  const template = templateDoc(w.templateUuid);
  const area = castFlag(template, 'area') ?? cast?.point ?? (template && {
    x: template.x, y: template.y, elevation: template.elevation ?? 0, distance: template.distance, direction: template.direction
  });
  if (activity.target?.template?.type && !area) return;
  const source = documentOf(w.token ?? cast?.source);
  if (!source) return;
  if (area) {
    const context = cast ?? castFlag(template, 'cast') ?? {id: template.uuid, user: game.user.id, source: source.uuid, point: area};
    areaFX(template, context, activity, w.item, true);
    const id = 'mcb-area-' + context.id;
    if (settling && bounded(impactHistory, id)) signalImpact(id, canvas.scene.id);
    return;
  }
  if (activity.type === 'attack' && !w.attackRoll) return;
  const roll = w.attackRoll ?? w.damageRoll;
  const id = castIdentity(w, roll);
  const scene = canvas.scene.id;
  const targets = Array.from(w.targets ?? []).map(documentOf).filter(Boolean);
  publishUnmapped({id, item: w.item, source, roll, run: async () => {
    const from = tokenWorld(source);
    if (!from) return;
    const damage = activityDamage(activity);
    const kind = activity.attack?.type?.value === 'melee' ? 'melee' : w.item.type === 'weapon' ? 'ranged' : 'spell';
    const video = w.item.flags?.autoanimations?.primary?.video;
    const clip = video?.enableCustom && typeof video.customPath === 'string'
      && /^(modules|worlds)\/(?!.*\.\.)(?:[^?#:]+)\.(webm|mp4)$/i.test(video.customPath) ? video.customPath : undefined;
    for (const target of targets) {
      const to = tokenWorld(target);
      if (to) publish({id: id + ':' + target.id, scene, kind, clip, sourceId: source.id, targetId: target.id, from, to, damage, radius: 1.4, shape: null});
    }
  }});
}

function mount() {
  if (installed || !game.Levels3DPreview?.particleSystem) return;
  libWrapper.register(ID, 'game.Levels3DPreview.particleSystem.constructor.prototype.effect', async function (wrapped, from, to, params) {
    if (!active3D()) return wrapped(from, to, params);
    const targets = Array.isArray(to) ? to : [to];
    const docs = targets.map(templateDoc).filter(Boolean);
    if (docs.length && active() && docs.every(doc => castFlag(doc, 'cast'))) return;
    for (const doc of docs) if (!await templateReady(doc)) return;
    return wrapped(from, to, params);
  }, 'MIXED');
  installed = true;
}

function clear() {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  initiated.clear();
  impactHistory.clear();
  clearFlat();
  clearSequencerProjection();
}

export function spellVfxStatus() {
  const generic = flatStatus();
  const provider = sequencerStatus();
  return {
    installed, running: generic.running + provider.running,
    records: [...generic.records, ...provider.records], projection: [...generic.projection, ...provider.projection],
    sequencer: provider
  };
}

export function installSpellVfx() {
  installSequencerProjection();
  Hooks.once('init', () => game.settings.register(ID, 'spellVfx', {
    name: '3D施法动画', hint: '在三维场景显示武器和法术的二维动画。',
    scope: 'world', config: true, type: Boolean, default: legacyDefault('spellVfx', 'world'), onChange: value => {if (!value) clear();}
  }));
  Hooks.on('ready', () => {
    game.socket.on(`module.${ID}`, data => {
      if (!active()) return;
      if (data?.type === 'spell') play(data);
      else if (data?.type === 'spell-impact') syncFlatImpact(data.id, data.scene);
    });
    mount();
  });
  Hooks.on('3DCanvasReady', mount);
  Hooks.on('3DCanvasSceneReady', () => {mount(); warmSpells();});
  Hooks.on('createMeasuredTemplate', doc => {
    const cast = castFlag(doc, 'cast');
    if (cast?.user === game.user.id) areaFX(doc, cast, documentOf(cast.origin));
  });
  Hooks.on('midi-qol.AttackRollComplete', w => workflowFX(w));
  for (const hook of ['preCheckSaves', 'DamageRollComplete', 'postCheckSaves', 'RollComplete']) Hooks.on('midi-qol.' + hook, w => workflowFX(w, true));
  Hooks.on('canvasTearDown', clear);
  Hooks.on('3DCanvasToggleMode', on => {if (!on) clear();});
}
