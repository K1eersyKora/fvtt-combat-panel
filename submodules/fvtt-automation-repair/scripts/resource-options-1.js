import {resourceMeta,itemFreeUseOption} from './feature-core-1.js';
import {matchesFreeSource} from './free-use-1.js';
const ID='fvtt-combat-panel';
const list=value=>Array.from(value?.contents??value??[]);
export function usesLeft(item) {
  const uses = item?.system?.uses ?? {};
  const max = Math.max(0, Number(uses.max) || 0);
  return { max, value: Math.max(0, Math.min(max, Number.isFinite(Number(uses.value)) ? Number(uses.value) : max - (Number(uses.spent) || 0))) };
}

export function spellOptions(actor, item, activity) {
  const level = Number(item.system?.level) || 0;
  if (activity.type === 'forward') {
    const resource = resourceMeta(actor, item, [activity]);
    return [{key:'native',kind:'native',level,label:activity.name || '免费施法',
      value:resource?.value ?? 1,max:resource?.max ?? 1}];
  }
  const consumes = activity.requiresSpellSlot && activity.consumption?.spellSlot;
  const out = [];
  if (consumes) for (const [key, slot] of Object.entries(actor.system?.spells ?? {})) {
    const n = Number(slot.level) || Number(key.match(/^spell(\d)$/)?.[1]) || 0;
    if (n < level || n < 1 || (Number(slot.max) || 0) < 1) continue;
    out.push({key,level:n,label:`${n} 环${key==='pact'?' · 契约':''}`,value:Number(slot.value)||0,max:Number(slot.max)||0,kind:'slot'});
  }
  if (!consumes) out.push({key:'native',level,label:item.type!=='spell'?'使用':level?`${level} 环 · 原生施放`:'戏法',kind:'native',value:1,max:1});
  // A feature's own charges already belong to its normal-use route.
  const itemFree = item.type==='spell' ? itemFreeUseOption(item, level) : null;
  if (itemFree) out.push(itemFree);
  for (const resource of list(actor.items)) {
    const meta = resource.flags?.[ID]?.freeCast;
    if (!matchesFreeSource(resource,item) || meta.disabled) continue;
    const uses = usesLeft(resource);
    out.push({key:resource.id,level,kind:'free',label:meta.source || resource.name,...uses,period:meta.period || 'lr'});
  }
  const rank = o => o.kind === 'free' ? 2 : o.kind === 'item' ? 1 : 0;
  return out.sort((a,b)=>rank(a)-rank(b) || a.level-b.level);
}

