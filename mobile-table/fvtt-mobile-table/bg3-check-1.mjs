// Project only the current player's rendered BG3 controls. The desktop dialog
// remains authoritative for target permissions, bonuses, timers and settlement.
const label = (root, selector) => root.querySelector(selector)?.textContent.trim().replace(/\s+/g, ' ').slice(0, 200) || '';

function controls(root, selector, type, index) {
  return [...root.querySelectorAll(selector)].flatMap(button => {
    const value = button.dataset[index];
    if (!/^\d{1,3}$/.test(value || '')) return [];
    const text = type === 'tab' ? button.textContent.trim() :
      [label(button, '.bg3-bonus-name'), label(button, '.bg3-bonus-value'), label(button, '.bg3-bonus-owner')].filter(Boolean).join(' · ');
    return [{
      key: type + ':' + value, text: text.slice(0, 160), disabled: button.disabled,
      selected: type === 'tab' ? button.getAttribute('aria-current') === 'step' : button.getAttribute('aria-pressed') === 'true',
      button
    }];
  });
}

export class PlayerCheckBridge {
  #ids = new WeakMap();

  #read() {
    if (game.user?.isGM) return null;
    const candidates = [...document.querySelectorAll('.bg3-player-overlay [data-rows]')];
    const root = candidates.reverse().find(element => {
      const dialog = element.closest('dialog');
      return dialog?.open && element.getClientRects().length && label(element, '[data-check-title]');
    });
    if (!root) return null;
    if (!this.#ids.has(root)) this.#ids.set(root, foundry.utils.randomID());

    const buttons = [
      ...controls(root, 'button[data-act="tab"]', 'tab', 'check'),
      ...controls(root, 'button[data-act="source"]', 'source', 'source'),
      ...controls(root, 'button[data-act="helper"]', 'helper', 'helper')
    ];
    const roll = root.querySelector('button.bg3-focus-roll[data-act="roll"]');
    if (roll) buttons.push({key:'roll',text:label(roll,'[data-roll-label]') || '掷骰',disabled:roll.disabled,button:roll});
    return {
      id: this.#ids.get(root), row: root.querySelector('.bg3-focus-check')?.dataset.index || '',
      title: label(root, '[data-check-title]'), actor: label(root, '[data-actor]'),
      dc: label(root, '[data-dc]'), mode: label(root, '[data-mode-label]'),
      timer: root.querySelector('.bg3-check-countdown')?.hidden ? '' : label(root, '.bg3-timer'),
      total: label(root, '[data-total]'),
      notice: label(root, '[data-notice]'), result: label(root, '[data-result]'), buttons
    };
  }

  snapshot() {
    const prompt = this.#read();
    if (!prompt) return null;
    return {...prompt, buttons:prompt.buttons.map(({button, ...view})=>view)};
  }

  choose({promptId, row, key, selected}) {
    const prompt = this.#read();
    if (!prompt || prompt.id !== promptId || prompt.row !== row) throw Error('检定窗口已更新，请重新确认');
    const control = prompt.buttons.find(option => option.key === key);
    if (!control || control.disabled || !control.button.isConnected) throw Error('这项检定操作已不可用');
    if (typeof control.selected === 'boolean' && control.selected !== selected) throw Error('检定选项已变化，请重新确认');
    control.button.click();
    return {ok:true};
  }
}
