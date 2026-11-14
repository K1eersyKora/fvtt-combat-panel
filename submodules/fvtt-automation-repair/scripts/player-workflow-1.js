import { isShieldReaction } from './reaction-1.js';
import { matchesFreeSource } from './free-use-1.js';

const ID='fvtt-combat-panel', MODULE_ID='fvtt-automation-repair';
const CAST_ID = 'bg3FreeShield001';
const VERSION = 1;
const queues = new Map(), scheduled = new Map();
const list = value => Array.from(value?.contents ?? value ?? []);
const primary = () => game.user?.isGM && game.users.activeGM?.id === game.user.id;
const shield = item => isShieldReaction({ item }, { midiOptions: { isReaction: true } });
const proxy = item => item?.flags?.[ID]?.freeReaction;
function sourceForCache(item) {
  const match=item.flags?.dnd5e?.cachedFor?.match(/\.Item\.([A-Za-z0-9]+)\.Activity\.bg3FreeShield001$/);
  return match?item.actor?.items.get(match[1]):null;
}
function tagCache(data,source,original) {
  data.name=`${original.name} · ${source.flags[ID].freeCast.source||source.name}`;
  data.flags??={};data.flags.dnd5e??={};delete data.flags.dnd5e.dependents;
  data.flags[ID]={...(data.flags[ID]??{}),freeReaction:{version:VERSION,sourceId:source.id,spellId:original.id,signature:fingerprint(original)}};
  for(const effect of data.effects??[])if(effect.flags?.dnd5e)delete effect.flags.dnd5e.dependents;
  return data;
}
Hooks.on('preCreateItem',item=>{
  const source=sourceForCache(item),meta=source?.flags?.[ID]?.freeCast;
  const original=meta&&item.actor?.items.get(meta.itemId??meta.spellId);
  if(source&&original&&shield(original)){
    const data=tagCache({flags:foundry.utils.deepClone(item._source.flags),effects:foundry.utils.deepClone(item._source.effects??[])},source,original);
    item.updateSource(data,{recursive:false});
  }
});
function fingerprint(item) {
  const {system,effects,flags,img,name} = item.toObject();
  const text = JSON.stringify({system,effects,flags,img,name});
  let hash = 2166136261;
  for (let i=0;i<text.length;i++) hash = Math.imul(hash ^ text.charCodeAt(i),16777619);
  return (hash>>>0).toString(16);
}

/** Use the system's Cast activity and its cached spell so Midi can check the
 * actual itemUses resource. No fake spell slots or global reaction exemption. */
