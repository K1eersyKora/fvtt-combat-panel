/* fvtt-combat-panel —— 预测显示策略（纯策略层：不渲染、不取数、不写文档）
 *
 * 把「命中/豁免概率」与「伤害预测」两类数值的可见性收敛成一条可测试的策略：
 *   world 设置（DM 独占写，restricted）：
 *     predictionProbability / predictionDamage = "off" | "gm" | "all"
 *   client 设置（每个客户端自己的偏好，可以是玩家也可以是 DM）：
 *     hidePredictionProbability / hidePredictionDamage = true | false
 *   getPredictionPolicy(user) -> { probability: boolean, damage: boolean }
 *
 * 语义：
 *   off = 任何人都不显示（包括 DM）
 *   gm  = 只有 DM 显示（User#isGM 为真，即 GAMEMASTER 角色；助理 GM 视为非 DM）
 *   all = DM 与玩家都显示
 *   client 隐藏项只能把已允许的 true 再减成 false，永远不能扩大权限。
 *   非法的世界设置值按 "gm" 处理（只会收紧，不会放宽到 all）。
 *
 * 边界（对外说明时必须保留，不要改写）：
 *   1) 这里是「显示策略」，不是数据边界。客户端已收到的 actor/token/效果文档不会因为本函数返回 false
 *      而消失；模块脚本是静态 ES module，任何登录用户都能自行 import 并调用预测函数。因此它只防
 *      “无意识地看 UI 推断”，不保护已下发的底层文档，也不能宣称保护了。
 *   2) 本文件不注册 socket、不广播、不写任何文档。
 *   3) 跨客户端实时刷新：世界设置是 Foundry 的 Setting 世界文档，服务端 modifyDocument 会广播给所有
 *      客户端，Setting#_onUpdate 会跑 onChange。但本工作区曾实测到“其他客户端读不到新值”
 *      （fvtt-workspace-ops §6 #30），两者矛盾且本次不允许操作世界复测。因此：调用方不得缓存策略，
 *      每次渲染都重新调用 getPredictionPolicy()；需要主动刷新时调 refreshPredictionPolicy()
 *      触发模块 Hook。不要假定实时同步一定生效，也不要为此擅自加 socket 架构。
 *
 * 依赖：只在函数内部访问 globalThis.game / globalThis.Hooks，导入本文件没有副作用，
 *       可直接在 Node 里 import 做纯函数测试（见 tools/ui/test-panel-policy-156.mjs）。
 */

export const POLICY_MODULE_ID = "fvtt-combat-panel";

/** 策略变化时在本地触发的模块专用 Hook；payload 就是 {probability, damage}。 */
export const PREDICTION_POLICY_HOOK = "fvtt-combat-panel.predictionPolicyChanged";

/** 允许的世界设置取值（顺序即设置界面的顺序）。 */
export const PREDICTION_MODES = Object.freeze(["off", "gm", "all"]);

/** 世界设置下拉框标签。 */
export const PREDICTION_MODE_LABELS = Object.freeze({
  off: "关闭（谁都不显示）",
  gm: "仅 DM",
  all: "DM 与玩家"
});

/** 世界设置缺省值：DM 看得到，玩家默认看不到。 */
export const PREDICTION_DEFAULT_MODE = "gm";

/** 四个设置的 key（world 两个 + client 两个）。 */
export const PREDICTION_SETTING_KEYS = Object.freeze({
  probability: "predictionProbability",
  damage: "predictionDamage",
  hideProbability: "hidePredictionProbability",
  hideDamage: "hidePredictionDamage"
});

/* ------------------------------------------------------------------ */
/* 纯函数                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把任意读到的世界设置值收敛成合法取值。
 * 非法值（大写、空串、null、旧数据）一律回落到 "gm"：只会收紧权限，不会放宽成 "all"。
 * @param {*} value
 * @returns {"off"|"gm"|"all"}
 */
export function normalizePredictionMode(value) {
  return PREDICTION_MODES.includes(value) ? value : PREDICTION_DEFAULT_MODE;
}

/**
 * 某个世界设置取值是否允许该类用户看到。
 * @param {*} mode        off | gm | all
 * @param {boolean} isGM
 * @returns {boolean}
 */
export function predictionModeAllows(mode, isGM) {
  const value = normalizePredictionMode(mode);
  if (value === "all") return true;
  return value === "gm" && !!isGM;
}

/**
 * 纯策略计算：世界权限 AND 客户端隐藏（取反）。两个特性互不影响。
 * @param {object} input
 * @param {*} input.probabilityMode   world 设置 predictionProbability
 * @param {*} input.damageMode        world 设置 predictionDamage
 * @param {boolean} [input.hideProbability]  client 设置 hidePredictionProbability
 * @param {boolean} [input.hideDamage]       client 设置 hidePredictionDamage
 * @param {boolean} [input.isGM]
 * @returns {{probability: boolean, damage: boolean}}
 */
export function computePredictionPolicy({
  probabilityMode,
  damageMode,
  hideProbability = false,
  hideDamage = false,
  isGM = false
} = {}) {
  return {
    probability: predictionModeAllows(probabilityMode, isGM) && !hideProbability,
    damage: predictionModeAllows(damageMode, isGM) && !hideDamage
  };
}

/* ------------------------------------------------------------------ */
/* 运行时读取                                                          */
/* ------------------------------------------------------------------ */

