import { spellOptions } from './hud-162.js';

const ID = 'fvtt-combat-panel';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function isShieldReaction(activity, usage) {
  const item = activity?.item;
  return item?.type === 'spell' && usage?.midiOptions?.isReaction === true
    && (item.system.identifier === 'shield' || item.flags?.['chris-premades']?.info?.identifier === 'shield'
      || /^(护盾术(?:\s+Shield)?|Shield)$/i.test(item.name?.trim()));
}

function chooseSource(actor, item, choices) {
  return new Promise(resolve => {
    const el = document.createElement('dialog');
    el.className = 'bg3-free-dialog bg3-reaction-dialog';
    el.setAttribute('aria-label', '护盾术反应 · 选择施法资源');
    el.innerHTML = `<form><h2>护盾术反应</h2><p>${esc(actor.name)}已确认使用护盾术。是否使用免费施法次数？</p><label>免费施法来源<select name="source">${choices.map(o => `<option value="${esc(o.key)}">${esc(o.label)} · 剩余 ${o.value} / ${o.max}</option>`).join('')}</select></label><p>使用免费次数不会消耗法术位。取消则不施放、不消耗资源。</p><footer><button type="button" data-choice="cancel">取消施放</button><button type="button" data-choice="slot">使用法术位</button><button type="submit">使用免费次数</button></footer></form>`;
    let done = false;
    const finish = value => { if (done) return; done = true; el.close(); el.remove(); resolve(value); };
    el.querySelector('form').addEventListener('submit', ev => { ev.preventDefault(); finish(el.querySelector('select').value); });
    el.querySelector('[data-choice="slot"]').addEventListener('click', () => finish('slot'));
    el.querySelector('[data-choice="cancel"]').addEventListener('click', () => finish(null));
    el.addEventListener('cancel', ev => { ev.preventDefault(); finish(null); });
    el.addEventListener('close', () => finish(null));
    document.body.append(el); el.showModal();
  });
}

// midi awaits this hook before the system consumes resources. Its activity is
// already a per-use clone, so the owned spell and its normal slot use stay intact.
export async function shieldReactionResource({workflow, usage, dialog}) {
  const activity = workflow?.activity, item = activity?.item, actor = activity?.actor;
  if (!isShieldReaction(activity, usage) || !actor?.isOwner || usage[ID]?.reactionChosen) return;
  const choices = spellOptions(actor, item, activity).filter(o => o.kind === 'free' && o.value > 0);
  if (!choices.length) return;
  const choice = await chooseSource(actor, item, choices);
  if (!choice) return false;
  usage[ID] = {...usage[ID], reactionChosen:true};
  if (choice === 'slot') return;
  // Re-read after the dialog: another client may have used the final charge.
  if (!spellOptions(actor, item, activity).some(o => o.kind === 'free' && o.key === choice && o.value > 0)) {
    ui.notifications.warn('所选免费施法次数已不可用，请重新选择护盾术反应。');
    return false;
  }
  const targets = Array.from(activity.consumption.targets, t => t.toObject?.() ?? foundry.utils.deepClone(t));
  targets.push({type:'itemUses', target:choice, value:'1', scaling:{mode:'',formula:''}});
  activity.updateSource({'consumption.targets':targets, 'consumption.spellSlot':false});
  usage.consume = {...usage.consume, spellSlot:false, resources:true};
  usage.scaling = 0;
  usage.spell = {...usage.spell, slot:`spell${Number(item.system.level) || 1}`};
  dialog.configure = false;
}

Hooks.on('midi-qol.preItemRollV2', shieldReactionResource);
