import {registerMacro,macroStub,runMacro} from './macro-registry-1.js';
/* 神秘武器包 · 启动脚本
 * 1) 在世界里创建/同步 MWP- 开头的自动化宏（幂等）
 * 2) 给所有玩家角色挂上 MWP-HalberdRipostePrompt（没拿戟时宏会自己退出）
 * 只依赖 dnd5e + midi-qol + DAE。
 */
const MODULE_ID = "fvtt-automation-repair";
const MITHRAL_RELEASE_VERSION = "1.4.8";
const MACRO_PREFIX = "MWP-";
const MACROS = {
  "MWP-HalberdChargeGate": "// 方天画戟 · 充能闸门（preItemRoll）\n// 诡诈攻击 / 反击 / 精准攻击 共用 4 次充能 + 每轮限一次；不满足则不发动（返回 false 中止本次使用）\nreturn (async () => {\n  const wf = (typeof workflow !== \"undefined\" ? workflow : null) ?? (typeof scope !== \"undefined\" ? scope?.workflow : null);\n  let it = (typeof macroItem !== \"undefined\" ? macroItem : null) ?? wf?.item ?? (typeof item !== \"undefined\" ? item : null);\n  if (!wf || !it) return true;\n  const actorRef = wf.actor ?? (typeof actor !== \"undefined\" ? actor : null);\n  if (!it.isEmbedded || typeof it.update !== \"function\") {\n    const real = actorRef?.items?.get?.(it.id) ?? actorRef?.items?.find?.((x) => x.name === (it.name ?? \"\"));\n    if (real) it = real;\n  }\n\n  const NAMES = { pcBE7Uko0qpPxD9h: \"诡诈攻击\", fRcPuFKsx3P3WRgp: \"反击\", atC5lBegREHBTYIO: \"精准攻击\" };\n  const actName = wf.activity?.name ?? \"\";\n  const actId = NAMES[wf.activity?.id] ? wf.activity.id : Object.keys(NAMES).find((k) => NAMES[k] === actName);\n  if (!actId) return true; // 普通「攻击」不消耗充能\n\n  const uses = it.system?.uses ?? {};\n  const max = Number(uses.max) || 0;\n  const spent = Number(uses.spent) || 0;\n  if (max && spent >= max) {\n    ui.notifications.warn(`${it.name}：充能已用完（${spent}/${max}，长休恢复）`);\n    return false;\n  }\n\n  const combat = game.combat;\n  const tag = combat ? `${combat.id}:${combat.round}` : null;\n  if (tag && it.getFlag(\"midi-qol\", \"dshChargeRound\") === tag) {\n    ui.notifications.warn(`${it.name}：本轮已经消耗过充能，不能再使用「${NAMES[actId]}」`);\n    return false;\n  }\n\n  // 诡诈攻击：强制优势，并跳过攻击骰配置框（否则玩家点 Normal 会覆盖优势）\n  if (actId === \"pcBE7Uko0qpPxD9h\") {\n    wf.workflowOptions = wf.workflowOptions ?? {};\n    wf.workflowOptions.fastForwardAttack = true;\n    wf.rollOptions = wf.rollOptions ?? {};\n    wf.rollOptions.fastForwardAttack = true;\n    try {\n      if (typeof options !== \"undefined\" && options) {\n        if (options.dialog) options.dialog.configure = false;\n        if (options.usage) {\n          options.usage.midiOptions = options.usage.midiOptions ?? {};\n          options.usage.midiOptions.fastForwardAttack = true;\n        }\n      }\n    } catch (e) { /* ignore */ }\n  }\n\n  if (actId === \"fRcPuFKsx3P3WRgp\") {\n    const selfToken = (typeof token !== \"undefined\" ? token : null) ?? wf.token;\n    const targets = Array.from(wf.targets ?? []);\n    if (selfToken && targets.length) {\n      const dist = Math.min(...targets.map((t) => {\n        try { return canvas.grid.measureDistance(selfToken.center, t.center); } catch (e) { return 0; }\n      }));\n      if (dist > 10) {\n        ui.notifications.warn(`${it.name}：反击目标不在 10 尺触及范围内`);\n        return false;\n      }\n    }\n  }\n  return true;\n})();",
  "MWP-HalberdSpendFeint": "// 方天画戟 · 扣充能 + 诡诈攻击优势（preAttackRoll）\n// 诡诈攻击：攻击检定有优势；反击：扣充能并记录已用反应。两者都记「本轮已消耗」。\nreturn (async () => {\n  const wf = (typeof workflow !== \"undefined\" ? workflow : null) ?? (typeof scope !== \"undefined\" ? scope?.workflow : null);\n  let it = (typeof macroItem !== \"undefined\" ? macroItem : null) ?? wf?.item ?? (typeof item !== \"undefined\" ? item : null);\n  if (!wf || !it) return;\n  const actorRef = wf.actor ?? (typeof actor !== \"undefined\" ? actor : null);\n  if (!it.isEmbedded || typeof it.update !== \"function\") {\n    const real = actorRef?.items?.get?.(it.id) ?? actorRef?.items?.find?.((x) => x.name === (it.name ?? \"\"));\n    if (real) it = real;\n  }\n  if (typeof it.update !== \"function\") return;\n\n  const NAMES = { pcBE7Uko0qpPxD9h: \"诡诈攻击\", fRcPuFKsx3P3WRgp: \"反击\" };\n  const actName = wf.activity?.name ?? \"\";\n  const actId = NAMES[wf.activity?.id] ? wf.activity.id : Object.keys(NAMES).find((k) => NAMES[k] === actName);\n  if (!actId) return;\n  if (wf.dshChargeSpent) return;\n\n  const uses = it.system?.uses ?? {};\n  const max = Number(uses.max) || 0;\n  const spent = Number(uses.spent) || 0;\n  if (max && spent >= max) {\n    ui.notifications.warn(`${it.name}：充能已用完`);\n    return;\n  }\n\n  const combat = game.combat;\n  const tag = combat ? `${combat.id}:${combat.round}` : null;\n  const upd = {};\n  if (max) upd[\"system.uses.spent\"] = Math.min(max, spent + 1);\n  if (tag) upd[\"flags.midi-qol.dshChargeRound\"] = tag;\n  if (Object.keys(upd).length) await it.update(upd);\n  wf.dshChargeSpent = true;\n\n  if (actId === \"pcBE7Uko0qpPxD9h\") {\n    wf.advantage = true;\n    wf.workflowOptions = wf.workflowOptions ?? {};\n    wf.workflowOptions.advantage = true;\n    // 跳过攻击骰配置框，避免玩家点 Normal 把优势覆盖掉\n    wf.workflowOptions.fastForwardAttack = true;\n  }\n})();",
  "MWP-HalberdFeintAdvantage": "// 方天画戟 · 诡诈攻击强制优势（preAttackRollConfig）\n// midi 在 configureAttackRoll 里计算优势时会读取 workflow.advantage / workflowOptions.advantage / rollOptions.advantage，\n// 这个阶段正好在计算之前。\nreturn (async () => {\n  const wf = (typeof workflow !== \"undefined\" ? workflow : null) ?? (typeof scope !== \"undefined\" ? scope?.workflow : null);\n  if (!wf) return;\n  const actId = wf.activity?.id;\n  const name = wf.activity?.name ?? \"\";\n  const isFeint = actId === \"pcBE7Uko0qpPxD9h\" || (name && name.includes(\"诡诈攻击\"));\n  if (!isFeint) return;\n  wf.advantage = true;\n  wf.disadvantage = false;\n  wf.workflowOptions = wf.workflowOptions ?? {};\n  wf.workflowOptions.advantage = true;\n  wf.rollOptions = wf.rollOptions ?? {};\n  wf.rollOptions.advantage = true;\n  wf.rollOptions.disadvantage = false;\n})();",
  "MWP-HalberdPrecision": "// 方天画戟 · 精准攻击（preCheckHits）\n// 攻击未命中时询问；确认后消耗 1 次充能，投 1d12 加入本次攻击检定并重新判定命中。每轮限一次（与诡诈攻击/反击共用）。\nreturn (async () => {\n  const wf = (typeof workflow !== \"undefined\" ? workflow : null) ?? (typeof scope !== \"undefined\" ? scope?.workflow : null);\n  let it = (typeof macroItem !== \"undefined\" ? macroItem : null) ?? wf?.item ?? (typeof item !== \"undefined\" ? item : null);\n  if (!wf || wf.aborted) return;\n  if (!it || !wf.attackRoll || !wf.targets?.size) return;\n  if (!wf.activity?.attack) return;\n  const actorRef = wf.actor ?? (typeof actor !== \"undefined\" ? actor : null);\n  if (!it.isEmbedded || typeof it.update !== \"function\") {\n    const real = actorRef?.items?.get?.(it.id) ?? actorRef?.items?.find?.((x) => x.name === (it.name ?? \"\"));\n    if (real) it = real;\n  }\n  if (typeof it.update !== \"function\") return;\n\n  const acOf = (t) => Number(t?.actor?.system?.attributes?.ac?.value ?? 10);\n  const targets = Array.from(wf.targets);\n  if (wf.isCritical) return;\n  if (wf.isFumble) return; // 自然 1 永远是未命中（5e/5R），精准加骰不能把它变成命中\n  if (targets.some((t) => wf.attackTotal >= acOf(t))) return; // 只要命中一个目标就不提示\n  if (wf.dshChargeSpent) return; // 本次工作流已经扣过充能\n\n  const combat = game.combat;\n  const tag = combat ? `${combat.id}:${combat.round}` : null;\n  if (tag && it.getFlag(\"midi-qol\", \"dshChargeRound\") === tag) return;\n\n  const uses = it.system?.uses ?? {};\n  const max = Number(uses.max) || 0;\n  const spent = Number(uses.spent) || 0;\n  if (max && spent >= max) return;\n  const remaining = max ? Math.max(0, max - spent) : \"∞\";\n\n  let use = false;\n  try {\n    use = await foundry.applications.api.DialogV2.confirm({\n      window: { title: \"精准攻击\" },\n      content: `<p>本次攻击未命中（攻击检定 <strong>${wf.attackTotal}</strong>，目标 AC ${targets.map(acOf).join(\" / \")}）。</p>`\n        + `<p>是否消耗 1 次充能，投 <strong>1d12</strong> 加入本次攻击检定？</p>`\n        + `<p class=\"notes\">剩余充能：${remaining} 次｜每轮限一次（与诡诈攻击/反击共用）</p>`,\n      modal: true,\n      rejectClose: false\n    });\n  } catch (err) {\n    console.warn(\"[DSH] 精准攻击询问失败\", err);\n    use = false;\n  }\n  if (!use) return;\n\n  const bonus = await new Roll(\"1d12\").evaluate();\n  const T = foundry.dice.terms;\n  const newRoll = Roll.fromTerms([...wf.attackRoll.terms, new T.OperatorTerm({ operator: \"+\" }), ...bonus.terms]);\n  newRoll.options = foundry.utils.deepClone(wf.attackRoll.options ?? {});\n  await wf.setAttackRoll(newRoll);\n\n  const upd = {};\n  if (max) upd[\"system.uses.spent\"] = Math.min(max, spent + 1);\n  if (tag) upd[\"flags.midi-qol.dshChargeRound\"] = tag;\n  if (Object.keys(upd).length) await it.update(upd);\n  wf.dshChargeSpent = true;\n\n  await ChatMessage.create({\n    speaker: ChatMessage.getSpeaker({ token: wf.token }),\n    content: `<div class=\"dnd5e chat-card\"><header class=\"card-header\"><h3>精准攻击</h3></header>`\n      + `<div class=\"card-content\"><p>消耗 1 次充能：1d12 = <strong>${bonus.total}</strong>，攻击检定变为 <strong>${wf.attackTotal}</strong>。</p></div></div>`\n  });\n  return { used: true, d12: bonus.total, attackTotal: wf.attackTotal };\n})();",
  "MWP-HalberdMarkUtility": "// 方天画戟 · 手动使用「精准攻击」时扣充能（postActiveEffects）\n// 自动拦截未命中时走 preCheckHits 的 precision 宏，不走这里；这里只覆盖玩家手动点击「精准攻击」活动的情况。\nreturn (async () => {\n  const wf = (typeof workflow !== \"undefined\" ? workflow : null) ?? (typeof scope !== \"undefined\" ? scope?.workflow : null);\n  let it = (typeof macroItem !== \"undefined\" ? macroItem : null) ?? wf?.item ?? (typeof item !== \"undefined\" ? item : null);\n  if (!wf || !it) return;\n  const actorRef = wf.actor ?? (typeof actor !== \"undefined\" ? actor : null);\n  if (!it.isEmbedded || typeof it.update !== \"function\") {\n    const real = actorRef?.items?.get?.(it.id) ?? actorRef?.items?.find?.((x) => x.name === (it.name ?? \"\"));\n    if (real) it = real;\n  }\n  if (typeof it.update !== \"function\") return;\n\n  const actName = wf.activity?.name ?? \"\";\n  const isPrecise = wf.activity?.id === \"atC5lBegREHBTYIO\" || actName === \"精准攻击\";\n  if (!isPrecise) return;\n  if (wf.dshChargeSpent) return;\n\n  const uses = it.system?.uses ?? {};\n  const max = Number(uses.max) || 0;\n  const spent = Number(uses.spent) || 0;\n  const upd = {};\n  if (max) upd[\"system.uses.spent\"] = Math.min(max, spent + 1);\n  const combat = game.combat;\n  const tag = combat ? `${combat.id}:${combat.round}` : null;\n  if (tag) upd[\"flags.midi-qol.dshChargeRound\"] = tag;\n  if (Object.keys(upd).length) await it.update(upd);\n  wf.dshChargeSpent = true;\n})();",
  "MWP-HalberdRipostePrompt": "// 方天画戟 · 反击询问（actor 级 isMissed 宏）\nreturn (async () => {\n  const wf = (typeof workflow !== \"undefined\" ? workflow : null) ?? (typeof scope !== \"undefined\" ? scope?.workflow : null);\n  const defender = (typeof actor !== \"undefined\" ? actor : null) ?? wf?.targets?.first()?.actor ?? null;\n  const defenderToken = (typeof token !== \"undefined\" ? token : null) ?? null;\n  if (!wf || !defender) return;\n  if (wf.dshRipostePrompted) return;\n  if (!wf.activity?.attack) return;\n  if (!String(wf.activity?.actionType ?? \"\").startsWith(\"m\")) return;\n\n  const it = defender.items.find((i) => i.name === \"方天画戟\");\n  if (!it) return;\n  if (it.system?.attunement === \"required\" && !it.system?.attuned) return;\n  const act = it.system.activities.get(\"fRcPuFKsx3P3WRgp\")\n    ?? it.system.activities.contents.find((a) => a.type === \"attack\" && /反击/.test(a.name ?? \"\"));\n  if (!act) return;\n  const uses = it.system?.uses ?? {};\n  const max = Number(uses.max) || 0;\n  const spent = Number(uses.spent) || 0;\n  if (max && spent >= max) return;\n  const combat = game.combat;\n  const tag = combat ? `${combat.id}:${combat.round}` : null;\n  if (tag && it.getFlag(\"midi-qol\", \"dshChargeRound\") === tag) return;\n\n  const atkToken = wf.token;\n  if (!atkToken || !defenderToken) return;\n  let dist = 0;\n  try { dist = canvas.grid.measureDistance(defenderToken.center, atkToken.center); } catch (e) { dist = 0; }\n  if (dist > 10) return;\n\n  wf.dshRipostePrompted = true;\n  const remaining = max ? Math.max(0, max - spent) : \"∞\";\n  let use = false;\n  try {\n    use = await foundry.applications.api.DialogV2.confirm({\n      window: { title: \"方天画戟 · 反击\" },\n      content: `<p><strong>${wf.actor?.name ?? \"敌人\"}</strong> 的近战攻击未命中 <strong>${defender.name}</strong>。</p>`\n        + `<p>是否立即用【方天画戟】发动反击？（消耗 1 次充能）</p>`\n        + `<p class=\"notes\">剩余充能：${remaining} 次｜每轮限一次（与诡诈攻击/精准攻击共用）</p>`,\n      modal: true,\n      rejectClose: false\n    });\n  } catch (err) {\n    console.warn(\"[DSH] 反击询问失败\", err);\n    use = false;\n  }\n  if (!use) return;\n  const attackerUuid = wf.token?.document?.uuid;\n  await globalThis.MidiQOL.completeActivityUse(act, {\n    midiOptions: {\n      targetUuids: attackerUuid ? [attackerUuid] : [],\n      ignoreUserTargets: true,\n      checkGMstatus: false,\n      workflowOptions: { targetConfirmation: \"none\" }\n    }\n  }, {}, { systemCard: false });\n})();",
  "MWP-BowGhostSight": "// 幽魂视界：只在「幽魂视界」活动触发，只给施法者自己 60 秒（跨世界可移植版）\n// 活动按「名称」匹配（不硬编码活动 ID），因此任何世界的同名物品都能用\nreturn (async () => {\n  const wf = (typeof workflow !== \"undefined\" ? workflow : null) ?? (typeof scope !== \"undefined\" ? scope?.workflow : null);\n  const act = wf?.activity ?? null;\n  const actId = act?.id ?? null;\n  const actName = act?.name ?? \"\";\n  const isGhostSight = /幽魂视界/.test(actName) || actId === \"XA5WN4VIosdvewRv\";\n  if (!isGhostSight) return { skipped: \"not-ghost-sight\", actId, actName };\n  const selfActor = wf?.actor ?? (typeof actor !== \"undefined\" ? actor : null);\n  const macroItem = wf?.item ?? (typeof item !== \"undefined\" ? item : null);\n  if (!selfActor || !macroItem) return { skipped: \"no actor/item\" };\n  const effects = macroItem.effects?.contents ?? Array.from(macroItem.effects ?? []);\n  const src = effects.find((e) => /幽魂视界/.test(e.name)) ?? effects[0];\n  if (!src) return { skipped: \"no effect\" };\n  const data = src.toObject();\n  delete data._id;\n  data.origin = macroItem.uuid;\n  data.transfer = false;\n  data.disabled = false;\n  data.duration = foundry.utils.mergeObject(data.duration ?? {}, { seconds: 60 }, { inplace: false });\n  const created = await selfActor.createEmbeddedDocuments(\"ActiveEffect\", [data]);\n  console.log(\"[DSH] 幽魂视界 applied to\", selfActor.name);\n  return { applied: created[0]?.name ?? src.name, target: selfActor.name, seconds: 60 };\n})();\n",
  "MWP-MithralBurst": "// 星辉秘银魔杖 · 秘银爆（物品级 [postActiveEffects] 宏）\n// 激活时：受到「最大生命值 50%（向上取整）」的力场伤害，并获得状态「秘银爆 · 星辉蓄能」。\n// 状态：下一次造成伤害的法术（1–5 环）所有伤害骰取最大；结算后立刻移除（由 DSH-MithralBurstConsume 完成）。\nreturn (async () => {\n  const STATE_NAME = \"秘银爆 · 星辉蓄能\";\n  const wf = (typeof workflow !== \"undefined\" ? workflow : null) ?? (typeof scope !== \"undefined\" ? scope?.workflow : null);\n  const it = (typeof macroItem !== \"undefined\" ? macroItem : null) ?? wf?.item ?? (typeof item !== \"undefined\" ? item : null);\n  const self = wf?.actor ?? (typeof actor !== \"undefined\" ? actor : null);\n  if (!wf || !it || !self) return { skipped: \"missing-context\" };\n\n  const act = wf.activity;\n  const isBurst = act?.id === \"m6LUzjAAbQcrfvfX\" || /秘银爆/.test(act?.name ?? \"\");\n  if (!isBurst) return { skipped: \"not-mithral-burst\", activity: act?.name ?? null };\n\n  const maxHP = Number(self.system?.attributes?.hp?.max ?? 0);\n  const amount = Math.max(0, Math.ceil(maxHP * 0.5));\n\n  let method = \"applyDamage\";\n  try {\n    await self.applyDamage([{ value: amount, type: \"force\" }]);\n  } catch (err) {\n    method = \"direct\";\n    const hp = Number(self.system?.attributes?.hp?.value ?? 0);\n    await self.update({ \"system.attributes.hp.value\": Math.max(0, hp - amount) });\n  }\n\n  // 先清掉旧的同类状态，避免叠加\n  const isState = (e) => e.name === STATE_NAME && e.origin === it.uuid;\n  const old = self.effects.filter(isState);\n  if (old.length) await self.deleteEmbeddedDocuments(\"ActiveEffect\", old.map((e) => e.id));\n\n  const effectData = {\n    name: STATE_NAME,\n    img: it.img ?? \"icons/magic/light/bead-yellow.webp\",\n    origin: it.uuid ?? null,\n    transfer: false,\n    disabled: false,\n    description: \"<p>星辉在魔杖中蓄满。下一次用 1–5 环法术位施展的<b>伤害法术</b>，其所有伤害骰取最大值；该次伤害结算后星辉立刻熄灭。</p>\",\n    duration: { value: null, units: \"unlimited\" },\n    changes: [\n      {\n        key: \"flags.midi-qol.max.damage.all\",\n        mode: 0,\n        value: 'item.itemType === \"spell\" && item.level >= 1 && item.level <= 5',\n        priority: 20\n      },\n      {\n        key: \"flags.midi-qol.onUseMacroName\",\n        mode: 0,\n        value: \"MWP-MithralConsume,postDamageRoll\",\n        priority: 20\n      }\n    ],\n    flags: { dae: { specialDuration: [], transfer: false }, \"fvtt-automation-repair\": { mithralBurstVersion: 2, wandId: it.id } }\n  };\n  const [eff] = await self.createEmbeddedDocuments(\"ActiveEffect\", [effectData]);\n\n  await ChatMessage.create({\n    speaker: ChatMessage.getSpeaker({ actor: self, token: wf.token }),\n    content: `<div class=\"dnd5e chat-card\"><header class=\"card-header\"><h3>秘银爆</h3></header>`\n      + `<div class=\"card-content\">`\n      + `<p>${self.name} 引爆星辉：受到 <strong>${amount}</strong> 点力场伤害（最大生命值的 50%，向上取整）。</p>`\n      + `<p>获得状态「<strong>秘银爆 · 星辉蓄能</strong>」：下一次 1–5 环<b>伤害法术</b>的伤害骰取最大值，结算后立即消失。</p>`\n      + `</div></div>`\n  });\n\n  console.log(\"[DSH] 秘银爆：自伤\", amount, \"力场，via\", method, \"effect\", eff?.id);\n  return { amount, method, effectId: eff?.id ?? null, maxHP };\n})();\n",
  "MWP-MithralConsume": "// 秘银爆：由蓄能效果在 postDamageRoll 调用；兼容世界宏和物品宏。\nreturn (async () => {\n  const context = typeof scope !== \"undefined\" ? scope : {};\n  const wf = (typeof workflow !== \"undefined\" ? workflow : null) ?? context.workflow;\n  const self = wf?.actor;\n  if (!self || !wf.item || wf.item.type !== \"spell\" || wf.aborted) return;\n  const level = Number(wf.item.system?.level ?? 0);\n  if (level < 1 || level > 5) return;\n  const source = (typeof macroItem !== \"undefined\" ? macroItem : null) ?? context.macroItem;\n  const wand = source && /星辉秘银魔杖/.test(source.name ?? \"\") ? source\n    : self.items?.find(i => /星辉秘银魔杖/.test(i.name ?? \"\"));\n  if (!wand) return;\n  const effects = self.effects.filter(e => e.name === \"秘银爆 · 星辉蓄能\" && e.origin === wand.uuid && !e.disabled);\n  if (!effects.length) return;\n  const targets = wf.targets?.size ?? 0;\n  const hits = (wf.hitTargets?.size ?? 0) + (wf.failedSaves?.size ?? 0);\n  if (wf.attackRoll ? hits === 0 : hits === 0 && targets === 0) return;\n  if (!(wf.damageRolls?.length > 0 || Number(wf.damageTotal ?? 0) > 0)) return;\n  await self.deleteEmbeddedDocuments(\"ActiveEffect\", effects.map(e => e.id));\n  await ChatMessage.create({\n    speaker: ChatMessage.getSpeaker({ actor: self, token: wf.token }),\n    content: `<div class=\"dnd5e chat-card\"><header class=\"card-header\"><h3>秘银爆 · 星辉熄灭</h3></header><div class=\"card-content\"><p><strong>${wf.item.name}</strong>的伤害骰已取最大值，星辉耗尽。</p></div></div>`\n  });\n})();\n"
};
const RIPOSTE_FLAG = "[isMissed]MWP-HalberdRipostePrompt";
for(const [name,command]of Object.entries(MACROS))registerMacro(name,command);
function repairHook(name, callback) { return Hooks.on(name, function(...args) { if(game.modules.get(MODULE_ID)?.api?.migrating)return; return callback.apply(this,args); }); }
const RIPOSTE_MARK = "MWP-HalberdRipostePrompt";
const HALBERD = /方天画戟/;

