import {patchHTML} from './hud-dom-172.js';
import {registerPerformanceSettings, installPerformance, readPerformance, isLowPerformance} from './performance-199.js';
Hooks.once('init',registerPerformanceSettings);
Hooks.once('ready',installPerformance);
import {spellShapeHTML} from './hud-parts-152.js';
import { registerCloudRegions, repairCloudMembership } from './cloud-regions-182.js';
import { registerOngoingSpells, matchOngoingSpells } from './ongoing-spells-179.js';
import { registerAbilityAutomation, matchAbilityAutomation } from './ability-automation-175.js';
import { tacticsTokenAt, tacticsBounds } from './targeting-view-165.js';
import "./reaction-200.js";
import "./player-workflow-200.js";
import { ActionState } from "./action-state-198.js";
import { BottomHUD } from "./hud-200.js";
import { getPredictionPolicy, registerPredictionSettings, refreshPredictionPolicy } from './prediction-policy-156.js';
Hooks.once('init',registerPredictionSettings);
Hooks.once('ready',refreshPredictionPolicy);
import { workflowAttackPreview } from "./workflow-preview-147.js";
import { computePreview, formulaDistribution, discoverPredictionRules, predictionModuleInventory } from "./prediction-147.js";
import { resourceMeta, usesLeft, resolveConsumptionItem } from "./feature-core-147.js";
import { registerFeatureHooks } from "./feature-hooks-173.js";
import { matchAttackSpells } from "./attack-spell-automation-170.js";

/* fvtt-combat-panel v0.15.3 — bottom HUD, targeting and automation. */
const MODULE_ID = "fvtt-combat-panel";
const VERSION = "0.15.3";
const HUD_TOOL = `${MODULE_ID}-hud`;

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.contents)) return value.contents;
  if (typeof value.values === "function") return Array.from(value.values());
  if (typeof value[Symbol.iterator] === "function") return Array.from(value);
  return [];
}

