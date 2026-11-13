import { AreaAim, prepareAreaActivity } from './area-targeting-173.js';

/** Fixed, self-centred areas whose eligible creatures are selected individually. */
export function areaChoicePlan(item, activity) {
  const target = activity?.target;
  const count = String(target?.affects?.count ?? '').trim();
  if (!target || activity.range?.units !== 'self'
    || !['radius', 'squareRadius', 'emanation'].includes(target.template?.type)
    || !(Number(target.template.size) > 0)
    || (count !== '' && Number(count) !== 0)
    || !['creature', 'ally', 'enemy', 'willing'].includes(target.affects?.type)) return null;
  const identity = [item?.system?.identifier, item?.flags?.['chris-premades']?.info?.identifier, item?.name]
    .filter(Boolean).join('|').toLowerCase().replace(/[\s_-]/g, '');
  // CPR 1.3.167's 2024 card uses choice:false even though this feature allows a choice.
  const radiance = /radianceofthedawn|黎明曙光/.test(identity)
    && item?.system?.source?.rules === '2024';
  if (!target.affects.choice && !radiance) return null;
  return {areaChoice: true, repeat: false, max: Infinity, spell: 'areaChoice'};
}

export class AreaChoiceAim extends AreaAim {
  async start() {
    await super.start();
    if (!this.disposed) this.refresh({force: true});
  }

  refresh({force = false} = {}) {
    if (this.disposed || !this.hud.panel.token || !this.objects[0]?.shape) return;
    if (!force && performance.now() - (this.lastRefresh || 0) < 100) return;
    this.lastRefresh = performance.now();
    // AreaAim anchors self-range areas to the source token. The pointer is immaterial.
    super.move({clientX: 0, clientY: 0}, {force: true});
  }

  move() { this.refresh(); }
  rotate() {}
  // Keep the range visible while the pointer is over the confirmation button.
  hide() {}

  accepts(token, {refresh = true} = {}) {
    if (refresh) this.refresh({force: true});
    return !!token?.actor && !token.destroyed && token.visible && token.isVisible !== false
      && this.targets.some(candidate => candidate.id === token.id);
  }
}

/** Preserve the native template and CPR macros, while retaining the HUD's chosen set. */
export function prepareAreaChoiceActivity(activity) {
  const prepared = prepareAreaActivity(activity);
  const prefix = `system.activities.${activity.id}`;
  const changes = {
    [`${prefix}.target.override`]: true,
    [`${prefix}.target.prompt`]: false,
    [`${prefix}.target.affects.choice`]: false,
    [`${prefix}.midiProperties.autoTargetAction`]: 'none',
    [`${prefix}.midiProperties.confirmTargets`]: 'never'
  };
  // CPR normally persists this switch on first use. Apply its same policy to this
  // use's clone so that selecting an area does not rewrite the owned activity.
  const source = prepared.item.flags?.['chris-premades']?.info?.source;
  if (['chris-premades', 'gambits-premades', 'midi-item-showcase-community', 'automated-crafted-creations'].includes(source)) {
    changes[`${prefix}.midiProperties.autoCEEffects`] = 'none';
  }
  const clone = prepared.item.clone(changes, {keepId: true});
  return clone.system.activities.get(activity.id);
}
