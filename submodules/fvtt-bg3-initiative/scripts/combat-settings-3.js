// About Time exposes one setting for both createCombat and deleteCombat pauses.
// Use that integration instead of intercepting Game.togglePause or manual pauses.
export async function configureCombatPause(){
 if(!game.user.isGM||game.users.activeGM?.id!==game.user.id)return [];
 const changed=[];
 for(const id of ['about-time-next','about-time']){
  const key='rtAutoPauseCombat';
  if(!game.modules.get(id)?.active||!game.settings.settings.has(id+'.'+key))continue;
  if(game.settings.get(id,key)===false)continue;
  await game.settings.set(id,key,false);changed.push(id+'.'+key);
 }
 return changed;
}
