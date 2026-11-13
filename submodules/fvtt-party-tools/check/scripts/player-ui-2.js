import { checkBonusSummary } from "./check-display-1.js";
const escape = value => foundry.utils.escapeHTML(String(value ?? ""));
const signed = value => Number(value) >= 0 ? `+${value}` : String(value).replace(/^-/, "−");
const bonusAmount = value => {
  const text = String(value).trim().replace(/^\+\s*/, "");
  return /^[-−]/.test(text) ? text.replace(/^-\s*/, "−") : `+${text}`;
};
const frame = '<img class="bg3-ornate-frame" src="modules/fvtt-party-tools/check/assets/check-frame-11.svg" alt="">';

export const playerContent = `<div class="bg3-player-shell" data-rows>
  <div class="bg3-player-top"><span data-actor></span><button type="button" data-act="close" class="bg3-player-close" aria-label="关闭并自动结算">×</button></div>
  <nav class="bg3-check-tabs" aria-label="检定项目" data-tabs></nav>
  <section class="bg3-check-row bg3-focus-check" data-index="0">
    <header class="bg3-focus-heading"><h2 data-check-title></h2><p data-check-subtitle></p></header>
    <div class="bg3-focus-frame" data-glass="tray"><div class="bg3-tray-glass"><span class="bg3-tray-water" aria-hidden="true"></span><span class="bg3-glass-layer" aria-hidden="true"></span></div>${frame}
      <div class="bg3-difficulty"><span>难度<br>等级</span><strong data-dc></strong></div>
      <div class="bg3-dice-stage" data-dice-stage role="img" aria-label="三维检定骰子"></div>
      <button type="button" class="bg3-dice-hit" data-act="roll" aria-label="点击骰子掷骰"></button>
      <div class="bg3-roll-result" data-result aria-live="polite"></div>
      <button type="button" class="bg3-focus-roll" data-act="roll" data-glass="roll"><span class="bg3-glass-layer" aria-hidden="true"></span><span data-roll-label>点击骰子</span></button>
      <span class="bg3-roll-mode" data-mode-label></span>
    </div>
    <section class="bg3-bonus-section" aria-label="检定加值"><div class="bg3-bonus-caption">加值 <span>· 点击选择或取消</span></div><div class="bg3-bonus-cards" data-bonuses></div></section>
    <div class="bg3-bonus-total"><span>总计加成</span><strong data-total></strong></div>
    <div class="bg3-check-warn" data-notice role="status"></div>
    <div class="bg3-check-countdown"><span class="bg3-timer"></span><span>后自动掷骰</span></div>
  </section>
</div>`;

function bonusCard({ action, index, value, name, subtitle, image, icon, selected, disabled, fixed, reason }) {
  return `<button type="button" class="bg3-bonus-card ${selected ? "selected" : ""} ${fixed ? "fixed" : ""}"
    data-glass="card" data-card-key="${escape(`${action || "fixed"}:${index ?? name}`)}"
    ${action ? `data-act="${action}" data-${action}="${index}"` : ""}
    aria-pressed="${Boolean(selected)}" ${disabled || fixed ? "disabled" : ""}
    title="${escape(reason || (fixed ? "角色固有加值，由原生检定计算" : `${name} · ${selected ? "点击取消" : "点击选择"}`))}">
    <span class="bg3-glass-layer" aria-hidden="true"></span><span class="bg3-bonus-value ${String(value).length > 7 ? "wide" : ""}">${escape(value)}</span>
    <span class="bg3-bonus-icon">${image ? `<img src="${escape(image)}" alt="" loading="lazy">` : `<i class="fas ${icon || "fa-sparkles"}" aria-hidden="true"></i>`}</span>
    <span class="bg3-bonus-name">${escape(name)}</span><span class="bg3-bonus-owner">${escape(subtitle)}</span>
    <span class="bg3-bonus-mark" aria-hidden="true">${fixed ? "◆" : selected ? "✓" : "+"}</span>
  </button>`;
}