async function ensureMacros() {
  const out = [];
  for (const [name, command] of Object.entries(MACROS)) {
    try {
      const cmd = macroStub(name);
      // 同名可能有多条（多个 GM 客户端同时 ready 时会发生），保留一条、清掉多余的
      const found = game.macros.filter((m) => m.name === name);
      const first = found[0];
      const dupes = found.slice(1);
      if (first) {
        if ((first.command ?? "").replace(/\s+$/, "") !== cmd) await first.update({ command: cmd, type: "script" });
        if (dupes.length) await Macro.deleteDocuments(dupes.map((m) => m.id));
        out.push({ name, status: dupes.length ? "deduped" : "ok" });
      } else {
        await Macro.create({ name, type: "script", command: cmd, ownership: { default: 3 } });
        out.push({ name, status: "created" });
      }
    } catch (e) {
      out.push({ name, status: "error", error: String(e?.message ?? e) });
      console.error("[fvtt-automation-repair] 宏同步失败", name, e);
    }
  }
  return out;
}

// 收尾去重：多个 GM 客户端同时 ready 时可能各建一份，这里统一清掉多余的
async function dedupeMacros() {
  const removed = [];
  for (const name of Object.keys(MACROS)) {
    const found = game.macros.filter((m) => m.name === name);
    if (found.length <= 1) continue;
    const extra = found.slice(1);
    await Macro.deleteDocuments(extra.map((m) => m.id));
    removed.push({ name, removed: extra.length });
  }
  return removed;
}

