// The only third-party hook adapted here is the exact 3D Canvas 8.0.0
// grounding check. Its behavior is retained for every unapproved update.
const knownSource = `(tokenDocument, updates) => {
            if (!game.Levels3DPreview._active || game.user.isGM) return;
            const flag = canvas.scene.flags["levels-3d-preview"]?.grounding;
            if (!flag) return;
            if (isFlying(tokenDocument) && flag === "notFlying") return;
            if (!("x" in updates) && !("y" in updates) && !("elevation" in updates)) return;
            const object = tokenDocument.object;
            const x = (updates.x ?? tokenDocument.x) + tokenDocument.width * (canvas.grid.size / 2);
            const y = (updates.y ?? tokenDocument.y) + tokenDocument.height * (canvas.grid.size / 2);
            const height = (object.losHeight ?? object.document.elevation) - object.document.elevation;
            const elevation = (updates.elevation ?? tokenDocument.elevation) + height;
            const collision = game.Levels3DPreview.interactionManager.computeSightCollision({ x, y, z: elevation }, { x, y, z: -100000 });
            if (!collision) return;
            const pos2d = Ruler3D.pos3DToCanvas(collision);
            const distanceFromGround = (updates.elevation ?? tokenDocument.elevation) - pos2d.z;
            const maxDist = canvas.scene.dimensions.distance * 0.5;
            if (distanceFromGround > maxDist) {
                ui.notifications.error(game.i18n.localize("levels3dpreview.errors.tokenNotGrounded"));
                return false;
            }
        }`;
const normalize = source => source.replace(/\s+/g, '');
export function isKnownGroundingHook(fn, version) { return version === '8.0.0' && typeof fn === 'function' && normalize(Function.prototype.toString.call(fn)) === normalize(knownSource); }
let binding, bypasses = 0, reason = '尚未绑定';
export function groundingStatus() { return { installed: !!binding, bypasses, reason }; }
export function installGroundingAdapter(authorize) {
  function bind() {
    if (binding) return;
    const version = game.modules.get('levels-3d-preview')?.version;
    const candidates = (Hooks.events.preUpdateToken ?? []).filter(entry => !entry.once && isKnownGroundingHook(entry.fn, version));
    if (candidates.length !== 1) { reason = `原生grounding接口不匹配（${version ?? '未加载'}，${candidates.length}）`; return; }
    const original = candidates[0];
    const wrapper = (...args) => {
      if (authorize(...args) === true) { bypasses++; return; }
      return original.fn(...args);
    };
    Hooks.off('preUpdateToken', original.id);
    const id = Hooks.on('preUpdateToken', wrapper);
    binding = { original, id }; reason = '已限定适配3D Canvas8.0.0攀升中间节点';
  }
  for (const event of ['ready', 'canvasReady', '3DCanvasSceneReady']) Hooks.on(event, () => setTimeout(bind, 0));
  return { bind };
}
