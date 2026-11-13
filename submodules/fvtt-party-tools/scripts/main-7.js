import {registerPartySettings,installPartyPanel} from './party-movement-7.js';
import {registerStorySettings,installStoryMode} from './story-mode-7.js';
import {installPeerInspector} from './peer-inspector-4.js';
import {registerIntegratedChecks} from '../check/scripts/check-integration-7.js';
import {registerMigrationSettings,migrateSplitSettings} from './migrate-settings-1.js';
import {parentUI} from './parent-ui-1.js';
import {installThemeLink} from './theme-link-2.js';
const ID='fvtt-party-tools';
Hooks.once('init',()=>{registerPartySettings();registerStorySettings();registerMigrationSettings();});
// Register this ready listener before checks: the check engine awaits migration.
Hooks.once('ready',()=>{
 const module=game.modules.get(ID);
 const ready=(async()=>{
  parentUI();
  const migration=await migrateSplitSettings();
  const theme=installThemeLink();
  const party=installPartyPanel();
  installStoryMode();installPeerInspector();
  return {migration,party,theme};
 })();
 module.api={...module.api,ready,migrateSettings:migrateSplitSettings};
 ready.catch(error=>{console.error('['+ID+']',error);ui.notifications.error(error.message);});
});
registerIntegratedChecks();
