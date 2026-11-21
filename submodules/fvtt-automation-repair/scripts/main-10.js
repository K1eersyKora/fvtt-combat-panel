import {registerJediLevel7,migrateJediLevel7,syncJediLevel7,precisionBonus,attackBudget,hasJediLevel7} from "./jedi-level7-1.js";
import {registerJediHooks,repairJediItems} from "./jedi-3.js";
import {macroRegistry} from './macro-registry-1.js';
import {embeddedRegistry} from './embedded-4.js';
import './weapons-4.js';
import './lucky-2.js';
import './battle-master-1.js';
import './reaction-1.js';
import './player-workflow-1.js';
import './gwf-1.js';
import './shillelagh-1.js';
import {registerFeatureHooks} from './smite-1.js';
import {registerAbilityAutomation,matchAbilityAutomation} from './abilities-1.js';
import {registerOngoingSpells,matchOngoingSpells} from './ongoing-spells-1.js';
import {registerCloudRegions,repairCloudMembership} from './cloud-regions-1.js';
import {matchAttackSpells} from './attack-spells-1.js';
import {registerAutomationRepairs,matchAutomationRepairs} from './new-repairs-1.js';
import {migrateWorld,snapshotWorld} from './migration-7.js';
import {bardAutomation,registerBardHooks} from './bard-cards-1.js';
import {registerWildShapeContinuity} from './wildshape-continuity-1.js';
import {registerResonantBracer} from './resonant-bracer-2.js';
const ID='fvtt-automation-repair';
Hooks.once('init',()=>{
 game.settings.register(ID,'migrationRevision',{scope:'world',config:false,type:Number,default:0});
 const module=game.modules.get(ID);module.api??={};Object.assign(module.api,{version:'1.0.9',bard:bardAutomation,jediLevel7:{migrate:migrateJediLevel7,sync:syncJediLevel7,precisionBonus,attackBudget,hasJediLevel7},macros:macroRegistry,embedded:embeddedRegistry,migrateWorld,snapshotWorld,matchAbilityAutomation,matchOngoingSpells,matchAttackSpells,matchAutomationRepairs,repairCloudMembership});
});
registerAutomationRepairs();
Hooks.once('ready',()=>{
 const old=['fvtt-lucky','fvtt-battle-master'].filter(id=>game.modules.get(id)?.active);
 if(game.modules.get('mystic-weapon-pack')?.active&&Array.from(game.modules.get('mystic-weapon-pack').esmodules??[]).length)old.push('mystic-weapon-pack');
 if(old.length){ui.notifications.error('统一自动化发现仍启用的旧执行入口：'+old.join(', '));return;}
 registerResonantBracer(ID);
 registerJediHooks();registerJediLevel7();
 registerBardHooks();
 if(game.user.isGM&&game.users.activeGM?.id===game.user.id)repairJediItems().catch(console.error);
 registerFeatureHooks();registerAbilityAutomation();registerOngoingSpells();registerCloudRegions();registerWildShapeContinuity();
 console.info(`[${ID}] 1.0.9 ready`);
});
