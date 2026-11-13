const PANEL = 'fvtt-combat-panel';
const CPR = 'chris-premades';
const REVISION = 1;
const FOLDER = '圣武士与光明牧师自动化';
const list = value => Array.from(value?.contents ?? value ?? []);
const clone = value => foundry.utils.deepClone(value);
const normalized = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const specs = {
  sacredWeapon: { identifier: 'sacredweapon', name: '圣洁武器', pack: 'dnd5e.classes24' },
  guidance: { identifier: 'guidance', name: '神导术', pack: 'dnd5e.spells24' },
  protectionFromEvilAndGood: { identifier: 'protectionfromevilandgood', name: '防护善恶', pack: `${CPR}.CPRSpells2024` },
  heroism: { identifier: 'heroism', name: '英雄气概', pack: `${CPR}.CPRSpells2024` },
  wardingFlare: { identifier: 'wardingflare', name: '守御之光', pack: `${CPR}.CPRClassFeatures2024` },
  viciousMockery: { identifier: 'viciousmockery', name: '恶言相加', pack: 'dnd5e.spells24' },
  breathWeapon: { identifier: 'breathweapon', name: '吐息武器', pack: 'dnd5e.origins24' },
  layOnHands: { identifier: 'layonhands', name: '圣疗', pack: 'dnd5e.classes24' },
  divineSmite: { identifier: 'divinesmite', name: '至圣斩', pack: `${CPR}.CPRSpells2024` },
  radianceOfTheDawn: { identifier: 'radianceofthedawn', name: '黎明曙光', pack: `${CPR}.CPRClassFeatures2024` },
  gustOfWind: { identifier: 'gustofwind', name: '造风术', pack: `${CPR}.CPRSpells2024` },
  wordOfRadiance: { identifier: 'wordofradiance', name: '光耀祷词', pack: 'dnd-players-handbook.spells' }
};

export function identifyAbility(item) {
  const values = [item.system?.identifier, item.flags?.[CPR]?.info?.identifier].map(normalized);
  const named = Object.entries(specs).find(([key, spec]) => values.includes(normalized(key)) ||
    values.includes(spec.identifier) || item.name === spec.name || item.name?.startsWith(spec.name + ' '));
  if (named) return named[0];
  const breath = values.some(value => /breath/.test(value) && !/holdbreath|dragonsbreath/.test(value));
  return breath && list(item.system?.activities).some(activity => activity.target?.template?.type) ? 'breathWeapon' : null;
}

const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const same = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
const activityValues = source => Object.values(source.system.activities ?? {});

function targetCreature(activity, { self = false, touch = false } = {}) {
  activity.target = {
    override: true, prompt: false,
    template: { contiguous: false, units: 'ft', type: '' },
    affects: { count: self ? '' : '1', type: self ? 'self' : 'creature', choice: false, special: '' }
  };
  if (touch) activity.range = { override: true, units: 'touch', special: '' };
}

function excludeOrigin(activity) {
  const template = activity.target?.template;
  if (!template?.type) return;
  const special = String(activity.target.affects?.special ?? '').split(';').filter(Boolean);
  activity.target.affects ??= {};
  activity.target.affects.special = [...new Set([...special.filter(value => value !== 'self'), '-self'])].join(';');
  activity.midiProperties ??= {};
  if (activity.type === 'save' || activity.type === 'damage') activity.otherActivityId = 'none';
}

function makeEffect(source, name, changes, seconds) {
  const previous = source.effects.find(effect => effect.flags?.[PANEL]?.ability || effect.name === name) ?? source.effects[0];
  return {
    _id: previous?._id ?? foundry.utils.randomID(), type: 'base', name, img: source.img,
    transfer: false, disabled: false, changes,
    duration: { seconds },
    flags: { dae: { stackable: 'noneNameOnly' } }
  };
}

function patchSacredWeapon(source) {
  const activity = activityValues(source).find(activity => ['enchant', 'utility'].includes(activity.type));
  if (!activity) throw Error('圣洁武器缺少附魔或施展活动');
  activity.type = 'utility';
  activity.name = '圣洁武器';
  targetCreature(activity, { self: true });
  activity.range = { override: true, units: 'self', special: '' };
  activity.duration = { value: '10', units: 'minute', concentration: false, override: true };
  activity.otherActivityId = 'none';
  delete activity.restrictions;
  const effect = makeEffect(source, '圣洁武器', [], 600);
  effect.flags[PANEL] = { ability: 'sacredWeapon' };
  source.effects = [effect];
  activity.effects = [{ _id: effect._id }];
  source.system.description ??= {};
  source.system.description.value = '<p>消耗一次引导神力，持续10分钟。你使用武器进行的所有攻击检定获得魅力调整值加值，最低为+1。</p>';
}

