import {ID} from './scene-view-1.js';
import {ORIGINAL_PLAYBACK_RATE, setVideoPlaybackRate} from './animation-rate-1.js';

let sequencerInstalled = false;
let sceneAssetsInstalled = false;
let particlesInstalled = false;
const originalVideoRates = new WeakMap();
const installedTokenTypes = new WeakSet();

function stormwreck(scene = canvas?.scene) {
  return !!scene?.getFlag('fvtt-seagrow-caves', 'map');
}

function syncSceneVideo(video, enabled) {
  if (!(video instanceof HTMLVideoElement)) return;
  if (enabled) {
    if (!originalVideoRates.has(video)) {
      originalVideoRates.set(video, [video.defaultPlaybackRate, video.playbackRate]);
    }
    setVideoPlaybackRate(video);
  } else {
    const original = originalVideoRates.get(video);
    if (!original) return;
    [video.defaultPlaybackRate, video.playbackRate] = original;
    originalVideoRates.delete(video);
  }
}

function effectUsesSceneRate(data) {
  const scene = data?.sceneId ? game.scenes.get(data.sceneId) : canvas?.scene;
  return !!data && !!scene && stormwreck(scene);
}

function installSequencerRate() {
  if (sequencerInstalled || !globalThis.Sequencer?.EffectManager?._playEffect) return;
  // Both replayed persistent effects and remote packets enter this dispatcher.
  // Set the rate before Sequencer computes the clip duration and stage waits.
  libWrapper.register(ID, 'Sequencer.EffectManager._playEffect', function (wrapped, data, ...rest) {
    if (effectUsesSceneRate(data) && data.playbackRate !== ORIGINAL_PLAYBACK_RATE) {
      data = {...data, playbackRate: ORIGINAL_PLAYBACK_RATE};
    }
    return wrapped(data, ...rest);
  }, 'WRAPPER');
  sequencerInstalled = true;
}

function installFoundryRates() {
  libWrapper.register(ID, 'foundry.helpers.media.VideoHelper.prototype.play', function (wrapped, video, ...rest) {
    syncSceneVideo(video, stormwreck());
    return wrapped(video, ...rest);
  }, 'WRAPPER');
  libWrapper.register(ID, 'CONFIG.Token.objectClass.prototype._getAnimationDuration', function (wrapped, from, to, options) {
    const duration = wrapped(from, to, options);
    // Map movement and jump already provide a doubled explicit visual speed.
    return stormwreck(this.document.parent) && options?.duration == null && options?.movementSpeed == null
      ? duration / ORIGINAL_PLAYBACK_RATE : duration;
  }, 'WRAPPER');
}

function install3DAssetRates() {
  if (sceneAssetsInstalled || !game.Levels3DPreview?.helpers) return;
  const levels = 'game.Levels3DPreview';
  libWrapper.register(ID, levels + '.helpers.constructor.prototype.loadTexture', async function (wrapped, ...args) {
    const texture = await wrapped(...args);
    syncSceneVideo(texture?.image, stormwreck());
    return texture;
  }, 'WRAPPER');
  libWrapper.register(ID, levels + '.THREE.AnimationMixer.prototype.update', function (wrapped, delta) {
    // Three.js applies timeScale internally. Normalize the effective rate
    // while preserving paused and reverse actions.
    if (stormwreck() && this.timeScale) delta *= ORIGINAL_PLAYBACK_RATE / Math.abs(this.timeScale);
    return wrapped(delta);
  }, 'WRAPPER');
  sceneAssetsInstalled = true;
}

function install3DParticleRate() {
  // The particle engine is created when 3D draws its first scene.
  if (particlesInstalled || !game.Levels3DPreview?.particleSystem) return;
  libWrapper.register(ID, 'game.Levels3DPreview.particleSystem.constructor.prototype.update', function (wrapped, delta) {
    return wrapped(stormwreck() ? delta * ORIGINAL_PLAYBACK_RATE : delta);
  }, 'WRAPPER');
  particlesInstalled = true;
}

function installTokenPoseRates(engine) {
  const entity = Object.values(engine.tokens ?? {}).find(token => token?.updateProne);
  if (!entity) return;
  const tokenType = entity.constructor.prototype;
  if (installedTokenTypes.has(tokenType)) return;
  const update = tokenType.updateProne;
  tokenType.updateProne = function (delta) {
    return update.call(this, stormwreck(this.document.parent) ? delta * ORIGINAL_PLAYBACK_RATE : delta);
  };
  installedTokenTypes.add(tokenType);
}

export function installAnimationRate() {
  Hooks.on('preCreateSequencerEffect', data => {
    if (effectUsesSceneRate(data)) data.playbackRate = ORIGINAL_PLAYBACK_RATE;
  });
  Hooks.once('sequencerReady', installSequencerRate);
  Hooks.once('ready', () => {
    installSequencerRate();
    installFoundryRates();
    install3DAssetRates();
    install3DParticleRate();
  });
  Hooks.on('3DCanvasReady', install3DAssetRates);
  Hooks.on('3DCanvasSceneReady', engine => {
    install3DParticleRate();
    installTokenPoseRates(engine);
  });
}
