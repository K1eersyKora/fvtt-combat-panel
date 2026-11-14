import {isStoryActive,readStoryState} from './story-state-2.js';
import {toggleStoryMode} from './story-mode-7.js';
import { openSkillChecks } from '../check/scripts/check-integration-7.js';
import { isPlayerRestricted, registerRestrictionSetting, setRestrictedPlayers, setRestrictionMode, InteractionLock } from './interaction-lock-2.js';

const ID = 'fvtt-party-tools';
const MOVEMENT_SCOPE = 'fvtt-combat-panel';
export const MOVEMENT_MODES = Object.freeze({
  free: {label: '自由行动', icon: 'fa-person-walking'},
  none: {label: '禁止移动', icon: 'fa-lock'},
  combat: {label: '战斗移动', icon: 'fa-hourglass-half'}
});
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monkActive = () => !!game.modules.get('monks-tokenbar')?.active && !!game.MonksTokenBar;
let party;
const changed = () => { party?.schedule(); };
export function normalizePartyScale(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1.6, Math.max(.5, number)) : 1;
}

export function registerPartySettings() {
  registerRestrictionSetting();
  game.settings.register(ID, 'partyEnabled', {name: '显示队伍总览', hint: '在战斗 HUD 之外显示队伍、移动控制与完全限制。', scope: 'client', config: true, type: Boolean, default: true, onChange: changed});
  game.settings.register(ID, 'movementMode', {scope: 'world', config: false, type: String, default: 'free', choices: Object.fromEntries(Object.entries(MOVEMENT_MODES).map(([key, value]) => [key, value.label])), onChange: changed});
  game.settings.register(ID, 'partyPosition', {scope: 'client', config: false, type: Object, default: {x: 24, y: 280}, onChange: changed});
  game.settings.register(ID, 'partyScale', {scope: 'client', config: false, type: Number, default: 1, onChange: changed});
}

export function movementMode(token) {
  const scope = monkActive() ? 'monks-tokenbar' : ID;
  const key = scope === ID ? 'movementMode' : 'movement';
  const override = token?.getFlag(scope === ID ? MOVEMENT_SCOPE : scope, 'movement');
  const mode = override || game.settings.get(scope, key);
  return MOVEMENT_MODES[mode] ? mode : 'free';
}

export function canMoveToken(token, user = game.user, combat = game.combats?.active) {
  if (user?.isGM) return true;
  if (isPlayerRestricted(user)) return false;
  const mode = movementMode(token);
  if (mode === 'free') return true;
  if (mode === 'none') return false;
  return !!combat?.started && combat.scene?.id === token.parent?.id && combat.combatant?.tokenId === token.id;
}

async function monkController() {
  return (await import('/modules/monks-tokenbar/monks-tokenbar.js')).MonksTokenBar;
}

export async function setMovementMode(mode, token = null) {
  if (!game.user.isGM) throw new Error('只有主持人可以修改移动模式。');
  if (!MOVEMENT_MODES[mode]) throw new Error('无效的移动模式。');
  if (mode === 'combat' && !game.combats.active?.started) {
    ui.notifications.warn('请先开始战斗，再启用战斗移动。');
    return false;
  }
  if (monkActive()) {
    const monk = await monkController();
    if (token) await monk.changeTokenMovement(mode, token);
    else await monk.changeGlobalMovement(mode);
  } else if (token) {
    await token.setFlag(MOVEMENT_SCOPE, 'movement', mode === movementMode() ? null : mode);
  } else {
    // A global command deliberately clears individual exceptions, as Monk does.
    const updates = canvas.scene?.tokens.filter(t => t.getFlag(MOVEMENT_SCOPE, 'movement')).map(t => ({_id: t.id, [`flags.${MOVEMENT_SCOPE}.movement`]: null})) ?? [];
    if (updates.length) await canvas.scene.updateEmbeddedDocuments('Token', updates);
    await game.settings.set(ID, 'movementMode', mode);
  }
  // Preserve the latest global mode if Monk is disabled on a later restart.
  if (!token && game.settings.get(ID, 'movementMode') !== mode) await game.settings.set(ID, 'movementMode', mode);
  changed();
  return true;
}

