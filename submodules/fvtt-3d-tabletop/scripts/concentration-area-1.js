import {ID, active3D, castFlag} from './scene-view-1.js';

function resolve(value) {
  if (typeof value !== 'string') return value;
  try { return fromUuidSync(value, {strict: false}); }
  catch { return null; }
}

export function concentrationArea(item, activity) {
  if (item?.type !== 'spell') return false;
  const duration = activity?.duration;
  const concentration = duration?.override ? duration.concentration :
    (item.requiresConcentration || item.system?.properties?.has?.('concentration') || duration?.concentration);
  if (!concentration) return false;
  if (activity?.target?.override) return !!activity.target.template?.type;
  return !!(activity?.target?.template?.type || item.system?.target?.template?.type ||
    (!activity && item.system?.activities?.some(a => a.target?.template?.type)));
}

export function areaVisualSource(value, visited = new Set()) {
  const doc = resolve(value);
  if (!doc || visited.has(doc)) return false;
  visited.add(doc);
  if (doc.documentName === 'ActiveEffect') {
    return areaVisualSource(doc.origin, visited) || areaVisualSource(doc.parent?.documentName === 'Item' && doc.parent, visited);
  }
  return doc.documentName === 'Item' ? concentrationArea(doc) : concentrationArea(doc.item, doc);
}

export function areaTemplate(doc) {
  return doc?.documentName === 'MeasuredTemplate' && (areaVisualSource(castFlag(doc, 'cast')?.origin)
    || areaVisualSource(doc.flags?.dnd5e?.origin) || areaVisualSource(doc.object?.activity));
}

export function installAreaVisuals() {
  const installed = new Set();
  function wrap(path, fn) {
    if (installed.has(path)) return;
    libWrapper.register(ID, path, fn, 'MIXED');
    installed.add(path);
  }
  function mount() {
    if (globalThis.chrisPremades?.utils?.itemUtils?.getConfig) {
      wrap('globalThis.chrisPremades.utils.itemUtils.getConfig', function (original, item, key, ...args) {
        if ((key === 'playAnimation' || key === 'animation') && active3D() && concentrationArea(item)) {
          return key === 'animation' ? 'none' : false;
        }
        return original(item, key, ...args);
      });
    }
    if (game.gps?.getCprConfig) {
      wrap('game.gps.getCprConfig', function (original, args) {
        const config = original(args);
        if ((args.type ?? 'anim') === 'anim' && active3D() && areaVisualSource(args.itemUuid)) {
          return {...config, animEnabled: false};
        }
        return config;
      });
    }
    if (game.Levels3DPreview?.Classes?.Template3D) {
      const proto = 'game.Levels3DPreview.Classes.Template3D.prototype.';
      wrap(proto + 'templateStyle', function (original) {
        return areaTemplate(this.template?.document) ? 'wireframe' : original();
      });
      wrap(proto + '_getTexture', function (original) {
        if (!areaTemplate(this.template?.document)) return original();
      });
    }
  }
  Hooks.once('ready', mount);
  Hooks.on('3DCanvasReady', mount);
  Hooks.once('cprReady', mount);
}
