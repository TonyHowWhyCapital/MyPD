// What the parameters of a rule mean for a column (shared by the random generators of
// values.js), and the value space of a rule: every value it can give, for drawing unique
// values without repeating and for telling how many rows a unique column can hold.
import { numberOf } from './model';
import {
  makeFit, fail, sizeOf, intRange, decimalLimit, textFits, charRoom, MAX_SAFE,
} from './fit';
import {
  CHARSETS, maskParts, resolveDateSpec, naiveNow, formatDate, formatDateTime, formatTime,
  formatNumber, DAY_MS,
} from './pattern';
import { builtinList, builtinMask } from './builtin';
import { autoSpace } from './values_auto';
import {
  rangeSpace, listSpace, slotsSpace, textSpace, usable,
} from './spaces';

export const paramNumber = (v, fallback) => {
  const n = numberOf(v);
  return n === undefined || Number.isNaN(n) ? fallback : n;
};

const isNumeric = column => column.kind === 'int' || column.kind === 'decimal';
const blank = v => v === undefined || v === null || v === '';
const MOST_ROWS = 1000000;

// ---- sequence: -> (rowIndex) => number, or the text for a text column
// digits after the point of a number with ten decimals at most
const decimalsOf = (n) => {
  const text = n.toFixed(10).replace(/0+$/, '');
  return text.length - text.indexOf('.') - 1;
};

// A sequence counts in whole steps of 10^-decimals, so 0, 0.1, 0.2 ... never drift. It
// never leaves the column: a number the column cannot hold, or a text it would have to
// cut, is an error (`value.range`, `value.length`) instead of a repeated value. Decimals
// are for decimal and text columns only (`sequence.fraction`).
export const sequenceValues = (p, column) => {
  const start = paramNumber(p.start, 1);
  const step = paramNumber(p.step, 1);
  const decimals = Math.max(decimalsOf(start), decimalsOf(step));
  let low = -MAX_SAFE;
  let high = MAX_SAFE;
  if (column.kind === 'int') {
    if (decimals > 0) throw fail('sequence.fraction', `${start}, ${step}`);
    ({ min: low, max: high } = intRange(column));
  } else if (column.kind === 'decimal') {
    const limit = decimalLimit(column);
    if (decimals > limit.scale) throw fail('sequence.fraction', `${start}, ${step}`);
    low = -limit.max;
    high = limit.max;
  }
  const scale = 10 ** decimals;
  const first = Math.round(start * scale);
  const by = Math.round(step * scale);
  const number = (rowIndex) => {
    const n = (first + (by * rowIndex)) / scale;
    if (!(n >= low && n <= high)) throw fail('value.range', `${n} (${low}..${high})`);
    return n;
  };
  const prefix = blank(p.prefix) ? '' : String(p.prefix);
  const suffix = blank(p.suffix) ? '' : String(p.suffix);
  if (column.kind !== 'string') {
    if (prefix || suffix) throw fail('sequence.affix.type', column.kind);
    return number;
  }
  const pad = paramNumber(p.pad, 0);
  const whole = textFits(column);
  return (rowIndex) => {
    const n = number(rowIndex);
    const body = formatNumber(Math.abs(n)).padStart(pad, '0');
    const text = prefix + (n < 0 ? `-${body}` : body) + suffix;
    if (!whole(text)) throw fail('value.length', `${text} (${column.len})`);
    return text;
  };
};

// rows a sequence can fill before it leaves the column; Infinity = more than `most`
export const sequenceRows = (p, column, most) => {
  let make;
  try {
    make = sequenceValues(p, column);
  } catch (e) {
    return 0;
  }
  if (paramNumber(p.step, 1) === 0) {
    return 1; // the same value again and again
  }
  // the longest and largest values are at the ends, so the ends decide
  const fits = (rows) => {
    try {
      make(0);
      make(rows - 1);
      return true;
    } catch (e) {
      return false;
    }
  };
  if (fits(most)) return Infinity;
  let lo = 0;
  let hi = most;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
};