function settingRead(key, fallback) {
  try {
    return globalThis.game?.settings?.get?.(POLICY_MODULE_ID, key) ?? fallback;
  } catch (err) {
    // 未注册 / 设置 API 不可用：一律按“关闭”处理，失败即收紧。
    return fallback;
  }
}

function userIsGM(user) {
  if (typeof user?.isGM === "boolean") return user.isGM;
  try {
    return !!user?.hasRole?.("GAMEMASTER");
  } catch (err) {
    return false;
  }
}

/**
 * 当前客户端的预测可见性。每次调用都重新读设置，不做任何缓存。
 * @param {object} [user=game.user]
 * @returns {{probability: boolean, damage: boolean}}
 */
export function getPredictionPolicy(user = globalThis.game?.user) {
  if (!globalThis.game?.settings?.get) return { probability: false, damage: false };
  return computePredictionPolicy({
    probabilityMode: settingRead(PREDICTION_SETTING_KEYS.probability, "off"),
    damageMode: settingRead(PREDICTION_SETTING_KEYS.damage, "off"),
    hideProbability: !!settingRead(PREDICTION_SETTING_KEYS.hideProbability, false),
    hideDamage: !!settingRead(PREDICTION_SETTING_KEYS.hideDamage, false),
    isGM: userIsGM(user)
  });
}

/**
 * 重新读取策略并触发模块专用 Hook（仅供 HUD 等消费者监听）。
 * 设置自身的 onChange 已经会触发；这个导出用于集合层/界面层主动刷新
 * （例如 ready 后、或调用方在 updateSetting 时补一次）。
 * @param {object} [user=game.user]
 * @returns {{probability: boolean, damage: boolean}}
 */
export function refreshPredictionPolicy(user = globalThis.game?.user) {
  const policy = getPredictionPolicy(user);
  try {
    globalThis.Hooks?.callAll?.(PREDICTION_POLICY_HOOK, policy);
  } catch (err) {
    console.warn(`[${POLICY_MODULE_ID}] 预测策略 Hook 触发失败`, err);
  }
  return policy;
}

/* ------------------------------------------------------------------ */
/* 注册                                                                */
/* ------------------------------------------------------------------ */

/**
 * 四个设置是否已全部注册（用于幂等判断）。
 * @returns {boolean}
 */
export function isPredictionSettingsRegistered() {
  const registered = globalThis.game?.settings?.settings;
  if (typeof registered?.has !== "function") return false;
  return Object.values(PREDICTION_SETTING_KEYS).every(key =>
    registered.has(`${POLICY_MODULE_ID}.${key}`)
  );
}

/**
 * 注册预测显示设置。必须在 Foundry `init` 阶段调用一次（可重复调用，重复调用是空操作）。
 * 没有设置 API 时返回 false（Node 测试环境即此路径），不会抛错。
 * @returns {boolean} 是否处于“已注册”状态
 */
export function registerPredictionSettings() {
  const settings = globalThis.game?.settings;
  if (typeof settings?.register !== "function") return false;
  if (isPredictionSettingsRegistered()) return true;

  const onChange = () => {
    try {
      refreshPredictionPolicy();
    } catch (err) {
      console.warn(`[${POLICY_MODULE_ID}] 预测策略刷新失败`, err);
    }
  };

  try {
    settings.register(POLICY_MODULE_ID, PREDICTION_SETTING_KEYS.probability, {
      name: "预测：命中 / 豁免失败概率",
      hint: "显示拖拽瞄准时对目标计算出的命中率或目标豁免失败率。off=谁都不显示，仅 DM=只有 GM 能看到，DM 与玩家=所有人可见。",
      scope: "world",
      config: true,
      restricted: true,
      type: String,
      choices: { ...PREDICTION_MODE_LABELS },
      default: PREDICTION_DEFAULT_MODE,
      onChange
    });

    settings.register(POLICY_MODULE_ID, PREDICTION_SETTING_KEYS.damage, {
      name: "预测：基础平均伤害",
      hint: "显示基础平均伤害（对伤害公式逐段求平均后相加），不计命中、豁免和目标减伤，也不含暴击与命中后附加骰。与概率开关相互独立。",
      scope: "world",
      config: true,
      restricted: true,
      type: String,
      choices: { ...PREDICTION_MODE_LABELS },
      default: PREDICTION_DEFAULT_MODE,
      onChange
    });

    settings.register(POLICY_MODULE_ID, PREDICTION_SETTING_KEYS.hideProbability, {
      name: "在本客户端隐藏预测概率",
      hint: "只影响你自己这一台客户端，且只会在 GM 已允许的前提下把概率隐藏掉；无法用它看到 GM 未开放的内容。",
      scope: "client",
      config: true,
      type: Boolean,
      default: false,
      onChange
    });

    settings.register(POLICY_MODULE_ID, PREDICTION_SETTING_KEYS.hideDamage, {
      name: "在本客户端隐藏伤害预测",
      hint: "只影响你自己这一台客户端，且只会在 GM 已允许的前提下把伤害数字隐藏掉；无法用它看到 GM 未开放的内容。",
      scope: "client",
      config: true,
      type: Boolean,
      default: false,
      onChange
    });
  } catch (err) {
    console.error(`[${POLICY_MODULE_ID}] 预测设置注册失败`, err);
    return false;
  }
  return true;
}
