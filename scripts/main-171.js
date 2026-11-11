import { tacticsView, tacticsTokenAt, tacticsBounds } from './targeting-view-165.js';
import "./reaction-163.js";
import { ActionState } from "./action-state-162.js";
import { BottomHUD } from "./hud-171.js";
import { getPredictionPolicy, registerPredictionSettings, refreshPredictionPolicy } from './prediction-policy-156.js';
Hooks.once('init',registerPredictionSettings);
Hooks.once('ready',refreshPredictionPolicy);
import { workflowAttackPreview } from "./workflow-preview-147.js";
import { computePreview, formulaDistribution, discoverPredictionRules, predictionModuleInventory } from "./prediction-147.js";
import { resourceMeta, usesLeft, isTransferActivity } from "./feature-core-147.js";
import { registerFeatureHooks } from "./feature-hooks-147.js";
import { matchAttackSpells } from "./attack-spell-automation-170.js";

/* fvtt-combat-panel v0.12.14
 * Token 旁战斗面板：
 *   右侧：动作/附赠/反应/专注图标（BG3 HUD 风格，尺寸收紧、贴 token 右缘）
 *   左侧：装备/特性/法术菜单，从右向左展开；法术先分环位（戏法/1 环/…），再列条目
 *   上方：AC 与内嵌数字的血量条（临时生命蓝色）
 * 屏幕空间固定尺寸，不随地图缩放；连线指向所属 Token。
 */
const MODULE_ID = "fvtt-combat-panel";
const VERSION = "0.12.14";
const HUD_TOOL = `${MODULE_ID}-hud`;

const CATEGORIES = [
  { id: "equipment", label: "装备", types: ["weapon", "equipment", "consumable", "loot", "container"] },
  { id: "features", label: "特性", types: ["feat", "class", "subclass", "race", "background"] },
  { id: "spells", label: "法术", types: ["spell"] }
];

const EQUIP_SUBS = [
  { id: "weapon", label: "武器", match: (item) => item.type === "weapon" },
  { id: "equipment", label: "装备", match: (item) => item.type === "equipment" && !["tool", "trinket"].includes(item.system?.type?.value ?? "") },
  { id: "consumable", label: "消耗品", match: (item) => item.type === "consumable" },
  { id: "tool", label: "工具", match: (item) => item.type === "equipment" && ["tool", "trinket"].includes(item.system?.type?.value ?? "") },
  { id: "loot", label: "战利品", match: (item) => ["loot", "container"].includes(item.type) }
];

const ACTIVATION_LABEL = {
  action: "动作",
  bonus: "附赠",
  reaction: "反应",
  reactiondamage: "反应",
  reactionmanual: "反应",
  reactionpreattack: "反应",
  legendary: "传奇",
  lair: "巢穴",
  special: "特殊",
  hour: "小时",
  minute: "分钟",
  day: "天",
  long: "长时",
  none: ""
};

const FALLBACK_ICON = "icons/svg/item-bag.svg";

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.contents)) return value.contents;
  if (typeof value.values === "function") return Array.from(value.values());
  if (typeof value[Symbol.iterator] === "function") return Array.from(value);
  return [];
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

const RES_ICON = {
  action: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>`,
  bonus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 L21 21 L3 21 Z"/></svg>`,
  reaction: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L14.6 9.4 L22 12 L14.6 14.6 L12 22 L9.4 14.6 L2 12 L9.4 9.4 Z"/></svg>`
};

