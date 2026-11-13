const ID='fvtt-bg3-initiative',PARTY='fvtt-party-tools';
const transitions=new Map();
const authority=()=>game.user.isGM&&game.users.activeGM?.id===game.user.id;
const now=()=>game.time.serverTime;
export function storyParticipants(state,scene){
 const ids=new Set([...(state.participantIds??[]),...(state.roster??[]).map(r=>r.tokenId),...(state.strikeResult?.targetIds??[])]);
 // Include NPCs revealed or created after the cinematic session began.
 for(const token of scene.tokens)if(token.actor&&!token.hidden)ids.add(token.id);
 const required=new Set((state.roster??[]).map(r=>r.tokenId));required.add(state.opener?.tokenId);
 if(state.opener?.tokenId)ids.add(state.opener.tokenId);
 return [...ids].map(id=>scene.tokens.get(id)).filter(t=>t?.actor&&(!t.hidden||required.has(t.id)));
}
export function enterStoryEncounter(state){
 if(!authority())return Promise.reject(Error('只有当前主持人可以创建剧情遭遇。'));
 if(transitions.has(state.id))return transitions.get(state.id);
 const pending=enter(state).finally(()=>transitions.delete(state.id));transitions.set(state.id,pending);return pending;
}
async function enter(state){
 const current=()=>game.settings.get(PARTY,'storyState');
 const valid=()=>authority()&&current().id===state.id&&current().phase==='starting';
 if(!valid())throw Error('剧情入战已取消。');
 const scene=game.scenes.get(state.sceneId);if(!scene)throw Error('剧情场景已不存在。');
 const tokens=storyParticipants(state,scene);if(!tokens.length)throw Error('没有可加入遭遇的剧情参与者。');
 const sfx=game.modules.get('fvtt-bg3-encounter-sfx')?.api;
 if(!sfx?.playEncounterStart)throw Error('BG3 遭遇提示音尚未就绪。');
 // Persist the cue claim before playing it, so recovery never replays a claimed cue.
 if(!current().soundAt){
  await game.settings.set(PARTY,'storyState',{...current(),soundAt:now()});
  sfx.playEncounterStart(scene.id,'story:'+state.id);
 }
 if(!valid())throw Error('剧情入战已取消。');
 if(canvas.scene?.id===scene.id){
  canvas.tokens.releaseAll();
  for(const token of tokens)token.object?.control({releaseOthers:false});
 }
 let combat=game.combats.find(c=>c.getFlag(ID,'storyEntry')?.sessionId===state.id);
 combat??=game.combats.find(c=>c.active&&!c.started&&c.scene?.id===scene.id);
 if(!combat)combat=await CONFIG.Combat.documentClass.create({scene:scene.id,active:true,flags:{[ID]:{storyEntry:{sessionId:state.id,reason:state.reason??'vote',opener:state.opener??null}}}});
 if(combat.scene?.id!==scene.id)throw Error('遭遇不属于当前剧情场景。');
 const existing=new Set(combat.combatants.map(c=>c.tokenId));
 const added=tokens.filter(t=>!existing.has(t.id));
 if(added.length)await combat.createEmbeddedDocuments('Combatant',added.map(t=>({tokenId:t.id,actorId:t.actorId,sceneId:scene.id,name:t.name,img:t.texture.src,hidden:t.hidden})));
 // Creating a new active document does not replace an already-viewed encounter
 // on every client. Activate through the native operation before rolling/starting.
 await combat.activate();
 const ids=new Set(tokens.map(t=>t.id)),participants=combat.combatants.filter(c=>ids.has(c.tokenId));
 await combat.setFlag(ID,'storyEntry',{sessionId:state.id,reason:state.reason??'vote',opener:state.opener??null,participantIds:participants.map(c=>c.id),soundAt:current().soundAt});
 if(!valid())throw Error('剧情入战已取消。');
 const missing=participants.filter(c=>c.initiative===null).map(c=>c.id);
 // Native dnd5e initiative retains bonuses, advantage, ties and normal turn ordering.
 if(missing.length)await combat.rollInitiative(missing);
 if(!valid())throw Error('剧情入战已取消。');
 if(!combat.started)await combat.startCombat();

 Hooks.callAll('combatPanelStoryEncounterStarted',combat,{sessionId:state.id,reason:state.reason??'vote'});
 return combat;
}