export function renderPlayer(context, { abilityLabel, modeLabel, mergeMode, sourceApplied }) {
  const root = context.dialog?.element?.querySelector("[data-rows]");
  if (!root || context.closed) return;
  const { payload, rows, actor } = context;
  const check = payload.checks.find(c => c.index === context.activeIndex) ?? payload.checks[0];
  const row = rows.get(check.index);
  const disabled = row.busy || row.done;
  root.querySelector("[data-actor]").textContent = payload.actorName;
  root.querySelector("[data-tabs]").innerHTML = payload.checks.length < 2 ? "" : payload.checks.map(c =>
    `<button type="button" data-act="tab" data-glass="tab" data-check="${c.index}" aria-current="${c.index === check.index ? "step" : "false"}" ${context.rollingIndex != null ? "disabled" : ""}><span class="bg3-glass-layer" aria-hidden="true"></span>${escape(c.label)}${rows.get(c.index).done ? " ✓" : ""}</button>`).join("");
  const section = root.querySelector(".bg3-check-row");
  section.dataset.index = check.index;
  section.classList.toggle("resolved", row.done);
  section.classList.toggle("rolling", row.busy && !row.done);
  root.querySelector("[data-check-title]").textContent = check.label;
  root.querySelector("[data-check-subtitle]").textContent = `${abilityLabel(check.ability)}检定`;
  root.querySelector("[data-dc]").textContent = payload.showDC ? payload.dc : "？";
  const mode = mergeMode(actor, check, payload, row);
  const modeElement = root.querySelector("[data-mode-label]");
  modeElement.replaceChildren();
  if (mode !== "normal") {
    const triangle = document.createElement("span");
    triangle.className = `bg3-mode-triangle ${mode}`;
    triangle.textContent = mode === "adv" ? "▲" : "▼";
    triangle.setAttribute("aria-hidden", "true");
    modeElement.append(triangle, document.createTextNode(` ${modeLabel(mode)} · 掷两枚骰子，取${mode === "adv" ? "高" : "低"}值`));
  }
  root.querySelectorAll('[data-act="roll"]').forEach(button => { button.disabled = disabled; });
  root.querySelector("[data-roll-label]").textContent = row.done ? "检定完成" : row.busy ? (row.requestId ? "等待施法确认" : "正在掷骰…") : "点击骰子";
  const result = root.querySelector("[data-result]");
  result.innerHTML = row.result ? `<strong>${escape(row.result.total)}</strong><span>${row.result.success ? "检定成功" : "检定失败"}</span>` : "";
  result.className = `bg3-roll-result ${row.result ? row.result.success ? "success" : "failure" : ""}`;
  const intrinsic = checkBonusSummary(actor,check,{},sourceApplied).baseFixed;
  const ability = Number(actor.system.abilities?.[check.ability]?.mod) || 0;
  const ownCards = [bonusCard({ value: signed(ability), name: abilityLabel(check.ability), subtitle: "属性加值", icon: {str:"fa-hand-fist",dex:"fa-feather",con:"fa-heart",int:"fa-book-open",wis:"fa-eye",cha:"fa-masks-theater"}[check.ability], selected: true, fixed: true })];
  if (intrinsic !== ability) ownCards.push(bonusCard({ value: signed(intrinsic - ability), name: "熟练与其他", subtitle: "固有加值", icon: "fa-medal", selected: true, fixed: true }));
  const sourceCards = check.sources.map((source, index) => {
    const applied = sourceApplied(actor, row, source);
    const selected = row.selectedSources.has(index) || applied;
    return bonusCard({ action: "source", index, value: source.bonusText ? bonusAmount(source.bonusText) : modeLabel(source.modeDelta > 0 ? "adv" : "dis"),
      name: source.itemName, subtitle: applied ? "效果已生效" : source.casterName, image: source.itemImg,
      selected, disabled: disabled || !source.usable, fixed: applied, reason: applied ? "已存在的法术效果由系统计算" : source.reason });
  });
  const helperCards = check.helpers.map((helper, index) => bonusCard({ action: "helper", index, value: "优势", name: "协助",
    subtitle: helper.name, image: helper.img, selected: row.helper === helper, disabled }));
  patchBonusCards(root.querySelector("[data-bonuses]"), [...ownCards, ...sourceCards, ...helperCards].join(""));
  root.querySelectorAll(".bg3-bonus-icon img").forEach(img => {
    if (img.dataset.fallbackBound) return;
    img.dataset.fallbackBound = "true";
    img.addEventListener("error", () => { img.replaceWith(Object.assign(document.createElement("i"), { className: "fas fa-sparkles" })); }, { once: true });
  });
  root.querySelector("[data-total]").textContent = checkBonusSummary(actor,check,row,sourceApplied,row.result).text;
  root.querySelector("[data-notice]").textContent = row.notice || "";
  root.querySelector(".bg3-check-countdown").hidden = row.done;
  root.querySelector(".bg3-timer").textContent = `${Math.max(0, Math.ceil((payload.deadline - Date.now()) / 1000))} 秒`;
}