function patchGuidance(source) {
  const primary = activityValues(source).find(activity => activity.target?.affects?.type !== 'self') ?? activityValues(source)[0];
  if (!primary) throw Error('神导术缺少施展活动');
  primary.type = 'utility';
  primary.otherActivityId = 'none';
  targetCreature(primary, { touch: true });
  const effect = makeEffect(source, '神导术 Guidance', [
    { key: 'system.bonuses.abilities.check', mode: 2, value: '1d4', priority: 20 }
  ], 60);
  source.effects = [effect];
  primary.effects = [{ _id: effect._id }];
  primary.midiProperties = { ...primary.midiProperties, chooseEffects: false };
  source.system.activities = { [primary._id]: primary };
  delete source.flags[CPR];
  if (source.flags.dnd5e?.riders) {
    source.flags.dnd5e.riders.activity = [];
    source.flags.dnd5e.riders.effect = [];
  }
  source.system.description ??= {};
  source.system.description.value = '<p>你触碰一名自愿生物。在专注持续的1分钟内，受术者的全部属性和技能检定获得1d4加值。只应用一个神导术效果。</p>';
}

function copyCprPrimary(source, template) {
  const oldMain = activityValues(source).find(activity => activity.type !== 'forward');
  const templateMain = activityValues(template).find(activity => !activity.midiProperties?.automationOnly);
  if (!oldMain || !templateMain) throw Error('缺少主要活动');
  const primary = clone(templateMain);
  primary._id = oldMain._id;
  primary.name = oldMain.name;
  if (oldMain.activation?.type) primary.activation = oldMain.activation;
  if (oldMain.consumption) primary.consumption = oldMain.consumption;
  if (oldMain.uses) primary.uses = oldMain.uses;
  source.system.activities[primary._id] = primary;
  source.flags[CPR] = { ...source.flags[CPR], ...clone(template.flags[CPR]) };
  const identifiers = source.flags[CPR].activityIdentifiers ?? {};
  for (const key of Object.keys(identifiers)) if (identifiers[key] === templateMain._id) identifiers[key] = primary._id;
  source.effects = clone(template.effects);
  return primary;
}

function patchMockery(source) {
  const primary = activityValues(source).find(activity => activity.type === 'save');
  if (!primary) throw Error('恶言相加缺少豁免活动');
  const effect = makeEffect(source, '嘲弄', [
    { key: 'flags.midi-qol.disadvantage.attack.all', mode: 5, value: '1', priority: 20 }
  ], null);
  effect.duration = { rounds: 1 };
  effect.flags.dae.specialDuration = ['1Attack', 'turnEnd'];
  source.effects = [effect];
  primary.effects = [{ _id: effect._id, onSave: false }];
  primary.otherActivityId = 'none';
}

async function loadTemplate(key) {
  const spec = specs[key];
  const pack = game.packs.get(spec.pack);
  if (!pack && key === 'wordOfRadiance') {
    const spellPack = game.packs.get('dnd5e.spells24');
    const index = await spellPack?.getIndex({ fields: ['system.identifier'] });
    const entry = index?.find(row => normalized(row.system?.identifier) === 'sacredflame');
    if (!entry) throw Error('找不到光耀祷词模板所需的塑能戏法图鉴');
    const raw = (await spellPack.getDocument(entry._id)).toObject();
    raw.name = 'Word of Radiance';
    if (raw._stats) {
      delete raw._stats.compendiumSource;
      delete raw._stats.duplicateSource;
    }
    if (raw.flags?.core) delete raw.flags.core.sourceId;
    if (raw.flags?.dnd5e) delete raw.flags.dnd5e.sourceId;
    raw.system.identifier = 'word-of-radiance';
    raw.system.description.value = '<p>你释放神圣光辉。以自身为原点的5尺光环内，你选择的生物进行体质豁免，失败受到1d6光耀伤害。伤害随戏法等级成长。</p>';
    raw.system.range = { units: 'self', special: '' };
    raw.system.properties = ['vocal', 'material'];
    const activity = activityValues(raw)[0];
    activity.range = { override: true, units: 'self' };
    activity.target = { override: true, prompt: true,
      template: { type: 'radius', size: '5', units: 'ft', contiguous: false },
      affects: { type: 'creature', count: '', choice: true, special: '-self' } };
    activity.save.ability = ['con'];
    activity.damage.parts[0].denomination = 6;
    return raw;
  }
  if (!pack) throw Error(`找不到 ${spec.name} 的图鉴 ${spec.pack}`);
  const index = await pack.getIndex({ fields: ['system.identifier', 'flags.chris-premades.info.identifier'] });
  const entry = index.find(row => identifyAbility(row) === key);
  if (!entry) throw Error(`图鉴里找不到 ${spec.name}`);
  return (await pack.getDocument(entry._id)).toObject();
}

