const PARENT='fvtt-combat-panel';
export function parentUI(){
 const module=game.modules.get(PARENT);
 if(!module?.active||module.api?.ui?.version!==1)throw Error('BG3队伍与剧情需要战斗面板 0.15.0 或更新版，请同时启用两个模块。');
 return module.api.ui;
}
export const getController=()=>parentUI().getController();
export const patchHTML=(...args)=>parentUI().patchHTML(...args);
export const spellShapeHTML=(...args)=>parentUI().spellShapeHTML(...args);
export const usesLeft=(...args)=>parentUI().usesLeft(...args);
export const resolveConsumptionItem=(...args)=>parentUI().resolveConsumptionItem(...args);
