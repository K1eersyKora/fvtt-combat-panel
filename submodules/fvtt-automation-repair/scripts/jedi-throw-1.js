const isThrow = activity => activity?.item?.system.identifier === 'force-harmony'
  && activity.type === 'save' && (activity.id === 'act1y6xtsv000000' || activity.name === '隔空御剑');
const probing = new WeakSet();
const confirmed = new WeakMap();

export function throwSourcePatch(item) {
  const patch = {};
  if (item.system?.identifier !== 'force-harmony') return patch;
  for (const [id, activity] of Object.entries(item.system.activities ?? {})) {
    if (activity.type !== 'save' || (id !== 'act1y6xtsv000000' && activity.name !== '隔空御剑')) continue;
    const key = `system.activities.${id}.`;
    if (!activity.range?.override || activity.range.units !== 'self' || String(activity.range.value ?? '') !== '') {
      patch[key + 'range.override'] = true;
      patch[key + 'range.units'] = 'self';
      patch[key + 'range.value'] = '';
    }
    const special = String(activity.target?.affects?.special ?? '').split(';').map(s => s.trim()).filter(Boolean);
    if (!special.includes('-self') || special.includes('+self')) patch[key + 'target.affects.special'] = [...special.filter(s => !['+self', '-self'].includes(s)), '-self'].join(';');
  }
  return patch;
}

// Use the system's ray geometry. Only the pointer changes its direction.
async function aim(template, token) {
  const layer = canvas.activeLayer, sheet = template.actorSheet;
  const openSheet = sheet?.rendered && !sheet.minimized;
  const view = canvas.app.view;
  const activity = template.activity;
  // Hovering a disposable preview must not replace the player's existing targets.
  template.activity = new Proxy(activity, {get(target, key) {
    return key === 'midiProperties' ? {...target.midiProperties, autoTargetAction:'none'} : Reflect.get(target, key, target);
  }});
  let move, click, cancel, escape, tearDown;
  try {
    await template.draw();
    canvas.templates.activate();
    canvas.templates.preview.addChild(template);
    template.eventMode = 'none';
    if (openSheet) await sheet.minimize();
    ui.notifications.info('隔空御剑：移动鼠标调整方向，左键施放，右键取消。');
    const pointAt = point => {
      const {x, y} = token.center;
      const direction = Math.atan2(point.y - y, point.x - x) * 180 / Math.PI;
      template.document.updateSource({x, y, direction});
      template._refreshShape();
      template.refresh();
      return direction;
    };
    const position = event => {
      const rect = view.getBoundingClientRect(), screen = canvas.app.screen;
      return canvas.stage.toLocal({x:(event.clientX - rect.left) * screen.width / rect.width, y:(event.clientY - rect.top) * screen.height / rect.height});
    };
    pointAt(canvas.mousePosition ?? token.center);
    return await new Promise(resolve => {
      move = event => pointAt(position(event));
      click = event => {
        if (event.button !== 0 && event.button !== 2) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        resolve(event.button === 0 ? pointAt(position(event)) : null);
      };
      cancel = event => {event.preventDefault(); event.stopImmediatePropagation(); resolve(null);};
      escape = event => {if (event.key === 'Escape') cancel(event);};
      tearDown = Hooks.on('canvasTearDown', () => resolve(null));
      view.addEventListener('pointermove', move, true);
      view.addEventListener('pointerdown', click, true);
      view.addEventListener('contextmenu', cancel, true);
      window.addEventListener('keydown', escape, true);
    });
  } finally {
    view.removeEventListener('pointermove', move, true);
    view.removeEventListener('pointerdown', click, true);
    view.removeEventListener('contextmenu', cancel, true);
    window.removeEventListener('keydown', escape, true);
    if (tearDown !== undefined) Hooks.off('canvasTearDown', tearDown);
    canvas.interface?.grid?.destroyHighlightLayer?.(template.highlightId);
    template.parent?.removeChild(template);
    template.destroy();
    if (canvas.ready) layer?.activate();
    if (openSheet && sheet.rendered) await sheet.maximize();
  }
}

export async function prepareJediThrow(workflow, usage) {
  const activity = workflow?.activity;
  if (!isThrow(activity) || usage.create === false || usage.create?.measuredTemplate === false) return;
  const token = workflow.token;
  if (!token?.center || !canvas.ready) {ui.notifications.warn('请先在场景中选择施放隔空御剑的棋子。'); return false;}
  let template;
  probing.add(activity);
  try { [template] = game.dnd5e.canvas.AbilityTemplate.fromActivity(activity) ?? []; }
  finally { probing.delete(activity); }
  if (!template) return false;
  // The battle HUD already bound its confirmed placement to this particular use.
  if (Object.hasOwn(template, 'drawPreview')) {template.destroy(); return;}
  const direction = await aim(template, token);
  if (direction === null || token.destroyed) return false;
  usage.jediThrowAim = {token: token.document.uuid, direction};
}

export function registerJediThrow() {
  Hooks.on('preCreateItem', item => {
    const patch = throwSourcePatch(item._source);
    if (Object.keys(patch).length) item.updateSource(patch);
  });
  Hooks.on('preCreateActor', actor => {
    const items = actor._source.items ?? [];
    if (!items.some(i => i.system?.identifier === 'force-harmony')) return;
    let changed = false;
    const next = items.map(item => {
      const patch = throwSourcePatch(item);
      if (!Object.keys(patch).length) return item;
      changed = true;
      return foundry.utils.mergeObject(item, patch, {inplace:false});
    });
    if (changed) actor.updateSource({items:next});
  });
  Hooks.on('dnd5e.preUseActivity', (activity, usage) => {
    if (isThrow(activity) && usage.jediThrowAim) confirmed.set(activity.item, usage.jediThrowAim);
  });
  Hooks.on('dnd5e.createActivityTemplate', (activity, templates) => {
    if (!isThrow(activity) || probing.has(activity)) return;
    for (const template of templates) template.drawPreview = async () => {
      const point = confirmed.get(activity.item);
      const token = point ? fromUuidSync(point.token)?.object : activity.actor?.getActiveTokens()?.find(t => t.controlled) ?? activity.actor?.getActiveTokens()?.[0];
      if (!token?.center || token.document.parent !== canvas.scene) return [];
      const data = template.document.toObject();
      const direction = point ? point.direction : await aim(template, token);
      if (direction === null) return [];
      return canvas.scene.createEmbeddedDocuments('MeasuredTemplate', [{...data, x:token.center.x, y:token.center.y, direction}]);
    };
  });
}