export class PartyPanel {
  constructor() {
    party = this;
    this.collapsed = false;
    this.pending = false;
    this.restrictionQueue = Promise.resolve();
    this.el = document.createElement('section');
    this.el.id = 'cp-party-panel';
    this.el.setAttribute('aria-label', '队伍总览与移动控制');
    document.body.appendChild(this.el);
    this.menu = document.createElement('div');
    this.menu.className = 'cp-party-menu';
    this.menu.hidden = true;
    document.body.appendChild(this.menu);
    this.lock = new InteractionLock();
    for (const hook of ['canvasReady', 'canvasTearDown', 'createToken', 'updateToken', 'deleteToken', 'updateActor', 'updateCombat', 'createCombat', 'deleteCombat', 'updateUser', 'controlToken', 'combatPanelPartyChanged']) Hooks.on(hook, changed);
    Hooks.on('updateSetting', setting => {
      if (setting.key === 'monks-tokenbar.movement') changed();
    });
    Hooks.on('deleteCombat', combat => {
      if (!monkActive() && game.user.id === game.users.activeGM?.id && combat.started && movementMode() === 'combat' && combat.scene?.id === canvas.scene?.id) {
        void setMovementMode('free').catch(error => ui.notifications.error(error.message));
      }
    });
    Hooks.on('preMoveToken', token => {
      if (!monkActive() && !canMoveToken(token)) { this.warnMovement(); return false; }
    });
    Hooks.on('preUpdateToken', (token, update) => {
      if (!monkActive() && ('x' in update || 'y' in update || 'elevation' in update) && !canMoveToken(token)) {
        this.warnMovement(); return false;
      }
    });
    this.el.addEventListener('click', event => this.click(event));
    this.el.addEventListener('dblclick', event => {
      if (game.user.isGM && game.settings.get(ID, 'restrictionMode')) { event.preventDefault(); return; }
      const token = canvas.scene?.tokens.get(event.target.closest('[data-party-token]')?.dataset.partyToken);
      if (token?.actor?.testUserPermission(game.user, 'LIMITED')) token.actor.sheet.render(true);
    });
    this.el.addEventListener('contextmenu', event => this.context(event));
    this.el.addEventListener('pointerdown', event => this.dragStart(event));
    window.addEventListener('resize', () => this.position());
    document.addEventListener('pointerdown', event => {
      if (!this.menu.contains(event.target)) this.menu.hidden = true;
      if (this.sizePopover && !this.sizePopover.contains(event.target) && !event.target.closest?.('[data-party-action="size"]')) this.closeSizePopover();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { this.menu.hidden = true; this.closeSizePopover(); } });
    document.addEventListener('pointermove', event => {
      const button = event.target.closest?.('#cp-party-panel button, .cp-party-menu button, .cp-lock-dialog button, .cp-party-size-popover button');
      if (!button) return;
      const rect = button.getBoundingClientRect();
      button.style.setProperty('--cp-light-x', `${Math.round(event.clientX - rect.left)}px`);
      button.style.setProperty('--cp-light-y', `${Math.round(event.clientY - rect.top)}px`);
    }, {passive: true});
    this.schedule();
  }

  warnMovement() {
    if (Date.now() - (this.lastWarn ?? 0) < 1800) return;
    this.lastWarn = Date.now();
    ui.notifications.warn(movementMode() === 'combat' ? '战斗移动：只有当前回合的角色可以移动。' : '主持人已禁止移动。');
  }

