import { sceneDistanceUnits } from './stormwreck-view-1.js';

export function setMovementIcon(element, action) {
  if (element.dataset.movementAction === action) return;
  element.dataset.movementAction = action;
  const config = CONFIG.Token.movement.actions[action];
  element.replaceChildren();
  if (!config) return;
  const glyph = document.createElement(config.img ? 'img' : 'i');
  if (config.img) {
    glyph.src = config.img;
    glyph.alt = '';
  } else glyph.className = config.icon ?? '';
  element.append(glyph);
  element.setAttribute('aria-label', game.i18n.localize(config.label));
}

export function formatMovementNumber(distance) {
  return distance === Infinity ? '∞' : String(Math.round(distance * 100) / 100);
}

export function writeMovementMeter(icon, text, {action, used, total}) {
  setMovementIcon(icon, action);
  const value = `${formatMovementNumber(used)} / ${formatMovementNumber(total)} ${sceneDistanceUnits()}`;
  if (text.textContent !== value) text.textContent = value;
}
