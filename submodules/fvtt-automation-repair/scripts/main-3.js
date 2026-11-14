import {macroRegistry} from './macro-registry-1.js';
import {embeddedRegistry} from './embedded-1.js';
import './weapons-1.js';
import './lucky-1.js';
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
import {migrateWorld,snapshotWorld} from './migration-3.js';
import {registerWildShapeContinuity} from './wildshape-continuity-1.js';
const ID='fvtt-automation-repair';
Hooks.once('init',()=>{
 game.settings.register(ID,'migrationRevision',{scope:'world',config:false,type:Number,default:0});
 const module=game.modules.get(ID);module.api??={};Object.assign(module.api,{version:'1.0.2',macros:macroRegistry,embedded:embeddedRegistry,migrateWorld,snapshotWorld,matchAbilityAutomation,matchOngoingSpells,matchAttackSpells,matchAutomationRepairs,repairCloudMembership});
});
registerAutomationRepairs();
Hooks.once('ready',()=>{
 const old=['fvtt-lucky','fvtt-battle-master'].filter(id=>game.modules.get(id)?.active);
 if(game.modules.get('mystic-weapon-pack')?.active&&Array.from(game.modules.get('mystic-weapon-pack').esmodules??[]).length)old.push('mystic-weapon-pack');
 if(old.length){ui.notifications.error('统一自动化发现仍启用的旧执行入口：'+old.join(', '));return;}
 registerFeatureHooks();registerAbilityAutomation();registerOngoingSpells();registerCloudRegions();registerWildShapeContinuity();
 console.info(`[${ID}] 1.0.2 ready`);
});
