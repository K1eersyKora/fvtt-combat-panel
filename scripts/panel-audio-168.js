const BASE = 'modules/fvtt-combat-panel/assets/audio/';
const values = collection => Array.from(collection?.contents ?? collection ?? []);

export function preparationType(item, activity) {
  const activities = activity ? [activity] : values(item?.system?.activities);
  if (activities.some(a => a.type === 'heal' || a.type === 'healing')) return 'healing';
  const parts = activities.flatMap(a => values(a.damage?.parts));
  const base = item?.system?.damage?.base;
  if (base) parts.push(base);
  const types = parts.flatMap(p => values(p.types));
  if (types.some(t => t === 'healing' || t === 'temphp')) return 'healing';
  return types.find(t => ['acid','cold','fire','force','lightning','necrotic','poison','psychic','radiant','thunder'].includes(t)) ?? 'force';
}

export class PanelAudio {
  constructor() { this.current = null; this.generation = 0; }

  stop() {
    this.generation++;
    const sound = this.current;
    this.current = null;
    if (!sound) return;
    sound.pause();
    sound.removeAttribute('src');
    sound.load();
  }

  play(file) {
    this.stop();
    const generation = this.generation;
    const sound = new Audio(BASE + file + '.mp3');
    sound.volume = 0.6;
    this.current = sound;
    const clear = () => { if (this.current === sound) this.current = null; };
    sound.addEventListener('ended', clear, { once: true });
    sound.addEventListener('error', clear, { once: true });
    Promise.resolve(sound.play()).then(() => {
      if (generation !== this.generation) sound.pause();
    }).catch(clear);
  }

  prepare(item, activity) {
    if (item?.type === 'spell') this.play('prepare-' + preparationType(item, activity));
  }

  button(button) {
    const filter = button.hasAttribute('data-hud-filter-act') || button.hasAttribute('data-hud-clear-filter');
    const slot = button.hasAttribute('data-hud-filter') || button.hasAttribute('data-hud-option');
    this.play(slot ? 'slot' : filter ? 'filter' : 'click');
  }
}
