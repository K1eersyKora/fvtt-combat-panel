import {matchesFreeSource, spellOptions} from './game-14.mjs';

const MODULE = 'fvtt-mobile-table', PANEL = 'fvtt-combat-panel';
const CAST = 'mtFreeReact00001';
const tag = item => item?.flags?.[MODULE]?.freeReaction;
const sourceMeta = item => item?.flags?.[PANEL]?.freeCast;
const reaction = activity => activity?.type !== 'cast' && activity?.activation?.type?.includes('reaction');
const primary = () => game.user?.isGM && game.users.activeGM?.id === game.user.id;

function supported(item) {
  if (item?.type !== 'spell' || item.flags?.dnd5e?.cachedFor || !item.system.activities.some(reaction)) return false;
  const shield = item.system.identifier === 'shield' || item.flags?.['chris-premades']?.info?.identifier === 'shield'
    || /^(?:shield|护盾术(?:\s+Shield)?)$/i.test(item.name.trim());
  return !(shield && game.modules.get('fvtt-automation-repair')?.active);
}

function originalFor(source) {
  const meta = sourceMeta(source);
  const original = meta && source.actor?.items.get(meta.itemId ?? meta.spellId);
  return !meta?.disabled && matchesFreeSource(source, original) && supported(original) ? original : null;
}

function validProxy(item, activityId) {
  const meta = tag(item), source = item.actor?.items.get(meta?.sourceId);
  const original = originalFor(source);
  return original && original.id === meta.spellId && reaction(original.system.activities.get(activityId))
    && item.flags.dnd5e?.cachedFor === source.system.activities.get(CAST)?.relativeUUID
    && Number(source.system.uses.value) > 0
    && !(original.system.method === 'spell' && Number(original.system.prepared) === 0);
}

function choose(actor, item, choices, hasSlots) {
  const el = document.createElement('dialog');
  el.className = 'bg3-free-dialog bg3-reaction-dialog';
  el.innerHTML = '<form><h2></h2><p></p><label>免费施法来源<select></select></label><footer><button type="button" data-choice="cancel">取消施放</button><button type="button" data-choice="slot">使用法术位</button><button type="submit" data-choice="free">使用免费次数</button></footer></form>';
  el.querySelector('h2').textContent = item.name + '反应';
  el.setAttribute('aria-label', item.name + '反应 · 选择施法资源');
  el.querySelector('p').textContent = actor.name + '将使用' + item.name + '。请选择施法资源。';
  const select = el.querySelector('select');
  for (const o of choices) select.add(new Option(o.label + ' · 剩余 ' + o.value + ' / ' + o.max, o.key));
  const slot = el.querySelector('[data-choice="slot"]');
  slot.disabled = !hasSlots;
  return new Promise(resolve => {
    const finish = value => { if (el.open) el.close(); el.remove(); resolve(value); };
    el.querySelector('form').onsubmit = ev => { ev.preventDefault(); finish(select.value); };
    slot.onclick = () => finish('slot');
    el.querySelector('[data-choice="cancel"]').onclick = () => finish(null);
    el.onclose = () => finish(null);
    document.body.append(el);
    el.showModal();
  });
}

