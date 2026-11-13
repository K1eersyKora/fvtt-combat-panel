const ID = 'fvtt-combat-panel';
export const PERFORMANCE_HOOK = 'combatPanelPerformanceChanged';
export const PERFORMANCE_LABELS = Object.freeze({auto:'自动',low:'低配',full:'完整'});

/** Hardware hints select a starting point; each client can override it. */
export function resolvePerformance(mode = 'auto', {cores = 0, memory = 0, reducedMotion = false} = {}) {
  if (!Object.hasOwn(PERFORMANCE_LABELS, mode)) mode = 'auto';
  const low = mode === 'low' || (mode === 'auto' &&
    ((cores > 0 && cores <= 4) || (memory > 0 && memory <= 4) || reducedMotion));
  return Object.freeze({mode, effective:low?'low':'full', low, animate:!low&&!reducedMotion});
}

let current = resolvePerformance();
export const readPerformance = () => current;
export const isLowPerformance = () => current.low;

export function applyPerformance() {
  const next = resolvePerformance(game.settings.get(ID,'performanceMode'), {
    cores:Number(navigator.hardwareConcurrency)||0,
    memory:Number(navigator.deviceMemory)||0,
    reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches
  });
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  current = next;
  document.documentElement.dataset.cpPerformance = next.effective;
  document.documentElement.dataset.cpMotion = next.animate?'animated':'static';
  if (changed) Hooks.callAll(PERFORMANCE_HOOK, next);
  return next;
}

export function registerPerformanceSettings() {
  game.settings.register(ID,'performanceMode', {
    name:'界面性能',
    hint:'仅当前客户端。自动：按处理器线程、内存提示和减少动态效果偏好选择。低配：关闭模糊、追光、动态配色和额外 3D 骰盘，保留原生结算。',
    scope:'client',config:true,type:String,choices:PERFORMANCE_LABELS,default:'auto',onChange:applyPerformance
  });
}

export function installPerformance() {
  applyPerformance();
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change',applyPerformance);
  Hooks.once('shutdown',()=>media.removeEventListener('change',applyPerformance));
}
