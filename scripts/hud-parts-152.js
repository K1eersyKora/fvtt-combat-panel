/* Pure data and markup helpers for the BG3 HUD. */
const list = value => Array.from(value?.contents ?? value ?? []);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const classLevel = item => item.system?.levels ?? item.system?.level ?? 1;
const roman = level => ['0','Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ','Ⅶ','Ⅷ','Ⅸ'][level] ?? String(level);

export function classInfo(actor, overrideImage) {
  const item = list(actor?.items).filter(item => item.type === 'class')
    .sort((a, b) => classLevel(b) - classLevel(a) || String(a.name ?? '').localeCompare(String(b.name ?? '')))[0];
  if (!item) return null;
  const override = typeof overrideImage === 'string' && overrideImage.length > 0;
  return {id:item.id,name:item.name,level:classLevel(item),img:override ? overrideImage : item.img || 'icons/svg/mystery-man.svg',override};
}

export function equippedWeaponIds(actor, limit = 2) {
  return list(actor?.items).filter(item => item.type === 'weapon' && item.system?.equipped === true)
    .slice(0, Math.max(0, limit)).map(item => item.id);
}

export function weaponSlots(actor, savedIds) {
  const auto = !Array.isArray(savedIds);
  const weapons = list(actor?.items).filter(item => item.type === 'weapon');
  const source = auto ? equippedWeaponIds(actor, 2) : savedIds;
  const items = [0, 1].map((index) => {
    const id = source?.[index] ?? null;
    return (id && weapons.find((item) => item.id === id)) || null;
  });
  return {ids:items.map(item => item?.id ?? null),items,auto};
}

export function normalAttackActivity(activities) {
  const attacks = list(activities).filter(activity => activity.type === 'attack');
  return attacks.find(activity => activity.activation?.type === 'action') ?? attacks[0] ?? null;
}

export function otherAttackActivities(activities, primary) {
  return list(activities).filter(activity => activity !== primary);
}

export function shapeGrid(max, value) {
  if (max <= 0) return {cols:1,rows:0,cells:[]};
  const cols = max <= 1 ? 1 : max <= 6 ? 2 : 3;
  return {cols,rows:Math.ceil(max / cols),cells:Array.from({length:max}, (_, i) => ({filled:i < value}))};
}

export function spellShapeHTML(max, value, kind = 'normal') {
  const grid = kind === 'cantrip' ? {cols:1,cells:[{filled:false}]} : shapeGrid(max, value);
  return `<span class="bg3-shape bg3-shape-${esc(kind)}" style="--shape-cols:${grid.cols}" aria-hidden="true">${grid.cells.map(cell => cell.filled ? '<i class="filled"></i>' : '<i></i>').join('')}</span>`;
}

export function topbarHTML(opts) {
  const {resource, concentration, filterActivation, filterLevel, busy, slots} = opts;
  const disabled = busy ? ' disabled' : '';
  const resources = [['action','动作'],['bonus','附赠动作'],['reaction','反应']].map(([kind, label]) => {
    const used = resource?.[kind]?.used;
    const title = `${label} · ${used ? '已使用' : '可用'} · 点击筛选`;
    const icon = kind === 'reaction' ? '<i class="reaction-star"></i>' : `<i class="${kind}-dot"></i>`;
    const active = filterActivation === kind;
    return `<button type="button" class="bg3-res bg3-res-${kind}${used ? ' spent' : ''}${active ? ' active' : ''}" data-hud-filter-act="${kind}" title="${esc(title)}" aria-label="${esc(label)}" aria-pressed="${active ? 'true' : 'false'}"${disabled}><span class="bg3-res-icon">${icon}</span></button>`;
  }).join('');
  const spells = list(slots).map(slot => {
    const {kind, level, label, max, value, count} = slot;
    const active = filterLevel === (kind === 'cantrip' ? 0 : level) ? ' active' : '';
    if (kind === 'pact') {
      return `<button type="button" class="bg3-spell-level bg3-level-pact" data-hud-filter-pact="1" title="${esc(`契约法术位 ${value}/${max} · ${level} 环`)}" aria-label="${esc(`契约法术位 ${level} 环`)}"${disabled}>${spellShapeHTML(max, value, 'pact')}</button>`;
    }
    if (kind === 'cantrip') {
      return `<button type="button" class="bg3-spell-level bg3-level-cantrip${active}" data-hud-filter="0" title="${esc(`戏法 · 不消耗法术位 · 已加入 ${count} 个；点击筛选`)}" aria-label="戏法"${disabled}>${spellShapeHTML(max, value, 'cantrip')}</button>`;
    }
    return `<button type="button" class="bg3-spell-level${active}" data-hud-filter="${esc(level)}" title="${esc(`${label} 环 · 剩余 ${value}/${max} · 已加入 ${count} 个法术；点击筛选`)}" aria-label="${esc(`${label} 环法术`)}"${disabled}><b class="bg3-lvl">${esc(roman(level))}</b>${spellShapeHTML(max, value)}</button>`;
  }).join('');
  return `<div class="bg3-topbar" role="toolbar" aria-label="动作资源与法术位"><div class="bg3-res-group" role="group" aria-label="动作资源">${resources}${concentration ? '<span class="bg3-concentration" title="专注中">◉</span>' : ''}</div><div class="bg3-spell-box" role="group" aria-label="法术位"><div class="bg3-spell-group">${spells}</div></div></div>`;
}

