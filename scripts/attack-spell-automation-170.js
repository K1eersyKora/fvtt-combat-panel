const CPR = 'chris-premades';
const PANEL = 'fvtt-combat-panel';
const TEMPLATE_FOLDER = '附伤与逐束法术';

const spells = {
  conjureMinorElementals: { identifier: 'conjureminorelementals', name: '咒唤微元素群', rules: '2024', level: 4 },
  spiritShroud: { identifier: 'spiritshroud', name: '魂灵环绕', rules: '2014', level: 3 },
  huntersMark: { identifier: 'huntersmark', name: '猎人印记', rules: '2024', level: 1 },
  hex: { identifier: 'hex', name: '脆弱诅咒', rules: '2024', level: 1 },
  eldritchBlast: { identifier: 'eldritchblast', name: '魔能爆', rules: '2024', level: 0 },
};

function identify(item) {
  if (item?.type !== 'spell') return null;
  const identifier = item.system.identifier?.toLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.entries(spells).find(([key, spec]) =>
    item.system.level === spec.level && (item.flags[CPR]?.info?.identifier === key ||
      identifier === spec.identifier || identifier === spec.identifier + 'tce' ||
      item.name === spec.name || item.name.startsWith(spec.name + ' ')))?.[0] ?? null;
}

function mainActivityId(data, key) {
  return data.flags[CPR]?.activityIdentifiers?.[key] ?? Object.keys(data.system.activities)[0];
}

async function automationTemplate(key, rules) {
  const pack = game.packs.get(`${CPR}.${rules === '2024' ? 'CPRSpells2024' : 'CPRSpells'}`);
  if (!pack) throw Error(`找不到 ${rules} 版 CPR 法术图鉴`);
  const index = await pack.getIndex({ fields: ['flags.chris-premades.info.identifier'] });
  const entry = index.find(row => row.type === 'spell' && row.flags?.[CPR]?.info?.identifier === key);
  const document = entry && await pack.getDocument(entry._id);
  if (!document?.flags[CPR]?.macros?.midi?.item?.includes(key)) throw Error(`找不到 ${key} 的 CPR 自动化`);
  return document.toObject();
}

function activeCast(item) {
  if (!item.actor) return false;
  return Boolean(globalThis.MidiQOL?.getConcentrationEffect(item.actor, item) ||
    item.actor.effects.some(effect => !effect.disabled && effect.origin === item.uuid));
}

function matchItem(item, key, template) {
  const source = item.toObject();
  const oldActivities = Object.values(source.system.activities);
  const current = source.flags[CPR];
  const currentMain = current?.activityIdentifiers?.[key] ?? oldActivities[0]?._id;
  const beamId = current?.activityIdentifiers?.eldritchBlastBeam;
  if (current?.info?.identifier === key && current.macros?.midi?.item?.includes(key) &&
      source.system.activities[currentMain]?.type === 'utility' &&
      (key !== 'eldritchBlast' || source.system.activities[beamId]?.type === 'attack')) return { reason: '已匹配' };
  if (activeCast(item)) return { reason: '该法术正在持续' };
  if (source.flags['midi-qol']?.onUseMacroName || current?.macros || current?.embeddedMacros ||
      source.flags.dae?.macro || Object.keys(source.flags['gambits-premades'] ?? {}).length ||
      source.effects.some(effect => effect.transfer)) return { reason: '已有自定义自动化' };

  const blast = key === 'eldritchBlast';
  const oldMain = oldActivities.find(activity => blast ? activity.type === 'attack' : activity.type === 'utility');
  if (!oldMain || oldActivities.some(activity => activity !== oldMain &&
    (blast || activity.type !== 'damage' || activity.consumption?.spellSlot !== false))) {
    return { reason: '活动结构需要人工核对' };
  }
  if (blast && oldMain.damage?.parts?.some(part => part.scaling?.mode)) {
    return { reason: '现有光束有自定义伤害成长' };
  }
  if (oldActivities.some(activity => activity.onUseMacroName ||
      activity.midiProperties?.triggeredActivityId && activity.midiProperties.triggeredActivityId !== 'none')) {
    return { reason: '已有活动宏或触发链' };
  }

  const cloned = foundry.utils.deepClone(template);
  const cpr = cloned.flags[CPR];
  const activities = cloned.system.activities;
  const templateMain = mainActivityId(cloned, key);
  const primary = activities[templateMain];
  if (primary?.type !== 'utility') throw Error(`${item.name} 的 CPR 施法活动不兼容`);
  if (oldMain._id !== templateMain && activities[oldMain._id]) return { reason: '活动 ID 冲突' };
  delete activities[templateMain];
  primary._id = oldMain._id;
  primary.name = oldMain.type === 'utility' && oldMain.name || '施展';
  if (oldMain.activation?.type) primary.activation = oldMain.activation;
  if (oldMain.consumption) primary.consumption = oldMain.consumption;
  if (oldMain.uses) primary.uses = oldMain.uses;
  activities[primary._id] = primary;
  if (cpr.activityIdentifiers?.[key]) cpr.activityIdentifiers[key] = primary._id;

  if (blast) {
    const beam = activities[cpr.activityIdentifiers.eldritchBlastBeam];
    beam.attack = oldMain.attack;
    beam.damage = oldMain.damage;
    beam.effects = oldMain.effects;
    if (oldMain.range?.override) beam.range = oldMain.range;
  }

  // A non-recursive update replaces the activity collection. Send the full source to preserve other system data.
  source.system.activities = { [primary._id]: primary, ...activities };
  source.system.target = cloned.system.target;
  source.system.properties = [...new Set([...(source.system.properties ?? []), ...(cloned.system.properties ?? [])])];
  source.flags[CPR] = { ...current, ...cpr, config: current?.config ?? cpr.config ?? {} };
  source.flags.dnd5e ??= {};
  source.flags.dnd5e.riders ??= {};
  source.flags.dnd5e.riders.activity = (cloned.flags.dnd5e?.riders?.activity ?? [])
    .map(id => id === templateMain ? primary._id : id);
  const remove = key === 'spiritShroud' ? source.effects.filter(effect =>
    effect.changes.some(change => /flags\.midi-qol\.optional\..*(spiritshroud|魂灵环绕)/i.test(change.key)))
    .map(effect => effect._id) : [];
  return { source, remove };
}