  entries() {
    const seen = new Set();
    return (canvas?.tokens?.placeables ?? []).filter(token => {
      const actor = token.actor;
      if (!actor?.hasPlayerOwner || (!game.user.isGM && (!token.isVisible || token.document.hidden))) return false;
      if (!game.user.isGM && !actor.testUserPermission(game.user, 'LIMITED')) return false;
      const key = token.document.actorLink ? actor.uuid : token.document.uuid;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a,b) => a.name.localeCompare(b.name));
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; if (!this.drag) this.render(); });
  }

  render() {
    const enabled = game.settings.get(ID, 'partyEnabled');
    this.el.hidden = !enabled;
    document.body.classList.toggle('cp-party-integrated', enabled);
    if (!enabled) { this.menu.hidden = true; this.closeSizePopover(); return; }
    const mode = movementMode();
    const gm = game.user.isGM;
    const picking = game.settings.get(ID, 'restrictionMode');
    this.el.classList.toggle('is-restriction-picking', gm && picking);
    const restrictions = game.settings.get(ID, 'restrictedPlayers').filter(id => game.users.get(id) && !game.users.get(id).isGM);
    const nav = gm ? `<nav class="cp-party-controls" aria-label="移动控制">${Object.entries(MOVEMENT_MODES).map(([key, value]) => `<button type="button" data-party-mode="${key}" aria-label="${value.label}" aria-pressed="${key === mode}" title="${value.label}${key === 'combat' ? '：仅当前回合的角色可以移动' : '：应用到所有玩家指示物'}" ${this.pending ? 'disabled' : ''}><i class="fas ${value.icon}" aria-hidden="true"></i><span>${value.label}</span></button>`).join('')}<button type="button" class="cp-restrict-button" data-party-action="restrict" aria-label="完全限制" aria-pressed="${picking}" title="${picking ? '退出完全限制模式并解除全部限制' : '进入完全限制模式，再点击角色选择对应玩家'}"><i class="fas fa-user-lock" aria-hidden="true"></i><span>完全限制${restrictions.length ? ` · ${restrictions.length}` : ''}</span></button></nav>` : '';
    const extra = gm ? `<div class="cp-party-tools" aria-label="队伍工具"><button type="button" data-party-action="roll" title="发起技能检定"><i class="fas fa-dice-d20" aria-hidden="true"></i> 检定</button><button type="button" data-party-action="story" aria-pressed="${isStoryActive()}" ${readStoryState().phase==='starting'?'disabled':''} title="开启／退出剧情模式"><i class="fas fa-film" aria-hidden="true"></i> ${readStoryState().phase==='starting'?'进入战斗…':isStoryActive()?'退出剧情':'剧情模式'}</button></div>` : '';
    const cards = this.entries().map(token => {
      const actor = token.actor;
      const details = gm || actor.testUserPermission(game.user, 'OBSERVER');
      const hp = actor.system.attributes?.hp ?? {};
      const max = Math.max(0, Number(hp.max) || 0);
      const value = Number(hp.value) || 0;
      const ac = actor.system.attributes?.ac?.value ?? '—';
      const pp = actor.system.skills?.prc?.passive ?? '—';
      const ownMode = movementMode(token.document);
      const restricted = restrictions.some(id => actor.testUserPermission(game.users.get(id), 'OWNER'));
      const title = `${token.name}${gm && picking ? ` · 点击${restricted ? '解除' : '完全限制'}对应玩家（对其全部角色生效）` : gm ? ' · 右键设置单独移动' : ''}`;
      return `<button type="button" class="cp-party-card ${token.controlled ? 'is-controlled' : ''} ${restricted ? 'is-restricted' : ''}" data-party-token="${token.id}" ${gm && picking ? `aria-pressed="${restricted}"` : ''} title="${esc(title)}"><span class="cp-party-image"><img src="${esc(token.document.texture.src || actor.img)}" alt="" loading="lazy"><i class="fas ${restricted ? 'fa-user-lock' : MOVEMENT_MODES[ownMode].icon} cp-party-token-state" aria-hidden="true"></i></span><strong>${esc(token.name)}</strong>${details ? `<span class="cp-party-stats">AC <b>${esc(ac)}</b><span>察 <b>${esc(pp)}</b></span></span><span class="cp-party-hp"><i style="width:${max ? Math.min(100, Math.max(0, value / max * 100)) : 0}%"></i><span>${value}/${max}</span></span>${Number(hp.temp)>0?`<span class="cp-party-temp" aria-label="临时生命 ${Number(hp.temp)}"><i style="width:${Math.min(100,Number(hp.temp)/Math.max(1,max)*100)}%"></i><span>+${Number(hp.temp)}</span></span>`:''}` : '<span class="cp-party-private">悬停棋子查看</span>'}</button>`;
    }).join('') || '<p class="cp-party-empty">当前场景没有玩家角色</p>';
    const html = `<header class="cp-party-header"><strong><span aria-hidden="true">✦</span> 队伍总览</strong><span class="cp-party-status">${MOVEMENT_MODES[mode].label}</span><button type="button" class="cp-party-size" data-party-action="size" title="调整队伍总览大小" aria-label="调整队伍总览大小" aria-expanded="${!!this.sizePopover}"><i class="fas fa-expand-arrows-alt" aria-hidden="true"></i><output data-party-scale-label>100%</output></button><button type="button" data-party-action="collapse" title="${this.collapsed ? '展开' : '收起'}队伍总览" aria-expanded="${!this.collapsed}"><i class="fas ${this.collapsed ? 'fa-chevron-down' : 'fa-chevron-up'}" aria-hidden="true"></i></button><span class="cp-party-grip" aria-hidden="true">⠿</span></header><div class="cp-party-body" ${this.collapsed ? 'hidden' : ''}>${nav}${extra}${gm && picking ? '<p class="cp-party-restriction-hint">点角色限制／解除玩家 · 再按完全限制解除全部</p>' : ''}<div class="cp-party-cards">${cards}</div></div>`;
    if (this.html !== html) { this.el.innerHTML = html; this.html = html; }
    this.position();
  }

  position() {
    const saved = this.drag?.point ?? game.settings.get(ID, 'partyPosition');
    const preferred = normalizePartyScale(game.settings.get(ID, 'partyScale'));
    const width = this.el.offsetWidth || 400, height = this.el.offsetHeight || 40;
    this.scale = Math.min(preferred, (innerWidth - 16) / width, (innerHeight - 56) / height);
    this.el.style.setProperty('--cp-party-scale', this.scale);
    const scaledWidth = width * this.scale, scaledHeight = height * this.scale;
    const x = Math.max(8, Math.min(Number(saved.x) || 24, innerWidth - scaledWidth - 8));
    const hud = document.querySelector('#dsh-bg3-hud:not([hidden])');
    if (hud && !this.hudObserver) {
      this.hudObserver = new ResizeObserver(() => this.position());
      this.hudObserver.observe(hud);
    }
    const hudTop = hud?.getBoundingClientRect().top ?? innerHeight;
    const bottom = hudTop > scaledHeight + 56 ? hudTop - 12 : innerHeight - 8;
    const y = Math.max(48, Math.min(Number(saved.y) || 280, bottom - scaledHeight));
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
    const label = this.el.querySelector('[data-party-scale-label]');
    if (label) label.textContent = `${Math.round(this.scale * 100)}%`;
    this.syncSizePopover();
    this.positionSizePopover();
  }

  dragStart(event) {
    if (event.button !== 0 || !event.target.closest('.cp-party-header') || event.target.closest('button')) return;
    event.preventDefault();
    const rect = this.el.getBoundingClientRect();
    this.drag = {dx: event.clientX - rect.x, dy: event.clientY - rect.y, point: {x: rect.x, y: rect.y}};
    const move = ev => { if (ev.pointerId !== event.pointerId) return; this.drag.point = {x: ev.clientX - this.drag.dx, y: ev.clientY - this.drag.dy}; this.position(); };
    const end = async ev => {
      if (ev.pointerId !== event.pointerId) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      const point = {x: parseFloat(this.el.style.left), y: parseFloat(this.el.style.top)};
      this.drag = null;
      await game.settings.set(ID, 'partyPosition', point);
      this.schedule();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }

  async click(event) {
    const button = event.target.closest('button');
    if (!button || isPlayerRestricted()) return;
    try {
      if (button.dataset.partyMode) {
        if (this.pending) return;
        this.pending = true; this.render();
        try { await setMovementMode(button.dataset.partyMode); } finally { this.pending = false; this.schedule(); }
        return;
      }
      const action = button.dataset.partyAction;
      if (action === 'collapse') { this.collapsed = !this.collapsed; this.schedule(); return; }
      if (action === 'size') { this.sizePopover ? this.closeSizePopover() : this.openSizePopover(); return; }
      if (action === 'restrict') {
        await this.enqueueRestriction(() => setRestrictionMode(!game.settings.get(ID, 'restrictionMode')));
        return;
      }
      if (action === 'story') { await toggleStoryMode(); return; }
      if (action === 'roll') {
        if (!game.user.isGM) return;
        await openSkillChecks();
        return;
      }
      const token = canvas.tokens.get(button.dataset.partyToken);
      if (!token || (!game.user.isGM && !token.actor.isOwner)) return;
      if (game.user.isGM && game.settings.get(ID, 'restrictionMode')) {
        await this.enqueueRestriction(() => this.toggleActorRestriction(token.actor));
        return;
      }
      token.control({releaseOthers: !event.shiftKey});
      canvas.animatePan({x: token.center.x, y: token.center.y, duration: 250});
    } catch (error) { console.error(`[${ID}]`, error); ui.notifications.error(error.message); }
  }

  context(event) {
    const token = canvas.scene?.tokens.get(event.target.closest('[data-party-token]')?.dataset.partyToken);
    if (!game.user.isGM || !token) return;
    event.preventDefault();
    this.menu.innerHTML = `<strong>${esc(token.name)} · 移动权限</strong>${Object.entries(MOVEMENT_MODES).map(([mode, info]) => `<button type="button" data-mode="${mode}" aria-pressed="${movementMode(token) === mode}"><i class="fas ${info.icon}" aria-hidden="true"></i> ${info.label}</button>`).join('')}<button type="button" data-mode="inherit">跟随全局模式</button>`;
    this.menu.hidden = false;
    this.menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - 210))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - 230))}px`;
    this.menu.onclick = async ev => {
      const mode = ev.target.closest('[data-mode]')?.dataset.mode;
      if (!mode) return;
      this.menu.hidden = true;
      try {
        if (mode === 'inherit') await token.unsetFlag(monkActive() ? 'monks-tokenbar' : MOVEMENT_SCOPE, 'movement');
        else await setMovementMode(mode, token);
      } catch (error) { ui.notifications.error(error.message); }
    };
  }

  enqueueRestriction(operation) {
    const result = this.restrictionQueue.then(operation);
    this.restrictionQueue = result.catch(() => {});
    return result;
  }

  async toggleActorRestriction(actor) {
    if (!game.user.isGM || !game.settings.get(ID, 'restrictionMode')) return;
    const owners = game.users.filter(user => !user.isGM && user.role > 0 && actor.testUserPermission(user, 'OWNER')).map(user => user.id);
    if (!owners.length) { ui.notifications.warn('该角色没有可限制的玩家拥有者。'); return; }
    const current = new Set(game.settings.get(ID, 'restrictedPlayers'));
    const remove = owners.some(id => current.has(id));
    for (const id of owners) remove ? current.delete(id) : current.add(id);
    await setRestrictedPlayers([...current]);
  }

  async setScale(value) {
    await game.settings.set(ID, 'partyScale', normalizePartyScale(value));
  }

  openSizePopover() {
    if (this.sizePopover) return;
    const popover = document.createElement('div');
    popover.className = 'bg3-scale-popover cp-party-size-popover';
    popover.setAttribute('role', 'group');
    popover.setAttribute('aria-label', '队伍总览大小');
    popover.innerHTML = '<label>队伍总览大小 <output data-party-size-output></output></label><input type="range" min="50" max="160" step="1" aria-label="队伍总览缩放百分比" data-party-size-range><div class="bg3-scale-footer"><small>随窗口自动适配</small><button type="button" data-party-size-reset>恢复 100%</button><button type="button" data-party-size-close>完成</button></div>';
    document.body.appendChild(popover);
    this.sizePopover = popover;
    const anchor = this.el.querySelector('[data-party-action="size"]').getBoundingClientRect();
    this.sizeAnchor = {right: anchor.right, bottom: anchor.bottom};
    const apply = value => this.setScale(value).catch(error => ui.notifications.error(error.message));
    popover.querySelector('input').addEventListener('input', event => { void apply(Number(event.target.value) / 100); });
    popover.querySelector('[data-party-size-reset]').onclick = () => { void apply(1); };
    popover.querySelector('[data-party-size-close]').onclick = () => this.closeSizePopover();
    this.syncSizePopover(); this.positionSizePopover(); this.schedule();
    popover.querySelector('input').focus({preventScroll: true});
  }

  syncSizePopover() {
    if (!this.sizePopover) return;
    const percent = Math.round(normalizePartyScale(game.settings.get(ID, 'partyScale')) * 100);
    this.sizePopover.querySelector('input').value = percent;
    this.sizePopover.querySelector('output').textContent = `${percent}%`;
  }

  positionSizePopover() {
    if (!this.sizePopover) return;
    const rect = this.sizeAnchor ?? this.el.querySelector('[data-party-action="size"]')?.getBoundingClientRect();
    if (!rect) return;
    this.sizePopover.style.left = `${Math.max(8, Math.min(rect.right - this.sizePopover.offsetWidth, innerWidth - this.sizePopover.offsetWidth - 8))}px`;
    this.sizePopover.style.top = `${Math.max(8, Math.min(rect.bottom + 7, innerHeight - this.sizePopover.offsetHeight - 8))}px`;
  }

  closeSizePopover() {
    if (!this.sizePopover) return;
    this.sizePopover.remove(); this.sizePopover = null; this.sizeAnchor = null; this.schedule();
  }
}

export function installPartyPanel() {
  const panel = new PartyPanel();
  const module = game.modules.get(ID);
  module.api = {...module.api, party: panel, movement: {mode: movementMode, set: setMovementMode, canMove: canMoveToken}, restrictions: {isRestricted: isPlayerRestricted, set: setRestrictedPlayers, mode: () => game.settings.get(ID, 'restrictionMode'), setMode: setRestrictionMode}};
  return panel;
}
