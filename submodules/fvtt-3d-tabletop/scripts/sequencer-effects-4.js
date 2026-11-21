import {ID, active3D, castFlag, screenPoint, worldPoint} from './scene-view-1.js';
import {restoreMissingSounds} from './av-sound-fallbacks-2.js';
import {installWitchBolt} from './witch-bolt-2.js';
import {setVideoPlaybackRate} from './animation-rate-1.js';
import {areaTemplate, areaVisualSource} from './concentration-area-1.js';

const overlays = new Map();
const claims = new Map();
const claimedRolls = new WeakSet();
const history = [];
let layer;
let frame;

const scope = () => active3D() && game.settings.get(ID, 'spellVfx');
const configuredMap = () => canvas?.scene?.getFlag('fvtt-seagrow-caves', 'map') && game.settings.get(ID, 'spellVfx');
const compatibleScene = () => scope() || configuredMap();
const doc = value => value?.document ?? value;
const validNumber = n => Number.isFinite(n);

function remember(event) {
  history.push(event);
  if (history.length > 96) history.shift();
  Hooks.callAll('mcBuilderSpellVFX', event);
}

function pruneClaims(now) {
  for (const [id, stamp] of claims) if (now - stamp > 4000) claims.delete(id);
}

function claim(item, source, template) {
  const now = performance.now();
  pruneClaims(now);
  if (template?.id) claims.set('template:' + template.id, now);
  if (item?.id && source?.id) claims.set(source.id + ':' + item.id, now);
}

export function nativeAnimationClaimed(item, source, template, started, roll) {
  if (roll && claimedRolls.has(roll)) return true;
  const now = performance.now();
  pruneClaims(now);
  const id = template?.id ? 'template:' + template.id : source?.id + ':' + item?.id;
  const stamp = claims.get(id);
  return stamp != null && stamp >= started - 180;
}

function claimAA(handler, data) {
  if (!compatibleScene()) return;
  const item = handler.systemData.item ?? handler.item;
  const source = doc(handler.sourceToken);
  const template = doc(handler.templateData);
  // Keep the provider's 2D sequence, which includes independent sound events.
  // Its optional Levels 3D particle branch exits before those sections are built.
  if (scope() && data.levels3d?.type) delete data.levels3d.type;
  if (data.advanced?.excludedType?.enabled) return;
  restoreMissingSounds(data);
  if (active3D() && areaVisualSource(item) && data.primary?.sound?.enable && data.primary.sound.file) {
    data.soundOnly = {sound: data.primary.sound};
  }
  const roll = handler.systemData.rollAttackHook?.roll ?? handler.systemData.rollDamageHook?.roll;
  if (roll && typeof roll === 'object') claimedRolls.add(roll);
  claim(item, source, template);
  const cpr = item?.flags?.['chris-premades'];
  if (item?.system?.identifier !== 'eldritch-blast' || cpr?.info?.identifier !== 'eldritchBlast'
    || !roll || !cpr.macros?.midi?.item?.includes('eldritchBlast')) return;
  const configuration = cpr.config ?? {};
  const color = configuration.color ?? cpr.eldritchBlast?.color ?? 'purple';
  if (configuration.playAnimation === false || cpr.eldritchBlast?.playAnimation === false
    || !Sequencer.Database.entryExists('jb2a.eldritch_blast.' + color)) return;
  // The CPR beam owns the video. Its original card disables CPR's sound,
  // so the same AutoRec entry may supply the separately configured audio.
  if (!(configuration.sound || cpr.eldritchBlast?.sound) && data.primary?.sound?.enable && data.primary.sound.file) {
    data.soundOnly = {sound: data.primary.sound};
  }
}

function suppressProviderDuplicates(input, mapping) {
  const item = input.item;
  if (active3D() && (areaVisualSource(item) || areaTemplate(doc(input.templateData)))) {
    if (!(mapping?.soundOnly?.sound?.enable && mapping.soundOnly.sound.file)
      && !(mapping?.primary?.sound?.enable && mapping.primary.sound.file && areaVisualSource(item))) input.stopWorkflow = true;
    return;
  }
  if (!compatibleScene()) return;
  if (!input.useItemHook || item?.system?.identifier !== 'eldritch-blast'
    || item.flags?.['chris-premades']?.info?.identifier !== 'eldritchBlast') return;
  input.stopWorkflow = true;
}