async function ensureRiposteFlag() {
  const touched = [];
  for (const a of game.actors.filter((x) => x.type === "character")) {
    // DAE appends item-effect macros to derived flags. Never persist that derived list.
    const cur = a._source.flags?.["midi-qol"]?.onUseMacroName ?? "";
    const parts = cur.split(",").map((s) => s.trim()).filter(Boolean);
    // 同时清掉旧 DSH 版本，避免两个反击提示并存
    const kept = parts.filter((p) => !p.endsWith("HalberdRipostePrompt"));
    kept.push(RIPOSTE_FLAG);
    const next = kept.join(",");
    if (next !== cur) {
      await a.setFlag("midi-qol", "onUseMacroName", next);
      touched.push(a.name);
    }
  }
  return touched;
}

Hooks.once("ready", async () => {
  if (!game.user?.isGM || game.users.activeGM?.id!==game.user.id) return;
  try {
    const macros = await ensureMacros();
    const actors = await ensureRiposteFlag();
    // 多个 GM 客户端并发时可能各建一份，5 秒后再清一次（幂等）
    setTimeout(() => { dedupeMacros().catch(() => {}); }, 5000);
    console.log(`[${MODULE_ID}] 宏同步 ${macros.filter((m) => m.status === "created").length} 新建 / ${macros.length} 检查；角色反击宏更新 ${actors.length} 个`, { macros, actors });
  } catch (err) {
    console.error(`[${MODULE_ID}] 初始化失败`, err);
  }
});

// 给 GM 一个手动重跑的入口（宏管理里执行 / 或控制台调用）
globalThis.mysticWeaponPackSync = async () => {
  const macros = await ensureMacros();
  const deduped = await dedupeMacros();
  const actors = await ensureRiposteFlag();
  return { macros, deduped, actors };
};







































// JEDI-SUBCLASS-AUTOGRANT
const JEDI_PACK = "mvp";
const JEDI_FLAG = "fvtt-automation-repair";

// 剑式定义（弹窗/聊天/应用都用这一份）
const JEDI_STANCES = {
  III: {
    name: "第三型 · 索雷苏",
    effects: "武器精通「削弱(Sap)」；被远程攻击命中时，可用反应「飞矢偏转」减伤（1d8 + 感知 + 半等级，可再花 1 枚原力骰加 1d8）。"
  },
  IV: {
    name: "第四型 · 阿塔鲁",
    effects: "武器精通「迅击(Nick)」或「推离(Push)」；步行速度翻倍；本回合移动 10 尺以上后命中，伤害额外加感知调整值。"
  },
  V: {
    name: "第五型 · 德杰姆苏",
    effects: "武器精通「擦掠(Graze)」或「失衡(Topple)」；可发动「破势反击」（反应 + 1 枚原力骰，命中后本次伤害额外 +1d8）。"
  }
};
function jediStanceName(key) { return (JEDI_STANCES[key] ? JEDI_STANCES[key].name : key); }
function jediStanceText(key) { return (JEDI_STANCES[key] ? JEDI_STANCES[key].effects : ""); }

// 每个剑式可选的精通（规则上二选一：第四型=迅击/推离，第五型=擦掠/失衡）
const JEDI_STANCE_OPTIONS = {
  III: [{ mastery: "sap", label: "削弱" }],
  IV: [{ mastery: "nick", label: "迅击" }, { mastery: "push", label: "推离" }],
  V: [{ mastery: "graze", label: "擦掠" }, { mastery: "topple", label: "失衡" }]
};
const JEDI_MASTERY_LABEL = { sap: "削弱", nick: "迅击", push: "推离", graze: "擦掠", topple: "失衡" };
function jediStanceOptionLabel(key, mastery) {
  return jediStanceName(key) + (mastery ? "（" + (JEDI_MASTERY_LABEL[mastery] ?? mastery) + "）" : "");
}

