const ID = 'fvtt-automation-repair';
const forms = actor => actor?.items.find(item => item.system?.identifier === 'saber-forms');
const pool = actor => actor?.items.find(item => item.system?.identifier === 'force-harmony');
const canSpend = item => !!item && Number(item.system.uses.max) > Number(item.system.uses.spent ?? 0);
const inStance = (actor, style) => actor?.effects.some(effect =>
  !effect.disabled && !effect.isSuppressed && effect.flags?.[ID]?.stance === style) && !!forms(actor);
const canReact = actor => !MidiQOL.hasUsedReaction(actor) && !MidiQOL.checkIncapacitated(actor, false, false);
const locks = new Set();
const offeredDamage = new WeakMap();
const completedAttacks = new WeakSet();
let socket;

function owner(actor) {
  const players = game.users.filter(user => user.active && !user.isGM && actor.testUserPermission(user, 'OWNER'));
  return players.find(user => user.character?.id === actor.id)
    ?? players.find(user => actor.ownership?.[user.id] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
    ?? players[0] ?? game.users.activeGM;
}

async function onOwner(name, token, ...args) {
  const user = owner(token.actor);
  if (!user) return;
  const uuid = token.document.uuid;
  if (user.id !== game.user.id) return socket.executeAsUser(name, user.id, uuid, ...args);
  return handlers[name](uuid, ...args);
}

async function locked(uuid, style, resolve) {
  const doc = await fromUuid(uuid);
  const actor = doc?.actor;
  if (!actor?.isOwner || !inStance(actor, style) || !canReact(actor) || locks.has(actor.uuid)) return;
  locks.add(actor.uuid);
  try { return await resolve(doc, actor); }
  finally { locks.delete(actor.uuid); }
}

async function ask(title, content) {
  return (await chrisPremades.utils.dialogUtils.confirm(title, content, {userId: game.user.id})) === true;
}

async function spendReaction(actor, resource) {
  const before = resource?.system.uses.spent ?? 0;
  if (resource) await resource.update({'system.uses.spent': before + 1});
  try { await MidiQOL.setReactionUsed(actor); }
  catch (error) {
    if (resource?.system.uses.spent === before + 1) await resource.update({'system.uses.spent': before});
    throw error;
  }
}

async function chooseDeflection(uuid, damage) {
  if (!Number.isFinite(damage) || damage <= 0) return;
  return locked(uuid, 'III', async (token, actor) => {
    if (!await ask('飞矢偏转', '<p>消耗反应，投掷 1d8 + 感知调整值 + 战士等级的一半（向下取整），减少本次远程攻击伤害。</p>')) return;
    const extra = canSpend(pool(actor)) && await ask('额外消耗原力骰？', '<p>消耗 1 枚原力骰，额外减伤 1d8。选择“否”仍进行基础格挡。</p>');
    if (!inStance(actor, 'III') || !canReact(actor)) return;
    const resource = extra && canSpend(pool(actor)) ? pool(actor) : null;
    const fighter = actor.items.find(item => item.type === 'class' && item.system.identifier === 'fighter');
    const halfLevel = Math.floor(Number(fighter?.system.levels ?? 0) / 2);
    const roll = await new Roll(`1d8${resource ? ' + 1d8' : ''} + ${actor.system.abilities.wis.mod} + ${halfLevel}`, actor.getRollData()).evaluate();
    await spendReaction(actor, resource);
    const cut = Math.min(damage, Math.max(0, roll.total));
    try {
      await roll.toMessage({speaker: ChatMessage.getSpeaker({actor, token}), flavor: `飞矢偏转：减伤 ${cut}，剩余伤害 ${damage - cut}${resource ? '（消耗 1 枚原力骰）' : ''}`});
    } catch (error) { console.warn(`[${ID}] 飞矢偏转掷骰消息`, error); }
    return cut;
  });
}

export function applyDeflection(ditem, amount) {
  const cut = Math.min(ditem.totalDamage, Math.max(0, amount));
  if (!cut) return;
  // The GM applies damageDetail; the damage card also uses the pre-trait detail.
  ditem.damageDetail.push({value: -cut, active: {multiplier: 1}, type: 'none'});
  if (ditem.rawDamageDetail !== ditem.damageDetail) ditem.rawDamageDetail.push({value: -cut, type: 'none'});
  ditem.totalDamage -= cut;
  const detail = ditem.damageDetail.reduce((sum, entry) => {
    if (entry.type === 'temphp') sum.temp += entry.value;
    else if (entry.type !== 'midi-none') sum.hp += entry.value;
    return sum;
  }, {hp:0, temp:0});
  const net = Math.trunc(detail.hp);
  ditem.healingAdjustedTotalDamage = net;
  const absorbed = Math.min(ditem.oldTempHP ?? 0, Math.max(0, net));
  ditem.newTempHP = Math.max(detail.temp, (ditem.oldTempHP ?? 0) - absorbed);
  const maximum = ditem.tokenUuid ? fromUuidSync(ditem.tokenUuid)?.actor?.system.attributes.hp.effectiveMax : undefined;
  ditem.newHP = Math.min(maximum ?? Infinity, Math.max(0, ditem.oldHP - net + absorbed));
  ditem.hpDamage = ditem.oldHP - ditem.newHP;
  ditem.tempDamage = (ditem.oldTempHP ?? 0) - ditem.newTempHP;
  return cut;
}

async function onIncomingDamage(token, {workflow, ditem}) {
  if (!workflow || workflow.aborted || !ditem?.isHit || !(ditem.totalDamage > 0)) return;
  if (!Array.isArray(ditem.damageDetail) || !Array.isArray(ditem.rawDamageDetail)) return;
  const type = workflow.activity?.getActionType?.(workflow.attackMode) ?? workflow.activity?.actionType;
  if (!['rwak', 'rsak'].includes(type) || !inStance(token?.actor, 'III') || !canReact(token.actor)) return;
  let offered = offeredDamage.get(workflow);
  if (!offered) { offered = new Set(); offeredDamage.set(workflow, offered); }
  if (offered.has(token.document.uuid)) return;
  offered.add(token.document.uuid);
  const cut = await onOwner('deflect', token, ditem.totalDamage);
  if (!(cut > 0)) return;
  applyDeflection(ditem, cut);
  if (globalThis.Sequencer) {
    const pack = game.modules.get('jb2a_patreon')?.active ? 'jb2a_patreon' : 'JB2A_DnD5e';
    try {
      new Sequence().effect().file(`modules/${pack}/Library/Generic/Weapon_Attacks/Melee/Slash02/GenericSlash02_001_001_Blue_800x600.webm`).atLocation(token).scaleToObject(1.1).fadeIn(50).fadeOut(150).play().catch(console.warn);
    } catch (error) { console.warn(`[${ID}] 飞矢偏转动画`, error); }
  }
}

// Older copies of the item can still call the CPR pass before the native Midi hook.
export function embeddedDeflect({workflow, trigger, ditem}) {
  const token = trigger?.token ?? (ditem?.tokenUuid ? fromUuidSync(ditem.tokenUuid)?.object : null);
  if (token) return onIncomingDamage(token, {workflow, ditem});
}

function saberAttack(actor) {
  const lit = actor?.flags?.[ID]?.saber;
  const item = lit?.lit && actor.items.get(lit.itemId);
  if (item?.type !== 'weapon' || !item.flags?.[ID]?.original) return;
  return item.system.activities.find(activity => activity.type === 'attack' && activity.getActionType() === 'mwak');
}

function nearby(source, attacker) {
  if (!source?.actor || !attacker?.actor || source.actor.uuid === attacker.actor.uuid || source.document.parent !== attacker.document.parent) return false;
  const distance = chrisPremades.utils.tokenUtils.getDistance(source, attacker);
  return Number.isFinite(distance) && distance >= 0 && distance <= 5;
}

async function chooseRiposte(uuid, attackerUuid, chain = []) {
  return locked(uuid, 'V', async (doc, actor) => {
    const attacker = (await fromUuid(attackerUuid))?.object;
    if (!nearby(doc.object, attacker) || !canSpend(pool(actor)) || !saberAttack(actor)) return;
    if (!await ask('破势反击', `<p>消耗反应与 1 枚原力骰，对 ${foundry.utils.escapeHTML(attacker.name)} 发动一次光剑近战攻击。命中额外造成 1d8 伤害。</p>`)) return;
    const original = saberAttack(actor);
    const resource = pool(actor);
    if (!original || !inStance(actor, 'V') || !canReact(actor) || !canSpend(resource) || !nearby(doc.object, attacker)) return;
    const stem = `system.activities.${original.id}`;
    const patch = {[`${stem}.activation.override`]:true, [`${stem}.activation.type`]:'special'};
    if (original.getActionType(original.attackMode) !== 'mwak') {
      patch[`${stem}.attackMode`] = original.item.system.properties.has('two') ? 'twoHanded' : 'oneHanded';
    }
    const macro = 'MWP-JediSaberBonus';
    const actorMacros = String(actor.getFlag('dnd5e', 'DamageBonusMacro') ?? '').split(',').map(s => s.trim());
    const itemMacros = String(original.item.flags?.['midi-qol']?.onUseMacroName ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!actorMacros.includes(macro) && !itemMacros.includes('[damageBonus]' + macro)) patch['flags.midi-qol.onUseMacroName'] = [...itemMacros, '[damageBonus]' + macro].join(',');
    const weapon = original.item.clone(patch, {keepId:true});
    const attack = weapon.system.activities.get(original.id);
    const selected = actor.getActiveTokens().filter(t => t.controlled);
    const switchToken = ChatMessage.getSpeaker({actor}).token !== doc.id;
    if (switchToken) {
      for (const token of selected) token.release();
      doc.object.control({releaseOthers:false});
    }
    const key = foundry.utils.randomID();
    let paid = false;
    const charge = async workflow => {
      if (paid || workflow.workflowOptions?.jediRiposteId !== key || !workflow.attackRoll) return;
      if (!inStance(actor, 'V') || !canReact(actor) || !canSpend(resource) || saberAttack(actor)?.item.id !== weapon.id || workflow.token?.document.uuid !== uuid || !nearby(doc.object, attacker)) {
        workflow.aborted = true;
        return;
      }
      try { await spendReaction(actor, resource); paid = true; }
      catch (error) { workflow.aborted = true; console.error(`[${ID}] 破势反击消费失败`, error); }
    };
    // An attack roll exists here, but Midi can still abort before checking hits or dealing damage.
    const hook = Hooks.on('midi-qol.preCheckHits', charge);
    try {
      await MidiQOL.completeActivityUse(attack, {midiOptions: {
        targetUuids: [attackerUuid], ignoreUserTargets: true, isTriggered: true,
        workflowOptions: {targetConfirmation: 'none', notReaction: true, autoRollAttack: true, autoRollDamage: 'onHit',
          autoFastAttack: true, fastForwardDamage: true, jediRiposteActor: actor.uuid, jediRiposteId: key,
          jediRiposteChain: [...chain, actor.uuid]}
      }}, {configure: false});
      return paid;
    } finally {
      Hooks.off('midi-qol.preCheckHits', hook);
      if (switchToken && doc.object?.controlled && actor.getActiveTokens().filter(t => t.controlled).length === 1) {
        doc.object.release();
        for (const token of selected) if (!token.destroyed) token.control({releaseOthers:false});
      }
    }
  });
}

async function offerRipostes(workflow) {
  const attacker = workflow.token;
  if (workflow.aborted || !workflow.attackRoll || workflow.activity?.type !== 'attack' || !attacker?.actor || completedAttacks.has(workflow)) return;
  completedAttacks.add(workflow);
  const chain = workflow.workflowOptions?.jediRiposteChain ?? [];
  const seen = new Set(chain);
  for (const token of attacker.document.parent.tokens.map(doc => doc.object)) {
    const actor = token?.actor;
    if (!inStance(actor, 'V') || seen.has(actor.uuid) || !canReact(actor) || !canSpend(pool(actor)) || !saberAttack(actor) || !nearby(token, attacker)) continue;
    seen.add(actor.uuid);
    try { await onOwner('riposte', token, attacker.document.uuid, chain); }
    catch (error) { console.error(`[${ID}] ${actor.name} 破势反击`, error); }
  }
}

const handlers = {deflect: chooseDeflection, riposte: chooseRiposte};
export function registerJediReactions(channel) {
  socket = channel;
  for (const [name, handler] of Object.entries(handlers)) socket.register(name, handler);
  Hooks.on('midi-qol.preTargetDamageApplication', onIncomingDamage);
  const afterAttack = workflow => {
    // Release the triggering attack before an owner starts a separate weapon workflow.
    if (workflow.activity?.type === 'attack' && workflow.attackRoll && !workflow.aborted)
      setTimeout(() => offerRipostes(workflow).catch(error => console.error(`[${ID}] Jedi riposte`, error)), 0);
  };
  Hooks.on('midi-qol.RollComplete', afterAttack);
  Hooks.on('midi-qol.preWaitForDamageRoll', workflow => {
    // With auto-completion off Midi can park a resolved miss on its unused Damage button.
    const config = MidiQOL.configSettings();
    if (workflow.activity?.type === 'attack' && workflow.targets?.size && !workflow.hitTargets.size && !workflow.hitTargetsEC?.size
        && config.autoCheckHit !== 'none' && config.confirmAttackDamage === 'none'
        && !workflow.shouldRollDamage && !workflow.activity.hasSave && !workflow.otherActivity) afterAttack(workflow);
  });
}

// Route the optional manual button before Midi records its reaction in combat.
export function manualRiposte(workflow) {
  if (workflow?.item?.system.identifier !== 'saber-forms' || workflow.activity?.name !== '破势反击') return;
  const token = workflow.token;
  const targets = [...(workflow.targets?.size ? workflow.targets : game.user.targets)];
  const target = targets[0], actor = token?.actor;
  if (!inStance(actor, 'V') || !canReact(actor) || !canSpend(pool(actor)) || !saberAttack(actor)) ui.notifications.warn('需要第五型、已点亮的近战光剑、未使用的反应和一枚原力骰。');
  else if (targets.length !== 1 || !nearby(token, target)) ui.notifications.warn('请选择一名 5 尺内的攻击者。');
  else setTimeout(() => onOwner('riposte', token, target.document.uuid, []).catch(console.error), 0);
  return false;
}
