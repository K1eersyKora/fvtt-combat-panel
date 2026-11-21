import {ID} from './scene-view-1.js';

const handled = new WeakSet();
const presetId = '2fe01a29-e598-4ca9-bbe4-ce7cf13b0494';
const pulse = 'autoanimations.static.lightning.staticelectricity.01.darkpurple';
const originalSound = 'modules/dnd5e-animations/assets/sounds/Damage/Lightning/electric-continuous-1.mp3';
const discharge = 'modules/psfx/library/cantrips/shocking-grasp/v1/shocking-grasp-003.ogg';

function configuredSequence(item) {
  if (item?.type !== 'spell' || item.system?.identifier !== 'witch-bolt' || item.system.source?.rules !== '2024'
    || !game.modules.get('autoanimations')?.active || !game.modules.get('sequencer')?.active) return null;
  const flags = item.flags?.autoanimations;
  if (flags?.isCustomized || flags?.killAnim || flags?.isEnabled === false) return null;
  const preset = game.settings.get('autoanimations', 'aaAutorec-preset')
    .find(entry => entry.id === presetId && entry.presetType === 'dualattach');
  const data = preset?.data;
  if (!data?.video) return null;
  const video = data.video;
  const path = video.enableCustom && video.customPath ? video.customPath :
    ['autoanimations', video.dbSection, video.menuType, video.animation, video.variant, video.color].join('.');
  return Sequencer.Database.entryExists(path) ? {path, ...data} : null;
}

function concentrationFor(item, actor) {
  return Array.from(actor?.concentration?.effects ?? [])
    .find(effect => effect.getFlag('dnd5e', 'item')?.id === item.id || effect.origin === item.uuid);
}

function kind(activity) {
  if (activity?.description?.chatFlavor?.includes('[noaa]')) return null;
  if (activity?.type === 'attack') return 'link';
  return activity?.type === 'damage' && activity.activation?.type === 'bonus' ? 'pulse' : null;
}

function appendSound(sequence, sound) {
  if (!sound?.enable || !sound.file) return;
  const file = sound.file === originalSound && game.modules.get('psfx')?.active ? discharge : sound.file;
  sequence.sound().file(file).volume(sound.volume ?? 0.75).delay(sound.delay ?? 0)
    .startTime(sound.startTime ?? 0).repeats(sound.repeat ?? 1, sound.repeatDelay ?? 250);
}

export function usesWitchBoltSequence(workflow) {
  return !!(kind(workflow.activity) && configuredSequence(workflow.item));
}

export function installWitchBolt(compatibleScene) {
  Hooks.on('AutomatedAnimations-WorkflowStart', input => {
    if (!compatibleScene() || !(input.rollAttackHook || input.rollDamageHook)) return;
    if (configuredSequence(input.item)) input.stopWorkflow = true;
  });

  Hooks.on('midi-qol.RollComplete', workflow => {
    if (!compatibleScene() || workflow.aborted || handled.has(workflow)
      || (workflow.userId && workflow.userId !== game.user.id)) return;
    const item = workflow.item;
    const data = configuredSequence(item);
    const phase = kind(workflow.activity);
    const source = workflow.token;
    const target = (workflow.hitTargets?.size && Array.from(workflow.hitTargets)[0]) || Array.from(workflow.targets ?? [])[0];
    if (!data || !phase || !source || !target || (phase === 'link' && !workflow.attackRoll)
      || (phase === 'pulse' && !(workflow.damageRoll ?? workflow.damageRolls?.[0]))) return;
    handled.add(workflow);

    const actor = workflow.actor ?? source.actor;
    const concentration = concentrationFor(item, actor);
    const sequence = new Sequence({moduleName:'Automated Animations'});
    appendSound(sequence, data.sound);
    if (phase === 'link') {
      const effect = sequence.effect().file(data.path).attachTo(source, {bindVisibility:true})
        .stretchTo(target, {attachTo:true}).opacity(data.options?.opacity ?? 1)
        .playbackRate(data.options?.playbackRate ?? 1).origin(item.uuid).name('Witch Bolt');
      if (concentration) effect.tieToDocuments(concentration).persist(true);
    } else if (Sequencer.Database.entryExists(pulse)) {
      sequence.effect().file(pulse).atLocation(target).scaleToObject(1.25).origin(item.uuid).name('Witch Bolt: Pulse');
    }
    void sequence.play().catch(error => console.error(ID + ' Witch Bolt animation', error));
  });
}
