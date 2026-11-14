// Target collection is client-local; only confirmed casts enter the native workflow.
import { baneTargetPlan } from './feature-core-1.js';
const values=c=>Array.from(c?.contents??c??[]);
const identity=item=>[item.system?.identifier,item.flags?.['chris-premades']?.info?.identifier,item.name].filter(Boolean).join('|');

export function eldritchBlastBeam(item, activity) {
  const cpr = item?.flags?.['chris-premades'];
  if (cpr?.info?.identifier !== 'eldritchBlast' || !cpr.macros?.midi?.item?.includes('eldritchBlast')) return null;
  if (!activity?.id || activity.id !== cpr.activityIdentifiers?.eldritchBlast) return null;
  const beam = item.system.activities.get(cpr.activityIdentifiers.eldritchBlastBeam);
  return beam?.type === 'attack' ? beam : null;
}

export function targetPlan(item,activity,level) {
  if(item?.type!=='spell'||activity?.target?.template?.type)return null;
  const id=identity(item),cast=Math.max(Number(item.system.level)||0,Number(level)||0);
  const cpr=item.flags?.['chris-premades']?.activityIdentifiers??{};
  if(cpr.scorchingRayBolt===activity.id)return null;
  if(cpr.magicMissileBolt===activity.id||/magic-missile-bolt/i.test(activity.identifier||''))return null;
  if (eldritchBlastBeam(item, activity)) {
    const actor = item.actor;
    const details = actor?.system?.details;
    const casterLevel = Number(actor?.type === 'npc' ? details?.cr : details?.level) || 0;
    const beams = 1 + Math.floor((casterLevel + 1) / 6);
    // Select candidates here. CPR allocates and rolls each beam from the original casting macro.
    return beams > 1 ? { repeat: false, max: beams, spell: 'eldritchBlast' } : null;
  }
  if(/magic.?missile|魔法飞弹/i.test(id))return {repeat:true,max:cast+2,spell:'magicMissile'};
  if(/(?:^|\|)scorching-?ray(?:\||$)|灼热射线|\bscorching ray\b/i.test(id))return {repeat:true,max:Math.max(3,cast+1),spell:'scorchingRay'};
  if(/(?:^|\|)bless(?:\||$)|祝福术|^Bless(?:\||$)/i.test(id))return {repeat:false,max:3+Math.max(0,cast-1),spell:'bless'};
  const bane=baneTargetPlan(item,activity,level);
  if(bane)return bane;
  let scaled=activity;
  const delta=Math.max(0,cast-Number(item.system.level||0));
  if(delta)scaled=item.clone({'flags.dnd5e.scaling':delta},{keepId:true}).system.activities.get(activity.id);
  let n=Number(scaled?.target?.affects?.count);
  // Some imported cast activities override the item's formula with blank/1.
  // Prefer valid scaled activity data, then the item's declared target formula.
  if (!(n>1) && delta) {
    const clone=item.clone({'flags.dnd5e.scaling':delta},{keepId:true});
    const declared=clone.system.target;
    if (!declared?.template?.type && ['creature','ally','enemy'].includes(declared?.affects?.type)) n=Number(declared.affects.count)||n;
  }
  // Compatibility for imported Command/Hideous Laughter with no target scaling data.
  const normalized=id.toLowerCase().replace(/[’'\s_-]/g,'');
  if (!(n>1) && delta && activity.type==='save' &&
      (/(?:^|\|)command(?:\||$)|命令术/.test(normalized) || /(?:tashas)?hideouslaughter|塔莎狂笑术/.test(normalized))) n=1+delta;
  return Number.isInteger(n)&&n>1&&n<=100&&['creature','ally','enemy'].includes(scaled?.target?.affects?.type)?{repeat:false,max:n,spell:'multi'}:null;
}

export function rayActivity(item,activity) {
  const id=item.flags?.['chris-premades']?.activityIdentifiers?.scorchingRayBolt;
  const bolt=id?item.system.activities.get(id):activity;
  if(bolt?.type!=='attack')throw Error('此灼热射线没有可用的攻击活动，请检查物品配置');
  return bolt;
}

// CPR dispatchers name a bolt explicitly; native cards can use their selected damage activity.
export function missileBolt(item, activity) {
  const activities=values(item.system?.activities);
  const id=item.flags?.['chris-premades']?.activityIdentifiers?.magicMissileBolt;
  const assigned=id?item.system.activities.get(id):null;
  if(assigned?.type==='damage')return assigned;
  const selected=activity?.id?item.system.activities.get(activity.id):null;
  if(selected?.type==='damage')return selected;
  const damage=activities.filter(candidate=>candidate.type==='damage');
  const named=damage.filter(candidate=>/magicmissilebolt/.test(String(candidate.identifier||'').replace(/[\s_-]/g,'').toLowerCase()));
  if(named.length===1)return named[0];
  if(damage.length===1)return damage[0];
  if(damage.length>1)throw Error('此魔法飞弹有多个伤害活动，请先选择要使用的伤害活动');
  throw Error('此魔法飞弹没有可用的伤害活动，请检查物品配置');
}

export function prepareMultiActivity(item,activity,plan) {
  const update={};const prefix=`system.activities.${activity.id}`;
  update[`${prefix}.target.override`]=true;
  update[`${prefix}.target.prompt`]=false;
  update[`${prefix}.target.template.type`]='';
  update[`${prefix}.target.affects.type`]='creature';
  update[`${prefix}.target.affects.count`]=String(plan.bolt?1:plan.max);
  update[`${prefix}.midiProperties.confirmTargets`]='never';
  if(plan.repeat){
    // Replace only CPR's dispatcher on a transient clone. Keep actor/item combat macros.
    const dispatcher=plan.spell==='magicMissile'?'magicMissile':'scorchingRay';
    const macros=item.flags?.['chris-premades']?.macros?.midi?.item;
    if(Array.isArray(macros))update['flags.chris-premades.macros.midi.item']=macros.filter(m=>m!==dispatcher);
    update[`${prefix}.attackRollPerTarget`]='never';
    if(plan.subsequent){
      update[`${prefix}.activation.override`]=true;update[`${prefix}.activation.type`]='special';
      update[`${prefix}.consumption.spellSlot`]=false;update[`${prefix}.consumption.targets`]=[];
    }
  }
  const clone=item.clone(update,{keepId:true});
  return clone.system.activities.get(activity.id);
}
