import { active3D } from './combat-space-2.js';

const MAP_MODULE = 'fvtt-seagrow-caves';
const maps = new Set(['seagrow', 'rest', 'obs', 'wood']);

export function stormwreck3D() {
  return active3D() && game.world?.id === 'seagrow-caves-lab' && game.modules.get(MAP_MODULE)?.active
    && maps.has(canvas.scene.getFlag(MAP_MODULE, 'map'));
}

export function sceneDistanceUnits() {
  const units = canvas.scene.grid.units;
  return !units || /^(ft|feet|foot|尺|英尺)$/i.test(units) ? '尺' : units;
}
