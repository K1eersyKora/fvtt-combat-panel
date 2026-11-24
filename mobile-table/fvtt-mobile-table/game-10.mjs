import {panelTheme} from './panel-theme-3.mjs';

const fail = message => { throw Error(message); };
const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const xy = p => ({x: p.x, y: p.y});
const list = value => Array.from(value?.contents ?? value ?? []);
const first = value => value?.first?.() ?? list(value)[0] ?? null;

const CONDITION_ZH = {
  blinded: '目盲', charmed: '魅惑', deafened: '耳聋', diseased: '患病',
  exhaustion: '力竭', frightened: '恐慌', grappled: '受擒', incapacitated: '失能',
  invisible: '隐形', paralyzed: '麻痹', petrified: '石化', poisoned: '中毒',
  prone: '倒地', restrained: '束缚', stunned: '震慑', unconscious: '昏迷',
  dead: '死亡', defeated: '倒下', concentrating: '专注', bloodied: '浴血',
  dodging: '回避', hiding: '躲藏', ethereal: '以太化', flying: '飞行',
  burrowing: '掘地', hovering: '悬浮', marked: '标记', surprised: '受惊',
  silenced: '沉默', sleeping: '睡眠', burning: '燃烧', bleeding: '流血',
  cursed: '诅咒', blessed: '祝福', hasted: '加速', slowed: '减速',
  transformed: '变形', coverHalf: '半身掩护', coverThreeQuarters: '四分之三掩护',
  coverTotal: '全身掩护', heavilyEncumbered: '超重负重', encumbered: '负重'
};

export function directlyVisible(t, pairedUserId = game.user?.id) {
  const d = t?.document;
  if (!canvas.ready || !game.user || game.user.isGM || game.user.id !== pairedUserId) return false;
  if (!d || d.parent !== canvas.scene || canvas.tokens.get(t.id) !== t) return false;
  if (!t.actor || t.destroyed || d.hidden || d.isSecret || !t.visible) return false;
  if (t.renderable === false || t.worldVisible === false || t.detectionFilter) return false;
  if (d.disposition === CONST.TOKEN_DISPOSITIONS.SECRET && !t.isOwner) return false;
  // Re-check detectionFilter after evaluating isVisible getter (Foundry 13 updates it lazily).
  return t.isVisible === true && !t.detectionFilter && t.mesh?.visible !== false && t.mesh?.worldAlpha !== 0;
}

function player() {
  if (!game.ready || game.user.isGM || game.user.role < 1) fail('请使用普通玩家账号');
  if (!canvas.ready || game.Levels3DPreview?._active) fail('请打开二维地图');
}

function source() {
  player();
  const t = canvas.tokens.controlled.find(tok => tok.isOwner && directlyVisible(tok)) ??
    canvas.tokens.placeables.find(tok => tok.actor?.id === game.user.character?.id && tok.isOwner && directlyVisible(tok));
  if (!t?.actor) fail('请在 PL 窗口选中自己拥有的棋子');
  return t;
}

function displayModeVisible(mode, token, hovered = false) {
  const M = CONST.TOKEN_DISPLAY_MODES;
  if (mode === M.ALWAYS) return true;
  if (mode === M.HOVER) return hovered;
  if (mode === M.OWNER) return !!token.isOwner;
  if (mode === M.OWNER_HOVER) return !!token.isOwner && hovered;
  if (mode === M.CONTROL) return !!token.controlled;
  return false;
}

export function tokenVisibleName(t, hovered = false) {
  if (!t) return '场上目标';
  if (t.isOwner) return t.name;
  if (hovered) {
    return displayModeVisible(t.document?.displayName, t, true) ? t.name : '场上目标';
  }
  return (displayModeVisible(t.document?.displayName, t, false) || t.nameplate?.visible) ? t.name : '场上目标';
}

function tokenRow(t) {
  const d = t.document;
  return {
    id: t.id,
    name: tokenVisibleName(t, false),
    x: t.center.x,
    y: t.center.y,
    w: t.w,
    h: t.h,
    width: Number(d.width) || 1,
    height: Number(d.height) || 1,
    rotation: t.mesh?.angle || 0,
    elevation: Number(d.elevation) || 0,
    sort: Number(d.sort) || 0
  };
}

function gridInfo() {
  const grid = canvas.grid;
  const rect = canvas.dimensions.sceneRect;
  const origin = grid?.getTopLeftPoint?.({i: 0, j: 0}) ?? {x: 0, y: 0};
  return {
    rev: `${canvas.scene.id}:${canvas.scene.grid.type}:${grid.size}:${origin.x}:${origin.y}:${rect.x}:${rect.y}:${rect.width}:${rect.height}`,
    type: Number(canvas.scene.grid.type) || 0,
    size: Number(grid.size) || 100,
    sizeX: Number(grid.sizeX ?? grid.size) || 100,
    sizeY: Number(grid.sizeY ?? grid.size) || 100,
    distance: Number(grid.distance) || 5,
    units: String(canvas.scene.grid.units || ''),
    ox: Number(origin.x) || 0,
    oy: Number(origin.y) || 0,
    sceneRect: {x: rect.x, y: rect.y, w: rect.width, h: rect.height}
  };
}

function remaining(t) {
  if (!game.combat?.started || !game.combat.combatants.some(c => c.tokenId === t.id)) return null;
  const raw = t.actor.system.attributes?.movement?.walk;
  if (raw == null || raw === '') return null;
  const speed = Number(raw);
  if (!Number.isFinite(speed) || speed < 0) return null;
  if (speed === 0) {
    const baseWalk = Number(t.actor._source?.system?.attributes?.movement?.walk) || 0;
    const immobilized = ['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious']
      .some(s => t.actor.statuses?.has?.(s));
    return (baseWalk > 0 || immobilized) ? 0 : null;
  }
  const spent = (t.document.movementHistory || []).reduce((n, w) => n + (Number.isFinite(w.cost) ? w.cost : 0), 0);
  return Math.max(0, speed - spent);
}

function gmOnlyEffect(e) {
  return !!(
    !e || e.disabled || e.isSuppressed || e.isConcealed ||
    e.getFlag?.('core', 'hidden') ||
    e.flags?.['dfreds-convenient-effects']?.isGmOnly ||
    e.flags?.['fvtt-mobile-table']?.gmOnly
  );
}

