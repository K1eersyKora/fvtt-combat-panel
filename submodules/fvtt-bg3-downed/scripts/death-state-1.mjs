export const MODULE_ID = "fvtt-bg3-downed";

const count = value => Math.max(0, Math.min(3, Math.trunc(Number(value) || 0)));

/** HP zero means dying; the prone condition alone must never trigger death saves. */
export function getDeathState(actor) {
  if (actor?.type !== "character") return null;
  const hp = actor.system?.attributes?.hp;
  const death = actor.system?.attributes?.death;
  if (!hp || !death || !Number.isFinite(Number(hp.value)) || Number(hp.value) > 0) return null;
  const success = count(death.success);
  const failure = count(death.failure);
  const statuses = actor.statuses ?? new Set();
  const dead = failure >= 3 || statuses.has("dead");
  const stable = !dead && (success >= 3 || actor.flags?.[MODULE_ID]?.stable === true
    || statuses.has("stable") || statuses.has("stabilized"));
  return { mode: dead ? "dead" : stable ? "stable" : "dying", success, failure };
}

export function isForwardTurn(previous, current, options = {}) {
  if (!current?.combatantId || !(current.round > 0) || !Number.isInteger(current.turn)) return false;
  if (Number(options.direction) < 0) return false;
  if (current.round !== previous?.round) return current.round > (previous?.round ?? 0);
  return current.turn > (previous?.turn ?? -1);
}

export function stateLabel(actorName, state) {
  if (state.mode === "stable") return `${actorName}：生命稳定`;
  if (state.mode === "dead") return `${actorName}：死亡`;
  return `${actorName}：濒死，死亡豁免 ${state.success} 成功、${state.failure} 失败`;
}

/** Positions and layer order come from BG3's Overhead.DeathSavingThrow XAML. */
export function getLayers(state) {
  const layers = [];
  const add = (name, x, y, opacity = 1) => layers.push({ name, x, y, opacity });
  if (state.mode === "stable") add("downedStabilized_frame", 26, 46);
  else {
    add("downedTally_bg", 27, 22);
    if (state.failure) add(`downedTally_death${state.failure}`, state.failure === 3 ? 56 : 104, 62);
    if (state.success) add(`downedTally_life${state.success}`, 26, state.success === 1 ? 100 : 22, state.mode === "dead" ? 0.75 : 1);
    add("downedTally_frame", 0, 0);
    if (state.mode !== "dead") {
      add("ico_revive", 72, 28);
      add("ico_die", 72, 157);
    }
  }
  add("downedTally_dicebg", 62, 76);
  const center = state.mode === "stable" ? "ico_revived" : state.mode === "dead" ? "ico_died" : "ico_downed";
  const size = center === "ico_revived" ? [40, 44] : center === "ico_died" ? [40, 40] : [44, 36];
  add(center, 62 + (60 - size[0]) / 2, 76 + (72 - size[1]) / 2);
  return layers;
}
