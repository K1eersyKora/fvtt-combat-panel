// Keep the interactive arc outside the portrait itself. The hole in the CSS
// clip path also leaves the portrait's character-sheet click target intact.
const NS = 'http://www.w3.org/2000/svg';
export function createMovementToggle({ onClick,onJump }) {
  const button = document.createElement('button');
  button.id = 'mcb-move-toggle'; button.dataset.testid = 'mcb-move-toggle'; button.type = 'button';
  button.hidden = true; button.addEventListener('click', onClick);
  button.innerHTML = `<svg class="mcb-move-arc" xmlns="${NS}" aria-hidden="true"><defs><linearGradient id="mcb-move-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient><path id="mcb-move-label-path"/></defs><path class="mcb-move-band"/><text><textPath href="#mcb-move-label-path" startOffset="50%" text-anchor="middle"></textPath></text></svg><span class="mcb-move-fallback" aria-hidden="true">M</span>`;
  document.body.append(button);
  const jump=document.createElement('button');
  jump.id='mcb-jump-toggle';jump.type='button';jump.textContent='跳跃';jump.hidden=true;
  jump.setAttribute('aria-label','跳跃');jump.setAttribute('aria-pressed','false');
  jump.title='选中落点跳跃 · 战斗中消耗附赠动作与移动力 · 右键取消';
  jump.style.cssText='position:fixed;z-index:75;width:45px;height:25px;border:1px solid #b49b67;border-radius:10px;background:#282823;color:#ecdfbf;font:600 12px sans-serif;line-height:22px;padding:0;pointer-events:auto;';
  jump.addEventListener('click',onJump);document.body.append(jump);
  const svg = button.querySelector('svg'), band = button.querySelector('.mcb-move-band');
  const textPath = button.querySelector('textPath'), labelPath = button.querySelector('#mcb-move-label-path');
  let state = { available: false }, root, portrait, frame = null, geometry = '';
  const setStyle = (key, value) => { if (button.style[key] !== value) button.style[key] = value; };
  const schedule = () => { if (frame === null) frame = requestAnimationFrame(layout); };
  const sizeObserver = new ResizeObserver(schedule);
  const treeObserver = new MutationObserver(schedule);
  const rootObserver = new MutationObserver(schedule);
  const bodyObserver = new MutationObserver(schedule);
  bodyObserver.observe(document.body, { childList: true });
  window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
  function layout() {
    frame = null;
    jump.hidden=!state.available;
    const nextRoot = document.getElementById('dsh-bg3-hud');
    if (root !== nextRoot) {
      treeObserver.disconnect(); rootObserver.disconnect(); root = nextRoot;
      if (root) {
        treeObserver.observe(root, { childList: true, subtree: true });
        rootObserver.observe(root, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      }
    }
    const nextPortrait = root?.querySelector('.bg3-portrait-ring');
    if (portrait !== nextPortrait) {
      sizeObserver.disconnect(); portrait = nextPortrait;
      if (portrait) sizeObserver.observe(portrait);
      if (root) sizeObserver.observe(root);
    }
    if (!state.available) { button.hidden = true; return; }
    const rect = portrait?.getBoundingClientRect();
    const visible = rect?.width > 10 && rect.height > 10 && portrait.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true });
    if (!visible) {
      // With the combat HUD present, select a character to reveal its arc.
      // Standalone MC still offers a small M control above the player list.
      button.hidden = !!root;
      jump.hidden=!!root||!state.available;
      if (!root) {
        button.dataset.anchor = 'fallback'; setStyle('clipPath', 'none');
        const players = document.getElementById('players')?.getBoundingClientRect();
        setStyle('left', '68px'); setStyle('top', `${Math.max(40, Math.min(innerHeight - 54, (players?.top || innerHeight - 12) - 44))}px`);
        jump.style.left='17px';jump.style.top=button.style.top;
        setStyle('width', '36px'); setStyle('height', '36px');
      }
      return;
    }
    button.hidden = false; button.dataset.anchor = 'portrait';
    const gap = Math.max(2, rect.width * .025), thickness = Math.max(14, Math.min(22, rect.width * .19));
    const ix = rect.width / 2 + gap, iy = rect.height / 2 + gap;
    const ox = ix + thickness, oy = iy + thickness, w = ox * 2, h = oy + 1;
    const n = value => Math.round(value * 100) / 100;
    const signature = `${n(rect.width)},${n(rect.height)}:${textPath.textContent}`;
    if (geometry !== signature) {
      geometry = signature;
      const fontSize = Math.max(9, Math.min(12, thickness * .62)), radiusX = ix + thickness / 2 - fontSize * .32 - 1, radiusY = iy + thickness / 2 - fontSize * .32 - 1;
      svg.setAttribute('viewBox', `0 0 ${n(w)} ${n(h)}`);
      labelPath.setAttribute('d', `M${n(ox - radiusX)} ${n(oy)} A${n(radiusX)} ${n(radiusY)} 0 0 1 ${n(ox + radiusX)} ${n(oy)}`);
      svg.querySelector('text').setAttribute('font-size', n(fontSize));
      // End the band just beyond the rendered lettering, keeping the same
      // curvature and portrait clearance instead of leaving long empty tails.
      const textLength = textPath.getComputedTextLength();
      const halfAngle = Math.min(Math.PI / 2, (textLength / 2 + 5) / ((radiusX + radiusY) / 2));
      const edge = (rx, ry, side) => `${n(ox + side * rx * Math.sin(halfAngle))} ${n(oy - ry * Math.cos(halfAngle))}`;
      band.setAttribute('d', `M${edge(ox, oy, -1)} A${n(ox)} ${n(oy)} 0 0 1 ${edge(ox, oy, 1)} L${edge(ix, iy, 1)} A${n(ix)} ${n(iy)} 0 0 0 ${edge(ix, iy, -1)} Z`);
    }
    setStyle('clipPath', `path("${band.getAttribute('d')}")`);
    setStyle('width', `${n(w)}px`); setStyle('height', `${n(h)}px`);
    setStyle('left', `${n(rect.left + rect.width / 2 - ox)}px`);
    setStyle('top', `${n(rect.top + rect.height / 2 - oy)}px`);
    jump.style.left=Math.max(3,rect.left+rect.width/2-ox-48)+'px';
    jump.style.top=Math.max(3,rect.top+rect.height/2-oy+3)+'px';
  }
  return {
    update(next) {
      jump.dataset.active=String(!!next.jump);jump.setAttribute('aria-pressed',String(!!next.jump));jump.style.background=next.jump?'#34695d':'#282823';
      jump.hidden=!next.available;jump.disabled=!!next.moving;
      if(next.jumpLimits){const v=next.jumpLimits;jump.title=(v.running?'助跑':'原地')+'跳跃：最高 '+v.height+' 尺，最远 '+v.length+' 尺。战斗中消耗附赠动作和移动力。';}
      const changed = state.available !== next.available || state.enabled !== next.enabled || state.moving !== next.moving || state.stopping !== next.stopping;
      state = next;
      if (changed) {
        button.dataset.active = String(!!state.enabled); button.dataset.moving = String(!!state.moving);
        button.setAttribute('aria-pressed', String(!!state.enabled));
        const label = state.stopping ? '正在落脚' : state.moving ? '停止移动' : `一键移动 · ${state.enabled ? '开' : '关'}`;
        textPath.textContent = label;
        button.setAttribute('aria-label', label.replace(' · ', '：'));
        button.title = `${label}；M切换，Esc停止。选中角色后指向地形预览，单击移动。`;
        schedule();
      }
    },
    refresh: schedule,
    destroy() {
      sizeObserver.disconnect(); treeObserver.disconnect(); rootObserver.disconnect(); bodyObserver.disconnect();
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
      if (frame !== null) cancelAnimationFrame(frame); button.remove();jump.remove();
    },
  };
}
