import {hasJediLevel7} from "./jedi-level7-1.js";
import {embeddedDeflect, manualRiposte, registerJediReactions} from './jedi-reactions-1.js';
import {prepareJediThrow, registerJediThrow, throwSourcePatch} from './jedi-throw-1.js';
import {namespaceSocket} from './socket-1.js';
// Jedi-specific CPR handlers. Keep the original workflow and damage object by reference.
const ID = 'fvtt-automation-repair';
let jediSocket;
const utils = () => chrisPremades.utils;
const entity = ({trigger, workflow}) => trigger?.entity ?? workflow?.item;
const stance = (actor, key) => actor?.effects.some(e => !e.disabled && !e.isSuppressed && e.flags?.[ID]?.stance === key);
const forcePool = actor => actor?.items.find(i => i.system?.identifier === 'force-harmony');
const available = pool => !!pool && Number(pool.system.uses.spent ?? 0) < Number(pool.system.uses.max ?? 4);
const activeSaber = actor => {
  const saber = actor?.flags?.[ID]?.saber;
  const weapon = saber?.lit && actor.items.get(saber.itemId);
  return weapon?.type === 'weapon' && weapon.flags?.[ID]?.original ? weapon : null;
};
const test = key => globalThis.JF_TEST?.[key];
function playForceFx(source, targets, throwing = false) {
  if (!globalThis.Sequencer || !source) return;
  try {
    const pack = game.modules.get('jb2a_patreon')?.active ? 'jb2a_patreon' : 'JB2A_DnD5e';
    const asset = throwing ? 'EnergyBeam_01_Regular_Blue_30ft_1600x400.webm' : 'EnergyAttack_01_01_Regular_Blue_1000x1000.webm';
    for (const target of targets) new Sequence().effect().file(`modules/${pack}/Library/Generic/Energy/${asset}`).atLocation(source).stretchTo(target).play();
  } catch (error) { console.warn(`[${ID}] Jedi force animation`, error); }
}
async function confirm(actor, key, title, content) {
  if (test(key) !== undefined) return test(key) === true;
  const userId = utils().socketUtils.firstOwner(actor, true);
  return (await utils().dialogUtils.confirm(title, content, {userId})) === true;
}


async function empathySkill(context) {
  const {trigger} = context, item = entity(context), actor = trigger?.actor ?? item?.actor;
  if (!trigger?.roll || !actor || !['ins', 'prc', 'per'].includes(trigger.skillId)) return;
  let pool = forcePool(actor);
  if (!available(pool) || !await confirm(actor, 'empathy', '原力共情', '<p>消耗 1 枚原力骰，将 1d8 加到这次检定？</p><p>使用即消耗。</p>')) return;
  pool = forcePool(actor); if (!available(pool)) return;
  const roll = await utils().rollUtils.addToRoll(trigger.roll, ' + 1d8');
  await utils().genericUtils.update(pool, {'system.uses.spent': Number(pool.system.uses.spent ?? 0) + 1});
  return roll;
}

async function changeStance(context) {
  const {workflow} = context, item = entity(context);
  if (!workflow || workflow.item?.id !== item?.id) return;
  const choices = {'第二型·马卡希': ['II', 'vex'], '第六型·尼曼': ['VI', 'slow'], '第三型·索雷苏': ['III', 'sap'], '第四型·阿塔鲁·迅击': ['IV', 'nick'], '第四型·阿塔鲁·推离': ['IV', 'push'], '第五型·德杰姆苏·擦掠': ['V', 'graze'], '第五型·德杰姆苏·失衡': ['V', 'topple']};
  const choice = choices[workflow.activity?.name]; if (!choice) return;
  if (["II", "VI"].includes(choice[0]) && !hasJediLevel7(item.actor)) {ui.notifications.warn("需要战士七级与原力觉知特性"); return true;}
  await globalThis.jediApplyStanceKey(item.actor, choice[0], {mastery: choice[1]});
  return true;
}


async function forceUse(context) {
  const {workflow} = context, item = entity(context);
  if (!workflow || workflow.aborted || workflow.item?.id !== item?.id || workflow.jediForceResolved) return;
  const rawName = workflow.activity?.name;
  const name = rawName?.startsWith("尼曼·推斥") ? "原力控物·推斥" : rawName?.startsWith("尼曼·牵引") ? "原力控物·牵引" : rawName;
  if (!['原力控物·推斥', '原力控物·牵引', '隔空御剑'].includes(name)) return;
  workflow.jediForceResolved = true; // Resource use is handled once by the native itemUses consumption.
  if (name === '隔空御剑') {playForceFx(workflow.token, workflow.targets ?? [], true); return;}
  const source = workflow.token;
  if (!source) return;
  let moved = 0;
  for (const target of workflow.failedSaves ?? []) {
    if (!target?.actor || target.document.parent?.id !== source.document.parent?.id) continue;
    const targetCenter = target.document.getCenterPoint(target.document._source);
    const sourceCenter = source.document.getCenterPoint(source.document._source);
    const dx = targetCenter.x - sourceCenter.x, dy = targetCenter.y - sourceCenter.y;
    const length = Math.hypot(dx, dy); if (!length) continue;
    const feet = name.includes('推斥') ? 15 : Math.min(15, Math.max(0, utils().tokenUtils.getDistance(source, target) - 5));
    if (!feet) continue;
    const pixels = feet / canvas.scene.grid.distance * canvas.scene.grid.size, sign = name.includes('推斥') ? 1 : -1;
    const end = {x: targetCenter.x + dx / length * pixels * sign, y: targetCenter.y + dy / length * pixels * sign};
    const collision = target.checkCollision?.(end, {origin: targetCenter, type: 'move', mode: 'closest'});
    if (collision) continue;
    const position = {x: Math.round(target.document._source.x + dx / length * pixels * sign), y: Math.round(target.document._source.y + dy / length * pixels * sign)};
    if (await jediSocket.executeAsGM('displace', target.document.uuid, position)) moved++;
  }
  await ChatMessage.create({speaker: ChatMessage.getSpeaker({actor: item.actor}), content: `<p><strong>${name}</strong>：${moved} 个豁免失败的目标已${name.includes('推斥') ? '推离' : '拉近'}（最多 15 尺）。</p>`});
  playForceFx(source, workflow.failedSaves ?? []);
}