/* ---- 0.7.0: 名称缩写、分类导航、整行滚动控件 ---- */

const LEADING_CJK = /^[\s·・\-—–:：,，/|【\[（(「『《〈]*([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff][\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff0-9０-９·・、，：:（）()「」『』《》〈〉\-—–~～！？!?…]*)/;
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff][\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff0-9０-９·・、，：:（）()「」『』《》〈〉\-—–~～！？!?…]*/g;
const LEAD_SEP = /^[\s·・\-—–:：,，/|【\[（(「『《〈】\]）)」』》〉]+/;
const TAIL_SEP = /[\s·・\-—–:：,，/|]+$/;

function trimName(value) {
  let text = String(value ?? '').replace(LEAD_SEP, '').replace(TAIL_SEP, '');
  const opens = (text.match(/[（(【\[「『《〈]/g) || []).length;
  const closes = (text.match(/[）)】\]」』》〉]/g) || []).length;
  if (closes > opens) text = text.replace(/[）)】\]」』》〉]+$/, '').replace(TAIL_SEP, '');
  return text;
}

/**
 * Split a bilingual item name into a short CJK display name plus the remaining original text.
 * Never invents a translation: when no reliable CJK run exists the original name is returned.
 */
export function nameParts(value) {
  const original = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!original) return {short: '', original: '', alt: '', bilingual: false};
  const leading = original.match(LEADING_CJK);
  let short = leading ? trimName(leading[1]) : '';
  if (!short) {
    const runs = [...original.matchAll(CJK_RUN)];
    if (runs.length) {
      const run = runs[0];
      const before = original.slice(0, run.index).trim();
      // 只在中文段前是分隔符/括号时采用，避免把 "JEDI-剑士3" 之类的整名误拆
      if (!before || /[\s·・\-—–:：,，/|【\[（(「『《〈]$/.test(before)) short = trimName(run[0]);
    }
  }
  if (!short) return {short: original, original, alt: '', bilingual: false};
  let alt = original;
  if (alt.startsWith(short)) alt = alt.slice(short.length);
  else alt = alt.replace(short, '');
  alt = trimName(alt);
  return {short, original, alt, bilingual: alt.length > 0};
}

export function shortName(value) { return nameParts(value).short; }

export function resourceChipHTML(item, badges) {
  const {primary, extra, title} = badges ?? {};
  if (!primary && extra == null) return '';
  return `<span class="bg3-skill-uses-wrap">${primary ? `<span class="bg3-skill-uses" title="${esc(title || '')}" aria-label="${esc(title || '')}">${esc(primary)}</span>` : ''}${extra != null ? `<span class="bg3-skill-uses bg3-skill-uses-extra" title="${esc(title || '')}">${esc(extra)}</span>` : ''}</span>`;
}

export function pagerHTML(pager) {
  if (!pager?.hasOverflow) return '';
  const {group, label, row, maxScrollRow, maxRow = maxScrollRow, remaining} = pager;
  const lastRow = Number.isFinite(Number(maxRow)) ? Number(maxRow) : 0;
  return `<span class="bg3-pager" data-hud-pager="${esc(group)}" data-state="${row <= 0 ? 'top' : 'more'}">
    <span class="bg3-pager-name">${esc(label)}</span>
    <button type="button" class="bg3-pager-prev" data-hud-page="${esc(group)}|-1" title="向上滚动一行" aria-label="${esc(label)}向上滚动一行" ${row <= 0 ? 'disabled' : ''}>‹</button>
    <b class="bg3-pager-label" aria-live="polite">${row + 1}/${lastRow + 1}</b>
    <button type="button" class="bg3-pager-next" data-hud-page="${esc(group)}|1" title="向下滚动一行" aria-label="${esc(label)}向下滚动一行" ${row >= lastRow ? 'disabled' : ''}>›</button>
    ${remaining > 0 ? `<small class="bg3-pager-more">还有 ${remaining} 项</small>` : ''}
  </span>`;
}

/**
 * 0.8.0: the transparent 全部/常用/动作/附赠/反应 strip is gone.
 * Only the overflow pager remains; activation filtering uses the topbar icons.
 */
export function navHTML({pagers = []} = {}) {
  if (!pagers.length) return '';
  const pagerMarkup = pagers.map(pagerHTML).join('');
  return `<div class="bg3-nav-pagers" role="group" aria-label="技能栏滚动">${pagerMarkup}</div>`;
}

export function emptyHTML({filtered = false} = {}) {
  if (!filtered) return '<p class="bg3-empty">暂无栏位</p>';
  return `<p class="bg3-empty"><span>没有符合筛选的内容</span><button type="button" class="bg3-clear-filter" data-hud-clear-filter>清除筛选</button></p>`;
}
