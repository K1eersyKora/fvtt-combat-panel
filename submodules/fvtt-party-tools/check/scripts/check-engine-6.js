import { checkBonusSummary } from "./check-display-1.js";
import { CheckDiceTray, installTrayDiceRouting } from "./dice-tray-4.js";
import { CheckTokenIndicators } from "./token-indicators-2.js";
import { playerContent, renderPlayer, bindGlassEffects } from "./player-ui-2.js";
/**
 * BG3 技能检定，Foundry VTT 13 / dnd5e 5.1。
 * 只管理窗口、请求和会话；骰子及资源消费交给原生接口。
 * check.result 是候选结果；发起 GM 以 check.accept 仲裁后，获准客户端公开发卡。
 * spell.apply / spell.applied 用于术者没有目标所有权时由发起 GM 补效果。
 * Socket 不提供可信的发送者身份；fromUserId 是路由校验，不是安全认证。
 */
const MODULE_ID = "fvtt-party-tools";
const VERSION = "0.2.4";
const tokenIndicators = new CheckTokenIndicators();
const CHANNEL = `module.${MODULE_ID}`;
const RESULT_SOUNDS = Object.freeze({
  success: `modules/${MODULE_ID}/check/sounds/roll-success.mp3`,
  failure: `modules/${MODULE_ID}/check/sounds/roll-failure.mp3`
});
const ABILITIES = [["str", "力量"], ["dex", "敏捷"], ["con", "体质"], ["int", "智力"], ["wis", "感知"], ["cha", "魅力"]];
const SKILLS = [
  ["acr", "特技", "dex"], ["ani", "驯兽", "wis"], ["arc", "奥秘", "int"], ["ath", "运动", "str"],
  ["dec", "欺瞒", "cha"], ["his", "历史", "int"], ["ins", "洞悉", "wis"], ["itm", "威吓", "cha"],
  ["inv", "调查", "int"], ["med", "医药", "wis"], ["nat", "自然", "int"], ["prc", "察觉", "wis"],
  ["prf", "表演", "cha"], ["per", "游说", "cha"], ["rel", "宗教", "int"], ["slt", "巧手", "dex"],
  ["ste", "隐匿", "dex"], ["sur", "生存", "wis"]
];
const sessions = new Map();
const windows = new Map();
const pendingSpells = new Map();
const pendingEffects = new Map();
const spellRequests = new Map();
const cancelledSpells = new Set();
const confirmations = new Map();
const suppressedDialogs = new WeakSet();
const castLocks = new Set();
const effectLocks = new Map();
const proposals = new Map();
const settled = new Set();
const published = new Set();
const opening = new Map();
let fallbackTimer = null;
let dmDialog = null;
let stylesChecked = false;
let selectionSound = null;
let selectionSoundGeneration = 0;