function localizeStatusId(id) {
  const key = String(id || '').trim();
  if (!key) return '';
  if (CONDITION_ZH[key]) return CONDITION_ZH[key];
  const cfg = CONFIG.statusEffects?.find?.(s => s.id === key);
  const cond = CONFIG.DND5E?.conditionTypes?.[key];
  const rawLabel = cond?.name || cond?.label || cfg?.name || cfg?.label || '';
  if (rawLabel) {
    const localized = game.i18n?.localize?.(rawLabel) || rawLabel;
    if (localized && localized !== rawLabel) return localized;
    if (!/^[A-Z0-9._-]+$/.test(localized)) return localized;
  }
  return key;
}

function exhaustionLevelFor(effect, actor) {
  const fromFlag = Number(effect?.flags?.dnd5e?.exhaustionLevel);
  if (Number.isFinite(fromFlag) && fromFlag > 0) return Math.round(fromFlag);
  const fromActor = Number(actor?.system?.attributes?.exhaustion);
  if (Number.isFinite(fromActor) && fromActor > 0) return Math.round(fromActor);
  return null;
}

export function visibleConditions(actor, isOwner = false) {
  if (!actor) return [];
  const effects = list(actor.temporaryEffects);
  const out = [];
  const seen = new Set();

  const add = (id, label, level = null) => {
    const clean = String(label || '').trim();
    if (!clean) return;
    const dedup = id ? `id:${id}` : `txt:${clean}`;
    if (seen.has(dedup)) return;
    seen.add(dedup);
    out.push(level != null ? {id: id || '', label: `${clean} ${level} 级`, level} : {id: id || '', label: clean});
  };

  const knownStatusIds = new Set([
    ...Object.keys(CONDITION_ZH),
    ...Object.keys(CONFIG.DND5E?.conditionTypes || {}),
    ...(CONFIG.statusEffects || []).map(s => s.id).filter(Boolean)
  ]);

  for (const e of effects) {
    if (!e?.active || gmOnlyEffect(e)) continue;
    if (!e.img) continue;
    if (!isOwner && e.parent?.documentName === 'Item' && e.parent.system?.identified === false) continue;

    const statuses = [...(e.statuses || [])].filter(Boolean);
    if (statuses.length) {
      // Pick the effect's primary status rather than exploding implicit mechanical statuses.
      const primary = statuses.find(s => s === 'exhaustion')
        ?? statuses.find(s => e.id?.endsWith?.(s) || e.flags?.core?.statusId === s)
        ?? statuses.find(s => knownStatusIds.has(s))
        ?? null;
      if (primary && knownStatusIds.has(primary)) {
        const level = primary === 'exhaustion' ? exhaustionLevelFor(e, actor) : null;
        add(primary, localizeStatusId(primary), level);
        continue;
      }
      if (!isOwner) continue;
    }

    // Match static known status by img or core statusId for non-owners; never leak private custom GM effect names.
    const statusById = e.flags?.core?.statusId;
    if (statusById && knownStatusIds.has(statusById)) {
      const level = statusById === 'exhaustion' ? exhaustionLevelFor(e, actor) : null;
      add(statusById, localizeStatusId(statusById), level);
      continue;
    }
    const matchedCfg = CONFIG.statusEffects?.find?.(s => s.img && e.img && s.img === e.img && knownStatusIds.has(s.id));
    if (matchedCfg) {
      const level = matchedCfg.id === 'exhaustion' ? exhaustionLevelFor(e, actor) : null;
      add(matchedCfg.id, localizeStatusId(matchedCfg.id), level);
      continue;
    }
    if (isOwner && e.name) {
      add('', String(e.name).slice(0, 40));
    }
  }
  return out;
}

function injuryBandFromRatio(ratio) {
  if (ratio <= 0) return '已倒下';
  if (ratio <= 0.25) return '濒危';
  if (ratio <= 0.5) return '重伤';
  if (ratio < 1) return '轻伤';
  return '无伤';
}

export function inspectVisibleToken(targetId) {
  player();
  if (typeof targetId !== 'string' || !targetId) return null;
  const t = canvas.tokens.get(targetId);
  if (!directlyVisible(t)) return null;

  const isOwner = !!t.isOwner;
  const canReadExact = isOwner || !!t.actor?.testUserPermission?.(game.user, 'OBSERVER');
  const name = tokenVisibleName(t, true);

  let health = {kind: 'hidden', label: '伤情未公开'};
  const hp = t.actor?.system?.attributes?.hp;
  const effMax = Number(hp?.effectiveMax ?? ((Number(hp?.max) || 0) + (Number(hp?.tempmax) || 0)));
  const curVal = Number(hp?.value);
  const temp = Math.max(0, Number(hp?.temp) || 0);

  if (canReadExact && hp && Number.isFinite(curVal) && Number.isFinite(effMax) && effMax > 0) {
    health = {
      kind: 'exact',
      value: Math.max(0, curVal),
      max: effMax,
      temp,
      label: `HP ${Math.max(0, curVal)} / ${effMax}${temp ? ` (+${temp})` : ''}`
    };
  } else {
    // Non-observer: check desktop-visible health estimate or HP bar visibility (hover-equivalent on tap).
    const heText = t.document?.flags?.healthEstimate?.description;
    if (typeof heText === 'string' && heText.trim()) {
      health = {kind: 'band', label: heText.trim().slice(0, 40)};
    } else if (displayModeVisible(t.document?.displayBars, t, true)) {
      const bars = [t.document?.bar1?.attribute, t.document?.bar2?.attribute];
      const showsHp = bars.some(attr => attr === 'attributes.hp');
      if (showsHp && Number.isFinite(curVal) && Number.isFinite(effMax) && effMax > 0) {
        const ratio = Math.max(0, Math.min(1, curVal / effMax));
        health = {kind: 'band', label: injuryBandFromRatio(ratio)};
      }
    }
  }

  return {
    id: t.id,
    scene: canvas.scene.id,
    name,
    isOwner,
    health,
    conditions: visibleConditions(t.actor, isOwner)
  };
}

