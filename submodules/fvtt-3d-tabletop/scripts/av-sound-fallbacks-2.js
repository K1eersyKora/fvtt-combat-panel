// These original AutoRec paths returned 404 when read directly from the
// comparison server. Keep the configured phase, delay, volume and repeat count.
const REPLACEMENTS = new Map(Object.entries({
  'Damage/Fire/fire-lasting-1.mp3': 'cantrips/create-bonfire/v1/create-bonfire-002.ogg',
  'Damage/Acid/acid-impact-goo-1.mp3': 'casting/water/cast-water-03.ogg',
  'Damage/Radiant/radiant-build-up-1.mp3': 'cantrips/sacred-flame/v1/sacred-flame-target-01.ogg',
  'Damage/Poison/poison-strike-1.mp3': 'impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-01.ogg',
  'Damage/Thunder/thunder-short-2.mp3': 'cantrips/thunderclap/v1/thunderclap-001.ogg',
  'Spells/Buff/spell-buff-build-up-2.mp3': 'casting/generic/001/cast-generic-05.ogg',
  'Spells/Buff/spell-buff-continuous-1.mp3': '1st-level-spells/bless/v1/bless-v1-001.ogg',
  'Spells/Buff/spell-buff-long-6.mp3': 'conditions/boon/boon-005-01.ogg',
  'Spells/Buff/spell-buff-long-7.mp3': 'conditions/boon/boon-003-01.ogg',
  'Spells/Buff/spell-buff-prayer-1.mp3': '1st-level-spells/bless/v1/bless-v1-003.ogg',
  'Spells/Buff/spell-buff-short-1.mp3': '1st-level-spells/cure-wounds/v1/cure-wounds-00.ogg',
  'Spells/Buff/spell-buff-short-3.mp3': '1st-level-spells/bless/v1/bless-v1-002.ogg',
  'Spells/Buff/spell-buff-short-6.mp3': 'cantrips/sacred-flame/v1/sacred-flame-target-01.ogg',
  'Spells/Buff/spell-lively-2.mp3': 'conditions/boon/boon-002-01.ogg',
  'Spells/Debuff/spell-decrescendo-short-4.mp3': 'impacts/magicaleffects/fire/meleeattack-impacts-magicaleffects-fire-00.ogg',
  'Spells/Debuff/spell-whispers-1.mp3': 'cantrips/toll-the-dead/v1/rasping-whispers-001.ogg',
  'Spells/Debuff/spell-whispers-4.mp3': 'cantrips/toll-the-dead/v1/rasping-whispers-001.ogg',
  'Spells/Debuff/spell-whispers-5.mp3': 'cantrips/toll-the-dead/v1/rasping-whispers-001.ogg',
  'Spells/Debuff/spell-whispers-8.mp3': 'conditions/boon/boon-002-01.ogg',
  'Spells/Debuff/spell-whispers-9.mp3': 'cantrips/toll-the-dead/v1/rasping-whispers-001.ogg',
  'Spells/Hum/spell-hum-1.mp3': 'conditions/generic-layers/generic-layer-002.ogg',
  'Spells/Ray/spell-ray-4.mp3': '2nd-level-spells/scorching-ray/v1/scorching-ray-001-05ft.ogg',
  'Weapons/Melee_Miss/melee-miss-2.mp3': 'weapon-swooshes/light/v1/group02/meleeattack-swoosh-light-group02-00.ogg',
  'Weapons/Thrown/throw-launch-2.mp3': 'weapon-swooshes/light/v1/group03/meleeattack-swoosh-light-group03-00.ogg'
}));

const GLOBS_WITHOUT_FILES = new Map(Object.entries({
  'Spells/Buff/spell-buff-short-*': '1st-level-spells/cure-wounds/v1/cure-wounds-00.ogg',
  'Spells/Disappear/spell-teleport-short-*': '2nd-level-spells/misty-step/v1/complete/misty-step-complete-generic-001.ogg',
  'Spells/Whoosh/*': 'casting/generic/001/cast-generic-03.ogg'
}));

export function restoreMissingSounds(mapping) {
  if (!game.modules.get('psfx')?.active) return;
  const prefix = 'modules/dnd5e-animations/assets/sounds/';
  function visit(data) {
    if (!data || typeof data !== 'object' || data.enable === false) return;
    if (data.enable === true && typeof data.file === 'string' && data.file.startsWith(prefix)) {
      const original = data.file.slice(prefix.length);
      const replacement = REPLACEMENTS.get(original) ?? GLOBS_WITHOUT_FILES.get(original);
      if (replacement) data.file = 'modules/psfx/library/' + replacement;
    }
    for (const value of Object.values(data)) visit(value);
  }
  visit(mapping);
}

