import {InitiativeBar, registerBarSettings} from './initiative-bar-5.js';
import {enterStoryEncounter} from './story-encounter-3.js';
import {configureCombatPause} from './combat-settings-3.js';
const ID='fvtt-bg3-initiative';
Hooks.once('init',registerBarSettings);
Hooks.once('ready',async()=>{
 try{
  await game.modules.get('fvtt-party-tools')?.api?.ready;
  await configureCombatPause();
  const ui=game.modules.get('fvtt-combat-panel')?.api?.ui;
  if(ui?.version!==1)throw Error('BG3先攻栏需要战斗面板 0.15.0 或更新版本。');
  const bar=new InitiativeBar(ui);
  game.modules.get(ID).api={version:'0.1.4',bar,refresh:()=>bar.schedule(),enterStoryEncounter};
 }catch(error){console.error('['+ID+']',error);ui.notifications.error(error.message);}
});
