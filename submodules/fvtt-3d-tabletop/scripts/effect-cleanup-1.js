import {ID} from './scene-view-1.js';

function* appliedEffects() {
  const actors = new Set(game.actors);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) actors.add(token.actor);
    }
  }
  for (const actor of actors) yield* actor.effects;
}

function isConcentration(effect) {
  return effect.statuses?.has(CONFIG.specialStatusEffects.CONCENTRATING);
}

function belongsTo(effect, uuid) {
  return effect.origin === uuid || effect.flags?.['chris-premades']?.concentrationEffectUuid === uuid;
}

function expired(effect) {
  if (effect.disabled || effect.parent?.documentName !== 'Actor' || effect.transfer) return false;
  const d = effect.duration;
  // Foundry 13 treats startTime 0 as "now" when computing duration.remaining.
  if (Number.isFinite(d.seconds) && Number.isFinite(d.startTime)) {
    return (d.seconds > 0 || effect.isTemporary) && game.time.worldTime >= d.startTime + d.seconds;
  }
  if (!(d.rounds || d.turns) || !Number.isFinite(d.startRound)) return false;
  const combat = (d.combat ? game.combats.get(d.combat) : game.combat);
  if (!combat?.started || (!d.combat && !combat.combatants.some(c => c.actor?.uuid === effect.parent.uuid))) return false;
  const turns = Math.max(1, combat.turns.length);
  const elapsed = (combat.round - d.startRound) * turns + (combat.turn ?? 0) - (d.startTurn ?? 0);
  return elapsed >= (d.rounds ?? 0) * turns + (d.turns ?? 0);
}

export function installEffectCleanup() {
  let timer, running = false, pending = false;
  const ended = new Set();
  const orphanCandidates = new Set();
  function stale(effect) {
    const root = effect.flags?.['chris-premades']?.concentrationEffectUuid;
    return ended.has(effect.origin) || (root && (ended.has(root) || !fromUuidSync(root, {strict: false})));
  }
  function needsRemoval(effect) {
    if (stale(effect)) return orphanCandidates.has(effect.uuid);
    return expired(effect);
  }
  async function sweep() {
    if (running || !game.users.activeGM?.isSelf) return;
    running = true;
    try {
      do {
        pending = false;
        const due = Array.from(appliedEffects()).filter(needsRemoval);
        // Remove the root first. Its normal system cascade can dispose of multiple targets.
        due.sort((a, b) => Number(isConcentration(b)) - Number(isConcentration(a)));
        for (const candidate of due) {
          if (!game.users.activeGM?.isSelf) return;
          const effect = candidate.parent.effects.get(candidate.id);
          if (!effect || !needsRemoval(effect)) continue;
          try { await effect.delete({'expiry-reason': 'fvtt:expired-or-ended'}); }
          catch (error) { if (candidate.parent.effects.has(candidate.id)) console.error(ID, candidate.uuid, error); }
        }
      } while (pending);
    } finally { running = false; }
  }
  function schedule() {
    if (!game.users.activeGM?.isSelf) return;
    pending = true;
    // Give Times Up and the system's own document cascade the first chance to act.
    if (timer || running) return;
    timer = setTimeout(() => { timer = null; void sweep(); }, 80);
  }
  Hooks.once('ready', () => {
    if (game.system.id !== 'dnd5e') return;
    libWrapper.register(ID, 'CONFIG.ActiveEffect.documentClass.prototype.getDependents', function (original, ...args) {
      const existing = original(...args);
      if (!isConcentration(this) || this.parent?.pack) return existing;
      const byUuid = new Map(existing.map(doc => [doc.uuid, doc]));
      for (const effect of appliedEffects()) {
        if (belongsTo(effect, this.uuid)) byUuid.set(effect.uuid, effect);
      }
      return Array.from(byUuid.values());
    }, 'WRAPPER');
    for (const event of ['updateWorldTime', 'updateCombat', 'combatStart', 'userConnected']) Hooks.on(event, schedule);
    Hooks.on('updateActiveEffect', effect => { if (expired(effect)) schedule(); });
    Hooks.on('createActiveEffect', effect => {
      if (isConcentration(effect)) ended.delete(effect.uuid);
      if (stale(effect)) orphanCandidates.add(effect.uuid);
      if (needsRemoval(effect)) schedule();
    });
    Hooks.on('deleteActiveEffect', effect => {
      orphanCandidates.delete(effect.uuid);
      if (!isConcentration(effect)) return;
      ended.add(effect.uuid);
      if (ended.size > 256) ended.delete(ended.values().next().value);
    });
    // Only revisit orphans present on login or created after the root vanished.
    // Deletions already issued by the native cascade can still be in flight.
    if (game.users.activeGM?.isSelf) {
      for (const effect of appliedEffects()) if (stale(effect)) orphanCandidates.add(effect.uuid);
    }
    schedule();
  });
}
