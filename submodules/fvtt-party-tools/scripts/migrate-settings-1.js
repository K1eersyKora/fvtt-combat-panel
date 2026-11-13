const ID='fvtt-party-tools',PARENT='fvtt-combat-panel';
const rows=[
 ['partyEnabled','client',v=>typeof v==='boolean'],
 ['partyPosition','client',v=>v&&Number.isFinite(v.x)&&Number.isFinite(v.y)],
 ['partyScale','client',v=>Number.isFinite(v)&&v>=.5&&v<=1.6],
 ['movementMode','world',v=>['free','none','combat'].includes(v)],
 ['restrictionMode','world',v=>typeof v==='boolean'],
 ['restrictedPlayers','world',v=>Array.isArray(v)&&v.every(id=>typeof id==='string')],
 ['storyState','world',v=>v&&['off','story','starting'].includes(v.phase)],
 ['checkShowDC','world',v=>typeof v==='boolean'],
 ['checkAutoRollSeconds','world',v=>Number.isFinite(v)&&v>=0],
 ['checkPlayResultSound','world',v=>typeof v==='boolean'],
 ['checkPlaySelectionSound','client',v=>typeof v==='boolean']
];
function raw(scope,key){
 const storage=game.settings.storage.get(scope);
 if(scope==='client')return storage?.getItem?.(key)??globalThis.localStorage?.getItem?.(key)??null;
 return (storage?.get(key)??storage?.find?.(v=>v.key===key))?.value??null;
}
function decode(value){if(value===null||value===undefined)return undefined;if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return value;}}
export function registerMigrationSettings(){
 for(const [key,scope]of [['splitSettingsMigrated','world'],['splitClientSettingsMigrated','client']])game.settings.register(ID,key,{scope,config:false,type:Boolean,default:false});
}
export async function migrateSplitSettings(){
 const changed=[];
 for(const scope of ['world','client']){
  if(scope==='world'&&game.user.id!==game.users.activeGM?.id)continue;
  const marker=scope==='world'?'splitSettingsMigrated':'splitClientSettingsMigrated';
  if(game.settings.get(ID,marker))continue;
  for(const [key,rowScope,valid]of rows){
   if(rowScope!==scope||raw(scope,ID+'.'+key)!==null)continue;
   const value=decode(raw(scope,PARENT+'.'+key));
   if(valid(value)){await game.settings.set(ID,key,value);changed.push(key);}
  }
  await game.settings.set(ID,marker,true);
 }
 return {changed};
}
