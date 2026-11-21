const FRAME_SCALE = 1.66;
const RADIUS_RATIO = 2 / 3;
const MIN_RED_GAP_PX = 3;
const cornerPath = 'M37.5 10 C22 9 9 22 10 37.5 C12.4 23.8 23.8 12.4 37.5 10 Z M33 1 C29.5 18.5 18.5 29.5 1 33 C21.7 32.1 32.1 21.7 33 1 Z';
const arrowPath = 'M10 .4 C12 5.5 11.2 10.7 11 13 C11.2 15.3 12 20.5 10 25.6 C10.1 23.2 9.4 21 9.2 17.8 C6.2 17.1 3 15 .3 13 C3 11 6.2 8.9 9.2 8.2 C9.4 5 10.1 2.8 10 .4 Z M3.9 13 C5.9 14.2 7.7 15.1 9.2 15.4 C9 13.8 9 12.2 9.2 10.6 C7.7 10.9 5.9 11.8 3.9 13 Z';
const arrow = '<svg viewBox="0 0 12 26"><path fill-rule="evenodd" d="'+arrowPath+'"/></svg>';
const corners = ['tl','tr','br','bl'].map(side => '<svg class="cp-lock-'+side+'" viewBox="0 0 38 38"><path d="'+cornerPath+'"/></svg>').join('');

// The outer hull of the double arc is bounded on the facing sides by
// (1,33), (9,22) and their reflections in its 38 x 38 viewBox.
function whiteOuterRadius(w, h, pad) {
  const frameW = w + 2 * pad, frameH = h + 2 * pad;
  const glyphW = Math.min(38, frameW * .39), glyphH = Math.min(38, frameH * .39);
  const unit = Math.min(glyphW, glyphH) / 38;
  const cx = (frameW - glyphW) * RADIUS_RATIO / 2;
  const cy = (frameH - glyphH) * RADIUS_RATIO / 2;
  const major = Math.max(cx, cy), minor = Math.min(cx, cy);
  return Math.max(Math.hypot(major + 18*unit, minor - 14*unit),
    Math.hypot(major + 10*unit, minor - 3*unit));
}

export function isLockTargetVisible(token) {
  return !!token && !token.destroyed && token.visible && (game.user.isGM || (!token.document.hidden && token.isVisible !== false));
}

export class TargetLockFrame {
  constructor(element) {
    this.element = element;
    this.target = null;
    this.retired = new Map();
    element.classList.add('cp-lock-frame');
    element.style.scale = String(FRAME_SCALE * RADIUS_RATIO);
    element.style.setProperty('--cp-lock-glyph-scale', String(1 / RADIUS_RATIO));
    element.setAttribute('aria-hidden','true');
    element.innerHTML = '<div class="cp-lock-capture">'+corners+'<div class="cp-lock-spin">'+arrow+arrow+'</div></div>';
    this.template = element.cloneNode(true);
  }

  show(token) {
    if (this.target === token) return this.element;
    this.hide();
    this.retired.get(token)?.remove();
    this.retired.delete(token);
    this.target = token;
    this.element.classList.remove('dsh-cp-hidden');
    return this.element;
  }

  place(x, y, w, h) {
    if (x === this.x && y === this.y && w === this.w && h === this.h) return this.cardGap;
    const size = Math.min(w, h);
    const pad = Math.min(13, size * 13 / 72);
    const orbitGap = Math.min(16, size * 16 / 72);
    const diameter = Math.max(w,h) + 2 * (pad + orbitGap);
    const arrowHeight = Math.min(26, diameter * .2);
    const halfArrowWidth = arrowHeight * 6 / 26;
    const baseRadius = (diameter / 2 + 4 - halfArrowWidth) * RADIUS_RATIO;
    const orbitRadius = Math.max(baseRadius, whiteOuterRadius(w, h, pad) + halfArrowWidth + MIN_RED_GAP_PX / FRAME_SCALE);
    const offset = 4 + (orbitRadius - baseRadius) / RADIUS_RATIO;
    Object.assign(this.element.style, {left:(x-pad)+'px', top:(y-pad)+'px', width:(w+2*pad)+'px', height:(h+2*pad)+'px'});
    this.element.style.setProperty('--cp-lock-orbit-size',diameter+'px');
    this.element.style.setProperty('--cp-lock-arrow-edge',-offset+'px');
    this.x=x; this.y=y; this.w=w; this.h=h;
    this.cardGap = Math.hypot(orbitRadius + halfArrowWidth, arrowHeight / 2) * FRAME_SCALE - h / 2 + 8;
    return this.cardGap;
  }

  hide(immediate = false) {
    const token = this.target;
    if (!token) return this.element;
    this.target = null;
    this.x = undefined;
    const old = this.element;
    if (immediate || !isLockTargetVisible(token) || document.hidden) {
      old.classList.add('dsh-cp-hidden');
      return old;
    }
    this.element = this.template.cloneNode(true);
    old.removeAttribute('id');
    old.classList.add('cp-lock-leaving');
    old.after(this.element);
    this.retired.set(token,old);
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420;
    const fade = old.animate([{opacity:1},{opacity:0}], {duration,easing:'ease-in-out',fill:'forwards'});
    const finish = () => {
      old.remove();
      if (this.retired.get(token) === old) this.retired.delete(token);
    };
    fade.finished.then(finish,finish);
    return this.element;
  }

  pruneRetired(deleted) {
    for (const [token,frame] of this.retired) {
      if (token.document === deleted || !isLockTargetVisible(token)) {
        frame.remove();
        this.retired.delete(token);
      }
    }
  }

  clear() {
    this.hide(true);
    for (const frame of this.retired.values()) frame.remove();
    this.retired.clear();
  }
}