const esc = value => foundry.utils.escapeHTML(String(value ?? ""));
// crypto.randomUUID 只在安全上下文（https/localhost）可用；服务器是 http://，必须回退。
const uid = () => globalThis.crypto?.randomUUID?.()
  ?? `bg3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const stateKey = (sessionId, actorId, index) => `${sessionId}:${actorId}:${index}`;
const windowKey = p => `${p.sessionId}:${p.actorId}`;
const abilityLabel = key => ABILITIES.find(a => a[0] === key)?.[1] ?? key;
const modeLabel = mode => ({ normal: "普通", adv: "优势", dis: "劣势" })[mode];
const characters = () => game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
const owns = (actor, user = game.user) => Boolean(actor && user && (user.isGM || actor.ownership?.[user.id] === 3));
const playerOwner = actor => game.users.find(u => !u.isGM && u.active && actor.ownership?.[u.id] === 3)
  ?? game.users.find(u => !u.isGM && actor.ownership?.[u.id] === 3);
const sceneReady = () => Boolean(globalThis.canvas?.ready && canvas.scene);
const sceneToken = actor => sceneReady() ? canvas.scene.tokens.find(t => t.actorId === actor.id) : null;
const usableActivity = item => Array.from(item.system.activities?.contents ?? []).find(a => a.canUse);
const checkMode = (actor, check) => Number(check.kind === "skill"
  ? actor.system.skills?.[check.key]?.roll?.mode
  : actor.system.abilities?.[check.key]?.check?.roll?.mode) || 0;

function reportError(error) {
  console.warn(`${MODULE_ID}:`, error);
  ui.notifications.error(`技能检定：${error?.message ?? error}`);
}

async function playBonusSound(selected) {
  if (!game.settings.get(MODULE_ID, "checkPlaySelectionSound")) return;
  const generation = ++selectionSoundGeneration;
  try {
    if (selectionSound?.playing) await selectionSound.stop({ fade: 20 });
    const sound = await game.audio.play(`modules/${MODULE_ID}/check/sounds/bonus-${selected ? "select" : "deselect"}.mp3`,
      { volume: 0.5, context: game.audio.interface });
    if (generation !== selectionSoundGeneration) await sound.stop();
    else selectionSound = sound;
  } catch (error) { console.warn(`${MODULE_ID} | 加成点击音效`, error); }
}

// Foundry 在部分环境不会把模块 CSS 注入到页面（实测本世界 document.styleSheets 里找不到），
// 这里检测关键规则，缺失时手动 fetch 注入，避免窗口变成无样式裸 HTML。
async function ensureStyles() {
  if (stylesChecked) return true;
  stylesChecked = true;
  const hasRule = [...document.styleSheets].some((sheet) => {
    try { return [...(sheet.cssRules ?? [])].some((rule) => (rule.cssText ?? "").includes(".bg3-check-row")); }
    catch { return false; }
  });
  if (hasRule) return true;
  try {
    const response = await fetch(`modules/${MODULE_ID}/check/styles/bg3-check-1.css`, { cache: "no-cache" });
    if (!response.ok) return false;
    if (document.querySelector(`style[data-module="${MODULE_ID}"]`)) return true;
    const style = document.createElement("style");
    style.dataset.module = MODULE_ID;
    style.textContent = (await response.text()).replace(/url\((["']?)(\.{1,2}\/[^)'"\s]+)\1\)/g,
      (_, quote, path) => `url("${new URL(path, response.url).href}")`);
    document.head.append(style);
    console.info(`${MODULE_ID} | 模块 CSS 未由 Foundry 加载，已手动注入`);
    return true;
  } catch (error) {
    console.warn(`${MODULE_ID} | 样式注入失败`, error);
    return false;
  }
}

// 事件处理器始终自行接住 Promise 异常。
function guarded(fn) {
  return (...args) => { Promise.resolve().then(() => fn(...args)).catch(reportError); };
}

function send(message) {
  const envelope = { ...message, fromUserId: game.user.id };
  game.socket.emit(CHANNEL, envelope);
  // Foundry 的模块 socket 不保证向发送端回送，GM 自己参检也必须正常工作。
  void onSocket(envelope);
}

async function withTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function tokenCenter(doc) {
  const size = canvas.grid.size;
  return { x: doc.x + doc.width * size / 2, y: doc.y + doc.height * size / 2 };
}

function distanceFeet(a, b) {
  return canvas.grid.measurePath([tokenCenter(a), tokenCenter(b)]).distance;
}

function matchingChanges(item, check) {
  const bonuses = [];
  let mode = 0;
  let matched = false;
  for (const effect of Array.from(item.effects ?? [])) {
    for (const change of effect.changes ?? []) {
      const bonus = change.key === "system.bonuses.abilities.check"
        || (check.kind === "skill" && change.key === `system.skills.${check.key}.bonuses.check`);
      const modeChange = change.key === `system.abilities.${check.ability}.check.roll.mode`
        || (check.kind === "skill" && change.key === `system.skills.${check.key}.roll.mode`);
      if (bonus) {
        matched = true;
        const value = String(change.value ?? "").trim().replace(/^\+\s*/, "");
        if (value) bonuses.push(value);
      }
      if (modeChange) { matched = true; mode += Math.sign(Number(change.value) || 0); }
    }
  }
  return { matched, bonusText: bonuses.join(" + "), modeDelta: Math.sign(mode) };
}

function validateCast(caster, item, target) {
  const owner = playerOwner(caster);
  const casterToken = sceneToken(caster);
  const targetToken = sceneToken(target);
  const activity = usableActivity(item);
  const level = Number(item.system.level) || 0;
  const properties = item.system.properties;
  const concentration = Boolean(properties?.has?.("concentration") || Array.from(properties ?? []).includes("concentration"));
  const current = Array.from(caster.concentration?.items ?? []);
  const warning = concentration && current.some(i => i.uuid !== item.uuid) ? "会打断术者当前专注" : "";
  let reason = "";
  let distance = null;
  if (!activity) reason = "无可用活动";
  else if (!owner?.active) reason = "术者没有在线玩家";
  else if (!casterToken || !targetToken) reason = "不在当前场景";
  else {
    distance = distanceFeet(casterToken, targetToken);
    const range = item.system.range ?? {};
    const max = range.units === "touch" ? 5 : Number(range.value);
    if (range.units === "self" && caster.id !== target.id) reason = "只能对自己施放";
    else if (range.units !== "self" && (!Number.isFinite(max) || max < 0)) reason = "无法识别射程";
    else if (range.units !== "self" && distance > max) reason = `超出射程（${Math.round(distance * 10) / 10}/需要 ${max} 尺）`;
    const spells = caster.system.spells ?? {};
    if (!reason && level > 0 && !(spells[`spell${level}`]?.value > 0)
      && !(spells.pact?.value > 0 && spells.pact.level >= level)) reason = "没有可用法术位";
  }
  return {
    usable: !reason, reason: reason || warning, warning, activity,
    level, concentration, casterTokenId: casterToken?.id, targetTokenId: targetToken?.id,
    distance, ownerUserId: owner?.id
  };
}

function computeOptions(actor, check) {
  const sources = [];
  const helpers = [];
  for (const caster of characters()) {
    if (caster.id !== actor.id && check.kind === "skill" && caster.system.skills?.[check.key]?.proficient > 0) {
      helpers.push({ actorId: caster.id, name: caster.name, img: caster.img });
    }
    for (const item of Array.from(caster.items ?? [])) {
      if (!["spell", "feat"].includes(item.type)) continue;
      const bonus = matchingChanges(item, check);
      if (!bonus.matched) continue;
      const { activity, warning, ...availability } = validateCast(caster, item, actor);
      sources.push({ casterActorId: caster.id, casterName: caster.name, itemId: item.id,
        itemName: item.name, itemImg: item.img, bonusText: bonus.bonusText,
        modeDelta: bonus.modeDelta, ...availability });
    }
  }
  return { sources, helpers };
}

function mergeMode(actor, check, payload, row) {
  const system = checkMode(actor, check);
  // 已落地的来源由系统模式负责；不再叠加来源的 modeDelta。
  const selected = [...(row.selectedSources ?? [])].map(index => check.sources?.[index]).filter(Boolean);
  const virtual = selected.filter(source => !sourceApplied(actor, row, source) && (!row.busy || !source.bonusText))
    .reduce((total, source) => total + (source.modeDelta || 0), 0);
  const adv = Number(payload.baseMode === "adv") + Number(Boolean(row.helper))
    + Number(virtual > 0) + Number(system > 0);
  const dis = Number(payload.baseMode === "dis") + Number(virtual < 0) + Number(system < 0);
  return adv > dis ? "adv" : dis > adv ? "dis" : "normal";
}

function sourceApplied(actor, row, source) {
  if (!source) return false;
  return (row.appliedSources ?? []).includes(source) || Array.from(actor.effects ?? []).some(e =>
    !e.disabled && e.origin === `Actor.${source.casterActorId}.Item.${source.itemId}`);
}

async function openDmDialog() {
  if (!game.user.isGM) return;
  await ensureStyles();
  if (dmDialog) { await dmDialog.render({ force: true }); return; }
  const checks = [
    ...ABILITIES.map(([key, label]) => ({ kind: "ability", key, label, ability: key })),
    ...SKILLS.map(([key, label, ability]) => ({ kind: "skill", key, label, ability }))
  ];
  const option = (c, i) => `<label class="bg3-check-option"><input type="checkbox" name="check" value="${i}"><span>${esc(c.label)}</span>${c.kind === "skill" ? `<span class="bg3-sub">${esc(abilityLabel(c.ability))}</span>` : ""}</label>`;
  const actorOptions = characters().map(a => {
    const owners = game.users.filter(u => !u.isGM && a.ownership?.[u.id] === 3);
    const names = owners.map(u => `${u.name}${u.active ? "" : "（离线）"}`).join("、") || "无玩家拥有者（GM 代掷）";
    return `<label class="bg3-check-option"><input type="checkbox" name="actor" value="${esc(a.id)}"><span>${esc(a.name)}</span><span class="bg3-sub">${esc(names)}</span></label>`;
  }).join("");
  let baseMode = "normal";
  let submitting = false;
  const dialog = new foundry.applications.api.DialogV2({
    classes: ["bg3-dm-dialog"], position: { width: 780 },
    window: { title: "发起技能检定", resizable: true }, form: { closeOnSubmit: false },
    content: `<div class="bg3-check-content">
      <div class="bg3-ability-groups">${ABILITIES.map(([ability, label]) => `<section class="bg3-check-section bg3-ability-group" data-ability="${ability}"><div class="bg3-check-section-title">${label}</div><div class="bg3-check-grid">${checks.map((c, i) => c.ability === ability ? option(c, i) : "").join("")}</div></section>`).join("")}</div>
      <div class="bg3-check-inline"><label>DC <input name="dc" type="number" min="1" max="40" value="15"></label>
        ${["normal", "adv", "dis"].map(m => `<button type="button" class="bg3-mode ${m === baseMode ? "active" : ""}" data-mode="${m}">${modeLabel(m)}</button>`).join("")}</div>
      <section class="bg3-check-section"><div class="bg3-check-section-title">参检角色</div><div class="bg3-check-grid cols-2">${actorOptions}</div></section>
      <button type="button" class="bg3-roll-btn" data-act="start">发起检定</button></div>`,
    buttons: [{ action: "close", label: "关闭", type: "button", default: true }],
    submit: guarded(async () => dialog.close())
  });
  dmDialog = dialog;
  dialog.addEventListener("close", () => { if (dmDialog === dialog) dmDialog = null; });
  try {
    await dialog.render({ force: true });
    dialog.element.addEventListener("click", guarded(async event => {
      const button = event.target.closest("button");
      if (!button || submitting) return;
      if (button.dataset.mode) {
        baseMode = button.dataset.mode;
        dialog.element.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("active", b.dataset.mode === baseMode));
      }
      if (button.dataset.act !== "start") return;
      const selected = Array.from(dialog.element.querySelectorAll('[name="check"]:checked')).map(e => checks[Number(e.value)]);
      const actors = Array.from(dialog.element.querySelectorAll('[name="actor"]:checked')).map(e => game.actors.get(e.value)).filter(Boolean);
      const dc = Number(dialog.element.querySelector('[name="dc"]').value);
      if (!selected.length || !actors.length) { ui.notifications.warn("至少选择一个检定项和一个角色"); return; }
      if (!Number.isInteger(dc) || dc < 1 || dc > 40) { ui.notifications.warn("DC 必须是 1–40 的整数"); return; }
      submitting = true;
      button.disabled = true;
      try { createSession(selected, actors, dc, baseMode); await dialog.close(); }
      finally { submitting = false; button.disabled = false; }
    }));
  } catch (error) { dmDialog = null; throw error; }
}

function createSession(checks, actors, dc, baseMode) {
  const seconds = Number(game.settings.get(MODULE_ID, "checkAutoRollSeconds"));
  const autoSeconds = Number.isFinite(seconds) && seconds >= 1 ? seconds : 20;
  const createdAt = Date.now();
  const deadline = createdAt + autoSeconds * 1000;
  const session = { id: uid(), createdAt, checks, dc, baseMode,
    showDC: Boolean(game.settings.get(MODULE_ID, "checkShowDC")), autoSeconds,
    targets: [], states: {}, payloads: new Map() };
  // 全部计算成功才发送，避免生成半个批次。
  for (const actor of actors) {
    const owner = playerOwner(actor);
    const target = { actorId: actor.id, actorName: actor.name, userId: owner?.id ?? game.user.id };
    session.targets.push(target);
    const payload = { sessionId: session.id, gmUserId: game.user.id, ...target,
      dc, baseMode, showDC: session.showDC, autoSeconds, deadline,
      checks: checks.map((check, index) => {
        session.states[`${actor.id}:${index}`] = { status: "pending", deadline: deadline + 30000, result: null };
        const effective = { ...check, ability: check.kind === "skill" ? actor.system.skills?.[check.key]?.ability ?? check.ability : check.key };
        return { ...effective, index, ownBonus: Number(check.kind === "skill"
          ? actor.system.skills?.[check.key]?.total : actor.system.abilities?.[check.key]?.mod) || 0,
        ...computeOptions(actor, effective) };
      }) };
    session.payloads.set(actor.id, payload);
  }
  sessions.set(session.id, session);
  for (const target of session.targets) {
    broadcastIndicator(session, target, 0, "pending");
    send({ type: "check.open", toUserId: target.userId, payload: session.payloads.get(target.actorId) });
  }
  ensureFallbackTimer();
}

function renderRows(context) {
  renderPlayer(context, { abilityLabel, modeLabel, mergeMode, sourceApplied });
  const check = context.payload.checks.find(c => c.index === context.activeIndex) ?? context.payload.checks[0];
  if (check) context.tray?.setMode(mergeMode(context.actor, check, context.payload, context.rows.get(check.index)));
  syncCheckPreview(context);
}

function syncCheckPreview(context) {
  if (context.closed) return;
  const check = context.payload.checks.find(c => c.index === context.activeIndex);
  const row = check && context.rows.get(check.index);
  if (!row || row.done) return;
  const preview = { checkIndex: check.index, selectedSources: [...row.selectedSources].sort((a,b) => a-b),
    helperActorId: row.helper?.actorId ?? null, busy: Boolean(row.busy) };
  const signature = JSON.stringify({ ...preview, mode: mergeMode(context.actor,check,context.payload,row),
    bonusText: checkBonusSummary(context.actor,check,row,sourceApplied).text });
  if (context.displaySignature === signature) return;
  context.displaySignature = signature;
  send({ type: "check.preview", toUserId: context.payload.gmUserId, sessionId: context.payload.sessionId,
    actorId: context.payload.actorId, ...preview });
}

function stopRowRequest(row, cancel = true) {
  const pending = pendingSpells.get(row.requestId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingSpells.delete(row.requestId);
    if (cancel) pending.resolve?.(false);
    if (cancel) send({ type: "spell.cancel", id: row.requestId, toUserId: pending.source.ownerUserId });
  }
  row.requestId = null;
}

function clearWindowTimers(context) {
  clearInterval(context.timer);
  clearTimeout(context.closeTimer);
  context.timer = null;
  context.closeTimer = null;
}

function closePlayerDialog(context) {
  // ApplicationV2's height transition cannot collapse an inset:0 fullscreen window.
  // Hide the complete surface immediately, then tear down without that transition.
  context.dialog?.element?.classList.add("bg3-closing");
  return context.dialog.close({ animate: false });
}

async function openPlayerDialog(payload) {
  const actor = game.actors.get(payload.actorId);
  if (!actor || !owns(actor)) { ui.notifications.warn("检定角色不存在或没有权限"); return; }
  await ensureStyles();
  // 计时从「玩家窗口真正打开」开始：服务器/网络慢时，GM 创建时刻的 deadline 可能早已过期，
  // 会让玩家看到 0s 并被 GM 兜底抢先结算。GM 侧的兜底另加了宽限时间。
  payload = { ...payload, deadline: Date.now() + (Number(payload.autoSeconds) || 20) * 1000 };
  const key = windowKey(payload);
  let context = windows.get(key);
  if (context) {
    suppressedDialogs.add(context.dialog);
    clearWindowTimers(context);
    await closePlayerDialog(context);
    context.closed = false;
  } else {
    context = { payload, actor, rows: new Map(), closed: false, activeIndex: payload.checks[0]?.index, rollingIndex: null };
    for (const check of payload.checks) context.rows.set(check.index, {
      done: settled.has(stateKey(payload.sessionId, actor.id, check.index)), busy: false,
      source: null, helper: null, selectedSources: new Set(), applied: false, appliedSources: [], notice: "", requestId: null, result: null
    });
  }
  if (Array.from(context.rows.values()).every(r => r.done)) return;
  const dialog = new foundry.applications.api.DialogV2({
    classes: ["bg3-player-overlay"],
    window: { title: `技能检定 · ${payload.actorName}`, resizable: false, minimizable: false },
    position: { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 },
    form: { closeOnSubmit: false }, content: playerContent,
    buttons: [{ action: "close", label: "关闭并自动结算", type: "button", default: true }],
    submit: guarded(async () => closePlayerDialog(context))
  });
  context.payload = payload;
  context.dialog = dialog;
  windows.set(key, context);
  dialog.addEventListener("close", guarded(async () => {
    if (suppressedDialogs.has(dialog)) { context.tray?.destroy(); return; }
    clearWindowTimers(context);
    context.closed = true;
    context.tray?.destroy();
    for (const row of context.rows.values()) stopRowRequest(row);
    for (const check of payload.checks) await rollRow(context, check, true, true);
    if (windows.get(key) === context) windows.delete(key);
  }));
  await dialog.render({ force: true });
  // 告诉 GM：玩家窗口已打开，宽限计时从现在起算（GM 兜底据此延后）。
  send({ type: "check.opened", toUserId: payload.gmUserId, sessionId: payload.sessionId, actorId: actor.id });
  context.tray = new CheckDiceTray(dialog.element.querySelector("[data-dice-stage]"));
  bindGlassEffects(dialog.element.querySelector("[data-rows]"));
  dialog.element.addEventListener("click", guarded(async event => {
    const button = event.target.closest("button[data-act]");
    if (!button || button.disabled) return;
    if (button.dataset.act === "close") { await closePlayerDialog(context); return; }
    if (button.dataset.act === "tab") {
      if (context.rollingIndex != null) return;
      context.activeIndex = Number(button.dataset.check);
      renderRows(context);
      if (await context.tray.ready) await context.tray.preview();
      return;
    }
    const check = payload.checks.find(c => c.index === context.activeIndex);
    if (!check) return;
    const row = context.rows.get(check.index);
    if (row.done || row.busy) return;
    if (button.dataset.act === "roll") await rollRow(context, check, false);
    if (button.dataset.act === "helper") {
      const helper = check.helpers[Number(button.dataset.helper)];
      if (!helper) return;
      row.helper = row.helper === helper ? null : helper;
      void playBonusSound(Boolean(row.helper));
    }
    if (button.dataset.act === "source") {
      const selected = selectSource(context, check, Number(button.dataset.source));
      if (typeof selected === "boolean") void playBonusSound(selected);
    }
    renderRows(context);
  }));
  renderRows(context);
  // 每秒只更新倒计时文本；整行重渲染会让按钮被替换，点击（包括真人点击）会丢。
  context.timer = setInterval(guarded(async () => {
    const root = context.dialog?.element?.querySelector("[data-rows]");
    if (root && !context.closed) {
      for (const check of payload.checks) {
        const row = context.rows.get(check.index);
        if (!row || row.done) continue;
        const label = root.querySelector(`[data-index="${check.index}"] .bg3-timer`);
        if (label) label.textContent = `${Math.max(0, Math.ceil((payload.deadline - Date.now()) / 1000))} 秒`;
      }
    }
    if (Date.now() >= payload.deadline) {
      for (const check of payload.checks) await rollRow(context, check, true);
    }
  }), 1000);
}

function selectSource(context, check, index) {
  const row = context.rows.get(check.index);
  const source = check.sources[index];
  if (!source?.usable || sourceApplied(context.actor, row, source)) return;
  if (row.selectedSources.has(index)) row.selectedSources.delete(index);
  else {
    for (const selected of row.selectedSources) {
      if (check.sources[selected].itemName === source.itemName) row.selectedSources.delete(selected);
    }
    row.selectedSources.add(index);
  }
  row.notice = row.selectedSources.size ? "掷骰时请求术者确认施放" : "";
  return row.selectedSources.has(index);
}

async function prepareSources(context, check, row) {
  for (const index of row.selectedSources) {
    const source = check.sources[index];
    if (context.closed || row.done) break;
    row.source = source;
    if (sourceApplied(context.actor, row, source) || !source.bonusText) continue;
    const id = uid();
    row.requestId = id;
    row.notice = "等待 " + source.casterName + " 确认施放…";
    renderRows(context);
    const response = new Promise(resolve => {
      const timer = setTimeout(() => {
        if (!pendingSpells.has(id)) return;
        stopRowRequest(row);
        row.notice = "施法确认超时，按角色当前实际效果检定";
      }, 12000);
      pendingSpells.set(id, { context, check, row, source, timer, resolve });
    });
    send({ type: "spell.request", id, toUserId: source.ownerUserId,
      sessionId: context.payload.sessionId, gmUserId: context.payload.gmUserId,
      actorId: context.actor.id, targetActorId: context.actor.id, checkIndex: check.index,
      casterActorId: source.casterActorId, itemId: source.itemId, itemName: source.itemName,
      targetTokenId: source.targetTokenId, casterTokenId: source.casterTokenId,
      check: { kind: check.kind, key: check.key, ability: check.ability }, deadline: Date.now() + 12000 });
    if (!await response) row.selectedSources.delete(index);
  }
  row.source = null;
}

async function rollRow(context, check, auto, earlyClose = false) {
  const { payload, rows } = context;
  const row = rows.get(check.index);
  const key = stateKey(payload.sessionId, payload.actorId, check.index);
  if (row.done || row.busy || settled.has(key)) return;
  if (context.rollingIndex != null) {
    await context.rollCompletion;
    return rollRow(context, check, auto, earlyClose);
  }
  let finishRoll;
  context.rollCompletion = new Promise(resolve => { finishRoll = resolve; });
  row.busy = true;
  context.rollingIndex = check.index;
  context.activeIndex = check.index;
  stopRowRequest(row);
  renderRows(context);
  try {
    const actor = game.actors.get(payload.actorId);
    if (!actor || !owns(actor)) throw new Error("角色不存在或权限丢失");
    if (earlyClose) { row.helper = null; row.selectedSources.clear(); if (!row.applied) row.source = null; }
    if (!earlyClose) {
      send({ type: "check.rolling", toUserId: payload.gmUserId, sessionId: payload.sessionId, actorId: actor.id, checkIndex: check.index });
      await prepareSources(context, check, row);
    }
    const result = await nativeRoll(actor, check, payload, row, auto, context.closed ? null : context.tray);
    if (earlyClose) result.earlyClose = true;
    if (settled.has(key)) return;
    proposals.set(key, { payload, check, result, context });
    // 每客户端每项只发送一次候选结果；GM 回复的获准结果才可以发卡。
    send({ type: "check.result", sessionId: payload.sessionId, actorId: actor.id,
      checkIndex: check.index, gmUserId: payload.gmUserId, result });
    if (!row.done) row.notice = "等待 GM 确认结果…";
  } catch (error) {
    row.notice = `掷骰失败：${error.message}`;
    // 失败后不重复调用可能已产生副作用的掷骰，交给 GM 兜底。
    reportError(error);
  } finally { context.rollingIndex = null; finishRoll(); renderRows(context); }
}

async function nativeRoll(actor, check, payload, row, auto, tray = null) {
  const mode = mergeMode(actor, check, payload, row);
  installTrayDiceRouting();
  const cfg = { target: payload.dc, advantage: mode === "adv", disadvantage: mode === "dis",
    rolls: [{ options: { [MODULE_ID]: { tray: true } } }] };
  if (check.kind === "skill") cfg.skill = check.key;
  else cfg.ability = check.key;
  const rolls = await (check.kind === "skill"
    ? actor.rollSkill(cfg, { configure: false }, { create: false })
    : actor.rollAbilityCheck(cfg, { configure: false }, { create: false }));
  const roll = rolls?.[0];
  if (!roll || !Number.isFinite(roll.total)) throw new Error("原生接口未返回有效掷骰");
  // The native roll is final; reveal it after this tray has stopped. Keep a
  // bounded wait so closing/resizing a broken WebGL board cannot strand a roll.
  if (tray) row.animation = Promise.resolve().then(() => tray.show(roll)).catch(error => {
    console.warn(MODULE_ID + " | 检定骰子动画", error);
    return false;
  });
  if (row.animation) {
    let timer;
    try { await Promise.race([row.animation, new Promise(resolve => { timer = setTimeout(() => { tray.cancelAnimation(); resolve(false); }, 3000); })]); }
    finally { clearTimeout(timer); }
  }
  const selectedModes = [...(row.selectedSources ?? [])].map(index => check.sources?.[index]).filter(s => s && !s.bonusText);
  const activeSources = Array.from(new Set([...(row.appliedSources ?? []), row.source, ...selectedModes].filter(Boolean)))
    .filter(s => sourceApplied(actor, row, s) || !s.bonusText);
  return { total: roll.total, dc: payload.dc, success: Boolean(roll.isSuccess),
    d20s: Array.from(roll.dice?.[0]?.results ?? []).map(r => r.result), kept: roll.dice?.[0]?.total,
    formula: roll.formula, mode, actorName: actor.name, checkLabel: check.label,
    abilityLabel: abilityLabel(check.ability), sources: activeSources.map(s => ({ itemName: s.itemName, casterName: s.casterName, bonusText: s.bonusText })),
    helpers: row.helper ? [{ name: row.helper.name }] : [], auto };
}

function resultCard(result, showDC) {
  const r = result;
  const sources = r.sources.map(s => `${s.itemName}（${s.casterName}）${s.bonusText ? `：${s.bonusText}` : ""}`).join("、");
  return `<article class="bg3-check-card" style="background:#17130c;color:#e8d9b5;border:1px solid #c9a24d;border-radius:6px;overflow:hidden">
    <header class="bg3-card-head" style="background:linear-gradient(180deg,#655126,#302514);color:#ffe9b0;padding:8px">【${esc(r.checkLabel)}】DC ${showDC ? esc(r.dc) : "？"} ｜ ${esc(r.actorName)}</header>
    <div class="bg3-card-body" style="padding:10px"><div class="bg3-card-roll">d20(${r.d20s.map(esc).join(" / ")})，保留 <span class="bg3-die" style="color:#ffe9b0">${esc(r.kept)}</span> ＋ 加值 ${esc(r.total - r.kept)} ＝ ${esc(r.total)}
    → <span class="${r.success ? "bg3-success" : "bg3-failure"}" style="color:${r.success ? "#9ee08f" : "#ef8f86"}">${r.success ? "成功" : "失败"}</span></div>
    <div class="bg3-card-line">${esc(r.abilityLabel)} · ${esc(modeLabel(r.mode))} ｜ 原生公式：${esc(r.formula)}</div>
    ${r.helpers.length ? `<div class="bg3-card-line">优势来源：协助——${esc(r.helpers.map(h => h.name).join("、"))}</div>` : ""}
    ${sources ? `<div class="bg3-card-src" style="color:#ffd98a">来源：${esc(sources)}</div>` : ""}
    ${r.auto ? `<div class="bg3-card-line">${r.earlyClose ? "提前关闭，自动结算" : r.byGM ? "超时，由 GM 自动结算" : "超时自动投掷"}</div>` : ""}</div></article>`;
}

async function publishResult(key, payload, check, result) {
  if (published.has(key)) return;
  // 调用前占位：即使网络异常也不重发，以免服务器已创建而响应丢失。
  published.add(key);
  try {
    const actor = game.actors.get(payload.actorId);
    // 由 Foundry 在新结果卡通知时播放，跟随各客户端的界面音量。
    const sound = game.settings.get(MODULE_ID, "checkPlayResultSound")
      ? RESULT_SOUNDS[result.success ? "success" : "failure"] : null;
    await ChatMessage.create({ content: resultCard(result, payload.showDC),
      speaker: ChatMessage.getSpeaker({ actor }),
      sound,
      flags: { [MODULE_ID]: { sessionId: payload.sessionId, actorId: payload.actorId, checkIndex: check.index } } });
  } catch (error) { reportError(error); }
}

function acceptResult(message) {
  const session = sessions.get(message.sessionId);
  if (!game.user.isGM || !session || message.gmUserId !== game.user.id) return;
  const target = session.targets.find(t => t.actorId === message.actorId);
  const state = session.states[`${message.actorId}:${message.checkIndex}`];
  if (!target || !state || state.status === "done" || message.fromUserId !== target.userId) return;
  if (!Number.isFinite(message.result?.total) || message.result.dc !== session.dc) return;
  finishState(session, target, message.checkIndex, message.result, message.fromUserId);
}

function finishState(session, target, index, result, winnerUserId) {
  const state = session.states[`${target.actorId}:${index}`];
  if (!state || state.status === "done") return false;
  state.status = "done";
  state.result = result;
  const notice = { type: "check.accept", sessionId: session.id, actorId: target.actorId,
    checkIndex: index, gmUserId: game.user.id, winnerUserId, result };
  broadcastIndicator(session, target, index, "result", result);
  for (const userId of new Set([target.userId, winnerUserId])) send({ ...notice, toUserId: userId });
  return true;
}

async function receiveAcceptance(message) {
  const key = stateKey(message.sessionId, message.actorId, message.checkIndex);
  const proposal = proposals.get(key);
  const context = windows.get(`${message.sessionId}:${message.actorId}`) ?? proposal?.context;
  const payload = proposal?.payload ?? context?.payload ?? sessions.get(message.sessionId)?.payloads.get(message.actorId);
  if (!payload || message.fromUserId !== payload.gmUserId || message.gmUserId !== payload.gmUserId) return;
  if (settled.has(key)) return;
  settled.add(key);
  if (context) {
    const row = context.rows.get(message.checkIndex);
    if (row) { row.done = true; row.busy = false; row.result = message.result; row.notice = ""; stopRowRequest(row); }
    renderRows(context);
    if (Array.from(context.rows.values()).every(r => r.done)) {
      clearWindowTimers(context);
      if (!context.closed) context.closeTimer = setTimeout(guarded(() => closePlayerDialog(context)), 2000);
    }
  }
  if (message.winnerUserId === game.user.id) {
    const check = payload.checks.find(c => c.index === message.checkIndex);
    await publishResult(key, payload, check, message.result);
  }
  proposals.delete(key);
}

function displayRow(session, actorId, index) {
  return session.displayRows?.get(stateKey(session.id,actorId,index)) ?? { selectedSources: new Set(), helper: null, busy: false };
}

function receiveCheckPreview(message) {
  const session = sessions.get(message.sessionId);
  const target = session?.targets.find(t => t.actorId === message.actorId && t.userId === message.fromUserId);
  const check = session?.payloads.get(message.actorId)?.checks.find(c => c.index === message.checkIndex);
  const state = check && session.states[`${message.actorId}:${check.index}`];
  if (!game.user.isGM || !target || !check || state?.status === "done" || !Array.isArray(message.selectedSources)) return;
  const selected = message.selectedSources.filter(i => Number.isInteger(i) && check.sources[i]?.usable);
  const row = { selectedSources: new Set(selected), helper: check.helpers.find(h => h.actorId === message.helperActorId) ?? null, busy: Boolean(message.busy) };
  session.displayRows ??= new Map(); session.displayChecks ??= new Map();
  session.displayRows.set(stateKey(session.id,target.actorId,check.index),row);
  session.displayChecks.set(target.actorId,check.index);
  broadcastIndicator(session,target,check.index,state.displayPhase ?? "pending");
}

const displayUpdates = new Set();
function actorDisplayChanged(document) {
  const actor = document?.documentName === "Actor" ? document
    : document?.parent?.documentName === "Actor" ? document.parent
    : document?.parent?.parent?.documentName === "Actor" ? document.parent.parent : null;
  if (!actor || displayUpdates.has(actor.id)) return;
  displayUpdates.add(actor.id);
  queueMicrotask(() => {
    displayUpdates.delete(actor.id);
    try {
      for (const context of windows.values()) if (context.actor.id === actor.id && !context.closed) renderRows(context);
      if (!game.user.isGM) return;
      for (const session of sessions.values()) {
        const target = session.targets.find(t => t.actorId === actor.id);
        if (!target) continue;
        const index = session.displayChecks?.get(actor.id) ?? 0;
        const state = session.states[`${actor.id}:${index}`];
        if (state?.status !== "done") broadcastIndicator(session,target,index,state?.displayPhase ?? "pending");
      }
    } catch (error) { reportError(error); }
  });
}

function broadcastIndicator(session, target, checkIndex, phase, result = null) {
  const payload = session.payloads.get(target.actorId);
  const check = payload.checks.find(c => c.index === checkIndex);
  if (!check) return;
  session.indicatorVersions ??= new Map();
  const revision = (session.indicatorVersions.get(target.actorId) ?? 0) + 1;
  session.indicatorVersions.set(target.actorId, revision);
  const remaining = payload.checks.filter(c => session.states[`${target.actorId}:${c.index}`]?.status !== "done");
  const now = Date.now();
  const actor = game.actors.get(target.actorId);
  if (!actor) return;
  const row = displayRow(session,target.actorId,checkIndex);
  const mode = result?.mode ?? mergeMode(actor,check,payload,row);
  const bonusText = checkBonusSummary(actor,check,row,sourceApplied,result).text;
  const next = remaining[0], nextRow = next && displayRow(session,target.actorId,next.index);
  const nextMode = next ? mergeMode(actor,next,payload,nextRow) : "normal";
  const nextBonusText = next ? checkBonusSummary(actor,next,nextRow,sourceApplied).text : "";
  const indicator = { sessionId: session.id, actorId: target.actorId, gmUserId: game.user.id,
    participantIds: session.targets.map(t => t.userId), revision, phase, checkIndex,
    label: check.label, actorName: target.actorName, mode, bonusText, nextMode, nextBonusText, count: payload.checks.length,
    completed: payload.checks.length - remaining.length, nextLabel: remaining[0]?.label ?? "",
    result: result ? { total: result.total, success: Boolean(result.success) } : null,
    resultUntil: phase === "result" ? now + (remaining.length ? 2000 : 6000) : 0,
    expiresAt: remaining.length ? Math.max(now + 60000, ...remaining.map(c => session.states[`${target.actorId}:${c.index}`].deadline + 30000)) : now + 6000 };
  send({ type: "check.indicator", indicator });
}

function ensureFallbackTimer() {
  if (fallbackTimer) return;
  fallbackTimer = setInterval(guarded(scanFallbacks), 3000);
}

async function scanFallbacks() {
  if (!game.user.isGM) return;
  let pending = false;
  for (const session of sessions.values()) {
    for (const target of session.targets) {
      for (const check of session.payloads.get(target.actorId).checks) {
        const state = session.states[`${target.actorId}:${check.index}`];
        if (state.status === "done") continue;
        pending = true;
        if (state.rolling || state.failed || Date.now() <= state.deadline + 8000) continue;
        state.rolling = true;
        try {
          const actor = game.actors.get(target.actorId);
          if (!actor) throw new Error(`兜底角色已删除：${target.actorName}`);
          const payload = session.payloads.get(target.actorId);
          const result = await nativeRoll(actor, check, payload, { source: null, helper: null }, true);
          result.byGM = true;
          // await 期间玩家可能已先到；必须再次由同一个状态闸门仲裁。
          if (finishState(session, target, check.index, result, game.user.id)) {
            send({ type: "check.result", sessionId: session.id, actorId: actor.id,
              checkIndex: check.index, gmUserId: game.user.id, result });
          }
        } catch (error) { state.failed = true; reportError(error); }
        finally { state.rolling = false; }
      }
    }
  }
  const runnable = Array.from(sessions.values()).some(s => Object.values(s.states).some(st => st.status !== "done" && !st.failed));
  if (!pending || !runnable) { clearInterval(fallbackTimer); fallbackTimer = null; }
}

function hasAppliedEffect(target, item, activity) {
  const refs = Array.from(activity.effects ?? []);
  const names = refs.map(r => item.effects.get(r._id ?? r.id)?.name).filter(Boolean);
  return Array.from(target.effects ?? []).some(e => !e.disabled && (e.name === item.name
    || (e.origin === item.uuid && names.includes(e.name))));
}

// dnd5e/midi 与我们的补效果可能各上一次同名效果；同名只保留第一个。
async function dedupeEffects(target, item) {
  try {
    const names = new Set([item.name, ...Array.from(item.effects ?? []).map(e => e.name)]);
    const seen = new Set();
    const extra = [];
    for (const effect of Array.from(target.effects ?? [])) {
      if (effect.disabled || !names.has(effect.name)) continue;
      if (seen.has(effect.name)) extra.push(effect.id);
      else seen.add(effect.name);
    }
    if (extra.length) await target.deleteEmbeddedDocuments("ActiveEffect", extra);
    return extra.length;
  } catch (error) { console.warn(`${MODULE_ID} | 去重失败`, error); return 0; }
}

async function applyEffects(target, item, activity) {
  const lockKey = `${target.id}:${item.uuid}`;
  if (effectLocks.has(lockKey)) return effectLocks.get(lockKey);
  const operation = (async () => {
    const refs = Array.from(activity.effects ?? []);
    let effects = refs.map(r => item.effects.get(r._id ?? r.id)).filter(Boolean);
    // 活动没有显式引用效果时，回退到物品自带的非转移效果（部分老数据/房规物品如此）。
    if (!effects.length) effects = Array.from(item.effects ?? []).filter(e => !e.disabled && !e.transfer);
    if (!effects.length) throw new Error("找不到可应用的效果");
    // 同名效果不叠加：dnd5e/midi 可能已经替我们上过同名效果。
    const datas = effects
      .filter(e => !Array.from(target.effects ?? []).some(x => !x.disabled && x.name === e.name))
      .map(e => {
        const data = e.toObject();
        delete data._id;
        data.origin = item.uuid;
        data.disabled = false;
        data.transfer = false;
        data.duration = { seconds: item.system.duration?.seconds || 60 };
        return data;
      });
    if (datas.length) await target.createEmbeddedDocuments("ActiveEffect", datas);
    console.debug(`${MODULE_ID} | ${item.name} → ${target.name}：应用 ${datas.length} 个效果`);
    return datas.length;
  })();
  effectLocks.set(lockKey, operation);
  try { await operation; } finally { effectLocks.delete(lockKey); }
}

async function requestEffectApplication(request) {
  const id = uid();
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("GM 补效果超时，请检查目标效果")), 10000);
      pendingEffects.set(id, { resolve, reject, gmUserId: request.gmUserId });
      send({ type: "spell.apply", id, toUserId: request.gmUserId, request });
    });
  } finally { clearTimeout(timer); pendingEffects.delete(id); }
}

async function receiveEffectApplication(message) {
  if (!game.user.isGM) return;
  const r = message.request;
  const session = sessions.get(r?.sessionId);
  const targetInfo = session?.targets.find(t => t.actorId === r.targetActorId && t.userId === r.fromUserId);
  const check = session?.payloads.get(r.targetActorId)?.checks.find(c => c.index === r.checkIndex);
  const caster = game.actors.get(r.casterActorId);
  const item = caster?.items.get(r.itemId);
  const target = game.actors.get(r.targetActorId);
  let ok = false;
  let reason = "无效的补效果请求";
  try {
    if (!session || !targetInfo || !check || !item || !target || r.gmUserId !== game.user.id
      || !owns(caster, game.users.get(message.fromUserId)) || r.toUserId !== message.fromUserId
      || !matchingChanges(item, check).matched) throw new Error(reason);
    // 法术位已消费，不可在此重复做消费前的法术位检查。
    const activity = Array.from(item.system.activities?.contents ?? []).find(a => a.id === message.request.activityId);
    if (!activity) throw new Error("施法活动不存在");
    await applyEffects(target, item, activity);
    ok = true;
    reason = "";
  } catch (error) { reason = error.message; console.warn(MODULE_ID, error); }
  send({ type: "spell.applied", id: message.id, toUserId: message.fromUserId, ok, reason });
}

async function confirmSpell(request, caster, item, target, availability, bonus) {
  return new Promise((resolve, reject) => {
    let answered = false;
    let timer;
    const finish = answer => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      confirmations.delete(request.id);
      resolve(answer);
    };
    const dialog = new foundry.applications.api.DialogV2({
      classes: ["bg3-check-consent"], window: { title: "施放请求" },
      content: `<div class="bg3-check-content"><p><strong>${esc(caster.name)}</strong> 想对 <strong>${esc(target.name)}</strong> 施放 <strong>${esc(item.name)}</strong></p>
        <p>令目标本项检定 ${esc(bonus.bonusText ? `+${bonus.bonusText}` : "")} ${bonus.modeDelta ? modeLabel(bonus.modeDelta > 0 ? "adv" : "dis") : ""}</p>
        ${availability.warning ? `<p class="bg3-check-warn" style="color:#ef8f86">${esc(availability.warning)}</p>` : ""}</div>`,
      buttons: [{ action: "yes", label: "同意施放", type: "submit" }, { action: "no", label: "拒绝", type: "submit", default: true }],
      submit: guarded(result => finish(result === "yes"))
    });
    confirmations.set(request.id, guarded(async () => { finish(false); await dialog.close(); }));
    dialog.addEventListener("close", () => finish(false));
    timer = setTimeout(guarded(async () => { finish(false); await dialog.close(); }), Math.max(0, Math.min(30000, request.deadline - Date.now())));
    Promise.resolve(dialog.render({ force: true })).catch(error => { clearTimeout(timer); confirmations.delete(request.id); reject(error); });
  });
}

async function receiveSpellRequest(request) {
  if (spellRequests.has(request.id)) return;
  spellRequests.set(request.id, request);
  const reply = { type: "spell.result", id: request.id, toUserId: request.fromUserId, ok: false, reason: "" };
  let lockKey;
  let locked = false;
  let runningUse = null;
  let useSettled = true;
  try {
    const caster = game.actors.get(request.casterActorId);
    const target = game.actors.get(request.targetActorId);
    const item = caster?.items.get(request.itemId);
    if (!owns(caster) || !target || !item || !["spell", "feat"].includes(item.type)
      || request.actorId !== target.id || !owns(target, game.users.get(request.fromUserId))
      || !game.users.get(request.gmUserId)?.isGM) throw new Error("角色、物品或权限无效");
    if (!Number.isFinite(request.deadline) || Date.now() >= request.deadline) throw new Error("检定已到期");
    const bonus = matchingChanges(item, request.check);
    if (!bonus.matched) throw new Error("物品不适用于此项检定");
    Object.assign(reply, { itemName: item.name, casterName: caster.name, bonusText: bonus.bonusText, modeDelta: bonus.modeDelta });
    let availability = validateCast(caster, item, target);
    if (availability.activity && hasAppliedEffect(target, item, availability.activity)) {
      Object.assign(reply, { ok: true, alreadyApplied: true });
      return;
    }
    if (!availability.usable) throw new Error(availability.reason);
    lockKey = caster.id; // 同一术者串行施法，避免多窗口同时消费最后一个法术位。
    if (castLocks.has(lockKey)) throw new Error("术者正在处理另一项施法请求");
    castLocks.add(lockKey);
    locked = true;
    if (!await confirmSpell(request, caster, item, target, availability, bonus)) throw new Error("已拒绝");
    if (cancelledSpells.has(request.id) || Date.now() >= request.deadline) throw new Error("请求已取消或检定已到期");
    availability = validateCast(caster, item, target);
    if (!availability.usable) throw new Error(availability.reason);
    const { activity } = availability;
    if (hasAppliedEffect(target, item, activity)) {
      Object.assign(reply, { ok: true, alreadyApplied: true });
      return;
    }
    if (availability.targetTokenId !== request.targetTokenId || availability.casterTokenId !== request.casterTokenId) throw new Error("场景 token 已改变，请重新请求");
    const token = canvas.tokens.get(request.targetTokenId);
    if (!token) throw new Error("当前画布没有目标 token");
    token.setTarget(true, { user: game.user, releaseOthers: true });
    useSettled = false;
    runningUse = Promise.resolve().then(() => activity.use({}, { configure: false })).finally(() => { useSettled = true; });
    const used = await withTimeout(runningUse, 15000, "施法超时；活动可能仍在进行，请检查资源与效果，勿重复施放");
    if (used === false || used === null) throw new Error("施法取消");
    // 给 midi/dnd5e 一点时间自行应用效果；没落地才由我们补（同名不叠加）。
    await new Promise(resolve => setTimeout(resolve, 400));
    console.debug(`${MODULE_ID} | ${item.name} 施放完成：${used?.message ?? used?.type ?? typeof used}`);
    if (!hasAppliedEffect(target, item, availability.activity)) {
      if (owns(target)) await applyEffects(target, item, availability.activity);
      else await requestEffectApplication({ ...request, activityId: availability.activity.id });
    } else {
      console.debug(`${MODULE_ID} | 目标已有 ${item.name} 效果，跳过补效果`);
    }
    await dedupeEffects(target, item);
    reply.ok = true;
  } catch (error) {
    reply.reason = `施法失败：${error.message}`;
    reportError(error);
  } finally {
    if (locked) {
      if (runningUse && !useSettled) void runningUse.catch(() => {}).finally(() => castLocks.delete(lockKey));
      else castLocks.delete(lockKey);
    }
    send(reply);
  }
}

function receiveSpellResult(message) {
  const pending = pendingSpells.get(message.id);
  if (!pending || message.fromUserId !== pending.source.ownerUserId) return;
  const { context, row, source, resolve } = pending;
  stopRowRequest(row, false);
  if (row.done || context.closed) { resolve?.(false); return; }
  if (message.ok) {
    row.source = source;
    row.applied = true;
    if (!row.appliedSources.includes(source)) row.appliedSources.push(source);
    row.notice = message.alreadyApplied ? "目标已有此效果，无需重复施放" : "施法成功；使用目标实际效果掷骰";
  } else {
    row.source = null;
    row.notice = message.reason || "施法失败";
    ui.notifications.warn(row.notice);
  }
  resolve?.(Boolean(message.ok));
  renderRows(context);
}

async function onSocket(message) {
  try {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "check.indicator") {
      if (message.toUserId != null && message.toUserId !== game.user.id) return;
      tokenIndicators.receive(message.indicator, message.fromUserId);
      return;
    }
    if (message.type === "check.indicator-request") {
      if (game.user.isGM && game.users.get(message.fromUserId)?.active) {
        for (const indicator of tokenIndicators.snapshots(game.user.id))
          send({ type: "check.indicator", toUserId: message.fromUserId, indicator });
      }
      return;
    }
    // Results are broadcast; other workflow messages target one client.
    if (message.type === "check.result") {
      if (message.toUserId != null && message.toUserId !== game.user.id) return;
      if (game.user.isGM && message.gmUserId === game.user.id) acceptResult(message);
      return;
    }
    if (message.toUserId !== game.user.id) return;
    switch (message.type) {
      case "check.open": {
        const p = message.payload;
        if (!p || message.fromUserId !== p.gmUserId || !game.users.get(p.gmUserId)?.isGM) return;
        const key = windowKey(p);
        const previous = opening.get(key) ?? Promise.resolve();
        const next = previous.catch(() => {}).then(() => openPlayerDialog(p));
        opening.set(key, next);
        try { await next; } finally { if (opening.get(key) === next) opening.delete(key); }
        break;
      }
      case "check.accept": await receiveAcceptance(message); break;
      case "check.preview": receiveCheckPreview(message); break;
      case "check.rolling": {
        const session = sessions.get(message.sessionId);
        const target = session?.targets.find(t => t.actorId === message.actorId && t.userId === message.fromUserId);
        const state = session?.states[`${message.actorId}:${message.checkIndex}`];
        if (!game.user.isGM || !target || !state || state.status === "done") break;
        state.displayPhase = "rolling";
        session.displayChecks ??= new Map(); session.displayChecks.set(target.actorId,message.checkIndex);
        broadcastIndicator(session, target, message.checkIndex, "rolling");
        if (state.extended) break;
        state.extended = true;
        const count = session.payloads.get(message.actorId)?.checks.find(c => c.index === message.checkIndex)?.sources.length ?? 0;
        state.deadline = Math.max(state.deadline, Date.now() + Math.min(count, 12) * 12000 + 15000);
        break;
      }
      case "check.opened": {
        // GM：玩家窗口已打开 → 兜底时间改成「玩家端倒计时 + 8 秒」，避免慢网络下抢先结算。
        if (!game.user.isGM) return;
        const session = sessions.get(message.sessionId);
        if (!session) return;
        const auto = Number(session.autoSeconds) || 20;
        for (const key of Object.keys(session.states)) {
          if (!key.startsWith(`${message.actorId}:`)) continue;
          const st = session.states[key];
          if (st.status !== "done" && !st.failed) st.deadline = Date.now() + auto * 1000 + 8000;
        }
        break;
      }
      case "spell.request": await receiveSpellRequest(message); break;
      case "spell.cancel": {
        if (spellRequests.get(message.id)?.fromUserId !== message.fromUserId) return;
        cancelledSpells.add(message.id);
        confirmations.get(message.id)?.();
        break;
      }
      case "spell.result": receiveSpellResult(message); break;
      case "spell.apply": await receiveEffectApplication(message); break;
      case "spell.applied": {
        const pending = pendingEffects.get(message.id);
        if (pending?.gmUserId !== message.fromUserId) return;
        if (message.ok) pending.resolve();
        else pending.reject(new Error(message.reason || "补效果失败"));
        break;
      }
      default: break;
    }
  } catch (error) { console.warn(`${MODULE_ID} socket:`, error); }
}

export function registerCheckSettings(visible=true) {
  try {
    game.settings.register(MODULE_ID, "checkShowDC", { name: "向玩家显示检定 DC", scope: "world", config: visible, type: Boolean, default: true });
    game.settings.register(MODULE_ID, "checkAutoRollSeconds", { name: "未掷骰自动投掷（秒）", scope: "world", config: visible, type: Number, default: 20 });
    game.settings.register(MODULE_ID, "checkPlayResultSound", {
      name: "播放检定结果音效", hint: "在辅助检定的成功或失败结果卡出现时播放提示音。",
      scope: "world", config: visible, type: Boolean, default: true
    });
    game.settings.register(MODULE_ID, "checkPlaySelectionSound", {
      name: "播放加成卡片点击音效", hint: "选择或取消法术加值、协助时播放 BG3 界面音效，跟随界面音量。",
      scope: "client", config: visible, type: Boolean, default: true
    });
  } catch (error) { reportError(error); }
}
let engineStarted = false;
let openingDialog = null;

export async function openCheckDialog() {
  if (!game.user.isGM) return null;
  if (openingDialog) return openingDialog;
  if (dmDialog) { dmDialog.bringToFront?.(); return dmDialog; }
  openingDialog = Promise.resolve().then(openDmDialog).then(() => dmDialog).finally(() => { openingDialog = null; });
  return openingDialog;
}

export function registerCheckControl(open) {
  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user?.isGM || !controls?.tokens?.tools) return;
    controls.tokens.tools["fvtt-bg3-check-open"] = {
      name: "fvtt-bg3-check-open", title: "发起技能检定", icon: "fas fa-dice-d20",
      button: true, onChange: open
    };
  });
}

export function startCheckEngine() {
  if (engineStarted) return;
  engineStarted = true;
  game.socket.on(CHANNEL, onSocket);
  installTrayDiceRouting();
  tokenIndicators.initialize();
  for (const hook of ["updateActor","createActiveEffect","updateActiveEffect","deleteActiveEffect","createItem","updateItem","deleteItem"]) Hooks.on(hook,actorDisplayChanged);
  send({ type: "check.indicator-request" });
  console.info(MODULE_ID+' '+VERSION+' | 内置技能检定就绪');
}
