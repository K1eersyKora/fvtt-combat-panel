import {getController} from './parent-ui-1.js';
import {isStoryPlayer,isStoryActive} from './story-state-2.js';
const ID = 'fvtt-party-tools';
let controller;

export function isPlayerRestricted(user = game.user) {
  return !!user && !user.isGM && !isStoryActive() && game.settings.get(ID, 'restrictionMode') && game.settings.get(ID, 'restrictedPlayers').includes(user.id);
}

export function registerRestrictionSetting() {
  game.settings.register(ID, 'restrictionMode', {
    scope: 'world', config: false, type: Boolean, default: false,
    onChange: () => { controller?.refresh(); Hooks.callAll('combatPanelPartyChanged'); }
  });
  game.settings.register(ID, 'restrictedPlayers', {
    scope: 'world', config: false, type: Array, default: [],
    onChange: () => { controller?.refresh(); Hooks.callAll('combatPanelPartyChanged'); }
  });
}

export async function setRestrictedPlayers(ids) {
  if (!game.user.isGM) throw new Error('只有主持人可以设置完全限制。');
  const allowed = new Set(game.users.filter(u => !u.isGM && u.role > 0).map(u => u.id));
  const selected = [...new Set(ids)].filter(id => allowed.has(id));
  if (selected.length && !game.settings.get(ID, 'restrictionMode')) await game.settings.set(ID, 'restrictionMode', true);
  await game.settings.set(ID, 'restrictedPlayers', selected);
  return selected;
}

export async function setRestrictionMode(enabled) {
  if (!game.user.isGM) throw new Error('只有主持人可以设置完全限制。');
  // Every entry starts empty; every exit unlocks everybody.
  await game.settings.set(ID, 'restrictedPlayers', []);
  await game.settings.set(ID, 'restrictionMode', !!enabled);
  return !!enabled;
}

export class InteractionLock {
  constructor() {
    controller = this;
    this.locked = false;
    this.savedFocus = null;
    this.overlay = document.createElement('dialog');
    this.overlay.id = 'cp-interaction-lock';
    this.overlay.hidden = true;
    this.overlay.tabIndex = -1;
    this.overlay.setAttribute('role', 'status');
    this.overlay.setAttribute('aria-label', '主持人已启用完全限制');
    this.overlay.setAttribute('aria-live', 'assertive');
    this.overlay.innerHTML = '<div class="cp-lock-notice"><i class="fas fa-lock" aria-hidden="true"></i><strong>完全限制中</strong><span>主持人已暂时关闭你的操作权限</span><small>可继续观看场景，解除后自动恢复操作</small></div>';
    document.body.appendChild(this.overlay);
    const stopInput = event => {
      if (!isPlayerRestricted()) return;
      // Browser reload remains available so a reconnect never traps the client.
      if (event.type.startsWith('key') && (event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 'r'))) return;
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const event of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'dragstart', 'dragover', 'drop', 'keydown', 'keyup', 'keypress', 'wheel', 'submit', 'beforeinput', 'paste', 'cut']) {
      window.addEventListener(event, stopInput, {capture: true, passive: false});
    }
    const reject = () => isPlayerRestricted() ? false : undefined;
    // Document hooks cover direct native updates as well as sheets, macros and
    // module actions initiated on this client, including embedded documents.
    for (const type of Object.keys(CONFIG).filter(key => CONFIG[key]?.documentClass)) {
      for (const verb of ['Create', 'Update', 'Delete']) Hooks.on(`pre${verb}${type}`, reject);
    }
    Hooks.on('preMoveToken', reject);
    for (const hook of [
      'dnd5e.preUseActivity', 'dnd5e.preUseItem', 'dnd5e.preRollAttack', 'dnd5e.preRollDamage',
      'dnd5e.preRollAbilityCheck', 'dnd5e.preRollAbilitySave', 'dnd5e.preRollSkill',
      'dnd5e.preRollToolCheck', 'dnd5e.preRollDeathSave', 'dnd5e.preRollInitiative',
      'dnd5e.preShortRest', 'dnd5e.preLongRest', 'midi-qol.preTargeting',
      'midi-qol.preItemRoll', 'midi-qol.preAttackRoll', 'midi-qol.preDamageRoll'
    ]) Hooks.on(hook, reject);
    if (game.modules.get('lib-wrapper')?.active) {
      libWrapper.register(ID, 'Macro.prototype.execute', function(wrapped, ...args) {
        if (isPlayerRestricted() || isStoryPlayer()) return;
        return wrapped(...args);
      }, 'MIXED');
    }
    Hooks.on('updateUser', () => this.refresh());
    Hooks.on('combatPanelStoryChanged', () => this.refresh());
    this.refresh();
  }

  refresh() {
    const next = isPlayerRestricted();
    if (next === this.locked) return;
    this.locked = next;
    this.overlay.hidden = !next;
    if (next && !this.overlay.open) this.overlay.showModal();
    else if (!next && this.overlay.open) this.overlay.close();
    document.body.classList.toggle('cp-player-restricted', next);
    if (next) {
      this.savedFocus = document.activeElement;
      this.savedFocus?.blur?.();
      // Cancel selections and our own unfinished workflow before input is frozen.
      const panel = getController();
      const hud = panel?.hud;
      hud?.audio?.stop();
      for (const session of hud?._sessions?.values() ?? []) {
        if (session.busy) Promise.resolve(hud.abortActive(session)).catch(console.error);
      }
      if (!hud?.busy) hud?.cancel(false);
      panel?._cancelDrag?.();
      canvas?.tokens?.releaseAll();
      for (const token of game.user.targets ?? []) token.setTarget(false, {releaseOthers: false});
      canvas?.mouseInteractionManager?.cancel?.();
      this.overlay.focus({preventScroll: true});
    } else if (this.savedFocus?.isConnected) {
      this.savedFocus.focus?.({preventScroll: true});
      this.savedFocus = null;
    }
  }
}
