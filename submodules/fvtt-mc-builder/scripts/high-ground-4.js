import {activityRange} from './spatial-range-1.js';
const ID = 'fvtt-mc-builder', STEP = 5;
let installed = false, previewWrapped = false, helpersPromise;
let planMelee;

export function elevationRule(source, target, { attack = true, enabled = true } = {}) {
  const difference = Number(source) - Number(target);
  if (!enabled || !attack || !Number.isFinite(Number(source)) || !Number.isFinite(Number(target))) return { mode: 'normal', difference: null };
  return { mode: difference >= STEP - 1e-8 ? 'adv' : difference <= -STEP + 1e-8 ? 'dis' : 'normal', difference };
}
export function combineAdvantage(advantage, disadvantage, mode, { noAdvantage = false, noDisadvantage = false } = {}) {
  const adv = !noAdvantage && (!!advantage || mode === 'adv'), dis = !noDisadvantage && (!!disadvantage || mode === 'dis');
  return { advantage: adv, disadvantage: dis, mode: adv === dis ? 'normal' : adv ? 'adv' : 'dis' };
}
function enabled() { return game.system.id === 'dnd5e' && game.settings.get(ID, 'highGround'); }
function documentOf(token) { return token?.documentName === 'Token' ? token : token?.document ?? token?.object?.document; }
function label(rule) { return `${rule.mode === 'adv' ? '高地优势' : '低地劣势'} · 高差 ${Math.abs(rule.difference)} 英尺`; }
export function forTokens(source, target, activity) {
  const a = documentOf(source), b = documentOf(target), scene = a?.parent;
  if (!enabled() || activity?.type !== 'attack' || !a || !b || a.id === b.id || scene?.id !== b.parent?.id || scene?.getFlag(ID, 'config')?.blockFeet !== STEP) return { mode: 'normal', difference: null };
  return { ...elevationRule(a.elevation, b.elevation), source: a.uuid, target: b.uuid };
}
function sourceOf(config, message) {
  if (config.workflow?.token) return config.workflow.token;
  const actor = config.subject?.actor;
  if (actor?.token) return actor.token;
  const speaker = message?.data?.speaker;
  const explicit = game.scenes.get(speaker?.scene)?.tokens.get(speaker?.token);
  if (explicit?.actor?.id === actor?.id) return explicit;
  const controlled = canvas.tokens?.controlled.filter(t => t.actor?.id === actor?.id) ?? [];
  if (controlled.length === 1) return controlled[0];
  const matching = canvas.tokens?.placeables.filter(t => t.actor?.id === actor?.id) ?? [];
  return matching.length === 1 ? matching[0] : null;
}
function preAttack(config, dialog, message) {
  if (!enabled() || config.subject?.type !== 'attack') return;
  const source = sourceOf(config, message), targets = Array.from(config.workflow ? config.workflow.targets ?? [] : game.user.targets ?? []);
  if(config.workflow?.workflowOptions?.mcbLongRange&&!config.workflow?.noDisadvantage){
    for(const roll of config.rolls??[]){roll.options??={};roll.options.disadvantage=true;}
  }
  if (!source || !targets.length) return;
  const rules = targets.map(t => forTokens(source, t, config.subject)), modes = new Set(rules.map(r => r.mode));
  if (modes.size > 1) {
    ui.notifications.warn('这些目标的高低差不同，请逐目标掷攻击骰，或使用 Midi-QOL 的逐目标攻击功能。');
    return;
  }
  const rule = rules[0]; if (rule.mode === 'normal') return;
  const blocked = rule.mode === 'adv' ? config.workflow?.noAdvantage : config.workflow?.noDisadvantage;
  if (blocked) return;
  // Add a source to this fresh roll configuration only. Never persist actor
  // flags or modify the Workflow's reusable advantage booleans.
  for (const roll of config.rolls ?? []) {
    roll.options ??= {};
    roll.options[rule.mode === 'adv' ? 'advantage' : 'disadvantage'] = true;
    roll.options.mcbHighGround = { mode: rule.mode, difference: rule.difference };
  }
  for (const collection of [config.workflow?.attackAdvAttribution, config.workflow?.advReminderAttackAdvAttribution]) {
    if (!(collection instanceof Set)) continue;
    for (const entry of collection) if (/^(ADV|DIS):(?:高地优势|低地劣势) ·/.test(entry)) collection.delete(entry);
    collection.add(`${rule.mode === 'adv' ? 'ADV' : 'DIS'}:${label(rule)}`);
  }
  if (message) { message.data ??= {}; message.data.flags ??= {}; message.data.flags[ID] = { highGround: rules }; }
}