export function state(inspectTargetId = null) {
  player();
  let t;
  try { t = source(); } catch {}
  const m = canvas.stage.worldTransform;
  const screen = canvas.app.renderer.screen;
  const g = gridInfo();
  const visibleTokens = canvas.tokens.placeables
    .filter(tok => directlyVisible(tok))
    .sort((a, b) => (Number(a.document.elevation) || 0) - (Number(b.document.elevation) || 0)
      || (Number(a.document.sort) || 0) - (Number(b.document.sort) || 0)
      || String(a.id).localeCompare(String(b.id)))
    .map(tokenRow);

  const srcRow = t ? {
    ...tokenRow(t),
    pivot: {x: t.center.x - t.document.x, y: t.center.y - t.document.y},
    remaining: remaining(t)
  } : null;

  return {
    user: game.user.name,
    scene: canvas.scene.id,
    sceneName: canvas.scene.name,
    theme: panelTheme(),
    view: [m.a, m.b, m.c, m.d, m.tx, m.ty, screen.width, screen.height],
    grid: g.size,
    unit: g.distance,
    units: g.units,
    gridInfo: g,
    source: srcRow,
    targets: visibleTokens,
    inspection: inspectTargetId ? inspectVisibleToken(inspectTargetId) : null
  };
}

function slotEntries(actor) {
  const spells = actor.system?.spells || {};
  const rows = [];
  const pact = spells.pact;
  if (pact && Number(pact.max) > 0) {
    rows.push({
      id: 'pact',
      kind: 'pact',
      level: Number(pact.level) || 1,
      value: Math.max(0, Number(pact.value) || 0),
      max: Number(pact.max)
    });
  }
  for (let lvl = 1; lvl <= 9; lvl++) {
    const s = spells['spell' + lvl];
    if (s && Number(s.max) > 0) {
      rows.push({
        id: 'spell' + lvl,
        kind: 'normal',
        level: lvl,
        value: Math.max(0, Number(s.value) || 0),
        max: Number(s.max)
      });
    }
  }
  return rows;
}

function parseUsesPool(uses) {
  if (!uses || uses.max == null || String(uses.max).trim() === '') return null;
  const max = Number(uses.max);
  if (!Number.isFinite(max) || max <= 0) return null;
  const current = Number(uses.value);
  const value = Number.isFinite(current) && current >= 0
    ? Math.min(max, current)
    : Math.max(0, Math.min(max, max - (Number(uses.spent) || 0)));
  return {value, max};
}

function resolveConsumptionItem(actor, target) {
  if (!actor || typeof target !== 'string' || !target.trim()) return null;
  const direct = actor.items?.get?.(target);
  if (direct) return direct;
  const match = target.match(/^([^:]+):([^:]+)$/);
  const type = match?.[1], identifier = match?.[2] ?? target;
  const sourced = first(actor.sourcedItems?.get?.(target));
  if (sourced) return sourced;
  const identified = first(type ? actor.identifiedItems?.get?.(identifier, {type}) : actor.identifiedItems?.get?.(identifier));
  if (identified) return identified;
  for (const i of actor.items || []) {
    const src = i.flags?.dnd5e?.sourceId;
    if (i.id === target || (i.system?.identifier === identifier && (!type || i.type === type)) || src === target) return i;
  }
  return null;
}

function activityCharge(actor, item, a) {
  const targets = list(a?.consumption?.targets);
  const actTarget = targets.find(t => t?.type === 'activityUses');
  if (actTarget) {
    const src = actTarget.target ? item?.system?.activities?.get?.(actTarget.target) : a;
    const pool = parseUsesPool(src?.uses);
    if (pool) return {...pool, kind: 'activity', label: src?.name || item?.name || '', consumes: true};
  }
  const own = parseUsesPool(item?.system?.uses);
  const consumesOwnItem = targets.some(t => t?.type === 'itemUses' && (!t.target || t.target === item?.id));
  if (own) return {...own, kind: 'item', label: item?.system?.uses?.label || item?.name || '', consumes: consumesOwnItem};
  for (const target of targets) {
    if (target?.type !== 'itemUses' || !target.target) continue;
    const src = resolveConsumptionItem(actor, target.target);
    const pool = parseUsesPool(src?.system?.uses);
    if (pool) return {...pool, kind: 'resource', label: src.name, consumes: true};
  }
  const actOwn = parseUsesPool(a?.uses);
  if (actOwn) return {...actOwn, kind: 'activity', label: a?.name || item?.name || '', consumes: true};
  return null;
}

function templateSpecFor(act) {
  const template = act.target?.template;
  const templateType = template?.type || '';
  if (!templateType) return null;
  const anchored = act.range?.units === 'self' || (act.range?.units === undefined && ['radius', 'squareRadius'].includes(templateType));
  const gridAligned = game.settings?.get?.('dnd5e', 'gridAlignedSquareTemplates') !== false;
  let t = 'circle';
  let originRule = anchored ? 'caster' : 'free';
  if (['cone'].includes(templateType)) t = 'cone';
  else if (['line', 'wall'].includes(templateType)) t = 'ray';
  else if (['cube', 'square'].includes(templateType)) {
    t = gridAligned ? 'rect' : 'ray';
    if (anchored && templateType === 'cube') originRule = gridAligned ? 'casterCubeRect' : 'casterCubeRay';
  }
  const size = Number(template?.size) || 0;
  const width = Number(template?.width) || Number(canvas.grid?.distance) || 5;
  const distancePixels = canvas.dimensions?.distancePixels ?? ((canvas.grid?.size || 100) / (canvas.grid?.distance || 5));
  return {
    templateType,
    t,
    originRule,
    size,
    width,
    sidePx: size * distancePixels,
    angle: Number(CONFIG.MeasuredTemplate?.defaults?.angle) || 53.13,
    gridAligned,
    noTemplate: templateType === 'emanationNoTemplate'
  };
}

