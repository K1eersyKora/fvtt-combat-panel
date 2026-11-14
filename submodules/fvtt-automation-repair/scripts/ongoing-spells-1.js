const ID='fvtt-automation-repair';
const list=value=>Array.from(value?.contents??value??[]);
const copy=value=>foundry.utils.deepClone(value);
const normalized=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const canonical=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a.localeCompare(b))):entry);

export function ongoingSpellKind(item){
  if(item.type!=='spell')return null;
  const ids=[item.system?.identifier,item.flags?.['chris-premades']?.info?.identifier].map(normalized);
  if(ids.includes('witchbolt')||/^巫术箭(?:\s|$)|^witch bolt(?:\s|$)/i.test(item.name??''))return 'witchBolt';
  if(ids.includes('cloudofdaggers')||/^匕首之云(?:\s|$)|^cloud of daggers(?:\s|$)/i.test(item.name??''))return 'cloudOfDaggers';
  return null;
}

// GP2.1.33's 2024 callbacks: the event's user executes entry, and the primary GM executes turn end.
const cloudBehaviors=[
  {_id:'O40QtQ1hMs0RUHV3',name:'tokenEnter',type:'executeScript',disabled:false,flags:{},system:{events:['tokenEnter'],source:'await game.gps.cloudOfDaggers2024({tokenUuid: event.data.token.uuid, regionUuid: region.uuid, regionScenario: "tokenEnter", movementScenario: event.data?.movement, userId: event.user.id});'}},
  {_id:'O8NswCmZEREgHbmE',name:'tokenEndsTurn',type:'executeScript',disabled:false,flags:{},system:{events:['tokenTurnEnd'],source:'if(game.user.id !== game.gps.getPrimaryGM()) return;\nawait game.gps.cloudOfDaggers2024({tokenUuid: event.data.token.uuid, regionUuid: region.uuid, regionScenario: "tokenTurnEnd", movementScenario: event.data?.movement, userId: event.user.id});'}}
];

function minuteDuration(source,activity){
  const ids=new Set((activity.effects??[]).map(effect=>effect._id));
  for(const effect of source.effects??[]){
    if(!ids.has(effect._id))continue;
    effect.duration={...effect.duration,seconds:60,rounds:null,turns:null,combat:null,startRound:null,startTurn:null,startTime:null};
  }
}

export function patchOngoingSpell(source,{cloudEnabled=true}={}){
  const kind=ongoingSpellKind(source);if(!kind)return null;
  const data=copy(source),activities=Object.values(data.system.activities??{});
  if(kind==='witchBolt'&&source.system.source?.rules==='2014'&&!activities.some(activity=>activity.activation?.type==='bonus'))return null;
  if(kind==='cloudOfDaggers'){
    const backend=source.flags?.['chris-premades']?.info?.source;
    const callbacks=JSON.stringify(source.flags?.['region-attacher']?.regionBehaviors??{});
    const gp=backend==='gambits-premades'||backend!=='chris-premades'&&(/game\.gps\.cloudOfDaggers/.test(callbacks)||/game\.gps\.cloudOfDaggers/.test(source.flags?.['midi-qol']?.onUseMacroName??''));
    if(!gp)return null;
  }
  if(kind==='witchBolt'){
    const attacks=activities.filter(activity=>activity.type==='attack');
    if(!attacks.length)throw Error('巫术箭没有攻击活动');
    for(const activity of attacks){
      activity.otherActivityId='none';
      activity.duration={...activity.duration,override:true,value:'1',units:'minute',concentration:true};
      minuteDuration(data,activity);
    }
    for(const activity of activities.filter(activity=>activity.type==='damage'&&activity.activation?.type==='bonus')){
      activity.midiProperties={...activity.midiProperties,otherActivityCompatible:false};
      activity.duration={...activity.duration,override:true,units:'inst',concentration:false};
      activity.consumption={...activity.consumption,spellSlot:false};
    }
  }else{
    if(!cloudEnabled)throw Error('匕首之云需要启用其 GP 区域自动化依赖');
    const primary=activities.find(activity=>activity.target?.template?.type&&activity.type==='utility');
    if(!primary)throw Error('匕首之云没有 GP 区域施法活动');
    data.flags??={};data.flags['region-attacher']??={};
    const region=data.flags['region-attacher'];
    region.attachRegionToTemplate={...region.attachRegionToTemplate,[primary._id]:true};
    region.regionBehaviors={...region.regionBehaviors,[primary._id]:copy(cloudBehaviors)};
    data.flags['midi-qol']??={};
    const macros=String(data.flags['midi-qol'].onUseMacroName??'').split(',').filter(Boolean).filter(macro=>!/function\.game\.gps\.cloudOfDaggers(?:2024)?$/.test(macro));
    macros.push('[templatePlaced]function.game.gps.cloudOfDaggers2024','[postActiveEffects]function.game.gps.cloudOfDaggers2024');
    data.flags['midi-qol'].onUseMacroName=macros.join(',');
    primary.otherActivityId='none';
    primary.midiProperties={...primary.midiProperties,autoCEEffects:'default'};
    minuteDuration(data,primary);
  }
  data.flags??={};data.flags[ID]??={};
  data.flags[ID].ongoingSpellAutomation={key:kind,revision:1};
  return data;
}

