export const ROW_HEIGHT = 57;
export const ROW_GAP = 5;
export const GRID_PAD = 2;
export const MIN_ROWS = 1;
export const MAX_ROWS = 6;

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const count = value => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(finite(value, 0))));
const visible = value => Math.min(MAX_ROWS, Math.max(MIN_ROWS, count(value)));
const columnsOf = value => Math.max(1, count(value));
const heightOf = value => Math.max(1, finite(value, ROW_HEIGHT));
const gapOf = value => Math.max(0, finite(value, ROW_GAP));
const bounded = value => Math.min(Number.MAX_VALUE, value);

export function autoRows(viewportHeight) {
  const height = finite(viewportHeight, 0);
  return height >= 1100 ? 4 : height >= 720 ? 3 : 2;
}

export function hudRows(viewportHeight) { return visible(autoRows(viewportHeight)); }

// Rows that still fit: 150px keeps room for the bottom offset, the resource cap and the pager.
export function maxRowsFor(viewportHeight, rowHeight = ROW_HEIGHT, rowGap = ROW_GAP) {
  const stride = Math.max(24, heightOf(rowHeight) + gapOf(rowGap));
  return Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor((finite(viewportHeight, 900) - 150) / stride)));
}

// A saved row count wins over the viewport default but never exceeds what fits.
export function normalizeRows(saved, viewportHeight, rowHeight = ROW_HEIGHT, rowGap = ROW_GAP) {
  const limit = maxRowsFor(viewportHeight, rowHeight, rowGap);
  const wanted = Number.isFinite(Number(saved)) && Number(saved) > 0 ? Math.round(Number(saved)) : autoRows(viewportHeight);
  return Math.min(limit, Math.max(MIN_ROWS, wanted));
}

export function deckHeight(rows, rowHeight = ROW_HEIGHT, rowGap = ROW_GAP, pad = GRID_PAD) {
  const n = visible(rows);
  return bounded(n * heightOf(rowHeight) + (n - 1) * gapOf(rowGap) + 2 * Math.max(0, finite(pad, GRID_PAD)));
}

export function rowStride(rowHeight = ROW_HEIGHT, rowGap = ROW_GAP) {
  return bounded(heightOf(rowHeight) + gapOf(rowGap));
}

// Split only outside functions/line names; computed styles normally contain px tracks.
function tracks(text, depth = 0) {
  if (depth > 16) return 0;
  const tokens = [];
  let token = '', parens = 0, brackets = 0;
  for (const char of text.trim()) {
    if (char === '[') { brackets++; continue; }
    if (char === ']') { if (!brackets) return 0; brackets--; continue; }
    if (brackets) continue;
    if (char === '(') parens++;
    if (char === ')' && --parens < 0) return 0;
    if (/\s/.test(char) && parens === 0) {
      if (token) tokens.push(token);
      token = '';
    } else token += char;
  }
  if (parens || brackets) return 0;
  if (token) tokens.push(token);
  let result = 0;
  for (const part of tokens) {
    const repeat = /^repeat\(\s*(\d+)\s*,([\s\S]+)\)$/i.exec(part);
    if (repeat) {
      const n = Number(repeat[1]), inner = tracks(repeat[2], depth + 1);
      if (!Number.isSafeInteger(n) || n < 1 || !inner) return 0;
      result += n * inner;
    } else if (/^(?:\d*\.?\d+(?:px|fr|em|rem|%|vw|vh|ch)|0|auto|min-content|max-content)$/i.test(part)
      || /^(?:minmax|calc|min|max|clamp|fit-content)\(.+\)$/i.test(part)) result++;
    else return 0;
    if (!Number.isSafeInteger(result)) return 0;
  }
  return result;
}

export function columnCount(templateColumns) {
  return typeof templateColumns === 'string' ? tracks(templateColumns) || 1 : 1;
}

export function totalRows(itemCount, columns) {
  return Math.ceil(count(itemCount) / columnsOf(columns));
}

export function maxScrollRow(totalRows, visibleRows) {
  return Math.max(0, count(totalRows) - visible(visibleRows));
}

export function clampRow(row, totalRows, visibleRows) {
  return Math.min(count(row), maxScrollRow(totalRows, visibleRows));
}

export function rowForScroll(scrollTop, rowHeight = ROW_HEIGHT, rowGap = ROW_GAP) {
  return count(Math.round(Math.max(0, finite(scrollTop, 0)) / rowStride(rowHeight, rowGap)));
}

export function scrollForRow(row, rowHeight = ROW_HEIGHT, rowGap = ROW_GAP, maxScroll = Infinity) {
  const limit = maxScroll === Infinity ? Number.MAX_VALUE : Math.max(0, finite(maxScroll, 0));
  return Math.min(limit, bounded(count(row) * rowStride(rowHeight, rowGap)));
}

export function overflowState(options = {}) {
  const { itemCount, columns, rows, scrollTop, rowHeight, rowGap } = options ?? {};
  const items = count(itemCount), cols = columnsOf(columns), shown = visible(rows);
  const total = totalRows(items, cols), max = maxScrollRow(total, shown);
  const row = clampRow(rowForScroll(scrollTop, rowHeight, rowGap), total, shown);
  const startIndex = Math.min(items, row * cols);
  const endIndex = Math.min(items, (row + shown) * cols);
  return { totalRows: total, maxScrollRow: max, row, canUp: row > 0, canDown: row < max,
    remaining: items - endIndex, startIndex, endIndex, hasOverflow: max > 0 };
}

export function pageLabel(options = {}) {
  const { row, totalRows, rows } = options ?? {};
  return `${clampRow(row, totalRows, rows) + 1}/${maxScrollRow(totalRows, rows) + 1}`;
}
