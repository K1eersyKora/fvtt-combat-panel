/* Invoke midi's advantage methods on detached data, never create/start a Workflow. */
const MID='midi-qol';
const values=o=>o&&typeof o==='object'?Object.values(o).flatMap(values):[o];
function safe(value){
  if(value==null||typeof value==='boolean'||typeof value==='number')return true;
  if(typeof value!=='string')return false;
  // The midi condition evaluator can execute code. Only expressions without calls,
  // assignment or access to global services are accepted by this adapter.
  const s=value.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,'""');
  return !/[`;{}]|=>|\+\+|--|\b(?:new|delete|await|import|game|canvas|ui|globalThis|window|document|eval|Function|constructor|prototype|__proto__)\b/.test(s)
    && !/(?<![=!<>])=(?!=)/.test(s) && !/[\w\]\)]\s*\(/.test(s);
}
function guardActor(actor){
  const flags=actor.flags?.[MID]??{};
  const data=[flags.advantage,flags.disadvantage,flags.grants,flags.fail,flags.ignoreNearbyFoes];
  const changes=actor.appliedEffects?.flatMap(e=>Array.from(e.changes??[]).filter(c=>/^flags\.midi-qol\.(advantage|disadvantage|grants|fail|ignoreNearbyFoes)/.test(c.key)).map(c=>c.value))??[];
  return [...data.flatMap(values),...changes].every(safe);
}
function detachedToken(real,actor){
  const denied=new Set(['update','updateSource','setFlag','unsetFlag','delete','createEmbeddedDocuments','updateEmbeddedDocuments','deleteEmbeddedDocuments','initializeVisionSource','updateVisionSource','initializeSources','control','release','setTarget']);
  let token;
  const doc=new Proxy(real.document,{get(t,k){if(k==='actor')return actor;if(k==='object')return token;if(denied.has(k))return()=>{throw Error('Preview attempted a document mutation');};return Reflect.get(t,k,t);},set(){throw Error('Preview token document is read-only');}});
  token=new Proxy(real,{get(t,k){if(k==='actor')return actor;if(k==='document')return doc;if(denied.has(k))return()=>{throw Error('Preview attempted a token mutation');};return Reflect.get(t,k,t);},set(){throw Error('Preview token is read-only');}});
  return token;
}

export async function workflowAttackPreview({actor,sourceToken,activity,targetToken,baselineMode='normal',baselineAdvantage,baselineDisadvantage}){
  const api=globalThis.MidiQOL,proto=api?.Workflow?.prototype;
  if(!proto?.checkAttackAdvantage||activity.type!=='attack')return null;
  const rule=key=>{try{return api.checkRule(key);}catch{return undefined;}};
  if(typeof api.checkRule!=='function')return null;
  const type=activity.actionType;
  const ranged=['rwak','rsak','rpak'].includes(type)||activity.item.system.properties?.has('thr');
  // These helpers can change real sight/flanking state through global canvas lookups.
  // Keep the established read-only predictor for those unsupported configurations.
  if(rule('checkFlanking')&&rule('checkFlanking')!=='off'&&rule('checkFlanking')!=='none')return null;
  if(ranged&&(rule('nearbyFoe')||Number(rule('nearbyAllyRanged'))>0))return null;
  if(rule('hiddenAdvantage')==='perceptive')return null;
  if(!guardActor(actor)||!guardActor(targetToken.actor))return null;
  const sensesRequired=rule('invisAdvantage')&&rule('invisAdvantage')!=='none';
  const ready=t=>!!t.vision?.los&&t.document.sight?.enabled===true;
  if(sensesRequired)return null; // Vision helpers can initialize real token sources; leave this to the read-only predictor.
  try{
    const source=actor.clone({}, {keepId:true}),target=targetToken.actor.clone({}, {keepId:true});
    // Preserve prepared flags, without sharing a mutable object with real actors.
    source.flags=foundry.utils.deepClone(actor.flags);target.flags=foundry.utils.deepClone(targetToken.actor.flags);
    const st=detachedToken(sourceToken,source),tt=detachedToken(targetToken,target);
    const item=activity.item.clone({}, {parent:source,keepId:true});
    const act=item.system.activities.get(activity.id);
    const context={actor:source,item,activity:act,token:st,tokenUuid:sourceToken.document.uuid,
      targets:new Set([tt]),saves:new Set(),failedSaves:new Set(),superSavers:new Set(),semiSuperSavers:new Set(),hitTargets:new Set(),
      attackAdvAttribution:new Set(),advReminderAttackAdvAttribution:new Set(),needsAttackAdvantageCheck:true,
      advantage:baselineAdvantage??baselineMode==='adv',disadvantage:baselineDisadvantage??baselineMode==='dis',noAdvantage:false,noDisadvantage:false,flankingAdvantage:false,
      workflowOptions:{},rollOptions:{},damageRolls:[],checkFlankingAdvantage:async()=>false,
      checkAbilityAdvantage:proto.checkAbilityAdvantage,checkTargetAdvantage:proto.checkTargetAdvantage,
      tokenCanSense:new Map(),targetsCanSense:new Map()};
    if(sensesRequired){context.tokenCanSense.set(tt,api.canSense(sourceToken,targetToken));context.targetsCanSense.set(st,api.canSense(targetToken,sourceToken));}
    context.conditionData={...act.getRollData(),workflow:context,actor:source,target:target,targetUuid:targetToken.document.uuid,targetActorUuid:targetToken.actor.uuid};
    await proto.checkAttackAdvantage.call(context);
    const adv=!!context.advantage&&!context.noAdvantage,dis=!!context.disadvantage&&!context.noDisadvantage;
    return {mode:adv===dis?'normal':adv?'adv':'dis',advantage:adv,disadvantage:dis,attribution:[...context.attackAdvAttribution],source:'midi-workflow-detached'};
  }catch(error){return {unsupported:true,reason:String(error.message??error)};}
}