export async function syncFreeShieldReactions(actor) {
  if (!primary() || !actor?.isOwner) return { actor:actor?.id,changed:[],skipped:true };
  const previous=queues.get(actor.uuid)??Promise.resolve();
  const pending=previous.catch(()=>{}).then(()=>syncActor(actor));
  queues.set(actor.uuid,pending);
  try { return await pending; } finally { if(queues.get(actor.uuid)===pending)queues.delete(actor.uuid); }
}
async function syncActor(actor) {
  const changed=[],valid=new Set();
  if(!actor.isToken&&!game.actors.has(actor.id))return {actor:actor.id,changed,skipped:true};
  for (const source of list(actor.items).filter(i=>i.flags?.[ID]?.freeCast)) {
    const meta=source.flags[ID].freeCast;
    const original=actor.items.get(meta.itemId??meta.spellId);
    if (!original || proxy(original) || !matchesFreeSource(source,original) || !shield(original)) continue;
    valid.add(source.id);
    const castData={_id:CAST_ID,type:'cast',name:original.name,activation:{type:'reaction',value:1,override:true},
      consumption:{spellSlot:false,targets:[{type:'itemUses',target:'',value:'1',scaling:{mode:'',formula:''}}]},
      spell:{uuid:original.uuid,level:Number(original.system.level)||1,properties:[],spellbook:false}};
    let cast=source.system.activities.get(CAST_ID),castUpdated=false;
    if (!cast || cast.type!=='cast' || cast.spell.uuid!==original.uuid
      || cast.consumption.spellSlot || cast.consumption.targets.length!==1
      || cast.consumption.targets[0].type!=='itemUses' || cast.consumption.targets[0].target!==''
      || String(cast.consumption.targets[0].value)!=='1' || cast.activation.type!=='reaction'
      || cast.spell.spellbook || cast.spell.properties.size) {
      await source.update({[`system.activities.${CAST_ID}`]:castData});
      cast=actor.items.get(source.id).system.activities.get(CAST_ID);castUpdated=true;changed.push({source:source.id,action:'cast'});
    }
    // dnd5e creates the cached spell asynchronously after updating the Cast
    // activity. Wait for that native creation rather than racing it with ours.
    if(castUpdated){
      const until=Date.now()+5000;
      while(!list(actor.items).some(i=>i.flags?.dnd5e?.cachedFor===cast.relativeUUID)&&Date.now()<until)await new Promise(r=>setTimeout(r,50));
      if(!list(actor.items).some(i=>i.flags?.dnd5e?.cachedFor===cast.relativeUUID))throw Error('系统免费护盾术缓存尚未创建');
    }
    const copies=list(actor.items).filter(i=>proxy(i)?.sourceId===source.id||i.flags?.dnd5e?.cachedFor===cast.relativeUUID);
    const signature=fingerprint(original);
    let cached=copies.find(i=>proxy(i)?.spellId===original.id)??copies[0];
    const name=`${original.name} · ${meta.source||source.name}`;
    if (!cached || proxy(cached)?.signature!==signature || cached.name!==name
      || cached.flags.dnd5e?.cachedFor!==cast.relativeUUID) {
      const data=await cast.getCachedSpellData();
      if (!data) continue;
      tagCache(data,source,original);
      delete data._id;delete data.folder;
      if (cached) {
        await cached.update({name:data.name,img:data.img,system:data.system,effects:data.effects,flags:data.flags},{recursive:false});
        changed.push({item:cached.id,action:'refresh'});
      } else {
        [cached]=await actor.createEmbeddedDocuments('Item',[data]);changed.push({item:cached.id,action:'cache'});
      }
    }
    const duplicates=copies.filter(i=>i.id!==cached?.id).map(i=>i.id);
    if(duplicates.length){await actor.deleteEmbeddedDocuments('Item',duplicates);changed.push({items:duplicates,action:'dedupe'});}
  }
  // Deleting a Cast source already deletes its cache in dnd5e's own lifecycle.
  // Only prune a cache whose still-present source was rebound or invalidated;
  // racing the native deletion produces a spurious "Item does not exist" error.
  const stale=list(actor.items).filter(i=>proxy(i)&&actor.items.has(proxy(i).sourceId)&&!valid.has(proxy(i).sourceId)).map(i=>i.id);
  if(stale.length){await actor.deleteEmbeddedDocuments('Item',stale);changed.push({items:stale,action:'prune'});}
  return {actor:actor.id,changed};
}
function validProxy(item) {
  const tag=proxy(item),actor=item?.actor;
  if(!tag||!actor)return false;
  const source=actor.items.get(tag.sourceId),original=actor.items.get(tag.spellId);
  return Boolean(original&&source&&shield(original)&&matchesFreeSource(source,original)
    &&!source.flags[ID].freeCast.disabled&&Number(source.system.uses.value)>0
    &&!(original.system.method==='spell'&&Number(original.system.prepared)===0));
}
// When the ordinary spell is eligible, keep its existing resource chooser and
// suppress duplicate cached entries. With no spell slots, native linked-use
// validation admits only sources whose actual charges remain available.
Hooks.on('midi-qol.ReactionFilter',(activities,_options,_trigger,uuids)=>{
  const originals=new Set(activities.filter(a=>!proxy(a.item)).map(a=>a.item?.id));
  const remove=activities.filter(a=>proxy(a.item)&&(!validProxy(a.item)||originals.has(proxy(a.item).spellId)));
  for(const a of remove){const index=activities.indexOf(a);if(index>=0)activities.splice(index,1);const n=uuids?.indexOf(a.uuid);if(n>=0)uuids.splice(n,1);}
});
Hooks.on('midi-qol.preItemRollV2',({workflow})=>{
  if(proxy(workflow?.item)&&!validProxy(workflow.item)){ui.notifications.warn('免费护盾术来源已不可用。');return false;}
});

function schedule(actor) {
  if(!primary()||!actor?.items)return;
  clearTimeout(scheduled.get(actor.uuid));
  scheduled.set(actor.uuid,setTimeout(()=>{
    scheduled.delete(actor.uuid);syncFreeShieldReactions(actor).catch(error=>console.error(ID+' | 免费反应同步',error));
  },100));
}
for(const hook of ['createItem','updateItem','deleteItem'])Hooks.on(hook,item=>{
  if(shield(item)||item.flags?.[ID]?.freeCast||proxy(item))schedule(item.actor);
});
Hooks.on('createActor',actor=>schedule(actor));
Hooks.once('init',()=>game.settings.register(MODULE_ID,'diceFlowMigration',{scope:'world',config:false,type:Number,default:0}));
export async function configurePlayerWorkflow() {
  if(!primary())return {skipped:true};
  const settings=[];
  if(game.modules.get('dice-so-nice')?.active&&game.settings.get(MODULE_ID,'diceFlowMigration')<VERSION){
    if(!game.settings.get('dice-so-nice','immediatelyDisplayChatMessages')){
      await game.settings.set('dice-so-nice','immediatelyDisplayChatMessages',true);
      settings.push('dice-so-nice.immediatelyDisplayChatMessages');
    }
    await game.settings.set(MODULE_ID,'diceFlowMigration',VERSION);
  }
  const actors=[];
  for(const actor of game.actors){
    if(list(actor.items).some(i=>i.flags?.[ID]?.freeCast||proxy(i)))actors.push(await syncFreeShieldReactions(actor));
  }
  return {settings,actors};
}
Hooks.once('ready',()=>{
  const fixes={syncFreeShieldReactions,configure:configurePlayerWorkflow};
  game.modules.get(MODULE_ID).api={...game.modules.get(MODULE_ID).api,playerWorkflow:fixes};
  fixes.ready=configurePlayerWorkflow();
  fixes.ready.catch(error=>{console.error(ID+' | 玩家工作流初始化',error);ui.notifications.error('玩家工作流修复初始化失败，请检查控制台。');});
});
