import { orientD20TwentyUp } from "./d20-orientation-1.js";
/** Embedded Dice So Nice 5.x tray. Own renderer, factory, worker and ticker context.
 * Never reparent the global board or change a player's saved rollable area.
 * DSN has no public embedded-board API in 5.2.4, so keep the adapter isolated here.
 */
const MODULE_ID = "fvtt-party-tools";
const ROLL_DURATION_MS = 1500;
const useLightweightTray = () => game.modules.get('fvtt-combat-panel')?.api?.ui?.performance?.read?.().animate === false;

export function trayResults(roll) {
  return (roll?.dice??[]).flatMap(term=>(term.results??[])
    .filter(result=>Number.isFinite(result.result)&&(!result.hidden||roll.options?.[MODULE_ID]?.tray))
    .map(result=>({faces:term.faces,value:result.result,discarded:!!result.discarded||!!result.rerolled||result.active===false})));
}
const routed = new WeakSet();
let routingHookRegistered = false;
export function installTrayDiceRouting() {
  if (!routingHookRegistered) {
    routingHookRegistered = true;
    Hooks.on("diceSoNiceReady", installTrayDiceRouting);
  }
  const dsn = game.dice3d;
  if (!dsn?.showForRoll || routed.has(dsn)) return;
  const route = function(wrapped, roll, ...args) {
    if (roll?.options?.[MODULE_ID]?.tray) return Promise.resolve(false);
    return wrapped(roll, ...args);
  };
  if (globalThis.libWrapper) {
    libWrapper.register(MODULE_ID, "game.dice3d.showForRoll", route, "MIXED");
  } else {
    const original = dsn.showForRoll;
    dsn.showForRoll = function(roll, ...args) {
      return route.call(this, original.bind(this), roll, ...args);
    };
  }
  routed.add(dsn);
}
let sequence = 0;
const limit = async (promise, ms = 12000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("3D 骰盘响应超时")), ms);
  })]); } finally { clearTimeout(timer); }
};

export class CheckDiceTray {
  constructor(host) {
    this.host = host;
    this.scope = `bg3-check-${++sequence}`;
    this.disposed = false;
    this.animationGeneration = 0;
    this.ready = this.initialize().catch(error => {
      console.warn("fvtt-party-tools | 3D 骰盘", error);
      this.fallback("3D 骰盘暂不可用");
      return false;
    });
  }

  fallback(label) {
    if (this.disposed) return;
    this.host.dataset.diceState = "unavailable";
    this.host.replaceChildren();
    const hint = document.createElement("span");
    hint.className = "bg3-dice-fallback";
    hint.textContent = label;
    this.host.append(hint);
  }

