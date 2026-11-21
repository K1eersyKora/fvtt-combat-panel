const ID = 'fvtt-automation-repair';
const consumption = value => ({spellSlot: false, targets: [{type: 'itemUses', target: '', value: String(value), scaling: {mode: '', formula: ''}}]});
const cast = (id, name, uuid, replacement = false) => ({
  _id: id, type: 'cast', name,
  activation: {type: replacement ? 'special' : 'action', value: 1, override: true, condition: replacement ? '尼曼：替换攻击动作中的一次攻击' : '消耗两枚原力骰'},
  range: {override: true, value: uuid.includes('CPRSpells') ? '60' : '30', units: 'ft'},
  target: uuid.includes('CPRSpells')
    ? {override: true, prompt: true, affects: {type: '', count: ''}, template: {type: 'sphere', size: '20', units: 'ft'}}
    : {override: true, prompt: false, affects: {type: 'creature', count: '1'}, template: {type: ''}},
  consumption: consumption(2), spell: {uuid, ability: 'wis', level: 2, properties: ['vocal', 'material'], spellbook: false}
});
const force = (id, name) => ({
  _id: id, type: 'save', name,
  activation: {type: 'special', value: 1, override: true, condition: '尼曼：替换攻击动作中的一次攻击'},
  consumption: consumption(1), range: {override: true, value: '30', units: 'ft'},
  target: {override: true, prompt: false, affects: {type: 'creature', count: '1'}, template: {type: ''}},
  save: {ability: ['str'], dc: {calculation: 'wis', formula: ''}},
  damage: {onSave: 'none', parts: [{number: 1, denomination: 8, bonus: '@abilities.wis.mod', types: ['force'], custom: {enabled: false}}]},
  otherActivityId: 'none'
});
const stance = (id, name) => ({_id: id, type: 'utility', name, activation: {type: 'special', value: null}, consumption: {spellSlot: false, targets: []}, target: {prompt: false, affects: {type: 'self'}, template: {type: ''}}});
const formEffect = (id, key, mastery, name) => ({_id: id, name, transfer: false, disabled: true, flags: {[ID]: {stance: key}}, changes: [{key: 'system.traits.weaponProf.mastery.bonus', mode: 2, value: mastery, priority: 20}]});
const suggestion = 'Compendium.dnd5e.spells24.Item.phbsplSuggestion';
const calm = 'Compendium.chris-premades.CPRSpells2024.Item.f5dneWsWWR6YfbCI';
export const level7Description = '<p>七级特性。</p><p><strong>原力预知</strong>：保持清醒时获得半径十尺盲视，先攻检定加感知调整值。</p><p><strong>心灵暗示</strong>：消耗两枚原力骰，以魔法动作施展暗示术或安定心神；仅需姿势成分，感知为施法属性。</p><p><strong>第二型·马卡希</strong>：光剑额外获得侵扰精通。单手持光剑且另一手空闲时 AC +1；每回合一次，光剑命中五尺内且仅与你相邻的生物时，额外掷一枚原力骰加入武器基础伤害，无需消耗。</p><p><strong>第六型·尼曼</strong>：光剑额外获得缓速精通。在自己的回合执行攻击动作时，可以用其中一次攻击替换为原力推斥、牵引，或心灵暗示中的法术；仍消耗相应原力骰。</p>';
export const level7Activities = {
  JediSuggestCast7: cast('JediSuggestCast7', '心灵暗示·暗示术', suggestion),
  JediCalmCast0007: cast('JediCalmCast0007', '心灵暗示·安定心神', calm),
  JediNimanSug0007: cast('JediNimanSug0007', '尼曼·暗示术（替换一次攻击）', suggestion, true),
  JediNimanCal0007: cast('JediNimanCal0007', '尼曼·安定心神（替换一次攻击）', calm, true),
  JediNimanPush007: force('JediNimanPush007', '尼曼·推斥（替换一次攻击）'),
  JediNimanPull007: force('JediNimanPull007', '尼曼·牵引（替换一次攻击）'),
  JediMakashi00007: stance('JediMakashi00007', '第二型·马卡希'),
  JediNiman0000007: stance('JediNiman0000007', '第六型·尼曼')
};
export const level7FormEffects = [formEffect('JediMakashiForm7', 'II', 'vex', '剑式·第二型 马卡希'), formEffect('JediNimanForm007', 'VI', 'slow', '剑式·第六型 尼曼')];
export const level7Macros = [
  {type: 'midi-item', pass: 'preItemRoll', name: 'stance', priority: 0, macro: 'return game.modules.get("fvtt-automation-repair").api.embedded.run("itemforms1u6fzeb.midi-item.preItemRoll.stance", {workflow:typeof workflow!=="undefined"?workflow:undefined,trigger,ditem:typeof ditem!=="undefined"?ditem:undefined});'},
  {type: 'midi-item', pass: 'rollFinished', name: 'forceUse', priority: 0, macro: 'return game.modules.get("fvtt-automation-repair").api.embedded.run("itemforce04l4q07.midi-item.rollFinished.forceUse", {workflow:typeof workflow!=="undefined"?workflow:undefined,trigger,ditem:typeof ditem!=="undefined"?ditem:undefined});'}
];