// ---------- 子职特性自动授予 ----------
async function jediGrantSubclass(item) {
  if (!item || item.type !== "subclass" || !item.actor) return [];
  if (item.flags?.[JEDI_FLAG]?.pack !== JEDI_PACK) return [];
  const actor = item.actor;
  const cls = actor.items.find(i => i.type === "class" && i.system.identifier === item.system.classIdentifier);
  const level = cls?.system.levels ?? 0;
  const granted = [];
  for (const adv of item.system.advancement ?? []) {
    if (adv.type !== "ItemGrant" || adv.level > level) continue;
    for (const entry of adv.configuration.items ?? []) {
      try {
        const src = await fromUuid(entry.uuid);
        if (!src) continue;
        if (actor.items.some(i => i.name === src.name && i.type === src.type)) continue;
        const data = src.toObject(); delete data._id;
        await actor.createEmbeddedDocuments("Item", [data]);
        granted.push(src.name);
      } catch (e) { console.error("[fvtt-automation-repair] 子职特性授予失败", e); }
    }
  }
  if (granted.length) {
    ui.notifications.info("绝地武士：已授予 " + granted.join("、"));
    if (granted.some(n => n.indexOf("原力谐律") === 0)) await jediEnsureEmpathyProf(actor, { prompt: !game.user.isGM });
  }
  return granted;
}
repairHook("createItem", (item) => {
  if (item.type === "subclass") {
    if (!game.user.isGM && !item.actor?.isOwner) return;
    setTimeout(() => jediGrantSubclass(item).catch(console.error), 150);
    return;
  }
  if (item.actor && item.system?.identifier === "force-harmony") {
    if (!game.user.isGM && !item.actor.isOwner) return;
    setTimeout(() => jediEnsureEmpathyProf(item.actor, { prompt: !game.user.isGM }).catch(console.error), 300);
  }
});
repairHook("updateItem", (item, changes) => {
  if (item.type !== "class") return;
  if (!game.user.isGM && !item.actor?.isOwner) return;
  if (!foundry.utils.hasProperty(changes, "system.levels")) return;
  setTimeout(() => {
    for (const sub of item.actor?.items.filter(i => i.type === "subclass") ?? []) jediGrantSubclass(sub).catch(console.error);
  }, 250);
});
repairHook("deleteItem", (item) => {
  try {
    const actor = item.parent;
    if (!actor || actor.documentName !== "Actor") return;
    if (item.system?.identifier !== "force-harmony") return;
    for (const e of actor.effects.filter(e => e.flags?.[JEDI_FLAG]?.empathyProf)) e.delete().catch(() => {});
    if (actor.flags?.[JEDI_FLAG]?.empathyProf !== undefined) actor.unsetFlag(JEDI_FLAG, "empathyProf").catch(() => {});
  } catch (e) { console.warn("[fvtt-automation-repair] 清理原力共情失败", e); }
});

// ---------- 原力共情：常效熟练（一次性选择 + 永久 AE） ----------
function jediEmpathyLabel(skill) { return skill === "ins" ? "洞悉" : "游说"; }
const jediEmpathyLocks = new Map();
async function jediEnsureEmpathyProf(actor, opts = {}) {
  if (!actor) return null;
  // 迁移与 ready 钩子可能同时调用，避免写出两条重复 AE
  if (jediEmpathyLocks.get(actor.id)) return null;
  jediEmpathyLocks.set(actor.id, true);
  try {
  const item = actor.items.find(i => i.system?.identifier === "force-harmony");
  if (!item) return null;
  const forced = opts.skill ?? globalThis.JF_TEST?.empathySkill ?? null;
  let chosen = actor.flags?.[JEDI_FLAG]?.empathyProf ?? null;
  // 显式指定（GM 改选 / 测试）优先于已记录的 flag
  if (forced) chosen = forced;
  if (!chosen) {
    if (opts.prompt === false) return null;
    const ins = Number(actor._source?.system?.skills?.ins?.value ?? 0);
    const per = Number(actor._source?.system?.skills?.per?.value ?? 0);
    const mark = (n, v) => n + (v >= 1 ? "（已熟练）" : "");
    chosen = await Dialog.prompt({
      title: "原力共情 · 选择熟练项",
      content: "<p><strong>" + actor.name + "</strong> 的「原力共情」永久给予一项技能熟练，请选择：</p>"
        + '<div class="form-group"><label>熟练项</label><select name="skill">'
        + '<option value="ins">' + mark("洞悉", ins) + "</option>"
        + '<option value="per">' + mark("游说", per) + "</option>"
        + "</select></div>",
      label: "确定",
      callback: (html) => (html instanceof HTMLElement ? html : html[0]).querySelector('[name="skill"]').value,
      rejectClose: false
    });
    if (!chosen) chosen = ins >= 1 && per < 1 ? "per" : "ins";
  }
  if (!chosen) return null;
  // 已经选过且只有一个对应 AE：幂等返回（不重复写）
  if (!forced) {
    const same = actor.effects.filter(e => e.flags?.[JEDI_FLAG]?.empathyProf === chosen);
    if (actor.flags?.[JEDI_FLAG]?.empathyProf === chosen && same.length === 1) return chosen;
  }
  // 以原始数据判定是否已熟练（AE 会改派生值，不能用 actor.system）
  const base = Number(actor._source?.system?.skills?.[chosen]?.value ?? 0);
  if (actor.flags?.[JEDI_FLAG]?.empathyProf !== chosen) await actor.setFlag(JEDI_FLAG, "empathyProf", chosen);
  // 清掉所有旧的「原力共情」AE（含旧版手动活动叠出来的重复项），再建一个
  const stale = actor.effects.filter(e => e.flags?.[JEDI_FLAG]?.empathyProf);
  if (stale.length) await actor.deleteEmbeddedDocuments("ActiveEffect", stale.map(e => e.id));
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "原力共情 · 熟练（" + jediEmpathyLabel(chosen) + "）",
    img: item.img,
    origin: item.uuid,
    transfer: false,
    disabled: false,
    duration: { value: null, units: "unlimited" },
    description: "<p>原力共情：你的" + jediEmpathyLabel(chosen) + "技能获得熟练。</p>",
    flags: { [JEDI_FLAG]: { empathyProf: chosen } },
    changes: base >= 1 ? [] : [{ key: "system.skills." + chosen + ".value", mode: 5, value: "1" }]
  }]);
  ui.notifications.info("原力共情：" + actor.name + " 获得" + jediEmpathyLabel(chosen) + (base >= 1 ? "熟练（原本已熟练，未重复叠加）" : "熟练"));
  return chosen;
  } finally {
    jediEmpathyLocks.delete(actor.id);
  }
}
globalThis.jediEnsureEmpathyProf = jediEnsureEmpathyProf;

// ---------- 特效 ----------
const JEDI_JB2A = () => (game.modules.get("jb2a_patreon")?.active ? "jb2a_patreon" : "JB2A_DnD5e");
// 当前画布上的 token（角色可能在别的场景，直接 atLocation 会静默失败）
function jediCanvasToken(token) {
  if (!token) return null;
  const t = canvas?.tokens?.get(token.id ?? token.document?.id ?? "");
  return t ?? null;
}
// 找到角色在当前画布上的 token（优先已选中的）
function jediActiveTokenFor(actor) {
  if (!actor) return null;
  const list = actor.getActiveTokens?.() ?? [];
  for (const t of list) {
    const c = canvas?.tokens?.get(t.id);
    if (c) return c;
  }
  return null;
}
// 剑式光环（切换剑式时用）
function jediPlayStanceFx(token) {
  const t = jediCanvasToken(token);
  if (!t || !globalThis.Sequencer) { console.log("[fvtt-automation-repair] 剑式特效跳过：token 不在当前场景或 Sequencer 未就绪"); return; }
  try {
    new Sequence().effect()
      .file("modules/" + JEDI_JB2A() + "/Library/Generic/Energy/EnergyConduitCircle_01_Regular_BluePurple_15ft_1000x400.webm")
      .atLocation(t).scaleToObject(1.2).fadeIn(100).fadeOut(200).play();
  } catch (e) { console.warn("[fvtt-automation-repair] 剑式特效失败", e); }
}
// 音效：优先用 Foundry 原生 AudioHelper（会广播给其他客户端，且不依赖 Sequencer 的音频设置）
function jediPlaySoundFile(src, volume) {
  try {
    const AH = foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
    if (AH?.play) {
      AH.play({ src: src, volume: volume ?? 0.6, autoplay: true, loop: false }, true);
      return;
    }
    if (globalThis.Sequencer) new Sequence().sound().file(src).volume(volume ?? 0.6).play();
  } catch (e) { console.warn("[fvtt-automation-repair] 播放音效失败", src, e); }
}

