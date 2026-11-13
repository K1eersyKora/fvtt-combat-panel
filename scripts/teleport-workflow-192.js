// Inspect the automation that will actually run. Placement and movement stay with
// CPR, ItemMacro, Midi and Automated Animations; the HUD only skips its token aim.
const list = value => Array.from(value?.contents ?? value ?? []);
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
  return text(macro?.command ?? macro?.data?.command ?? item?.flags?.itemacro?.command);
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
  // CPR's distributed macros are minified: ({workflow:e}) and F.target(...).
  // Normalize the destructured workflow alias without executing the macro.
  const alias = command.match(/\bworkflow\s*:\s*([\w$]+)/)?.[1];
  return alias ? command.replace(new RegExp(`(^|[^\\w$])${escapeRegex(alias)}(?=\\s*\\.)`, 'g'), '$1workflow') : command;
}

function selfPlacement(raw) {
  const command = workflowSource(raw);
  // Inspect the first argument as well as the controlling token: Vortex Warp and
  // Hidden Paths also pass workflow.token as controller, but teleport a target.
  if (/\.target\(\s*\[?\s*workflow\.token\s*\]?\s*,\s*workflow\.token\s*,/.test(command)) return true;
  const groups = [...command.matchAll(/(?<![\w$])([\w$]+)\s*=\s*\[\s*workflow\.token\s*\]/g)];
  if (groups.some(([, name]) => new RegExp(`\\.group\\(\\s*${escapeRegex(name)}\\s*,\\s*workflow\\.token\\s*,`).test(command))) return true;
  // Standalone ItemMacros often use Sequencer/Warpgate instead of CPR.
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
    // Mirror AA 6's precedence, including non-teleport entries that shadow a
    // shorter teleport label. Never match a disabled/excluded entry by name only.
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

export function teleportWorkflow(activity, seen = new Set()) {
  if (!activity?.item || seen.has(activity)) return null;
  seen.add(activity);
  if (activity.type === 'forward') {
    const linked = activity.item.system?.activities?.get(activity.activity?.id);
    return linked ? teleportWorkflow(linked, seen) : null;
  }
  const target = activity.target ?? {}, shape = target.template?.type;
  const ownArea = ['emanationNoTemplate','emanation','radius','squareRadius'].includes(shape)
    || (activity.range?.units === 'self' && !!shape);
  // Attack-then-teleport abilities (Steel Wind Strike, etc.) still need enemies.
  if (activity.type === 'attack' || (['save','damage'].includes(activity.type) && !ownArea)) return null;
  if (shape && !ownArea) return null;
  const entries = [...cprEntries(activity), ...midiEntries(activity)];
  const self = entries.find(entry => selfPlacement(entry.command));
  if (self) return {direct:true, source:self.source, ownArea};
  // A targeted teleport macro takes precedence over a generic AA teleport preset.
  if (entries.some(entry => /\bTeleport\.(?:target|group)\s*\(/.test(entry.command)
    || /\.(?:target|group)\([^;]*?,\s*workflow\.token\s*,/.test(workflowSource(entry.command)))) return null;
  if (!['utility','enchant'].includes(activity.type)) return null;
  if (['creature','ally','enemy','willing','object'].includes(target.affects?.type)) return null;
  const aa = aaTeleport(activity);
  return aa ? {direct:true, source:aa, ownArea} : null;
}

export function teleportTargetKind(activity, fallback) {
  return teleportWorkflow(activity)?.direct ? 'self' : fallback(activity);
}

export function prepareTeleportActivity(activity) {
  const teleport = teleportWorkflow(activity);
  if (!teleport || teleport.ownArea || activity.type === 'forward') return activity;
  const prefix = `system.activities.${activity.id}`;
  // Only the transient cast sees a self target. The saved card, macros, range,
  // costs, effects and animations retain their original data.
  const clone = activity.item.clone({
    [`${prefix}.target.override`]:true,
    [`${prefix}.target.prompt`]:false,
    [`${prefix}.target.affects.type`]:'self',
    [`${prefix}.target.affects.count`]:'1',
    [`${prefix}.target.affects.choice`]:false,
    [`${prefix}.midiProperties.confirmTargets`]:'never'
  }, {keepId:true});
  return clone.system.activities.get(activity.id);
}