Hooks.on('midi-qol.preItemRollV2', async ({workflow, usage, dialog}) => {
  const activity = workflow?.activity, item = activity?.item, actor = activity?.actor;
  if (tag(item)) {
    if (!validProxy(item, activity.id)) {
      ui.notifications.warn('免费反应的施法来源已不可用。');
      return false;
    }
    // dnd5e consumes the linked Cast activity's charge.
    if (usage?.midiOptions?.isReaction) dialog.configure = false;
    return;
  }
  if (usage?.midiOptions?.isReaction !== true || !actor?.isOwner || usage[PANEL]?.reactionChosen || !supported(item)) return;
  const options = () => spellOptions(actor, actor.items.get(item.id), activity);
  const available = opt => ['item','free'].includes(opt.kind) && opt.value > 0;
  const all = options(), choices = all.filter(available);
  if (!choices.length) return;
  const choice = await choose(actor, item, choices, all.some(o => o.kind === 'slot' && o.value > 0));
  if (!choice) return false;
  usage[PANEL] = {...usage[PANEL], reactionChosen:true};
  const targets = Array.from(activity.consumption.targets, t => t.toObject?.() ?? foundry.utils.deepClone(t));
  // Midi is still running preChatChecks against this prepared activity.
  // Updating that activity directly resets inherited activation and range,
  // which makes Midi re-evaluate damage-only conditions outside a reaction.
  // dnd5e's following use() clones the per-use item, including these costs.
  if (item === actor.items.get(item.id)) return false;
  const path = 'system.activities.' + activity.id + '.consumption.';
  if (choice === 'slot') {
    const otherCosts = targets.filter(t => t.type !== 'itemUses' || !['', item.id].includes(t.target));
    if (otherCosts.length !== targets.length) item.updateSource({[path + 'targets']:otherCosts});
    return;
  }
  if (!actor.items.has(item.id) || !options().some(o => o.key === choice && available(o))) {
    ui.notifications.warn('所选免费次数已不可用。');
    return false;
  }
  const target = choice === 'item' ? '' : choice;
  // A spell can already consume its own uses. Replace that alternative cost;
  // keep independent material costs and never charge the same pool twice.
  const costs = targets.filter(t => t.type !== 'itemUses' || !['', item.id, target].includes(t.target));
  costs.push({type:'itemUses', target, value:'1', scaling:{mode:'', formula:''}});
  item.updateSource({[path + 'targets']:costs, [path + 'spellSlot']:false});
  usage.consume = {...usage.consume, spellSlot:false, resources:true};
  usage.scaling = 0;
  usage.spell = {...usage.spell, slot:'spell' + (Number(item.system.level) || 1)};
  dialog.configure = false;
});

// Preserve distinct reaction activities (Absorb Elements has one per element).
Hooks.on('midi-qol.ReactionFilter', (activities, _options, _trigger, uuids) => {
  if (!activities.some(a => tag(a.item))) return;
  const valid = activities.filter(a => tag(a.item) && validProxy(a.item, a.id));
  const alternatives = new Set(valid.map(a => tag(a.item).spellId + '/' + a.id));
  const originals = new Set(activities.filter(a => !tag(a.item) && alternatives.has(a.item.id + '/' + a.id)
    && spellOptions(a.actor, a.item, a).some(o => ['slot','native'].includes(o.kind) && o.value > 0))
    .map(a => a.item.id + '/' + a.id));
  for (const a of [...activities]) {
    const meta = tag(a.item);
    const key = (meta?.spellId ?? a.item.id) + '/' + a.id;
    const remove = meta ? !valid.includes(a) || originals.has(key)
      : alternatives.has(key) && !originals.has(key);
    if (!remove) continue;
    activities.splice(activities.indexOf(a), 1);
    const i = uuids?.indexOf(a.uuid);
    if (i >= 0) uuids.splice(i, 1);
  }
});