// 攻击特效：挥剑（主）+ 能量圈（点缀）+ psfx 挥剑音效
// 两条特效分开播（同一个 Sequence 里有时会被 Sequencer 合并/丢帧）
function jediPlayAttackFx(token) {
  const t = jediCanvasToken(token);
  if (!t) { console.log("[fvtt-automation-repair] 攻击特效跳过：token 不在当前场景"); return; }
  if (!globalThis.Sequencer) { console.log("[fvtt-automation-repair] 攻击特效跳过：Sequencer 未就绪"); return; }
  try {
    new Sequence().effect()
      .file("modules/" + JEDI_JB2A() + "/Library/Generic/Weapon_Attacks/Melee/LaserSword01_02_Regular_Blue_800x600.webm")
      .atLocation(t).scaleToObject(2.4).fadeIn(80).fadeOut(250).play();
  } catch (e) { console.warn("[fvtt-automation-repair] 挥剑特效失败", e); }
  try {
    new Sequence().effect()
      .file("modules/" + JEDI_JB2A() + "/Library/Generic/Energy/EnergyConduitCircle_01_Regular_BluePurple_15ft_1000x400.webm")
      .atLocation(t).scaleToObject(0.9).fadeIn(80).fadeOut(200).play();
  } catch (e) { console.warn("[fvtt-automation-repair] 能量圈特效失败", e); }
  if (game.modules.get("psfx")?.active) {
    // 能量剑：用 psfx 的“魔能爆”音色（金属挥砍改成能量爆鸣）
    const n = String(1 + Math.floor(Math.random() * 5)).padStart(3, "0");
    jediPlaySoundFile("modules/psfx/library/cantrips/eldritch-blast/v1/eldritch-blast-" + n + ".ogg", 0.55);
  }
}
// 命中音效（psfx 能量命中）
function jediPlayImpactSound() {
  if (!game.modules.get("psfx")?.active) return;
  const n = String(Math.floor(Math.random() * 5)).padStart(2, "0");
  jediPlaySoundFile("modules/psfx/library/impacts/magicaleffects/lightning/meleeattack-impacts-magicaleffects-lightning-" + n + ".ogg", 0.5);
}
globalThis.jediPlayStanceFx = jediPlayStanceFx;
globalThis.jediPlayAttackFx = jediPlayAttackFx;
globalThis.jediPlayImpactSound = jediPlayImpactSound;
globalThis.jediPlaySoundFile = jediPlaySoundFile;

// 清掉所有剑式 AE（含旧版留下的 disabled 残留）并还原被第四型翻倍的移速
async function jediClearStances(actor) {
  if (!actor) return;
  const stale = actor.effects.filter(e => e.flags?.[JEDI_FLAG]?.stance);
  if (stale.length) {
    try { await actor.deleteEmbeddedDocuments("ActiveEffect", stale.map(e => e.id)); }
    catch (e) { console.warn("[fvtt-automation-repair] 清理剑式 AE 时出错（通常是被别处先删了）", e); }
  }
  const base = actor.flags?.[JEDI_FLAG]?.walkBase;
  if (base !== undefined && base !== null) {
    await actor.update({ "system.attributes.movement.walk": base });
    await actor.unsetFlag(JEDI_FLAG, "walkBase");
  }
  if (actor.flags?.[JEDI_FLAG]?.moved10) await actor.unsetFlag(JEDI_FLAG, "moved10");
  if (actor.flags?.[JEDI_FLAG]?.masteries !== undefined) {
    try { await actor.unsetFlag(JEDI_FLAG, "masteries"); } catch (e) {}
  }
  if (actor.flags?.[JEDI_FLAG]?.stanceMastery !== undefined) {
    try { await actor.unsetFlag(JEDI_FLAG, "stanceMastery"); } catch (e) {}
  }
}

// 进入某个剑式（互斥 AE + 第四型移速 + 聊天说明 + 光环）
// 并发锁：战斗开始与回合开始可能同一瞬间都触发，避免重复删/建 AE 造成 "ActiveEffect does not exist" 红字
const jediApplyLocks = new Map();
async function jediApplyStanceKey(actor, key, opts = {}) {
  if (!actor) return false;
  if (jediApplyLocks.get(actor.id)) return false;
  jediApplyLocks.set(actor.id, true);
  try {
    const forms = actor.items.find(i => i.system?.identifier === "saber-forms");
    if (!forms) return false;
    await jediClearStances(actor);
    // 同一剑式有多个精通可选（IV：迅击/推离；V：擦掠/失衡）→ 只挂玩家选中的那个
    let efs = forms.effects.filter(e => e.flags?.[JEDI_FLAG]?.stance === key);
    if (!efs.length) return false;
    const wantMastery = opts.mastery ?? null;
    if (wantMastery) {
      const filtered = efs.filter(e => (e.changes ?? []).some(c => String(c.key ?? "").indexOf("mastery.bonus") >= 0 && String(c.value) === wantMastery));
      if (filtered.length) efs = filtered;
    }
    const datas = [];
    const masteryVals = [];
    for (const ef of efs) {
      const d = ef.toObject();
      delete d._id;
      d.name = "剑式 · " + jediStanceOptionLabel(key, wantMastery);
      d.disabled = false;
      d.transfer = false;
      d.duration = { value: null, units: "unlimited" };
      datas.push(d);
      for (const c of (ef.changes ?? [])) {
        if (String(c.key ?? "").indexOf("mastery.bonus") >= 0 && c.value) masteryVals.push(String(c.value));
      }
    }
    await actor.createEmbeddedDocuments("ActiveEffect", datas);
    // 把本剑式给的精通写成 flag（命中判定直接用，不依赖系统数据刷新/AE 计算）
    await actor.setFlag(JEDI_FLAG, "masteries", masteryVals).catch(() => {});
    await actor.setFlag(JEDI_FLAG, "stanceMastery", wantMastery ?? (masteryVals[0] ?? null)).catch(() => {});
    if (key === "IV") {
      const base = Number(actor.system.attributes.movement.walk ?? 30);
      await actor.setFlag(JEDI_FLAG, "walkBase", base);
      await actor.update({ "system.attributes.movement.walk": base * 2 });
    }
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: "<p><strong>光剑剑式 · " + jediStanceOptionLabel(key, wantMastery ?? masteryVals[0] ?? null) + "</strong></p><p>" + jediStanceText(key) + "</p>"
      });
    } catch (e) {}
    jediPlayStanceFx(jediActiveTokenFor(actor));
    return true;
  } catch (e) {
    console.warn("[fvtt-automation-repair] 应用剑式失败", e);
    return false;
  } finally {
    jediApplyLocks.delete(actor.id);
  }
}
globalThis.jediApplyStanceKey = jediApplyStanceKey;
globalThis.jediClearStances = jediClearStances;

// 是否该在这个客户端弹窗：
//  · GM：没有「在线的玩家所有者」时由 GM 代弹（否则交给玩家自己的客户端，避免两边各弹一次）
//  · 玩家：只有该角色的所有者才弹
function jediCanPrompt(actor) {
  if (!actor) return false;
  if (game.user.isGM) {
    const onlineOwner = game.users.some(u => !u.isGM && u.active && (actor.ownership?.[u.id] ?? 0) >= 3);
    return !onlineOwner;
  }
  return actor.isOwner;
}

const jediStanceLocks = new Map();
// 先攻 / 进入自己回合 / 使用回气 都会调用：弹出「选择或更换剑式」，可选「保持当前」
async function jediPromptStance(actor, opts = {}) {
  if (!actor) return;
  if (!jediCanPrompt(actor)) {
    console.log("[fvtt-automation-repair] 剑式弹窗跳过：本客户端无权限（角色所有者或 GM 才能收到）");
    return;
  }
  if (jediStanceLocks.get(actor.id)) return;
  jediStanceLocks.set(actor.id, true);
  try {
    const last = actor.flags?.[JEDI_FLAG]?.stancePromptAt ?? 0;
    if (!opts.force && Date.now() - last < 1500) return;
    await actor.setFlag(JEDI_FLAG, "stancePromptAt", Date.now()).catch(() => {});
    // 已禁用的旧残留顺手清掉（并还原被第四型翻倍的移速）
    if (actor.effects.some(e => e.flags?.[JEDI_FLAG]?.stance && e.disabled)) await jediClearStances(actor);
    const current = actor.effects.find(e => e.flags?.[JEDI_FLAG]?.stance && !e.disabled);
    const curKey = current ? current.flags?.[JEDI_FLAG]?.stance : null;
    const curMastery = actor.flags?.[JEDI_FLAG]?.stanceMastery ?? null;
    const t = globalThis.JF_TEST || {};
    let pick = t.stanceOnSecondWind ?? t.stanceOnTurn ?? t.stance ?? null;
    if (!pick) {
      const opt = (k, m) => {
        const val = m ? k + "|" + m : k;
        const isCur = (k === curKey && (m ?? null) === (curMastery ?? null));
        return '<option value="' + val + '"' + (isCur ? " selected" : "") + ">" + jediStanceOptionLabel(k, m) + (isCur ? " · 当前" : "") + "</option>";
      };
      let opts = "";
      for (const k of ["III", "IV", "V"]) for (const o of JEDI_STANCE_OPTIONS[k]) opts += opt(k, o.mastery);
      pick = await Dialog.prompt({
        title: curKey ? "更换光剑剑式" : "进入光剑剑式",
        content: "<p>" + (curKey
            ? "当前剑式：<strong>" + jediStanceOptionLabel(curKey, curMastery) + "</strong>。可保持不变或更换（每型剑式的精通二选一）："
            : "选择要进入的光剑剑式（每型剑式的精通二选一）：") + "</p>"
          + '<div class="form-group"><label>剑式</label><select name="stance">'
          + (curKey ? '<option value="keep">保持当前 · ' + jediStanceOptionLabel(curKey, curMastery) + "</option>" : "")
          + opts
          + "</select></div>"
          + '<hr><p><strong>' + JEDI_STANCES.III.name + '</strong>：' + JEDI_STANCES.III.effects + '</p>'
          + '<p><strong>' + JEDI_STANCES.IV.name + '</strong>：' + JEDI_STANCES.IV.effects + '</p>'
          + '<p><strong>' + JEDI_STANCES.V.name + '</strong>：' + JEDI_STANCES.V.effects + '</p>',
        label: curKey ? "确定" : "进入",
        callback: (html) => (html instanceof HTMLElement ? html : html[0]).querySelector('[name="stance"]').value,
        rejectClose: false
      });
    }
    if (!pick || pick === "keep") return;
    const parts = String(pick).split("|");
    const key = parts[0] || null;
    const mastery = parts[1] || null;
    if (!key) return;
    if (key === curKey && (mastery ?? null) === (curMastery ?? null)) return;
    await jediApplyStanceKey(actor, key, { mastery: mastery });
  } finally {
    jediStanceLocks.delete(actor.id);
  }
}
globalThis.jediPromptStance = jediPromptStance;