function previewHelpers() {
  helpersPromise ??= Promise.all([
    import('../../fvtt-combat-panel/scripts/prediction-147.js'),
    import('../../fvtt-combat-panel/scripts/workflow-preview-147.js')
  ]).then(([a, b]) => ({ compute: a.computePreview, workflow: b.workflowAttackPreview }));
  return helpersPromise;
}
function readonlyToken(real, actor, position) {
  let token;
  // Wall Height annotates collision sources with the top and bottom of each sweep.
  // Keep those annotations on this preview object, isolated from the real token.
  const sweep={};
  const denied = new Set(['update', 'updateSource', 'setFlag', 'unsetFlag', 'delete', 'createEmbeddedDocuments', 'updateEmbeddedDocuments', 'deleteEmbeddedDocuments', 'control', 'release', 'setTarget', 'initializeVisionSource', 'updateVisionSource', 'initializeSources']);
  const readOnly=()=>{throw Error('Attack preview is read-only');};
  const atPosition=position&&{x:position.x,y:position.y,elevation:position.elevation};
  const center=atPosition&&{x:position.x+real.w/2,y:position.y+real.h/2};
  const doc=new Proxy(real.document,{get(t,k){
    if(k==='actor')return actor;
    if(k==='object')return token;
    if(atPosition&&Object.hasOwn(atPosition,k))return atPosition[k];
    if(denied.has(k))return readOnly;
    return Reflect.get(t,k,t);
  },set:readOnly});
  token=new Proxy(real,{get(t,k){
    if(k==='b'||k==='t')return sweep[k];
    if(atPosition&&k==='losHeight')return atPosition.elevation+(real.losHeight-real.document.elevation);
    if(k==='actor')return actor;
    if(k==='document')return doc;
    if(atPosition&&Object.hasOwn(atPosition,k))return atPosition[k];
    if(atPosition&&k==='center')return center;
    // A projected location has no live vision source. The workflow resolves sight-dependent effects.
    if(atPosition&&k==='vision')return null;
    if(denied.has(k))return readOnly;
    return Reflect.get(t,k,t);
  },set(t,k,value){if(k==='b'||k==='t'){sweep[k]=value;return true;}return readOnly();}});
  return token;
}
export async function attackPreview({ actor, sourceToken, activity, targetToken }) {
  const rule = forTokens(sourceToken, targetToken, activity);
  const helpers = await previewHelpers();
  if (rule.mode === 'normal') return helpers.compute({ actor, sourceToken, activity, targetToken, workflowResolver: helpers.workflow });
  const clone = actor.clone({}, { keepId: true }); clone.flags = foundry.utils.deepClone(actor.flags);
  foundry.utils.setProperty(clone.flags, `midi-qol.${rule.mode === 'adv' ? 'advantage' : 'disadvantage'}.attack.all`, true);
  const item = activity.item.clone({}, { parent: clone, keepId: true }), clonedActivity = item.system.activities.get(activity.id);
  const result = await helpers.compute({ actor: clone, sourceToken: readonlyToken(sourceToken, clone), activity: clonedActivity, targetToken, workflowResolver: helpers.workflow });
  result.reasons.unshift(label(rule)); result.highGround = rule; return result;
}
async function installPreview() {
  const cp = game.modules.get('fvtt-combat-panel');
  if (previewWrapped || !cp?.active || !['0.15.5','0.15.6','0.15.7','0.15.8'].includes(cp.version) || !globalThis.__dshCombatPanel?._computePreview) return;
  await previewHelpers();
  if (previewWrapped) return;
  libWrapper.register(ID, 'globalThis.__dshCombatPanel._computePreview', async function (wrapped, activity, target) {
    const original = await wrapped(activity, target);
    if (activity?.type !== 'attack'||!original||!target) return original;
    const pending=planMelee?.(this.token,activity,target);
    if(pending){
      const route=await pending;
      if(!route)return original;
      if(!route.valid)return {...original,chance:null,meleePosition:'unreachable',warnings:[route.reason],reasons:[]};
      if(route.waypoints.length>1){
        const source=readonlyToken(this.token,this.actor,route.waypoints.at(-1));
        const decision=activityRange(activity,source,target);
        if(decision?.result==='fail')return {...original,chance:null,meleePosition:'blocked',reasons:[],warnings:[decision.reason||'目标不满足攻击条件']};
        const result=await attackPreview({actor:this.actor,sourceToken:source,activity,targetToken:target});
        return {...original,...result,meleePosition:'arrival',approachFeet:route.cost};
      }
    }
    const decision=activityRange(activity,this.token,target);
    if(decision?.result==='fail')return {...original,chance:null,meleePosition:'blocked',reasons:[],warnings:[decision.reason||'目标不满足攻击条件']};
    if(typeof original.chance!=='number'||forTokens(this.token,target,activity).mode==='normal')return original;
    const result = await attackPreview({ actor: this.actor, sourceToken: this.token, activity, targetToken: target });
    return { ...original, ...result, warnings: [...new Set([...(original.warnings ?? []), ...(result.warnings ?? [])])], ...(original.stormwreckBlocked ? { chance: 0 } : {}) };
  }, 'WRAPPER');
  libWrapper.register(ID,'globalThis.__dshCombatPanel._showTargetOverlay',function(wrapped,token,preview){
    const result=wrapped(token,preview);
    if(!preview?.meleePosition)return result;
    const card=this.$hit,label=card?.querySelector('.dsh-cp-hit-label');
    if(!label)return result;
    if(preview.meleePosition==='arrival'){
      label.textContent='接敌后命中率 · 估算';
      card.title=['预计移动 '+Number(preview.approachFeet.toFixed(1))+' 尺后攻击',card.title].filter(Boolean).join('\n');
      card.setAttribute('aria-label',card.title);
    }else{
      label.textContent=preview.meleePosition==='unreachable'?'近战攻击':'当前攻击条件';
      const verdict=card.querySelector('.dsh-cp-hit-verdict');if(verdict)verdict.textContent=preview.meleePosition==='unreachable'?'无可达攻击位':(preview.warnings?.[0]||'无法攻击');
    }
    return result;
  },'WRAPPER');
  previewWrapped = true;
}
export function installHighGround({previewMeleeRoute}={}) {
  if (installed) return; installed = true;
  planMelee=previewMeleeRoute;
  Hooks.once('init', () => game.settings.register(ID, 'highGround', { name: '高低差攻击优势／劣势', hint: '本模块地图内的所有攻击检定：相差至少 5 英尺，高打低优势、低打高劣势；其他来源照常抵消。', scope: 'world', config: true, type: Boolean, default: true }));
  Hooks.on('dnd5e.preRollAttackV2', preAttack);
  const mount = () => { installPreview().catch(error => console.error(`${ID} high-ground preview`, error)); };
  Hooks.on('ready', mount); Hooks.on('canvasReady', () => setTimeout(mount, 250)); Hooks.on('3DCanvasSceneReady', mount);
}
export function highGroundStatus() { return { enabled: enabled(), thresholdFeet: STEP, attackTypes: 'all', rollHook: installed, combatPanelPreview: previewWrapped }; }
