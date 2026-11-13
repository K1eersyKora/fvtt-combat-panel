import { createMiniD20 } from "./d20-orientation-1.js";
/** Transient observer-only check badges. No Actor/Token flags or world data writes. */
export class CheckTokenIndicators {
  constructor() {
    this.states = new Map();
    this.nodes = new Map();
  }

  initialize() {
    Hooks.on("canvasReady", () => this.start());
    Hooks.on("canvasTearDown", () => this.detach());
    for(const hook of ['deleteToken','refreshToken','canvasPan','sightRefresh','updateToken'])Hooks.on(hook,()=>this.schedule());
    window.addEventListener('resize',()=>this.schedule());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.start();});
    if (this.states.size) this.start();
  }

  receive(state, sender) {
    if (!state || state.gmUserId !== sender || !game.users.get(sender)?.isGM
      || !game.actors.has(state.actorId) || typeof state.sessionId !== "string"
      || !["pending", "rolling", "result"].includes(state.phase)
      || !Number.isFinite(state.revision) || !Number.isFinite(state.expiresAt)
      || state.expiresAt <= Date.now() || state.expiresAt > Date.now() + 3600000
      || !Array.isArray(state.participantIds) || !Number.isFinite(state.count)
      || (state.phase === "result" && !Number.isFinite(state.result?.total))) return;
    const key = `${state.sessionId}:${state.actorId}`;
    if ((this.states.get(key)?.revision ?? -1) >= state.revision) return;
    this.states.set(key, foundry.utils.deepClone(state));
    this.start();
  }

  snapshots(gmUserId) {
    return Array.from(this.states.values()).filter(s => s.gmUserId === gmUserId && s.expiresAt > Date.now());
  }

  start() {
    if (!canvas?.ready || !this.states.size) return;
    if (!this.root?.isConnected) {
      this.root = document.createElement("div");
      this.root.className = "bg3-token-checks";
      this.root.setAttribute('data-combat-panel-theme','');
      this.root.setAttribute("aria-label", "角色检定状态");
      document.body.append(this.root);
    }
    this.schedule();
  }

  schedule() {
    if(this.frame!=null||!this.states.size||document.hidden)return;
    this.frame=requestAnimationFrame(()=>{this.frame=null;this.update();});
  }

  detach() {
    cancelAnimationFrame(this.frame);this.frame=null;
    clearTimeout(this.timer);this.timer=null;
    this.root?.remove();
    this.root = null;
    this.nodes.clear();
  }

  createNode(key) {
    const node = document.createElement("div");
    node.className = "bg3-token-check";
    node.dataset.indicatorKey = key;
    node.setAttribute("role", "status");
    const mode = document.createElement("span");
    mode.className = "bg3-token-check-mode";
    mode.setAttribute("aria-hidden","true");
    const perspective = createMiniD20();
    const value = document.createElement("strong");
    value.className = "bg3-token-check-value";
    const label = document.createElement("span");
    label.className = "bg3-token-check-label";
    const bonus = document.createElement("span");
    bonus.className = "bg3-token-check-bonus";
    const details = document.createElement("span");
    details.className = "bg3-token-check-details";
    details.append(value,bonus);
    node.append(mode,perspective,label,details);
    this.root.append(node);
    const refs = { node, mode, value, label, bonus, signature: "" };
    this.nodes.set(key, refs);
    return refs;
  }

  update() {
    const now = Date.now();
    for (const [key, state] of this.states) if (state.expiresAt <= now) this.states.delete(key);
    if (!this.states.size) { this.detach(); return; }
    clearTimeout(this.timer);
    const deadline=Math.min(...Array.from(this.states.values()).flatMap(state=>[
      state.expiresAt,state.phase==='result'&&state.resultUntil>now?state.resultUntil:Infinity
    ]));
    this.timer=setTimeout(()=>{this.timer=null;this.schedule();},Math.max(1,deadline-now+10));
    if (!globalThis.canvas?.ready || !this.root) return;
    const canvasElement = canvas.app.renderer.view ?? canvas.app.canvas;
    const rect = canvasElement?.getBoundingClientRect();
    const screen = canvas.app.renderer.screen;
    if (!rect || !screen?.width || !screen?.height) return;
    // All players in this check batch are excluded. GMs always see the badges.
    const participant = !game.user.isGM && Array.from(this.states.values()).some(s => s.participantIds.includes(game.user.id));
    const live = new Set();
    const stacks = new Map();
    for (const [stateKey, state] of this.states) {
      if (participant) continue;
      for (const token of canvas.tokens.placeables) {
        if (token.document.actorId !== state.actorId || token.destroyed || !token.visible || !token.isVisible
          || (!game.user.isGM && token.document.hidden)) continue;
        const key = `${stateKey}:${token.id}`;
        live.add(key);
        const refs = this.nodes.get(key) ?? this.createNode(key);
        const resultVisible = state.phase === "result" && now < state.resultUntil;
        const phase = resultVisible ? "result" : state.phase === "result" ? "pending" : state.phase;
        const label = resultVisible || state.phase !== "result" ? state.label : state.nextLabel;
        const progress = state.count > 1 ? ` · ${Math.min(state.count, state.completed + (resultVisible ? 0 : 1))}/${state.count}` : "";
        const mode = state.phase === "result" && !resultVisible ? state.nextMode : state.mode;
        const bonusText = state.phase === "result" && !resultVisible ? state.nextBonusText : state.bonusText;
        const normalizedMode = ["adv","dis"].includes(mode) ? mode : "normal";
        const signature = `${state.revision}:${phase}:${resultVisible}`;
        if (refs.signature !== signature) {
          refs.signature = signature;
          refs.node.dataset.phase = phase;
          refs.node.dataset.actorId = state.actorId;
          refs.node.dataset.mode = normalizedMode;
          refs.mode.textContent = normalizedMode === "adv" ? "▲" : normalizedMode === "dis" ? "▼" : "";
          refs.bonus.textContent = `加值 ${bonusText ?? "+0"}`;
          refs.bonus.title = refs.bonus.textContent;
          refs.node.dataset.success = resultVisible ? String(Boolean(state.result.success)) : "";
          refs.value.textContent = resultVisible ? String(state.result.total) : "";
          refs.label.textContent = `${label}${progress}`;
          refs.node.setAttribute("aria-label", `${state.actorName} · ${label} · ${normalizedMode === "adv" ? "优势" : normalizedMode === "dis" ? "劣势" : "普通"} · ${refs.bonus.textContent} · ${resultVisible ? `${state.result.success ? "成功" : "失败"} ${state.result.total}` : "正在检定"}`);
        }
        const point = canvas.stage.worldTransform.apply({ x: token.x + token.w / 2, y: token.y });
        const x = rect.left + point.x * rect.width / screen.width;
        const stack = stacks.get(token.id) ?? 0;
        stacks.set(token.id, stack + 1);
        const y = rect.top + point.y * rect.height / screen.height - 14 - stack * 64;
        refs.node.hidden = x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
        const transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0) translate(-50%,-100%)`;
        if (refs.node.style.transform !== transform) refs.node.style.transform = transform;
      }
    }
    for (const [key, refs] of this.nodes) if (!live.has(key)) { refs.node.remove(); this.nodes.delete(key); }
  }
}
