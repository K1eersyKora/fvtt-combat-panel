import {ID} from './scene-view-1.js';
import {picturePoint} from './standee-points-1.js';
import {installCamera,cameraStatus} from './camera-4.js';
import {installHighGround,highGround} from './high-ground-2.js';
import {installSpellVfx,spellVfxStatus} from './spell-vfx-5.js';
import {installAreaVisuals} from './concentration-area-1.js';
import {installEffectCleanup} from './effect-cleanup-1.js';
import {installAnimationRate} from './animation-runtime-2.js';

installHighGround();
installAreaVisuals();
installEffectCleanup();
installSpellVfx();
installCamera();
installAnimationRate();
Hooks.once('init',()=>{
  game.modules.get(ID).api={picturePoint,highGround,camera:{status:cameraStatus},spellVfx:{status:spellVfxStatus}};
});
