const MODULE_ID = "fvtt-bg3-encounter-sfx";
const VERSION = "0.1.1";
const START_SOUND = `modules/${MODULE_ID}/sounds/encounter-start.mp3`;
const INITIATIVE_DELAY_MS = 4000;
const ACTION = "foundry.applications.hud.TokenHUD.DEFAULT_OPTIONS.actions.combat";
const pending = new Set();

function report(error) {
  console.warn(`${MODULE_ID} | 入战自动化`, error);
}

function captureJoin(hud) {
  const token = hud.document;
  const scene = token?.parent;
  if (!game.ready || !scene || token.inCombat) return null;
  const tokens = new Set(canvas.tokens.controlled.map(t => t.document));
  tokens.add(token);
  const tokenIds = new Set([...tokens].filter(t => t.parent === scene && !t.inCombat).map(t => t.id));
  if (!tokenIds.size) return null;
  const combat = game.combats.viewed;
  return { sceneId: scene.id, tokenIds, combatId: combat?.id ?? null,
    existingIds: new Set(combat?.combatants.keys() ?? []) };
}

function playJoinSound(sceneId) {
  if (!game.settings.get(MODULE_ID, "enabled")) return;
  const volume = Number(game.settings.get(MODULE_ID, "volume"));
  if (!Number.isFinite(volume) || volume <= 0) return;
  const recipients = game.users.filter(user => user.active && !user.isSelf
    && (user.viewedScene ?? game.scenes.active?.id) === sceneId).map(user => user.id);
  const audio = foundry.audio.AudioHelper.play({
    src: START_SOUND, volume: Math.min(volume, 1), channel: "interface", loop: false
  }, recipients.length ? { recipients } : false);
  Promise.resolve(audio).catch(report);
}

async function finishJoin(combat, added, sceneId) {
  const batch = added.filter(c => !pending.has(c.uuid));
  if (!batch.length) return;
  for (const c of batch) pending.add(c.uuid);
  try {
    try { playJoinSound(sceneId); } catch (error) { report(error); }
    if (!game.settings.get(MODULE_ID, "autoInitiative")) return;
    await new Promise(resolve => setTimeout(resolve, INITIATIVE_DELAY_MS));
    if (!game.settings.get(MODULE_ID, "autoInitiative")) return;
    const live = game.combats.get(combat.id);
    if (!live) return;
    const ids = batch.map(c => live.combatants.get(c.id))
      .filter(c => c?.isOwner && c.initiative === null && c.token?.parent?.id === sceneId)
      .map(c => c.id);
    if (ids.length) await live.rollInitiative(ids);
  } finally {
    for (const c of batch) pending.delete(c.uuid);
  }
}

async function onCombatToggle(wrapped, ...args) {
  let intent;
  try { intent = captureJoin(this); } catch (error) { report(error); }
  const result = await wrapped(...args);
  if (!intent) return result;
  try {
    const combat = intent.combatId ? game.combats.get(intent.combatId) : game.combats.viewed;
    const added = combat?.combatants.contents.filter(c => !intent.existingIds.has(c.id)
      && intent.tokenIds.has(c.tokenId) && c.token?.parent?.id === intent.sceneId) ?? [];
    if (added.length) void finishJoin(combat, added, intent.sceneId).catch(report);
  } catch (error) { report(error); }
  return result;
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabled", {
    name: "播放入战提示音",
    hint: "通过指示物的“进入战斗”按钮加入后，向同场景在线客户端播放一次。",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "volume", {
    name: "入战提示音音量",
    hint: "在各客户端的 Foundry 界面音量基础上调整。",
    scope: "world", config: true, type: Number,
    range: { min: 0, max: 1, step: 0.05 }, default: 0.65
  });
  game.settings.register(MODULE_ID, "autoInitiative", {
    name: "入战后自动掷先攻",
    hint: "加入后等待 4 秒，为本次加入且尚无先攻的单位掷骰。",
    scope: "world", config: true, type: Boolean, default: true
  });
  try {
    libWrapper.register(MODULE_ID, ACTION, onCombatToggle, "WRAPPER");
    console.info(`${MODULE_ID} ${VERSION} | 已监听指示物的进入战斗按钮`);
  } catch (error) { report(error); }
});

// Story mode uses the same local asset, settings and native audio broadcast.
const storySounds=new Set();
Hooks.once('ready',()=>{
 const module=game.modules.get(MODULE_ID);if(!module)return;
 module.api={version:VERSION,initiativeDelay:INITIATIVE_DELAY_MS,autoInitiative:()=>game.settings.get(MODULE_ID,'autoInitiative'),playEncounterStart(sceneId,eventId){
  if(!game.user.isGM)throw Error('只有主持人可以触发剧情入战提示。');
  if(typeof eventId!=='string'||!eventId||!game.scenes.has(sceneId))throw Error('无效的入战事件。');
  if(storySounds.has(eventId))return false;storySounds.add(eventId);
  if(storySounds.size>100)storySounds.delete(storySounds.values().next().value);
  playJoinSound(sceneId);return true;
 }};
});