function patchItem(item, key, template) {
  const source = item.toObject();
  source.flags ??= {};
  source.effects ??= [];
  if (key === 'sacredWeapon') patchSacredWeapon(source);
  if (key === 'guidance') patchGuidance(source);
  if (key === 'heroism') {
    const primary = source.flags[CPR]?.macros?.midi?.item?.includes('heroism')
      ? activityValues(source).find(activity => activity.type === 'utility') : copyCprPrimary(source, template);
    if (!primary) throw Error('英雄气概缺少施展活动');
    targetCreature(primary, { touch: true });
  }
  if (key === 'wardingFlare') {
    const primary = copyCprPrimary(source, template);
    primary.range = { override: true, value: 30, units: 'ft', special: '' };
    targetCreature(primary);
    primary.activation.condition = '当30尺内的队友受到你可见的生物攻击时';
    primary.otherActivityId = 'none';
    source.flags[CPR].macros.midi.actor = list(source.flags[CPR].macros.midi.actor).filter(name => name !== 'wardingFlare');
    source.system.description ??= {};
    source.system.description.value = '<p>当你30尺内的队友受到你可见的生物攻击时，你可以使用反应并消耗一次守御之光，使该次攻击检定具有劣势。距离以受到攻击的队友为准。</p>';
  }
  if (key === 'protectionFromEvilAndGood') {
    const primary = activityValues(source).find(activity => activity.type === 'utility');
    if (!primary) throw Error('防护善恶缺少施展活动');
    targetCreature(primary, { touch: true });
  }
  if (key === 'viciousMockery') patchMockery(source);
  if (key === 'breathWeapon') {
    for (const activity of activityValues(source)) excludeOrigin(activity);
  }
  if (['radianceOfTheDawn', 'wordOfRadiance', 'gustOfWind'].includes(key)) {
    for (const activity of activityValues(source)) {
      if (activity.range?.units === 'self' || activity.type === 'save') excludeOrigin(activity);
    }
  }
  if (key === 'divineSmite' && source.flags[CPR]?.macros?.midi?.actor) {
    source.flags[CPR].macros.midi.actor = list(source.flags[CPR].macros.midi.actor).filter(name => name !== 'divineSmite');
  }
  source.flags[PANEL] = {
    ...source.flags[PANEL], abilityAutomation: { key, revision: REVISION }
  };
  return source;
}

function isMatched(item, key) {
  if (item.flags?.[PANEL]?.abilityAutomation?.revision !== REVISION || item.flags[PANEL].abilityAutomation.key !== key) return false;
  const raw = item.toObject(), activities = activityValues(raw);
  const primary = activities.find(activity => activity.type !== 'forward');
  const creature = activity => activity?.target?.affects?.type === 'creature' && Number(activity.target.affects.count) === 1;
  if (key === 'guidance') return raw.effects.length === 1 && activities.length === 1 && creature(primary) &&
    primary.range?.units === 'touch' && primary.effects?.length === 1 && !raw.flags[CPR] &&
    raw.effects[0].changes.some(change => change.key === 'system.bonuses.abilities.check' && change.value === '1d4');
  if (key === 'sacredWeapon') return primary?.type === 'utility' && primary.target?.affects?.type === 'self' &&
    raw.effects.length === 1 && raw.effects[0].flags?.[PANEL]?.ability === 'sacredWeapon' && raw.effects[0].duration?.seconds === 600 &&
    raw.effects[0].type === 'base' && raw.effects[0].disabled === false && raw.effects[0].transfer === false &&
    raw.effects[0].changes.length === 0 && primary.effects?.some(reference => reference._id === raw.effects[0]._id);
  if (key === 'heroism') return primary?.type === 'utility' && creature(primary) && primary.range?.units === 'touch' &&
    raw.flags[CPR]?.macros?.midi?.item?.includes('heroism');
  if (key === 'protectionFromEvilAndGood') return creature(primary) && primary.range?.units === 'touch';
  if (key === 'wardingFlare') return creature(primary) && Number(primary.range?.value) === 30 && primary.range?.units === 'ft' &&
    raw.flags[CPR]?.macros?.midi?.item?.includes('wardingFlare') && !raw.flags[CPR]?.macros?.midi?.actor?.includes('wardingFlare');
  if (key === 'viciousMockery') return raw.effects.length === 1 && raw.effects[0].changes.some(change =>
    change.key === 'flags.midi-qol.disadvantage.attack.all' && String(change.value) === '1') &&
    ['1Attack', 'turnEnd'].every(duration => raw.effects[0].flags?.dae?.specialDuration?.includes(duration));
  if (key === 'divineSmite') return !raw.flags[CPR]?.macros?.midi?.actor?.includes('divineSmite');
  if (['breathWeapon', 'radianceOfTheDawn', 'wordOfRadiance', 'gustOfWind'].includes(key)) return activities.every(activity => {
    if (!activity.target?.template?.type || (key !== 'breathWeapon' && activity.range?.units !== 'self' && activity.type !== 'save')) return true;
    return String(activity.target.affects?.special ?? '').split(';').includes('-self') &&
      (!['save', 'damage'].includes(activity.type) || activity.otherActivityId === 'none');
  });
  return key === 'layOnHands';
}

