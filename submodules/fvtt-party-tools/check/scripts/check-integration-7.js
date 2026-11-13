import {registerCheckSettings,registerCheckControl,startCheckEngine,openCheckDialog} from './check-engine-7.js';

const ID='fvtt-party-tools', LEGACY='fvtt-bg3-check';
const mapping=Object.freeze([
  {old:'showDC',key:'checkShowDC',scope:'world',valid:v=>typeof v==='boolean'},
  {old:'autoRollSeconds',key:'checkAutoRollSeconds',scope:'world',valid:v=>typeof v==='number'&&Number.isFinite(v)},
  {old:'playResultSound',key:'checkPlayResultSound',scope:'world',valid:v=>typeof v==='boolean'},
  {old:'playSelectionSound',key:'checkPlaySelectionSound',scope:'client',valid:v=>typeof v==='boolean'}
]);
let registered=false,legacyAtStart=false,initialization=null,openingLegacy=null,legacyOpen=null;

function stored(scope,key) {
  if(scope==='client')return game.settings.storage.get('client')?.getItem?.(key)??globalThis.localStorage?.getItem?.(key)??null;
  const storage=game.settings.storage.get('world');
  return (storage?.get(key)??storage?.find?.(s=>s.key===key))?.value??null;
}
function decoded(value) {
  if(value===null||value===undefined)return undefined;
  if(typeof value!=='string')return value;
  try{return JSON.parse(value);}catch{return undefined;}
}
export async function migrateLegacyCheckSettings() {
  const changed=[];
  if(game.modules.get(LEGACY)?.active)return {deferred:true,changed};
  for(const scope of ['world','client']){
    if(scope==='world'&&!game.user.isGM)continue;
    const marker=scope==='world'?'checkSettingsMigrated':'checkClientSettingsMigrated';
    if(game.settings.get(ID,marker))continue;
    for(const row of mapping.filter(m=>m.scope===scope)){
      if(stored(scope,ID+'.'+row.key)!==null)continue;
      const value=decoded(stored(scope,LEGACY+'.'+row.old));
      if(row.valid(value)&&game.settings.get(ID,row.key)!==value){
        await game.settings.set(ID,row.key,value);changed.push(row.key);
      }
    }
    await game.settings.set(ID,marker,true);
  }
  return {deferred:false,changed};
}
function currentLegacyDialog() {
  return [...(foundry.applications.instances?.values()??[])].find(app=>app.rendered&&app.element?.isConnected&&app.element.classList.contains('bg3-dm-dialog'));
}
function linkLegacyControl(controls=ui.controls?.controls) {
  const tokens=controls?.tokens??controls?.get?.('tokens'),tools=tokens?.tools;
  const tool=tools?.['fvtt-bg3-check-open']??tools?.get?.('fvtt-bg3-check-open');
  if(tool?.onChange&&tool.onChange!==openSkillChecks){legacyOpen=tool.onChange;tool.onChange=openSkillChecks;}
}
async function openLegacyCheck() {
  const existing=currentLegacyDialog();if(existing){existing.bringToFront?.();return existing;}
  if(openingLegacy)return openingLegacy;
  openingLegacy=(async()=>{
    linkLegacyControl();
    if(legacyOpen)await legacyOpen();
    else {
      const button=document.querySelector('[data-tool="fvtt-bg3-check-open"]');
      if(!button)throw Error('旧检定入口尚未就绪，请稍后再试。');
      button.click();
    }
    for(let n=0;n<600;n++){
      const dialog=currentLegacyDialog();if(dialog)return dialog;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('技能检定窗口未能打开。');
  })().finally(()=>{openingLegacy=null;});
  return openingLegacy;
}
export async function openSkillChecks() {
  if(!game.user?.isGM){ui.notifications.warn('只有主持人可以发起技能检定。');return null;}
  try {
    if(initialization)await initialization;
    return legacyAtStart?await openLegacyCheck():await openCheckDialog();
  }catch(error){console.error('['+ID+'] 技能检定',error);ui.notifications.error(error.message);return null;}
}
export function registerIntegratedChecks() {
  if(registered)return;registered=true;
  Hooks.once('init',()=>{
    legacyAtStart=!!game.modules.get(LEGACY)?.active;
    if(!legacyAtStart)registerCheckControl(openSkillChecks);
    else {
      Hooks.on('getSceneControlButtons',controls=>queueMicrotask(()=>linkLegacyControl(controls)));
      Hooks.on('renderSceneControls',()=>linkLegacyControl());
    }
    registerCheckSettings(!legacyAtStart);
    game.settings.register(ID,'checkSettingsMigrated',{scope:'world',config:false,type:Boolean,default:false});
    game.settings.register(ID,'checkClientSettingsMigrated',{scope:'client',config:false,type:Boolean,default:false});
  });
  Hooks.once('ready',()=>{
    const module=game.modules.get(ID);
    const checks={open:openSkillChecks,provider:legacyAtStart?'legacy':'integrated',migrateSettings:migrateLegacyCheckSettings};
    module.api={...module.api,checks,openChecks:openSkillChecks};
    initialization=(async()=>{
      await module.api.ready;
      if(!legacyAtStart){await migrateLegacyCheckSettings();startCheckEngine();}
      else linkLegacyControl();
      return checks.provider;
    })();
    checks.ready=initialization;
    initialization.catch(error=>{console.error('['+ID+'] 技能检定初始化',error);ui.notifications.error(error.message);});
  });
}
