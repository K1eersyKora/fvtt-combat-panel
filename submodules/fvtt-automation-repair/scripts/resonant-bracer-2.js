const SPELL_UUID = 'Compendium.mystic-weapon-pack.items.Item.soulResonance001';
const SPELL_ICON = 'modules/mystic-weapon-pack/assets/soul-resonance.webp';
const BRACER_ICON = 'modules/mystic-weapon-pack/assets/resonant-bracer.webp';
const ELDRITCH_EFFECT = 'jb2a.eldritch_blast.purple';

function isBracer(item) {
  return item?.type === 'weapon' && item.system.identifier === 'resonant-bracer';
}

function isBracerCast(activity) {
  return activity?.type === 'cast' && activity.spell?.uuid === SPELL_UUID && isBracer(activity.item);
}

function isResonanceSpell(item) {
  return item?.type === 'spell' && item.system.identifier === 'soul-resonance';
}

function requireBracer(activity) {
  if (isBracerCast(activity) && activity.item.system.equipped && activity.item.system.attuned) return;
  ui.notifications.warn('你必须装备魔音护臂并与其同调，才能施展夺魂魔音。');
  return false;
}

export function resonanceBeam(activity) {
  if (activity?.type === 'attack' && isResonanceSpell(activity.item)) return activity;
  if (isBracerCast(activity)) return activity.cachedSpell?.system.activities.get('bracerSpellHit01') ?? null;
  return null;
}

export function resonancePlan(activity) {
  if (!isBracerCast(activity) && !resonanceBeam(activity)) return null;
  const actor = activity.actor;
  const details = actor?.system?.details;
  const level = Number(actor?.type === 'npc' ? details?.cr : details?.level) || 0;
  const count = level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
  return { repeat: true, max: count, spell: 'soulResonance' };
}

export function resonanceTargetsInRange(activity, source, targets) {
  const beam = resonanceBeam(activity) ?? activity;
  return MidiQOL.checkActivityRange(beam, source, new Set(targets), false).result !== 'fail';
}

export function configureResonancePulse(usage, target, first) {
  const midi = usage.midiOptions ??= {};
  midi.resonancePulse = true;
  midi.targetUuids = [target.document.uuid];
  delete midi.targetsToUse;
  if (!first) {
    usage.consume = { spellSlot: false, resources: false };
    usage.consumeUsage = false;
    midi.isTriggered = true;
    midi.proceedChecks = { ...midi.proceedChecks, checkReaction: false, checkBonusAction: false };
  }
  midi.workflowOptions = {
    ...midi.workflowOptions, targetConfirmation: 'none', autoRollAttack: true, autoRollDamage: 'onHit',
    autoFastAttack: true, autoFastDamage: true, notBonusAction: !first
  };
  return usage;
}

export function prepareResonanceBeam(beam, first) {
  if (first) return beam;
  const prefix = `system.activities.${beam.id}`;
  return beam.item.clone({
    [`${prefix}.activation.override`]: true,
    [`${prefix}.activation.type`]: 'special'
  }, { keepId: true }).system.activities.get(beam.id);
}

async function allocatePulses(activity, usage, count) {
  const options = usage.midiOptions;
  const providedTargets = [...(options?.targetsToUse ?? []),
    ...(options?.targetUuids ?? []).map(uuid => fromUuidSync(uuid)?.object)];
  const targets = [...new Set(providedTargets.length ? providedTargets : game.user.targets)]
    .filter(target => target?.actor && !target.destroyed);
  if (!targets.length) {
    ui.notifications.warn('请先选择夺魂魔音的目标。');
    return;
  }
  const source = MidiQOL.tokenForActor(activity.actor);
  if (!resonanceTargetsInRange(activity, source, targets)) {
    ui.notifications.warn('有目标超出夺魂魔音的施法距离。');
    return;
  }
  if (targets.length === 1) return Array(count).fill(targets[0]);
  const response = await chrisPremades.utils.dialogUtils.selectTargetDialog(
    activity.item.name, `分配全部 ${count} 道音波，你可以对同一目标分配多道。`, targets,
    { type: 'selectAmount', maxAmount: count, skipDeadAndUnconscious: false }
  );
  if (!response) return;
  const [selection] = response;
  const assignments = (selection ?? []).flatMap(({ document, value }) => Array(Number(value)).fill(document));
  if (assignments.length !== count) {
    ui.notifications.warn(`请选择全部 ${count} 道音波的目标。`);
    return;
  }
  return assignments;
}