/** Inspect or apply repairs in place. The backup callback completes before any write. */
export async function matchAbilityAutomation({
  items = [], actors = [], selected = false, allCharacters = false,
  createTemplates = false, apply = false, includeBackup = true, backup
} = {}) {
  if (!game.user.isGM) throw Error('仅主持人可以匹配特性自动化');
  const chosen = new Set(actors);
  if (selected) for (const token of canvas.tokens.controlled) if (token.actor) chosen.add(token.actor);
  if (allCharacters) for (const actor of game.actors) if (actor.type === 'character') chosen.add(actor);
  const documents = new Set([...items, ...[...chosen].flatMap(actor => list(actor.items))]);
  const templates = new Map();
  const template = async key => {
    if (!templates.has(key)) templates.set(key, await loadTemplate(key));
    return templates.get(key);
  };
  const changes = [], skipped = [], backups = [], pending = [];
  for (const item of documents) {
    const key = identifyAbility(item);
    if (!key || item.pack) continue;
    try {
      if (isMatched(item, key)) {
        skipped.push({ uuid: item.uuid, name: item.name, key, reason: '已匹配' });
        continue;
      }
      const flags = item.flags ?? {};
      const daeMacro = flags.dae?.macro;
      const daeCommand = typeof daeMacro === 'string' ? daeMacro.trim() : String(daeMacro?.command ?? '').trim();
      const knownCpr = normalized(flags[CPR]?.info?.identifier) === normalized(key);
      const replacesAutomation = ['sacredWeapon', 'guidance', 'viciousMockery', 'wardingFlare'].includes(key) || (key === 'heroism' && !knownCpr);
      if (replacesAutomation && !knownCpr && (flags['midi-qol']?.onUseMacroName || daeCommand ||
          flags[CPR]?.embeddedMacros || Object.keys(flags['gambits-premades'] ?? {}).length)) {
        skipped.push({ uuid: item.uuid, name: item.name, key, reason: '已有独立物品宏，需保留并核对' });
        continue;
      }
      const source = patchItem(item, key, ['heroism', 'wardingFlare'].includes(key) ? await template(key) : null);
      if (same(item.toObject(), source)) {
        skipped.push({ uuid: item.uuid, name: item.name, key, reason: '已匹配' });
        continue;
      }
      backups.push({ uuid: item.uuid, data: item.toObject() });
      pending.push({ item, source });
      changes.push({ uuid: item.uuid, name: item.name, key });
    } catch (error) {
      skipped.push({ uuid: item.uuid, name: item.name, key, reason: error.message });
    }
  }
  if (apply && pending.length) {
    if (backup) await backup(clone(backups));
    else saveDataToFile(JSON.stringify(backups, null, 2), 'application/json', `ability-automation-backup-${Date.now()}.json`);
  }
  if (apply) for (const { item, source } of pending) await item.update(source, { diff: false, recursive: false });
  if (createTemplates) {
    let folder = game.folders.find(entry => entry.type === 'Item' && entry.name === FOLDER);
    for (const [key, spec] of Object.entries(specs)) {
      if (game.items.some(item => item.flags[PANEL]?.abilityTemplate === key)) continue;
      try {
        const raw = clone(await template(key));
        const item = new CONFIG.Item.documentClass(raw);
        const data = patchItem(item, key, ['heroism', 'wardingFlare'].includes(key) ? raw : null);
        const name = `${spec.name} ${raw.name}`;
        if (apply) {
          folder ??= await Folder.create({ name: FOLDER, type: 'Item' });
          delete data._id;
          data.flags[PANEL].abilityTemplate = key;
          const document = await Item.create({ ...data, name, folder: folder.id });
          changes.push({ uuid: document.uuid, name, key, template: true });
        } else changes.push({ name, key, template: true });
      } catch (error) { skipped.push({ name: spec.name, key, reason: error.message }); }
    }
  }
  return { changes, skipped, ...(includeBackup ? { backups } : {}) };
}