function describe(item, a, actor) {
  const template = a.target?.template, affects = a.target?.affects;
  const teleport = item.system.identifier === 'misty-step' || /^(迷踪步|迷蹤步|Misty Step)$/i.test(item.name);
  const type = template?.type || '';
  const shape = ({
    sphere: 'circle', radius: 'circle', cylinder: 'circle', emanation: 'circle', emanationNoTemplate: 'circle',
    cone: 'cone', line: 'line', wall: 'line', cube: 'square', square: 'square', squareRadius: 'square'
  })[type];
  let mode = shape ? 'area' : affects?.type === 'self' ? 'self' : (affects?.type || ['attack', 'heal', 'save'].includes(a.type)) ? 'target' : 'self';
  if (teleport) mode = 'teleport';
  const count = Number(affects?.count);
  const charge = activityCharge(actor, item, a);
  const tSpec = shape ? templateSpecFor(a) : null;
  const anchored = a.range?.units === 'self' || (a.range?.units === undefined && ['radius', 'squareRadius'].includes(type));
  return {
    key: item.id + '/' + a.id,
    name: item.name,
    identifier: item.system.identifier || '',
    activity: a.name || item.name,
    type: a.type,
    group: item.type,
    mode,
    shape: shape || '',
    templateType: type,
    templateSpec: tSpec,
    size: Number(template?.size) || 0,
    width: Number(template?.width) || 5,
    anchored,
    max: count > 0 ? count : (affects?.choice ? 30 : 1),
    level: Number(item.system.level) || 0,
    isCantrip: item.type === 'spell' && Number(item.system.level) === 0,
    needsSlot: item.type === 'spell' && Number(item.system.level) > 0 && a.consumption?.spellSlot !== false,
    uses: charge ? charge.value : null,
    charge: charge ? {value: charge.value, max: charge.max, kind: charge.kind, label: charge.label} : null,
    consumesUses: !!charge?.consumes
  };
}

function getAction(t, key) {
  const [itemId, activityId] = String(key).split('/');
  const item = t.actor.items.get(itemId);
  const act = item?.system.activities?.get(activityId);
  if (!act) fail('角色卡上的活动已变化，请重新打开');
  return {item, act, info: describe(item, act, t.actor)};
}

const readableDescriptions = new Map();
function description(html) {
  if (typeof html !== 'string' || !html) return '';
  if (readableDescriptions.has(html)) return readableDescriptions.get(html);
  const dom = new DOMParser().parseFromString(html, 'text/html');
  for (const node of dom.querySelectorAll('.secret:not(.revealed),[data-visibility="gm"],script,style,iframe,object')) node.remove();
  for (const block of dom.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr')) block.append(document.createTextNode('\n'));
  const text = dom.body.textContent.replace(/@(?:UUID|Compendium)\[[^\]]+\]\{([^}]+)\}/g, '$1').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  if (readableDescriptions.size >= 512) readableDescriptions.delete(readableDescriptions.keys().next().value);
  readableDescriptions.set(html, text);
  return text;
}

export function sheet() {
  if (!game.ready || game.user.isGM) fail('需要玩家桌位');
  let t;
  try { t = source(); } catch {}
  const actor = t?.actor ?? game.user.character;
  if (!actor?.isOwner) fail('没有可读取的玩家角色卡');
  const actions = [];
  for (const item of actor.items) {
    for (const a of item.system.activities?.values?.() || []) {
      if (a.activation?.type === 'legendary' || (a.type === 'forward' && !a.item)) continue;
      actions.push(describe(item, a, actor));
    }
  }
  const attributes = actor.system.attributes || {}, hp = attributes.hp;
  const abilities = Object.entries(actor.system.abilities || {})
    .map(([id, s]) => ({id, value: s.value, mod: s.mod, save: s.save?.value ?? s.save?.mod ?? s.save ?? null}))
    .map(a => ({...a, save: Number.isFinite(a.save) ? a.save : null}));
  const inventory = actor.items.map(i => {
    const own = parseUsesPool(i.system?.uses);
    return {
      id: i.id,
      name: i.name,
      group: i.type,
      quantity: i.system.quantity ?? null,
      equipped: i.system.equipped ?? null,
      uses: own ? own.value : null,
      charge: own ? {value: own.value, max: own.max, kind: 'item', label: i.system?.uses?.label || i.name} : null,
      description: description(i.system.description?.value)
    };
  });
  const skills = Object.entries(actor.system.skills || {})
    .map(([id, v]) => ({id, mod: Number.isFinite(v.total) ? v.total : v.mod, label: game.i18n.localize(CONFIG.DND5E?.skills?.[id]?.label || id)}));
  const condList = visibleConditions(actor, true).map(c => c.label);
  return {
    schema: 2,
    actorId: actor.id,
    actor: actor.name,
    source: t?.id ?? null,
    hp: hp ? {value: hp.value, max: hp.effectiveMax ?? hp.max, temp: hp.temp || 0} : null,
    ac: attributes.ac?.value ?? null,
    level: actor.system.details?.level ?? null,
    speed: attributes.movement?.walk ?? null,
    biography: description(actor.system.details?.biography?.value),
    abilities,
    skills,
    conditions: condList,
    inventory,
    slots: slotEntries(actor),
    actions
  };
}

function checkContext(t, cmd) {
  if (cmd.scene !== canvas.scene.id || cmd.source !== t.id) fail('场景或角色已改变，请重新选择');
  if (!validPoint(cmd.origin) || Math.hypot(cmd.origin.x - t.center.x, cmd.origin.y - t.center.y) > 1) fail('角色已经移动，请重新规划');
}

function within(p) {
  return validPoint(p) && canvas.dimensions.sceneRect.contains(p.x, p.y);
}

function snapTokenStep(t, centerPoint) {
  const originX = t.document._source.x;
  const originY = t.document._source.y;
  const pivotX = t.center.x - originX;
  const pivotY = t.center.y - originY;
  const elevation = t.document._source.elevation;
  const raw = {
    x: Math.round(centerPoint.x - pivotX),
    y: Math.round(centerPoint.y - pivotY),
    elevation
  };
  const snapped = t.document.getSnappedPosition(raw);
  return {
    x: Math.round(snapped.x),
    y: Math.round(snapped.y),
    elevation,
    explicit: true
  };
}

function waypointCenter(t, step) {
  if (typeof t.document.getCenterPoint === 'function') {
    const c = t.document.getCenterPoint({x: step.x, y: step.y, elevation: step.elevation});
    return {x: c.x, y: c.y};
  }
  return {x: step.x + t.w / 2, y: step.y + t.h / 2};
}

const routeTickets = new Map();
const templateTickets = new Map();

export function clearPreviews() {
  routeTickets.clear();
  templateTickets.clear();
}

function saveTicket(store, value) {
  const ticket = foundry.utils.randomID();
  store.set(ticket, value);
  if (store.size > 64) store.delete(store.keys().next().value);
  return ticket;
}