const CONC_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`;

function ensureStyles() {
  const marker = `${MODULE_ID}/styles/panel-150.css`;
  const loaded = Array.from(document.styleSheets ?? []).some((sheet) => !!sheet.href && sheet.href.includes(marker));
  if (loaded) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `modules/${marker}`;
  link.dataset.module = MODULE_ID;
  document.head.appendChild(link);
  console.log(`[${MODULE_ID}] CSS 未由 Foundry 加载，已手动注入`);
}

class CombatPanel {
  constructor() {
    this.token = null;
    this.actor = null;
    this.state = { category: null, spellLevel: null, equipSub: null, itemId: null, editMode: false, editSelected: null, menuManual: null };
    this._dirty = false;
    this._actionState = new ActionState(() => { this._dirty = true; });
    this._timers = {};
    this._combatRound = null;
    this._drag = null;
    this._suppressClick = false;
    this._suppressUntil = 0;
    this._targetClearTimer = null;
    this._overlaySeq = 0;
    this._targetRevision = 0;
    this._chainNodes = [];
    this._build();
    this.hud = new BottomHUD(this);
    this._bind();
    this._loop();
    globalThis.__dshCombatPanel = this;
    console.log(`[${MODULE_ID}] ready v${VERSION}`);
  }

  /* ---------------- DOM ---------------- */

  _build() {
    const root = document.createElement("div");
    root.id = "dsh-cp-root";
    root.innerHTML = `
      <div id="dsh-cp-top" class="dsh-cp-hidden"></div>
      <div id="dsh-cp-side" class="dsh-cp-hidden"></div>
      <div id="dsh-cp-menu" class="dsh-cp-hidden">
        <div class="dsh-cp-list"></div>
        <div class="dsh-cp-cats"></div>
      </div>
      <div id="dsh-cp-lock" class="dsh-cp-hidden">
        <span class="tl"></span><span class="tr"></span><span class="bl"></span><span class="br"></span>
      </div>
      <div id="dsh-cp-hit" class="dsh-cp-hidden"></div>
    `;
    document.body.appendChild(root);
    this.el = root;
    this.$top = root.querySelector("#dsh-cp-top");
    this.$side = root.querySelector("#dsh-cp-side");
    this.$menu = root.querySelector("#dsh-cp-menu");
    this.$cats = root.querySelector(".dsh-cp-cats");
    this.$list = root.querySelector(".dsh-cp-list");
    this.$lock = root.querySelector("#dsh-cp-lock");
    this.$hit = root.querySelector("#dsh-cp-hit");
    // Preview sits above token HUD windows without raising the whole menu layer.
    const overlay = document.createElement("div");
    overlay.id = "dsh-cp-overlay";
    overlay.append(this.$lock, this.$hit);
    document.body.appendChild(overlay);

    // 操作按钮单独挂 body，确保固定在屏幕右下角，不受面板定位影响
    const actions = document.createElement("div");
    actions.id = "dsh-cp-actions";
    actions.className = "dsh-cp-hidden";
    actions.innerHTML = `
      <button id="dsh-cp-endturn" type="button">结束回合</button>
      <button id="dsh-cp-rest-short" type="button">短休</button>
      <button id="dsh-cp-rest-long" type="button">长休</button>
    `;
    document.body.appendChild(actions);
    this.$actions = actions;
    this.$endTurn = actions.querySelector("#dsh-cp-endturn");
    this.$restShort = actions.querySelector("#dsh-cp-rest-short");
    this.$restLong = actions.querySelector("#dsh-cp-rest-long");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "dsh-cp-link";
    svg.innerHTML = `<line x1="0" y1="0" x2="0" y2="0"></line><circle r="3" cx="-10" cy="-10"></circle>`;
    document.body.appendChild(svg);
    this.$svg = svg;
    this.$line = svg.querySelector("line");
    this.$dot = svg.querySelector("circle");
    const chain = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chain.id = "dsh-cp-attack-chain";
    chain.setAttribute("aria-hidden", "true");
    chain.innerHTML = '<g class="dsh-cp-chain-links"></g>';
    chain.style.display = "none";
    document.body.appendChild(chain);
    this.$chain = chain;
    this.$chainLinks = chain.querySelector("g");
  }

  _bind() {
    this.el.addEventListener("click", (ev) => { void this._onClick(ev); });
    this.$endTurn?.addEventListener("click", (ev) => { ev.stopPropagation(); void this._endTurn(); });
    this.$restShort?.addEventListener("click", (ev) => { ev.stopPropagation(); void this._rest("short"); });
    this.$restLong?.addEventListener("click", (ev) => { ev.stopPropagation(); void this._rest("long"); });
    this.el.addEventListener("pointerdown", (ev) => this._onPointerDown(ev));
    document.addEventListener("pointermove", (ev) => this._onPointerMove(ev));
    document.addEventListener("pointerup", (ev) => this._onPointerUp(ev));
    document.addEventListener("pointercancel", () => this._cancelDrag());
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && (this._drag || this._menuDrag)) {
        ev.preventDefault();
        this._cancelDrag();
      }
    });
    window.addEventListener("blur", () => this._cancelDrag());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this._cancelDrag(); });
    Hooks.on("targetToken", (user) => { if (user?.id === game.user?.id) this._targetRevision++; });
    for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createItem", "updateItem", "deleteItem", "updateActor", "updateToken", "updateSetting"]) {
      Hooks.on(hook, () => this._invalidatePreview());
    }

    Hooks.on("controlToken", () => this.refresh());
    Hooks.on("updateToken", () => this.refresh());
    Hooks.on("deleteToken", () => this.refresh());
    Hooks.on("updateActor", (actor) => {
      if (actor === this.actor || actor.id === this.actor?.id) this.refresh();
      else this._invalidatePreview();
    });
    Hooks.on("updateItem", (item) => {
      if (item.parent === this.actor) this.refresh();
    });
    Hooks.on("deleteItem", (item) => {
      if (item.parent === this.actor) this.refresh();
    });
    Hooks.on("updateCombat", (combat) => {
      this._onCombatUpdate(combat);
      this.refresh();
    });
    Hooks.on("canvasReady", () => {
      this._cancelDrag();
      this.token = null;
      this.refresh();
    });
    Hooks.on("updateUser", () => this.refresh());
    Hooks.on("midi-qol.RollComplete", (workflow) => this._onRollComplete(workflow));
    Hooks.on("dnd5e.postUseActivity", (activity, usage) => {
      this._actionState.mark(activity.actor ?? activity.item?.actor, activity.activation?.type, usage);
    });
    for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
      Hooks.on(hook, () => this.refresh());
    }
    // Usage cards are broadcast to other clients, unlike the local Midi workflow hooks.
    Hooks.on("createChatMessage", message => {
      const flags = message.flags?.dnd5e;
      if (flags?.messageType !== "usage" || !flags.activity?.uuid) return;
      const activity = fromUuidSync(flags.activity.uuid);
      if (activity) this._actionState.mark(activity.actor ?? activity.item?.actor, activity.activation?.type);
    });
    Hooks.on("deleteCombat", () => { this._resetUsed(); this.refresh(); });
  }

  /* ---------------- 资源使用状态（midi-qol 联动） ---------------- */

  _onRollComplete(workflow) {
    if (!workflow || workflow.aborted || (workflow.WorkflowState_Abort && workflow.currentAction === workflow.WorkflowState_Abort)) return;
    this._actionState.mark(workflow.actor, workflow.activity?.activation?.type, workflow.config);
  }

  _onCombatUpdate(combat) {
    if (combat === game.combat) this._actionState.syncCombat();
  }

  _markUsed(key) { this._actionState.mark(this.actor, key); }
  _resetUsed() { this._actionState.reset(); }

  /* ---------------- 刷新 ---------------- */

  refresh() {
    this._invalidatePreview();
    const token = canvas.tokens?.controlled?.[0] ?? null;
    const visible = !!(token && token.actor && this._canView(token));
    if (!visible) {
      this._hideAll();
      this.token = null;
      this.actor = null;
      this.state.menuManual = null;
      return;
    }
    if (token !== this.token) {
      this.token = token;
      this.state = { category: null, spellLevel: null, equipSub: null, itemId: null, editMode: false, editSelected: null, menuManual: null };
      this._actionState.syncCombat();
      this._combatRound = Number(game.combat?.round ?? 0);
      this._cancelDrag();
    }
    this.actor = token.actor;
    this._showAll();
    this._dirty = true;
  }

  _canView(token) {
    if (!token?.actor) return false;
    if (game.user?.isGM) return true;
    return token.actor.isOwner === true;
  }

  _hideAll() {
    this._cancelDrag();
    for (const el of [this.$top, this.$side, this.$menu]) el.classList.add("dsh-cp-hidden");
    this.$actions?.classList.add("dsh-cp-hidden");
    // 隐藏整条连线，避免只清终点时从旧位置到 (0,0) 留下残线
    if (this.$svg) this.$svg.style.display = "none";
    if (this.$line) {
      this.$line.setAttribute("x1", "0");
      this.$line.setAttribute("y1", "0");
      this.$line.setAttribute("x2", "0");
      this.$line.setAttribute("y2", "0");
    }
    this.$dot?.setAttribute("cx", "-10");
    this.$dot?.setAttribute("cy", "-10");
  }

  _showAll() {
    for (const el of [this.$top, this.$side, this.$menu]) el.classList.remove("dsh-cp-hidden");
    if (this.$svg) this.$svg.style.display = "";
  }

  _loop() {
    const tick = () => {
      if (this._dirty) {
        this._dirty = false;
        try { this._render(); } catch (err) { console.warn(`[${MODULE_ID}] render error`, err); }
      }
      if (this.token) {
        try { this._syncPosition(); } catch (err) { /* 画布未就绪时忽略 */ }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ---------------- 渲染 ---------------- */

  _render() {
    const actor = this.actor;
    if (!actor) return;
    this._renderTop(actor);
    this._renderSide(actor);
    this._renderMenu(actor);
    this._renderEndTurn();
  }

  _renderEndTurn() {
    if (!this.$actions) return;
    const combat = game.combat;
    const show = !!this.token;
    const inCombat = !!combat?.started;
    this.$actions.classList.toggle("dsh-cp-hidden", !show);
    this.$endTurn?.classList.toggle("dsh-cp-hidden", !inCombat);
    this.$restShort?.classList.toggle("dsh-cp-hidden", inCombat);
    this.$restLong?.classList.toggle("dsh-cp-hidden", inCombat);
    if (!show) return;
    if (inCombat) {
      const current = combat.combatant;
      const canAct = !!game.user?.isGM || !!current?.actor?.isOwner;
      if (this.$endTurn) {
        // 按钮贴在选中 token 的右下角，用当前回合角色名消除“结束的是谁”的歧义
        const label = current?.name ? `结束：${current.name}` : "结束回合";
        if (this.$endTurn.dataset.label !== label) {
          this.$endTurn.textContent = label;
          this.$endTurn.dataset.label = label;
        }
        this.$endTurn.disabled = !canAct;
        this.$endTurn.title = canAct ? "结束当前回合" : "只有 GM 或当前回合角色可以结束回合";
      }
    } else {
      const canRest = !!game.user?.isGM || !!this.actor?.isOwner;
      if (this.$restShort) this.$restShort.disabled = !canRest;
      if (this.$restLong) this.$restLong.disabled = !canRest;
    }
  }

  async _rest(kind) {
    const actor = this.actor;
    if (!actor) return;
    try {
      if (kind === "short") await actor.shortRest?.();
      else await actor.longRest?.();
    } catch (err) {
      this._error(err);
    }
  }

  async _endTurn() {
    const combat = game.combat;
    if (!combat?.started) return;
    if (this.$endTurn?.disabled) return;
    // 执行期间禁用，避免 GM 连点跳过多个回合；updateCombat 触发 refresh 后按状态恢复
    if (this.$endTurn) this.$endTurn.disabled = true;
    try {
      await combat.nextTurn();
    } catch (err) {
      this._error(err);
    } finally {
      this.refresh?.();
    }
  }

  _renderTop(actor) {
    const hp = actor.system?.attributes?.hp ?? {};
    const ac = actor.system?.attributes?.ac?.value ?? "—";
    const cur = Math.max(0, Number(hp.value ?? 0));
    const max = Math.max(0, Number(hp.max ?? 0));
    const temp = Math.max(0, Number(hp.temp ?? 0));
    // 有临时生命时：红色按 (当前值 / (最大+临时)) 等比缩小，蓝色补在红色右侧，总长不超出条
    const total = max + temp;
    const pct = total > 0 ? Math.max(0, Math.min(100, (cur / total) * 100)) : 0;
    const tempPct = total > 0 && temp > 0 ? Math.max(0, Math.min(100 - pct, (temp / total) * 100)) : 0;
    this.$top.innerHTML = `
      <span class="dsh-cp-ac"><span class="dsh-cp-ac-label">AC</span><b>${esc(ac)}</b></span>
      <span class="dsh-cp-hp">
        <span class="dsh-cp-hp-fill" style="width:${pct}%"></span>
        ${tempPct > 0 ? `<span class="dsh-cp-hp-tempfill" style="left:${pct}%;width:${tempPct}%"></span>` : ""}
        <span class="dsh-cp-hp-text">
          <span class="dsh-cp-hp-cur">${cur}/${max}</span>${temp > 0 ? `<span class="dsh-cp-hp-temp">+${temp}</span>` : ""}
        </span>
      </span>
    `;
  }

  _renderSide(actor) {
    const res = this._resources(actor);
    const concentrating = this._isConcentrating(actor);
    const rows = [];
    if (!res.midiActive) {
      rows.push(`<div class="dsh-cp-res is-muted" title="Midi-QOL 未启用">?</div>`);
    } else {
      rows.push(`<div class="dsh-cp-res ${res.action.used ? "is-used" : "is-ready"}" data-res="action" title="动作${res.action.used ? "（已用）" : "（可用）"}">${RES_ICON.action}</div>`);
      rows.push(`<div class="dsh-cp-res ${res.bonus.used ? "is-used" : "is-ready"}" data-res="bonus" title="附赠动作${res.bonus.used ? "（已用）" : "（可用）"}">${RES_ICON.bonus}</div>`);
      rows.push(`<div class="dsh-cp-res ${res.reaction.used ? "is-used" : "is-ready"}" data-res="reaction" title="反应${res.reaction.used ? "（已用）" : "（可用）"}">${RES_ICON.reaction}</div>`);
    }
    rows.push(`<div class="dsh-cp-res ${concentrating ? "is-conc" : "is-muted"}" data-res="conc" title="${concentrating ? "专注中" : "无专注"}">${CONC_ICON}</div>`);
    this.$side.innerHTML = rows.join("");
  }

  _renderMenu(actor) {
    this.$cats.innerHTML = CATEGORIES.map((cat) => {
      const open = this.state.category === cat.id;
      return `<button class="dsh-cp-cat${open ? " is-open" : ""}" data-cat="${cat.id}">${cat.label}</button>`;
    }).join("");

    if (!this.state.category) {
      this.$list.classList.remove("is-open");
      this.$list.inert = true;
      this.$list.setAttribute("aria-hidden", "true");
      return;
    }
    this.$list.inert = false;
    this.$list.setAttribute("aria-hidden", "false");
    this.$list.classList.add("is-open");
    const category = this.state.category;
    const edit = this.state.editMode;

    // 法术分类：未选环位时展示环位菜单
    if (category === "spells" && !edit && this.state.spellLevel === null) {
      this.$list.innerHTML = `<div class="dsh-cp-tools"><button data-action="edit" title="选择显示哪些法术">✎ 编辑</button></div>`
        + this._spellLevelsHtml(actor);
      return;
    }

    // 装备分类：未选子分类时展示 武器/装备/消耗品/工具/战利品
    if (category === "equipment" && !edit && this.state.equipSub === null) {
      const all = this._allItems("equipment");
      this.$list.innerHTML = `<div class="dsh-cp-tools"><button data-action="edit" title="选择显示哪些条目">✎ 编辑</button></div>`
        + EQUIP_SUBS.map((sub) => {
          const count = all.filter(sub.match).length;
          return `<div class="dsh-cp-row dsh-cp-subcat" data-subcat="${sub.id}">
            <span class="dsh-cp-row-name">${sub.label}</span>
            <span class="dsh-cp-meta">${count}</span>
          </div>`;
        }).join("");
      return;
    }

    const tools = this._toolsHtml(category, edit);
    const items = this._itemsOf(actor, category);
    const label = CATEGORIES.find((c) => c.id === category)?.label ?? "";
    if (!items.length) {
      this.$list.innerHTML = tools + `<div class="dsh-cp-empty">${edit ? "没有可添加的条目" : "尚未选择条目，点「编辑」添加"}</div>`;
      return;
    }
    this.$list.innerHTML = tools + items.map((item) => this._itemHtml(item, edit)).join("");
    void label;
  }

  _toolsHtml(category, edit) {
    if (edit) {
      return `<div class="dsh-cp-tools"><span class="dsh-cp-tools-hint">点击条目切换</span><button data-action="done">完成</button></div>`;
    }
    if (category === "spells" && this.state.spellLevel !== null) {
      const name = this.state.spellLevel === 0 ? "戏法" : `${this.state.spellLevel} 环`;
      return `<div class="dsh-cp-tools"><button data-action="back">← 环位</button><span class="dsh-cp-tools-hint">${name}</span></div>`;
    }
    if (category === "equipment" && this.state.equipSub !== null) {
      const name = EQUIP_SUBS.find((sub) => sub.id === this.state.equipSub)?.label ?? "装备";
      return `<div class="dsh-cp-tools"><button data-action="back">← 装备</button><span class="dsh-cp-tools-hint">${name}</span></div>`;
    }
    return `<div class="dsh-cp-tools"><button data-action="edit" title="选择显示哪些条目">✎ 编辑</button></div>`;
  }

  _spellLevelsHtml(actor) {
    const spells = actor.system?.spells ?? {};
    const counts = new Map();
    for (const item of asArray(actor.items)) {
      if (item.type !== "spell") continue;
      const lvl = Number(item.system?.level ?? 0);
      counts.set(lvl, (counts.get(lvl) ?? 0) + 1);
    }
    const rows = [];
    const cantrips = counts.get(0) ?? 0;
    if (cantrips > 0) {
      rows.push(`<div class="dsh-cp-row dsh-cp-level" data-level="0">
        <span class="dsh-cp-row-name">戏法</span>
        <span class="dsh-cp-meta">${cantrips} 个</span>
      </div>`);
    }
    for (let lvl = 1; lvl <= 9; lvl++) {
      const slot = spells[`spell${lvl}`];
      const max = Number(slot?.max ?? 0);
      const count = counts.get(lvl) ?? 0;
      if (count === 0 && max === 0) continue;
      const remain = Number(slot?.value ?? 0);
      const slotText = max > 0 ? `${remain}/${max}` : "无位";
      rows.push(`<div class="dsh-cp-row dsh-cp-level" data-level="${lvl}">
        <span class="dsh-cp-row-name">${lvl} 环</span>
        <span class="dsh-cp-meta">${count} 个 · ${slotText}</span>
      </div>`);
    }
    return rows.length ? rows.join("") : `<div class="dsh-cp-empty">没有法术</div>`;
  }

  /* ---------------- 条目与收藏 ---------------- */

  _allItems(categoryId) {
    const cat = CATEGORIES.find((c) => c.id === categoryId);
    if (!cat) return [];
    const types = new Set(cat.types);
    const items = asArray(this.actor?.items).filter((item) => types.has(item.type));
    const order = (item) => (item.type === "spell" ? Number(item.system?.level ?? 0) : 0);
    return items.sort((a, b) => {
      const d = order(a) - order(b);
      return d !== 0 ? d : String(a.name).localeCompare(String(b.name), "zh");
    });
  }

  _itemsOf(actor, categoryId) {
    const all = this._allItems(categoryId);
    if (this.state.editMode) return all;
    const fav = this._favorites()?.[categoryId];
    let list = all;
    if (Array.isArray(fav)) {
      const map = new Map(all.map((item) => [item.id, item]));
      list = fav.map((id) => map.get(id)).filter(Boolean);
    }
    if (categoryId === "spells" && this.state.spellLevel !== null) {
      list = list.filter((item) => Number(item.system?.level ?? 0) === this.state.spellLevel);
    }
    if (categoryId === "equipment" && this.state.equipSub !== null) {
      const sub = EQUIP_SUBS.find((entry) => entry.id === this.state.equipSub);
      if (sub) list = list.filter(sub.match);
    }
    return list;
  }

  _itemHtml(item, edit) {
    const acts = this._activityList(item);
    const open = !edit && this.state.itemId === item.id;
    const level = Number(item.system?.level ?? 0);
    const meta = this._usesMeta(item);
    const depleted = this._isDepleted(item);
    const classes = ["dsh-cp-row"];
    if (open) classes.push("is-open");
    if (depleted) classes.push("is-depleted");
    let html = `<div class="${classes.join(" ")}" data-item="${esc(item.id)}" data-spell-level="${level}">`;
    if (edit) {
      const checked = this.state.editSelected?.has(item.id) ? "☑" : "☐";
      html += `<span class="dsh-cp-check">${checked}</span>`;
    }
    const img = item.img || FALLBACK_ICON;
    html += `<span class="dsh-cp-icon"><img src="${esc(img)}" alt="" loading="lazy"></span>`;
    html += `<span class="dsh-cp-row-name">${esc(item.name)}</span>`;
    if (meta) html += `<span class="dsh-cp-meta">${esc(meta)}</span>`;
    if (!edit && acts.length > 1) html += `<span class="dsh-cp-chev">${open ? "▾" : "▸"}</span>`;
    html += `</div>`;
    if (open && acts.length) {
      html += `<div class="dsh-cp-sub">`;
      for (const act of acts) {
        const label = ACTIVATION_LABEL[act.activation?.type] ?? act.activation?.type ?? "";
        html += `<div class="dsh-cp-sub-row" data-item="${esc(item.id)}" data-activity="${esc(act.id)}">`
          + `${esc(act.name)}${label ? `<span class="dsh-cp-sub-hint">${esc(label)}</span>` : ""}</div>`;
      }
      html += `</div>`;
    }
    return html;
  }

  _activityList(item) {
    const riders = Array.isArray(item?.flags?.dnd5e?.riders?.activity) ? item.flags.dnd5e.riders.activity : [];
    return asArray(item?.system?.activities).filter((act) => act && act.type !== "forward" && !riders.includes(act.id));
  }

  _usesMeta(item) {
    const acts = this._activityList(item);
    const meta = resourceMeta(this.actor, item, acts);
    let text = "";
    if (meta) {
      const label = (meta.kind === "resource" || meta.kind === "activity") && meta.label ? `${meta.label} ` : "";
      text = `${label}${meta.value}/${meta.max}`;
    }
    const transfer = acts.find((act) => isTransferActivity(item, act) && Number(act?.uses?.max) > 0);
    if (transfer) {
      const uses = usesLeft(transfer.uses);
      text += `${text ? " · " : ""}转移 ${uses.value}/${uses.max}`;
    }
    return text;
  }

  _isDepleted(item) {
    const primary = this._activityList(item).slice(0, 1);
    const meta = resourceMeta(this.actor, item, primary);
    return !!meta && meta.value <= 0;
  }

  /* ---------------- 收藏 ---------------- */

  _storeActor() {
    const actor = this.actor;
    if (!actor) return null;
    if (!actor.isToken) return actor;
    return game.actors?.get?.(actor.id) ?? actor;
  }

  _favorites() {
    const store = this._storeActor();
    if (!store) return null;
    try {
      return store.getFlag?.(MODULE_ID, "favorites") ?? null;
    } catch (err) {
      return null;
    }
  }

  async _beginEdit() {
    const actor = this.actor;
    const category = this.state.category;
    if (!actor || !category) return;
    const all = this._allItems(category);
    const fav = this._favorites()?.[category];
    this.state.editMode = true;
    this.state.editSelected = new Set(Array.isArray(fav) ? fav : all.map((item) => item.id));
    this._dirty = true;
  }

  _commitEdit() {
    const category = this.state.category;
    const store = this._storeActor();
    if (!this.state.editMode || !category || !store) return;
    const count = this.state.editSelected?.size ?? 0;
    const fav = foundry.utils.deepClone(this._favorites() ?? {});
    fav[category] = Array.from(this.state.editSelected ?? []);
    // 先更新界面，再异步保存；避免事件处理中的文档更新阻塞 UI
    this.state.editMode = false;
    this.state.editSelected = null;
    this._dirty = true;
    store.setFlag(MODULE_ID, "favorites", fav).then(
      () => console.log(`[${MODULE_ID}] favorites saved`, { category, count }),
      (err) => {
        console.warn(`[${MODULE_ID}] favorites save failed`, err);
        this._error(err);
      }
    );
  }

  _toggleFavorite(itemId) {
    if (!this.state.editSelected) return;
    if (this.state.editSelected.has(itemId)) this.state.editSelected.delete(itemId);
    else this.state.editSelected.add(itemId);
    this._dirty = true;
  }

  /* ---------------- 状态读取 ---------------- */

  _resources(actor) {
    const midiActive = !!game.modules.get("midi-qol")?.active;
    const used = this._actionState.read(actor);
    return {
      midiActive,
      action: { used: !!used.action },
      bonus: { used: !!used.bonus },
      reaction: { used: !!used.reaction }
    };
  }

  _isConcentrating(actor) {
    try {
      if (actor.statuses?.has?.("concentrating")) return true;
    } catch (err) { /* ignore */ }
    return asArray(actor.effects).some((effect) => {
      try {
        if (effect.statuses?.has?.("concentrating")) return true;
      } catch (err) { /* ignore */ }
      return /concentrat|专注/i.test(effect.name ?? "");
    });
  }

  /* ---------------- 交互 ---------------- */

  async _onClick(ev) {
    if (this._suppressClick) {
      this._suppressClick = false;
      // 只抑制拖拽结束后短时间内的那次 click，避免吞掉后续正常点击
      if (performance.now() < this._suppressUntil) return;
    }
    const actionEl = ev.target.closest?.("[data-action]");
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === "edit") await this._beginEdit();
      else if (action === "done") this._commitEdit();
      else if (action === "back") {
        this.state.spellLevel = null;
        this.state.equipSub = null;
        this.state.itemId = null;
        this._dirty = true;
      }
      return;
    }
    const catBtn = ev.target.closest?.("[data-cat]");
    if (catBtn) {
      if (this.state.editMode) this._commitEdit();
      const id = catBtn.dataset.cat;
      if (this.state.category === id) {
        this.state.category = null;
      } else {
        this.state.category = id;
      }
      this.state.spellLevel = null;
      this.state.equipSub = null;
      this.state.itemId = null;
      this._dirty = true;
      return;
    }
    const levelRow = ev.target.closest?.("[data-level]");
    if (levelRow) {
      this.state.spellLevel = Number(levelRow.dataset.level);
      this.state.itemId = null;
      this._dirty = true;
      return;
    }
    const subcatRow = ev.target.closest?.("[data-subcat]");
    if (subcatRow) {
      this.state.equipSub = subcatRow.dataset.subcat;
      this.state.itemId = null;
      this._dirty = true;
      return;
    }
    const row = ev.target.closest?.("[data-item]");
    if (!row) return;
    if (this.state.editMode) {
      this._toggleFavorite(row.dataset.item);
      return;
    }
    const actRow = ev.target.closest?.("[data-activity]");
    if (actRow) {
      this._useActivity(actRow.dataset.item, actRow.dataset.activity);
      return;
    }
    this._toggleItem(row.dataset.item);
  }

  _toggleItem(itemId) {
    const item = this.actor?.items?.get?.(itemId);
    if (!item) return;
    const acts = this._activityList(item);
    if (!acts.length) return;
    if (acts.length === 1) {
      this._useActivity(itemId, acts[0].id);
      return;
    }
    this.state.itemId = this.state.itemId === itemId ? null : itemId;
    this._dirty = true;
  }

  async _useActivity(itemId, activityId) {
    const item = this.actor?.items?.get?.(itemId);
    const act = this._activityList(item).find((a) => a.id === activityId);
    if (!act) return;
    try {
      const pending = act.use?.({}, {});
      if (pending && typeof pending.catch === "function") {
        pending.catch((err) => this._error(err));
      }
    } catch (err) {
      this._error(err);
    }
  }

  _error(err) {
    console.warn(`[${MODULE_ID}] activity use failed`, err);
    ui.notifications?.error(`战斗面板：${err?.message ?? err}`);
  }

  /* ---------------- 拖拽施法 ---------------- */

  _dragKind(activity) {
    const target = activity?.target ?? {};
    const template = target.template ?? {};
    if (template.type === 'emanationNoTemplate') return 'self';
    if (template.type) return "area";
    const affects = target.affects?.type ?? "";
    if (affects === "self") return "self";
    // 附魔活动的目标是持有物品而非 token：交给 dnd5e 自己选择附魔对象，不能传目标 UUID
    if (activity?.type === "enchant" || affects === "object") return "self";
    if (affects) return "target";
    // dnd5e 的武器攻击活动 target.affects.type 常为空字符串，按攻击视为单体目标
    if (activity?.type === "attack" || activity?.attack) return "target";
    return "self";
  }

  _onPointerDown(ev) {
    if (ev.button !== 0) return;
    if (ev.target.closest?.(".dsh-cp-list")?.inert) return;
    this._cancelDrag();
    // 按住左侧分类栏可拖动整个菜单
    if (ev.target.closest?.(".dsh-cp-cats") && this.actor) {
      const rect = this.$cats.getBoundingClientRect();
      this._menuDrag = {
        startX: ev.clientX,
        startY: ev.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        moved: false
      };
      return;
    }
    if (this.state.editMode || !this.actor) return;
    const row = ev.target.closest?.("[data-item]");
    if (!row) return;
    const item = this.actor.items?.get?.(row.dataset.item);
    if (!item) return;
    const acts = this._activityList(item);
    const actId = row.dataset.activity;
    const activity = actId ? acts.find((a) => a.id === actId) : acts[0];
    if (!activity) return;
    this._drag = {
      item,
      activity,
      startX: ev.clientX,
      startY: ev.clientY,
      started: false,
      kind: this._dragKind(activity),
      el: null,
      tpl: null
    };
  }

  _onPointerMove(ev) {
    const menuDrag = this._menuDrag;
    if (menuDrag) {
      const dx = ev.clientX - menuDrag.startX;
      const dy = ev.clientY - menuDrag.startY;
      if (!menuDrag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      menuDrag.moved = true;
      this.state.menuManual = { left: menuDrag.startLeft + dx, top: menuDrag.startTop + dy };
      this._suppressClick = true;
      this._suppressUntil = performance.now() + 300;
      try { this._syncPosition(); } catch (err) { /* ignore */ }
      return;
    }
    const drag = this._drag;
    if (!drag) return;
    if (!drag.started) {
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (dx * dx + dy * dy < 49) return;
      this._beginDrag(drag);
    }
    this._moveDrag(drag, ev);
  }

  _beginDrag(drag) {
    drag.started = true;
    drag.clientX = drag.startX;
    drag.clientY = drag.startY;
    const el = document.createElement("div");
    el.className = "dsh-cp-drag";
    el.innerHTML = `<img src="${esc(drag.item.img || FALLBACK_ICON)}" alt="">`;
    document.body.appendChild(el);
    drag.el = el;

    if (drag.kind === "area") {
      const tpl = document.createElement("div");
      tpl.className = "dsh-cp-area-preview";
      document.body.appendChild(tpl);
      drag.tpl = tpl;
      drag.tplSize = this._templateScreenSize(drag.activity);
    }
  }

  _templateScreenSize(activity) {
    const tpl = activity?.target?.template ?? {};
    const grid = canvas.scene?.grid ?? {};
    const distance = Number(grid.distance ?? 5) || 5;
    const gridSize = Number(grid.size ?? 100) || 100;
    const zoom = canvas.stage?.worldTransform?.a || 1;
    const size = Number(tpl.size ?? 0);
    const worldPx = (size / distance) * gridSize;
    const diameter = ["sphere", "circle", "cone", "cylinder"].includes(tpl.type) ? worldPx * 2 : worldPx;
    return Math.max(24, Math.round(diameter * zoom));
  }

  _moveDrag(drag, ev) {
    drag.clientX = ev.clientX;
    drag.clientY = ev.clientY;
    this._syncDragVisuals();
  }

  _syncDragVisuals() {
    const drag = this._drag;
    if (!drag?.started || !this.token) return;
    const x = drag.clientX, y = drag.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (drag.el) {
      drag.el.style.left = x + "px";
      drag.el.style.top = y + "px";
    }
    if (drag.tpl) {
      const size = this._templateScreenSize(drag.activity);
      Object.assign(drag.tpl.style, { left: x + "px", top: y + "px", width: size + "px", height: size + "px" });
      drag.el.title = "松开后放置实际模板";
    }
    this._updateTargetOverlay(drag, {clientX:x,clientY:y});
    this._syncAttackChain(drag);
    if (drag.overlayToken) this._positionTargetOverlay(drag.overlayToken);
  }

  _syncAttackChain(drag) {
    if (!this.$chain || !this.token || !drag.started) return;
    const projected=tacticsBounds(this.token);
    if(projected===null){this.$chain.style.display='none';return;}
    const source = projected ?? this._screenOf(this.token.center.x, this.token.center.y);
    const dx = drag.clientX - source.x, dy = drag.clientY - source.y;
    const length = Math.hypot(dx,dy);
    const radius = projected ? 10 : Math.max(8, Math.min(this.token.w,this.token.h) * Math.abs(canvas.stage.worldTransform.a || 1) / 2);
    const from = Math.min(radius, length / 3);
    const usable = Math.max(0, length - from - 27);
    const count = Math.min(180, Math.floor(usable / 10));
    this.$chain.style.display = count ? "" : "none";
    this.$chain.classList.toggle("is-locked", !!drag.overlayToken);
    drag.el?.classList.toggle("is-locked", !!drag.overlayToken);
    if (!count) return;
    this.$chainLinks.setAttribute("transform", "translate(" + source.x + " " + source.y + ") rotate(" + Math.atan2(dy,dx)*180/Math.PI + ")");
    const gap = usable / count;
    while (this._chainNodes.length < count) {
      const oval = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
      this.$chainLinks.appendChild(oval);
      this._chainNodes.push(oval);
    }
    this._chainNodes.forEach((oval,i) => {
      oval.style.display = i < count ? "" : "none";
      if (i >= count) return;
      oval.setAttribute("cx", from + gap * (i + 0.5));
      oval.setAttribute("cy", "0");
      oval.setAttribute("rx", i % 2 ? 4.5 : 6);
      oval.setAttribute("ry", i % 2 ? 2.1 : 3.8);
    });
  }

  _cancelDrag() {
    const drag = this._drag;
    if (drag?.started || this._menuDrag?.moved) {
      this._suppressClick = true;
      this._suppressUntil = performance.now() + 300;
    }
    this._drag = null;
    this._menuDrag = null;
    this._hideTargetOverlay();
    if (this.$chain) this.$chain.style.display = "none";
    drag?.el?.remove();
    drag?.tpl?.remove();
  }

  _onPointerUp(ev) {
    const menuDrag = this._menuDrag;
    if (menuDrag) {
      this._menuDrag = null;
      if (menuDrag.moved) {
        this._suppressClick = true;
        this._suppressUntil = performance.now() + 300;
      }
      return;
    }
    const drag = this._drag;
    if (!drag) return;
    this._drag = null;
    this._hideTargetOverlay();
    if (this.$chain) this.$chain.style.display = "none";
    drag.el?.remove();
    drag.tpl?.remove();
    if (!drag.started) return; // 没移动 → 交给 click 正常执行
    this._suppressClick = true;
    this._suppressUntil = performance.now() + 300;

    if (drag.kind === "self" || drag.kind === "area") {
      this._useActivity(drag.item.id, drag.activity.id);
      return;
    }
    const token = this._tokenAtClient(ev.clientX, ev.clientY);
    if (!token) return; // 单体技能没停在有效目标上 → 取消
    try {
      // v13 没有 game.user.updateTokenTargets；Token#setTarget 仍可用
      token.setTarget?.(true, { releaseOthers: true, user: game.user });
    } catch (err) {
      console.warn(`[${MODULE_ID}] set target failed`, err);
    }
    this._useActivity(drag.item.id, drag.activity.id);
    this._releaseTargetsSoon(token);
  }

  _releaseTargetsSoon(token) {
    clearTimeout(this._targetClearTimer);
    const revision = this._targetRevision;
    this._targetClearTimer = setTimeout(() => {
      // Preserve the requested 3-second cleanup, but never clear a newer selection.
      if (revision !== this._targetRevision) return;
      try { if (game.user?.targets?.has?.(token)) token.setTarget(false, { releaseOthers: false, user: game.user }); }
      catch (err) { /* token may have been deleted */ }
    }, 3000);
  }

  _tokenAtClient(clientX, clientY) {
    const projected=tacticsTokenAt(clientX,clientY);
    if(projected!==undefined)return projected;
    const view = canvas.app?.view;
    if (!view) return null;
    const rect = view.getBoundingClientRect();
    const wt = canvas.stage.worldTransform;
    const wx = (clientX - rect.left - wt.tx) / (wt.a || 1);
    const wy = (clientY - rect.top - wt.ty) / (wt.d || 1);
    const tokens = canvas.tokens?.placeables ?? [];
    const hits = tokens.filter((t) => {
      if (!t.actor || !t.visible || t.destroyed) return false;
      if (!game.user?.isGM && (t.document?.hidden || t.isVisible === false)) return false;
      return wx >= t.x && wx <= t.x + (t.w ?? 0) && wy >= t.y && wy <= t.y + (t.h ?? 0);
    });
    return hits.length ? hits[hits.length - 1] : null;
  }

  /* ---------------- 目标锁定与命中预览 ---------------- */

  _invalidatePreview() {
    this._overlaySeq++;
    if (this._drag) this._drag.overlayKey = undefined;
  }

  _updateTargetOverlay(drag, ev) {
    const token = drag.kind === "target" ? this._tokenAtClient(ev.clientX, ev.clientY) : null;
    const key = token?.id ?? null;
    if (drag.overlayKey === key) return;
    drag.overlayKey = key;
    drag.overlayToken = token;
    if (!token) { this._hideTargetOverlay(); return; }
    this._showTargetOverlay(token, null);
    const seq = ++this._overlaySeq;
    this._computePreview(drag.activity, token).then(preview => {
      if (seq !== this._overlaySeq || this._drag !== drag || !drag.started || drag.overlayKey !== key) return;
      this._showTargetOverlay(token, preview);
    }).catch(err => {
      if (seq !== this._overlaySeq || this._drag !== drag) return;
      console.warn("[" + MODULE_ID + "] preview compute failed", err);
      this._showTargetOverlay(token, {kind:drag.activity.type, chance:null, mode:"normal", warnings:["条件暂无法判定，以实际投掷为准"]});
    });
  }

  _positionTargetOverlay(token) {
    if (!this.$lock || !token || token.destroyed) return;
    const projected=tacticsBounds(token);
    if(projected===null){this._hideTargetOverlay();return;}
    const topLeft = projected ? {x:projected.left,y:projected.top} : this._screenOf(token.x, token.y);
    const wt = canvas.stage.worldTransform;
    const width = projected?.width ?? Number(token.w ?? 0) * Math.abs(wt.a || 1);
    const height = projected?.height ?? Number(token.h ?? 0) * Math.abs(wt.d || 1);
    Object.assign(this.$lock.style, {left:(topLeft.x-4)+"px",top:(topLeft.y-4)+"px",width:(width+8)+"px",height:(height+8)+"px"});
    if (!this.$hit || this.$hit.classList.contains("dsh-cp-hidden")) return;
    const cardW=this.$hit.offsetWidth||180, cardH=this.$hit.offsetHeight||70;
    const cx = Math.max(cardW/2+8,Math.min(window.innerWidth-cardW/2-8,topLeft.x+width/2));
    let bottom=topLeft.y-8;
    if(bottom-cardH<8) bottom=topLeft.y+height+cardH+8;
    bottom=Math.max(cardH+8,Math.min(window.innerHeight-8,bottom));
    this.$hit.style.left=cx+"px";
    this.$hit.style.top=bottom+"px";
  }

  _likelihood(chance, kind) {
    if (!Number.isFinite(chance)) return "条件待判定";
    if (kind === "save") return chance < .25 ? "很难生效" : chance < .45 ? "较难生效" : chance < .65 ? "有望生效" : chance < .85 ? "较易生效" : "轻易生效";
    return chance < .25 ? "很难命中" : chance < .45 ? "较难命中" : chance < .65 ? "有望命中" : chance < .85 ? "较易命中" : "轻易命中";
  }

  _showTargetOverlay(token, preview) {
    if (!this.$lock || !this._drag?.started) return;
    this.$lock.classList.remove("dsh-cp-hidden");
    if (!preview) {
      this.$hit.removeAttribute('title');this.$hit.removeAttribute('aria-label');
      if(!getPredictionPolicy().probability){this.$hit.className='dsh-cp-hit dsh-cp-hidden';this.$hit.textContent='';this._positionTargetOverlay(token);return;}
      this.$hit.className="dsh-cp-hit is-normal";
      this.$hit.innerHTML='<span class="dsh-cp-hit-label">正在判定目标条件…</span>';
      this._positionTargetOverlay(token);
      return;
    }
    const policy=getPredictionPolicy();
    if(!policy.probability){
      this.$hit.removeAttribute('title');this.$hit.removeAttribute('aria-label');
      this.$hit.className='dsh-cp-hit is-normal'+(!policy.damage?' dsh-cp-hidden':'');
      this.$hit.textContent=policy.damage?'基础平均伤害 '+(Number.isFinite(preview.damage)?Math.round(preview.damage*10)/10:'待判定')+'（不计命中／豁免／目标减伤）':'';
      this._positionTargetOverlay(token);return;
    }
    const auditText=[...(preview.reasons??[]),...(preview.warnings??[]).map(t=>'待确认：'+t)].join('\n');
    this.$hit.title=auditText;
    this.$hit.setAttribute('aria-label',auditText);
    const mode = preview.mode ?? "normal";
    const modeText=mode==="adv"?"优势":mode==="dis"?"劣势":"均势";
    const favorableMode=preview.kind==="save"?(mode==="adv"?"dis":mode==="dis"?"adv":"normal"):mode;
    const label=preview.kind==="save"?"目标豁免失败率 · 估算":"命中率 · 估算";
    const chance=Number.isFinite(preview.chance)?Math.round(preview.chance*100)+"%":"—";
    const damage=policy.damage&&Number.isFinite(preview.damage)?'<span class="dsh-cp-hit-dmg">基础平均伤害 '+Math.round(preview.damage*10)/10+'</span>':"";
    this.$hit.className="dsh-cp-hit "+(favorableMode==="adv"?"is-adv":favorableMode==="dis"?"is-dis":"is-normal");
    this.$hit.innerHTML='<span class="dsh-cp-hit-line"><span class="dsh-cp-hit-label">'+label+'</span><span class="dsh-cp-hit-value">'+chance+'</span></span>'
      +'<span class="dsh-cp-hit-verdict">'+this._likelihood(preview.chance,preview.kind)+'</span>'
      +'<span class="dsh-cp-hit-mode">'+modeText+'</span>'+damage;
    this._positionTargetOverlay(token);
  }

  _hideTargetOverlay() {
    this._overlaySeq++;
    this.$lock?.classList.add("dsh-cp-hidden");
    this.$hit?.classList.add("dsh-cp-hidden");
  }

  async _computePreview(activity, token) {
    const policy=getPredictionPolicy();
    if(!policy.probability||!['attack','save'].includes(activity.type)){
      let damage=null;
      if(policy.damage){const labels=activity.labels?.damages??[],data=activity.getRollData?.()??{};const parts=labels.map(l=>formulaDistribution(l.formula,data));if(parts.length&&parts.every(Boolean))damage=parts.reduce((sum,d)=>sum+[...d].reduce((n,[value,p])=>n+value*p,0),0);}
      return {kind:activity.type,damage};
    }
    return computePreview({actor:this.actor,sourceToken:this.token,activity,targetToken:token,workflowResolver:workflowAttackPreview});
  }

  /* ---------------- 屏幕定位 ---------------- */

  _tokenScreenPoint(token,corner=false) {
    const b=tacticsBounds(token);
    if(b===null)return null;
    return b ? {x:corner?b.left+b.width:b.x,y:b.top} : this._screenOf(token.x+(corner?token.w:token.w/2),token.y);
  }

  _screenOf(worldX, worldY) {
    const wt = canvas.stage.worldTransform;
    const view = canvas.app.view;
    const rect = view.getBoundingClientRect();
    return {
      x: rect.left + worldX * wt.a + wt.tx,
      y: rect.top + worldY * wt.d + wt.ty
    };
  }

  _syncPosition() {
    const token = this.token;
    if (!token || token.destroyed) return;
    if (!canvas?.stage || !canvas?.app?.view) return;
    const wt = canvas.stage.worldTransform;
    const zoom = wt.a || 1;
    const center = token.center ?? { x: 0, y: 0 };
    const projected=tacticsBounds(token);
    const screen = projected ?? this._screenOf(center.x, center.y);
    const tokenW = projected?.width ?? Number(token.w ?? 100) * zoom;
    const tokenH = projected?.height ?? Number(token.h ?? 100) * zoom;
    const topY = screen.y - tokenH / 2;
    const leftX = screen.x - tokenW / 2;
    const rightX = screen.x + tokenW / 2;

    this.$top.style.left = `${screen.x}px`;
    this.$top.style.top = `${Math.max(4, topY - 4)}px`;

    // 资源图标放在 token 右侧；图标尺寸按 token 高度收缩，整列底部不超出 token 底部
    const sideTop = Math.max(4, topY);
    const sideGap = 2;
    const iconSize = Math.max(8, Math.min(22, Math.floor((tokenH - sideGap * 3) / 4)));
    this.$side.style.setProperty("--dsh-cp-icon", `${iconSize}px`);
    this.$side.style.left = `${Math.round(rightX + 6)}px`;
    this.$side.style.top = `${sideTop}px`;

    // Anchor the category rail, never the width-changing submenu.
    const viewW = window.innerWidth || 1400;
    const viewH = window.innerHeight || 900;
    const railWidth = this.$cats.offsetWidth || 42;
    const railHeight = this.$cats.offsetHeight || 110;
    const minLeft = Math.min(128, Math.max(8,viewW-railWidth-8));
    const desired = this.state.menuManual ?? {left:leftX-railWidth-8,top:sideTop};
    const menuLeft = Math.max(minLeft,Math.min(viewW-railWidth-8,desired.left));
    const menuTop = Math.max(8,Math.min(viewH-railHeight-8,desired.top));
    this.$menu.style.left = menuLeft + "px";
    this.$menu.style.top = menuTop + "px";
    this.$menu.style.setProperty("--dsh-cp-list-width",Math.max(96,Math.min(220,menuLeft-14))+"px");
    this.$menu.style.setProperty("--dsh-cp-list-max-height",Math.max(70,Math.min(viewH*.64,viewH-menuTop-8))+"px");
    this.$line.setAttribute("x2",menuLeft+railWidth);
    this.$line.setAttribute("y2",menuTop+railHeight/2);
    this.$line.setAttribute("x1",screen.x);
    this.$line.setAttribute("y1",screen.y);
    this.$dot.setAttribute("cx",screen.x);
    this.$dot.setAttribute("cy",screen.y);
    this._syncDragVisuals();

    // 操作按钮（结束回合 / 短休 / 长休）贴在选中 token 的右下角，而不是屏幕右下角
    if (this.$actions && !this.$actions.classList.contains("dsh-cp-hidden")) {
      const aw = this.$actions.offsetWidth || 0;
      const ah = this.$actions.offsetHeight || 0;
      const gap = 6;
      const bottomY = screen.y + tokenH / 2;
      const viewW = window.innerWidth || document.documentElement?.clientWidth || 0;
      const viewH = window.innerHeight || document.documentElement?.clientHeight || 0;
      // 默认从 token 右下角向右下延伸；右侧/底部空间不足时向内翻转，始终贴住 token
      let ax = Math.round(rightX + gap);
      let ay = Math.round(bottomY + gap);
      if (viewW && ax + aw > viewW - 8) ax = Math.round(rightX - aw - gap);
      if (viewH && ay + ah > viewH - 8) ay = Math.round(bottomY - ah - gap);
      ax = Math.max(8, ax);
      ay = Math.max(8, ay);
      this.$actions.style.left = `${ax}px`;
      this.$actions.style.top = `${ay}px`;
    }
  }
}

Hooks.once("init", () => {
  console.log(`[${MODULE_ID}] init v${VERSION}`);
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tools = controls.tokens?.tools;
  if (!tools) return;
  tools[HUD_TOOL] = {
    name: HUD_TOOL,
    title: "显示／隐藏战斗 HUD",
    icon: "fas fa-table-columns",
    order: 100,
    toggle: true,
    active: globalThis.__dshCombatPanel?.hud.enabled ?? true,
    onChange: (_event, active) => globalThis.__dshCombatPanel?.hud.setEnabled(active)
  };
});

Hooks.once("ready", () => {
  ensureStyles();
  registerFeatureHooks();
  if (!canvas?.tokens) {
    Hooks.once("canvasReady", () => new CombatPanel());
    return;
  }
  new CombatPanel();
});

Hooks.once('ready',()=>{const module=game.modules.get(MODULE_ID);if(module)module.api={...module.api,discoverPredictionRules,predictionModuleInventory,matchAttackSpells};});
