import { divineSmiteFormula } from './feature-core-147.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    el.innerHTML = `<form><h2>至圣斩</h2><p>${esc(actor.name)} 命中目标，是否使用至圣斩？</p>${free ? `<button type="button" data-choice="free">免费次数（${free.value}/${free.max}）</button>` : ''}<div class="bg3-smite-slots">${slotButtons}</div><footer><button type="button" data-choice="cancel">取消</button></footer></form>`;
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
      if (!button) return;
      if (button.dataset.choice === 'cancel') return finish(null);
      if (button.dataset.choice === 'free') return finish({ kind: 'free' });
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
    const owners = game.users.filter((u) => u.active && actor.testUserPermission(u, 'OWNER'));
    const preferred = owners.find((u) => !u.isGM) ?? owners[0];
    if (!preferred || game.user.id !== preferred.id) return;
    const item = actor.items.find((i) => i.type === 'spell'
      && (i.system?.identifier === 'divine-smite' || /至圣斩|Divine Smite/i.test(i.name ?? '')));
    if (!item) return;
    const free = { value: Number(item.system?.uses?.value) || 0, max: Number(item.system?.uses?.max) || 0 };
    const slots = getSmiteSlots(actor);
    if (!(free.max > 0 && free.value > 0) && !slots.length) return;
    workflow._dshSmiteHandled = true;
    const choice = await chooseSmite(actor, item, slots, free.max > 0 ? free : null);
    if (!choice) return;
    let castLevel = 1;
    if (choice.kind === 'free') {
      await item.update({ 'system.uses.spent': (Number(item.system.uses.spent) || 0) + 1 });
      castLevel = Math.max(1, Number(item.system.level) || 1);
    } else {
      const slot = slots.find((s) => s.key === choice.key);
      if (!slot) return;
      await actor.update({ [`system.spells.${slot.key}.value`]: Math.max(0, slot.value - 1) });
      castLevel = slot.level;
    }
    const target = firstTarget(workflow);
    const type = target?.actor?.system?.details?.type?.value
      ?? target?.actor?.system?.traits?.type?.value ?? '';
    const formula = divineSmiteFormula(castLevel, /fiend|undead/i.test(String(type)));
    const roll = await new CONFIG.Dice.DamageRoll(formula, workflow.activity?.getRollData?.() ?? {}).evaluate();
    roll.options.type = 'radiant';
    workflow.damageRolls ??= [];
    workflow.damageRolls.push(roll);
    await workflow.setDamageRolls?.(workflow.damageRolls);
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
