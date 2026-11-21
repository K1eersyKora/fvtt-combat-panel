import { ID, active3D, legacyDefault } from './scene-view-1.js';
import {picturePoint} from './standee-points-1.js';
const STEP=5;
export function elevationRule(source, target, { attack = true, enabled = true } = {}) {
  const difference = Number(source) - Number(target);
  if (!enabled || !attack || !Number.isFinite(Number(source)) || !Number.isFinite(Number(target))) return { mode: 'normal', difference: null };
  return { mode: difference >= STEP - 1e-8 ? 'adv' : difference <= -STEP + 1e-8 ? 'dis' : 'normal', difference };
}
export function combineAdvantage(advantage, disadvantage, mode, { noAdvantage = false, noDisadvantage = false } = {}) {
  const adv = !noAdvantage && (!!advantage || mode === 'adv'), dis = !noDisadvantage && (!!disadvantage || mode === 'dis');
  return { advantage: adv, disadvantage: dis, mode: adv === dis ? 'normal' : adv ? 'adv' : 'dis' };
}
function enabled() { return active3D() && game.system.id==='dnd5e' && game.settings.get(ID,'highGround'); }
function documentOf(token) { return token?.documentName === 'Token' ? token : token?.document ?? token?.object?.document; }
function label(rule) { return `${rule.mode === 'adv' ? '高地优势' : '低地劣势'} · 高差 ${Math.abs(rule.difference)} 英尺`; }
export function forTokens(source, target, activity) {
  const a = documentOf(source), b = documentOf(target), scene = a?.parent;
  if (!enabled() || activity?.type!=='attack' || !a || !b || a.id===b.id || scene!==canvas.scene || scene!==b.parent) return {mode:'normal',difference:null};
  return { ...elevationRule(picturePoint(a).elevation, picturePoint(b).elevation), source: a.uuid, target: b.uuid };
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

async function preview(input,compute){
  const {actor,activity,sourceToken,targetToken}=input;
  const rule=forTokens(sourceToken,targetToken,activity);
  if(rule.mode==='normal')return compute(input);
  const {readonlyToken}=await import('../../fvtt-combat-panel/scripts/preview-token-1.js');
  const clone=actor.clone({}, {keepId:true});
  clone.flags=foundry.utils.deepClone(actor.flags);
  const modifier=rule.mode==='adv'?'advantage':'disadvantage';
  foundry.utils.setProperty(clone.flags,`midi-qol.${modifier}.attack.all`,true);
  const item=activity.item.clone({}, {parent:clone,keepId:true});
  const result=await compute({...input,actor:clone,sourceToken:readonlyToken(sourceToken,clone),activity:item.system.activities.get(activity.id)});
  result.reasons.unshift(label(rule));
  result.highGround=rule;
  return result;
}

export const highGround={enabled,forTokens,preview};

export function installHighGround(){
  Hooks.once('init',()=>game.settings.register(ID,'highGround',{
    name:'高低差攻击优势／劣势',hint:'三维场景中相差至少 5 英尺时，高打低有优势，低打高有劣势。',
    scope:'world',config:true,type:Boolean,default:legacyDefault('highGround','world'),
    onChange:()=>globalThis.__dshCombatPanel?._invalidatePreview?.(),
  }));
  Hooks.on('dnd5e.preRollAttackV2',preAttack);
}

