import {matchAbilityAutomation} from './abilities-1.js';
import {matchAttackSpells} from './attack-spells-1.js';
import {matchOngoingSpells} from './ongoing-spells-1.js';
import {matchAutomationRepairs,migrateLiveVows} from './new-repairs-1.js';
import {repairBard,repairExistingInspiration} from './bard-1.js';
import {wsRepair} from './wildshape-data-1.js';
import {vampiricTouchPatch} from './vampiric-touch-1.js';
import {repairDanglingConcentration} from './wildshape-continuity-1.js';
import {macroStub,registerMacro,macroRegistry} from './macro-registry-1.js';
import {repairLegacyCard,repairLegacyWeapon,repairLegacyActor} from './legacy-data-2.js';
import {jediMigrateItems} from './weapons-1.js';
const ID='fvtt-automation-repair',CP='fvtt-combat-panel';
const list=v=>Array.from(v?.contents??v??[]),clone=v=>foundry.utils.deepClone(v);
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
function collections(){const actors=new Map(game.actors.map(a=>[a.uuid,a]));for(const scene of game.scenes)for(const token of scene.tokens)if(token.actor)actors.set(token.actor.uuid,token.actor);return{actors:[...actors.values()],items:game.items.contents};}
export function snapshotWorld(){
 return{world:game.world.id,at:new Date().toISOString(),paused:game.paused,time:game.time.worldTime,actors:game.actors.map(a=>a.toObject()),items:game.items.map(i=>i.toObject()),macros:game.macros.map(m=>m.toObject()),scenes:game.scenes.map(s=>s.toObject()),combats:game.combats.map(c=>c.toObject()),messages:game.messages.map(m=>m.toObject()),settings:game.settings.storage.get('world').contents.filter(s=>/^(core\.moduleConfiguration|midi-qol\.|midi-item-showcase-community\.|chris-premades\.|dice-so-nice\.|fvtt-|mystic-weapon-pack\.)/.test(s.key)).map(s=>s.toObject())};
}
function rewriteFlagKeys(changes){return changes?.map(c=>({...c,key:String(c.key).replace(/^flags\.fvtt-lucky\./,`flags.${ID}.lucky.`).replace(/^flags\.fvtt-battle-master\./,`flags.${ID}.battleMaster.`).replace(/^flags\.mystic-weapon-pack\./,`flags.${ID}.`)}));}
async function scopes(doc,changes){
 const flags=doc._source.flags??{},patch={};let merged=clone(flags[ID]??{});
 for(const[old,key]of[['fvtt-lucky','lucky'],['fvtt-battle-master','battleMaster'],['mystic-weapon-pack',null]])if(flags[old]){
  if(key)merged[key]={...clone(flags[old]),...merged[key]};else merged={...clone(flags[old]),...merged};patch[`flags.-=${old}`]=null;
 }
 const oldCP=flags[CP];if(oldCP)for(const key of ['abilityAutomation','abilityTemplate','ability','attackSpell','attackSpellTemplate','ongoingSpell','ongoingSpellAutomation','ongoingSpells','vampiricTouchRepair','automationRepair'])if(key in oldCP){merged[key]??=clone(oldCP[key]);patch[`flags.${CP}.-=${key}`]=null;}
 if(JSON.stringify(merged)!==JSON.stringify(flags[ID]??{}))patch[`flags.${ID}`]=merged;
 if(doc.documentName==='ActiveEffect'){const next=rewriteFlagKeys(doc.toObject().changes);if(JSON.stringify(next)!==JSON.stringify(doc.toObject().changes))patch.changes=next;}
 if(Object.keys(patch).length){const fields=Object.keys(patch);await doc.update(patch);changes.push({uuid:doc.uuid,kind:'scope',fields});}
}
const phantasmalMacro="const wf=scope?.workflow??workflow;if(wf?.activity?.type==='save')wf.workflowOptions.autoRollDamage='always';";
registerMacro('phantasmalForce',phantasmalMacro);
async function historicalCard(item,changes){
 const id=String(item.system?.identifier??'').replace(/[^a-z]/gi,'').toLowerCase(),patch={};
 if(item.type==='spell'&&(id==='phantasmalforce'||/魅影之力|Phantasmal Force/i.test(item.name))){
  const save=list(item.system.activities).find(a=>a.type==='save');if(save){const raw=save.toObject(),parts=clone(raw.damage?.parts??[]);parts[0]={...parts[0],number:item.system.source.rules==='2024'?2:1,denomination:item.system.source.rules==='2024'?8:6,types:['psychic'],custom:{enabled:false,formula:''},bonus:'',scaling:{mode:'',number:1}};
   const stem=`system.activities.${save.id}`;patch[stem+'.damage.parts']=parts;patch[stem+'.damage.onSave']='none';patch[stem+'.otherActivityId']='none';patch[stem+'.target']={override:true,prompt:false,template:{type:'',units:'ft'},affects:{type:'creature',count:'1',choice:false}};
   const previous=item.flags?.dae?.macro?.command??'';if(!previous||previous.includes('Phantasmal Force automation')||previous===macroStub('phantasmalForce')){patch['flags.dae.macro']={name:'统一自动化：魅影之力',type:'script',command:macroStub('phantasmalForce')};const entries=String(item.flags?.['midi-qol']?.onUseMacroName??'').split(',').filter(Boolean);if(!entries.includes('[preItemRoll]ItemMacro'))entries.push('[preItemRoll]ItemMacro');patch['flags.midi-qol.onUseMacroName']=entries.join(',');}
  }
 }
 if(item.system?.source?.rules==='2024'&&(id==='greatweaponfighting'||/巨武器战斗|Great Weapon Fighting/i.test(item.name))){
  patch['flags.dae.macro']={name:'统一自动化：巨武器战斗',type:'script',command:macroStub('paladin.gwf')};
 }
 if(/星辉秘银魔杖/.test(item.name)){
  patch['flags.dae.macro']={name:'MWP-MithralBurstConsume',type:'script',command:macroStub('MWP-MithralConsume')};
  const entries=String(item._source.flags?.['midi-qol']?.onUseMacroName??'').split(',').filter(Boolean).filter(e=>!/^\[postActiveEffects\](MWP-MithralBurst|DSH-MithralBurst|ItemMacro)$/.test(e));entries.push('[postActiveEffects]MWP-MithralBurst');patch['flags.midi-qol.onUseMacroName']=entries.join(',');
 }
 if(item.flags?.['chris-premades']?.info?.identifier==='vampiricTouch'&&item.flags['chris-premades'].info.version==='1.2.28')Object.assign(patch,vampiricTouchPatch(item));
 const raw=item.toObject();for(const[key,value]of Object.entries(patch)){const current=foundry.utils.getProperty(raw,key);if(key==='flags.dae.macro'?Object.entries(value).every(([k,v])=>same(current?.[k],v)):key.endsWith('.target')?same(current,foundry.utils.mergeObject(clone(current??{}),value)):same(current,value))delete patch[key];}
 if(Object.keys(patch).length){const fields=Object.keys(patch);await item.update(patch);changes.push({uuid:item.uuid,kind:'historicalCard',fields});}
}
async function migrateMacroAliases(changes){
 const names=new Set(macroRegistry.names());
 for(const name of names)if(/^(MWP-|DSH-)/.test(name)&&!game.macros.some(m=>m.name===name)){const macro=await Macro.create({name,type:'script',command:macroStub(name),ownership:{default:3}});changes.push({uuid:macro.uuid,kind:'macroStubCreated',key:name});}
 for(const macro of game.macros){
  const alias=macro.name.replace(/^DSH-(Halberd|BowGhostSight|Mithral)/,'MWP-$1');
  const key=names.has(macro.name)?macro.name:names.has(alias)?alias:null;
  if(!key){let command=macro.command;for(const quote of["'",'"'])for(const[old,member]of[['fvtt-battle-master','battleMaster'],['fvtt-lucky','lucky']]){command=command.replaceAll(`game.modules.get(${quote}${old}${quote})?.api`,`game.modules.get(${quote}${ID}${quote})?.api?.${member}`).replaceAll(`game.modules.get(${quote}${old}${quote}).api`,`game.modules.get(${quote}${ID}${quote}).api.${member}`);}if(command!==macro.command){await macro.update({command});changes.push({uuid:macro.uuid,kind:'legacyApiRedirect'});}continue;}
  const command=macroStub(key);
  if(macro.command!==command||macro.ownership.default!==3){await macro.update({command,'ownership.default':3});changes.push({uuid:macro.uuid,kind:'macroStub',key});}
 }
}
async function migrateSettings(changes){
 const config=game.settings.get('midi-qol','ConfigSettings'),patch={};
 for(const key of ['allowUseMacro','allowActorUseMacro','autoCompleteWorkflow','waitForDamageApplication'])if(config[key]!==true)patch[key]=true;
 for(const key of ['autoRollDamage','gmAutoDamage'])if(!['always','onHit'].includes(config[key]))patch[key]='onHit';
 if(config.confirmAttackDamage!=='none')patch.confirmAttackDamage='none';
 // The retired TokenBar route has no timeout for outstanding saveRequests.
 if(config.playerRollSaves==='mtb')patch.playerRollSaves='none';
 if(String(config.autoApplyDamage).includes('Misses'))patch.autoApplyDamage='yesCard';
 if(Object.keys(patch).length){await game.settings.set('midi-qol','ConfigSettings',{...config,...patch});changes.push({kind:'midiSettings',patch});}
 if(game.settings.settings.has('chris-premades.weaponMastery')&&game.settings.get('chris-premades','weaponMastery')===0){await game.settings.set('chris-premades','weaponMastery',1);changes.push({kind:'weaponMastery',value:1});}
 if(game.modules.get('dice-so-nice')?.active&&!game.settings.get('dice-so-nice','immediatelyDisplayChatMessages')){await game.settings.set('dice-so-nice','immediatelyDisplayChatMessages',true);changes.push({kind:'diceImmediate'});}
 if(game.modules.get('midi-item-showcase-community')?.active&&game.settings.settings.has('midi-item-showcase-community.Elwin Helpers')&&!game.settings.get('midi-item-showcase-community','Elwin Helpers')){await game.settings.set('midi-item-showcase-community','Elwin Helpers',true);changes.push({kind:'elwinHelpers'});}
}
export async function migrateWorld({apply=false,backup}={}){
 if(!game.user.isGM)throw Error('仅主持人可以迁移世界');
 const {actors,items}=collections(),allItems=[...items,...actors.flatMap(a=>list(a.items))];
 if(!apply)return{world:game.world.id,actors:actors.length,items:allItems.length,modules:game.modules.filter(m=>m.active).map(m=>m.id),requiresBackup:true};
 if(!backup)throw Error('迁移前必须保存完整世界API备份');await backup(snapshotWorld());
 game.modules.get(ID).api.migrating=true;
 try{
 const changes=[],errors=[],reports={};
 const run=async(name,fn)=>{try{reports[name]=await fn();for(const e of reports[name]?.errors??[])errors.push({step:name,...e});}catch(e){errors.push({step:name,error:e.message});}};
 for(const scene of game.scenes)for(const token of scene.tokens)await scopes(token,changes);
 for(const message of game.messages)await scopes(message,changes);
 for(const actor of actors){await scopes(actor,changes);for(const effect of actor.effects)await scopes(effect,changes);}
 for(const item of allItems){await scopes(item,changes);for(const effect of item.effects)await scopes(effect,changes);}
 await run('settings',()=>migrateSettings(changes));
 for(const item of allItems)await run('legacy:'+item.uuid,async()=>{changes.push(...await repairLegacyCard(item),...await repairLegacyWeapon(item));});
 // These APIs preserve embedded IDs and the current resource state.
 const noDownload=async()=>{};
 await run('abilities',()=>matchAbilityAutomation({items:allItems.filter(i=>!i.flags?.[CP]?.freeCast&&(i.system?.identifier!=='guidance'||!i.actor||i.actor.type==='character')),apply:true,backup:noDownload,includeBackup:false}));
 await run('attackSpells',()=>matchAttackSpells({items:allItems,apply:true,includeBackup:false}));
 await run('ongoingSpells',()=>matchOngoingSpells({items:allItems,apply:true,backup:noDownload,includeBackup:false}));
 await run('newRepairs',()=>matchAutomationRepairs({items:allItems,apply:true,backup:noDownload}));
 await run('liveVows',()=>migrateLiveVows(actors));
 await run('battleMaster',()=>game.modules.get(ID).api.battleMaster.matchAttackManeuvers({items:allItems,apply:true,backup:noDownload,includeBackup:false}));
 for(const actor of actors){
  await run('legacyActor:'+actor.uuid,async()=>{changes.push(...await repairLegacyActor(actor));});
  await run('bard:'+actor.uuid,async()=>[...await repairBard(actor),...await repairExistingInspiration(actor)]);
  if(actor.items.some(i=>i.system.identifier==='wild-shape'&&i.system.source.rules==='2024'))await run('wildshape:'+actor.uuid,()=>wsRepair(actor));
  await run('concentration:'+actor.uuid,()=>repairDanglingConcentration(actor));
  // Remove only persisted entries already supplied by the corresponding item effect.
  const provided=new Set();for(const item of actor.items)for(const effect of item.effects)if(effect.transfer)for(const change of effect.changes)if(change.key==='flags.midi-qol.onUseMacroName'&&String(change.value).startsWith('ItemMacro,')){const pass=String(change.value).split(',')[1];provided.add(`[${pass}]ItemMacro.${item.uuid}`);provided.add(`[${pass}]ItemMacro.${item.uuid}|${item.uuid}`);}
  const before=actor._source.flags?.['midi-qol']?.onUseMacroName??'',after=before.split(',').filter(s=>!provided.has(s.trim())).join(',');if(before!==after){await actor.update({'flags.midi-qol.onUseMacroName':after});changes.push({uuid:actor.uuid,kind:'derivedMacroCleanup'});}
 }
 for(const item of allItems){await run('card:'+item.uuid,()=>historicalCard(item,changes));if(game.modules.get(ID).api.lucky.isLucky(item))await run('lucky:'+item.uuid,()=>game.modules.get(ID).api.lucky.configureItem(item));}
 await run('macroAliases',()=>migrateMacroAliases(changes));
 await run('jedi',()=>jediMigrateItems(actors));
 if(!errors.length&&game.settings.get(ID,'migrationRevision')!==1){await game.settings.set(ID,'migrationRevision',1);changes.push({kind:'migrationRevision',value:1});}
 return{world:game.world.id,changes,reports,errors};
 }finally{game.modules.get(ID).api.migrating=false;}
}
