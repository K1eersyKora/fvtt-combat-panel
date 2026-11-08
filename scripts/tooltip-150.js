// Pure presentation: callers supply filtered activities and resolved resources.
export const TOOLTIP_VERSION = 1;
const UNKNOWN = '选择后确定';
const AUTOMATION = '结构化伤害未提供；伤害/效果可能由第三方自动化结算，详见说明';
const actions = { action:'动作', bonus:'附赠动作', reaction:'反应', reactiondamage:'反应（受到伤害）', reactionmanual:'反应（手动）', reactionpreattack:'反应（攻击前）', special:'特殊', minute:'分钟', hour:'小时', day:'天', legendary:'传奇', lair:'巢穴', '':'无需动作' };
const abilities = { str:'力量', dex:'敏捷', con:'体质', int:'智力', wis:'感知', cha:'魅力' };
const damageTypes = { acid:'强酸', bludgeoning:'钝击', cold:'寒冷', fire:'火焰', force:'力场', lightning:'闪电', necrotic:'死灵', piercing:'穿刺', poison:'中毒', psychic:'心灵', radiant:'光耀', slashing:'挥砍', thunder:'雷鸣', healing:'治疗', temphp:'临时生命', none:'无类型' };
const units = { ft:'尺', mi:'英里', self:'自身', touch:'触碰', any:'任意', spec:'特殊', inst:'立即', round:'轮', minute:'分钟', hour:'小时', day:'天', perm:'永久' };
const targets = { self:'自身', creature:'生物', ally:'盟友', enemy:'敌人', object:'物件', any:'任意' };
const shapes = { sphere:'球形', cylinder:'柱形', cube:'立方体', cone:'锥形', line:'线形', radius:'扩散', emanation:'扩散', emanationNoTemplate:'扩散（无模板）' };
const schools = { abj:'防护', con:'咒法', div:'预言', enc:'惑控', evo:'塑能', ill:'幻术', nec:'死灵', trs:'变化' };
const words = { 'bonus action':'附赠动作', 'no type':'无类型', 'temporary hit points':'临时生命', 'emanation no template':'扩散（无模板）', 'any creatures':'任意数量生物', 'any targets':'任意目标', instantaneous:'立即', concentration:'专注', 'up to':'至多', strength:'力量', dexterity:'敏捷', constitution:'体质', intelligence:'智力', wisdom:'感知', charisma:'魅力', abjuration:'防护', conjuration:'咒法', divination:'预言', enchantment:'惑控', evocation:'塑能', illusion:'幻术', necromancy:'死灵', transmutation:'变化', ...damageTypes, action:'动作', reaction:'反应', special:'特殊', legendary:'传奇', lair:'巢穴', ...units, ...targets, creatures:'生物', objects:'物件', targets:'目标', rounds:'轮', minutes:'分钟', hours:'小时', days:'天', sphere:'球形', cylinder:'柱形', cube:'立方体', cone:'锥形', line:'线形', emanation:'扩散', reach:'触及' };
const str = v => typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
const present = v => str(v).trim() !== '';
const num = v => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Number(v) : null;
const list = v => { try { return typeof v === 'string' ? [] : Array.from(v?.contents ?? v ?? []); } catch { return []; } };
const clean = v => ['undefined','null','NaN','Infinity'].includes(str(v)) ? '' : str(v);
const translate = v => clean(v).replace(/\b(?:temporary hit points|emanation no template|any creatures|any targets|bonus action|no type|up to|[a-z]+)\b/gi, word => words[word.toLowerCase()] ?? word);
const uncertain = value => /选择后确定|由公式|由职业等级|由第三方|无法确定|待确认/.test(value) || /@|\bNaN\b|\bInfinity\b/.test(value);
const entry = (key,label,value,detail='') => ({key,label,value, ...(detail ? {detail} : {}), uncertain:uncertain(value + detail)});
const pairNames = (v,map) => list(v).map(x => { const k = Array.isArray(x) ? x[0] : x; return map[str(k)] ?? str(k); }).filter(Boolean).join('/');
const period = v => ({lr:'长休',sr:'短休',day:'每日',manual:'手动恢复'})[v] ?? str(v);
function usesText(uses) {
  if (!present(uses?.max)) return '';
  const max = num(uses.max), spent = num(uses.spent), value = num(uses.value);
  if (max === null || max < 0) return '次数上限由职业等级/公式决定（选择后确定）';
  const left = value !== null && value >= 0 ? value : spent !== null && spent >= 0 ? max - spent : null;
  return `${left === null ? UNKNOWN : Math.min(max,Math.max(0,left))}/${max}`;
}
function resourceRows(item,a,options) {
  const rows = [], consumption = a?.consumption;
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
    const amount = num(t.value);
    rows.push(entry('resource','资源',`消耗${kind}：${amount !== null && amount >= 0 ? amount : `由公式计算（${UNKNOWN}）${present(t.value) ? '：'+str(t.value) : ''}`}`, t.target ? '外部来源由集成层解析，选择后确定' : ''));
  }
  for (const [u,label] of [[item.system?.uses,'物品次数'],[a?.uses,'活动次数']]) {
    if (!u || (options.overview && u === item.system?.uses)) continue;
    const text = usesText(u);
    if (text) rows.push(entry('resource',/[\u3400-\u9fff]/.test(str(u.label)) ? str(u.label) : label,text,list(u.recovery).map(x=>period(x?.period)).filter(Boolean).join(' / ')));
  }
  for (const r of list(options.resources)) {
    if (!r) continue;
    const text = clean(r.text) || usesText(r) || UNKNOWN;
    rows.push(entry('resource',str(r.label)||'资源来源',text,[period(r.period), /free|item/.test(str(r.kind)) ? '免费来源；是否使用在选择后确定' : ''].filter(Boolean).join(' · ')));
  }
  return rows;
}
function measure(data,label) {
  if (present(data?.special)) return str(data.special);
  if (clean(label)) return translate(label);
  if (!data) return UNKNOWN;
  const u = units[data.units] ?? str(data.units), n = num(data.value ?? data.reach);
  if (['self','touch','any','inst','perm'].includes(data.units)) return u;
  if (n !== null && n >= 0) return `${n} ${u}`.trim();
  return present(data.value) ? `${str(data.value)} ${u}（由公式计算）` : UNKNOWN;
}
function templateText(t) {
  if (!t?.type) return '';
  const n = num(t.size), unit = units[t.units] ?? str(t.units);
  const prefix = ['sphere','cylinder','radius','emanation','emanationNoTemplate'].includes(t.type) ? '半径 ' : '';
  const shape = translate(shapes[t.type] ?? t.type).trim();
  const dims = ['width','height'].flatMap(k => present(t[k]) ? [`${k==='width'?'宽':'高'} ${num(t[k]) ?? `${str(t[k])}（由公式计算）`} ${unit}`] : []);
  return `${prefix}${n !== null && n >= 0 ? n : UNKNOWN} ${unit}${shape}${dims.length ? '，'+dims.join('，') : ''}`;
}
function targetText(a,labels,plan) {
  const t = a?.target, area = templateText(t?.template), max = num(plan?.max);
  if (max !== null && Number.isInteger(max) && max > 0) return `最多 ${max} 个目标${plan.repeat ? '（可重复选择同一目标）' : '（不可重复）'}${area ? ' · '+area : ''}`;
  const affects = t?.affects, count = num(affects?.count), type = targets[affects?.type] ?? str(affects?.type);
  let text = area;
  if (!text && affects?.type === 'self') text = '自身';
  if (!text && count !== null && count >= 0) text = `${count} ${type || '目标'}`;
  if (!text && present(affects?.count)) text = `${str(affects.count)} ${type}（由公式计算）`;
  if (!text && affects?.type === 'creature') text = '任意数量生物';
  if (!text) text = translate(labels.target) || UNKNOWN;
  return [text,str(affects?.special)].filter(Boolean).join(' · ');
}
function rawDamage(p) {
  if (!p) return '';
  let formula = p.custom?.enabled ? str(p.custom.formula) : '';
  if (!p.custom?.enabled) {
    const n = num(p.number), d = num(p.denomination);
    if (n !== null && n >= 0 && d !== null && d > 0) formula = `${n}d${d}`;
    if (present(p.bonus)) formula += `${formula ? ' + ' : ''}${str(p.bonus)}`;
  }
  return formula ? `${formula} ${pairNames(p.types,damageTypes)}${/@|[a-ce-z_]/i.test(formula.replace(/\d*d\d+/gi,'')) ? '（由公式计算）' : ''}`.trim() : UNKNOWN;
}
function hasMacros(item) {
  const m = item.flags?.['chris-premades']?.macros;
  return [m?.item,m?.midi?.item,m?.midi?.actor].some(v=> typeof v === 'string' ? !!v.trim() : v && typeof v === 'object' && Object.keys(v).length > 0);
}
function activityData(item,activity,options={}) {
  const base = activity ?? item.system ?? {}, cast = num(options.castLevel);
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
    const n = num(activation.value);
    action = `${n !== null && n >= 0 ? n : `${str(activation.value)}（由公式计算）`} ${actions[activation.type] ?? action}`;
  }
  sections.push(entry('activation','动作消耗',action));
  const resources = resourceRows(item,a,options); sections.push(...resources);
  const area = templateText(a.target?.template);
  const long = num(a.range?.long);
  const range = [measure(a.range,labels.range),long !== null && long > 0 ? `远距 ${long} ${units[a.range?.units] ?? str(a.range?.units)}` : '',area].filter(Boolean).join(' · ');
  sections.push(entry('range','距离',range));
  const target = targetText(a,labels,options.targetPlan); sections.push(entry('target','目标',target));
  let damages = list(labels.damages).filter(p=>p && (present(p.formula)||present(p.label))).map(p=>present(p.formula) ? `${str(p.formula)} ${damageTypes[p.damageType] ?? translate(p.damageType)}`.trim() : translate(p.label));
  damages = damages.map(text=>/@|\b(?:ceil|floor|min|max)\s*\(/i.test(text) ? `${text}（由公式计算）` : text);
  if (!damages.length) {
    damages = list(a.damage?.parts).map(rawDamage);
    if (a.healing) damages.push(rawDamage(a.healing));
    if (!damages.length && a.damage?.includeBase && item.system?.damage?.base) damages.push(rawDamage(item.system.damage.base));
  }
  if (!damages.length && (hasMacros(item) || item.flags?.['chris-premades']?.info)) damages.push(AUTOMATION);
  const save = a.save;
  let saveText = '';
  if (save || labels.save) {
    const attrs = pairNames(save?.ability,abilities), dc = num(save?.dc?.value);
    if (save && (present(save.dc?.formula) || dc === null || dc < 0)) saveText = `DC 由公式/施法者属性决定（选择后确定）${attrs ? ' · '+attrs : ''}`;
    else saveText = attrs.includes('/') ? `DC ${dc} ${attrs}` : translate(labels.save) || `DC ${dc} ${attrs || UNKNOWN}`;
  }
  const onSave = damages.length && saveText ? ({half:'豁免成功伤害减半',none:'豁免成功无伤害'})[a.damage?.onSave] ?? '' : '';
  for (const text of damages) sections.push(entry('damage','伤害/治疗',text));
  if (saveText) sections.push(entry('save','豁免',saveText,onSave));
  const duration = measure(a.duration,labels.duration); sections.push(entry('duration','持续时间',duration));
  const concentration = a.duration?.concentration === true || list(item.system?.properties).includes('concentration');
  if (concentration) sections.push(entry('concentration','专注','需要专注'));
  const conditions = present(activation?.condition) ? [str(activation.condition)] : [];
  for (const condition of conditions) sections.push({...entry('conditions','触发条件',condition),uncertain:true});
  for (const p of list(base.damage?.parts)) {
    const s = p?.scaling;
    if (!s?.mode) continue;
    if (s.mode === 'whole' && num(s.number) !== null && num(p.denomination) > 0 && !present(s.formula)) notes.push(`升环：每环 +${num(s.number)}d${num(p.denomination)}`);
    else notes.push(`升环：由公式计算（${str(s.formula)||str(s.mode)}；选择后确定）`);
  }
  if (present(base.consumption?.scaling?.max) && num(base.consumption.scaling.max) === null) notes.push('升环上限由职业等级决定');
  if (cast !== null && cast >= 0) {
    if (scaled || scaledItem && options.allowItemLabels) notes.push(`按 ${cast} 环`);
    else notes.push(`已选 ${cast} 环；未提供缩放数据，当前为基础值，升环结果选择后确定`);
  }
  if (a.type === 'enchant' && !damages.length) notes.push('附魔效果详见完整说明');
  return { id:str(activity?.id)||null,name:str(activity?.name),activation:action,range,target,damage:damages.join('；'),save:saveText,duration,concentration,resource:resources.map(r=>`${r.label}：${r.value}`).join('；'),conditions,notes,sections,description:str(a.description?.value ?? a.description),summary:[action,range,target,...damages,saveText,duration,concentration?'专注':''].filter(Boolean).join(' · ') };
}
export function summarizeActivity(item,activity,options={}) {
  return activityData(item ?? {},activity,options ?? {});
}
export function buildTooltipModel(item,options={}) {
  item ??= {}; options ??= {};
  const acts = list(options.activities).filter(a=>a && typeof a === 'object');
  const selected = options.selectedActivityId ? acts.find(a=>a.id === options.selectedActivityId) : null;
  const mode = !acts.length ? 'passive' : selected || acts.length === 1 ? 'detail' : 'overview';
  const notes = [];
  if (options.selectedActivityId && !selected) notes.push('所选活动不可用，选择后确定');
  // Do not enumerate options: target data may be a throwing getter.
  const safe = {castLevel:options.castLevel,scaledActivity:options.scaledActivity,scaledItem:options.scaledItem,resources:options.resources,targetPlan:options.targetPlan,allowItemLabels:acts.length <= 1};
  const detail = mode === 'overview' ? null : activityData(item,mode === 'detail' ? selected ?? acts[0] : null,safe);
  const overview = mode === 'overview' ? acts.map(a=>activityData(item,a,{...safe,allowItemLabels:false,scaledActivity:null,targetPlan:null,overview:true})) : [];
  const sections = detail?.sections ?? resourceRows(item,null,{resources:options.resources});
  if (detail) notes.push(...detail.notes);
  if (mode === 'overview') notes.push('请选择使用方式；资源消耗与升环结果选择后确定');
  if (mode === 'detail' && acts.length > 1) notes.push(`其他使用方式：${acts.length-1} 种`);
  const name = str(item.name), shortName = str(options.shortName)||str(item.__shortName)||name;
  const level = num(item.system?.level);
  const typeLabel = item.type === 'spell' ? level === 0 ? '戏法' : level !== null && level >= 0 ? `${level} 环法术` : '法术（环位选择后确定）' : ({feat:'特性',weapon:'武器',equipment:'装备',consumable:'消耗品',tool:'工具'})[item.type] ?? '物品';
  const subtitle = [typeLabel,schools[item.system?.school] ?? translate(item.labels?.school)].filter(Boolean).join(' · ');
  const chips = [];
  if (detail) chips.push({key:'activation',label:detail.activation,tone:uncertain(detail.activation)?'warning': /^reaction/.test(str((selected ?? acts[0])?.activation?.type))?'reaction':(selected ?? acts[0])?.activation?.type==='bonus'?'bonus':'action'});
  if (detail?.concentration || mode==='overview' && list(item.system?.properties).includes('concentration')) chips.push({key:'concentration',label:'专注',tone:'concentration'});
  const html = str(item.system?.description?.value);
  return {name,shortName,originalName:name,typeLabel,subtitle,mode,chips,sections,activity:mode==='detail'?detail:null,overview,description:{html,textLength:html.replace(/<[^>]*>/g,'').length},notes,footer:[{label:'打开物品卡',hint:'查看完整说明'}]};
}
const escapeHTML = v => str(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function renderRows(rows) {
  return `<dl class="bg3-tip-grid">${list(rows).map(r=>`<div class="bg3-tip-row${r.uncertain?' is-conditional':''}"><dt>${escapeHTML(r.label)}</dt><dd>${escapeHTML(r.value)}${r.detail?`<small>${escapeHTML(r.detail)}</small>`:''}</dd></div>`).join('')}</dl>`;
}
export function renderTooltipHTML(model={}) {
  const m = model ?? {}, mode = ['detail','overview','passive'].includes(m.mode)?m.mode:'passive';
  const notesHTML = notes => list(notes).map(n=>`<p${uncertain(str(n))?' class="is-conditional"':''}>${escapeHTML(n)}</p>`).join('');
  return `<div class="bg3-tip" data-mode="${mode}"><header class="bg3-tip-head"><strong class="bg3-tip-name">${escapeHTML(m.shortName||m.name)}</strong><span class="bg3-tip-orig">${escapeHTML(m.originalName)}</span><small class="bg3-tip-sub">${escapeHTML(m.subtitle)}</small></header><div class="bg3-tip-chips">${list(m.chips).map(c=>`<span class="bg3-tip-chip" data-tone="${escapeHTML(c.tone)}">${escapeHTML(c.label)}</span>`).join('')}</div>${renderRows(m.sections)}${mode==='overview'?`<section class="bg3-tip-overview" aria-label="使用方式">${list(m.overview).map(a=>`<article class="bg3-tip-overview-row"><strong>${escapeHTML(a.name)}</strong>${renderRows(a.sections)}${notesHTML(a.notes)}</article>`).join('')}</section>`:''}${mode==='detail'&&m.activity?`<section class="bg3-tip-activity"><strong>${escapeHTML(m.activity.name)}</strong>${m.activity.description?`<p>${escapeHTML(m.activity.description)}</p>`:''}</section>`:''}<div class="bg3-tip-notes">${notesHTML(m.notes)}</div><section class="bg3-tip-desc" tabindex="0" aria-label="完整说明">${str(m.description?.html)}</section><footer class="bg3-tip-foot"><span>滚动查看完整说明</span>${list(m.footer).map(f=>`<button type="button" data-tip-sheet title="${escapeHTML(f.hint)}">${escapeHTML(f.label)}</button>`).join('')}</footer></div>`;
}
