import { matchesFreeSource } from './free-use-1.js';
import {namespaceSocket} from './socket-1.js';
import { divineSmiteFormula, usesLeft } from './feature-core-1.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pendingConsumption = new Map();
let socket;
Hooks.once('socketlib.ready',()=>{socket=namespaceSocket('smite');socket.register('consume',async function({actorUuid,itemId,choice}){
 const actor=await fromUuid(actorUuid),user=game.users.get(this.socketdata?.userId),item=actor?.items.get(itemId);
 if(!game.user.isGM||!user||!actor?.testUserPermission(user,'OWNER')||item?.type!=='spell')return null;
 return consumeSmiteChoice(actor,item,choice);
});});

function consumeSmiteChoice(actor, item, choice) {
  if(!game.user.isGM){if(!game.users.activeGM)throw Error('至圣斩资源结算需要在线主持人。');return socket.executeAsGM('consume',{actorUuid:actor.uuid,itemId:item.id,choice});}
  const key = actor.uuid ?? actor.id;
  const previous = pendingConsumption.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const liveItem = actor.items.get?.(choice.sourceId ?? item.id);
    if (!liveItem) return null;
    if (choice.kind === 'free') {
      if ((choice.sourceId && (!matchesFreeSource(liveItem,item) || liveItem.flags?.['fvtt-combat-panel']?.freeCast?.disabled)) || usesLeft(liveItem.system?.uses).value < 1) {
        ui.notifications.warn('至圣斩免费次数已耗尽，请重新选择资源');
        return null;
      }
      await liveItem.update({ 'system.uses.spent': (Number(liveItem.system.uses.spent) || 0) + 1 });
      return Math.max(1, Number(liveItem.flags?.['fvtt-combat-panel']?.freeCast?.level) || Number(item.system.level) || 1);
    }
    const slot = getSmiteSlots(actor).find(value => value.key === choice.key);
    if (!slot) {
      ui.notifications.warn('所选法术位已耗尽，请重新选择资源');
      return null;
    }
    await actor.update({ [`system.spells.${slot.key}.value`]: slot.value - 1 });
    return slot.level;
  });
  pendingConsumption.set(key, current);
  current.finally(() => {
    if (pendingConsumption.get(key) === current) pendingConsumption.delete(key);
  }).catch(() => {});
  return current;
}

export function getSmiteSlots(actor) {
  const out = [];
  for (const [key, slot] of Object.entries(actor?.system?.spells ?? {})) {
    if (key !== 'pact' && !/^spell\d$/.test(key)) continue;
    const level = Number(slot?.level) || Number(key.match(/^spell(\d)$/)?.[1]) || 0;
    const max = Number(slot?.max) || 0;
    const value = Number(slot?.value) || 0;
    if (level < 1 || max < 1 || value < 1) continue;
    out.push({ key, level, value, max, label: key === 'pact' ? `契约 ${level} 环` : `${level} 环` });
  }
  return out.sort((a, b) => a.level - b.level);
}

function chooseSmite(actor, item, slots, free) {
  return new Promise((resolve) => {
    const el = document.createElement('dialog');
    el.className = 'bg3-free-dialog bg3-smite-dialog';
    el.setAttribute('aria-label', '至圣斩 · 选择资源');
    const slotButtons = slots.map((s) => `<button type="button" data-slot="${esc(s.key)}">${esc(s.label)} · 剩余 ${s.value}/${s.max}</button>`).join('');
    el.innerHTML = `<form><h2>至圣斩</h2><p>${esc(actor.name)} 命中目标，是否使用至圣斩？</p>${free.map(source => `<button type="button" data-choice="free" data-source="${esc(source.id)}">${esc(source.label)}（${source.value}/${source.max}）</button>`).join('')}<div class="bg3-smite-slots">${slotButtons}</div><footer><button type="button" data-choice="cancel">取消</button></footer></form>`;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      el.close();
      el.remove();
      resolve(value);
    };
    el.addEventListener('click', (ev) => {
      const button = ev.target.closest('button');
      if (!button || button.disabled) return;
      if (button.dataset.choice === 'cancel') return finish(null);
      if (button.dataset.choice === 'free') return finish({ kind: 'free', sourceId:button.dataset.source === item.id ? null : button.dataset.source });
      if (button.dataset.slot) return finish({ kind: 'slot', key: button.dataset.slot });
    });
    el.addEventListener('cancel', (ev) => { ev.preventDefault(); finish(null); });
    el.addEventListener('close', () => finish(null));
    document.body.append(el);
    el.showModal();
  });
}

function actFor(workflow) {
  return String(workflow?.activity?.actionType ?? workflow?.item?.system?.actionType ?? '');
}

function firstTarget(workflow) {
  return workflow?.hitTargets?.first?.() ?? [...(workflow?.hitTargets ?? [])][0] ?? null;
}

export async function handleDivineSmite(workflow) {
  try {
    if (!workflow || workflow._dshSmiteHandled) return;
    if (workflow.hitTargets?.size !== 1) return;
    if (workflow.item?.type !== 'weapon') return;
    if (workflow.isFumble) return;
    if (!['mwak', 'rwak'].includes(actFor(workflow))) return;
    const actor = workflow.actor;
    if (!actor?.isOwner) return;
    const item = actor.items.find((i) => i.type === 'spell'
      && (i.system?.identifier === 'divine-smite' || /至圣斩|Divine Smite/i.test(i.name ?? '')));
    if (!item) return;
    const free = [item,...actor.items.filter(i=>matchesFreeSource(i,item) && !i.flags?.['fvtt-combat-panel']?.freeCast?.disabled)]
      .map(i=>({id:i.id,label:i===item?'免费次数':i.flags['fvtt-combat-panel'].freeCast.source||i.name,...usesLeft(i.system?.uses)})).filter(i=>i.value>0);
    const slots = getSmiteSlots(actor);
    if (!free.length && !slots.length) return;
    workflow._dshSmiteHandled = true;
    const choice = await chooseSmite(actor, item, slots, free);
    if (!choice) return;
    const castLevel = await consumeSmiteChoice(actor, item, choice);
    if (castLevel === null) return;
    const target = firstTarget(workflow);
    const type = target?.actor?.system?.details?.type?.value
      ?? target?.actor?.system?.traits?.type?.value ?? '';
    const formula = divineSmiteFormula(castLevel, /fiend|undead/i.test(String(type)));
    const bonus = globalThis.chrisPremades?.utils?.workflowUtils?.bonusDamage;
    if (bonus) await bonus(workflow,formula,{damageType:'radiant'});
    else {
      const roll = await new CONFIG.Dice.DamageRoll(formula,workflow.activity?.getRollData?.()??{}, {isCritical:workflow.isCritical,type:'radiant'}).evaluate();
      await workflow.setDamageRolls([...(workflow.damageRolls??[]),roll]);
    }
    ui.notifications.info(`至圣斩：${choice.kind === 'free' ? '免费次数' : `${castLevel} 环法术位`}，附加 ${formula} 光耀伤害`);
  } catch (e) {
    console.error('[fvtt-combat-panel] Divine Smite hook', e);
    ui.notifications.error(e?.message ?? String(e));
  }
}

export function registerFeatureHooks() {
  if (globalThis.__dshCpFeatureHooks) return;
  globalThis.__dshCpFeatureHooks = true;
  Hooks.on('midi-qol.DamageRollComplete', handleDivineSmite);
  console.log('[fvtt-combat-panel] feature hooks registered');
}