async function refreshResonanceCards() {
  if (game.user !== game.users.activeGM || !game.modules.get('mystic-weapon-pack')?.active) return;
  const template = await fromUuid(SPELL_UUID);
  if (template?.img !== SPELL_ICON) return;
  const description = template.system.description.value;
  const upgradeStart = description.indexOf('<p><strong><em>戏法增强。');
  if (upgradeStart < 0) return;
  // Rich text written into a world uses self-closing BR tags after server sanitization.
  const normalize = html => html.replace(/<br\s*\/?>/gi, '<br>');
  const legacyDescription = normalize(description.slice(0, upgradeStart));
  const syntheticActors = [...game.scenes].flatMap(scene => scene.tokens.filter(token => !token.actorLink).map(token => token.actor));
  const items = [...game.items, ...[...game.actors, ...syntheticActors].flatMap(actor => actor?.items.contents ?? [])];
  for (const item of items) {
    if (isResonanceSpell(item)) {
      const changes = {};
      if (item.img === BRACER_ICON) changes.img = SPELL_ICON;
      if (normalize(item.system.description.value) === legacyDescription) changes['system.description.value'] = description;
      if (Object.keys(changes).length) await item.update(changes);
    } else if (isBracer(item)) {
      const cast = item.system.activities.find(isBracerCast);
      if (cast?.img === BRACER_ICON) await item.update({ [`system.activities.${cast.id}.img`]: SPELL_ICON });
    }
  }
}

function playResonanceAnimation(workflow) {
  if (!isResonanceSpell(workflow.item) || !resonanceBeam(workflow.activity) || !workflow.token) return;
  const target = workflow.targets.first();
  if (!target || !globalThis.Sequencer?.Database?.entryExists(ELDRITCH_EFFECT)) return;
  globalThis.chrisPremades?.utils?.animationUtils?.simpleAttack(workflow.token, target, ELDRITCH_EFFECT,
    { sound: false, missed: !workflow.hitTargets.has(target) });
}

export async function useResonancePulses(attack, usage, dialog, message, count) {
  if (requireBracer(attack.item.system.linkedActivity) === false) return;
  const targets = await allocatePulses(attack, usage, count);
  if (!targets) return;
  let result;
  for (const [index, target] of targets.entries()) {
    if (target.destroyed || target.document.parent !== canvas.scene) break;
    const first = index === 0;
    const beam = prepareResonanceBeam(attack, first);
    const config = configureResonancePulse(first ? foundry.utils.deepClone(usage) : {}, target, first);
    result = await MidiQOL.completeActivityUse(beam, config, { ...dialog, configure: false }, message);
    if (!result || result.aborted) break;
  }
  return result;
}

export function registerResonantBracer(moduleId) {
  // The passive bonus survives unequipping. The spell still requires both conditions.
  libWrapper.register(moduleId, 'CONFIG.Item.documentClass.prototype.areEffectsSuppressed', function (wrapped) {
    return isBracer(this) ? !this.system.attuned : wrapped();
  }, 'MIXED');

  Hooks.on('dnd5e.preUseLinkedSpell', activity => {
    if (activity.spell.uuid === SPELL_UUID) return requireBracer(activity);
  });
  Hooks.on('dnd5e.preUseActivity', activity => {
    if (isResonanceSpell(activity.item)) return requireBracer(activity.item.system.linkedActivity);
  });

  Hooks.on('midi-qol.AttackRollComplete', playResonanceAnimation);
  refreshResonanceCards().catch(error => console.error(`[${moduleId}] 夺魂魔音模板更新失败`, error));
}