function signature(item) {
  const {name, system, effects, flags, img} = item.toObject();
  let hash = 2166136261;
  for (const c of JSON.stringify([name, system, effects, flags, img])) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

function mark(data, original, source) {
  // The desktop HUD signature includes the item name and each activity's
  // type/activation. Leave both intact, even for legacy reaction subtypes.
  data.name = original.name;
  data.flags[MODULE] = {...data.flags[MODULE], freeReaction:{sourceId:source.id, spellId:original.id, signature:signature(original)}};
  delete data.flags.dnd5e.dependents;
  for (const activity of original.system.activities.filter(reaction)) {
    const cost = data.system.activities[activity.id]?.consumption;
    if (!cost) continue;
    // dnd5e uses the linked Cast charge only when this flag is true.
    // Its usage config then disables slot consumption on the cached spell.
    cost.spellSlot = true;
    cost.targets = (cost.targets ?? []).filter(t => t.type !== 'itemUses' || !['', original.id, source.id].includes(t.target));
  }
  for (const effect of data.effects) {
    if (effect.flags?.dnd5e) delete effect.flags.dnd5e.dependents;
    if (effect.origin === source.system.activities.get(CAST)?.uuid && effect.type === 'enchantment') {
      effect.changes = effect.changes.filter(change => change.key !== 'system.activation');
    }
  }
  return data;
}

Hooks.on('preCreateItem', item => {
  const link = item.flags?.dnd5e?.cachedFor;
  if (!link?.endsWith('.Activity.' + CAST)) return;
  const source = item.actor?.items.get(link.split('.')[2]), original = originalFor(source);
  if (original) {
    const {flags, effects, name, system} = mark(item.toObject(), original, source);
    item.updateSource({flags, effects, name, 'system.activities':system.activities});
  }
});

async function sync(actor) {
  if (!primary() || !actor.isOwner || (!actor.isToken && !game.actors.has(actor.id))) return;
  for (const source of [...actor.items]) {
    const cast = source.system.activities?.get(CAST);
    const original = originalFor(source);
    if (!original) {
      if (cast) await source.update({['system.activities.-=' + CAST]:null});
      continue;
    }
    if (!cast || cast.spell?.uuid !== original.uuid) {
      await source.update({['system.activities.' + CAST]:{_id:CAST, type:'cast', name:original.name,
        activation:{type:'reaction', value:1, override:true},
        consumption:{spellSlot:false, targets:[{type:'itemUses', target:'', value:'1'}]},
        spell:{uuid:original.uuid, level:Number(original.system.level) || 1, properties:[], spellbook:false}}});
      // dnd5e creates/replaces the cache asynchronously. Hold this actor's
      // queue until the native insert arrives, including on source rebinding.
      const until = Date.now() + 5000;
      while (!actor.items.some(i => tag(i)?.sourceId === source.id && tag(i)?.spellId === original.id)
          && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    const copies = actor.items.filter(i => i.flags?.dnd5e?.cachedFor === cast.relativeUUID);
    const cached = copies.find(i => tag(i)?.spellId === original.id) ?? copies[0];
    if (copies.length > 1) await actor.deleteEmbeddedDocuments('Item', copies.filter(i => i !== cached).map(i => i.id));
    if (cached && tag(cached)?.signature === signature(original)) continue;
    const data = await cast.getCachedSpellData();
    if (!data) continue;
    mark(data, original, source);
    if (cached) await cached.update({name:data.name, img:data.img, flags:data.flags, effects:data.effects, system:data.system}, {recursive:false});
    else await actor.createEmbeddedDocuments('Item', [data]);
  }
}

const scheduled = new Map(), running = new Map();
function schedule(actor) {
  if (!primary() || !actor?.items) return;
  const key = actor.uuid;
  clearTimeout(scheduled.get(key));
  scheduled.set(key, setTimeout(() => {
    scheduled.delete(key);
    const work = (running.get(key) ?? Promise.resolve()).then(() => sync(actor))
      .catch(error => console.error(MODULE + ' | 免费反应同步失败', error));
    running.set(key, work);
    work.finally(() => { if (running.get(key) === work) running.delete(key); });
  }, 150));
}
const managed = item => sourceMeta(item) || item.system.activities?.has(CAST) || tag(item);
for (const event of ['createItem','updateItem','deleteItem']) Hooks.on(event, item => {
  if (tag(item) || !item.actor) return;
  if (managed(item) || item.actor.items.some(source => sourceMeta(source)?.itemId === item.id
    || sourceMeta(source)?.spellId === item.id || tag(source)?.spellId === item.id)) schedule(item.actor);
});
Hooks.on('createActor', actor => { if (actor.items.some(managed)) schedule(actor); });
function scan() {
  if (primary()) for (const actor of game.actors) if (actor.items.some(managed)) schedule(actor);
}
Hooks.once('ready', scan);
Hooks.on('userConnected', scan);