// 回气：恢复 1 枚原力骰（每次回气只恢复一次）
const jediForceRegainLocks = new Map();
async function jediRestoreForceDie(actor) {
  if (!actor) return null;
  const force = actor.items.find(i => i.system?.identifier === "force-harmony");
  if (!force) return null;
  const spent = Number(force.system?.uses?.spent ?? 0);
  const max = Number(force.system?.uses?.max ?? 4);
  if (spent <= 0) {
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: "<p><strong>回气</strong>：原力骰已满（" + (max - spent) + "/" + max + "），未恢复。</p>" });
    return { before: spent, after: spent, restored: false };
  }
  const after = spent - 1;
  await force.update({ "system.uses.spent": after });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "<p><strong>回气</strong>：恢复 <strong>1</strong> 枚原力骰（剩余 " + (max - after) + "/" + max + "）。</p>"
  });
  return { before: spent, after: after, restored: true };
}
globalThis.jediRestoreForceDie = jediRestoreForceDie;

// ---------- 休息恢复原力骰：短休 +1 枚，长休恢复全部 ----------
// 用「休息前的已花费数量」算目标值（幂等：即使钩子/系统各跑一次也不会多恢复）
const jediRestBefore = new Map();
repairHook("dnd5e.preRestCompleted", (actor, result) => {
  try {
    if (!actor) return;
    const f = actor.items?.find?.(i => i.system?.identifier === "force-harmony");
    if (!f) return;
    jediRestBefore.set(actor.id, {
      spent: Number(f.system?.uses?.spent ?? 0),
      long: !!(result?.longRest === true || result?.type === "long")
    });
  } catch (e) {}
});
repairHook("dnd5e.restCompleted", async (actor, result) => {
  try {
    if (!actor) return;
    if (!actor.items.some(i => i.type === "subclass" && i.flags?.[JEDI_FLAG]?.pack === JEDI_PACK)) return;
    const force = actor.items.find(i => i.system?.identifier === "force-harmony");
    if (!force) return;
    const rec = jediRestBefore.get(actor.id);
    jediRestBefore.delete(actor.id);
    const isLong = rec ? rec.long : !!(result?.longRest === true || result?.type === "long");
    const before = rec ? rec.spent : Number(force.system?.uses?.spent ?? 0);
    const max = Number(force.system?.uses?.max ?? 4);
    const target = isLong ? 0 : Math.max(0, before - 1);
    const cur = Number(force.system?.uses?.spent ?? 0);
    if (before <= 0 && cur <= 0) return;
    if (cur !== target) await force.update({ "system.uses.spent": target });
    const restored = Math.max(0, before - target);
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: "<p><strong>" + (isLong ? "长休" : "短休") + "</strong>：恢复 <strong>" + (isLong ? (max - target) : restored) + "</strong> 枚原力骰（剩余 " + (max - target) + "/" + max + "）。</p>"
      });
    } catch (e) {}
  } catch (e) { console.warn("[fvtt-automation-repair] 休息恢复原力骰失败", e); }
});

function jediSecondWindHook(source) {
  try {
    const item = source?.item ?? source;
    const actor = item?.actor;
    if (!actor) return;
    const ident = String(item.system?.identifier ?? "");
    const isSecondWind = ident === "secondWind" || ident === "second-wind" || /回气|second[\s-]*wind/i.test(item.name ?? "");
    if (!isSecondWind) return;
    if (!actor.items.some(i => i.type === "subclass" && i.flags?.[JEDI_FLAG]?.pack === JEDI_PACK)) return;
    // preUseActivity 与 preUseItem 会在同一瞬间先后触发，用内存锁保证一次回气只恢复一枚
    const now = Date.now();
    if (now - (jediForceRegainLocks.get(actor.id) ?? 0) > 2000) {
      jediForceRegainLocks.set(actor.id, now);
      jediRestoreForceDie(actor).catch(console.error);
    }
    jediPromptStance(actor).catch(console.error);
  } catch (e) { console.warn("[fvtt-automation-repair] 回气处理失败", e); }
}
repairHook("dnd5e.preUseActivity", (activity) => jediSecondWindHook(activity));
repairHook("dnd5e.preUseItem", (item) => jediSecondWindHook(item));
repairHook("combatStart", (combat) => {
  try {
    for (const c of combat.combatants) {
      const actor = c.actor;
      if (!actor) continue;
      if (!actor.items.some(i => i.type === "subclass" && i.flags?.[JEDI_FLAG]?.pack === JEDI_PACK)) continue;
      jediPromptStance(actor).catch(console.error);
    }
  } catch (e) { console.error(e); }
});
repairHook("updateCombat", (combat, changes) => {
  try {
    if (!("turn" in changes) && !("round" in changes)) return;
    const actor = combat.combatant?.actor;
    if (!actor) return;
    if (!actor.items.some(i => i.type === "subclass" && i.flags?.[JEDI_FLAG]?.pack === JEDI_PACK)) return;
    if (actor.flags?.[JEDI_FLAG]?.moved10) actor.unsetFlag(JEDI_FLAG, "moved10").catch(() => {});
    jediPromptStance(actor).catch(console.error);
  } catch (e) { console.error(e); }
});

function jediIsActiveSaberWorkflow(workflow) {
  const actor = workflow?.actor, item = workflow?.item;
  if (!actor || item?.type !== "weapon" || workflow.aborted) return false;
  if (!actor.items?.some(i => i.type === "subclass" && i.flags?.[JEDI_FLAG]?.pack === JEDI_PACK)) return false;
  const saber = actor.flags?.[JEDI_FLAG]?.saber;
  return saber?.lit === true && saber.itemId === item.id && !!item.flags?.[JEDI_FLAG]?.original;
}
globalThis.jediIsActiveSaberWorkflow = jediIsActiveSaberWorkflow;

// ---------- 光剑挥砍特效（挥剑 + 能量圈 + psfx 音效） ----------
repairHook("midi-qol.preAttackRoll", (workflow) => {
  try {
    if (!jediIsActiveSaberWorkflow(workflow)) return;
    // GM 代打时 workflow.token 可能为空，回退到角色自己的 token
    const token = workflow.token ?? workflow.actor?.getActiveTokens?.()[0] ?? null;
    jediPlayAttackFx(token);
  } catch (e) { console.warn("[fvtt-automation-repair] jedi attack anim", e); }
});

// ---------- 武器精通：擦掠 Graze（未命中仍造成属性调整值伤害） ----------
// dnd5e 5.1 只提供精通的定义，不自动结算；midi-qol 也不处理 graze
function jediMasteryList(actor, item) {
  const set = new Set();
  // 剑式的精通是「二选一」：只要记了 stanceMastery 就只认它（旧的重复 AE 也不会让两个精通同时生效）
  const chosen = actor?.flags?.[JEDI_FLAG]?.stanceMastery;
  if (chosen) {
    set.add(chosen);
  } else {
    const fromFlag = actor?.flags?.[JEDI_FLAG]?.masteries;
    if (Array.isArray(fromFlag)) for (const m of fromFlag) set.add(m);
    for (const b of actor?.system?.traits?.weaponProf?.mastery?.bonus ?? []) set.add(b);
    // 兜底：直接从「启用中」的 AE 里取
    for (const e of actor?.effects ?? []) {
      if (e.disabled) continue;
      for (const c of (e.changes ?? [])) {
        if (String(c.key ?? "").indexOf("mastery.bonus") >= 0 && c.value) set.add(String(c.value));
      }
    }
  }
  // 武器自带的精通（如刺剑的 vex）照常计入（不触发我们的 sap/push/topple/nick 逻辑）
  if (item?.system?.mastery) set.add(item.system.mastery);
  return [...set];
}
function jediAttackAbilityKey(workflow, item) {
  let key = null;
  const ab = workflow?.attackAbility;
  if (ab instanceof Set) key = [...ab][0] ?? null;
  else if (Array.isArray(ab)) key = ab[0] ?? null;
  else if (typeof ab === "string") key = ab;
  if (!key) {
    const actor = workflow?.actor;
    const fin = [...(item?.system?.properties ?? [])].includes("fin");
    const str = Number(actor?.system?.abilities?.str?.mod ?? 0);
    const dex = Number(actor?.system?.abilities?.dex?.mod ?? 0);
    key = fin && dex > str ? "dex" : "str";
  }
  return key;
}
repairHook("midi-qol.hitsChecked", async (workflow) => {
  try {
    if (!workflow || workflow.aborted) return;
    if (workflow.hitTargets?.size) {
      if (jediIsActiveSaberWorkflow(workflow)) jediPlayImpactSound();
      await jediApplyMasteryHits(workflow);
      return;
    }
    await jediApplyGraze(workflow, { silent: false });
  } catch (e) { console.warn("[fvtt-automation-repair] 擦掠结算失败", e); }
});
// 单独暴露：便于测试或 GM 手动补结算
async function jediApplyGraze(workflow, opts = {}) {
  const item = workflow?.item;
  if (!item || item.type !== "weapon") return false;
  if (workflow.jediGrazeDone) return false;
  const actor = workflow.actor;
  if (!actor) return false;
  if (!jediMasteryList(actor, item).includes("graze")) return false;
  const missed = [...(workflow.targets ?? [])].filter(t => !workflow.hitTargets?.has(t));
  if (!missed.length) return false;
  const key = jediAttackAbilityKey(workflow, item);
  const mod = Number(actor.system?.abilities?.[key]?.mod ?? 0);
  if (mod <= 0) return false;
  workflow.jediGrazeDone = true;
  const dmgType = [...(item.system?.damage?.base?.types ?? [])][0] ?? "slashing";
  let applied = false;
  try {
    if (globalThis.MidiQOL?.applyTokenDamage) {
      await globalThis.MidiQOL.applyTokenDamage([{ value: mod, type: dmgType }], mod, new Set(missed), item, new Set(), { workflow });
      applied = true;
    }
  } catch (e) { console.warn("[fvtt-automation-repair] 擦掠（midi 结算）失败，改用原生", e); }
  if (!applied) {
    for (const t of missed) {
      try { await t.actor?.applyDamage([{ value: mod, type: dmgType }]); }
      catch (e) { console.warn("[fvtt-automation-repair] 擦掠伤害失败", e); }
    }
  }
  if (!opts.silent) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: "<p><strong>擦掠 Graze</strong>：未命中，仍对 " + missed.map(t => t.name).join("、") + " 造成 <strong>" + mod + "</strong> 点 " + dmgType + " 伤害。</p>"
    });
  }
  return true;
}
globalThis.jediApplyGraze = jediApplyGraze;