function ensureStyles() {
  const marker = `${MODULE_ID}/styles/panel-197.css`;
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
    this._dirty = false;
    this._actionState = new ActionState(() => this.requestRender());
    this._drag = null;
    this._overlaySeq = 0;
    this._targetRevision = 0;
    this._chainNodes = [];
    this._build();
    this.hud = new BottomHUD(this);
    this._bind();
    this._loop();
    globalThis.__dshCombatPanel = this;
    this.refresh(); // Native character selection may precede this ready hook.
    console.log(`[${MODULE_ID}] ready v${VERSION}`);
  }

  /* ---------------- DOM ---------------- */

  _build() {
    const overlay = document.createElement("div");
    overlay.id = "dsh-cp-overlay";
    overlay.innerHTML = `<div id="dsh-cp-lock" class="dsh-cp-hidden"><span class="tl"></span><span class="tr"></span><span class="bl"></span><span class="br"></span></div><div id="dsh-cp-hit" class="dsh-cp-hidden"></div>`;
    document.body.appendChild(overlay);
    this.$lock = overlay.querySelector("#dsh-cp-lock");
    this.$hit = overlay.querySelector("#dsh-cp-hit");

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
    document.addEventListener("pointermove", (ev) => {
      this.hud.move(ev);
      const button = ev.target.closest?.('#dsh-bg3-hud button,.bg3-free-dialog button,.bg3-scale-popover:not(.cp-party-size-popover) button');
      if (button && readPerformance().animate) {
        const rect = button.getBoundingClientRect();
        button.style.setProperty('--cp-light-x', `${Math.round(ev.clientX - rect.left)}px`);
        button.style.setProperty('--cp-light-y', `${Math.round(ev.clientY - rect.top)}px`);
      }
    });
    document.addEventListener("pointercancel", () => this._cancelDrag());
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && this._drag) {
        ev.preventDefault();
        this._cancelDrag();
      }
    });
    window.addEventListener("blur", () => this._cancelDrag());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this._cancelDrag();
        cancelAnimationFrame(this._frame);this._frame=null;
        clearTimeout(this._visualTimer);this._visualTimer=null;
      } else this.refresh();
    });
    Hooks.on("targetToken", (user) => { if (user?.id === game.user?.id) this._targetRevision++; });
    for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createItem", "updateItem", "deleteItem", "updateActor", "updateToken", "updateSetting"]) {
      Hooks.on(hook, () => this._invalidatePreview());
    }

    Hooks.on("controlToken", () => this.refresh());
    Hooks.on("updateToken", doc => {
      if (doc === this.token?.document) this.refresh();
      else if (this._drag) this._loop();
    });
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
    Hooks.on("updateUser", user => { if (user.id === game.user.id) this.refresh(); });
    Hooks.on("midi-qol.RollComplete", (workflow) => this._onRollComplete(workflow));
    Hooks.on("dnd5e.postUseActivity", (activity, usage) => {
      this._actionState.mark(activity.actor ?? activity.item?.actor, activity.activation?.type, usage);
    });
    for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
      Hooks.on(hook, effect => {
        const actor=effect.parent?.actor??effect.parent;
        if (actor?.uuid === this.actor?.uuid) this.refresh();
      });
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
      return;
    }
    if (token !== this.token) {
      this.token = token;
      this._actionState.syncCombat();
      this._cancelDrag();
    }
    this.actor = token.actor;
    this._showAll();
    this.requestRender();
  }

  _canView(token) {
    if (!token?.actor) return false;
    if (game.user?.isGM) return true;
    return token.actor.isOwner === true;
  }

  _hideAll() {
    this._cancelDrag();
    this.hud.hideTip(0);
    if (!this.hud.busy) this.hud.el.hidden = true;
    this.hud.position();
  }

  _showAll() {
    this.hud.el.hidden = !this.hud.enabled;
    this.hud.position();
  }

  requestRender() {
    this._dirty = true;
    this._loop();
  }

  _loop() {
    if (this._frame != null || document.hidden) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      if (this._dirty) {
        this._dirty = false;
        try { this._render(); } catch (err) { console.warn(`[${MODULE_ID}] render error`, err); }
      }
      // Follow animations only while aiming. An ordinary selected token costs
      // no recurring frame callbacks, scans, or DOM writes from this panel.
      if (this.token && (this._drag?.started || this.hud.badges.childElementCount)) {
        try { this._syncPosition(); } catch (err) { /* 画布未就绪时忽略 */ }
        if (isLowPerformance()) {
          clearTimeout(this._visualTimer);
          this._visualTimer = setTimeout(() => { this._visualTimer=null;this._loop(); },33);
        } else this._loop();
      }
    });
  }

  /* ---------------- 渲染 ---------------- */

  _render() {
    if (this.actor) this.hud.render();
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
    if (!game.user?.isGM && !combat.combatant?.actor?.isOwner) return;
    if (this._endingTurn) return;
    this._endingTurn = true;
    try {
      await combat.nextTurn();
    } catch (err) {
      this._error(err);
    } finally {
      this._endingTurn = false;
      this.refresh?.();
    }
  }

  _activityList(item) {
    const riders = Array.isArray(item?.flags?.dnd5e?.riders?.activity) ? item.flags.dnd5e.riders.activity : [];
    return asArray(item?.system?.activities).filter((act) => act && act.type !== "forward" && !riders.includes(act.id));
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
    this._drag = null;
    this._hideTargetOverlay();
    if (this.$chain) this.$chain.style.display = "none";
    drag?.el?.remove();
    drag?.tpl?.remove();
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
    if (this.token && !this.token.destroyed && canvas?.stage && canvas?.app?.view) this._syncDragVisuals();
  }

}

Hooks.once("init", () => {
  const module = game.modules.get(MODULE_ID);
  module.api = {...module.api, ui: {version: 1, patchHTML, spellShapeHTML, usesLeft, resolveConsumptionItem, performance:{read:readPerformance,isLow:isLowPerformance}, getController: () => globalThis.__dshCombatPanel}};
  // Keep existing GM macros working after the optional party/check module split.
  module.api.checks = {open: () => {
    const checks = game.modules.get('fvtt-party-tools');
    if (!checks?.active) return ui.notifications.warn('请启用 BG3队伍与剧情 子模块后发起检定。');
    return checks.api.checks.open();
  }};
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
  registerAbilityAutomation();
  registerOngoingSpells();
  registerCloudRegions();
  if (!canvas?.tokens) {
    Hooks.once("canvasReady", () => new CombatPanel());
    return;
  }
  new CombatPanel();
});

Hooks.once('ready',()=>{const module=game.modules.get(MODULE_ID);if(module)module.api={...module.api,discoverPredictionRules,predictionModuleInventory,matchAttackSpells,matchAbilityAutomation,matchOngoingSpells,repairCloudMembership};});