function forceGate(context) {
  const {workflow} = context, item = entity(context), name = workflow?.activity?.name;
  if (!['原力控物·推斥', '原力控物·牵引', '隔空御剑'].includes(name)) return;
  if (!available(item)) {ui.notifications.warn('原力骰已耗尽'); return true;}
  if (name === '隔空御剑' && !activeSaber(item.actor)) {ui.notifications.warn('光剑未点亮'); return true;}
}
export const jediEmbedded = {deflect: embeddedDeflect, empathySkill, stance: changeStance,
  riposte: ({workflow}) => manualRiposte(workflow) === false || undefined, forceUse, forceGate, moved10() {}};

// Repair only owned Jedi cards; old imported stubs may omit workflow on skill events
// and damage data on targetApplyDamage. Preserve IDs and current resource values.
export async function repairJediItems(actors = game.actors) {
  const changes = [], lists = [...actors].map(a => a.items);
  if (actors === game.actors) {
    lists.push(game.items);
    for (const scene of game.scenes) for (const token of scene.tokens) {
      if (!token.actorLink && token.delta?.items.size && token.actor) lists.push(token.actor.items);
    }
  }
  for (const items of lists) for (const item of items) {
    const identifier = item.system?.identifier;
    if (!['saber-forms', 'force-harmony', 'khyber-saber', 'force-vestment'].includes(identifier)) continue;
    const patch = throwSourcePatch(item._source), macros = item.toObject().flags?.['chris-premades']?.embeddedMacros;
    if (macros) {
      const next = macros.map(m => ({...m, macro: m.macro.replace(/\{workflow,\s*trigger\}/g, '{workflow:typeof workflow!=="undefined"?workflow:undefined,trigger,ditem:typeof ditem!=="undefined"?ditem:undefined}')}));
      if (JSON.stringify(next) !== JSON.stringify(macros)) patch['flags.chris-premades.embeddedMacros'] = next;
    }
    for (const activity of item.system.activities ?? []) {
      const base = `system.activities.${activity.id}.`;
      if (identifier === 'saber-forms' && activity.name === '破势反击' && activity.useConditionText !== 'typeof reaction === "undefined"') patch[base + 'useConditionText'] = 'typeof reaction === "undefined"';
      if (identifier === 'force-harmony' && ['原力控物·推斥', '原力控物·牵引', '隔空御剑'].includes(activity.name)) {
        const targets = [{type: 'itemUses', target: '', value: '1', scaling: {mode: '', formula: ''}}];
        if (!activity.consumption.targets.some(t => t.type === 'itemUses' && !t.target && String(t.value) === '1')) patch[base + 'consumption.targets'] = targets;
      }
    }
    if (Object.keys(patch).length) {await item.update(patch); changes.push({uuid: item.uuid, fields: Object.keys(patch)});}
  }
  return changes;
}

const movementQueues = new Map();
export function registerJediHooks() {
  jediSocket = namespaceSocket('jedi');
  registerJediReactions(jediSocket);
  registerJediThrow();
  jediSocket.register('displace', async (uuid, position) => {
    const doc = await fromUuid(uuid);
    if (doc?.documentName !== 'Token' || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return false;
    return doc.move({...position, action: 'displace'}, {method: 'api', animate: false, jediForcedMovement: true});
  });
  const guard = activity => {
    if (activity?.item?.system?.identifier !== 'force-harmony') return;
    if (forceGate({workflow: {activity}, trigger: {entity: activity.item}})) return false;
  };
  Hooks.on('midi-qol.preTargetingV2', ({workflow, usage}) => {
    if (guard(workflow?.activity) === false || manualRiposte(workflow) === false) return false;
    return prepareJediThrow(workflow, usage);
  });
  Hooks.on('dnd5e.preUseActivity', guard);
  Hooks.on('moveToken', (doc, movement, options, user) => {
    if (game.user.id !== user.id || options.jediForcedMovement || options.isUndo) return;
    const actor = doc.actor;
    if (!actor?.isOwner || !stance(actor, 'IV')) return;
    if (movement.passed.waypoints.some(w => w.action === 'displace' || CONFIG.Token.movement.actions[w.action]?.teleport)) return;
    if (game.combat?.started && game.combat.combatant?.actor?.uuid !== actor.uuid) return;
    const turn = game.combat?.started ? `${game.combat.id}:${game.combat.round}:${game.combat.turn}` : `scene:${doc.parent.id}`;
    const feet = Number(movement.passed.distance);
    if (!(feet > 0)) return;
    const queued = (movementQueues.get(actor.uuid) ?? Promise.resolve()).then(async () => {
      const old = actor.flags?.[ID]?.movedDistance;
      const distance = (old?.turn === turn ? Number(old.feet) || 0 : 0) + feet;
      await actor.update({[`flags.${ID}.movedDistance`]: {turn, feet: distance}, ...(distance >= 10 ? {[`flags.${ID}.moved10`]: true} : {})});
    }).catch(error => console.error(`[${ID}] Jedi movement failed`, error));
    movementQueues.set(actor.uuid, queued);
    queued.finally(() => {if (movementQueues.get(actor.uuid) === queued) movementQueues.delete(actor.uuid);});
  });
}