export function sacredWeaponAttackBonus(config) {
  const activity = config.subject;
  const actor = activity?.actor;
  if (activity?.attack?.type?.classification !== 'weapon') return;
  const active = list(actor?.appliedEffects).some(effect => !effect.disabled && !effect.isSuppressed && effect.flags?.[PANEL]?.ability === 'sacredWeapon');
  if (!active || config[PANEL]?.sacredWeapon) return;
  const roll = config.rolls?.[0];
  if (!roll) return;
  const bonus = Math.max(1, Number(actor.system.abilities.cha.mod) || 0);
  roll.parts ??= [];
  roll.parts.push(String(bonus));
  config[PANEL] = { ...config[PANEL], sacredWeapon: bonus };
}

/** The house rule measures thirty feet from the ally being attacked. */
export async function handleWardingFlare(workflow) {
  if (!workflow?.token || workflow[PANEL]?.wardingFlareHandled || !workflow.targets?.size) return;
  const utils = globalThis.chrisPremades?.utils;
  if (!utils?.workflowUtils.isAttackType(workflow, 'attack')) return;
  workflow[PANEL] = { ...workflow[PANEL], wardingFlareHandled: true };
  for (const defender of workflow.targets) {
    for (const token of workflow.token.scene.tokens) {
      if (!token.actor || token.disposition !== defender.document.disposition) continue;
      const item = token.actor.items.find(item => item.flags?.[PANEL]?.abilityAutomation?.key === 'wardingFlare');
      if (!item || utils.actorUtils.hasUsedReaction(token.actor)) continue;
      const clericToken = token.object ?? token;
      if (utils.tokenUtils.getDistance(defender, clericToken) > 30 || !utils.tokenUtils.canSee(clericToken, workflow.token)) continue;
      const activity = list(item.system.activities).find(activity => activity.type === 'utility');
      if (!activity || !utils.activityUtils.canUse(activity)) continue;
      const owner = utils.socketUtils.firstOwner(token.actor, true);
      let accepted;
      try {
        accepted = await utils.dialogUtils.confirm(item.name, `${defender.name} 正受到攻击，使用反应施加攻击劣势？`, { userId: owner });
      } catch (error) {
        console.warn(`[${PANEL}] 守御之光的反应确认已结束`, error);
        continue;
      }
      if (!accepted || workflow.aborted || utils.actorUtils.hasUsedReaction(token.actor) || !utils.activityUtils.canUse(activity) ||
          utils.tokenUtils.getDistance(defender, clericToken) > 30 || !utils.tokenUtils.canSee(clericToken, workflow.token)) continue;
      await utils.workflowUtils.syntheticActivityRoll(activity, [defender], { consumeResources: true, consumeUsage: true });
      return;
    }
  }
}

/** CPR's recurring gust save can explicitly pass the origin token as its target. */
export function excludeGustOrigin(workflow) {
  if (workflow?.item?.flags?.[PANEL]?.abilityAutomation?.key !== 'gustOfWind' || workflow.activity?.type !== 'save') return;
  for (const token of [...(workflow.targets ?? [])]) {
    if (token.actor?.uuid !== workflow.actor?.uuid) continue;
    for (const key of ['targets', 'hitTargets', 'failedSaves', 'saves']) workflow[key]?.delete(token);
    if (game.user.targets.has(token)) token.setTarget(false, { user: game.user, releaseOthers: false });
  }
}

export function registerAbilityAutomation() {
  if (globalThis.__dshAbilityAutomation173) return;
  globalThis.__dshAbilityAutomation173 = true;
  Hooks.on('dnd5e.preRollAttack', sacredWeaponAttackBonus);
  Hooks.on('midi-qol.postPreambleComplete', handleWardingFlare);
  Hooks.on('midi-qol.prePreambleComplete', excludeGustOrigin);
  Hooks.on('preCreateItem', applyGuidanceHouseRuleOnImport);
}

/** New character copies inherit the house rule before their first persistence. */
export function applyGuidanceHouseRuleOnImport(item) {
  if (item.parent?.type !== 'character' || item.type !== 'spell' || identifyAbility(item) !== 'guidance') return;
  if (isMatched(item, 'guidance')) return;
  item.updateSource(patchItem(item, 'guidance', null), { recursive: false });
}