const cloudEnabled=()=>game.modules.get('gambits-premades')?.active&&typeof game.gps?.cloudOfDaggers2024==='function';

export async function matchOngoingSpells({actors=[],items=[],allCharacters=false,apply=false,backup,includeBackup=false}={}){
  const selected=[...actors,...(allCharacters?game.actors.filter(actor=>actor.type==='character'):[])];
  const unique=new Map([...items,...selected.flatMap(actor=>list(actor.items))].filter(Boolean).map(item=>[item.uuid,item]));
  const pending=[],errors=[];
  for(const item of unique.values()){
    const key=ongoingSpellKind(item);if(!key)continue;
    try{
      const before=item.toObject(),data=patchOngoingSpell(before,{cloudEnabled:cloudEnabled()});
      if(data&&canonical(before)!==canonical(data))pending.push({item,key,before,data});
    }catch(error){errors.push({uuid:item.uuid,name:item.name,error:error.message});}
  }
  const backups=pending.map(({item,before})=>({uuid:item.uuid,data:before}));
  if(apply&&pending.length){
    if(!game.user.isGM)throw Error('请由 GM 匹配现有持续法术卡片');
    if(backup)await backup(backups);else saveDataToFile(JSON.stringify(backups,null,2),'application/json',`ongoing-spells-backup-${Date.now()}.json`);
    for(const {item,data}of pending)await item.update(data,{diff:false,recursive:false});
  }
  return {changes:pending.map(({item,key})=>({uuid:item.uuid,name:item.name,key})),errors,...(includeBackup?{backups}:{})};
}

export function registerOngoingSpells(){
  if(globalThis.__dshOngoingSpells179)return;globalThis.__dshOngoingSpells179=true;
  const patch=data=>{
    const kind=ongoingSpellKind(data);if(!kind||kind==='cloudOfDaggers'&&!cloudEnabled())return null;
    try{return patchOngoingSpell(data,{cloudEnabled:cloudEnabled()});}catch(error){console.warn(`[${ID}] 持续法术导入保持原数据`,error);return null;}
  };
  Hooks.on('preCreateItem',item=>{if(!['character','npc'].includes(item.parent?.type))return;const data=patch(item.toObject());if(data)item.updateSource(data,{recursive:false});});
  Hooks.on('preCreateActor',actor=>{if(!['character','npc'].includes(actor.type))return;const source=actor.toObject();let changed=false;const items=(source.items??[]).map(item=>{const data=patch(item);changed||=!!data;return data??item;});if(changed)actor.updateSource({items});});
}
