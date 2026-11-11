const ID='fvtt-combat-panel';
export const MIN_SCALE=.7,MAX_SCALE=1.5;
export function normalizeScale(value){const n=Number(value);return Number.isFinite(n)&&n>0?Math.max(MIN_SCALE,Math.min(MAX_SCALE,n)):1;}
export function readDisplay(){const p=game.user?.getFlag(ID,'hudDisplay')??{};return {scale:normalizeScale(p.scale),background:p.background==='transparent'?'transparent':'brown'};}
export function saveDisplay(key,value){
 if(!['scale','background'].includes(key))throw Error('Unknown HUD display preference');
 const safe=key==='scale'?normalizeScale(value):value==='transparent'?'transparent':'brown';
 return game.user.update({['flags.'+ID+'.hudDisplay.'+key]:safe});
}
