import {panelTheme} from './panel-theme-3.mjs';

const fail = message => { throw Error(message); };
const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const xy = p => ({x: p.x, y: p.y});
const list = value => Array.from(value?.contents ?? value ?? []);
const first = value => value?.first?.() ?? list(value)[0] ?? null;

function cloneItemPrepared(item, updates) {
  // Item5e.clone already prepares the item and finalizes its activities.
  return item.clone(updates, {keepId: true});
}

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

function ownsCombatant(c) {
  return !!(c?.actor?.isOwner || c?.token?.object?.isOwner);
}

function visibleCombatant(c, visibleTokens) {
  if (!c || c.hidden) return false;
  const doc = c.token;
  if (doc?.hidden || doc?.isSecret) return false;
  if (doc?.object) return visibleTokens ? visibleTokens.has(doc.object) : directlyVisible(doc.object);
  return !!c.actor?.isOwner;
}

function combatState(visibleTokens) {
  const combat = game.combat;
  if (!combat?.started) return null;
  const turn = Number(combat.turn) || 0, activeId = combat.combatant?.id;
  const visible = new Set(visibleTokens);
  const rows = (combat.turns ?? []).map(c => {
    if (!visibleCombatant(c, visible)) return null;
    const tok = c.token?.object;
    return {
      id: c.id,
      name: tok ? tokenVisibleName(tok, false) : (c.actor?.isOwner ? c.name : '未知单位'),
      initiative: Number.isFinite(c.initiative) ? c.initiative : null,
      active: c.id === activeId,
      isMine: ownsCombatant(c),
      defeated: !!(c.isDefeated || c.defeated)
    };
  });
  const entries = rows.filter(Boolean), active = entries.find(entry => entry.active);
  let turnsUntilMine = null, steps = 0;
  // Count only turns the player can see, wrapping around the initiative order once.
  for (let offset = 0; activeId && offset < rows.length; offset++) {
    const entry = rows[(turn + offset) % rows.length];
    if (!entry || (offset && entry.defeated && combat.settings?.skipDefeated)) continue;
    if (offset) steps++;
    if (entry.isMine && !entry.defeated) { turnsUntilMine = steps; break; }
  }
  return {
    id: combat.id, round: Number(combat.round) || 1, turn,
    activeName: active?.name || '未知单位', isMyTurn: !!active?.isMine, turnsUntilMine, entries
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
      || String(a.id).localeCompare(String(b.id)));
  const ownedTokens = visibleTokens.filter(tok => tok.isOwner)
    .sort((a, b) => (Number(a.document.sort) || 0) - (Number(b.document.sort) || 0)
      || String(a.name).localeCompare(String(b.name)))
    .map(tok => ({id: tok.id, name: tok.name, actorId: tok.actor.id, active: tok.id === t?.id}));

  const srcRow = t ? {
    ...tokenRow(t),
    ...waypointCenter(t, t.document._source),
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
    targets: visibleTokens.map(tokenRow),
    ownedTokens,
    combat: combatState(visibleTokens),
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
  const current = uses.value == null || uses.value === '' ? NaN : Number(uses.value);
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
  const charges = [];
  for (const cost of list(a?.consumption?.targets)) {
    if (cost.combatOnly && !actor.inCombat) continue;
    if (cost.type === 'activityUses') {
      const source = cost.target ? item.system.activities.get(cost.target) : a;
      const pool = parseUsesPool(source?.uses);
      if (pool) charges.push({...pool, kind: 'activity', label: source.name || item.name, consumes: true});
    } else if (cost.type === 'itemUses') {
      const source = cost.target ? resolveConsumptionItem(actor, cost.target) : item;
      const pool = parseUsesPool(source?.system?.uses);
      if (pool) charges.push({...pool, kind: source === item ? 'item' : 'resource',
        label: source.system.uses.label || source.name, consumes: true});
    }
  }
  const consumed = charges.find(charge => charge.value === 0) ?? charges[0];
  if (consumed) return consumed;
  const activityPool = parseUsesPool(a?.uses);
  if (activityPool) return {...activityPool, kind: 'activity', label: a.name || item.name, consumes: false};
  const itemPool = parseUsesPool(item.system?.uses);
  if (itemPool) return {...itemPool, kind: 'item', label: item.system.uses.label || item.name, consumes: false};
  return null;
}

function anchoredArea(act, templateType) {
  return act.range?.units === 'self' || ['emanation', 'emanationNoTemplate'].includes(templateType)
    || (!act.range?.units && ['radius', 'squareRadius'].includes(templateType));
}

function templateSpecFor(act) {
  const template = act.target?.template;
  const templateType = template?.type || '';
  if (!templateType) return null;
  const anchored = anchoredArea(act, templateType);
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

const ID = 'fvtt-combat-panel';

export function matchesFreeSource(resource, item) {
  const meta = resource?.flags?.[ID]?.freeCast;
  return Boolean(item?.id && resource?.type === 'feat' && resource.id !== item.id
    && meta && (meta.itemId ?? meta.spellId) === item.id);
}


function freeConsumptionTargets(item, activity, sourceId) {
  const original = item.type === 'spell'
    ? Array.from(activity.consumption?.targets ?? [], t => t.toObject?.() ?? structuredClone(t)) : [];
  if (original.some(cost => cost.type === 'itemUses' && cost.target === sourceId)) return original;
  return [...original, {type:'itemUses', target:sourceId, value:'1', scaling:{mode:'',formula:''}}];
}

function poolUses(uses) {
  return parseUsesPool(uses) ?? {value: 0, max: 0};
}

function itemFreeUseOption(item, level) {
  const uses = item?.system?.uses;
  const { value, max } = poolUses(uses);
  if (max <= 0) return null;
  return {
    key: 'item', kind: 'item',
    level: Number(level) || Number(item?.system?.level) || 0,
    label: String(uses?.label || '免费次数'), value, max,
    period: uses?.recovery?.[0]?.period || 'manual'
  };
}


function resourceMeta(actor, item, activities) {
  const charges = list(activities).flatMap(activity => {
    const charge = activityCharge(actor, item, activity);
    return charge ? [{...charge, activityId: activity.id}] : [];
  });
  const consumed = charges.find(charge => charge.consumes);
  if (consumed) return consumed;
  const own = poolUses(item?.system?.uses);
  if (own.max > 0) return {
    kind: 'item', label: item?.system?.uses?.label || item?.name,
    ...own, activityId: null
  };
  return charges[0] ?? null;
}

function baneTargetPlan(item, activity, level) {
  if (item?.type !== 'spell' || activity?.target?.template?.type
    || activity?.type === 'forward' || /bolt/i.test(activity?.identifier || '')) return null;
  const bane = item.system?.identifier === 'bane'
    || item.flags?.['chris-premades']?.info?.identifier === 'bane'
    || /bane|灾祸术/i.test(item.name || '');
  if (!bane) return null;
  const baseLevel = Number(item.system?.level) || 1;
  const castLevel = Math.max(baseLevel, Number(level) || baseLevel);
  return { repeat: false, max: 3 + Math.max(0, castLevel - baseLevel), spell: 'bane' };
}


function isTransferActivity(item, activity) {
  if (!activity) return false;
  const identifier = item?.system?.identifier;
  if (identifier === 'hunters-mark' || item.flags?.['chris-premades']?.info?.identifier === 'huntersMark') {
    const moveId = item.flags?.['chris-premades']?.activityIdentifiers?.huntersMarkMove;
    return Boolean((moveId && activity.id === moveId) || /move|转移/i.test(activity.name || ''));
  }
  return identifier === 'vow-of-enmity'
    && (/transfer|转移|换目标/i.test(activity.name || '') || activity.flags?.dsh?.transfer === true);
}

const usesLeft = item => poolUses(item?.system?.uses);

function witchBoltFollowup(item, activity) {
  return activity.type === 'damage' && /witch[\s_-]*bolt|巫术箭/i.test(identity(item))
    && (['action', 'bonus'].includes(activity.activation?.type)
      || /witchBolt(?:Damage|Activate)|sustain|repeat|持续|维持/i.test(activity.identifier || activity.name || ''));
}

function needsSpellSlot(item, activity) {
  return item.type === 'spell' && Number(item.system?.level) > 0 && activity.type !== 'forward'
    && activity.requiresSpellSlot !== false && activity.consumption?.spellSlot !== false
    && !witchBoltFollowup(item, activity) && !isTransferActivity(item, activity);
}

export function spellOptions(actor, item, activity) {
  const level = Number(item.system?.level) || 0;
  if (activity.type === 'forward') {
    const charge = activityCharge(actor, item, activity);
    return [{key:'native',kind:'native',level,label:activity.name || '免费施法',
      value:charge?.consumes ? charge.value : 1,max:charge?.consumes ? charge.max : 1}];
  }
  const consumes = needsSpellSlot(item, activity);
  const out = [];
  if (consumes) for (const slot of slotEntries(actor)) {
    if (slot.level < level) continue;
    out.push({...slot, key: slot.id, label:`${slot.level} 环${slot.id === 'pact' ? ' · 契约' : ''}`, kind: 'slot'});
  }
  if (!consumes) out.push({key:'native',level,label:item.type!=='spell'?'使用':level?`${level} 环 · 原生施放`:'戏法',kind:'native',value:1,max:1});

  if (!consumes && item.type === 'spell') return out;
  const itemFree = item.type === 'spell' ? itemFreeUseOption(item, level) : null;
  if (itemFree) out.push(itemFree);
  for (const resource of list(actor.items)) {
    const meta = resource.flags?.[ID]?.freeCast;
    if (!matchesFreeSource(resource,item) || meta.disabled) continue;
    const uses = usesLeft(resource);
    out.push({key:resource.id,level,kind:'free',label:meta.source || resource.name,...uses,period:meta.period || 'lr'});
  }
  const rank = o => o.kind === 'free' ? 2 : o.kind === 'item' ? 1 : 0;
  return out.sort((a,b)=>rank(a)-rank(b) || a.level-b.level);
}

const REASONS = Object.freeze({
  WEAPON: 'weapon', WEAPON_LEGACY: 'weapon-legacy',
  ACTIVE_COMBAT: 'active-combat', ACTIVE_UTILITY: 'active-utility',
  CONSUMABLE_COMBAT: 'consumable-combat', CONSUMABLE_UTILITY: 'consumable-utility',
  THIRD_PARTY: 'third-party-automation', SPECIAL_USES: 'special-uses',
  PASSIVE: 'passive', NO_ACTIVITY: 'no-activity', NON_COMBAT_UTILITY: 'non-combat-utility',
  DUPLICATE: 'duplicate', UNKNOWN: 'unknown-keep',
  SPELL: 'spell', SPELL_LEGACY: 'spell-legacy', UNCERTAIN: 'uncertain',
  UNPREPARED: 'spell-unprepared', NO_SLOT_CAPACITY: 'spell-no-slot-capacity'
});

const str = x => typeof x === 'string' ? x : '';

const positive = x => {
  if (typeof x !== 'number' && typeof x !== 'string') return false;
  const n = Number(x);
  return Number.isFinite(n) && n > 0;
};

function hasMacro(value) {
  const pending = [value], seen = new Set();
  while (pending.length) {
    const v = pending.pop();
    if (typeof v === 'string' && v.trim()) return true;
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    pending.push(...Object.values(v));
  }
  return false;
}
const groupOf = item => item?.type === 'spell' ? 'spells' : item?.type === 'feat' ? 'features'
  : ['weapon', 'equipment', 'consumable', 'tool'].includes(item?.type) ? 'equipment' : 'unknown';
const activeTypes = new Set(['action', 'bonus', 'reaction', 'reactiondamage', 'reactionmanual', 'reactionpreattack', 'legendary', 'lair']);
const combatTypes = new Set(['attack', 'save', 'damage', 'heal', 'enchant', 'summon', 'transform', 'cast']);
const knownTypes = new Set([...combatTypes, 'utility', 'check']);
const idOf = item => typeof item?.id === 'string' || typeof item?.id === 'number' ? String(item.id) : null;

function spellPrepared(item) {
  const system = item?.system ?? {};
  if (Number(system.level) === 0) return true;
  if (system.prepared !== undefined) return system.prepared === true || positive(system.prepared);
  const legacy = system.preparation;
  if (legacy?.mode === 'always') return true;
  if (legacy?.prepared !== undefined) return legacy.prepared === true || positive(legacy.prepared);
  return true;
}

function hasSpellSlotCapacity(actor, level) {
  if (level < 1 || !actor) return true;
  return Object.entries(actor.system?.spells ?? {}).some(([key, pool]) => {
    if (!positive(pool?.max)) return false;
    const slotLevel = key === 'pact' ? Number(pool.level) : Number(key.match(/^spell([1-9])$/)?.[1]);
    return Number.isFinite(slotLevel) && slotLevel >= level;
  });
}

function evaluateItem(item, options = {}) {
  options ??= {};
  const bucket = str(options.group) || groupOf(item);
  const result = (include, reasons, label, duplicateOf = null) => ({include, bucket, reasons, label, duplicateOf});
  if (options.duplicateOf != null && ['string', 'number'].includes(typeof options.duplicateOf))
    return result(false, [REASONS.DUPLICATE], '默认推荐已保留同类首项', String(options.duplicateOf));
  if (!item || typeof item !== 'object') return result(false, [REASONS.UNCERTAIN], '数据缺失，无法确定用途');

  const acts = list(options.activities).filter(a => a && typeof a === 'object'
    && !a.midiProperties?.automationOnly && a.canUse !== false);
  if (bucket === 'spells' || item.type === 'spell') {
    if (!spellPrepared(item))
      return result(false, [REASONS.UNPREPARED], '未准备，默认隐藏；可手动启用');
    if (!hasSpellSlotCapacity(options.actor, Number(item.system?.level) || 0)
      && !acts.some(act => !needsSpellSlot(item, act) || spellOptions(options.actor,item,act).some(o => ['free','item'].includes(o.kind))))
      return result(false, [REASONS.NO_SLOT_CAPACITY], '无可用环位上限，默认隐藏；可手动启用');
    return result(true, [acts.length ? REASONS.SPELL : REASONS.SPELL_LEGACY], acts.length ? '保留法术的全部施放用途' : '旧式法术保留原生施放入口');
  }
  if (item.type === 'weapon')
    return result(true, [acts.length ? REASONS.WEAPON : REASONS.WEAPON_LEGACY], '保留武器攻击入口');
  if (!acts.length) return result(false, [REASONS.NO_ACTIVITY, ...(item.type === 'feat' ? [REASONS.PASSIVE] : [])], '无可用活动，默认不占快捷格');
  const macros = item.flags?.['chris-premades']?.macros;
  const automated = hasMacro(item.flags?.['midi-qol']?.onUseMacroName) || hasMacro(item.flags?.itemacro?.macro?.command) || hasMacro(macros?.item) || hasMacro(macros?.midi?.item);
  const equipment = ['equipment', 'consumable', 'tool', 'container', 'loot'].includes(item.type);
  const reasons = new Set();
  for (const a of acts) {
    const activation = str(a.activation?.type);
    const uses = positive(item.system?.uses?.max) || positive(a.uses?.max);
    const consumption = list(a.consumption?.targets).length > 0;
    const effects = list(a.effects).length > 0 || list(item.effects).some(e => e && !e.disabled);
    const special = activation === 'special';
    if (special && !(uses || automated || effects)) continue;
    if (!activeTypes.has(activation) && !special) {
      if (activation && !['minute', 'hour', 'day'].includes(activation)) reasons.add(REASONS.UNKNOWN);
      continue;
    }
    const targetType = str(a.target?.affects?.type);
    const self = targetType === 'self' || (!targetType && a.range?.units === 'self');
    const target = !self && (positive(a.target?.affects?.count) || Boolean(str(a.target?.template?.type)));
    const payload = combatTypes.has(a.type) || list(a.damage?.parts).length > 0
      || list(a.save?.ability).length > 0 || positive(a.save?.dc?.value) || Boolean(str(a.save?.dc?.formula))
      || positive(a.healing?.number) || Boolean(str(a.healing?.bonus)) || list(a.healing?.types).length > 0;

    if (equipment && knownTypes.has(a.type) && !payload && !target && !effects && !automated) continue;
    if (payload || target) reasons.add(item.type === 'consumable' ? REASONS.CONSUMABLE_COMBAT : REASONS.ACTIVE_COMBAT);
    else if (special && uses) reasons.add(REASONS.SPECIAL_USES);
    else if (effects || uses || consumption || automated) reasons.add(item.type === 'consumable' ? REASONS.CONSUMABLE_UTILITY : REASONS.ACTIVE_UTILITY);
    else if (!knownTypes.has(a.type) || (!equipment && !targetType && (!self || a.target?.prompt === true))) reasons.add(REASONS.UNKNOWN);
    if (automated) reasons.add(REASONS.THIRD_PARTY);
  }
  if (reasons.size) return result(true, [...reasons], reasons.has(REASONS.UNKNOWN) ? '用途不确定，有主动迹象，暂保留' : '有主动战斗或资源效果用途');
  return result(false, [equipment ? REASONS.NON_COMBAT_UTILITY : REASONS.PASSIVE], equipment ? '普通工具用途，默认不占快捷格' : '未见主动战斗用途，默认不占格');
}

function signature(item, acts) {
  const name = str(item?.name).toLowerCase().replace(/[\s\p{P}]/gu, '');
  if (!name || !idOf(item)) return null;
  return JSON.stringify([str(item.type), name, list(acts).filter(Boolean)
    .map(a => [str(a.type), str(a.activation?.type)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}


function curateGroup(items, options = {}) {
  options ??= {};
  const input = list(items), kept = [], decisions = [], seen = new Map();
  for (const item of input) {
    const activities = typeof options.activitiesOf === 'function' ? options.activitiesOf(item) : [];
    let decision = evaluateItem(item, {group: options.group, actor: options.actor, activities});
    const key = signature(item, activities), first = key == null ? null : seen.get(key);
    if (decision.include && first != null && first !== idOf(item))
      decision = evaluateItem(item, {group: options.group, actor: options.actor, activities, duplicateOf: first});
    if (decision.include) {
      kept.push(item);
      if (key != null && first == null) seen.set(key, idOf(item));
    }
    decisions.push({itemId: idOf(item), ...decision});
  }
  return {items: kept, decisions, stats: {total: input.length, included: kept.length,
    excluded: input.length - kept.length, duplicates: decisions.filter(d => d.duplicateOf !== null).length}};
}

const identity=item=>[item.system?.identifier,item.flags?.['chris-premades']?.info?.identifier,item.name].filter(Boolean).join('|');

function eldritchBlastBeam(item, activity) {
  const cpr = item?.flags?.['chris-premades'];
  if (cpr?.info?.identifier !== 'eldritchBlast' || !cpr.macros?.midi?.item?.includes('eldritchBlast')) return null;
  if (!activity?.id || activity.id !== cpr.activityIdentifiers?.eldritchBlast) return null;
  const beam = item.system.activities.get(cpr.activityIdentifiers.eldritchBlastBeam);
  return beam?.type === 'attack' ? beam : null;
}

function targetPlan(item,activity,level) {
  if(activity?.target?.template?.type)return null;
  if(item?.type!=='spell'){const n=Number(activity?.target?.affects?.count);return Number.isInteger(n)&&n>1&&n<=100?{repeat:false,max:n,spell:'multi'}:null;}
  const id=identity(item),cast=Math.max(Number(item.system.level)||0,Number(level)||0);
  const cpr=item.flags?.['chris-premades']?.activityIdentifiers??{};
  if(cpr.scorchingRayBolt===activity.id)return null;
  if(cpr.magicMissileBolt===activity.id||/magic-missile-bolt/i.test(activity.identifier||''))return null;
  if (eldritchBlastBeam(item, activity) || (activity.type === 'attack' && /eldritch.?blast|魔能爆|魔能爆裂/i.test(id))) {
    const actor = item.actor;
    const details = actor?.system?.details;
    const casterLevel = Number(actor?.type === 'npc' ? details?.cr : details?.level) || 0;
    const beams = 1 + [5,11,17].filter(threshold => casterLevel >= threshold).length;

    return beams > 1 || eldritchBlastBeam(item, activity) ? { repeat: true, max: beams, spell: 'eldritchBlast' } : null;
  }
  if(/magic.?missile|魔法飞弹/i.test(id))return {repeat:true,max:cast+2,spell:'magicMissile'};
  if(/(?:^|\|)scorching-?ray(?:\||$)|灼热射线|\bscorching ray\b/i.test(id))return {repeat:true,max:Math.max(3,cast+1),spell:'scorchingRay'};
  if(/(?:^|\|)bless(?:\||$)|祝福术|^Bless(?:\||$)/i.test(id))return {repeat:false,max:3+Math.max(0,cast-1),spell:'bless'};
  const bane=baneTargetPlan(item,activity,level);
  if(bane)return bane;
  let scaled=activity;
  const delta=Math.max(0,cast-Number(item.system.level||0));
  let clone;
  if (delta) {
    clone = cloneItemPrepared(item, {'flags.dnd5e.scaling':delta});
    scaled = clone.system.activities.get(activity.id);
  }
  let n=Number(scaled?.target?.affects?.count);


  if (!(n>1) && delta) {
    const declared=clone.system.target;
    if (!declared?.template?.type && ['creature','ally','enemy'].includes(declared?.affects?.type)) n=Number(declared.affects.count)||n;
  }

  const normalized=id.toLowerCase().replace(/[’'\s_-]/g,'');
  if (!(n>1) && delta && activity.type==='save' &&
      (/(?:^|\|)command(?:\||$)|命令术/.test(normalized) || /(?:tashas)?hideouslaughter|塔莎狂笑术/.test(normalized))) n=1+delta;
  return Number.isInteger(n)&&n>1&&n<=100?{repeat:false,max:n,spell:'multi'}:null;
}

function rayActivity(item,activity) {
  const id=item.flags?.['chris-premades']?.activityIdentifiers?.scorchingRayBolt;
  const bolt=id?item.system.activities.get(id):activity;
  if(bolt?.type!=='attack')throw Error('此灼热射线没有可用的攻击活动，请检查物品配置');
  return bolt;
}

function missileBolt(item, activity) {
  const activities=list(item.system?.activities);
  const id=item.flags?.['chris-premades']?.activityIdentifiers?.magicMissileBolt;
  const assigned=id?item.system.activities.get(id):null;
  if(assigned?.type==='damage')return assigned;
  const selected=activity?.id?item.system.activities.get(activity.id):null;
  if(selected?.type==='damage')return selected;
  const damage=activities.filter(candidate=>candidate.type==='damage');
  const named=damage.filter(candidate=>/magicmissilebolt/.test(String(candidate.identifier||'').replace(/[\s_-]/g,'').toLowerCase()));
  if(named.length===1)return named[0];
  if(damage.length===1)return damage[0];
  if(damage.length>1)throw Error('此魔法飞弹有多个伤害活动，请先选择要使用的伤害活动');
  throw Error('此魔法飞弹没有可用的伤害活动，请检查物品配置');
}

function prepareMultiActivity(item,activity,plan) {
  const update={};const prefix=`system.activities.${activity.id}`;
  update[`${prefix}.target.override`]=true;
  update[`${prefix}.target.prompt`]=false;
  update[`${prefix}.target.template.type`]='';
  update[`${prefix}.target.affects.type`]='creature';
  update[`${prefix}.target.affects.count`]=String(plan.bolt?1:plan.max);
  update[`${prefix}.midiProperties.confirmTargets`]='never';
  if (plan.shielded) update[`${prefix}.damage.parts`] = [];
  if(plan.repeat){

    const dispatcher=plan.spell;
    const macros=item.flags?.['chris-premades']?.macros?.midi?.item;
    const ids = item.flags?.['chris-premades']?.activityIdentifiers;
    const cprChildId = ids?.[dispatcher + (dispatcher === 'eldritchBlast' ? 'Beam' : 'Bolt')];
    if (Array.isArray(macros) && activity.id !== cprChildId) {
      update['flags.chris-premades.macros.midi.item'] = macros.filter(m=>m!==dispatcher);
    }
    update[`${prefix}.attackRollPerTarget`]='never';
    if(plan.subsequent){
      update[`${prefix}.activation.override`]=true;update[`${prefix}.activation.type`]='special';
      update[`${prefix}.consumption.spellSlot`]=false;update[`${prefix}.consumption.targets`]=[];
    }
  }
  const clone=cloneItemPrepared(item, update);
  return clone.system.activities.get(activity.id);
}

function areaChoicePlan(item, activity) {
  const target = activity?.target;
  const count = String(target?.affects?.count ?? '').trim();
  if (!target || !anchoredArea(activity, target.template?.type)
    || !['radius', 'squareRadius', 'emanation', 'emanationNoTemplate'].includes(target.template?.type)
    || !(Number(target.template.size) > 0)
    || (count !== '' && Number(count) !== 0)
    || !['creature', 'ally', 'enemy', 'willing'].includes(target.affects?.type)) return null;
  const identity = [item?.system?.identifier, item?.flags?.['chris-premades']?.info?.identifier, item?.name]
    .filter(Boolean).join('|').toLowerCase().replace(/[\s_-]/g, '');

  const radiance = /radianceofthedawn|黎明曙光/.test(identity)
    && item?.system?.source?.rules === '2024';
  if (!target.affects.choice && !radiance) return null;
  return {areaChoice: true, repeat: false, max: Infinity, spell: 'areaChoice'};
}


const rinse = value => String(value ?? '').replace(/\s+/g, '').toLowerCase();
const text = value => typeof value === 'function' ? Function.prototype.toString.call(value) : String(value ?? '');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cprEntries(activity) {
  const item = activity.item, cpr = globalThis.chrisPremades;
  if (!globalThis.game?.modules?.get('chris-premades')?.active || !cpr?.utils) return [];
  const flags = item.flags?.['chris-premades'] ?? {};
  const identifier = cpr.utils.activityUtils?.getIdentifier?.(activity)
    ?? Object.keys(flags.activityIdentifiers ?? {}).find(key => flags.activityIdentifiers[key] === activity.id);
  const rules = cpr.utils.genericUtils?.getRules?.(item) ?? flags.info?.rules ?? 'legacy';
  const entries = [];
  for (const key of flags.macros?.midi?.item ?? []) {
    if (key === 'genericTeleport') {
      const config = cpr.utils.itemUtils?.getGenericFeatureConfig?.(item, key);
      if (config?.activities?.length && !config.activities.includes(activity.id)) continue;
    }
    const macro = cpr.utils.macroUtils?.getMacro?.(key, rules);
    for (const entry of macro?.midi?.item ?? []) {
      if (entry.activities?.length && !entry.activities.includes(identifier)) continue;
      entries.push({source:`cpr:${key}`, command:text(entry.macro)});
    }
  }
  for (const entity of [item, activity]) {
    for (const entry of cpr.utils.macroUtils?.getEmbeddedMacros?.(entity, 'midi.item') ?? []) {
      entries.push({source:'cpr:embedded', command:text(entry.script ?? entry.command ?? entry.macro)});
    }
  }
  return entries;
}

function itemMacroCommand(item) {
  const macro = item?.flags?.itemacro?.macro;
  return text(macro?.command ?? macro?.data?.command ?? item?.flags?.itemacro?.command ?? item?.flags?.dae?.macro?.command);
}

function midiEntries(activity) {
  const item = activity.item, entries = [];
  const names = item.flags?.['midi-qol']?.onUseMacroName ?? '';
  for (const part of String(names).split(',')) {
    const name = part.replace(/^\s*\[[^\]]*\]/, '').trim();
    if (!name) continue;
    let command;
    if (name === 'ItemMacro' || name === `ItemMacro.${item.name}`) command = itemMacroCommand(item);
    else if (name.startsWith('function.')) {
      const path = name.slice('function.'.length).split('.');
      let value = globalThis;
      for (const key of path) value = value?.[key];
      if (typeof value === 'function') command = text(value);
    } else {
      let macro;
      try { macro = globalThis.fromUuidSync?.(name); } catch { /* A world macro name is not necessarily a UUID. */ }
      macro ??= globalThis.game?.macros?.getName?.(name);
      command = macro?.documentName === 'Macro' ? macro.command : '';
    }
    if (command) entries.push({source:`midi:${name}`, command});
  }
  if (activity.macroData?.command) entries.push({source:'activity:macro', command:activity.macroData.command});
  return entries;
}

function workflowSource(command) {


  const alias = command.match(/\bworkflow\s*:\s*([\w$]+)/)?.[1];
  return alias ? command.replace(new RegExp(`(^|[^\\w$])${escapeRegex(alias)}(?=\\s*\\.)`, 'g'), '$1workflow') : command;
}

function selfPlacement(raw) {
  const command = workflowSource(raw);


  if (/\.target\(\s*\[?\s*workflow\.token\s*\]?\s*,\s*workflow\.token\s*,/.test(command)) return true;
  const groups = [...command.matchAll(/(?<![\w$])([\w$]+)\s*=\s*\[\s*workflow\.token\s*\]/g)];
  if (groups.some(([, name]) => new RegExp(`\\.group\\(\\s*${escapeRegex(name)}\\s*,\\s*workflow\\.token\\s*,`).test(command))) return true;

  return /(?:Crosshair(?:s)?\.(?:show|showCrosshairs)|crosshairs\.show|aimCrosshair)\s*\(/.test(command)
    && /workflow\.token(?:\.document)?\.update\s*\(|teleportTo\s*\(\s*(?:position|location|crosshair)/.test(command)
    && !/workflow\.(?:targets|failedSaves|hitTargets)\.(?:first|map|forEach)/.test(command);
}

function aaTeleport(activity) {
  const game = globalThis.game, item = activity.item;
  if (!game?.modules?.get('autoanimations')?.active) return null;
  const flags = item.flags?.autoanimations ?? {};
  if (flags.killAnim || flags.isEnabled === false) return null;
  if (flags.isCustomized || flags.override) {
    return flags.menu === 'preset' && flags.presetType === 'teleportation' ? 'aa:item' : null;
  }
  try {
    if (game.settings.get('autoanimations', 'disableAutoRec')) return null;


    const menus = ['melee','range','ontoken','templatefx','aura','preset']
      .flatMap(key => list(game.settings.get('autoanimations', `aaAutorec-${key}`)))
      .filter(entry => entry.label).sort((a,b) => rinse(b.label).length - rinse(a.label).length);
    const name = item.name, normalized = rinse(name);
    const entry = menus.find(e => e.advanced?.exactMatch && e.label === name)
      ?? menus.find(e => !e.advanced?.exactMatch && normalized.includes(rinse(e.label))
        && !(e.advanced?.excludedTerms ?? []).some(term => normalized.includes(rinse(term))));
    if (entry?.menu !== 'preset' || entry.presetType !== 'teleportation') return null;
    const excluded = entry.advanced?.excludedType;
    if (excluded?.enabled) {
      const value = excluded.path?.split('.').reduce((obj,key) => obj?.[key], item);
      if (rinse(value) === rinse(excluded.property)) return null;
    }
    return `aa:${entry.label}`;
  } catch { return null; }
}

function teleportWorkflow(activity, seen = new Set()) {
  if (!activity?.item || seen.has(activity)) return null;
  seen.add(activity);
  if (activity.type === 'forward') {
    const linked = activity.item.system?.activities?.get(activity.activity?.id);
    return linked ? teleportWorkflow(linked, seen) : null;
  }
  const target = activity.target ?? {}, shape = target.template?.type;
  const ownArea = ['emanationNoTemplate','emanation','radius','squareRadius'].includes(shape)
    || (activity.range?.units === 'self' && !!shape);

  if (activity.type === 'attack' || (['save','damage'].includes(activity.type) && !ownArea)) return null;
  if (shape && !ownArea) return null;
  const entries = [...cprEntries(activity), ...midiEntries(activity)];
  const self = entries.find(entry => selfPlacement(entry.command));
  if (self) return {direct:true, source:self.source, ownArea};

  if (entries.some(entry => /\bTeleport\.(?:target|group)\s*\(/.test(entry.command)
    || /\.(?:target|group)\([^;]*?,\s*workflow\.token\s*,/.test(workflowSource(entry.command)))) return null;
  if (!['utility','enchant'].includes(activity.type)) return null;
  if (['creature','ally','enemy','willing','object'].includes(target.affects?.type)) return null;
  const aa = aaTeleport(activity);
  return aa ? {direct:true, source:aa, ownArea} : null;
}

const TIME_UNITS = {turn: '回合', round: '轮', second: '秒', minute: '分钟', hour: '小时', day: '天', week: '周', month: '个月', year: '年'};
const ACTIVATION_LABELS = {
  action: '动作', bonus: '附赠动作', reaction: '反应', special: '特殊',
  shortRest: '短休', longRest: '长休', encounter: '遭遇', turnStart: '回合开始', turnEnd: '回合结束',
  legendary: '传奇动作', mythic: '神话动作', lair: '巢穴动作', crew: '船员动作'
};
const DURATION_LABELS = {inst: '立即', perm: '永久', disp: '直到被解除', dstr: '直到被解除或触发', spec: '特殊', special: '特殊'};
// checkRange compares these limits directly to the scene grid's measured distance.
const RANGE_UNITS = {ft: {label: '尺', scale: 1}, m: {label: '米', scale: 1/0.3048}, mi: {label: '英里', scale: 5280}, km: {label: '千米', scale: 1000/0.3048}};
const sceneFeet = value => value * (({m:1/0.3048,'米':1/0.3048,meters:1/0.3048,km:1000/0.3048,mi:5280})[String(globalThis.canvas?.scene?.grid?.units??'ft').toLowerCase()]??1);

function numericValue(raw) {
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function timeLabel(units, value) {
  if (!Object.hasOwn(TIME_UNITS, units)) return '';
  const count = numericValue(value);
  return count === null ? TIME_UNITS[units] : `${count} ${TIME_UNITS[units]}`;
}

function activationInfo(item, a) {
  const activation = a.activation ?? item.system?.activation;
  const type = activation?.type;
  if (typeof type !== 'string' || !type || type === 'none') return {type: '', label: ''};
  const label = timeLabel(type, activation.value ?? activation.cost ?? 1)
    || (Object.hasOwn(ACTIVATION_LABELS, type) ? ACTIVATION_LABELS[type] : a.labels?.activation || type);
  return {type, label};
}

function durationLabel(item, a) {
  const duration = a.duration ?? item.system?.duration;
  if (!duration?.units) return '';
  return timeLabel(duration.units, duration.value)
    || (Object.hasOwn(DURATION_LABELS, duration.units) ? DURATION_LABELS[duration.units] : a.labels?.duration || '');
}

function weaponAttackMode(item, activity) {
  if (item.type !== 'weapon' || activity.type !== 'attack') return '';
  const modes = list(item.system.attackModes).map(mode => mode.value);
  const ranged = (activity.attack?.type?.value || item.system.attackType) === 'ranged';
  const offhand = activity.activation?.type === 'bonus'
    && /off[\s_-]*hand|副手/i.test([activity.identifier, activity.midiProperties?.identifier, activity.name].join(' '));
  if (offhand) {
    const mode = ranged ? 'thrown-offhand' : 'offhand';
    if (modes.includes(mode)) return mode;
  }
  if (ranged && item.system.properties?.has?.('thr') && modes.includes('thrown')) return 'thrown';
  const last = item.getFlag?.('dnd5e', `last.${activity.id}.attackMode`);
  return [activity.attackMode, last, ...modes].find(mode => mode && modes.includes(mode)) ?? '';
}

function rangeInfo(item, a) {
  const grid = globalThis.canvas?.grid, distance = sceneFeet(Number(grid?.distance) || 5), size = Number(grid?.size) || 100;
  const weapon = item.type === 'weapon' && a.type === 'attack';
  const weaponRange = weapon ? item.system.range : null;
  const range = !a.range?.override && weaponRange?.units ? weaponRange : (a.range ?? weaponRange ?? {});
  let units = range.units || '', value = numericValue(range.value);
  if (witchBoltFollowup(item, a) && !Object.hasOwn(RANGE_UNITS, units)) {
    units = 'ft';
    value = item.system.source?.rules === '2014' ? 30 : 60;
  }
  if (units === 'self') return {value, units, label: '自身', ft: 0, px: 0};
  if (units === 'touch') return {value, units, label: '触及', ft: distance, px: size};

  let reachLabel = '';
  const mode = weaponAttackMode(item, a);
  const actionType = a.getActionType?.(mode);
  const melee = weapon && !mode.startsWith('thrown') && (actionType ? actionType === 'mwak'
    : (a.attack?.type?.value || item.system.attackType || (['simpleM', 'martialM'].includes(item.system.type?.value) ? 'melee' : '')) === 'melee');
  if (melee && !a.range?.override) {
    units ||= 'ft';
    value = numericValue(weaponRange?.reach)
      || (item.system.properties?.has?.('rch') ? 10 : 5) / (RANGE_UNITS[units]?.scale ?? 1);
    reachLabel = '触及 ';
  }
  const unit = RANGE_UNITS[units];
  const long = weapon && !melee && !a.range?.override ? numericValue(weaponRange?.long) : null;
  const limit = value == null ? null : Math.max(value, long ?? 0) * unit?.scale;
  const ft = Number.isFinite(limit) ? limit : null;
  const label = ft !== null ? `${reachLabel}${long > value ? `${value}/${long}` : value} ${unit.label}` : units === 'spec' ? '特殊' : units === 'any' ? '不限' : '';
  return {value, units, label, ft, px: ft > 0 ? ft * (size / distance) : null};
}

function formulaList(raw) {
  const parts = Array.isArray(raw) ? raw : [raw];
  return parts.map(part => {
    if (Array.isArray(part)) part = part[0];
    if (typeof part === 'string') return part.trim();
    if (!part) return '';
    if (typeof part.formula === 'string') return part.formula.trim();
    if (part.custom?.enabled) return typeof part.custom.formula === 'string' ? part.custom.formula.trim() : '';
    const dice = part.number > 0 && part.denomination > 0 ? `${part.number}d${part.denomination}` : '';
    const bonus = typeof part.bonus === 'string' || Number.isFinite(part.bonus) ? String(part.bonus).trim() : '';
    return [dice, bonus].filter(Boolean).join(' + ');
  }).filter(Boolean).join(' + ').slice(0, 48);
}

function damageSummary(item, a) {
  let parts = '';
  try {
    parts = formulaList(a.damage?.parts);
    if (parts && !(item.type === 'weapon' && a.damage?.includeBase)) return parts;
  } catch {} // A third-party formula getter may fail on a partially prepared item.
  try {
    return [formulaList(item.labels?.damage), parts].filter(Boolean).join(' + ').slice(0, 48);
  } catch { return parts; }
}

const damageLabels = {acid:'强酸',cold:'冷冻',fire:'火焰',force:'力场',lightning:'闪电',necrotic:'黯蚀',poison:'毒素',psychic:'心灵',radiant:'光耀',thunder:'雷鸣',bludgeoning:'钝击',piercing:'穿刺',slashing:'挥砍'};
function hiddenResource(item) {
  return item.flags?.[ID]?.freeCast || item.flags?.[ID]?.freeReaction || item.flags?.['fvtt-mobile-table']?.freeReaction;
}
function visibleActivities(item) {
  if (!item || hiddenResource(item)) return [];
  const flags = item.flags?.['chris-premades'] ?? {}, ids = flags.activityIdentifiers ?? {};
  const skip = new Set([...list(item.flags?.dnd5e?.riders?.activity), ...list(flags.hiddenActivities).flatMap(key => [key, ids[key]])]);
  const all = list(item.system?.activities);
  const forwardOnly = all.length > 0 && all.every(act => act?.type === 'forward');
  return all.filter(act => act && act.activation?.type !== 'legendary' && !skip.has(act.id) && !act.midiProperties?.automationOnly && act.canUse !== false && (act.type !== 'forward' || forwardOnly && act.item));
}
function resourceSummary(actor,item,acts) {
  const meta=resourceMeta(actor,item,acts), base=resourceMeta(actor,item,acts.slice(0,1));
  const transfer=acts.find(act=>isTransferActivity(item,act)&&Number(act.uses?.max)>0);
  const free=list(actor.items).filter(resource=>matchesFreeSource(resource,item)&&!resource.flags[ID].freeCast.disabled).map(usesLeft);
  let primary=meta ? meta.value+'/'+meta.max : '', extra=transfer ? '转'+poolUses(transfer.uses).value+'/'+transfer.uses.max : '';
  if(free.length){const badge='免'+free.reduce((n,r)=>n+r.value,0)+'/'+free.reduce((n,r)=>n+r.max,0);if(!primary)primary=badge;else if(!extra)extra=badge;}
  return primary||extra ? {primary,...(extra?{extra}:{}),depleted:base?.consumes===true && base.value<=0} : null;
}
function resistanceOptions(activity) {
  if(!/protectionfromenergy|absorbelements|防护能量|能量防护|吸收元素/i.test(identity(activity.item).replace(/[\s_-]/g,'')))return [];
  return list(activity.effects).flatMap(ref=>{const key=ref.id??ref._id, effect=activity.item.effects?.get?.(key);
    const changes=list(effect?.changes).filter(change=>change.key==='system.traits.dr.value'&&Object.hasOwn(damageLabels,change.value));
    return changes.length===1?[{key,id:changes[0].value}]:[];});
}
function cprDamageChoice(activity) {
  const flags=activity.item.flags?.['chris-premades'];
  if (!game.modules.get('chris-premades')?.active || !game.modules.get('midi-qol')?.active) return null;
  const macros = flags?.macros?.midi?.item;
  if (macros?.includes('chromaticOrb')) {
    if (flags.info?.rules === 'modern' || activity.item.system.source?.rules === '2024') {
      const types = list(globalThis.chrisPremades?.utils?.itemUtils?.getConfig?.(activity.item, 'damageTypes'));
      return {types, flag: 'flags.chris-premades.chromaticOrb.damageType'};
    }
    return {types: ['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder'], dialog: 'CHRISPREMADES.Dialog.DamageType'};
  }
  if (macros?.includes('dragonsBreath') && activity.type === 'utility') {
    return {types: ['acid', 'cold', 'fire', 'lightning', 'poison'], dialog: 'CHRISPREMADES.Dialog.DamageType'};
  }
  return null;
}
function selectableDamage(activity) {
  const sets=list(activity.damage?.parts).map(part=>list(part.types)).filter(types=>types.length>1);
  const cpr=cprDamageChoice(activity), resistance=resistanceOptions(activity);
  const choices=cpr?cpr.types:sets.length?sets[0].filter(id=>sets.every(types=>types.includes(id))):resistance.map(row=>row.id);
  return choices.length>1?[...new Set(choices)].map(id=>({id,label:damageLabels[id] || game.i18n.localize(CONFIG.DND5E?.damageTypes?.[id]?.label ?? id)})):[];
}
function multiDescription(item,activity) {
  const base=Number(item.system.level)||0, plan=targetPlan(item,activity,base);
  const symbolic=[activity._source?.target?.affects?.count,item.system?._source?.target?.affects?.count].some(n=>typeof n==='string'&&/scaling/.test(n));
  const incremental=plan?.spell==='multi' || /command|命令术|hideous.?laughter|狂笑术/i.test(identity(item)) || symbolic;
  const next=base>0 && base<9 && incremental ? targetPlan(item,activity,base+1) : null;
  if(!plan && !next)return null;
  const maxBase=plan?.max??1;
  return {...(plan??next),max:maxBase,maxBase,maxPerUpcast:['magicMissile','scorchingRay','bless','bane'].includes(plan?.spell)?1:Math.max(0,(next?.max??maxBase)-maxBase)};
}
function ownedLinkedTarget(item,act) {
  if(act.type==='attack'||act.target?.template?.type)return false;
  const identifiers=item.flags?.['chris-premades']?.activityIdentifiers??{};
  const followup=Object.keys(identifiers).some(key=>identifiers[key]===act.id && /activate|pulse|sustain|repeat|ongoing/i.test(key));
  if(!followup&&!['','self'].includes(act.target?.affects?.type??''))return false;
  const entries=[...cprEntries(act),...midiEntries(act)];
  return entries.some(({command})=>/(?:linkedTarget|targetUuid|targetTokenUuid|sourceTokenUuid)/i.test(command)
    && /fromUuid|getToken/i.test(command) && /(?:getFlag|\.flags|effectUtils)/.test(command));
}
function teleportSpec(item, act) {
  const name=identity(item).toLowerCase().replace(/[\s_-]/g,''), id=[act.identifier,act.midiProperties?.identifier,act.name].join('|');
  const benign=/benigntransposition|王车易位|王車易位/.test(name), vortex=/vortexwarp|涡旋传送|漩涡传送|涡旋扭曲/.test(name);
  const steps=[[/dimensiondoor|任意门|任意門|次元门/,500],[/thunderstep|雷鸣步|雷霆步/,90],[/farstep|远行步|远步术|远距步/,60],[/shadowstep|暗影步|影步/,60],[/mistystep|迷踪步|迷蹤步|feystep|妖精步|精类步/,30]];
  const known=steps.find(([match])=>match.test(name));
  const dimensionDoor = known?.[1] === 500;
  const generic=item.flags?.['chris-premades']?.macros?.midi?.item?.includes('genericTeleport') ? globalThis.chrisPremades?.utils?.itemUtils?.getGenericFeatureConfig?.(item,'genericTeleport') : null;
  const genericSelf=!!generic&&(!generic.activities?.length||generic.activities.includes(act.id))&&!['ally','enemy','creature'].includes(act.target?.affects?.type);
  if (act.type === 'attack' || act.type === 'damage' && !dimensionDoor && !(act.target?.template?.type && known)) return null;
  if (benign && (/reset|recharge|restore|recover|重置|恢复|恢复次数/i.test(id)
    || !['utility', 'forward'].includes(act.type))) return null;
  const workflow=teleportWorkflow(act);
  if(!benign&&!vortex&&!known&&!workflow&&!genericSelf)return null;
  const kind=!benign?'point':/swap|换位|交換|互换|易位目标/i.test(id)?'swap':/transpositionmove|空地|空間|空位|empty space/i.test(id)?'point':'pointOrSwap';
  let range=dimensionDoor ? 500 : rangeInfo(item,act).ft || known?.[1] || (vortex?90:benign?30:0);
  if(genericSelf&&Number(generic.range)>0)range=Number(generic.range);
  if(benign && item.actor?.items?.some(i=>i.system.identifier==='distant-transposition'))range=Math.max(60,range);
  if(workflow?.source?.startsWith('cpr:')){const utils=globalThis.chrisPremades?.utils?.itemUtils;const config=workflow.source==='cpr:genericTeleport'?utils?.getGenericFeatureConfig?.(item,'genericTeleport')?.range:utils?.getConfig?.(item,'range'); if(Number(config)>0)range=Number(config);}
  if(!range && workflow?.source?.startsWith('aa:')){const source=workflow.source.slice(3);const entry=source==='item'?item.flags?.autoanimations:list(game.settings.get('autoanimations','aaAutorec-preset')).find(entry=>entry.label===source);range=Number(entry?.primary?.options?.range);}
  if(!range && workflow?.direct){const commands=[...cprEntries(act),...midiEntries(act)].filter(entry=>selfPlacement(entry.command));const ranges=new Set(commands.flatMap(entry=>[...entry.command.matchAll(/\b(?:range|limitMaxRange|maxRange)\s*:\s*(\d+(?:\.\d+)?)/g)].map(match=>Number(match[1]))));if(ranges.size===1)range=[...ranges][0];}
  if(!(range>0))return null;
  return {kind,rangeFt:range,rangePx:globalThis.canvas?.grid?.size?range*canvas.grid.size/sceneFeet(canvas.grid.distance||5):null,requiresSight:!dimensionDoor,allowOccupied:kind!=='point',...(vortex?{movesTarget:true,targetFilter:'creature'}:benign&&kind!=='point'?{targetFilter:act.target?.affects?.type==='ally'?'ally':'willing'}:{})};
}

function targetMode(item, activity, shape, linkedTarget) {
  if (shape) return 'area';
  if (linkedTarget) return 'self';
  const type = activity.target?.affects?.type ?? '';
  if (witchBoltFollowup(item, activity) || isTransferActivity(item, activity)) return 'target';
  if (type === 'self') return 'self';
  if (type === 'object') {
    return /heat[\s_-]*metal|炙热金属/i.test(identity(item)) ? 'target' : 'self';
  }
  if (type === 'space') return 'self';
  if (type || ['attack', 'heal', 'save', 'damage'].includes(activity.type)) return 'target';
  return 'self';
}

function targetingActivity(activity) {
  if (activity.type !== 'cast' || activity.target?.override || !activity.spell?.uuid) return activity;
  // A synchronous sheet can use a cached spell or a loaded compendium document.
  try {
    const spell = activity.cachedSpell ?? globalThis.fromUuidSync?.(activity.spell.uuid);
    return visibleActivities(spell)[0] ?? activity;
  } catch {
    return activity;
  }
}

function describe(item, a, actor) {
  const targeting = targetingActivity(a);
  const template = targeting.target?.template, affects = targeting.target?.affects;
  const teleport = teleportSpec(item,a), areaChoice = !!areaChoicePlan(item,a), multiPlan = multiDescription(item,a);
  const range = a.range?.override ? rangeInfo(item,a) : rangeInfo(targeting.item,targeting);
  const linkedTarget = ownedLinkedTarget(item,a);
  const versatile = item.type === 'weapon' && a.type === 'attack' && item.system.properties?.has?.('ver') === true
    && ['oneHanded', 'twoHanded'].includes(weaponAttackMode(item, a));
  const type = template?.type || '';
  const shape = ({
    sphere: 'circle', radius: 'circle', cylinder: 'circle', emanation: 'circle', emanationNoTemplate: 'circle',
    cone: 'cone', line: 'line', wall: 'line', cube: 'square', square: 'square', squareRadius: 'square'
  })[type];
  let mode = targetMode(item, targeting, shape, linkedTarget);
  if (multiPlan) mode='target';
  if (areaChoice) mode='areaChoice';
  if (teleport) mode='teleport';
  const repeat = !!multiPlan?.repeat;
  const count = Number(affects?.count);
  const charge = activityCharge(actor, item, a);
  const tSpec = shape ? templateSpecFor(targeting) : null;
  const anchored = anchoredArea(targeting, type);
  return {
    key: item.id + '/' + a.id,
    name: item.name,
    identifier: item.system.identifier || '',
    activity: a.name || item.name,
    type: a.type,
    activation: activationInfo(item, a),
    concentration: !!(a.duration?.concentration || item.system?.properties?.has?.('concentration') || item.system?.components?.concentration),
    itemId:item.id, activityId:a.id, range, linkedTarget, teleport, areaChoice, multiPlan, versatile,
    versatileFormula:versatile?formulaList(item.system.damage?.versatile):'',
    freeOptions:spellOptions(actor,item,a).filter(o=>['free','item'].includes(o.kind)), damageChoices:selectableDamage(a),
    duration: durationLabel(item, a),
    damageFormula: damageSummary(item, a),
    group: item.type,
    mode,
    shape: shape || '',
    templateType: type,
    templateSpec: tSpec,
    size: Number(template?.size) || 0,
    width: Number(template?.width) || 5,
    anchored,
    max: multiPlan?.max ?? (areaChoice ? 100 : count > 0 ? count : (affects?.choice ? 30 : 1)),
    repeat,
    level: Number(item.system.level) || 0,
    isCantrip: item.type === 'spell' && Number(item.system.level) === 0,
    needsSlot: needsSpellSlot(item, a),
    uses: charge ? charge.value : null,
    charge: charge ? {value: charge.value, max: charge.max, kind: charge.kind, label: charge.label} : null,
    consumesUses: !!charge?.consumes
  };
}

function getAction(t, key) {
  const [itemId, activityId] = String(key).split('/');
  const item = t.actor.items.get(itemId);
  const act = item?.system.activities?.get(activityId);
  if (!act || !visibleActivities(item).includes(act)) fail('角色卡上的活动已变化，请重新打开');
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
  const items=list(actor.items).filter(item=>!hiddenResource(item));
  const groups=new Map(items.map(item=>[item,visibleActivities(item)]));
  const actions=items.flatMap(item=>groups.get(item).map(act=>describe(item,act,actor)));
  const decisions=new Map(curateGroup(items,{actor,activitiesOf:item=>groups.get(item)}).decisions.map(row=>[row.itemId,row]));
  const reasonLabels={'spell-unprepared':'未准备','spell-no-slot-capacity':'无可用环位',passive:'被动/无活动','no-activity':'被动/无活动','non-combat-utility':'非战斗工具',duplicate:'同类重复'};

  const attributes = actor.system.attributes || {}, hp = attributes.hp;
  const abilities = Object.entries(actor.system.abilities || {})
    .map(([id, s]) => ({id, value: s.value, mod: s.mod, save: s.save?.value ?? s.save?.mod ?? s.save ?? null}))
    .map(a => ({...a, save: Number.isFinite(a.save) ? a.save : null}));
  const inventory = items.map(i => {
    const acts=groups.get(i), decision=decisions.get(i.id), reason=decision.reasons[0];
    const own = parseUsesPool(i.system?.uses);
    return {
      id:i.id, level:Number(i.system?.level)||0, isCantrip:i.type==='spell'&&Number(i.system.level)===0, prepared:spellPrepared(i),
      activityKeys:acts.map(act=>i.id+'/'+act.id), curated:{include:decision.include,reason,label:reasonLabels[reason]??decision.label}, resourceSummary:resourceSummary(actor,i,acts),
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
    schema: 3,
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
  const current = waypointCenter(t, t.document._source);
  if (!validPoint(cmd.origin) || Math.hypot(cmd.origin.x - current.x, cmd.origin.y - current.y) > 1) fail('角色已经移动，请重新规划');
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
  const limit = rangeInfo(act.item, act).ft;
  if (Number.isFinite(limit) && limit > 0 && sceneFeet(canvas.grid.measurePath([t.center, p]).distance) > limit + 0.001) {
    fail('超出施法距离');
  }
}

function excludesAreaOrigin(activity) {
  const targetCfg = activity?.target ?? {};
  const special = String(targetCfg.affects?.special ?? '').split(';').map(v => v.trim());
  if (special.includes('+self')) return false;
  if (special.some(v => ['self', '-self'].includes(v))) return true;
  if (!anchoredArea(activity, targetCfg.template?.type)) return false;
  if (['cone', 'line', 'cube'].includes(targetCfg.template?.type)) return true;
  if (['ally', 'willing', 'self'].includes(targetCfg.affects?.type)) return false;
  return ['radius', 'squareRadius', 'emanation', 'emanationNoTemplate'].includes(targetCfg.template?.type)
    && ['save', 'attack', 'damage'].includes(activity.type);
}

function prepareAreaActivity(activity, {preview = false, areaChoice = false, sequence} = {}) {
  const type = activity.target?.template?.type;
  const useRadius = type === 'emanation' || (preview && type === 'emanationNoTemplate');
  const special = String(activity.target?.affects?.special ?? '').split(';').filter(Boolean);
  const excludeOrigin = !preview && excludesAreaOrigin(activity)
    && !special.some(v => ['self', '-self'].includes(v.trim()));
  if (!useRadius && !excludeOrigin && !areaChoice && !sequence) return activity;

  // dnd5e captures inherited target fields before evaluating their scaling formulas.
  const prefix = `system.activities.${activity.id}`;
  const update = {};
  if (sequence) {
    // Midi propagates workflowOptions to triggered activities. CPR obtains
    // Storm Bolt from workflow.item and starts a new, independent sequence.
    update['flags.fvtt-mobile-table.areaSequence'] = sequence;
    update[`${prefix}.midiProperties.autoTargetAction`] = 'none';
    update[`${prefix}.midiProperties.confirmTargets`] = 'never';
  }
  if (useRadius || excludeOrigin || areaChoice) {
    const targetCfg = foundry.utils.deepClone(activity._inferredSource?.target ?? activity.target);
    update[`${prefix}.target`] = targetCfg;
    targetCfg.override = true;
    if (useRadius) targetCfg.template.type = 'radius';
    if (excludeOrigin) targetCfg.affects.special = [...special, '-self'].join(';');
    if (areaChoice) {
      targetCfg.prompt = false;
      targetCfg.affects.choice = false;
    }
  }
  if (areaChoice) {
    const source = activity.item.flags?.['chris-premades']?.info?.source;
    if (['chris-premades', 'gambits-premades', 'midi-item-showcase-community', 'automated-crafted-creations'].includes(source)) {
      update[`${prefix}.midiProperties.autoCEEffects`] = 'none';
    }
  }
  const clone = cloneItemPrepared(activity.item, update);
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
  const clone = cloneItemPrepared(act.item, {'flags.dnd5e.scaling': castLevel - baseLevel});
  return clone.system.activities.get(act.id) ?? fail('升环后找不到此活动，请重新选择');
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
  if(cmd.resourceOption) {const option=resolveOption(t.actor,act.item,act,cmd);cmd={...cmd,slot:option.kind==='slot'?option.key:''};}
  if(info.areaChoice)cmd={...cmd,point:t.center,direction:0};
  if ((info.mode !== 'area' && !info.areaChoice) || !within(cmd.point) || !Number.isFinite(cmd.direction)) {
    fail('请选择地图内的有效范围');
  }
  const scaledAct = scaledActivityForSlot(targetingActivity(act), cmd.slot, t.actor);
  const templateActivity = prepareAreaActivity(scaledAct, {preview: true});
  const factory = game.dnd5e?.canvas?.AbilityTemplate ?? globalThis.dnd5e?.canvas?.AbilityTemplate;
  const templates = factory?.fromActivity(templateActivity) ?? [];
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
  const ticket = cmd.op === 'template' ? saveTicket(templateTickets, {
    scene: canvas.scene.id,
    source: t.id,
    origin: xy(t.center),
    key: cmd.key,
    slot: cmd.slot || '',
    placement,
    coveredIds: covered.map(c => c.id),
    autoTarget: coverage.autoTarget
  }) : null;

  return {
    planId: cmd.planId || '',
    seq: Number(cmd.seq) || 0,
    ticket,
    placement,
    outline,
    covered,
    ...(info.areaChoice?{eligible:covered}:{}),
    coverageRule: coverage.rule
  };
}

function confirmedTemplate(act, placement, preCheck) {
  let consumed = false;
  const cpr = act.item.flags?.['chris-premades']?.activityIdentifiers;
  const firstBolt = cpr?.callLightning === act.id && cpr.stormBolt;
  const sequence = act.item.flags?.['fvtt-mobile-table']?.areaSequence;
  const isFirstBolt = used => firstBolt && sequence && used.id === firstBolt && used.item.uuid === act.item.uuid
    && used.item.flags?.['fvtt-mobile-table']?.areaSequence === sequence;
  const preHook = Hooks.on('dnd5e.preActivityConsumption', used => {
    if (used.uuid !== act.uuid && used.item?.system?.linkedActivity?.uuid !== act.uuid) return;
    if (preCheck && !preCheck()) return false;
  });
  const hook = Hooks.on('dnd5e.createActivityTemplate', (used, templates) => {
    const child = isFirstBolt(used);
    if (!child && used.uuid !== act.uuid && used.item?.system?.linkedActivity?.uuid !== act.uuid) return;
    for (const template of templates) {
      template.drawPreview = async () => {
        if (templates.length !== 1) fail('当前能力需要多个模板，请在电脑选择');
        const patch = {x: placement.x, y: placement.y, direction: placement.direction};
        // CPR starts a second native activity for the first strike. It uses the
        // confirmed point and keeps its own five-foot template inside the cloud.
        if (child && preCheck && !preCheck()) fail('模板落点已变动，请重新确认');
        if (!child && Number.isFinite(placement.distance)) patch.distance = placement.distance;
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

function checkedTarget(t, id, anchors, activity) {
  const other = target(t, id), anchor = anchors?.[other.id];
  if (!validPoint(anchor) || Math.hypot(anchor.x - other.center.x, anchor.y - other.center.y) > 1) {
    fail('目标已经移动，请重新选择');
  }
  if (activity.item.flags?.['chris-premades']?.activityIdentifiers?.spiritualWeaponAttack === activity.id
    && game.modules.get('chris-premades')?.active) {
    const effect = globalThis.chrisPremades?.utils?.effectUtils?.getEffectByIdentifier?.(t.actor, 'spiritualWeapon');
    const id = effect?.flags?.['chris-premades']?.summons?.ids?.[effect.name]?.[0];
    const weapon = id && canvas.tokens.get(id);
    if (!directlyVisible(weapon)) fail('找不到当前场景内的灵体武器');
    t = weapon;
  }
  const targeting = activity.range?.override ? activity : targetingActivity(activity);
  const limit = rangeInfo(targeting.item, targeting).ft;
  const measured = globalThis.MidiQOL?.computeDistance?.(t, other, {wallsBlock:false});
  if (Number.isFinite(measured) && measured >= 0) {
    if (limit > 0 && sceneFeet(measured) > limit + 0.001) fail('超出施法距离');
  } else checkRange(t, targeting, other.center);
  return other;
}

function resolveOption(actor,item,act,cmd) {
  const options=spellOptions(actor,item,act), raw=cmd.resourceOption;
  const key=(typeof raw==='string'?raw:raw?.key) ?? (raw?.kind==='slot'?cmd.slot:raw?.kind) ?? (options.some(o=>o.kind==='slot')?cmd.slot:'native');
  const selected=options.find(o=>o.key===key && (!raw?.kind||raw.kind===o.kind));
  if(!selected||selected.value<=0)fail('所选施法资源不足或活动已改变，请重新选择');
  return selected;
}
function configuredUse(activity,selected,cmd,info) {
  const item=activity.item, prefix='system.activities.'+activity.id+'.', updates={}, usage={midiOptions:{workflowOptions:{targetConfirmation:'none'}}};
  let selectedCost = -1;
  if(selected.kind==='slot')usage.spell={slot:selected.key};
  else if(selected.kind==='free'||selected.kind==='item'){
    const native=list(activity.consumption?.targets).map(target=>target.toObject?.()??foundry.utils.deepClone(target));
    const costs=selected.kind==='free'?freeConsumptionTargets(item,activity,selected.key):native;
    if(selected.kind==='item'&&!costs.some(cost=>cost.type==='itemUses'&&(!cost.target||cost.target===item.id)))costs.push({type:'itemUses',target:'',value:'1',scaling:{mode:'',formula:''}});
    selectedCost = costs.findIndex(cost => cost.type === 'itemUses' && (selected.kind === 'free'
      ? cost.target === selected.key : !cost.target || cost.target === item.id));
    updates[prefix+'consumption.targets']=costs;updates[prefix+'consumption.spellSlot']=false;
    usage.consume={spellSlot:false};usage.scaling=0;
    if (item.type === 'spell' && info.level > 0) usage.spell = {slot:'spell'+info.level};
  } else if (activity.type !== 'forward') usage.consume={spellSlot:false};
  if (selected.kind === 'native' && item.flags?.['chris-premades']?.activityIdentifiers?.heatMetalPulse === activity.id) {
    // The CPR pulse scales its child damage roll from the original effect. An
    // implicitly selected pact slot would add scaling to the parent item too.
    usage.spell = {slot: 'spell' + info.level};
    usage.scaling = 0;
  }
  if (witchBoltFollowup(item, activity) || isTransferActivity(item, activity)) {
    usage.concentration = {begin:false};
    usage.scaling = 0;
    if (!info.linkedTarget && !['creature', 'ally', 'enemy', 'willing', 'creatureOrObject'].includes(activity.target?.affects?.type)) {
      updates[prefix+'target.override'] = true;
      updates[prefix+'target.affects.type'] = 'creature';
      updates[prefix+'target.affects.count'] = '1';
    }
  }
  if (witchBoltFollowup(item, activity) && !Object.hasOwn(RANGE_UNITS, activity.range?.units)
    && !info.linkedTarget) {
    updates[prefix+'range.override'] = true;
    updates[prefix+'range.units'] = info.range.units;
    updates[prefix+'range.value'] = String(info.range.value);
  }
  if (!cmd.damageType && resistanceOptions(activity).length > 1) fail('请选择要施加的元素抗性');
  if(cmd.damageType){
    if(!info.damageChoices.some(choice=>choice.id===cmd.damageType))fail('当前活动不能选择此伤害类型');
    const cpr = cprDamageChoice(activity);
    if (cpr?.flag) updates[cpr.flag]=cmd.damageType;
    const resistance = resistanceOptions(activity);
    if (resistance.length) {
      // AppliedEffectField._id is readonly and non-enumerable on prepared
      // rows. Use dnd5e's serialized rows, including any save/rider data.
      const exclude = new Set(resistance.filter(row => row.id !== cmd.damageType).map(row => row.key));
      updates[prefix+'effects'] = activity.toObject().effects.filter(ref => !exclude.has(ref._id));
    }
    if(list(activity.damage?.parts).some(part=>list(part.types).length>1))updates[prefix+'damage.parts']=list(activity.damage.parts).map(part=>{const data=part.toObject?.()??foundry.utils.deepClone(part);if(list(part.types).includes(cmd.damageType)&&list(part.types).length>1)data.types=[cmd.damageType];return data;});
  }
  if(cmd.versatile!=null && (typeof cmd.versatile!=='boolean'||cmd.versatile&&!info.versatile))fail('当前攻击不支持此握持方式');
  const mode = info.versatile && cmd.versatile != null
    ? (cmd.versatile ? 'twoHanded' : 'oneHanded') : weaponAttackMode(item, activity);
  if (mode) {
    usage.attackMode = mode;
    if (activity.attackMode !== mode) updates[prefix+'attackMode'] = mode;
    if (item.getFlag?.('dnd5e', 'last.'+activity.id+'.attackMode') !== mode) updates['flags.dnd5e.last.'+activity.id+'.attackMode'] = mode;
  }
  if (Object.keys(updates).length) {
    const copy = cloneItemPrepared(item, updates);
    activity = copy.system.activities.get(activity.id);
    if (updates[prefix+'effects'] && !resistanceOptions(activity).some(row =>
      row.id === cmd.damageType && activity.applicableEffects?.some(effect => effect.id === row.key))) {
      fail('所选抗性效果已变化，请重新选择');
    }
  }
  if (selectedCost >= 0) {
    // The explicitly selected pool must be paid even when dnd5e would skip a combat-only cost.
    usage.consume.resources = list(activity.consumption.targets)
      .flatMap((cost,index) => index === selectedCost || !cost.combatOnly || item.actor.inCombat ? [index] : []);
  }
  return {activity,usage};
}
async function execute(activity,usage,dialog={configure:false},{damageType,beforeDamage}={}) {
  if(!game.modules.get('midi-qol')?.active)return activity.use(usage,dialog);
  const seq=usage.sequenceId ||= foundry.utils.randomID(), actor=activity.item.actor?.uuid, hooks=[];
  const choice = damageType && cprDamageChoice(activity)?.dialog;
  let workflow;
  const release = choice ? wrapPlacement(globalThis.chrisPremades?.utils?.dialogUtils, 'buttonDialog', function(original,args) {
    const [title, content, buttons, options] = args;
    if (workflow?.sequenceId === seq && !workflow.aborted && title === activity.item.name && content === choice
      && (!options?.userId || options.userId === game.user.id) && buttons?.some(button => button[1] === damageType)) {
      return Promise.resolve(damageType);
    }
    return original.apply(this,args);
  }) : () => {};
  try { return await new Promise((resolve,reject)=>{
    let settled=false,poll,useReturned=false;
    const matches=w=>w?.sequenceId===seq&&w.actor?.uuid===actor;
    const done=(value,error)=>{if(settled)return;settled=true;clearInterval(poll);for(const [event,id] of hooks)Hooks.off(event,id);error?reject(error):resolve(value);};
    const on=(event,fn)=>hooks.push([event,Hooks.on(event,fn)]);
    const capture=payload=>{
      const candidate=payload?.workflow??payload;
      if (!matches(candidate)) return;
      workflow=candidate;
      if (usage.attackMode && !workflow.attackRoll) workflow.attackMode = usage.attackMode;
    };
    on('midi-qol.preStart', capture);
    if (usage.midiOptions.workflowOptions.mobileAreaSequence === seq) {
      guardAreaTargets(on, seq, usage.midiOptions.targetsToUse);
    }
    on('midi-qol.preItemRollV2',capture);
    if (beforeDamage) on('midi-qol.preWaitForDamageRoll', w => {
      if (matches(w)) return beforeDamage(w);
    });
    on('midi-qol.preAbort',w=>{if(matches(w))done(null);});on('canvasTearDown',()=>done(null));
    const check = () => {
      capture(usage.workflow);
      if (!workflow) return;
      if (workflow.aborted || (workflow.WorkflowState_Abort && workflow.currentAction === workflow.WorkflowState_Abort)) done(null);
      else if (useReturned && workflow.WorkflowState_Completed && workflow.currentAction === workflow.WorkflowState_Completed && workflow.suspended) done(workflow);
    };
    poll=setInterval(check,100);
    Promise.resolve().then(()=>activity.use(usage,dialog)).then(result=>{
      if(!result||result.aborted)return done(null);
      useReturned=true;
      check();
      if(!workflow)done(result);
    },error=>done(null,error));
  }); } finally { release(); }
}
function aimUsage(usage,targets) {
  setTargets(targets);usage.midiOptions??={};usage.midiOptions.targetUuids=targets.map(tok=>tok.document.uuid);usage.midiOptions.targetsToUse=new Set(targets);
  usage.midiOptions.workflowOptions={...usage.midiOptions.workflowOptions,targetConfirmation:'none',ignoreUserTargets:true};
}

function prepareConfirmedArea(activity, usage, areaChoice = false) {
  if (!game.modules.get('midi-qol')?.active) return prepareAreaActivity(activity, {areaChoice});
  const sequence = usage.sequenceId ||= foundry.utils.randomID();
  Object.assign(usage.midiOptions.workflowOptions, {mobileAreaSequence:sequence, forceTemplateTargeting:false});
  return prepareAreaActivity(activity, {areaChoice, sequence});
}

function guardAreaTargets(on, sequence, confirmed) {
  const byWorkflow = new WeakMap();
  const main = w => w.sequenceId === sequence;
  const belongs = w => main(w) || w.item?.flags?.['fvtt-mobile-table']?.areaSequence === sequence
    || w.workflowOptions?.mobileAreaSequence === sequence;
  const visible = tokens => [...tokens].filter(tok => directlyVisible(tok));
  on('midi-qol.preStart', w => {
    if (!belongs(w)) return;
    w.workflowOptions.ignoreUserTargets = true;
    w.setTargets(new Set(visible(main(w) ? confirmed : w.targets)));
    setTargets([...w.targets]);
  });
  on('midi-qol.preValidateRoll', w => {
    if (!belongs(w)) return;
    // A child can have its own origin, a smaller template, or a self target.
    // Keep its native selection and intersect it with its own template.
    const targets = new Set(visible(main(w) ? confirmed : w.targets));
    if (!main(w) && w.activity?.target?.template?.type) {
      const template = w.templateUuid && fromUuidSync(w.templateUuid)?.object;
      const coverage = template && w.token ? new Set(computeTemplateCoverage(template,
        template.shape ?? template._computeShape(), w.token, w.activity).tokens) : confirmed;
      for (const tok of targets) if (!coverage?.has(tok)) targets.delete(tok);
    }
    byWorkflow.set(w, targets);
    w.setTargets(targets);
  });
  const allowed = w => byWorkflow.get(w) ?? (main(w) ? confirmed : new Set(visible(w.targets)));
  for (const stage of ['preDamageRollStarted', 'preDamageRollComplete']) {
    on('midi-qol.' + stage, w => {
      if (belongs(w) && w.activity?.target?.template?.type && !w.activity.attack
          && w.activity.midiProperties?.autoTargetAction === 'none') {
        // Both standard and saves-first Midi workflows reread game.user.targets here.
        setTargets(visible(allowed(w)));
      }
    });
  }
  for (const stage of ['preWaitForSaves', 'preAllRollsComplete', 'preApplyDynamicEffects']) {
    on('midi-qol.' + stage, w => {
      if (!belongs(w)) return;
      const targets = new Set(visible(allowed(w)));
      // setTargets() resets save results. Prune each native result separately so
      // successful saves, half damage and hit/miss classifications survive.
      for (const key of ['targets', 'hitTargets', 'hitTargetsEC', 'failedSaves', 'saves']) {
        const set = w[key];
        if (set && [...set].some(tok => !targets.has(tok))) w[key] = new Set([...set].filter(tok => targets.has(tok)));
      }
      if (stage === 'preApplyDynamicEffects' && !w.targets.size && !w.activity?.target?.affects?.type) setTargets([]);
    });
  }
}
async function magicMissileShield(token, prompt) {
  const actor = token.actor;
  const cpr = game.modules.get('chris-premades')?.active && game.modules.get('midi-qol')?.active
    ? globalThis.chrisPremades?.utils : null;
  const shielded = () => Boolean(cpr?.effectUtils?.getEffectByIdentifier?.(actor, 'shield')
    || list(actor.appliedEffects ?? actor.effects).some(effect => !effect.disabled && !effect.isSuppressed
      && /^(?:shield|护盾术)$/i.test(effect.name || '')));
  if (shielded()) return true;
  if (!prompt || !cpr?.itemUtils?.getAllItemsByIdentifier || !cpr.dialogUtils?.selectDocumentDialog
    || !cpr.socketUtils?.remoteRollItem || globalThis.MidiQOL?.hasUsedReaction?.(actor)) return false;
  const owner = cpr.socketUtils.firstOwner?.(actor, true);
  if (!owner) return false;
  const spells = list(cpr.itemUtils.getAllItemsByIdentifier(actor, 'shield')).filter(spell =>
    (spell.system.method !== 'spell' || spellPrepared(spell))
    && visibleActivities(spell).some(act => {
      const charge = activityCharge(actor, spell, act);
      return (!charge?.consumes || charge.value > 0)
        && spellOptions(actor, spell, act).some(option => ['slot','native'].includes(option.kind) && option.value > 0);
    }));
  if (spells.length) {
    const timeout = (Number(globalThis.MidiQOL?.configSettings?.()?.reactionTimeout) || 30) * 1000;
    let timer;
    try {
      const expires = new Promise(resolve => { timer = setTimeout(resolve, timeout); });
      const chosen = await Promise.race([expires,cpr.dialogUtils.selectDocumentDialog('魔法飞弹',
        'CHRISPREMADES.Macros.MagicMissile.Shield', spells, {userId:owner, addNoneDocument:true})]);
      if (!game.paused && directlyVisible(token) && chosen && spells.includes(chosen)) {
        await cpr.socketUtils.remoteRollItem(chosen, {}, {targetUuids:[token.document.uuid]}, owner);
      }
    } finally { clearTimeout(timer); }
  }
  return shielded();
}

async function castMulti(t,activity,usage,plan,cmd) {
  if(!Array.isArray(cmd.targets)||cmd.targets.length!==plan.max)fail('请为全部 '+plan.max+' 发攻击分配目标');
  const targets=cmd.targets.map(id=>checkedTarget(t,id,cmd.anchors,activity));
  const bolt = plan.spell === 'magicMissile' ? missileBolt(activity.item, activity)
    : plan.spell === 'scorchingRay' ? rayActivity(activity.item, activity)
    : eldritchBlastBeam(activity.item, activity) ?? activity;
  const separate = bolt.id !== activity.id;
  const before=[...game.user.targets], shields=new Map();
  let completed=0;
  try {
    if(separate){aimUsage(usage,[...new Set(targets)]);if(!await execute(prepareMultiActivity(activity.item,activity,plan),usage))fail('原生施放未完成');}
    for(const [index,token] of targets.entries()){
      if(game.paused||!directlyVisible(token)||!directlyVisible(t))break;
      const primary = !separate && index === 0;
      const missile = plan.spell === 'magicMissile';
      if (missile && !shields.has(token)) shields.set(token, await magicMissileShield(token, !primary));
      if (game.paused || !directlyVisible(token) || !directlyVisible(t)) break;
      const boltPlan = {...plan,bolt:true,subsequent:!primary,shielded:shields.get(token)};
      const shot=prepareMultiActivity(bolt.item,bolt,boltPlan);
      const config=primary?usage:{consume:{spellSlot:false,resources:false},concentration:{begin:false},scaling:0,
        midiOptions:{isTriggered:true,proceedChecks:{checkReaction:false,checkBonusAction:false}}};
      aimUsage(config,[token]);Object.assign(config.midiOptions.workflowOptions,{autoRollAttack:true,autoRollDamage:'onHit',
        fastForwardAttack:true,fastForwardDamage:true,forceCompletion:true});
      const beforeDamage = missile && primary && !boltPlan.shielded ? async workflow => {
        const shielded = await magicMissileShield(token, true);
        shields.set(token, shielded);
        if (shielded) workflow.activity = prepareMultiActivity(workflow.activity.item, workflow.activity, {...boltPlan,shielded:true});
      } : undefined;
      if(!await execute(shot,config,{configure:false},{beforeDamage}))break;completed++;
    }
    if(!completed)fail('射线或飞弹未完成，请核对已有施放记录');
    return {completed,total:plan.max,message:activity.item.name+' 已结算 '+completed+'/'+plan.max+(completed<plan.max?'，剩余未执行':'')};
  }finally{setTargets(before.filter(token=>directlyVisible(token)));}
}

async function cast(t, cmd) {
  const {item, act, info} = getAction(t, cmd.key);
  if (game.paused) fail('游戏已暂停');
  if (game.modules.get('midi-qol')?.active && globalThis.MidiQOL?.configSettings?.()?.undoWorkflow && !game.users.activeGM) {
    fail('本世界的战斗撤销记录需要在线 GM，请先连接 GM');
  }
  const selected=resolveOption(t.actor,item,act,cmd);
  if(info.consumesUses&&info.uses===0&&!(selected.kind==='free'&&item.type!=='spell'))fail('物品次数已用完');
  const {activity,usage}=configuredUse(act,selected,cmd,info);
  const plan=targetPlan(item,act,selected.level);
  if(plan?.repeat)return castMulti(t,activity,usage,plan,cmd);
  cmd={...cmd,slot:selected.kind==='slot'?selected.key:''};

  const ids = Array.isArray(cmd.targets) ? [...new Set(cmd.targets)] : [];
  const selfEquipment = info.mode === 'self' && ['weapon', 'equipment', 'tool', 'consumable', 'loot'].includes(item.type);
  const onUseMacro = item.getFlag('midi-qol', 'onUseMacroName');
  if (selfEquipment && act.type === 'utility' && /\[postActiveEffects\]/i.test(onUseMacro || '')
    && !(game.modules.get('midi-qol')?.active && globalThis.MidiQOL?.configSettings?.()?.allowUseMacro)) {
    fail('此装备效果需要启用 Midi-QOL 物品宏，尚未扣除次数');
  }
  let targets = info.mode === 'self' && !info.linkedTarget && act.target?.affects?.type === 'self' ? [t] : [];
  if (info.mode === 'target') {
    if (!ids.length || ids.length > (plan?.max ?? info.max)) fail('目标数量不正确');
    targets = ids.map(id => checkedTarget(t, id, cmd.anchors, activity));
  }
  if (info.mode === 'teleport') return teleport(t, activity, info, cmd, usage, selected.level);

  let usedActivity = plan ? prepareMultiActivity(activity.item,activity,plan) : activity;
  let templateGuard = null;
  const midiActive = game.modules.get('midi-qol')?.active === true;
  if (info.mode === 'area' || info.areaChoice) {
    const fresh = templatePlacement(t, act, info, cmd);
    const saved = cmd.ticket ? templateTickets.get(cmd.ticket) : null;
    if (!saved || saved.scene !== canvas.scene.id || saved.source !== t.id || saved.key !== cmd.key
      || saved.slot !== (cmd.slot || '') || ['t','x','y','direction','distance'].some(key => saved.placement[key] !== fresh.placement[key])) {
      fail('模板落点已变动，请重新确认');
    }
    const confirmed = new Set(saved.coveredIds);
    if (fresh.covered.length !== confirmed.size || fresh.covered.some(target => !confirmed.has(target.id))) {
      fail('范围内的目标已变化，请重新确认');
    }
    targets = fresh.covered.map(c => canvas.tokens.get(c.id)).filter(tok => directlyVisible(tok));
    if (midiActive && ['save','damage','attack'].includes(act.type) && !targets.length) fail('范围内没有可见的合法目标，尚未消耗资源');
    if(info.areaChoice){if(!ids.length || ids.some(id=>!targets.some(tok=>tok.id===id)))fail('所选目标不在可见光环内');targets=targets.filter(tok=>ids.includes(tok.id));}
    usedActivity = prepareConfirmedArea(activity, usage, info.areaChoice);
    templateGuard = confirmedTemplate(usedActivity, fresh.placement, () => !game.paused && directlyVisible(t) && targets.every(token => directlyVisible(token)) && (!info.areaChoice || templatePlacement(t,act,info,cmd).eligible.filter(row=>ids.includes(row.id)).length===ids.length));
  }

  const before = [...game.user.targets];
  try {
    const deferTargetsToLinkedSpell = act.type === 'cast' && targetingActivity(act) === act
      && !act.target?.affects?.type && !info.shape;
    if (deferTargetsToLinkedSpell) delete usage.midiOptions.workflowOptions.targetConfirmation;
    else aimUsage(usage,targets);
    if(templateGuard) usage.create={measuredTemplate:!info.templateSpec?.noTemplate};
    const result=await execute(usedActivity,usage,{configure:deferTargetsToLinkedSpell},{damageType:cmd.damageType});

    if (!result || result.aborted) fail('施放取消或未通过当前世界规则');
    return {message: '已提交：' + (selfEquipment ? info.activity : info.name)};
  } finally {
    templateGuard?.release();
    setTargets(before.filter(tok => directlyVisible(tok)));
  }
}

function teleportGeometry(t,act,info,cmd,castLevel) {
  const spec=info.teleport;if(!spec)fail('该活动不是传送');
  const swapId=typeof cmd.swapTarget==='object'?cmd.swapTarget?.id:cmd.swapTarget;
  if (spec.movesTarget && (swapId || !Array.isArray(cmd.targets) || cmd.targets.length !== 1)) fail('请先选择一个要传送的生物');
  let id=swapId || ((spec.kind!=='point'||spec.movesTarget)?cmd.targets?.[0]:null), inferred=false;
  if(!id && spec.kind!=='point' && within(cmd.point)){
    const hits=canvas.tokens.placeables.filter(tok=>tok!==t&&directlyVisible(tok)&&tok.bounds.contains?.(cmd.point.x,cmd.point.y));
    if(hits.length>1)fail('落点处有多个生物，请明确选择换位目标');
    if(hits.length&&cmd.op!=='teleportPreview')fail('请确认换位目标后再施放');
    if(hits.length){id=hits[0].id;inferred=true;}
  }
  const other=id?canvas.tokens.get(id):null;
  if(id&&(!directlyVisible(other)||other===t||other.actor.type==='group'))fail('所选生物不可用');
  if(spec.kind==='swap'&&!other || spec.kind==='point'&&swapId)fail('请选择正确的传送方式');
  const swap=!!other&&!spec.movesTarget, moving=spec.movesTarget?other:t;
  if(!moving)fail('请先选择要传送的生物');
  if(other && spec.targetFilter==='ally' && other.document.disposition!==t.document.disposition)fail('所选生物不是盟友');
  if(swap && /benigntransposition|王车易位|王車易位/i.test(identity(act.item).replace(/[\s_-]/g,'')) && !['tiny','sm','med'].includes(other.actor.system.traits?.size))fail('只能与中型或更小的生物换位');
  if(other && !inferred) {
    const anchor = cmd.anchors?.[other.id];
    if (!validPoint(anchor) || Math.hypot(anchor.x-other.center.x,anchor.y-other.center.y)>1) fail('目标已经移动，请重新确认');
  }
  const point=swap?other.center:cmd.point??(validPoint(cmd.pos)?waypointCenter(moving,cmd.pos):null);if(!within(point))fail('请选择地图内的落点');
  const pos=snapTokenStep(moving,point), center=waypointCenter(moving,pos);
  if (swap) pos.elevation = other.document.elevation ?? pos.elevation;
  const level = spec.movesTarget ? castLevel ?? resolveOption(t.actor, act.item, act, cmd).level : info.level;
  const rangeFt=spec.rangeFt+(spec.movesTarget?Math.max(0,level-info.level)*30:0);
  const canReach=point=>{const distance=sceneFeet(canvas.grid.measurePath([t.center,point]).distance);return Number.isFinite(distance)&&distance<=rangeFt+0.001&&(!spec.requiresSight||(!t.checkCollision?.(point,{origin:t.center,type:'sight',mode:'any'})&&(!canvas.scene.tokenVision||canvas.visibility.testVisibility(point,{tolerance:0}))));};
  if(!canReach(center)||other&&!canReach(other.center))fail('目的地或目标超出距离或不可见');
  const ignored=new Set(swap?[t,other]:[moving]);
  const footprint=(token,position)=>new PIXI.Rectangle(position.x+0.01,position.y+0.01,token.w-0.02,token.h-0.02);
  const canLand=(token,position)=>{const box=footprint(token,position);return within({x:box.left,y:box.top})&&within({x:box.right,y:box.bottom})&&!canvas.tokens.placeables.some(candidate=>!ignored.has(candidate)&&candidate.bounds.intersects(box));};
  const back=swap?snapTokenStep(other,t.center):null;
  if (back) back.elevation = t.document.elevation ?? back.elevation;
  if(!canLand(moving,pos)||swap&&(!canLand(other,back)||footprint(t,pos).intersects(footprint(other,back))))fail('落点不可用');
  if(Math.hypot(moving.document._source.x-pos.x,moving.document._source.y-pos.y)<1)fail('请选择不同的落点');
  return {swap,moving,other,pos,center,back,rangeFt};
}
function teleportPreview(t,act,info,cmd) {
  const response={planId:cmd.planId||'',seq:Number(cmd.seq)||0,valid:false,reason:'',snapped:null,rangeFt:info.teleport?.rangeFt??0};
  try{const plan=teleportGeometry(t,act,info,cmd);return {...response,valid:true,snapped:plan.center,rangeFt:plan.rangeFt,...(plan.swap?{swapTarget:{id:plan.other.id,name:tokenVisibleName(plan.other,true)}}:{})};}catch(error){return {...response,reason:error.message};}
}
function wrapPlacement(object,key,handler) {
  if(!object || typeof object[key]!=='function')return ()=>{};
  const own=Object.getOwnPropertyDescriptor(object,key), original=object[key];
  function wrapped(...args){return handler.call(this,original,args);}
  if(own&&!own.configurable&&!own.writable)return ()=>{};
  Object.defineProperty(object,key,{value:wrapped,writable:true,configurable:own?.configurable??true,enumerable:own?.enumerable??false});
  return ()=>{if(object[key]!==wrapped)return;if(own)Object.defineProperty(object,key,own);else delete object[key];};
}
function placementScope(t,act,plan,seq,recheck,{deferCPR=false}={}) {
  const undos=[], foreign=new Set(), utilities=globalThis.chrisPremades?.utils;
  let fed=false, aaSeen=false, aaFed=false, closed=false, deferred;
  const watch=(name,fn)=>{const id=Hooks.on(name,fn);undos.push(()=>Hooks.off(name,id));};
  const close=()=>{closed=true;for(const undo of undos.splice(0).reverse())undo();};
  const active=()=>!closed&&!fed&&!foreign.size&&canvas.scene===t.document.parent;
  let cprMover=null;
  const directAim=()=>[...cprEntries(act),...midiEntries(act)].some(entry=>/aimCrosshair/.test(entry.command));
  const validate=()=>{const fresh=recheck();if(fresh.moving!==plan.moving||fresh.other!==plan.other||Math.hypot(fresh.pos.x-plan.pos.x,fresh.pos.y-plan.pos.y)>0.01)fail('传送落点或目标已经改变');};
  const consume=()=>{validate();fed=true;return {...plan.center,elevation:plan.pos.elevation,direction:plan.moving.document.rotation||0,cancelled:false,valid:true};};
  const ortho=(original,args)=>{const data=args[0]??{}, obj=data.location?.obj??data.token;
    if(!active() || plan.swap || !(obj===t||obj===t.document || (!obj && data.label?.text===act.item.name)))return original.apply(null,args);
    const max=Number(data.location?.limitMaxRange);if(max>0 && sceneFeet(canvas.grid.measurePath([t.center,plan.center]).distance)>max+.001)fail('超出原生选择器距离');
    const point=consume();return Promise.resolve({...point,center:point,getOrientation:()=>({source:point,target:point})});};
  try{
    watch('midi-qol.preStart',workflow=>{if(workflow?.token===t && workflow.sequenceId!==seq)foreign.add(workflow);});
    for(const event of ['midi-qol.preAbort','midi-qol.postCleanup'])watch(event,workflow=>{foreign.delete(workflow);});
    undos.push(wrapPlacement((globalThis.chrisPremades?.Teleport??utilities?.Teleport)?.prototype,'go',async function(original,args){
      if(!active()||this.controllingToken!==t||!this.tokens?.includes(plan.moving))return original.apply(this,args);
      const move = async () => {
        validate();
        if(this.options?.isGroup){const group=new Set(this.tokens);for(const passenger of group){const box=new PIXI.Rectangle(plan.pos.x+passenger.document._source.x-t.document._source.x+0.01,plan.pos.y+passenger.document._source.y-t.document._source.y+0.01,passenger.w-0.02,passenger.h-0.02);if(!within({x:box.left,y:box.top})||!within({x:box.right,y:box.bottom})||canvas.tokens.placeables.some(tok=>!group.has(tok)&&tok.bounds.intersects(box)))fail('同行棋子的落点不可用');}}
        const prev=cprMover;cprMover=this;try{return await original.apply(this,args);}finally{cprMover=prev;}
      };
      if (!deferCPR) return move();
      deferred ??= move;
    }));
    undos.push(wrapPlacement(utilities?.crosshairUtils,'aimCrosshair',function(original,args){const opts=args[0];if(!active()||plan.swap||opts?.token!==t||(!cprMover&&!directAim()))return original.apply(this,args);
      if((opts.maxRange>0 && canvas.grid.measurePath([opts.centerpoint??t.center,plan.center]).distance>Number(opts.maxRange)+0.001) || opts.validityFunctions?.some(fn=>!fn(plan.center)))fail('原生传送规则不允许这个落点');const confirmed=consume();return Promise.resolve(cprMover?{...confirmed,x:plan.pos.x+t.w/2,y:plan.pos.y+t.h/2}:confirmed);}));
    for(const [object,key] of [[globalThis.Sequencer?.Crosshair,'show'],[globalThis.warpgate?.crosshairs,'show']])undos.push(wrapPlacement(object,key,function(original,args){return ortho(original.bind(this),args);}));
    watch('aa.preDataSanitize',(handler,data)=>{
      if(!active()||plan.swap||handler?.sourceToken!==t||handler.item?.uuid!==act.item.uuid||data?.presetType!=='teleportation' || (handler.workflow?.sequenceId!==seq && handler.workflowBackup?.sequenceId!==seq && (game.modules.get('midi-qol')?.active || handler.item!==act.item)))return;
      const descriptor=Object.getOwnPropertyDescriptor(handler,'sequenceData');if(!descriptor?.configurable||!('value' in descriptor))return;
      aaSeen=true;
      const restore=()=>{if(Object.getOwnPropertyDescriptor(handler,'sequenceData')?.get===arm)Object.defineProperty(handler,'sequenceData',descriptor);};
      function arm(){restore();if(!active())return descriptor.value;
        const stage=canvas.app.stage;
        const release=wrapPlacement(stage,'addListener',function(original,args){const [event,listener]=args;
          if(event!=='pointerdown'||typeof listener!=='function'||!String(listener).includes('getLocalPosition')||!String(listener).includes('deleteTemplatesAndMove')||!String(listener).includes('removeListener'))return original.apply(this,args);
          release();const point=consume();aaFed=true;
          const restoreRemoval=wrapPlacement(stage,'removeListener',function(remove,params){return params.length===1&&params[0]==='pointerdown'?this:remove.apply(this,params);});
          try{listener({data:{button:0,getLocalPosition:()=>point}});}finally{restoreRemoval();}return this;});
        undos.push(release);const timer=setTimeout(release,0);undos.push(()=>clearTimeout(timer));return descriptor.value;}
      Object.defineProperty(handler,'sequenceData',{configurable:true,enumerable:descriptor.enumerable,get:arm});undos.push(restore);
    });
    return {close, async finish(){await deferred?.();},get aaSeen(){return aaSeen;},get aaFed(){return aaFed;},get fed(){return fed;}};
  }catch(error){close();throw error;}
}
async function teleport(t,act,info,cmd,usage,castLevel) {
  const origin=xy(t.document._source), plan=teleportGeometry(t,act,info,cmd,castLevel), {swap,moving,other,pos,back}=plan;
  const present=tok=>xy(tok.document._source), same=(tok,point)=>Math.hypot(tok.document._source.x-point.x,tok.document._source.y-point.y)<1;
  const movingOrigin=present(moving), otherOrigin=other?present(other):null;
  const recheck=()=>{if(game.paused||!directlyVisible(t)||!same(t,origin)||!same(moving,movingOrigin)||other&&(!directlyVisible(other)||!same(other,otherOrigin)))fail('场景或棋子已变化，请重新规划');return teleportGeometry(t,act,info,cmd,castLevel);};
  const macros=[...midiEntries(act),...cprEntries(act)];
  const thunder = /thunder[\s_-]*step|雷鸣步|雷霆步/i.test(identity(act.item));
  const cprMoves = macros.some(({source,command}) => source.startsWith('cpr:')
    && (/cpr:(?:thunderStep|vortexWarp)/.test(source) || selfPlacement(command)));
  const nativePlan = macros.some(entry=>/benignTranspositionPlan/.test(entry.command));
  const nativeConsent=swap && game.modules.get('midi-qol')?.active && macros.some(entry=>/benignTranspositionPlan|dialogUtils\.confirm/.test(entry.command));
  const remoteMove = game.users.activeGM && game.modules.get('chris-premades')?.active
    && globalThis.chrisPremades?.utils?.genericUtils?.updateEmbeddedDocuments;
  if (nativePlan && (!game.modules.get('midi-qol')?.active || globalThis.MidiQOL?.configSettings?.()?.allowUseMacro === false)) {
    fail('请启用 Midi-QOL 物品宏来执行王车易位');
  }
  if (info.teleport.movesTarget && !game.modules.get('midi-qol')?.active) fail('需要 Midi-QOL 确认目标的豁免，请在电脑结算');
  if (info.teleport.movesTarget && !cprMoves && !remoteMove && !moving.document.isOwner) fail('当前无法移动目标，请由 DM 施放');
  if(swap&&!nativeConsent){
    if(!other.document.isOwner)fail('换位需要目标所有者和具备移动权限的原生宏，请联系 DM；尚未消耗');
    const owners=list(game.users).filter(user=>user.active&&!user.isGM&&other.actor.testUserPermission(user,'OWNER'));
    const owner=owners.find(user=>user.character?.id===other.actor.id)??owners.find(user=>user.id!==game.user.id)??owners[0]??game.users.activeGM;
    if(!owner)fail('找不到可确认换位的目标所有者');
    const consent=globalThis.chrisPremades?.utils?.dialogUtils?.confirm;
    const content='是否同意这次换位？';
    const willing=consent?await consent('换位确认',content,{userId:owner.id}):owner.id===game.user.id&&await foundry.applications.api.DialogV2.confirm({window:{title:'换位确认'},content});
    if(willing!==true)fail('未获得换位同意，尚未消耗');
  }
  recheck();const before=[...game.user.targets];let scope,areaGuard;
  try{
    let targets = other ? [other] : act.target?.affects?.type === 'self' && info.teleport.kind === 'point' ? [t] : [];
    if (swap && !['creature', 'willing', 'ally', 'creatureOrObject'].includes(act.target?.affects?.type)) {
      const prefix = `system.activities.${act.id}.target`;
      const clone = cloneItemPrepared(act.item, {
        [prefix+'.override']:true,
        [prefix+'.affects.type']:'willing',
        [prefix+'.affects.count']:'1'
      });
      act = clone.system.activities.get(act.id);
    }
    if ((cprMoves || nativePlan) && aaTeleport(act)) {
      const clone = cloneItemPrepared(act.item, {'flags.autoanimations.killAnim':true});
      act = clone.system.activities.get(act.id);
    }
    if (info.teleport.rangeFt === 500 && !info.teleport.requiresSight && act.type === 'damage' && !info.shape) {
      // Dimension Door's damage activity is for an obstructed arrival. The plan requires an empty landing.
      const clone = cloneItemPrepared(act.item, {[`system.activities.${act.id}.damage.parts`]:[]});
      act = clone.system.activities.get(act.id);
    }
    if(info.shape&&info.anchored&&!swap&&!info.teleport.movesTarget){
      const area={...info,mode:'area',areaChoice:false};
      const placement=templatePlacement(t,act,area,{...cmd,point:t.center,direction:0});
      targets=placement.covered.map(row=>canvas.tokens.get(row.id)).filter(tok=>directlyVisible(tok));
      act = prepareConfirmedArea(act, usage);
      areaGuard=confirmedTemplate(act,placement.placement,()=>{
        try { recheck(); return targets.every(tok => directlyVisible(tok)); } catch { return false; }
      });
      usage.create={measuredTemplate:!info.templateSpec?.noTemplate};
    }
    aimUsage(usage,targets);usage.sequenceId ||= foundry.utils.randomID();
    scope=placementScope(t,act,plan,usage.sequenceId,recheck,{deferCPR:thunder});
    const used=await execute(act,usage);if(!used||used.aborted)fail('传送施放已取消');
    if (info.teleport.movesTarget && !includesSaveTarget(used.failedSaves, moving)) {
      return {message:includesSaveTarget(used.saves, moving) ? '目标豁免成功，未移动' : '无法确认目标豁免结果，未自动移动，请核对聊天记录'};
    }
    await scope.finish();
    const awaitingAA=!!aaTeleport(act)&&!swap;
    if(scope.aaSeen||awaitingAA){const deadline=Date.now()+15000;while(!same(moving,pos)&&Date.now()<deadline&&directlyVisible(t))await new Promise(resolve=>setTimeout(resolve,75));}
    if(awaitingAA&&!same(moving,pos))fail('未收到自动动画的到达确认；请核对聊天记录，勿重复施放');
    if(same(moving,pos)&&(!swap||same(other,back)))return {message:swap?'已换位':'已传送'};
    if(scope.fed||scope.aaSeen||nativeConsent||nativePlan||cprMoves||!same(moving,movingOrigin)||other&&!same(other,otherOrigin))fail('原生传送未确认到达指定落点；不会重复移动，请核对施放记录');
    recheck();
    if(swap){if(!t.document.isOwner||!other.document.isOwner)fail('施放已结算，但无权移动目标棋子，请 DM 核对');
      await canvas.scene.updateEmbeddedDocuments('Token',[{_id:t.id,...xy(pos),elevation:pos.elevation},{_id:other.id,...xy(back),elevation:back.elevation}],{teleport:true,animate:false,isPaste:true});
    }else if (moving.document.isOwner) {
      await moving.document.move([{...pos,action:'blink'}],{method:'api',pan:false,constrainOptions:{ignoreWalls:true}});
    }else if (remoteMove && info.teleport.movesTarget) {
      await remoteMove(canvas.scene,'Token',[{_id:moving.id,...xy(pos),elevation:pos.elevation}],{teleport:true,animate:false,isPaste:true});
    }else fail('施放已结算，但无权移动目标棋子，请 DM 核对');
    if(!same(moving,pos)||swap&&!same(other,back))fail('施放已结算，但场景没有确认移动，请 DM 核对');
    return {message:swap?'已换位':'已传送'};
  }finally{scope?.close();areaGuard?.release();setTargets(before.filter(token=>directlyVisible(token)));}
}

function includesSaveTarget(results, token) {
  return list(results).some(target => target === token || target === token.document
    || (target?.document ?? target)?.uuid === token.document.uuid);
}

let castInFlight=false;

export async function dispatch(cmd) {
  if (cmd.op === 'view') {
    player();
    if (cmd.scene !== canvas.scene.id || !validPoint(cmd.center) || ![cmd.width, cmd.height].every(v => Number.isFinite(v) && v > 0 && v < 1000000)) {
      fail('无效的地图视口');
    }
    // Older phones still send viewport hints. Browsing never controls the desktop camera.
    return {ok: true};
  }
  if (cmd.op === 'tokenInspect') {
    player();
    if (cmd.scene && cmd.scene !== canvas.scene.id) return {inspection: null, seq: Number(cmd.seq) || 0};
    if (!cmd.target) return {inspection: null, seq: Number(cmd.seq) || 0};
    return {inspection: inspectVisibleToken(cmd.target), seq: Number(cmd.seq) || 0};
  }
  if (cmd.op === 'selectToken') {
    player();
    const tok = canvas.tokens.get(cmd.tokenId);
    if (!tok?.isOwner || !directlyVisible(tok)) fail('请选择当前可见的己方棋子');
    if (tok.control({releaseOthers: true}) === false) fail('当前无法控制此棋子');
    return {ok: true, tokenId: tok.id, name: tok.name};
  }
  if (cmd.op === 'endTurn') {
    player();
    if (game.paused) fail('游戏已暂停');
    const combat = game.combat;
    if (!combat?.started) fail('战斗尚未开始');
    const active = combat.combatant;
    if (!visibleCombatant(active) || !ownsCombatant(active)) fail('当前不是你的回合');
    await combat.nextTurn();
    return {ok: true, message: '已结束当前回合'};
  }
  const t = source();
  if (cmd.op === 'sheet') return sheet();
  if (cmd.op === 'portrait') return displayIcon(t.actor.img);
  if (cmd.op === 'icon') return displayIcon(t.actor.items.get(String(cmd.key).split('/')[0])?.img);
  if (cmd.op === 'teleportPreview') {
    try{checkContext(t,cmd);const {act,info}=getAction(t,cmd.key);return teleportPreview(t,act,info,cmd);}
    catch(error){return {planId:cmd.planId||'',seq:Number(cmd.seq)||0,valid:false,reason:error.message,snapped:null,rangeFt:0};}
  }
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
    if (!await t.document.move(computed.steps, {method: 'api', pan: false, showRuler: true})) fail('移动被世界规则阻止');
    const end = computed.steps.at(-1);
    const actual = t.document._source;
    const center = waypointCenter(t, actual);
    return {
      message: Math.hypot(end.x - actual.x, end.y - actual.y) < 1 ? '移动完成' : '仅移动到可达位置',
      position: center
    };
  }
  if (cmd.op === 'cast') {if(castInFlight)fail('已有施放正在结算，请先完成当前提示');castInFlight=true;try{return await cast(t,cmd);}finally{castInFlight=false;}}
  fail('未知操作');
}
