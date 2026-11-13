import { MODULE_ID as ID, getDeathState, getLayers, isForwardTurn, stateLabel } from "./death-state-1.mjs";

const VERSION = "0.1.2";
const ASSETS = `modules/${ID}/assets/downed/`;
const nodes = new Map();
const pending = new Map();
const queues = new Map();
let root;
let frame;
let dirty = true;

const setting = key => game.settings.get(ID, key);
const activeGM = () => game.user?.isGM && game.users.activeGM?.id === game.user.id;
const has = (data, key) => Object.hasOwn(data, key) || foundry.utils.hasProperty(data, key);
const get = (data, key) => Object.hasOwn(data, key) ? data[key] : foundry.utils.getProperty(data, key);
const schedule = () => {
  if (frame != null || document.hidden || !root?.isConnected) return;
  frame = requestAnimationFrame(tick);
};
const refresh = () => { dirty = true; schedule(); };

function registerSettings() {
  game.settings.register(ID, "enabled", {
    name: "显示倒地指示器", hint: "玩家角色生命值为 0 时，在可见指示物头顶显示 BG3 死亡豁免图标。单纯俯卧不会触发。",
    scope: "world", config: true, type: Boolean, default: true, onChange: refresh
  });
  game.settings.register(ID, "autoRoll", {
    name: "回合开始自动死亡豁免", hint: "由当前主 GM 调用系统原生死亡豁免，每名参战者每轮最多自动投一次。稳定或死亡后停止。",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(ID, "iconWidth", {
    name: "倒地图标宽度", hint: "屏幕像素；地图缩放时保持大小，图标始终跟随指示物。",
    scope: "client", config: true, type: Number, range: { min: 44, max: 176, step: 4 }, default: 88, onChange: refresh
  });
}

function visibleToken(token) {
  return token?.isVisible === true && token.visible !== false && token.renderable !== false
    && (game.user.isGM || !token.document.hidden);
}

function updateNode(token, state) {
  let entry = nodes.get(token.id);
  if (!entry) {
    const element = document.createElement("div");
    element.className = "bg3-downed-indicator";
    element.dataset.tokenId = token.id;
    element.setAttribute("role", "img");
    root.append(element);
    entry = { element, signature: "", token };
    nodes.set(token.id, entry);
  }
  entry.token = token;
  const signature = `${state.mode}:${state.success}:${state.failure}:${token.name}`;
  if (signature === entry.signature) return;
  entry.signature = signature;
  entry.element.dataset.mode = state.mode;
  entry.element.dataset.success = state.success;
  entry.element.dataset.failure = state.failure;
  entry.element.setAttribute("aria-label", stateLabel(token.name, state));
  const fragment = document.createDocumentFragment();
  for (const layer of getLayers(state)) {
    const image = document.createElement("img");
    image.className = "bg3-downed-layer";
    image.alt = "";
    image.draggable = false;
    image.src = ASSETS + layer.name + ".png";
    image.style.left = `${layer.x}px`;
    image.style.top = `${layer.y}px`;
    image.style.opacity = layer.opacity;
    fragment.append(image);
  }
  entry.element.replaceChildren(fragment);
  return true;
}

function scan() {
  if (!root?.isConnected) return;
  let changed = false;
  const keep = new Set();
  if (canvas.ready && setting("enabled")) {
    for (const token of canvas.tokens?.placeables ?? []) {
      if (!visibleToken(token)) continue;
      const state = getDeathState(token.actor);
      if (!state) continue;
      keep.add(token.id);
      changed = updateNode(token, state) || changed;
    }
  }
  for (const [id, entry] of nodes) {
    if (keep.has(id)) continue;
    entry.element.remove();
    nodes.delete(id);
    changed = true;
  }
  return changed;
}

function position() {
  if (!canvas.ready || !nodes.size) return;
  const view = canvas.app?.canvas ?? canvas.app?.view;
  // Pan hooks can precede PIXI's next render. Refresh the transform explicitly
  // rather than retaining a frame loop to correct stale coordinates later.
  canvas.stage?.toGlobal({x:0,y:0});
  const matrix = canvas.stage?.worldTransform;
  if (!view || !matrix) return;
  const rect = view.getBoundingClientRect();
  const screen = canvas.app.renderer.screen;
  const rx = rect.width / screen.width;
  const ry = rect.height / screen.height;
  const scale = Number(setting("iconWidth")) / 176;
  let changed = false;
  for (const entry of nodes.values()) {
    const {element,token}=entry;
    const state = getDeathState(token.actor);
    if (!visibleToken(token) || !state || !setting("enabled")) {
      if(!element.hidden){element.hidden=true;changed=true;}entry.position='';
      continue;
    }
    const x = token.x + token.w / 2;
    const y = token.y;
    const sx = rect.left + (matrix.a * x + matrix.c * y + matrix.tx) * rx;
    const sy = rect.top + (matrix.b * x + matrix.d * y + matrix.ty) * ry - 8;
    const inside = sx > rect.left - 88 && sx < rect.right + 88 && sy > rect.top && sy < rect.bottom + 110;
    const signature=`${sx}:${sy}:${scale}:${inside}:${token.document.hidden}`;
    if(signature===entry.position)continue;
    entry.position=signature;changed=true;
    element.hidden = !inside;
    element.style.left = `${sx - 88}px`;
    element.style.top = `${sy - 220}px`;
    element.style.transform = `scale(${scale})`;
    element.style.opacity = token.document.hidden ? "0.45" : "1";
  }
  return changed;
}

function tick() {
  frame = null;
  if (!root?.isConnected) return;
  let changed = false;
  if (dirty) {
    dirty = false;
    changed = scan();
  }
  const moved=position();
  if(changed||moved)Hooks.callAll('bg3DownedIndicatorsChanged');
}

function mount() {
  if (root?.isConnected) return;
  root = document.createElement("div");
  root.id = "bg3-downed-indicators";
  document.body.append(root);
  refresh();
}

/** Extend the native update, so reaching three successes remains stable after the system resets 0/0. */
function nativeDeathResult(rolls, details) {
  const actor = details.subject;
  if (actor?.type !== "character") return;
  details.updates ??= {};
  details.updates[`flags.${ID}.stable`] = details.chatString === "DND5E.DeathSaveSuccess";
  const combat = game.combat;
  if (combat?.started && combat.combatant?.actor?.uuid === actor.uuid) {
    details.updates[`flags.${ID}.lastRoll`] = {
      combat: combat.id, combatant: combat.combatant.id, round: combat.round
    };
  }
}

function clearStability(actor, changes) {
  if (actor.type !== "character" || actor.getFlag(ID, "stable") !== true || has(changes, `flags.${ID}.stable`)) return;
  const hpKey = "system.attributes.hp.value";
  const newHP = get(changes, hpKey);
  if ((has(changes, hpKey) && (Number(newHP) > 0 || Number(newHP) < Number(actor.system.attributes.hp.value)))
    || has(changes, "system.attributes.death.success") || has(changes, "system.attributes.death.failure")) {
    changes[`flags.${ID}.stable`] = false;
  }
}

async function processTurn(combat, combatant, round) {
  // Give native/other registered turn handlers a chance to finish a death save first.
  await new Promise(resolve => setTimeout(resolve, 200));
  if (!activeGM() || !setting("autoRoll") || !combat.started || !game.combats.has(combat.id)) return;
  const actor = combatant.actor;
  if (getDeathState(actor)?.mode !== "dying") return;
  const saved = combat.getFlag(ID, "turns")?.[combatant.id];
  const manual = actor.getFlag(ID, "lastRoll");
  if ((saved?.round ?? 0) >= round || (manual?.combat === combat.id
    && manual.combatant === combatant.id && manual.round === round)) return;
  const key = `turns.${combatant.id}`;
  await combat.setFlag(ID, key, { round, status: "pending" });
  if (!activeGM() || !game.combats.has(combat.id) || getDeathState(actor)?.mode !== "dying") return;
  try {
    const rolls = await actor.rollDeathSave(
      { midiOptions: { fastForward: true } },
      { configure: false },
      { data: {
        speaker: ChatMessage.getSpeaker({ actor, token: combatant.token }),
        flags: { [ID]: { automatic: true, combat: combat.id, combatant: combatant.id, round } }
      } }
    );
    if (combat.getFlag(ID, "turns")?.[combatant.id]?.round === round) {
      await combat.setFlag(ID, key, { round, status: rolls?.length ? "rolled" : "skipped" });
    }
  } catch (error) {
    console.error(`${ID} | 自动死亡豁免失败`, error);
    ui.notifications.error(`${actor.name} 的自动死亡豁免失败，请在角色卡上投掷。`);
    if (combat.getFlag(ID, "turns")?.[combatant.id]?.round === round) {
      await combat.setFlag(ID, key, { round, status: "error" });
    }
  }
  refresh();
}

function combatUpdate(combat, changes, options) {
  if (!activeGM() || !setting("autoRoll") || (!has(changes, "round") && !has(changes, "turn"))) return;
  const current = { round: combat.round, turn: combat.turn, combatantId: combat.combatant?.id };
  if (!isForwardTurn(combat.previous, current, options)) return;
  if (getDeathState(combat.combatant?.actor)?.mode !== "dying") return;
  const key = `${combat.id}:${combat.round}:${current.combatantId}`;
  if (pending.has(key)) return;
  const combatant = combat.combatant;
  const round = combat.round;
  const promise = (queues.get(combat.id) ?? Promise.resolve())
    .then(() => processTurn(combat, combatant, round))
    .catch(error => console.error(`${ID} | 回合处理失败`, error))
    .finally(() => {
      pending.delete(key);
      if (queues.get(combat.id) === promise) queues.delete(combat.id);
    });
  pending.set(key, promise);
  queues.set(combat.id, promise);
}

Hooks.once("init", registerSettings);
Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") return;
  mount();
  for (const event of ["canvasReady", "drawToken", "updateToken", "deleteToken", "updateActor",
    "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "updateUser", "sightRefresh"]) Hooks.on(event, refresh);
  Hooks.on('refreshToken', token => {
    if (nodes.has(token.id)) schedule();
    else if (getDeathState(token.actor)) refresh();
  });
  for (const event of ['canvasPan','canvasResize']) Hooks.on(event,schedule);
  window.addEventListener('resize',schedule);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  Hooks.on("canvasTearDown", () => {
    for (const { element } of nodes.values()) element.remove();
    nodes.clear();
    cancelAnimationFrame(frame);frame=null;dirty=true;
  });
  Hooks.on("updateCombat", combatUpdate);
  Hooks.on("dnd5e.rollDeathSaveV2", nativeDeathResult);
  Hooks.on("preUpdateActor", clearStability);
  Hooks.on("dnd5e.preApplyDamage", (actor, amount, changes) => {
    if (actor.type === "character" && actor.system.attributes.hp.value <= 0 && amount > 0) {
      changes[`flags.${ID}.stable`] = false;
    }
  });
  game.modules.get(ID).api = Object.freeze({
    version: VERSION, getState: getDeathState, refresh,
    whenIdle: async () => { while (pending.size) await Promise.allSettled([...pending.values()]); }
  });
  window.addEventListener("beforeunload", () => cancelAnimationFrame(frame), { once: true });
  console.info(`${ID} | BG3 倒地指示器 ${VERSION} ready`);
});
