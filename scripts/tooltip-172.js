// Callers supply filtered activities and resolved resources.
export const TOOLTIP_VERSION = 2;
const UNKNOWN = '选择后确定';
const AUTOMATION = '结构化伤害未提供；伤害/效果可能由第三方自动化结算，详见说明';
const actions = { action:'动作', bonus:'附赠动作', reaction:'反应', reactiondamage:'反应（受到伤害）', reactionmanual:'反应（手动）', reactionpreattack:'反应（攻击前）', special:'特殊', minute:'分钟', hour:'小时', day:'天', legendary:'传奇', lair:'巢穴', '':'无需动作' };
const abilities = { str:'力量', dex:'敏捷', con:'体质', int:'智力', wis:'感知', cha:'魅力' };
const damageTypes = { acid:'强酸', bludgeoning:'钝击', cold:'寒冷', fire:'火焰', force:'力场', lightning:'闪电', necrotic:'死灵', piercing:'穿刺', poison:'中毒', psychic:'心灵', radiant:'光耀', slashing:'挥砍', thunder:'雷鸣', healing:'治疗', temphp:'临时生命', none:'无类型' };
const units = { ft:'尺', mi:'英里', self:'自身', touch:'触碰', any:'任意', spec:'特殊', inst:'立即', round:'轮', minute:'分钟', hour:'小时', day:'天', perm:'永久' };
const targets = {
  self:'自身', creature:'生物', ally:'盟友', enemy:'敌人', object:'物件',
  creatureOrObject:'生物或物件', creaturesOrObjects:'生物或物件', any:'任意目标',
};
const shapes = { sphere:'球形', cylinder:'柱形', cube:'立方体', cone:'锥形', line:'线形', radius:'扩散', emanation:'扩散', emanationNoTemplate:'扩散（无模板）' };
const schools = { abj:'防护', con:'咒法', div:'预言', enc:'惑控', evo:'塑能', ill:'幻术', nec:'死灵', trs:'变化' };
const words = { 'bonus action':'附赠动作', 'no type':'无类型', 'temporary hit points':'临时生命', 'emanation no template':'扩散（无模板）', 'any creatures':'任意数量生物', 'any targets':'任意目标', instantaneous:'立即', concentration:'专注', 'up to':'至多', strength:'力量', dexterity:'敏捷', constitution:'体质', intelligence:'智力', wisdom:'感知', charisma:'魅力', abjuration:'防护', conjuration:'咒法', divination:'预言', enchantment:'惑控', evocation:'塑能', illusion:'幻术', necromancy:'死灵', transmutation:'变化', ...damageTypes, action:'动作', reaction:'反应', special:'特殊', legendary:'传奇', lair:'巢穴', ...units, ...targets, creatures:'生物', objects:'物件', targets:'目标', rounds:'轮', minutes:'分钟', hours:'小时', days:'天', sphere:'球形', cylinder:'柱形', cube:'立方体', cone:'锥形', line:'线形', emanation:'扩散', reach:'触及' };
const str = v => typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
const present = v => str(v).trim() !== '';
const num = v => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Number(v) : null;
const list = v => { try { return typeof v === 'string' ? [] : Array.from(v?.contents ?? v ?? []); } catch { return []; } };
const clean = v => ['undefined','null','NaN','Infinity'].includes(str(v)) ? '' : str(v);
const translate = v => clean(v).replace(/\b(?:temporary hit points|emanation no template|any creatures|any targets|bonus action|no type|up to|[a-z]+)\b/gi, word => words[word] ?? words[word.toLowerCase()] ?? word);
const uncertain = value => /选择后确定|由公式|由职业等级|由第三方|无法确定|待确认/.test(value) || /@|\bNaN\b|\bInfinity\b/.test(value);
const entry = (key,label,value,detail='') => ({key,label,value, ...(detail ? {detail} : {}), uncertain:uncertain(value + detail)});
const pairNames = (v,map) => list(v).map(x => { const k = Array.isArray(x) ? x[0] : x; return map[str(k)] ?? str(k); }).filter(Boolean).join('/');
const period = v => ({lr:'长休',sr:'短休',day:'每日',manual:'手动恢复'})[v] ?? str(v);
const rollClass = () => globalThis.foundry?.dice?.Roll?.defaultImplementation ?? globalThis.Roll;
const mathFunctions = /\b(?:abs|ceil|floor|max|min|pow|round|sign|sqrt|trunc)(?=\s*\()/gi;
const diceTerms = /\b\d*d\d+(?:(?:k[hl]|d[hl]|r[ro]?|[xm])(?:[<>=]+)?\d+)*/gi;
const dataReference = /(?<![\w@])@[\w-]+(?:\.[\w-]+)*/g;
const targetEnum = /\bcreatures?OrObjects?\b/gi;
const inlineMarkup = /\[\[([\s\S]*?)\]\](?!\])(?:\{([^{}]*)\})?/g;
const hasMath = /@|\[\[|\b(?:ceil|floor|min|max|round|trunc|sqrt|pow|abs|sign)\s*\(/i;
const diceFlavor = /\[[^\[\]]*\]/g;

function getRollData(item) {
  try {
    return item.getRollData?.() ?? item.actor?.getRollData?.() ?? {};
  } catch {
    return {};
  }
}

function resolvedFormula(value, data) {
  const formula = str(value).trim();
  if (!formula || formula.length > 512) return '';
  try {
    const resolved = rollClass()?.replaceFormulaData(formula, data, {missing:null, warn:false}) ?? formula;
    if (resolved.length > 512 || /[^\d\s.,()+*/%^-]/.test(resolved.replace(diceFlavor, '').replace(mathFunctions, '').replace(diceTerms, ''))) return '';
    return resolved;
  } catch {
    return '';
  }
}

function formulaNumber(value, data) {
  const direct = num(value);
  if (direct !== null) return direct;
  const resolved = resolvedFormula(value, data);
  const RollClass = rollClass();
  if (!resolved || !RollClass || /[dD]\d/.test(resolved)) return null;
  try {
    const roll = new RollClass(resolved);
    // A hover never evaluates a random roll.
    return roll.isDeterministic ? num(roll.evaluateSync().total) : null;
  } catch {
    return null;
  }
}

function displayDamage(formula, data) {
  const numeric = formulaNumber(formula, data);
  const dice = resolvedFormula(formula, data).replace(diceFlavor, '').trim();
  return numeric ?? (/[dD]\d/.test(dice) && !/[()]/.test(dice) ? dice : '伤害数值待定');
}

function readableText(value, data) {
  return str(value)
    .replace(inlineMarkup, (_, formula, label) => formulaNumber(formula, data) ?? label ?? '数值待定')
    .replace(dataReference, reference => formulaNumber(reference, data) ?? '数值待定')
    .replace(targetEnum, '生物或物件');
}

function usesText(uses,data) {
  if (!present(uses?.max)) return '';
  const max = formulaNumber(uses.max,data), spent = num(uses.spent), value = num(uses.value);
  if (max === null || max < 0) return '次数上限由职业等级/公式决定（选择后确定）';
  const left = value !== null && value >= 0 ? value : spent !== null && spent >= 0 ? max - spent : null;
  return `${left === null ? UNKNOWN : Math.min(max,Math.max(0,left))}/${max}`;
}
function resourceRows(item,a,options) {
  const rows = [], consumption = a?.consumption;
  const data = options.rollData;
  const cast = num(options.castLevel), base = num(item.system?.level);
  if (item.type === 'spell') {
    if (base === 0) rows.push(entry('resource','资源','戏法（0 环）'));
    else if (consumption?.spellSlot === true) rows.push(entry('resource','资源',cast !== null && cast >= 0 ? `消耗 ${cast} 环法术位` : `基础 ${base ?? '未知'} 环；法术位由所选环位决定（选择后确定）`));
    else if (consumption?.spellSlot === false) rows.push(entry('resource','资源','不消耗法术位'));
    else rows.push(entry('resource','资源',`法术位消耗${UNKNOWN}`));
  }
  for (const t of list(consumption?.targets)) {
    if (!t) continue;
    const kind = ({itemUses:'物品次数',activityUses:'活动次数',attribute:'属性资源',material:'材料'})[t.type] ?? '资源';
    const amount = formulaNumber(t.value,data);
    rows.push(entry('resource','资源',`消耗${kind}：${amount !== null && amount >= 0 ? amount : UNKNOWN}`, t.target ? '外部来源由集成层解析，选择后确定' : ''));
  }
  for (const [u,label] of [[item.system?.uses,'物品次数'],[a?.uses,'活动次数']]) {
    if (!u || (options.overview && u === item.system?.uses)) continue;
    const text = usesText(u,data);
    if (text) rows.push(entry('resource',/[\u3400-\u9fff]/.test(str(u.label)) ? str(u.label) : label,text,list(u.recovery).map(x=>period(x?.period)).filter(Boolean).join(' / ')));
  }
  for (const r of list(options.resources)) {
    if (!r) continue;
    const text = clean(r.text) || usesText(r,data) || UNKNOWN;
    const label = str(r.label) || '资源来源';
    rows.push(entry('resource',label,text,period(r.period)));
  }
  return rows;
}
function measure(data,label,rollData) {
  if (present(data?.special)) return readableText(data.special,rollData);
  if (clean(label) && !hasMath.test(label)) return translate(label);
  if (!data) return UNKNOWN;
  const u = units[data.units] ?? str(data.units), n = formulaNumber(data.value ?? data.reach,rollData);
  if (['self','touch','any','inst','perm'].includes(data.units)) return u;
  if (n !== null && n >= 0) return `${n} ${u}`.trim();
  return UNKNOWN;
}
function templateText(t,data) {
  if (!t?.type) return '';
  const n = formulaNumber(t.size,data), unit = units[t.units] ?? str(t.units);
  const prefix = ['sphere','cylinder','radius','emanation','emanationNoTemplate'].includes(t.type) ? '半径 ' : '';
  const shape = translate(shapes[t.type] ?? t.type).trim();
  const dims = ['width','height'].flatMap(k => present(t[k]) ? [`${k==='width'?'宽':'高'} ${formulaNumber(t[k],data) ?? UNKNOWN} ${unit}`] : []);
  return `${prefix}${n !== null && n >= 0 ? n : UNKNOWN} ${unit}${shape}${dims.length ? '，'+dims.join('，') : ''}`;
}
function targetText(a,labels,plan,data) {
  const t = a?.target, area = templateText(t?.template,data), max = num(plan?.max);
  if (max !== null && Number.isInteger(max) && max > 0) {
    const quantity = plan.spell === 'scorchingRay' ? `${max} 条射线`
      : plan.spell === 'magicMissile' ? `${max} 枚飞弹` : `最多 ${max} 个目标`;
    return `${quantity}${plan.repeat ? '（可重复选择同一目标）' : '（不可重复）'}${area ? ' · '+area : ''}`;
  }
  const affects = t?.affects, count = formulaNumber(affects?.count,data);
  const type = Object.hasOwn(targets,affects?.type) ? targets[affects.type] : '目标';
  let text = area;
  if (!text && affects?.type === 'self') text = '自身';
  if (!text && count !== null && count >= 0) text = `${count} ${type || '目标'}`;
  if (!text && present(affects?.count)) text = `${type}数量${UNKNOWN}`;
  if (!text && affects?.type === 'creature') text = '任意数量生物';
  if (!text) text = translate(labels.target) || UNKNOWN;
  return [text,readableText(affects?.special,data)].filter(Boolean).join(' · ');
}
function rawDamage(p,data) {
  if (!p) return '';
  let formula = p.custom?.enabled ? str(p.custom.formula) : '';
  if (!p.custom?.enabled) {
    const n = num(p.number), d = num(p.denomination);
    if (n !== null && n >= 0 && d !== null && d > 0) formula = `${n}d${d}`;
    if (present(p.bonus)) formula += `${formula ? ' + ' : ''}${str(p.bonus)}`;
  }
  return formula ? `${displayDamage(formula,data)} ${pairNames(p.types,damageTypes)}`.trim() : UNKNOWN;
}
function hasMacros(item) {
  const m = item.flags?.['chris-premades']?.macros;
  return [m?.item,m?.midi?.item,m?.midi?.actor].some(v=> typeof v === 'string' ? !!v.trim() : v && typeof v === 'object' && Object.keys(v).length > 0);
}
function activityData(item,activity,options={}) {
  const base = activity ?? item.system ?? {}, cast = num(options.castLevel);
  const data = options.rollData ?? getRollData(item);
  const supplied = options.scaledActivity;
  const matched = cast !== null && supplied && (!supplied.id || supplied.id === activity?.id) ? supplied : null;
  const scaledItem = cast !== null ? options.scaledItem : null;
  const fromItem = activity && scaledItem ? list(scaledItem.system?.activities).find(x=>x?.id === activity.id) : null;
  const scaled = matched ?? fromItem;
  const a = scaled ?? base;
  // Item labels are aggregate for multi-activity items. Never use them there.
  const fallback = options.allowItemLabels ? (scaledItem?.labels ?? item.labels ?? {}) : {};
  const labels = scaledItem && !scaled && options.allowItemLabels ? {...(a.labels ?? {}),...fallback} : {...fallback,...(a.labels ?? {})};
  const notes = [], sections = [];
  const activation = a.activation;
  let action = clean(labels.activation) ? translate(labels.activation) : activation && typeof activation.type === 'string' ? actions[activation.type] ?? `${activation.type}（选择后确定）` : list(a.effects ?? item.effects).length ? '被动/常驻' : UNKNOWN;
  if (present(activation?.value)) {
    const n = formulaNumber(activation.value,data);
    action = `${n !== null && n >= 0 ? n : UNKNOWN} ${actions[activation.type] ?? action}`;
  }
  sections.push(entry('activation','动作消耗',action));
  const resources = resourceRows(item,a,options); sections.push(...resources);
  const long = formulaNumber(a.range?.long,data);
  const range = [measure(a.range,labels.range,data),long !== null && long > 0 ? `远距 ${long} ${units[a.range?.units] ?? str(a.range?.units)}` : ''].filter(Boolean).join(' · ');
  sections.push(entry('range','距离',range));
  const target = targetText(a,labels,options.targetPlan,data); sections.push(entry('target','目标',target));
  let damages = list(labels.damages).filter(p=>p && (present(p.formula)||present(p.label)))
    .map(p=>present(p.formula) ? `${displayDamage(p.formula,data)} ${damageTypes[p.damageType] ?? translate(p.damageType)}`.trim()
      : hasMath.test(p.label) ? '伤害数值待定' : translate(p.label));
  if (!damages.length) {
    damages = list(a.damage?.parts).map(p => rawDamage(p,data));
    if (a.healing) damages.push(rawDamage(a.healing,data));
    if (!damages.length && a.damage?.includeBase && item.system?.damage?.base) damages.push(rawDamage(item.system.damage.base,data));
  }
  if (!damages.length && (hasMacros(item) || item.flags?.['chris-premades']?.info)) damages.push(AUTOMATION);
  const save = a.save;
  let saveText = '';
  if (save || labels.save) {
    const attrs = pairNames(save?.ability,abilities);
    const dc = num(save?.dc?.value) ?? formulaNumber(save?.dc?.formula,data);
    if (dc !== null && dc >= 0) saveText = `DC ${dc} ${attrs || '豁免'}`;
    else saveText = clean(labels.save) && !hasMath.test(labels.save)
      ? translate(labels.save) : `DC ${UNKNOWN}${attrs ? ' · '+attrs : ''}`;
  }
  const onSave = damages.length && saveText ? ({half:'豁免成功伤害减半',none:'豁免成功无伤害'})[a.damage?.onSave] ?? '' : '';
  for (const text of damages) sections.push(entry('damage','伤害/治疗',text));
  if (saveText) sections.push(entry('save','豁免',saveText,onSave));
  const duration = measure(a.duration,labels.duration,data); sections.push(entry('duration','持续时间',duration));
  const concentration = a.duration?.concentration === true || list(item.system?.properties).includes('concentration');
  if (concentration) sections.push(entry('concentration','专注','需要专注'));
  const conditions = present(activation?.condition) ? [readableText(activation.condition,data)] : [];
  for (const condition of conditions) sections.push({...entry('conditions','触发条件',condition),uncertain:true});
  for (const p of list(base.damage?.parts)) {
    const s = p?.scaling;
    if (!s?.mode) continue;
    if (s.mode === 'whole' && num(s.number) !== null && num(p.denomination) > 0 && !present(s.formula)) notes.push(`升环：每环 +${num(s.number)}d${num(p.denomination)}`);
    else {
      const increase = formulaNumber(s.formula,data);
      notes.push(increase === null ? '升环效果随所选环位确定' : `升环：每环增加 ${increase}`);
    }
  }
  if (present(base.consumption?.scaling?.max) && num(base.consumption.scaling.max) === null) notes.push('升环上限由职业等级决定');
  if (cast !== null && cast >= 0) {
    if (scaled || scaledItem && options.allowItemLabels) notes.push(`按 ${cast} 环`);
    else notes.push(`已选 ${cast} 环；未提供缩放数据，当前为基础值，升环结果选择后确定`);
  }
  if (a.type === 'enchant' && !damages.length) notes.push('附魔效果详见完整说明');
  return { id:str(activity?.id)||null,name:str(activity?.name),activation:action,range,target,damage:damages.join('；'),save:saveText,duration,concentration,resource:resources.map(r=>`${r.label}：${r.value}`).join('；'),conditions,notes,sections,summary:[action,range,target,...damages,saveText,duration,concentration?'专注':''].filter(Boolean).join(' · ') };
}
export function summarizeActivity(item,activity,options={}) {
  return activityData(item ?? {},activity,options ?? {});
}

function rewriteText(html, rewrite) {
  // Parse in an inert template so the rich text does not connect to the HUD during enrichment.
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    node.data = rewrite(node.data, node.parentElement);
  }
  return template.innerHTML;
}

function prepareInlineRolls(text, data) {
  return text.replace(inlineMarkup, (original, formula, label) => {
    if (formula.trimStart().startsWith('/')) return original;
    const total = formulaNumber(formula, data);
    if (total !== null) return String(total);
    const dice = resolvedFormula(formula, data);
    // A bare dice expression is normally an immediate roll. Use a deferred native link on hover.
    if (/[dD]\d/.test(dice)) {
      const caption = label ? '{' + label + '}' : '';
      return `[[/r ${dice}]]${caption}`;
    }
    // Missing roll data must not silently turn a calculated count into a guessed number.
    if (/^[\s(]*[@\d.+-]/.test(formula) || hasMath.test(formula) && /^\s*\(?\s*\w+\s*\(/.test(formula)) return label || '数值待定';
    return original;
  });
}

const enrichedDescription = Symbol('enrichedTooltipDescription');
const enrichedActivity = Symbol('enrichedTooltipActivity');
async function enrichDescription(html, item, rollData) {
  if (!present(html)) return '';
  const TextEditor = globalThis.foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  try {
    const cleanHTML = globalThis.foundry?.utils?.cleanHTML;
    const source = rewriteText(cleanHTML ? cleanHTML(html) : html, text => prepareInlineRolls(text,rollData));
    const enriched = await TextEditor.enrichHTML(source, {secrets:false, rollData, async:true, relativeTo:item});
    // Keep native links and their metadata. Clean up visible text left by unsupported enrichers.
    return rewriteText(enriched, (text, parent) => {
      if (parent?.closest('.inline-roll,.roll-link') && hasMath.test(text)) {
        const value = formulaNumber(text, rollData);
        if (value !== null) return String(value);
        if (resolvedFormula(text,rollData)) return '掷骰';
      }
      return readableText(text,rollData);
    });
  } catch {
    return '<p class="bg3-tip-fallback">说明暂时无法展开，请打开物品卡查看。</p>';
  }
}

export async function buildTooltipModel(item,options={}) {
  item ??= {}; options ??= {};
  const acts = list(options.activities).filter(a=>a && typeof a === 'object');
  const selected = options.selectedActivityId ? acts.find(a=>a.id === options.selectedActivityId) : null;
  const mode = !acts.length ? 'passive' : selected || acts.length === 1 ? 'detail' : 'overview';
  const notes = [];
  if (options.selectedActivityId && !selected) notes.push('所选活动不可用，选择后确定');
  // Do not enumerate options: target data may be a throwing getter.
  const scaledItem = options.scaledItem;
  const rollData = getRollData(scaledItem ?? item);
  const safe = {castLevel:options.castLevel,scaledActivity:options.scaledActivity,scaledItem,rollData,resources:options.resources,targetPlan:options.targetPlan,allowItemLabels:acts.length <= 1};
  const detail = mode === 'overview' ? null : activityData(item,mode === 'detail' ? selected ?? acts[0] : null,safe);
  const overview = mode === 'overview' ? acts.map(a=>activityData(item,a,{...safe,allowItemLabels:false,scaledActivity:null,targetPlan:null,overview:true})) : [];
  const sections = detail?.sections ?? resourceRows(item,null,safe);
  if (detail) notes.push(...detail.notes);
  if (mode === 'overview') notes.push('请选择使用方式；资源消耗与升环结果选择后确定');
  if (mode === 'detail' && acts.length > 1) notes.push(`其他使用方式：${acts.length-1} 种`);
  const name = str(item.name), shortName = str(options.shortName)||str(item.__shortName)||name;
  const level = num(item.system?.level);
  const displayLevel = num(options.castLevel) ?? level;
  const typeLabel = item.type === 'spell' ? displayLevel === 0 ? '戏法' : displayLevel !== null && displayLevel >= 0 ? `${displayLevel} 环法术` : '法术（环位选择后确定）' : ({feat:'特性',weapon:'武器',equipment:'装备',consumable:'消耗品',tool:'工具'})[item.type] ?? '物品';
  const subtitle = [typeLabel,schools[item.system?.school] ?? translate(item.labels?.school)].filter(Boolean).join(' · ');
  const overviewConcentration = mode === 'overview' && list(item.system?.properties).includes('concentration');
  const activity = selected ?? (acts.length === 1 ? acts[0] : null);
  const activityDescription = options.scaledActivity?.description ?? activity?.description;
  const [descriptionHTML, activityHTML] = await Promise.all([
    enrichDescription(item.system?.description?.value ?? '',item,rollData),
    enrichDescription(activityDescription?.value ?? activityDescription,item,rollData),
  ]);
  return {
    name,shortName,originalName:name === shortName ? '' : name,icon:str(item.img),typeLabel,subtitle,mode,overviewConcentration,sections,
    activity:mode==='detail'?detail:null,overview,notes,rollData,footer:[{label:'打开物品卡',hint:'查看完整说明'}],
    [enrichedDescription]:descriptionHTML,
    [enrichedActivity]:activityHTML,
  };
}
const escapeHTML = v => str(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const primaryStats = ['activation','range','target'];
function renderRows(rows, text) {
  const summary = primaryStats.map(key => rows.find(row => row.key === key)).filter(Boolean);
  const details = rows.filter(row => !primaryStats.includes(row.key));
  return `
    ${summary.length ? `<div class="bg3-tip-summary" tabindex="0" aria-label="动作、距离与目标">
      ${summary.map(row => `<span title="${text(row.label)}：${text(row.value)}">${text(row.value)}</span>`).join('')}
    </div>` : ''}
    ${details.length ? `<dl class="bg3-tip-details">
      ${details.map(row => `<div class="bg3-tip-fact${row.uncertain ? ' is-conditional' : ''}">
        <dt>${text(row.label)}</dt><dd>${text(row.value)}${row.detail ? ` <small>${text(row.detail)}</small>` : ''}</dd>
      </div>`).join('')}
    </dl>` : ''}
  `;
}
export function renderTooltipHTML(model={}) {
  const m = model ?? {}, mode = ['detail','overview','passive'].includes(m.mode)?m.mode:'passive';
  const text = value => escapeHTML(readableText(value,m.rollData ?? {}));
  const notesHTML = notes => list(notes).map(n=>`<p${uncertain(str(n))?' class="is-conditional"':''}>${text(n)}</p>`).join('');
  const overview = mode === 'overview' ? `<section class="bg3-tip-overview" aria-label="使用方式">
    ${list(m.overview).map(a=>`<article class="bg3-tip-overview-row">
      <strong>${text(a.name)}</strong>${renderRows(list(a.sections),text)}${notesHTML(a.notes)}
    </article>`).join('')}
  </section>` : '';
  const activityName = m.activity?.name;
  const distinctName = activityName && activityName !== m.name && activityName !== m.shortName;
  const activity = mode === 'detail' && (distinctName || m[enrichedActivity]) ? `<section class="bg3-tip-activity">
    ${distinctName ? `<strong>${text(activityName)}</strong>` : ''}
    ${m[enrichedActivity] ?? ''}
  </section>` : '';
  return `<div class="bg3-tip" data-mode="${mode}">
    <header class="bg3-tip-head">
      <img class="bg3-tip-icon" src="${escapeHTML(m.icon || 'icons/svg/item-bag.svg')}" width="32" height="32" alt="">
      <div class="bg3-tip-heading">
        <strong class="bg3-tip-name" title="${text(m.originalName || m.name)}">${text(m.shortName || m.name)}</strong>
        <small class="bg3-tip-sub">${text(m.subtitle)}${m.overviewConcentration ? ' · 专注' : ''}</small>
      </div>
    </header>
    ${renderRows(list(m.sections),text)}${overview}${activity}
    ${m.notes?.length ? `<div class="bg3-tip-notes">${notesHTML(m.notes)}</div>` : ''}
    ${m[enrichedDescription] ? `<section class="bg3-tip-desc" tabindex="0" aria-label="完整说明">${m[enrichedDescription]}</section>` : ''}
    <footer class="bg3-tip-foot">${list(m.footer).map(f=>`<button type="button" data-tip-sheet title="${text(f.hint)}">${text(f.label)}</button>`).join('')}</footer>
  </div>`;
}