  async initialize() {
    // This is a presentation choice. Native rolls and their resource handling
    // still run through the same check engine, including discarded dice.
    if (useLightweightTray()) {
      this.lightweight = true;
      this.host.dataset.lightweight = 'true';
      this.host.closest('.bg3-player-overlay')?.setAttribute('data-lightweight-dice','true');
      this.renderLightweight();
      return true;
    }
    const dsn = game.dice3d;
    if (!game.modules.get("dice-so-nice")?.active || !dsn?.box?.dicefactory
      || !dsn.constructor.ALL_CONFIG || !dsn.dice3dRenderers) {
      this.fallback("启用 Dice So Nice! 可显示 3D 骰子");
      return false;
    }
    const original = dsn.box;
    const factory = this.factory = new original.dicefactory.constructor();
    // Presets belong to DSN; resource caches, scale and physics belong to this tray.
    factory.systems = new Map(original.dicefactory.systems);
    factory.preferredSystem = original.dicefactory.preferredSystem;
    factory.preferredColorset = original.dicefactory.preferredColorset;
    const config = this.config = foundry.utils.deepClone(dsn.constructor.ALL_CONFIG(game.user));
    Object.assign(config, {
      boxType: this.scope, dimensions: { width: 640, height: 360 },
      autoscale: false, scale: 100, speed: 1, throwingForce: "strong",
      immersiveDarkness: false, sounds: config.sounds !== false
    });
    if (!game.user.getFlag("dice-so-nice", "appearance")) {
      Object.assign(config.appearance.global, {
        diceColor: "#403b52", labelColor: "#f4eadd", outlineColor: "#1d1828",
        edgeColor: "#978aab", material: "metal", texture: "none", colorset: "custom"
      });
    }
    // Reuse the actual central mesh when the physics board spawns its first d20.
    // This is instance-local; other DSN boards retain their original factory.
    const create = factory.create.bind(factory);
    factory.create = async (...args) => {
      if (this.launchPreview && this.previewMeshes?.length && args[1] === "d20") {
        const mesh = this.previewMeshes.shift();
        this.launchPreview = this.previewMeshes.length > 0;
        const idle = this.idleDice.find(d => d.mesh === mesh);
        mesh.scale.copy(idle.scale);
        mesh.quaternion.copy(idle.quaternion);
        mesh.position.set(0, 0, 0);
        return mesh;
      }
      return create(...args);
    };
    const box = this.box = new original.constructor(this.host, factory, config);
    // DSN's default removal matches a function across ALL boxes. Restrict to ours.
    box.removeTicker = function(fn) { return canvas.app.ticker.remove(fn, this); };
    await limit(box.initialize());
    if (this.disposed) { this.release(); return false; }
    // Initialize as a unique renderer scope, then enable DSN's normal board physics.
    // These assignments touch only the new box and the new factory.
    box.config.boxType = "board";
    box.renderer.scopedTextureCache.type = "board";
    box.physicsWorker = factory.physicsWorker;
    box.allowInteractivity = false;
    box.speed = 1;
    box.updateScale(100, false);
    await limit(box.physicsWorker.exec("init", {
      width: 640, height: 360, margin: { top: 55, bottom: 55, left: 80, right: 80 }
    }));
    box.updateBoundaries({ margin: { top: 55, bottom: 55, left: 80, right: 80 } });
    factory.setScale(120);
    box.display.scale = 120;
    // DSN 5.2.4 uses dimensions as physical HALF-extents and doubles margins.
    // Its normal spawn starts near the full-screen edge; launch inside this tray.
    const getVectors = box.getVectors.bind(box);
    box.getVectors = (...args) => {
      const notation = getVectors(...args);
      let centerUsed = 0;
      for (const [index, die] of notation.dice.entries()) {
        const vector = die.vectors;
        if (this.launchPreview && die.type === "d20" && centerUsed < this.previewMeshes.length) {
          const mesh = this.previewMeshes[centerUsed++];
          vector.pos.x = mesh.position.x; vector.pos.y = mesh.position.y;
          const idle = this.idleDice.find(d => d.mesh === mesh);
          const q = mesh.quaternion.clone().multiply(idle.quaternion.clone().invert()).normalize();
          const angle = 2 * Math.acos(Math.max(-1,Math.min(1,q.w))), sine = Math.sqrt(Math.max(0,1-q.w*q.w));
          vector.axis = sine < 1e-6 ? { x: 0, y: 0, z: 1, a: 0 }
            : { x: q.x/sine, y: q.y/sine, z: q.z/sine, a: angle/(2*Math.PI) };
        }
        const direction = index % 2 ? -1 : 1;
        // Throw across the whole tray, with advantage dice entering from
        // opposite sides. A centre spawn only reaches one wall before settling.
        vector.pos.x = -280 * direction;
        vector.pos.y = -100 * direction;
        vector.pos.z = 120;
        vector.velocity.x = direction * (2600 + Math.random() * 300);
        vector.velocity.y = (Math.random() > .5 ? 1 : -1) * (800 + Math.random() * 180);
        vector.angle = { x: direction * (30 + Math.random() * 12), y: 24 + Math.random() * 12, z: 8 };
      }
      return notation;
    };
    // Fit the full simulated motion, including height and each die's radius.
    // A small tray needs extra headroom when several dice bounce into one another.
    const simulateThrow = box.simulateThrow.bind(box);
    box.simulateThrow = async () => {
      const generation = this.animationGeneration;
      await simulateThrow();
      if (this.disposed || generation !== this.animationGeneration) throw new Error('骰盘动画已取消');
      const tangent = Math.tan(box.camera.fov * Math.PI / 360);
      let distance = box.cameraHeight.far * 0.6;
      for (const die of box.diceList) {
        die.geometry.computeBoundingSphere?.();
        const radius = (die.geometry.boundingSphere?.radius ?? factory.baseScale * 1.5)
          * Math.max(die.scale.x, die.scale.y, die.scale.z);
        const positions = die.sim.stepPositions;
        for (let frame = 0; frame <= box.iterationsNeeded; frame++) {
          const i = frame * 3;
          const view = Math.max((Math.abs(positions[i]) + radius) / (tangent * box.camera.aspect),
            (Math.abs(positions[i + 1]) + radius) / tangent);
          distance = Math.max(distance, positions[i + 2] + radius + view * 1.08);
        }
      }
      box.camera.position.z = distance;
      box.camera.far = Math.max(box.camera.far, distance + 1000);
      box.camera.updateProjectionMatrix();
    };
    // Replay DSN's actual simulated trajectory by elapsed time. Its global speed
    // preference and fractional frame rounding must not shorten this tray roll.
    const animateThrow = box.animateThrow;
    box.animateThrow = function(...args) {
      if (this.rolling) {
        this.trayMotionStartedAt ??= performance.now();
        const progress = Math.min(1, (performance.now() - this.trayMotionStartedAt) / ROLL_DURATION_MS);
        const target = Math.floor(progress * this.iterationsNeeded);
        this.speed = Math.max(0, target - this.iteration);
        this.last_time = Date.now() - this.framerate * 1000 - 1;
      }
      return animateThrow.apply(this, args);
    };
    box.physicsWorker.on("collide", data => box.soundManager.eventCollide(data));
    // Avoid DSN's global special-effect queue cleanup, which belongs to chat rolls.
    box.clearAll = async () => {
      box.removeTicker(box.animateThrow);
      box.running = false;
      box.rolling = false;
      const dice = [...box.diceList, ...box.deadDiceList];
      for (const die of dice) box.scene.remove(die.parent?.type === "Scene" ? die : die.parent);
      box.diceList = [];
      box.deadDiceList = [];
      if (dice.length) await limit(box.physicsWorker.exec("removeDice", dice.map(d => d.id)), 3000);
      box.isVisible = false;
      box.renderScene();
    };
    await limit(factory.preloadPresets(true, game.user.id, config.appearance));
    if (this.disposed) { this.release(); return false; }
    box.renderer.domElement.setAttribute("aria-hidden", "true");
    this.host.dataset.diceState = "loading";
    await this.preview();
    return true;
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.ready) void this.ready.then(() => this.preview()).catch(error => console.warn("fvtt-party-tools | Preview", error));
  }

  preview() {
    const work = (this.previewTask ?? Promise.resolve()).then(() => this.renderPreview());
    this.previewTask = work.catch(() => {});
    return work;
  }

  async renderPreview() {
    if (this.lightweight) { if(!this.disposed)this.renderLightweight();return; }
    if (this.disposed || !this.box?.scene || this.host.dataset.diceState === "rolling" || this.launchPreview) return;
    const box = this.box, count = this.mode === "adv" || this.mode === "dis" ? 2 : 1;
    if (this.host.dataset.diceState === "ready" && this.previewMeshes?.length === count) return;
    this.host.dataset.diceState = "loading";
    for (const mesh of this.previewMeshes ?? []) mesh.parent?.remove(mesh);
    await box.clearAll();
    const appearance = this.factory.getAppearanceForDice(this.config.appearance, "d20");
    this.idleDice ??= [];
    this.previewMeshes = [];
    for (let index = 0; index < count; index++) {
      if (!this.idleDice[index]) {
        const mesh = await this.factory.create(box.renderer.scopedTextureCache, "d20", appearance);
        if (this.disposed || !mesh) return;
        this.idleDice.push({ mesh, scale: mesh.scale.clone(), quaternion: mesh.quaternion.clone() });
      }
      const { mesh, scale } = this.idleDice[index];
      mesh.scale.copy(scale);
      mesh.position.set(count === 2 ? (index ? 112.5 : -112.5) : 0, 0, 0);
      orientD20TwentyUp(mesh);
      box.scene.add(mesh);
      this.previewMeshes.push(mesh);
    }
    box.camera.position.z = box.cameraHeight.far * 0.55;
    box.camera.updateProjectionMatrix();
    box.renderScene();
    this.host.dataset.previewDice = String(count);
    this.host.dataset.diceState = "ready";
  }

  async show(roll) {
    const generation = ++this.animationGeneration;
    this.finishAnimation?.();
    this.finishAnimation = null;
    if (!await this.ready || this.disposed) return false;
    if (this.lightweight) { this.renderLightweight(roll);return true; }
    const box = this.box;
    await this.previewTask;
    if (generation !== this.animationGeneration || this.disposed) return false;
    this.launchPreview = Boolean(this.previewMeshes?.length);
    await box.clearAll();
    if (generation !== this.animationGeneration || this.disposed) return false;
    box.camera.position.z = box.cameraHeight.far * 0.6;
    box.camera.updateProjectionMatrix();
    // Foundry remains the sole source of results. Include discarded advantage dice.
    const dice = [];
    for (const term of roll.dice) {
      for (const result of term.results) {
        // Midi marks native dice hidden after its global display attempt.
        // This dedicated tray consumes the native results, including advantage dice.
        if (result.hidden && !roll.options?.[MODULE_ID]?.tray) continue;
        const type = `d${term.faces}`;
        if (!this.factory.get(type)) continue;
        dice.push({ type, result: result.result, resultLabel: String(result.result),
          discarded: Boolean(result.discarded), vectors: [],
          options: { ...foundry.utils.deepClone(term.options ?? {}), owner: game.user.id } });
      }
    }
    if (!dice.length) return false;
    box.trayMotionStartedAt = null;
    this.host.dataset.diceState = "rolling";
    try {
      await limit(new Promise((resolve, reject) => {
        this.finishAnimation = resolve;
        Promise.resolve(box.start_throw([{ dice, dsnConfig: { appearance: this.config.appearance } }], resolve)).catch(reject);
      }), 2500);
      // Leave the final face visible for a frame before the result overlay.
      await new Promise(resolve => setTimeout(resolve, 80));
      if (!this.disposed && generation === this.animationGeneration) this.host.dataset.diceState = "settled";
      return !this.disposed && generation === this.animationGeneration;
    } catch (error) {
      console.warn("fvtt-party-tools | 3D animation", error);
      if (generation === this.animationGeneration) this.fallback("骰子结果已结算");
      return false;
    } finally {
      if (generation === this.animationGeneration) this.finishAnimation = null;
    }
  }

  renderLightweight(roll = null) {
    const mode=this.mode??'normal';
    const label=mode==='adv'?'优势 · 取高':mode==='dis'?'劣势 · 取低':'普通检定';
    const dice=roll?trayResults(roll):Array.from({length:mode==='normal'?1:2},()=>({faces:20,value:'?',discarded:false}));
    const root=document.createElement('div');root.className='bg3-light-dice';
    const faces=document.createElement('div');faces.className='bg3-light-faces';
    for(const die of dice){
      const face=document.createElement('span');face.className='bg3-light-die'+(die.discarded?' is-discarded':'');
      const type=document.createElement('small');type.textContent='d'+die.faces;
      const value=document.createElement('b');value.textContent=String(die.value);
      face.append(type,value);faces.append(face);
    }
    const caption=document.createElement('span');caption.className='bg3-light-mode';caption.textContent=label;
    root.append(faces,caption);this.host.replaceChildren(root);
    this.host.dataset.previewDice=String(dice.length);this.host.dataset.diceState=roll?'settled':'ready';
    this.host.setAttribute('aria-label',label+'，'+(roll?dice.map(d=>'d'+d.faces+' '+d.value+(d.discarded?' 舍弃':' 保留')).join('，')+'，总值 '+roll.total:'等待掷骰'));
  }

  release() {
    const box = this.box;
    if (box) {
      box.removeTicker(box.animateThrow);
      box.removeTicker(box.animateSelector);
      box.running = false;
      box.rolling = false;
      try { box.clearScene(); } catch { /* a partially initialized renderer */ }
      for (const texture of Object.values(box.renderer?.scopedTextureCache ?? {})) texture?.dispose?.();
      box.renderer?.dispose();
      box.renderer?.forceContextLoss();
      if (game.dice3d?.dice3dRenderers?.[this.scope] === box.renderer) delete game.dice3d.dice3dRenderers[this.scope];
    }
    const worker = this.factory?.physicsWorker;
    worker?.terminate?.();
    worker?._worker?.terminate?.();
    this.factory?.loaderDRACO?.dispose?.();
    for (const geometry of Object.values(this.factory?.geometries ?? {})) geometry?.dispose?.();
    for (const material of Object.values(this.factory?.baseMaterialCache ?? {})) material?.dispose?.();
  }

  cancelAnimation() {
    this.animationGeneration++;
    this.finishAnimation?.();
    this.finishAnimation = null;
    if (this.box) {
      this.box.removeTicker(this.box.animateThrow);
      this.box.running = false;
      this.box.rolling = false;
    }
    this.fallback("骰子结果已结算");
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.animationGeneration++;
    this.finishAnimation?.();
    this.release();
  }
}