// ---- number: whole steps of 10^-decimals inside both the rule and the column
// -> {lo, hi, value(step)}; a text column must take the longest number whole
export const numberSteps = (p, column) => {
  let decimals = paramNumber(p.decimals, 0);
  let low = -MAX_SAFE;
  let high = MAX_SAFE;
  if (column.kind === 'int') {
    decimals = 0;
    ({ min: low, max: high } = intRange(column));
  } else if (column.kind === 'decimal') {
    const range = decimalLimit(column);
    decimals = Math.min(decimals, range.scale);
    low = -range.max;
    high = range.max;
  } else if (sizeOf(column.len) > 0) {
    // the digits before the point that leave room for the decimals
    const digits = sizeOf(column.len) - (decimals > 0 ? decimals + 1 : 0);
    high = digits > 0 ? Math.min((10 ** digits) - 1, MAX_SAFE) : 0;
  }
  const min = paramNumber(p.min, 0);
  const max = paramNumber(p.max, Math.max(min, Math.min(high, 1000000)));
  if (min > max) throw fail('number.range');
  const scale = 10 ** decimals;
  const steps = n => (decimals === 0 ? n : Math.round(n * scale * 1e6) / 1e6);
  const numeric = isNumeric(column);
  const lo = Math.ceil(steps(numeric ? Math.max(min, low) : min)) + 0;
  const hi = Math.floor(steps(numeric ? Math.min(max, high) : max)) + 0;
  if (lo > hi) throw fail('number.range.column');
  const value = numeric ? n => n / scale : n => (n / scale).toFixed(decimals);
  if (!numeric) {
    const whole = textFits(column);
    if (!whole(value(lo)) || !whole(value(hi))) {
      throw fail('value.length', `${value(Math.abs(lo) > hi ? lo : hi)} (${column.len})`);
    }
  }
  return {
    lo,
    hi,
    value,
  };
};

// ---- date: -> {lo, hi, value(step)}; steps are days for date columns, else seconds
export const dateSteps = (p, column, now) => {
  const from = resolveDateSpec(blank(p.from) ? 'now-365d' : p.from, now);
  const to = resolveDateSpec(blank(p.to) ? 'now' : p.to, now);
  if (!from) throw fail('date.from.invalid');
  if (!to) throw fail('date.to.invalid');
  if (from.ms > to.ms) throw fail('date.range');
  // a `to` without a time means the whole of that day
  const end = to.hasTime ? to.ms : to.ms + DAY_MS - 1000;
  const dateOnly = !from.hasTime && !to.hasTime;
  const byKind = {
    date: formatDate,
    time: formatTime,
    datetime: formatDateTime,
  };
  const format = byKind[column.kind] || (dateOnly ? formatDate : formatDateTime);
  const unit = format === formatDate ? DAY_MS : 1000;
  if (column.kind === 'string' && !textFits(column)(format(end))) {
    throw fail('value.length', `${format(end)} (${column.len})`);
  }
  return {
    lo: Math.floor(from.ms / unit),
    hi: Math.floor(end / unit),
    value: n => format(n * unit),
  };
};

// ---- text: -> {chars, min, max}
export const textShape = (p, column) => {
  const chars = CHARSETS[p.charset || 'alnum'];
  if (!chars) throw fail('text.charset.unknown', p.charset);
  let cap = column.kind === 'string' ? charRoom(column, chars) : sizeOf(column.len);
  if (isNumeric(column)) {
    // keep digit texts inside the numeric range of the column
    const limit = column.kind === 'int' ? intRange(column).max : decimalLimit(column).max;
    cap = Math.max(1, String(Math.floor(limit)).length - 1);
  }
  let max = paramNumber(p.max, cap > 0 ? Math.min(cap, 20) : 20);
  let min = paramNumber(p.min, Math.min(5, max));
  if (min > max) throw fail('text.range');
  if (cap > 0) {
    max = Math.min(max, cap);
    min = Math.min(min, max);
  }
  return {
    chars,
    min,
    max,
  };
};

// ---- lists: -> [{value, weight}], the raw values of a dictionary or a loaded list
export const listItems = (p) => {
  const items = (Array.isArray(p.items) ? p.items : [])
    .map(item => (item !== null && typeof item === 'object' ? item : { value: item }))
    .map(item => ({ value: item.value, weight: paramNumber(item.weight, 1) }))
    .filter(item => item.weight > 0);
  if (items.length === 0) throw fail('list.items.empty');
  return items;
};

export const dictValues = (p, ctx) => {
  const id = p.dict || (ctx.field && ctx.field.refDict);
  if (!id) throw fail('dict.missing');
  const dicts = (ctx.dataSource && ctx.dataSource.dicts) || [];
  const dict = dicts.find(d => d.id === id) || dicts.find(d => d.defKey === id);
  if (!dict) throw fail('dict.missing', id);
  const values = (dict.items || []).filter(item => item && item.enabled !== false)
    .map(item => (p.use === 'name' ? item.defName : item.defKey))
    .filter(v => !blank(v));
  if (values.length === 0) throw fail('dict.empty', id);
  return values;
};

