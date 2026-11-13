export const STORY_ID='fvtt-party-tools';
export const STORY_GRACE_MS=3000;
export function storyNow(){return globalThis.game?.time?.serverTime??Date.now();}
export const STORY_CHOICES=Object.freeze({agree:{label:'我赞同',short:'赞同',icon:'fa-check'},neutral:{label:'我无所谓',short:'无所谓',icon:'fa-minus'},oppose:{label:'我反对',short:'反对',icon:'fa-xmark'}});
export function readStoryState(){try{return game.settings.get(STORY_ID,'storyState')??{phase:'off'};}catch{return {phase:'off'};}}
export function isStoryActive(){return readStoryState().phase==='story';}
export function isStoryStriker(user=game.user){const s=readStoryState();return !!user&&s.phase==='story'&&s.opener?.userId===user.id;}
export function isStoryPlayer(user=game.user){return !!user&&!user.isGM&&isStoryActive()&&!isStoryStriker(user);}
export function storyThreshold(count){return Math.floor(Math.max(0,count)/2)+1;}
export function storyVote(user,state=readStoryState()){
 const vote=user?.getFlag('fvtt-combat-panel','storyVote');
 return vote?.sessionId===state.id&&Object.hasOwn(STORY_CHOICES,vote.choice)?vote.choice:null;
}
export function storyTally(state,users){
 const roster=Array.isArray(state?.roster)?state.roster:[];
 const eligible=[...new Set(roster.map(r=>r.userId))].map(id=>users.get(id)).filter(u=>u&&!u.isGM);
 const counts={agree:0,neutral:0,oppose:0};for(const user of eligible){const choice=storyVote(user,state);if(choice)counts[choice]++;}
 // The entry roster remains the denominator when someone disconnects.
 return {...counts,total:roster.length,threshold:storyThreshold(roster.length)};
}