// ---------- 武器精通自动化：削弱 Sap / 推离 Push / 失衡 Topple / 迅击 Nick ----------
// dnd5e 5.1 只有定义、不结算；CPR 也只处理武器自带 mastery。这里在攻击命中后统一处理。
function jediMasteryDC(actor, item) {
  const prof = Number(actor?.system?.attributes?.prof ?? 2);
  const key = jediAttackAbilityKey({ actor: actor }, item);
  const mod = Number(actor?.system?.abilities?.[key]?.mod ?? 0);
  return 8 + prof + mod;
}
async function jediMoveTokenAway(fromToken, toToken, feet) {
  if (!fromToken || !toToken || !canvas?.scene) return false;
  try {
    const src = fromToken.center ?? { x: fromToken.document.x, y: fromToken.document.y };
    const dst = toToken.center ?? { x: toToken.document.x, y: toToken.document.y };
    const dx = dst.x - src.x, dy = dst.y - src.y;
    const len = Math.hypot(dx, dy) || 1;
    const gridDist = Number(canvas.scene.grid?.distance) || 5;
    const gridSize = Number(canvas.scene.grid?.size) || 100;
    const px = (feet / gridDist) * gridSize;
    const x = Math.round(toToken.document.x + (dx / len) * px);
    const y = Math.round(toToken.document.y + (dy / len) * px);
    await canvas.scene.updateEmbeddedDocuments("Token", [{ _id: toToken.document.id, x: x, y: y }]);
    return true;
  } catch (e) { console.warn("[fvtt-automation-repair] 推离位移失败", e); return false; }
}
async function jediApplyMasteryHits(workflow) {
  if (!workflow || workflow.aborted) return false;
  if (workflow.jediMasteryDone) return false;
  const item = workflow.item;
  if (!item || item.type !== "weapon") return false;
  const actor = workflow.actor;
  if (!actor) return false;
  const hits = [...(workflow.hitTargets ?? [])];
  if (!hits.length) return false;
  const masteries = jediMasteryList(actor, item);
  const notes = [];
  workflow.jediMasteryDone = true;
  console.log("[fvtt-automation-repair] 武器精通检查", {
    item: item.name, itemType: item.type, actor: actor.name, hits: hits.length, masteries: masteries,
    dbgFlag: actor?.flags?.[JEDI_FLAG]?.masteries ?? null,
    dbgBonus: [...(actor?.system?.traits?.weaponProf?.mastery?.bonus ?? [])],
    dbgFlagRoot: Object.keys(actor?.flags ?? {}).slice(0, 6)
  });
  // 削弱 Sap：目标下一次攻击检定劣势
  if (masteries.includes("sap")) {
    for (const t of hits) {
      try {
        await t.actor?.createEmbeddedDocuments("ActiveEffect", [{
          name: "削弱 Sap",
          img: item.img,
          origin: item.uuid,
          transfer: false,
          disabled: false,
          duration: { rounds: 1 },
          description: "<p>削弱：下一次攻击检定有劣势（攻击后自动消失）。</p>",
          changes: [{ key: "flags.midi-qol.disadvantage.attack.all", mode: 5, value: "true" }],
          flags: { [JEDI_FLAG]: { sap: true }, dae: { specialDuration: ["1Attack"] } }
        }]);
      } catch (e) { console.warn("[fvtt-automation-repair] 削弱 AE 失败", e); }
    }
    notes.push("削弱 Sap：目标下一次攻击检定有劣势（攻击后消失）");
  }
  // 推离 Push：命中后推开 10 尺
  if (masteries.includes("push")) {
    let moved = 0;
    for (const t of hits) { if (await jediMoveTokenAway(workflow.token, t, 10)) moved++; }
    if (moved) notes.push("推离 Push：" + moved + " 个目标被推开 10 尺");
  }
  // 失衡 Topple：力量豁免失败则倒地
  if (masteries.includes("topple")) {
    const dc = jediMasteryDC(actor, item);
    for (const t of hits) {
      try {
        // 自己掷豁免（midi 包装过的 rollSavingThrow 拿不到结果），并生成一张可读的豁免卡
        const ab = t.actor.system?.abilities?.str ?? {};
        const prof = Number(t.actor.system?.attributes?.prof ?? 2);
        const mod = Number(ab.mod ?? 0) + (Number(ab.save ?? 0) >= 1 ? prof : 0);
        const roll = await new Roll("1d20 + " + mod).evaluate();
        const total = roll.total;
        try {
          await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: t.actor }),
            flavor: "力量豁免 vs DC " + dc + "（失衡 Topple）"
          });
        } catch (e) {}
        const ok = (total >= dc);
        notes.push("失衡 Topple：" + t.name + " 力量豁免 " + total + " vs DC " + dc + (ok ? "（成功）" : "（失败 → 倒地）"));
        if (!ok) {
          try { await t.actor.toggleStatusEffect("prone", { active: true }); }
          catch (e) { console.warn("[fvtt-automation-repair] 倒地状态失败", e); }
        }
      } catch (e) { console.warn("[fvtt-automation-repair] 失衡豁免失败", e); }
    }
  }
  // 迅击 Nick：命中后可再攻击一次（每轮一次）
  if (masteries.includes("nick")) {
    const combat = game.combat;
    const tag = combat ? combat.id + ":" + combat.round : "noround";
    if (actor.flags?.[JEDI_FLAG]?.nickRound !== tag) {
      // workflow.item 是 dnd5e 克隆的临时对象（没有 parent），追击必须用角色身上的真实 item
      const realItem = actor.items.get(item.id) ?? actor.items.find(i => i.name === item.name);
      const act = realItem?.system?.activities?.find(a => a.type === "attack");
      if (!act) {
        notes.push("迅击 Nick：找不到攻击活动，未能追加");
      } else {
        // 提前保存本次攻击目标，避免结算后界面目标被清空或改选
        const targets = [...(workflow.targets ?? [])];
        const uuids = [...new Set((targets.length ? targets : [...(workflow.hitTargets ?? [])])
          .map(t => t?.document?.uuid ?? t?.uuid).filter(u => typeof u === "string" && u.trim()))];
        // 与破势反击相同的做法：等本工作流 RollComplete 后再发起（midi 不允许嵌套）
        Hooks.once("midi-qol.RollComplete", async () => {
          try {
            let use = globalThis.JF_TEST?.nick;
            if (use === undefined) {
              use = await Dialog.wait({
                title: "迅击 Nick",
                content: "<p>本次攻击命中。是否用 <strong>迅击</strong> 再攻击一次？（不占用附赠动作，每轮一次）</p>",
                buttons: {
                  yes: { label: "再打一次", callback: () => true },
                  no: { label: "不用", callback: () => false }
                },
                default: "no", close: () => false, rejectClose: false
              });
            }
            if (!use) return;
            await new Promise(r => setTimeout(r, 200));
            const tokens = [];
            for (const uuid of uuids) {
              const doc = await fromUuid(uuid);
              const token = doc?.object ?? doc;
              if (typeof token?.setTarget === "function") tokens.push(token);
            }
            if (!tokens.length) {
              console.warn("[fvtt-automation-repair] 迅击：找不到上一次攻击的目标", uuids);
              ui.notifications.warn("迅击：找不到上一次攻击的目标");
              return;
            }
            // 确认等待期间可能已使用迅击，发起前再次检查
            if (actor.flags?.[JEDI_FLAG]?.nickRound === tag) return;
            for (const token of [...game.user.targets]) token.setTarget(false, { releaseOthers: false, user: game.user });
            for (const token of tokens) token.setTarget(true, { releaseOthers: false, user: game.user });
            const usage = {
              midiOptions: {
                targetUuids: tokens.map(t => t.document?.uuid ?? t.uuid),
                targetsToUse: new Set(tokens),
                workflowOptions: { targetConfirmation: "none" }
              }
            };
            await actor.setFlag(JEDI_FLAG, "nickRound", tag);
            console.log("[fvtt-automation-repair] 迅击：发起追击攻击");
            await act.use(usage, { configure: false });
            console.log("[fvtt-automation-repair] 迅击：追击完成");
          } catch (e) { console.warn("[fvtt-automation-repair] 迅击追击失败", e); }
        });
        notes.push("迅击 Nick：命中后可在本工作流结束时再攻击一次（会弹确认）");
      }
    }
  }
  if (notes.length) {
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: "<p><strong>武器精通</strong></p><ul>" + notes.map(n => "<li>" + n + "</li>").join("") + "</ul>"
      });
    } catch (e) {}
  }
  return notes.length > 0;
}
globalThis.jediApplyMasteryHits = jediApplyMasteryHits;

