// Target collection is client-local; only confirmed casts enter the native workflow.
import { baneTargetPlan } from './feature-core-147.js';
const values=c=>Array.from(c?.contents??c??[]);
const identity=item=>[item.system?.identifier,item.flags?.['chris-premades']?.info?.identifier,item.name].filter(Boolean).join('|');
export function targetPlan(item,activity,level) {
  if(item?.type!=='spell'||activity?.target?.template?.type)return null;
  const id=identity(item),cast=Math.max(Number(item.system.level)||0,Number(level)||0);
  const cpr=item.flags?.['chris-premades']?.activityIdentifiers??{};
  if(cpr.scorchingRayBolt===activity.id)return null;
  if(cpr.magicMissileBolt===activity.id||/magic-missile-bolt/i.test(activity.identifier||''))return null;
  if(/magic.?missile|魔法飞弹/i.test(id))return {repeat:true,max:cast+2,spell:'magicMissile'};
  if(/(?:^|\|)scorching-?ray(?:\||$)|灼热射线|\bscorching ray\b/i.test(id))return {repeat:true,max:Math.max(3,cast+1),spell:'scorchingRay'};
  if(/(?:^|\|)bless(?:\||$)|祝福术|^Bless(?:\||$)/i.test(id))return {repeat:false,max:3+Math.max(0,cast-1),spell:'bless'};
  const bane=baneTargetPlan(item,activity,level);
  if(bane)return bane;
  let scaled=activity;
  const delta=Math.max(0,cast-Number(item.system.level||0));
  if(delta)scaled=item.clone({'flags.dnd5e.scaling':delta},{keepId:true}).system.activities.get(activity.id);
  const n=Number(scaled?.target?.affects?.count);
  return Number.isInteger(n)&&n>1&&n<=100&&['creature','ally','enemy'].includes(scaled?.target?.affects?.type)?{repeat:false,max:n,spell:'multi'}:null;
}

export function rayActivity(item,activity) {
  const id=item.flags?.['chris-premades']?.activityIdentifiers?.scorchingRayBolt;
  const bolt=id?item.system.activities.get(id):activity;
  if(bolt?.type!=='attack')throw Error('此灼热射线没有可用的攻击活动，请检查物品配置');
  return bolt;
}

// 魔法飞弹的每枚飞弹是 damage 活动（CPR activityIdentifiers.magicMissileBolt），不是 attack。
export function missileBolt(item) {
  const id=item.flags?.['chris-premades']?.activityIdentifiers?.magicMissileBolt;
  const bolt=id?item.system.activities.get(id):null;
  if(bolt?.type!=='damage')throw Error('此魔法飞弹没有可用的伤害活动，请检查物品配置');
  return bolt;
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