function patchBonusCards(container, markup) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  const previous = new Map(Array.from(container.children, card => [card.dataset.cardKey, card]));
  let index = 0;
  for (const fresh of Array.from(template.content.children)) {
    let card = previous.get(fresh.dataset.cardKey);
    previous.delete(fresh.dataset.cardKey);
    if (card) {
      const hovered = card.classList.contains("is-glass-hovered");
      for (const attribute of Array.from(card.attributes)) {
        if (attribute.name !== "style" && !fresh.hasAttribute(attribute.name)) card.removeAttribute(attribute.name);
      }
      for (const attribute of fresh.attributes) card.setAttribute(attribute.name, attribute.value);
      if (hovered) card.classList.add("is-glass-hovered");
      // Keep every visual node, including lazy-loaded images and 3D glass effects.
      // Recreating all images on selection caused neighbouring icons to jump.
      for (const selector of [".bg3-bonus-value", ".bg3-bonus-name", ".bg3-bonus-owner", ".bg3-bonus-mark"]) {
        const node = card.querySelector(selector), next = fresh.querySelector(selector);
        if (node && next && node.textContent !== next.textContent) node.textContent = next.textContent;
        if (node && next && node.className !== next.className) node.className = next.className;
      }
      const icon = card.querySelector(".bg3-bonus-icon"), nextIcon = fresh.querySelector(".bg3-bonus-icon");
      const identity = nextIcon.querySelector("img")?.getAttribute("src") ?? nextIcon.querySelector("i")?.className;
      if (icon.dataset.identity !== identity) {
        const previousIdentity = icon.querySelector("img")?.getAttribute("src") ?? icon.querySelector("i")?.className;
        if (previousIdentity !== identity) icon.replaceChildren(...nextIcon.childNodes);
        icon.dataset.identity = identity;
      }
    } else card = fresh;
    if (container.children[index] !== card) container.insertBefore(card, container.children[index] ?? null);
    index++;
  }
  for (const card of previous.values()) card.remove();
}

/** Delegation survives state updates. Only CSS variables change while the pointer moves. */
export function bindGlassEffects(root) {
  const animated=()=>game.modules.get('fvtt-combat-panel')?.api?.ui?.performance?.read?.().animate!==false;
  let pendingFrame = 0;
  let hovered = null;
  let point = null;
  const surfaceAt = event => event.target.closest?.("[data-glass]");
  root.addEventListener("pointermove", event => {
    if(!animated())return;
    const surface = surfaceAt(event);
    if (!surface || (surface.tagName === "BUTTON" && surface.disabled)) return;
    if (hovered !== surface) { hovered?.classList.remove("is-glass-hovered"); hovered = surface; }
    point = { x: event.clientX, y: event.clientY };
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      if (!hovered?.isConnected || !point) return;
      const rect = hovered.getBoundingClientRect();
      hovered.style.setProperty("--glass-x", `${point.x - rect.left}px`);
      hovered.style.setProperty("--glass-y", `${point.y - rect.top}px`);
      hovered.classList.add("is-glass-hovered");
    });
  }, { passive: true });
  root.addEventListener("pointerout", event => {
    const surface = surfaceAt(event);
    if (surface && !surface.contains(event.relatedTarget)) {
      surface.classList.remove("is-glass-hovered");
      if (hovered === surface) hovered = null;
    }
  }, { passive: true });
  root.addEventListener("click", event => {
    const surface = surfaceAt(event);
    if (!surface || surface.disabled || !animated() || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = surface.getBoundingClientRect();
    const x = event.detail ? event.clientX - rect.left : rect.width / 2;
    const y = event.detail ? event.clientY - rect.top : rect.height / 2;
    const action = surface.dataset.act;
    const key = action === "source" ? "source" : action === "helper" ? "helper" : "check";
    const index = surface.dataset[key];
    // The main click handler updates selections in a microtask. Find the fresh card afterwards.
    requestAnimationFrame(() => {
      if (!root.isConnected) return;
      const current = surface.dataset.glass === "roll" ? root.querySelector('[data-glass="roll"]')
        : action ? root.querySelector(`[data-act="${action}"][data-${key}="${index}"]`) : root.querySelector('[data-glass="tray"]');
      const layer = current?.querySelector(".bg3-glass-layer");
      if (!layer) return;
      current.style.setProperty("--glass-x", `${x}px`);
      current.style.setProperty("--glass-y", `${y}px`);
      current.classList.add("is-glass-hovered");
      const ripple = document.createElement("span");
      ripple.className = "bg3-glass-ripple";
      const size = Math.max(rect.width, rect.height) * 1.5;
      Object.assign(ripple.style, { width: `${size}px`, height: `${size}px`, left: `${x - size / 2}px`, top: `${y - size / 2}px` });
      layer.append(ripple);
      ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
      setTimeout(() => ripple.remove(), 900);
    });
  });
}