function makePath(t, cmd) {
  if (!Array.isArray(cmd.points) || !cmd.points.length || cmd.points.length > 40 || cmd.points.some(p => !within(p))) {
    fail('请选择地图内的有效路径');
  }
  const origin = {
    x: t.document._source.x,
    y: t.document._source.y,
    elevation: t.document._source.elevation
  };
  const snappedSteps = [];
  for (const p of cmd.points) {
    const step = snapTokenStep(t, p);
    const prev = snappedSteps.at(-1);
    if (prev && prev.x === step.x && prev.y === step.y) continue;
    snappedSteps.push(step);
  }
  if (!snappedSteps.length) snappedSteps.push(snapTokenStep(t, cmd.points.at(-1)));

  const route = [origin, ...snappedSteps];
  const [path, blocked] = t.constrainMovementPath(route, {preview: true});
  const measured = (typeof t.measureMovementPath === 'function'
    ? t.measureMovementPath(path, {preview: true})
    : t.document.measureMovementPath(path));
  const cost = Number(measured?.cost) || 0;
  const budget = remaining(t);
  const reason = game.paused
    ? '游戏已暂停'
    : blocked
      ? '路线受阻，请调整路径'
      : budget !== null && cost > budget + 0.001
        ? '超出本回合步行余量'
        : '';
  const preview = path.slice(1).map(p => waypointCenter(t, p));
  const end = preview.at(-1) || xy(t.center);
  const ticket = !reason ? saveTicket(routeTickets, {
    scene: canvas.scene.id,
    source: t.id,
    origin: xy(origin),
    steps: snappedSteps,
    end
  }) : null;
  return {
    planId: cmd.planId || '',
    seq: Number(cmd.seq) || 0,
    ticket,
    steps: snappedSteps,
    cost,
    budget,
    reason,
    preview,
    end
  };
}

function target(t, id) {
  const other = canvas.tokens.get(id);
  if (!directlyVisible(other)) fail('目标已离开视野，请重新选择');
  return other;
}

function setTargets(tokens) {
  for (const current of [...game.user.targets]) {
    if (!tokens.includes(current)) current.setTarget(false, {releaseOthers: false, user: game.user});
  }
  for (const tok of tokens) {
    if (!game.user.targets.has(tok)) tok.setTarget(true, {releaseOthers: false, user: game.user});
  }
}