/** Match selected spell documents in place. With apply:false this only inspects and reports. */
export async function matchAttackSpells({ items = [], createTemplates = false, apply = false, includeBackup = false } = {}) {
  if (!game.user.isGM) throw Error('仅主持人可以匹配法术自动化');
  if (!game.modules.get(CPR)?.active || !game.modules.get('midi-qol')?.active) throw Error('需要启用 CPR 和 Midi-QOL');
  const templates = new Map();
  const load = async (key, rules) => {
    const id = `${key}:${rules}`;
    if (!templates.has(id)) templates.set(id, await automationTemplate(key, rules));
    return templates.get(id);
  };
  const changes = [];
  const skipped = [];
  const backups = [];
  for (const item of new Set(items)) {
    const key = identify(item);
    if (!key || item.pack) continue;
    const rules = item.system.source?.rules ?? spells[key].rules;
    if ((key === 'conjureMinorElementals' && rules !== '2024') ||
        (key === 'spiritShroud' && rules !== '2014')) {
      skipped.push({ uuid: item.uuid, name: item.name, reason: '规则版本不同' });
      continue;
    }
    const template = await load(key, rules);
    const result = matchItem(item, key, template);
    const { source, remove, reason } = result;
    if (reason) {
      skipped.push({ uuid: item.uuid, name: item.name, reason });
      continue;
    }
    if (includeBackup) backups.push({ uuid: item.uuid, data: item.toObject() });
    if (apply) {
      await item.update(source, { diff: false, recursive: false });
      if (remove.length) await item.deleteEmbeddedDocuments('ActiveEffect', remove);
    }
    changes.push({ uuid: item.uuid, name: item.name, key, rules });
  }

  if (createTemplates) {
    let folder = game.folders.find(entry => entry.type === 'Item' && entry.name === TEMPLATE_FOLDER);
    for (const [key, spec] of Object.entries(spells)) {
      if (game.items.some(item => item.flags[PANEL]?.attackSpellTemplate === key)) continue;
      const data = foundry.utils.deepClone(await load(key, spec.rules));
      const name = `${spec.name} ${data.name}`;
      if (apply) {
        folder ??= await Folder.create({ name: TEMPLATE_FOLDER, type: 'Item' });
        delete data._id;
        const doc = await Item.create({
          ...data, name, folder: folder.id,
          flags: { ...data.flags, [PANEL]: { ...data.flags[PANEL], attackSpellTemplate: key } },
        });
        changes.push({ uuid: doc.uuid, name, key, rules: spec.rules });
      } else changes.push({ name, key, rules: spec.rules });
    }
  }
  return { changes, skipped, ...(includeBackup ? { backups } : {}) };
}
