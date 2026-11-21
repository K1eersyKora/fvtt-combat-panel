import {namespaceSocket} from './socket-1.js';
import {level7Activities, level7FormEffects, level7Macros, level7Description} from './jedi-level7-data-1.js';
const ID = 'fvtt-automation-repair', MARK = 'jediLevel7', EFFECT = 'JediForesight007';
export const JEDI_SEVEN = {
  suggestion: 'JediSuggestCast7', calm: 'JediCalmCast0007',
  nimanSuggestion: 'JediNimanSug0007', nimanCalm: 'JediNimanCal0007',
  nimanPush: 'JediNimanPush007', nimanPull: 'JediNimanPull007'
};
const NIMAN = new Set([JEDI_SEVEN.nimanSuggestion, JEDI_SEVEN.nimanCalm, JEDI_SEVEN.nimanPush, JEDI_SEVEN.nimanPull]);
const clone = value => foundry.utils.deepClone(value), list = value => Array.from(value?.contents ?? value ?? []);
const queues = new Map(), actionQueues = new Map(), pending = new Map(), precisionLocks = new Set();
let socket;
const primary = () => game.user.isGM && game.users.activeGM?.id === game.user.id;
export const fighterLevel = actor => Number(actor?.items.find(i => i.type === 'class' && i.system.identifier === 'fighter')?.system.levels ?? 0);
export const forceDie = actor => fighterLevel(actor) >= 18 ? 12 : fighterLevel(actor) >= 10 ? 10 : 8;
const awareness = actor => actor?.items.find(i => i.system.identifier === 'force-awareness');
const force = actor => actor?.items.find(i => i.system.identifier === 'force-harmony');
const isJedi = actor => actor?.items.some(i => i.type === 'subclass' && i.system.identifier === 'jedi');
export const hasJediLevel7 = actor => !!awareness(actor) && isJedi(actor) && fighterLevel(actor) >= 7;
const awake = actor => !actor.statuses.has('unconscious') && !actor.statuses.has('dead');
const activeStyle = (actor, key) => actor?.effects.some(e => !e.disabled && !e.isSuppressed && e.flags?.[ID]?.stance === key);
const saber = actor => {
  const meta = actor.flags?.[ID]?.saber, weapon = meta?.lit && actor.items.get(meta.itemId);
  return weapon?.type === 'weapon' && weapon.system.equipped && weapon.flags?.[ID]?.original ? weapon : null;
};
const modes = actor => list(actor._source.prototypeToken?.detectionModes ?? []);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const turn = () => game.combat?.started ? `${game.combat.id}:${game.combat.round}:${game.combat.turn}` : null;
const ownTurn = actor => !!turn() && game.combat.combatant?.actor?.uuid === actor.uuid;
function sourceActivity(item, activity, actor = item?.actor) {
  const linked = item?.system?.linkedActivity;
  if (linked?.item?.system.identifier === 'force-awareness') return linked;
  if (item?.system.identifier === 'force-awareness') return activity;
  const meta = item?.flags?.[ID]?.jediMindSpell;
  if (meta) return actor?.items.get(meta.sourceId)?.system.activities.get(meta.activityId);
  const relative = item?.flags?.dnd5e?.cachedFor;
  if (!relative) return;
  return actor?.items.find(i => i.system.identifier === 'force-awareness')?.system.activities.find(a => a.relativeUUID === relative);
}
const remainingForce = actor => Math.max(0, Number(force(actor)?.system.uses.max ?? 0) - Number(force(actor)?.system.uses.spent ?? 0));
let normalizedActivities;
async function repairCard(item, pool) {
  normalizedActivities ??= new CONFIG.Item.documentClass({name: 'Jedi level 7', type: 'feat', system: {activities: level7Activities}}).system.activities;
  const patch = {};
  for (const model of normalizedActivities) {
    const wanted = model.toObject(), current = item.system.activities.get(model.id);
    if (Object.values(JEDI_SEVEN).includes(model.id)) wanted.consumption.targets[0].target = pool?.id ?? '';
    if (!current || !same(current.toObject(), wanted)) patch[`system.activities.${model.id}`] = wanted;
  }
  if (!same(item._source.flags?.['chris-premades']?.embeddedMacros, level7Macros)) patch['flags.chris-premades.embeddedMacros'] = level7Macros;
  if (item.system.description.value !== level7Description) patch['system.description.value'] = level7Description;
  if (Object.keys(patch).length) await item.update(patch);
  for (const data of level7FormEffects) {
    const existing = item.effects.get(data._id);
    if (!existing) await item.createEmbeddedDocuments('ActiveEffect', [clone(data)], {keepId: true});
  }
  return Object.keys(patch).length > 0;
}
function budget(actor) {
  const key = turn(), old = actor.flags?.[ID]?.attackAction;
  const data = old?.turn === key ? clone(old) : {turn: key, attacks: 0, otherActions: 0, surges: 0};
  const attacksPerAction = fighterLevel(actor) >= 20 ? 4 : fighterLevel(actor) >= 11 ? 3 : fighterLevel(actor) >= 5 ? 2 : 1;
  return {...data, attacksPerAction, remaining: Math.max(0, attacksPerAction * (1 + data.surges - data.otherActions) - data.attacks)};
}
export const attackBudget = budget;
function heldInOneHand(actor) {
  const weapon = saber(actor);
  if (!weapon || weapon.system.properties.has('two') || actor.flags?.[ID]?.saberGrip === 'twoHanded') return false;
  return !actor.items.some(i => i.id !== weapon.id && i.system.equipped && (i.type === 'weapon' || i.system.type?.value === 'shield'));
}
function foresightData(item, enabled) {
  return {_id: EFFECT, name: '原力预知', img: item.img, transfer: true, disabled: !enabled,
    flags: {[ID]: {[MARK]: 'foresight'}}, changes: [
      {key: 'system.attributes.senses.blindsight', mode: CONST.ACTIVE_EFFECT_MODES.UPGRADE, value: '10', priority: 20},
      {key: 'system.attributes.init.bonus', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: '@abilities.wis.mod', priority: 20}
    ]};
}
async function syncVision(actor, enabled) {
  const patchVision = (current, previous) => {
    const next = clone(current), index = next.findIndex(m => m.id === 'blindsight');
    if (enabled) {
      const before = previous ? previous.before : (index < 0 ? null : clone(next[index]));
      const range = Math.max(10, Number(before?.range ?? 0), Number(actor.system.attributes.senses.blindsight ?? 0));
      const entry = {...(index < 0 ? {} : next[index]), id: 'blindsight', enabled: true, range};
      if (index < 0) next.push(entry); else next[index] = entry;
      return {next, flag: {before, appliedRange: range}};
    }
    if (!previous) return {next, flag: null};
    if (index >= 0 && next[index].range === previous.appliedRange) {
      if (previous.before) next[index] = previous.before; else next.splice(index, 1);
    }
    return {next, flag: null};
  };
  const previous = actor._source.prototypeToken?.flags?.[ID]?.foresightVision;
  const result = patchVision(modes(actor), previous), patch = {};
  if (!same(result.next, modes(actor))) patch['prototypeToken.detectionModes'] = result.next;
  if (result.flag && !same(result.flag, previous)) patch[`prototypeToken.flags.${ID}.foresightVision`] = result.flag;
  if (!result.flag && previous) patch[`prototypeToken.flags.${ID}.-=foresightVision`] = null;
  if (Object.keys(patch).length) await actor.update(patch);
  for (const scene of game.scenes) for (const token of scene.tokens) {
    if (token.actor?.uuid !== actor.uuid) continue;
    const old = token._source.flags?.[ID]?.foresightVision, current = token.toObject().detectionModes ?? [];
    const state = patchVision(current, old), update = {};
    if (!same(state.next, current)) update.detectionModes = state.next;
    if (state.flag && !same(state.flag, old)) update[`flags.${ID}.foresightVision`] = state.flag;
    if (!state.flag && old) update[`flags.${ID}.-=foresightVision`] = null;
    if (Object.keys(update).length) await token.update(update);
  }
}
async function syncActor(actor) {
  if (!actor || !actor.isToken && !game.actors.has(actor.id) || actor.isToken && !actor.token?.parent?.tokens.has(actor.token.id)) return [];
  if (!actor?.isOwner || (!isJedi(actor) && !awareness(actor) && !actor.prototypeToken?.flags?.[ID]?.foresightVision)) return [];
  const changes = [];
  if (isJedi(actor) && fighterLevel(actor) >= 7 && !awareness(actor)) {
    const subclass = actor.items.find(i => i.type === 'subclass' && i.system.identifier === 'jedi');
    const granted = await globalThis.jediGrantSubclass(subclass, {throughLevel: 7});
    changes.push(...granted.map(name => `grant:${name}`));
  }
  const item = awareness(actor), pool = force(actor), qualified = hasJediLevel7(actor);
  if (pool && isJedi(actor)) {
    const max = 4 + 2 * Math.max(0, Math.floor((fighterLevel(actor) - 1) / 4));
    if (Number(pool.system.uses.max) !== max) {await pool.update({'system.uses.max': String(max)}); changes.push('forceMax');}
  }
  if (item) {
    if (await repairCard(item, pool)) changes.push('level7Card');
    const data = foresightData(item, qualified && awake(actor)), existing = item.effects.get(EFFECT);
    if (!existing) {await item.createEmbeddedDocuments('ActiveEffect', [data], {keepId: true}); changes.push('foresight');}
    else if (existing.disabled !== data.disabled || !same(existing.toObject().changes, data.changes) || existing.transfer !== true) {
      await existing.update({disabled: data.disabled, transfer: true, changes: data.changes}); changes.push('foresight');
    }
    if (pool) {
      const patch = {};
      for (const activity of item.system.activities) {
        if (!Object.values(JEDI_SEVEN).includes(activity.id)) continue;
        const value = [JEDI_SEVEN.nimanPush, JEDI_SEVEN.nimanPull].includes(activity.id) ? '1' : '2';
        const target = activity.consumption.targets[0];
        if (activity.consumption.targets.length !== 1 || target?.type !== 'itemUses' || target.target !== pool.id || String(target.value) !== value)
          patch[`system.activities.${activity.id}.consumption.targets`] = [{type: 'itemUses', target: pool.id, value, scaling: {mode: '', formula: ''}}];
      }
      if (Object.keys(patch).length) {await item.update(patch); changes.push('castResources');}
    }
  }
  if ((!qualified && (activeStyle(actor, 'II') || activeStyle(actor, 'VI'))) || MidiQOL.checkIncapacitated(actor, false, false) && actor.effects.some(e => e.flags?.[ID]?.stance)) await globalThis.jediClearStances(actor);
  const ac = actor.effects.find(e => e.flags?.[ID]?.[MARK] === 'makashiAC');
  const wantAC = qualified && activeStyle(actor, 'II') && heldInOneHand(actor) && !MidiQOL.checkIncapacitated(actor, false, false);
  const acChanges = [{key: actor.system.attributes.ac.calc === 'flat' ? 'system.attributes.ac.flat' : 'system.attributes.ac.bonus', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: '1', priority: 20}];
  if (wantAC && !ac) {
    await actor.createEmbeddedDocuments('ActiveEffect', [{name: '马卡希 · 单手守势', img: item.img, origin: item.uuid, transfer: false,
      flags: {[ID]: {[MARK]: 'makashiAC'}}, changes: acChanges}]);
    changes.push('makashiAC');
  } else if (wantAC && ac && !same(ac.toObject().changes, acChanges)) {
    await ac.update({changes: acChanges}); changes.push('makashiAC');
  } else if (!wantAC && ac) {await ac.delete(); changes.push('makashiAC');}
  await syncVision(actor, qualified && awake(actor));
  return changes;
}
export function syncJediLevel7(actor) {
  if (!primary() || !actor?.isOwner || !actor.isToken && !game.actors.has(actor.id)) return Promise.resolve([]);
  const previous = queues.get(actor.uuid) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => syncActor(actor)); queues.set(actor.uuid, current);
  current.finally(() => {if (queues.get(actor.uuid) === current) queues.delete(actor.uuid);}).catch(() => {});
  return current;
}
export async function migrateJediLevel7(actors = game.actors) {
  const changes = [];
  for (const actor of actors) if (isJedi(actor) || awareness(actor) || actor.prototypeToken?.flags?.[ID]?.foresightVision) changes.push(...await syncJediLevel7(actor));
  if (actors === game.actors && primary()) for (const item of game.items) if (item.system.identifier === 'force-awareness' && await repairCard(item)) changes.push('worldCard');
  return changes;
}
function duelEligible(actor, itemId, sourceUuid, targetUuid) {
  const source = fromUuidSync(sourceUuid), target = fromUuidSync(targetUuid);
  if (!hasJediLevel7(actor) || !activeStyle(actor, 'II') || saber(actor)?.id !== itemId || !source?.object || !target?.object || source.parent.id !== target.parent.id) return false;
  if (MidiQOL.computeDistance(source.object, target.object, {wallsBlock: false}) > 5) return false;
  return !target.parent.tokens.some(t => t.id !== source.id && t.id !== target.id && t.actor && !t.actor.statuses.has('dead') && MidiQOL.computeDistance(t.object, target.object, {wallsBlock: false}) <= 5);
}
export async function precisionBonus(workflow) {
  if (workflow?.aborted || workflow?.item?.type !== 'weapon' || workflow.hitTargets?.size !== 1 || !hasJediLevel7(workflow.actor) || !activeStyle(workflow.actor, 'II')) return;
  const target = workflow.hitTargets.first();
  const result = await socket.executeAsGM('precision', workflow.actor.uuid, workflow.item.id, workflow.token.document.uuid, target.document.uuid, workflow.id);
  if (!result) return;
  return new CONFIG.Dice.DamageRoll(`1d${result.face}`, workflow.item.getRollData(), {isCritical: workflow.isCritical}).evaluate();
}
async function guardWorkflow(workflow) {
  const source = sourceActivity(workflow.item, workflow.activity, workflow.actor);
  if (!source || !Object.values(JEDI_SEVEN).includes(source.id)) return;
  if (!hasJediLevel7(workflow.actor) || MidiQOL.checkIncapacitated(workflow.actor, false, false)) {ui.notifications.warn('需要清醒且具备七级绝地武士特性'); return false;}
  const cost = [JEDI_SEVEN.nimanPush, JEDI_SEVEN.nimanPull].includes(source.id) ? 1 : 2;
  if (remainingForce(workflow.actor) < cost) {ui.notifications.warn(`需要 ${cost} 枚原力骰`); return false;}
  if (NIMAN.has(source.id)) {
    if (!ownTurn(workflow.actor) || !activeStyle(workflow.actor, 'VI')) {ui.notifications.warn('尼曼攻击替换只能在自己的回合、处于第六型时使用'); return false;}
    const reservation = workflow.jediNimanReservation ?? foundry.utils.randomID();
    const claimed = await socket.executeAsGM('reserve', workflow.actor.uuid, reservation);
    if (!claimed) {ui.notifications.warn('本回合攻击动作的攻击次数已用完'); return false;}
    workflow.jediNimanReservation = reservation;
  }
}
async function completeAction(workflow) {
  const actor = workflow.actor;
  if (!actor || !hasJediLevel7(actor)) return;
  if (workflow.jediNimanReservation) {
    await socket.executeAsGM('complete', actor.uuid, workflow.jediNimanReservation, workflow.aborted ? 'cancel' : 'replace'); return;
  }
  if (workflow.aborted || !ownTurn(actor) || workflow.workflowOptions?.isTriggered || workflow.workflowOptions?.jediRiposteActor) return;
  const identifier = String(workflow.item?.system.identifier ?? '').replaceAll('-', '').toLowerCase();
  if (identifier === 'actionsurge') return socket.executeAsGM('complete', actor.uuid, workflow.id, 'surge');
  if (workflow.activity?.activation.type !== 'action') return;
  return socket.executeAsGM('complete', actor.uuid, workflow.id, workflow.item.type === 'weapon' && workflow.activity.type === 'attack' ? 'attack' : 'other');
}
async function suggestionEffects(workflow) {
  if (workflow.aborted || workflow.jediSuggestionResolved) return;
  const source = sourceActivity(workflow.item, workflow.activity, workflow.actor);
  if (![JEDI_SEVEN.suggestion, JEDI_SEVEN.nimanSuggestion].includes(source?.id)) return;
  workflow.jediSuggestionResolved = true;
  const template = workflow.item.effects.find(e => e.type !== 'enchantment' && e.statuses.has('charmed'));
  if (!template) return;
  const rootId = workflow.chatCard?.getFlag('dnd5e', 'use.concentrationId');
  const root = workflow.actor.effects.get(rootId);
  for (const token of workflow.failedSaves ?? []) {
    if (token.actor.system.traits.ci.value.has('charmed')) continue;
    if (token.actor.effects.some(e => e.name === template.name && (e.origin === workflow.item.uuid || e.origin === root?.uuid))) continue;
    const data = template.toObject();delete data._id;
    Object.assign(data, {origin: workflow.item.uuid, transfer: false, disabled: false, duration: chrisPremades.utils.itemUtils.convertDuration(workflow.item)});
    data.flags ??= {};data.flags[ID] = {...data.flags[ID], jediSuggestion: root?.uuid ?? workflow.item.uuid};
    await chrisPremades.utils.effectUtils.createEffect(token.actor, data, {concentrationItem: workflow.item});
  }
}
async function mastery(workflow) {
  if (workflow.aborted || !hasJediLevel7(workflow.actor) || saber(workflow.actor)?.id !== workflow.item?.id || !workflow.hitTargets?.size) return;
  const key = activeStyle(workflow.actor, 'II') ? 'vex' : activeStyle(workflow.actor, 'VI') ? 'slow' : null;
  if (!key) return;
  const macro = chrisPremades.utils.macroUtils.getMacro(`${key}Mastery`, 'modern');
  if (!macro?.masteryMacro) return;
  for (const target of workflow.hitTargets) {
    const damage = workflow.damageList?.find(d => d.tokenUuid === target.document.uuid || d.targetUuid === target.document.uuid || d.actorUuid === target.actor.uuid);
    if (!damage || !(damage.hpDamage + damage.tempDamage > 0)) continue;
    if (key === 'vex' && workflow.actor.effects.some(e => e.flags?.['chris-premades']?.mastery?.vex?.target === target.id)) continue;
    const context = {actor: workflow.actor, item: workflow.item, activity: workflow.activity, token: workflow.token,
      targets: new Set([target]), hitTargets: new Set([target]), damageItem: damage};
    const previous = new Set(workflow.actor.effects.map(e => e.id));
    await macro.masteryMacro({workflow: context});
    if (key === 'vex') for (const effect of workflow.actor.effects) {
      if (!previous.has(effect.id) && effect.flags?.['chris-premades']?.mastery?.vex?.target === target.id) await effect.setFlag(ID, 'jediVex', true);
    }
  }
}
export function registerJediLevel7() {
  socket = namespaceSocket('jediLevel7');
  socket.register('sync', async uuid => syncJediLevel7(await fromUuid(uuid)));
  socket.register('precision', async (uuid, itemId, sourceUuid, targetUuid, workflowId) => {
    const actor = await fromUuid(uuid); if (!actor || precisionLocks.has(uuid)) return false;
    precisionLocks.add(uuid);
    try {
      const key = turn() ?? `workflow:${workflowId}`;
      if (actor.flags?.[ID]?.precisionTurn === key || !duelEligible(actor, itemId, sourceUuid, targetUuid)) return false;
      await actor.setFlag(ID, 'precisionTurn', key); return {face: forceDie(actor)};
    } finally {precisionLocks.delete(uuid);}
  });
  socket.register('reserve', async (uuid, workflowId) => {
    const actor = await fromUuid(uuid);
    if (!hasJediLevel7(actor) || !ownTurn(actor) || !activeStyle(actor, 'VI')) return false;
    const key = turn(), entries = pending.get(uuid)?.turn === key ? pending.get(uuid) : {turn: key, ids: new Set(), completed: new Set()};
    pending.set(uuid, entries);
    if (entries.ids.has(workflowId)) return true;
    if (budget(actor).remaining <= entries.ids.size) return false;
    entries.ids.add(workflowId); return true;
  });
  socket.register('complete', async (uuid, workflowId, kind) => {
    const previous = actionQueues.get(uuid) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
    const actor = await fromUuid(uuid); if (!actor) return;
    let entries = pending.get(uuid);
    if (!entries || entries.turn !== turn()) {entries = {turn: turn(), ids: new Set(), completed: new Set()}; pending.set(uuid, entries);}
    if (entries.completed.has(workflowId)) return;
    const reserved = entries.ids.delete(workflowId);
    if (kind === 'cancel') return;
    if (!ownTurn(actor) || kind === 'replace' && !reserved) return;
    entries.completed.add(workflowId);
    const data = budget(actor);delete data.remaining;delete data.attacksPerAction;
    if (kind === 'surge') data.surges++;
    else if (kind === 'other') data.otherActions++;
    else data.attacks++;
    await actor.update({[`flags.${ID}.attackAction`]: data, ...(kind === 'replace' ? {'flags.midi-qol.actions.action': true} : {})});
    });
    actionQueues.set(uuid, current);
    try {return await current;} finally {if (actionQueues.get(uuid) === current) actionQueues.delete(uuid);}
  });
  Hooks.on('preCreateItem', item => {
    const relative = item._source.flags?.dnd5e?.cachedFor;
    if (!relative || !item.actor) return;
    const source = awareness(item.actor)?.system.activities.find(a => a.relativeUUID === relative);
    if (!source || !Object.values(JEDI_SEVEN).includes(source.id)) return;
    const properties = new Set(item._source.system.properties ?? []);properties.delete('vocal');properties.delete('material');properties.add('somatic');
    item.updateSource({'system.properties': [...properties], [`flags.${ID}.jediMindSpell`]: {sourceId: source.item.id, activityId: source.id}});
  });
  Hooks.on('midi-qol.preTargetingV2', ({workflow}) => guardWorkflow(workflow));
  Hooks.on('dnd5e.preUseLinkedSpell', activity => {
    if (activity.item.system.identifier === 'force-awareness' && !hasJediLevel7(activity.actor)) {ui.notifications.warn('需要战士七级与绝地武士特性'); return false;}
  });
  Hooks.on('midi-qol.AttackRollComplete', async workflow => {
    if (hasJediLevel7(workflow.actor) && saber(workflow.actor)?.id === workflow.item?.id) {
      await workflow.actor.setFlag(ID, 'saberGrip', workflow.attackMode ?? 'oneHanded');
      await socket.executeAsGM('sync', workflow.actor.uuid);
    }
    const ids = new Set([...workflow.targets ?? []].map(t => t.id));
    const effects = workflow.actor?.effects.filter(e => e.flags?.[ID]?.jediVex && ids.has(e.flags?.['chris-premades']?.mastery?.vex?.target)) ?? [];
    if (effects.length) await chrisPremades.utils.genericUtils.deleteEmbeddedDocuments(workflow.actor, 'ActiveEffect', effects.map(e => e.id));
  });
  Hooks.on('midi-qol.RollComplete', completeAction);
  Hooks.on('midi-qol.RollComplete', suggestionEffects);
  Hooks.on('midi-qol.postCleanup', mastery);
  Hooks.on('midi-qol.preAbort', workflow => {
    if (workflow.jediNimanReservation) return socket.executeAsGM('complete', workflow.actor.uuid, workflow.jediNimanReservation, 'cancel');
  });
  const schedule = actor => {
    if (actor?.documentName === 'Actor' && (isJedi(actor) || awareness(actor) || actor.prototypeToken?.flags?.[ID]?.foresightVision)) syncJediLevel7(actor).catch(error => console.error(`[${ID}] Jedi level 7 sync`, error));
  };
  for (const hook of ['createItem', 'updateItem', 'deleteItem', 'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']) Hooks.on(hook, doc => schedule(doc.parent?.documentName === 'Actor' ? doc.parent : doc.parent?.actor));
  Hooks.on('updateActor', actor => schedule(actor));
  Hooks.on('createActor', actor => schedule(actor));
  Hooks.on('createToken', token => schedule(token.actor));
  if (primary()) migrateJediLevel7().catch(console.error);
}