// the list the caller loaded for a file or query rule; NULLs are left out of a column
// that cannot hold them
export const loadedValues = (kind, key, ctx, column) => {
  const lists = (ctx.lists && ctx.lists[kind]) || {};
  const list = Object.prototype.hasOwnProperty.call(lists, key) ? lists[key] : undefined;
  if (!Array.isArray(list)) throw fail(`${kind}.missing`, key);
  const values = column && (column.notNull || column.primaryKey)
    ? list.filter(v => v !== null && v !== undefined) : list;
  if (values.length === 0) throw fail(`${kind}.empty`, key);
  return values;
};

// a mask in a text column must go in whole: half a mask is no value of the rule
export const maskSlots = (mask, column) => {
  const parts = maskParts(mask);
  const sample = parts.map(part => (part.chars ? part.chars.charAt(0) : part.text)).join('');
  if (column.kind === 'string' && !textFits(column)(sample)) {
    throw fail('value.length', `${mask} (${column.len})`);
  }
  return parts;
};

// ---- spaces ----------------------------------------------------------------
const loadedSpace = kind => (p, column, ctx, fit) => {
  const key = kind === 'file' ? p.path : p.sql;
  const lists = (ctx.lists && ctx.lists[kind]) || {};
  if (!Object.prototype.hasOwnProperty.call(lists, key)) {
    return null; // not loaded yet: nothing is known about it
  }
  return listSpace(loadedValues(kind, key, ctx, column).map(fit), p.order === 'cycle');
};

const maskSpace = (mask, column) => (column.kind === 'string'
  ? slotsSpace(maskSlots(mask, column)) : null);

const SPACES = {
  auto: (p, column, ctx) => autoSpace(column, naiveNow(ctx.now)),
  constant: (p, column, ctx, fit) => listSpace([fit(p.value)], true),
  number: (p, column) => {
    if (!isNumeric(column) && column.kind !== 'string') return null;
    const steps = numberSteps(p, column);
    return rangeSpace(steps.lo, steps.hi, steps.value, false);
  },
  date: (p, column, ctx) => {
    if (!['date', 'datetime', 'time', 'string'].includes(column.kind)) return null;
    const steps = dateSteps(p, column, naiveNow(ctx.now));
    if (column.kind === 'time') {
      // only the time of day is kept: a day of seconds at most
      return rangeSpace(steps.lo, Math.min(steps.hi, steps.lo + 86399), steps.value, false);
    }
    return rangeSpace(steps.lo, steps.hi, steps.value, false);
  },
  text: (p, column) => {
    if (column.kind !== 'string') return null;
    const shape = textShape(p, column);
    return textSpace(shape.chars, shape.min, shape.max);
  },
  pattern: (p, column) => maskSpace(p.mask, column),
  // weights do not count for unique values: every value comes once at most anyway
  list: (p, column, ctx, fit) => listSpace(listItems(p).map(item => fit(item.value)),
    p.order === 'cycle'),
  dict: (p, column, ctx, fit) => listSpace(dictValues(p, ctx).map(fit), false),
  file: loadedSpace('file'),
  query: loadedSpace('query'),
  builtin: (p, column, ctx, fit) => {
    const list = builtinList(p.name);
    if (list) return listSpace(list.map(fit), false);
    const mask = builtinMask(p.name);
    return mask ? maskSpace(mask, column) : null;
  },
};

const build = (rule, column, ctx) => {
  const kind = rule && rule.kind ? rule.kind : 'auto';
  if (!Object.prototype.hasOwnProperty.call(SPACES, kind)) {
    return null;
  }
  try {
    return SPACES[kind]((rule && rule.params) || {}, column, ctx || {}, makeFit(column))
      || null;
  } catch (e) {
    return null; // a rule that does not work for the column is reported elsewhere
  }
};

// Every value the rule gives for the column as a space the generator can draw from
// without repeating; null when the values cannot be listed (formulas, most builtins, lists
// that are not loaded) or are too many to number (then random draws practically never
// repeat). ctx = { dataSource, field, lists, now }
export const ruleSpace = (rule, column, ctx) => usable(build(rule, column, ctx));

// How many different values the rule gives for the column; Infinity when not known.
export const spaceSize = (rule, column, ctx) => {
  if (rule && rule.kind === 'sequence') {
    return ['int', 'decimal', 'string'].includes(column.kind)
      ? sequenceRows(rule.params || {}, column, MOST_ROWS) : Infinity;
  }
  const space = build(rule, column, ctx);
  const size = space ? space.size : Infinity;
  return column.kind === 'bool' ? Math.min(2, size) : size;
};