function animationPicture(path) {
  if (typeof path !== 'string' || !/\.(?:webm|mp4|png|webp)(?:[?#].*)?$/i.test(path)) return null;
  const url = new URL(path, document.baseURI);
  return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
}

function asToken(value) {
  return value?.documentName === 'Token' && value.parent?.id === canvas.scene.id ? value : null;
}

function asTemplate(value) {
  return value?.documentName === 'MeasuredTemplate' && value.parent?.id === canvas.scene.id ? value : null;
}

function templatePoint(template) {
  const area = castFlag(template, 'area') ?? {};
  return {
    x: area.x ?? template.x,
    y: area.y ?? template.y,
    elevation: area.elevation ?? template.elevation ?? 0,
    direction: area.direction ?? template.direction ?? 0,
    tilt: area.tilt ?? template.flags?.['levels-3d-preview']?.tilt ?? 0,
    distance: area.distance ?? template.distance
  };
}

function nearbyTemplate(point, effect) {
  if (!point || effect.data.moduleName !== 'Automated Animations') return null;
  const candidates = [...canvas.scene.templates].filter(template => {
    const to = templatePoint(template);
    return Math.hypot(point.x - to.x, point.y - to.y) < 1
      && (point.elevation == null || Math.abs(to.elevation - point.elevation) < 0.1);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function pointFor(value, position, effect, {allowTemplate = true} = {}) {
  const engine = game.Levels3DPreview;
  const token = asToken(value);
  if (token) {
    const entity = engine.tokens[token.id];
    if (!entity?.mesh || (!game.user.isGM && (token.hidden || !token.object?.visible))) return null;
    const point = entity.mesh.getWorldPosition(new engine.THREE.Vector3());
    point.y += entity.d * 0.6;
    return {point, token};
  }
  const location = validNumber(position?.x) && validNumber(position?.y) ? position : value;
  const template = allowTemplate && (asTemplate(value) ?? nearbyTemplate(location, effect));
  if (template) {
    const area = templatePoint(template);
    return {point: worldPoint(area), template, area};
  }
  if (!validNumber(location?.x) || !validNumber(location?.y)) return null;
  return {point: worldPoint({x: location.x, y: location.y, elevation: value?.elevation ?? location?.elevation ?? 0})};
}

function areaEnd(area) {
  const radius = area.distance * canvas.grid.size / canvas.grid.distance;
  const direction = area.direction * Math.PI / 180;
  const tilt = area.tilt * Math.PI / 180;
  return screenPoint(worldPoint({
    x: area.x + radius * Math.cos(tilt) * Math.cos(direction),
    y: area.y + radius * Math.cos(tilt) * Math.sin(direction),
    elevation: area.elevation + area.distance * Math.sin(tilt)
  }));
}

function screenScale(point, at) {
  const {camera, THREE, factor} = game.Levels3DPreview;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const edge = screenPoint(point.clone().addScaledVector(right, canvas.grid.size / factor));
  return edge ? Math.hypot(edge.x - at.x, edge.y - at.y) / canvas.grid.size : null;
}

function around(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {dx, dy, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx)};
}

function stretch(effect, start, end, media, scale) {
  const line = around(start, end);
  const ratio = (media.videoWidth || media.naturalWidth) / (media.videoHeight || media.naturalHeight);
  const contentWidth = media.videoWidth || media.naturalWidth;
  const head = effect.template?.startPoint ?? 0;
  const tail = effect.template?.endPoint ?? 0;
  const usable = contentWidth - head - tail;
  if (!(line.length > 0 && ratio > 0 && usable > 0)) return null;
  const width = line.length * contentWidth / usable;
  const height = effect.data.stretchTo.onlyX ? Math.abs(effect.sprite.height) * scale : width / ratio;
  const leadingPad = line.length * (effect.flipX === -1 ? tail : head) / usable;
  const x = start.x - Math.cos(line.angle) * leadingPad;
  const y = start.y - Math.sin(line.angle) * leadingPad;
  return {x, y, width, height, angle: line.angle, ax: 0, ay: 0.5};
}

function currentPlacement(effect, media) {
  const source = pointFor(effect.sourceDocument, effect.sourcePosition, effect);
  const start = source && screenPoint(source.point);
  if (!start) return null;
  const scale = screenScale(source.point, start);
  if (!scale) return null;
  const aimed = effect.data.stretchTo || effect.data.rotateTowards || effect.data.moveTowards;
  const target = aimed && pointFor(effect.targetDocument, effect.targetPosition, effect);
  const end = target && screenPoint(target.point);
  if (aimed && !end) return null;
  const native = effect.rotationContainer?.rotation ?? 0;
  let placement;
  let phase = 'effect';
  if (effect.data.stretchTo && end) {
    phase = effect.data.persist && effect.data.name === 'Witch Bolt' ? 'link' : 'flight';
    placement = stretch(effect, start, end, media, scale);
  } else {
    const lineTemplate = ['ray', 'cone'].includes(source.template?.t);
    const tip = lineTemplate && areaEnd(source.area);
    const sweep = lineTemplate && tip ? around(start, tip) : null;
    const melee = source.token && target?.token && (effect.data.rotateTowards || effect.data.moveTowards);
    const orientation = end ? around(start, end) : null;
    const anchor = effect.spriteAnchor ?? effect.data.spriteAnchor ?? effect.data.anchor;
    const width = sweep?.length || Math.abs(effect.sprite.width) * scale;
    const height = Math.abs(effect.sprite.height) * scale;
    phase = melee || source.template || effect.data.name === 'Witch Bolt: Pulse' ? 'impact' : 'effect';
    placement = {
      x: melee ? start.x + orientation.dx * 0.57 : start.x,
      y: melee ? start.y + orientation.dy * 0.57 : start.y,
      width, height,
      angle: sweep?.angle ?? orientation?.angle ?? native,
      ax: melee ? 0.5 : sweep ? 0 : (anchor?.x ?? 0.5),
      ay: anchor?.y ?? 0.5
    };
  }
  return placement && {...placement, phase, start, end, source, target};
}

function show(record, placement) {
  const {media, effect} = record;
  const {x, y, width, height, angle, ax, ay} = placement;
  const flipX = effect.flipX ?? 1;
  const flipY = effect.flipY ?? 1;
  media.hidden = false;
  media.style.width = width + 'px';
  media.style.height = height + 'px';
  media.style.opacity = (effect.alpha ?? 1) * (effect.rotationContainer?.alpha ?? 1);
  media.style.transform = `translate(${x}px,${y}px) rotate(${angle}rad) scale(${flipX},${flipY}) translate(${-ax * 100}%,${-ay * 100}%)`;
  if (!record.projected) remember({
    id: effect.id, scene: effect.data.sceneId, phase: placement.phase, kind: 'sequencer', asset: effect._currentFilePath,
    sequence: effect.data.sequenceId, section: effect.data.index, repetition: effect.data.repetition,
    from: placement.source.token?.id ?? placement.source.template?.id,
    to: placement.target?.token?.id ?? placement.target?.template?.id
  });
  record.projected = {phase: placement.phase, asset: effect._currentFilePath, start: [placement.start.x, placement.start.y], end: placement.end && [placement.end.x, placement.end.y], width, height, angle};
}

function initPicture(record) {
  const {effect} = record;
  const path = animationPicture(effect._currentFilePath);
  if (!path) return false;
  const isVideo = /\.(webm|mp4)$/i.test(new URL(path).pathname);
  const media = document.createElement(isVideo ? 'video' : 'img');
  media.hidden = true;
  media.draggable = false;
  media.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;object-fit:fill;transform-origin:0 0';
  media.dataset.sequencerEffect = effect.id;
  media.dataset.provider = 'fvtt-3d-tabletop';
  if (isVideo) {
    // Native Sequencer owns all audio, including any video track.
    media.muted = true;
    media.playsInline = true;
    media.preload = 'auto';
    if (configuredMap()) setVideoPlaybackRate(media);
  }
  media.addEventListener('error', () => {
    remember({scene: effect.data.sceneId, id: effect.id, phase: 'media-error', kind: 'sequencer', asset: path});
    drop(effect.id);
  }, {once: true});
  media.src = path;
  layer ??= document.body.appendChild(Object.assign(document.createElement('div'), {
    className: 'tabletop-sequencer-effects'
  }));
  layer.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:68';
  layer.append(media);
  record.media = media;
  record.isVideo = isVideo;
  return true;
}

function syncVideo(record) {
  const {media, effect} = record;
  if (media.readyState < 1) return;
  const current = effect.mediaCurrentTime;
  if (validNumber(current) && Math.abs(media.currentTime - current) > 0.15) media.currentTime = current;
  if (effect.mediaPlaybackRate > 0 && media.playbackRate !== effect.mediaPlaybackRate) media.playbackRate = effect.mediaPlaybackRate;
  if (effect.mediaIsPlaying && media.paused && !record.starting) {
    record.starting = true;
    void media.play().catch(() => {}).finally(() => {record.starting = false;});
  } else if (!effect.mediaIsPlaying && !media.paused) media.pause();
}

function drop(id) {
  const record = overlays.get(id);
  if (!record) return;
  overlays.delete(id);
  const media = record.media;
  if (record.isVideo) {
    media.pause();
    media.removeAttribute('src');
    media.load();
  }
  media?.remove();
  if (!overlays.size) {
    layer?.remove();
    layer = null;
  }
}

function render() {
  frame = null;
  for (const [id, record] of overlays) {
    const {effect} = record;
    if (!scope() || effect.isDestroyed || effect.data.sceneId !== canvas.scene.id) {
      drop(id);
      continue;
    }
    if (!effect.ready) {
      if (performance.now() - record.inserted > 15000) drop(id);
      continue;
    }
    if (!record.media && !initPicture(record)) {
      drop(id);
      continue;
    }
    const placement = currentPlacement(effect, record.media);
    if (placement) show(record, placement);
    else record.media.hidden = true;
    if (record.isVideo) syncVideo(record);
  }
  if (overlays.size) frame = requestAnimationFrame(render);
}

function create(effect) {
  if (!scope() || !effect.shouldPlayVisible || effect.data.sceneId !== canvas.scene.id
      || effect.data.screenSpace || effect.data.screenSpaceAboveUI || !effect.data.source || overlays.has(effect.id)) return;
  if (areaTemplate(doc(effect.sourceDocument)) || areaTemplate(doc(effect.targetDocument))
      || areaVisualSource(effect.data.origin)) return;
  if (effect.data.moduleName !== 'Automated Animations' && !effect.data.origin
      && !effect.data.stretchTo && !effect.data.rotateTowards) return;
  const origin = typeof effect.data.origin === 'string' && fromUuidSync(effect.data.origin);
  const item = origin?.documentName === 'Item' ? origin : origin?.item;
  if (item) claim(item, doc(effect.sourceDocument), asTemplate(doc(effect.targetDocument)) ?? asTemplate(doc(effect.sourceDocument)));
  overlays.set(effect.id, {effect, inserted: performance.now()});
  if (!frame) frame = requestAnimationFrame(render);
}

export function clearSequencerProjection() {
  if (frame) cancelAnimationFrame(frame);
  frame = null;
  for (const id of overlays.keys()) drop(id);
  claims.clear();
}

export function sequencerStatus() {
  return {
    records: [...history],
    projection: [...overlays.values()].map(r => ({kind: 'sequencer', id: r.effect.id, ...r.projected})),
    running: overlays.size
  };
}

export function installSequencerProjection() {
  installWitchBolt(compatibleScene);
  Hooks.on('AutomatedAnimations-WorkflowStart', suppressProviderDuplicates);
  Hooks.on('aa.preDataSanitize', claimAA);
  Hooks.on('createSequencerEffect', create);
  Hooks.on('endedSequencerEffect', effect => drop(effect.id));
  Hooks.on('canvasTearDown', clearSequencerProjection);
  Hooks.on('3DCanvasToggleMode', on => {if (!on) clearSequencerProjection();});
}

