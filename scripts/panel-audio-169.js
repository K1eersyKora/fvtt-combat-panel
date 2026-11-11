export { preparationType } from './panel-audio-168.js';
import { preparationType } from './panel-audio-168.js';
const BASE = 'modules/fvtt-combat-panel/assets/audio/';
const TYPES = ['acid','cold','fire','force','lightning','necrotic','poison','psychic','radiant','thunder','healing'];
const LOOP_DB = {acid:-10,cold:-15,fire:-10,force:-8,lightning:-17,necrotic:-10,poison:-10,psychic:-10,radiant:-16,thunder:-10,healing:-9};
const FADE = 0.04;

export class PanelAudio {
  constructor() {
    this.current = null;
    this.generation = 0;
    this.buffers = new Map();
    this.context = null;
    try {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (Context) this.context = new Context();
    } catch (error) { console.warn('[fvtt-combat-panel] Audio context unavailable', error); }
    if (this.context) for (const type of TYPES) {
      void this.buffer(`prepare-${type}.mp3`).catch(() => {});
      void this.buffer(`sustain-${type}.ogg`, true).catch(() => {});
    }
  }

  buffer(file, seamless = false) {
    if (!this.buffers.has(file)) {
      const pending = fetch(BASE + file).then(response => {
        if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
        return response.arrayBuffer();
      }).then(bytes => this.context.decodeAudioData(bytes)).then(buffer => {
        if (!seamless) return buffer;
        // Rotate a short tail/head overlap into the end of the loop. Its wrap
        // then continues between adjacent original samples without a hard edge.
        const overlap = Math.min(Math.round(buffer.sampleRate * FADE), Math.floor(buffer.length / 4));
        const result = this.context.createBuffer(buffer.numberOfChannels, buffer.length - overlap, buffer.sampleRate);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const input = buffer.getChannelData(channel), output = result.getChannelData(channel);
          output.set(input.subarray(overlap));
          for (let i = 0; i < overlap; i++) {
            const weight = i / (overlap - 1);
            output[output.length - overlap + i] = input[input.length - overlap + i] * (1 - weight) + input[i] * weight;
          }
        }
        return result;
      }).catch(error => { this.buffers.delete(file); throw error; });
      this.buffers.set(file, pending);
    }
    return this.buffers.get(file);
  }

  stop() {
    this.generation++;
    const sound = this.current;
    this.current = null;
    if (!sound) return;
    sound.pause();
    sound.removeAttribute?.('src');
    sound.load?.();
  }

  play(file) {
    this.stop();
    const generation = this.generation;
    const sound = new Audio(BASE + file + '.mp3');
    sound.volume = 0.6;
    this.current = sound;
    const clear = () => { if (this.current === sound) this.current = null; };
    sound.addEventListener('ended', clear, {once:true});
    sound.addEventListener('error', clear, {once:true});
    try {
      Promise.resolve(sound.play()).then(() => { if (generation !== this.generation) sound.pause(); }).catch(clear);
    } catch { clear(); }
  }

  prepare(item, activity) {
    if (item?.type !== 'spell') return;
    const type = preparationType(item, activity);
    if (!this.context) { this.play('prepare-' + type); return; }
    this.stop();
    const generation = this.generation, context = this.context;
    const sound = {
      src: BASE + `prepare-${type}.mp3`, paused:false, nodes:[], startedAt:null, loopAt:null,
      pause() {
        this.paused = true;
        for (const node of this.nodes) { try { node.stop?.(); } catch {} node.disconnect(); }
        this.nodes.length = 0;
      },
      get phase() { return this.paused ? 'stopped' : this.loopAt !== null && context.currentTime >= this.loopAt ? 'sustain' : 'prepare'; }
    };
    this.current = sound;
    // Resume is requested synchronously in the input gesture. Both sources are
    // scheduled on one audio clock, so decoding or timers cannot create a gap.
    const resumed = context.state === 'running' ? Promise.resolve() : context.resume();
    sound.ready = Promise.all([resumed, this.buffer(`prepare-${type}.mp3`), this.buffer(`sustain-${type}.ogg`,true)]).then(([,intro,loop]) => {
      if (generation !== this.generation || sound.paused) return;
      const start = context.currentTime + 0.01;
      const fade = Math.min(FADE, intro.duration / 2);
      const end = start + intro.duration, transition = end - fade;
      const introSource = context.createBufferSource(), sustainSource = context.createBufferSource();
      const introGain = context.createGain(), sustainGain = context.createGain();
      sound.nodes.push(introSource,sustainSource,introGain,sustainGain);
      introSource.buffer = intro; sustainSource.buffer = loop; sustainSource.loop = true;
      introSource.connect(introGain).connect(context.destination);
      sustainSource.connect(sustainGain).connect(context.destination);
      introGain.gain.setValueAtTime(0.6,start);
      introGain.gain.setValueAtTime(0.6,transition);
      introGain.gain.linearRampToValueAtTime(0,end);
      sustainGain.gain.setValueAtTime(0,transition);
      sustainGain.gain.linearRampToValueAtTime(0.6 * 10 ** (LOOP_DB[type]/20),end);
      const offset = type === 'healing' ? 0 : Math.max(0,intro.duration - fade - FADE) % loop.duration;
      introSource.start(start); sustainSource.start(transition,offset);
      sound.startedAt = start; sound.loopAt = transition;
    }).catch(error => {
      if (generation !== this.generation) return;
      sound.pause(); this.current = null;
      console.warn('[fvtt-combat-panel] Preparation audio unavailable',error);
    });
  }

  button(button) {
    const filter = button.hasAttribute('data-hud-filter-act') || button.hasAttribute('data-hud-clear-filter');
    const slot = button.hasAttribute('data-hud-filter') || button.hasAttribute('data-hud-option');
    this.play(slot ? 'slot' : filter ? 'filter' : 'click');
  }
}