const panelModule = 'fvtt-combat-panel';
const iconCache = new Map();
export async function displayIcon(src, naturalSize = false) {
  if (!src) return null;
  const key = naturalSize ? 'chat:' + src : src;
  if (iconCache.has(key)) return iconCache.get(key);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = new URL(src, document.baseURI).href;
  try {
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 72;
    const ctx = c.getContext('2d');
    const k = Math.min(72 / img.naturalWidth, 72 / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    if (naturalSize) {
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
    }
    ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
    const uri = c.toDataURL('image/webp', 0.87);
    if (iconCache.size >= 300) iconCache.delete(iconCache.keys().next().value);
    iconCache.set(key, uri);
    return uri;
  } catch {
    return null;
  }
}

let predictionApi;
async function prediction(t, cmd) {
  const {act} = getAction(t, cmd.key), other = target(t, cmd.target);
  if (!['attack', 'save'].includes(act.type)) return {label: act.type === 'heal' ? '治疗无需命中检定' : '此能力无需命中检定'};
  if (!game.modules.get(panelModule)?.active) return {label: '战斗预测模组未启用'};
  const url = name => foundry.utils.getRoute('modules/' + panelModule + '/scripts/' + name);
  try {
    predictionApi ??= Promise.all([
      import(url('prediction-policy-156.js')),
      import(url('prediction-147.js')),
      import(url('workflow-preview-147.js'))
    ]);
    const [policy, predict, workflow] = await predictionApi;
    if (!policy.getPredictionPolicy(game.user).probability) return {label: '当前设置未向玩家显示概率'};
    const result = await predict.computePreview({
      actor: t.actor, sourceToken: t, activity: act, targetToken: other, workflowResolver: workflow.workflowAttackPreview
    });
    if (!policy.getPredictionPolicy(game.user).probability || !directlyVisible(other)) return {label: '暂无可见预测'};
    const label = result.kind === 'save' ? '目标豁免失败率' : '命中率';
    return {label, percent: Number.isFinite(result.chance) ? Math.round(result.chance * 100) : null, mode: result.mode};
  } catch {
    predictionApi = null;
    return {label: '当前活动暂无可用预测'};
  }
}

function checkRange(t, act, p) {
  const r = act.range || {}, limits = {ft: 1, mi: 5280, m: 1, km: 1000, touch: 1};
  const limit = r.units === 'touch' ? canvas.grid.distance : Number(r.value) * limits[r.units];
  if (Number.isFinite(limit) && limit > 0 && canvas.grid.measurePath([t.center, p]).distance > limit + 0.01) {
    fail('超出施法距离');
  }
}

function excludesAreaOrigin(activity) {
  const targetCfg = activity?.target ?? {};
  const special = String(targetCfg.affects?.special ?? '').split(';').map(v => v.trim());
  if (special.includes('+self')) return false;
  if (special.some(v => ['self', '-self'].includes(v))) return true;
  if (activity?.range?.units !== 'self') return false;
  if (['cone', 'line', 'cube'].includes(targetCfg.template?.type)) return true;
  if (['ally', 'willing', 'self'].includes(targetCfg.affects?.type)) return false;
  return ['radius', 'squareRadius', 'emanation', 'emanationNoTemplate'].includes(targetCfg.template?.type)
    && ['save', 'attack', 'damage'].includes(activity.type);
}

function prepareAreaActivity(activity) {
  if (!excludesAreaOrigin(activity)) return activity;
  const special = String(activity.target?.affects?.special ?? '').split(';').filter(Boolean);
  if (special.some(v => ['self', '-self'].includes(v.trim()))) return activity;
  const targetCfg = foundry.utils.deepClone(activity.target);
  targetCfg.override = true;
  targetCfg.affects.special = [...special, '-self'].join(';');
  const clone = activity.item.clone({[`system.activities.${activity.id}.target`]: targetCfg}, {keepId: true});
  return clone.system.activities.get(activity.id);
}

function areaTargetAllowed(token, caster, activity, auto, settings = {}) {
  if (!directlyVisible(token) || token.actor.type === 'group' || token.actor.flags?.['midi-qol']?.neverTarget) return false;
  const has = condition => condition && (globalThis.MidiQOL?.hasCondition?.(token.actor, condition) ?? token.actor.statuses?.has(condition));
  if (settings?.optionalRules?.wallsBlockRange && settings.optionalRules.wallsBlockRange !== 'none'
    && (globalThis.MidiQOL?.WallsBlockConditions ?? []).some(has)) return false;
  if (String(auto).endsWith('IgnoreIncapacitated') && globalThis.MidiQOL?.checkIncapacitated?.(token.actor, false, false)) return false;
  if (String(auto).endsWith('IgnoreDefeated') && (has(CONFIG.specialStatusEffects?.DEFEATED) || has(settings?.midiDeadCondition))) return false;
  if (excludesAreaOrigin(activity) && token.id === caster.id) return false;
  const affects = activity.target?.affects ?? {};
  let type = ['ally', 'enemy'].includes(affects.type) ? affects.type : 'any';
  if (activity.midiProperties?.autoTargetType && activity.midiProperties.autoTargetType !== 'any') {
    type = activity.midiProperties.autoTargetType;
  }
  const d = token.document.disposition, s = caster.document.disposition, secret = CONST.TOKEN_DISPOSITIONS.SECRET;
  const match = {
    ally: d === s, notAlly: d !== s,
    enemy: d === -s || d === secret, notEnemy: d !== -s && d !== secret,
    neutral: d === 0, notNeutral: d !== 0,
    friendly: d === 1, notFriendly: d !== 1,
    hostile: d === -1 || d === secret, notHostile: d !== -1 && d !== secret
  };
  return match[type] ?? true;
}

function coveredByShapeSamples(doc, shape, token, {walls = false} = {}) {
  const grid = canvas.grid;
  if (!shape || !token?.actor) return false;
  const wUnits = Number(token.document.width) || 1;
  const hUnits = Number(token.document.height) || 1;
  const startX = wUnits >= 1 ? 0.5 : wUnits / 2;
  const startY = hUnits >= 1 ? 0.5 : hUnits / 2;
  const origin = shape instanceof PIXI.Rectangle
    ? {x: doc.x + shape.width / 2, y: doc.y + shape.height / 2}
    : {x: doc.x, y: doc.y};
  for (let gx = startX; gx < wUnits; gx += 1) {
    for (let gy = startY; gy < hUnits; gy += 1) {
      const px = token.x + gx * grid.size;
      const py = token.y + gy * grid.size;
      if (!shape.contains(px - doc.x, py - doc.y)) continue;
      if (!walls || !CONFIG.Canvas.polygonBackends.sight.testCollision(origin, {x: px, y: py}, {mode: 'any', type: 'move'})) {
        return true;
      }
    }
  }
  return false;
}

function coveredByCoreGrid(template, token) {
  if (!canvas.grid?.isSquare || typeof template._getGridHighlightPositions !== 'function'
    || typeof token.document?.getOccupiedGridSpaceOffsets !== 'function') {
    return null;
  }
  const highlights = template._getGridHighlightPositions();
  if (!Array.isArray(highlights) || !highlights.length) return false;
  const set = new Set();
  for (const pos of highlights) {
    const off = canvas.grid.getOffset(pos);
    set.add(`${off.i},${off.j}`);
  }
  for (const off of token.document.getOccupiedGridSpaceOffsets()) {
    if (set.has(`${off.i},${off.j}`)) return true;
  }
  return false;
}

function scaledActivityForSlot(act, slotId, actor) {
  if (!slotId || act.item?.type !== 'spell') return act;
  const baseLevel = Number(act.item.system?.level) || 0;
  let castLevel = baseLevel;
  if (slotId === 'pact') castLevel = Number(actor?.system?.spells?.pact?.level) || baseLevel;
  else if (/^spell([1-9])$/.test(slotId)) castLevel = Number(slotId.slice(5));
  if (castLevel <= baseLevel) return act;
  try {
    const clone = act.item.clone({'flags.dnd5e.scaling': castLevel - baseLevel}, {keepId: true});
    clone.prepareFinalAttributes?.();
    return clone.system.activities?.get(act.id) || act;
  } catch {
    return act;
  }
}

function computeTemplateCoverage(template, shape, caster, act) {
  const midiActive = !!game.modules.get('midi-qol')?.active;
  let midiSettings = {};
  if (midiActive) {
    try { midiSettings = globalThis.MidiQOL?.configSettings?.() || {}; } catch {}
  }
  const override = act.midiProperties?.autoTargetAction;
  const auto = override && override !== 'default' ? override : (midiSettings?.autoTarget ?? 'always');
  const walls = ['wallsBlock', 'wallsBlockIgnoreDefeated', 'wallsBlockIgnoreIncapacitated'].includes(auto);
  const useCoreGrid = !midiActive && canvas.grid.isSquare;

  // Always compute against strictly player-visible tokens so hidden/unseen units can never leak.
  const candidates = canvas.tokens.placeables.filter(tok => directlyVisible(tok));
  const coveredTokens = [];
  for (const tok of candidates) {
    if (!areaTargetAllowed(tok, caster, act, midiActive ? auto : 'always', midiSettings)) continue;
    let hit = false;
    if (useCoreGrid) {
      // Ensure template.shape is assigned for Foundry's _getGridHighlightPositions without mounting on canvas.
      template.shape = shape;
      const coreHit = coveredByCoreGrid(template, tok);
      hit = coreHit === null ? coveredByShapeSamples(template.document, shape, tok, {walls: false}) : coreHit;
    } else {
      hit = coveredByShapeSamples(template.document, shape, tok, {walls});
    }
    if (hit) coveredTokens.push(tok);
  }
  return {
    rule: useCoreGrid ? 'coreGrid' : (walls ? 'midiWalls' : 'midi2d'),
    autoTarget: auto,
    tokens: coveredTokens
  };
}

function templatePlacement(t, act, info, cmd) {
  if (info.mode !== 'area' || !within(cmd.point) || !Number.isFinite(cmd.direction)) {
    fail('请选择地图内的有效范围');
  }
  const scaledAct = scaledActivityForSlot(act, cmd.slot, t.actor);
  const factory = game.dnd5e?.canvas?.AbilityTemplate ?? globalThis.dnd5e?.canvas?.AbilityTemplate;
  const templates = factory?.fromActivity(scaledAct) ?? [];
  if (templates.length !== 1) fail('这个活动需要专用模板，请在电脑上施放');

  const template = templates[0], doc = template.document;
  const templateType = scaledAct.target?.template?.type || info.templateType || '';
  const selfOrigin = info.anchored;
  const dir = ((Number(cmd.direction) % 360) + 360) % 360;
  let base;
  let direction = doc.t === 'rect' ? 45 : dir;

  if (selfOrigin && templateType === 'cube') {
    const halfW = t.w / 2, halfH = t.h / 2;
    if (doc.t === 'rect') {
      const side = Number(doc.width) * (canvas.dimensions.distancePixels ?? (canvas.grid.size / canvas.grid.distance));
      const faceIndex = ((Math.round(dir / 90) % 4) + 4) % 4;
      const rawFace = [
        {x: t.center.x + halfW, y: t.center.y - side / 2},
        {x: t.center.x - side / 2, y: t.center.y + halfH},
        {x: t.center.x - halfW - side, y: t.center.y - side / 2},
        {x: t.center.x - side / 2, y: t.center.y - halfH - side}
      ][faceIndex];
      base = template.getSnappedPosition(rawFace);
      direction = 45;
    } else {
      const rad = dir * Math.PI / 180;
      const dx = Math.cos(rad), dy = Math.sin(rad);
      const offset = Math.abs(dx) * halfW + Math.abs(dy) * halfH;
      base = {x: t.center.x + dx * offset, y: t.center.y + dy * offset};
      direction = dir;
    }
  } else if (selfOrigin) {
    base = xy(t.center);
  } else {
    base = template.getSnappedPosition(cmd.point);
  }

  const patch = {x: Math.round(base.x), y: Math.round(base.y), direction};
  if (doc.flags?.dnd5e?.dimensions?.adjustedSize && selfOrigin) {
    const baseRadius = Number(scaledAct.target?.template?.size) || 0;
    const tokenExtra = Math.max(Number(t.document.width) || 1, Number(t.document.height) || 1) * canvas.grid.distance / 2;
    patch.distance = game.modules.get('midi-qol')?.active
      ? Math.ceil(baseRadius + tokenExtra) + 0.000001
      : baseRadius + tokenExtra;
  }
  if (!selfOrigin) checkRange(t, scaledAct, patch);

  doc.updateSource(patch);
  const shape = template._computeShape();
  const placement = {x: doc.x, y: doc.y, direction: doc.direction, distance: doc.distance, t: doc.t};
  const outline = shape.points
    ? {points: Array.from(shape.points)}
    : Number.isFinite(shape.radius)
      ? {radius: shape.radius}
      : {x: shape.x, y: shape.y, w: shape.width, h: shape.height};
  const coverage = computeTemplateCoverage(template, shape, t, scaledAct);
  const covered = coverage.tokens.map(tok => ({id: tok.id, name: tokenVisibleName(tok, true)}));
  const ticket = saveTicket(templateTickets, {
    scene: canvas.scene.id,
    source: t.id,
    origin: xy(t.center),
    key: cmd.key,
    slot: cmd.slot || '',
    placement,
    coveredIds: covered.map(c => c.id),
    autoTarget: coverage.autoTarget
  });

  return {
    planId: cmd.planId || '',
    seq: Number(cmd.seq) || 0,
    ticket,
    placement,
    outline,
    covered,
    coverageRule: coverage.rule
  };
}

function confirmedTemplate(act, placement, preCheck) {
  let consumed = false;
  const preHook = Hooks.on('dnd5e.preActivityConsumption', used => {
    if (used.uuid !== act.uuid && used.item?.system?.linkedActivity?.uuid !== act.uuid) return;
    if (preCheck && !preCheck()) return false;
  });
  const hook = Hooks.on('dnd5e.createActivityTemplate', (used, templates) => {
    if (used.uuid !== act.uuid && used.item?.system?.linkedActivity?.uuid !== act.uuid) return;
    for (const template of templates) {
      template.drawPreview = async () => {
        if (templates.length !== 1) fail('当前能力需要多个模板，请在电脑选择');
        const patch = {x: placement.x, y: placement.y, direction: placement.direction};
        if (Number.isFinite(placement.distance)) patch.distance = placement.distance;
        template.document.updateSource(patch);
        const created = await canvas.scene.createEmbeddedDocuments('MeasuredTemplate', [template.document.toObject()]);
        consumed = !!created?.length;
        return created;
      };
    }
  });
  return {
    release: () => {
      Hooks.off('dnd5e.preActivityConsumption', preHook);
      Hooks.off('dnd5e.createActivityTemplate', hook);
    },
    created: () => consumed
  };
}

async function cast(t, cmd) {
  const {act, info} = getAction(t, cmd.key);
  if (game.paused) fail('游戏已暂停');
  if (game.modules.get('midi-qol')?.active && globalThis.MidiQOL?.configSettings?.()?.undoWorkflow && !game.users.activeGM) {
    fail('本世界的战斗撤销记录需要在线 GM，请先连接 GM');
  }
  if (info.consumesUses && info.uses === 0) fail('物品次数已用完');
  if (info.needsSlot && !slotEntries(t.actor).some(s => s.id === cmd.slot && s.level >= info.level && s.value > 0)) {
    fail('所选法术位不足，请重新选择');
  }

  const ids = Array.isArray(cmd.targets) ? [...new Set(cmd.targets)] : [];
  let targets = info.mode === 'self' ? [t] : info.mode === 'target' ? ids.map(id => target(t, id)) : [];
  if (info.mode === 'target' && (!targets.length || targets.length > info.max)) fail('目标数量不正确');
  if (info.mode === 'target') {
    for (const other of targets) {
      const anchor = cmd.anchors?.[other.id];
      if (!validPoint(anchor) || Math.hypot(anchor.x - other.center.x, anchor.y - other.center.y) > 1) {
        fail('目标已经移动，请重新选择');
      }
      checkRange(t, act, other.center);
    }
  }
  if (info.mode === 'teleport') return teleport(t, act, info, cmd);

  let usedActivity = act;
  let templateGuard = null;
  if (info.mode === 'area') {
    const fresh = templatePlacement(t, act, info, cmd);
    const saved = cmd.ticket ? templateTickets.get(cmd.ticket) : null;
    if (saved && (saved.scene !== canvas.scene.id || saved.source !== t.id || saved.key !== cmd.key
      || Math.hypot(saved.placement.x - fresh.placement.x, saved.placement.y - fresh.placement.y) > 2)) {
      fail('模板落点已变动，请重新确认');
    }
    usedActivity = prepareAreaActivity(act);
    // Match desktop Combat Panel: when Midi autoTarget is 'none', supply authoritative visible covered targets.
    if (fresh.covered.length && (fresh.coverageRule !== 'coreGrid')) {
      const midiAuto = (() => {
        try {
          const ov = act.midiProperties?.autoTargetAction;
          return ov && ov !== 'default' ? ov : (globalThis.MidiQOL?.configSettings?.()?.autoTarget ?? 'always');
        } catch { return 'always'; }
      })();
      if (midiAuto === 'none') {
        targets = fresh.covered.map(c => canvas.tokens.get(c.id)).filter(tok => directlyVisible(tok));
      }
    }
    templateGuard = confirmedTemplate(usedActivity, fresh.placement, () => !game.paused && directlyVisible(t));
  }

  const before = [...game.user.targets];
  try {
    setTargets(targets);
    const usage = {
      midiOptions: {
        targetUuids: targets.map(o => o.document.uuid),
        configureDialog: false,
        workflowOptions: {targetConfirmation: 'none', autoFastAttack: true, autoFastDamage: true}
      }
    };
    if (info.needsSlot) usage.spell = {slot: cmd.slot};
    if (templateGuard) usage.create = {measuredTemplate: true};
    const result = await usedActivity.use(usage, {configure: false});
    if (!result || result.aborted) fail('施放取消或未通过当前世界规则');
    return {message: '已提交：' + info.name};
  } finally {
    templateGuard?.release();
    setTargets(before.filter(tok => directlyVisible(tok)));
  }
}

async function teleport(t, act, info, cmd) {
  if (!within(cmd.point)) fail('请选择可见的空地');
  const d = t.document;
  const pos = snapTokenStep(t, cmd.point);
  const dest = waypointCenter(t, pos);
  const valid = () => canvas.grid.measurePath([t.center, dest]).distance <= 30.001
    && (!canvas.visibility.tokenVision || canvas.visibility.testVisibility(dest, {tolerance: 0}))
    && !canvas.tokens.placeables.some(other => other !== t && other.bounds.intersects(new PIXI.Rectangle(pos.x + 1, pos.y + 1, t.w - 2, t.h - 2)));
  if (!valid()) fail('落点不可用，请选择 30 尺内可见的空地');
  const adapter = game.modules.get('fvtt-automation-repair')?.active
    ? await import(foundry.utils.getRoute('modules/fvtt-automation-repair/scripts/hud-teleport-1.js')).catch(() => null)
    : null;
  const dedicated = adapter
    ? adapter.teleportWorkflow(act)
    : act.item.flags?.['chris-premades']?.info?.identifier
      || act.item.flags?.['midi-qol']?.onUseMacroName
      || act.item.flags?.autoanimations?.primary?.video?.menuType === 'teleportation';
  if (dedicated) fail('此传送由桌面十字选点宏接管，请在 PL 窗口施放；尚未消费');
  const use = {midiOptions: {targetUuids: [d.uuid], workflowOptions: {targetConfirmation: 'none'}}};
  if (info.needsSlot) use.spell = {slot: cmd.slot};
  const used = await act.use(use, {configure: false});
  if (!used || used.aborted) fail('传送施放已取消');
  if (!valid()) fail('施法后落点发生变化，请 DM 检查施法记录');
  const moved = await d.move([{...pos, action: 'blink'}], {method: 'api', constrainOptions: {ignoreWalls: true}});
  const landed = moved && Math.hypot(d._source.x - pos.x, d._source.y - pos.y) < 1;
  return {message: landed ? '已传送' : '法术已使用，请核对世界规则允许的实际落点'};
}

export async function dispatch(cmd) {
  if (cmd.op === 'view') {
    player();
    if (cmd.scene !== canvas.scene.id || !validPoint(cmd.center) || ![cmd.width, cmd.height].every(v => Number.isFinite(v) && v > 0 && v < 1000000)) {
      fail('无效的地图视口');
    }
    const screen = canvas.app.renderer.screen, rect = canvas.dimensions.sceneRect;
    const x = Math.max(rect.x, Math.min(rect.right, cmd.center.x));
    const y = Math.max(rect.y, Math.min(rect.bottom, cmd.center.y));
    canvas.pan({x, y, scale: 0.94 * Math.min(screen.width / cmd.width, screen.height / cmd.height)});
    return {ok: true};
  }
  if (cmd.op === 'tokenInspect') {
    player();
    if (cmd.scene && cmd.scene !== canvas.scene.id) return {inspection: null, seq: Number(cmd.seq) || 0};
    if (!cmd.target) return {inspection: null, seq: Number(cmd.seq) || 0};
    return {inspection: inspectVisibleToken(cmd.target), seq: Number(cmd.seq) || 0};
  }
  const t = source();
  if (cmd.op === 'sheet') return sheet();
  if (cmd.op === 'portrait') return displayIcon(t.actor.img);
  if (cmd.op === 'icon') return displayIcon(t.actor.items.get(String(cmd.key).split('/')[0])?.img);
  checkContext(t, cmd);
  if (cmd.op === 'predict') return prediction(t, cmd);
  if (cmd.op === 'template') {
    const {act, info} = getAction(t, cmd.key);
    return templatePlacement(t, act, info, cmd);
  }
  if (cmd.op === 'route') {
    const {planId, seq, ticket, cost, budget, reason, preview, end} = makePath(t, cmd);
    return {planId, seq, ticket, cost, budget, reason, preview, end};
  }
  if (cmd.op === 'move') {
    const computed = makePath(t, cmd);
    if (computed.reason) fail(computed.reason);
    const saved = cmd.ticket ? routeTickets.get(cmd.ticket) : null;
    if (saved && (saved.scene !== canvas.scene.id || saved.source !== t.id
      || Math.hypot(saved.end.x - computed.end.x, saved.end.y - computed.end.y) > 2)) {
      fail('路径落点已变动，请重新确认');
    }
    if (!await t.document.move(computed.steps, {method: 'api', showRuler: true})) fail('移动被世界规则阻止');
    const end = computed.steps.at(-1);
    const actual = t.document._source;
    const center = waypointCenter(t, actual);
    return {
      message: Math.hypot(end.x - actual.x, end.y - actual.y) < 1 ? '移动完成' : '仅移动到可达位置',
      position: center
    };
  }
  if (cmd.op === 'cast') return cast(t, cmd);
  fail('未知操作');
}