// ---------- 迁移（旧物品数据 -> 新数据） ----------
export async function jediMigrateItems(actors=game.actors) {
  let pack = game.packs.get("mystic-weapon-pack.items");
  if (!pack) { await new Promise(r => setTimeout(r, 1500)); pack = game.packs.get("mystic-weapon-pack.items"); }
  if (!pack) { console.warn("[fvtt-automation-repair] 找不到物品包，跳过绝地武士迁移"); return 0; }
  const idx = await pack.getIndex();
  const canon = {};
  for (const e of idx) {
    const doc = await pack.getDocument(e._id);
    const ident = doc.system?.identifier;
    if (ident) canon[ident] = doc;
  }
  const jobs = [];
  // 隔空御剑伤害：武器骰（+属性调整值）+ 1d8，与 ignite 的算法保持一致
  function jediThrowParts(w) {
    if (!w) return null;
    const d = w.system?.damage?.base;
    if (!d) return null;
    const actor = w.actor;
    const strMod = Number(actor?.system?.abilities?.str?.mod ?? 0);
    const dexMod = Number(actor?.system?.abilities?.dex?.mod ?? 0);
    const fin = [...(w.system.properties ?? [])].includes("fin");
    const abilKey = fin && dexMod > strMod ? "dex" : "str";
    const bonusParts = [];
    if (d.bonus) bonusParts.push(d.bonus);
    bonusParts.push("@abilities." + abilKey + ".mod");
    // 魔法武器的伤害加值（+1 之类）也计入
    const magic = Number(w.system?.magicalBonus ?? 0);
    if (magic > 0) bonusParts.push(String(magic));
    const types = [...(w.system.damage.base.types ?? [])];
    const dmgType = types[0] || "radiant";
    return [
      { number: d.number || 1, denomination: d.denomination || 8, bonus: bonusParts.join(" + "), types: [dmgType], custom: { enabled: false } },
      { number: 1, denomination: 8, bonus: "", types: [dmgType], custom: { enabled: false } }
    ];
  }
  function sameParts(a, b) {
    const norm = (parts) => JSON.stringify((parts ?? []).map(p => [p.number, p.denomination, p.bonus ?? "", [...(p.types ?? [])]]));
    return norm(a) === norm(b);
  }

  for (const actor of actors) {
    const saberWeapon = (() => {
      const fl = actor.flags?.[JEDI_FLAG]?.saber;
      return fl?.itemId ? actor.items.get(fl.itemId) : null;
    })();
    for (const it of actor.items) {
      const ident = it.system?.identifier;
      const src = ident && canon[ident];
      if (src?.flags?.["chris-premades"]?.embeddedMacros) {
        const next = src.flags["chris-premades"].embeddedMacros;
        if (JSON.stringify(it.flags?.["chris-premades"]?.embeddedMacros) !== JSON.stringify(next)) {
          jobs.push(it.update({ "flags.chris-premades.embeddedMacros": next }));
        }
      }
      if (ident === "force-harmony") {
        const upd = {};
        for (const act of it.system.activities) {
          const isPush = act.name === "原力控物·推斥" || act.name === "原力控物·牵引";
          const isThrow = act.name === "隔空御剑";
          if (!isPush && !isThrow) continue;
          const p = "system.activities." + act.id + ".";
          if (act.target?.affects?.type !== "creature") upd[p + "target.affects.type"] = "creature";
          if ((act.target?.affects?.count ?? "") !== "") upd[p + "target.affects.count"] = "";
          if (isThrow) {
            if (act.target?.template?.type !== "line") {
              upd[p + "target.template.type"] = "line";
              upd[p + "target.template.size"] = "30";
              upd[p + "target.template.width"] = "5";
            }
            if (act.target?.prompt !== true) upd[p + "target.prompt"] = true;
            if (act.target?.override !== true) upd[p + "target.override"] = true;
            const want = jediThrowParts(saberWeapon ?? actor.items.find(i => i.type === "weapon" && i.flags?.[JEDI_FLAG]?.original));
            if (want && !sameParts(act.damage?.parts, want)) upd[p + "damage.parts"] = want;
          }
        }
        if (Object.keys(upd).length) jobs.push(it.update(upd));
        const oldProf = it.system.activities.find(a => a.name === "原力共情·熟练");
        if (oldProf) jobs.push(oldProf.delete());
      }
    }
    // 旧版 disabled 剑式 AE / 被第四型翻倍却没还原的移速 / moved10 残留
    const hasStanceJunk = actor.effects.some(e => e.flags?.[JEDI_FLAG]?.stance && e.disabled);
    const hasActiveStance = actor.effects.some(e => e.flags?.[JEDI_FLAG]?.stance && !e.disabled);
    // 注意：第四型正常也会写 walkBase，不能当成垃圾清掉（否则会把刚应用的剑式一起删了）
    const hasWalkJunk = !hasActiveStance && actor.flags?.[JEDI_FLAG]?.walkBase !== undefined && actor.flags?.[JEDI_FLAG]?.walkBase !== null;
    if (hasStanceJunk || hasWalkJunk) jobs.push(jediClearStances(actor).catch(() => null));
    // 旧版会把同一剑式的两个精通都挂上（迅击+推离）：只保留一个（按 stanceMastery 或第一条重挂）
    const stanceList = actor.effects.filter(e => e.flags?.[JEDI_FLAG]?.stance && !e.disabled);
    const stanceKeys = {};
    for (const e of stanceList) {
      const k = String(e.flags?.[JEDI_FLAG]?.stance ?? "");
      if (k) stanceKeys[k] = (stanceKeys[k] ?? 0) + 1;
    }
    const dupStance = Object.keys(stanceKeys).find(k => stanceKeys[k] > 1);
    if (dupStance) {
      const sm = actor.flags?.[JEDI_FLAG]?.stanceMastery ?? null;
      jobs.push((async () => {
        await jediClearStances(actor);
        await jediApplyStanceKey(actor, dupStance, { mastery: sm });
      })().catch(() => null));
    }
    // Movement earned during the current turn is game state, not migration data.
    // 点亮中的光剑：AA/UA 动画抑制 + 灵巧 + UA 原始值记录
    const w = saberWeapon;
    if (w) {
      const orig = w.flags?.[JEDI_FLAG]?.original;
      const props = [...w.system.properties];
      const upd = {};
      if (orig?.properties?.includes("fin") && !props.includes("fin")) upd["system.properties"] = [...props, "fin"];
      const aa = w.flags?.autoanimations ?? {};
      if (aa.killAnim !== true || aa.isEnabled !== false || aa.version !== 5) {
        upd["flags.autoanimations"] = { ...aa, version: 5, isEnabled: false, isCustomized: false, fromAmmo: false, killAnim: true };
      }
      // only touch the universalAnimations scope when that module is actually active
      // (v13 rejects/ignores updates to unregistered flag scopes)
      const uaActive = !!game.modules.get("universal-animations")?.active;
      if (uaActive && w.flags?.universalAnimations?.override !== "neverPlay") {
        upd["flags.universalAnimations"] = { ...(w.flags?.universalAnimations ?? {}), override: "neverPlay" };
      }
      if (Object.keys(upd).length) jobs.push(w.update(upd));
      if (uaActive && orig && orig.ua === undefined) {
        jobs.push(w.setFlag(JEDI_FLAG, "original", { ...orig, ua: null }).catch(() => null));
      }
    }
    const hasForce = actor.items.some(i => i.system?.identifier === "force-harmony");
    const empAEs = actor.effects.filter(e => e.flags?.[JEDI_FLAG]?.empathyProf);
    if (hasForce && empAEs.length > 1) {
      // 旧版/并发写出来的重复「原力共情」AE：归并成一条
      const keep = actor.flags?.[JEDI_FLAG]?.empathyProf ?? empAEs[0].flags?.[JEDI_FLAG]?.empathyProf ?? "ins";
      jobs.push(jediEnsureEmpathyProf(actor, { skill: keep }).catch(() => null));
    } else if (hasForce && !empAEs.length && !actor.flags?.[JEDI_FLAG]?.empathyProf) {
      // 从没选过：GM 端直接补默认「洞悉」，避免新角色一直没熟练（玩家可让 GM 改成游说）
      jobs.push(jediEnsureEmpathyProf(actor, { skill: "ins" }).catch(() => null));
    }
  }
  await Promise.all(jobs);
  return jobs.length;
}
globalThis.jediMigrateItems = jediMigrateItems;
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  try { const n = await jediMigrateItems(); console.log("[fvtt-automation-repair] 绝地武士迁移完成，更新 " + n + " 项"); }
  catch (e) { console.error("[fvtt-automation-repair] 绝地武士迁移失败", e); }
});

// ---------- 破势反击 / 阿塔鲁 伤害宏 ----------
const JEDI_DMG_CODE = [
  'if (!workflow || !workflow.item) return;',
  'const a = workflow.actor;',
  'const fl = a?.flags?.["fvtt-automation-repair"];',
  'if (!fl) return;',
  'const item = workflow.item;',
  'const types = [...(item.system?.damage?.base?.types ?? [])];',
  'const isSaber = item.type === "weapon" && (item.flags?.["fvtt-automation-repair"]?.original || types.some(t => t === "radiant" || t === "force"));',
  'if (!isSaber) return;',
  'const parts = [];',
  'if (fl.riposte) { parts.push("1d8"); await a.unsetFlag("fvtt-automation-repair", "riposte"); }',
  'if (a.effects.some(e => e.flags?.["fvtt-automation-repair"]?.stance === "IV") && fl.moved10) { parts.push(String(a.system.abilities.wis.mod ?? 0)); await a.unsetFlag("fvtt-automation-repair", "moved10"); }',
  'if (parts.length === 0) return;',
  'const r = new Roll(parts.join(" + "), item.getRollData());',
  'await r.evaluate();',
  'return r;'
].join("\n");
registerMacro('MWP-JediSaberBonus',JEDI_DMG_CODE);
Hooks.once("ready", async () => {
  if (!game.user.isGM || game.users.activeGM?.id!==game.user.id) return;
  try {
    const ex = game.macros.find(m => m.name === "MWP-JediSaberBonus");
    const command=macroStub('MWP-JediSaberBonus');
    if (ex) { if ((ex.command ?? "") !== command||ex.ownership.default!==3) await ex.update({command,'ownership.default':3}); }
    else await Macro.create({ name: "MWP-JediSaberBonus", type: "script", command, ownership: { default: 3 } });
  } catch (e) { console.error("[fvtt-automation-repair] 破势反击宏创建失败", e); }
});

// ---------- 玩家登录时确认原力共情熟练（GM 端不弹，避免代选） ----------
Hooks.once("ready", () => {
  if (game.user.isGM) return;
  setTimeout(async () => {
    for (const actor of game.actors) {
      if (!actor.isOwner || !actor.hasPlayerOwner) continue;
      if (!actor.items.some(i => i.system?.identifier === "force-harmony")) continue;
      try { await jediEnsureEmpathyProf(actor); } catch (e) { console.warn("[fvtt-automation-repair] 原力共情选择失败", e); }
    }
  }, 2500);
});

globalThis.jediSubclassSync = async () => {
  const actor = game.actors.get(game.user.character?.id ?? "");
  return "对角色拖入子职即可自动授予；已有子职角色可用 globalThis.jediEnsureEmpathyProf(actor) 补原力共情熟练";
};
