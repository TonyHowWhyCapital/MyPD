// Turns a rule into a value generator for one column. Everything expensive
// (parsing, list preparation, range checks) happens once in the factory; the
// returned closure is cheap enough to be called a million times.
// Null rate and uniqueness are applied by the caller (generate.js), not here.
import { validateRule, numberOf } from './model';
import { builtinGenerator } from './builtin';
import { compileExpr, exprColumns as readExprColumns } from './expr';
import {
  CHARSETS, randomText, compileMask, parseDateTime, parseTime, formatDate, formatDateTime,
  formatTime, resolveDateSpec, naiveNow, DAY_MS,
} from './pattern';
import { createRandom } from './random';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const DECIMAL_LIMIT = 1e15;
const TRUE_WORDS = ['true', '1', 'y', 'yes', 't', 'on', '是'];
const FALSE_WORDS = ['false', '0', 'n', 'no', 'f', 'off', '否', ''];
const HEX_RE = /^(?:[0-9a-fA-F]{2})*$/;

const fail = (code, detail) => {
  const error = new Error(detail === undefined ? code : `${code}: ${String(detail)}`);
  error.code = code;
  if (detail !== undefined) {
    error.detail = detail;
  }
  return error;
};

// len / scale of a column as a non-negative integer, 0 = not set
const sizeOf = (v) => {
  const n = numberOf(v);
  return n > 0 ? Math.floor(n) : 0;
};

const paramNumber = (v, fallback) => {
  const n = numberOf(v);
  return n === undefined || Number.isNaN(n) ? fallback : n;
};

// ---- column limits --------------------------------------------------------
// largest absolute integer the column can hold
const intLimit = (column) => {
  const type = String(column.type || '').toLowerCase();
  if (/tinyint|byte/.test(type)) return 127;
  if (/small|int2|short/.test(type)) return 32767;
  if (/mediumint/.test(type)) return 8388607;
  if (/big|int8|long/.test(type)) return MAX_SAFE;
  if (/int|serial/.test(type)) return 2147483647;
  // NUMBER(p) / NUMERIC(p) / DECIMAL(p) used as an integer
  const len = sizeOf(column.len);
  return len > 0 ? Math.min(10 ** len - 1, MAX_SAFE) : 2147483647;
};

// {scale, max}: digits after the point and the largest absolute value
const decimalLimit = (column) => {
  const len = sizeOf(column.len);
  if (len === 0) {
    // FLOAT, DOUBLE, MONEY ... without a precision
    return {
      scale: column.scale === '' || column.scale === undefined || column.scale === null
        ? 4 : Math.min(sizeOf(column.scale), 10),
      max: DECIMAL_LIMIT,
    };
  }
  const scale = Math.min(sizeOf(column.scale), len, 10);
  return {
    scale,
    max: Math.min(10 ** (len - scale) - 10 ** -scale, DECIMAL_LIMIT),
  };
};

const toNumber = (v, kind) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw fail('value.type', `${kind}: ${String(v)}`);
};

const clamp = (n, max) => {
  if (n > max) return max;
  return n < -max ? -max : n;
};

// ---- fitting a raw value into the column ----------------------------------
// each fitter: raw value (never null) -> value of the column kind
const FITTERS = {
  int: (column) => {
    const max = intLimit(column);
    return v => clamp(Math.round(toNumber(v, 'int')), max);
  },
  decimal: (column) => {
    const { scale, max } = decimalLimit(column);
    const p = 10 ** scale;
    return v => clamp(Math.round(toNumber(v, 'decimal') * p) / p, max);
  },
  string: (column) => {
    const len = sizeOf(column.len);
    const short = len > 0 && len < 5;
    return (v) => {
      let text;
      if (typeof v === 'string') {
        text = v;
      } else if (typeof v === 'boolean') {
        text = String(v);
        if (short) text = v ? '1' : '0'; // `false` does not fit CHAR(1)
      } else {
        text = String(v);
      }
      if (len > 0 && text.length > len) {
        // never cut a surrogate pair in two
        const code = text.charCodeAt(len - 1);
        return text.slice(0, code >= 0xD800 && code <= 0xDBFF ? len - 1 : len);
      }
      return text;
    };
  },
  date: () => (v) => {
    const d = parseDateTime(v);
    if (!d) throw fail('value.type', `date: ${String(v)}`);
    return formatDate(d.ms);
  },
  datetime: () => (v) => {
    const d = parseDateTime(v);
    if (!d) throw fail('value.type', `datetime: ${String(v)}`);
    return formatDateTime(d.ms);
  },
  time: () => (v) => {
    const time = parseTime(v);
    if (time) return time;
    const d = parseDateTime(v);
    if (!d) throw fail('value.type', `time: ${String(v)}`);
    return formatTime(d.ms);
  },
  bool: () => (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const word = String(v).trim().toLowerCase();
    if (TRUE_WORDS.includes(word)) return true;
    if (FALSE_WORDS.includes(word)) return false;
    throw fail('value.type', `bool: ${String(v)}`);
  },
  binary: (column) => {
    const len = sizeOf(column.len);
    return (v) => {
      if (typeof v !== 'string' || !HEX_RE.test(v)) {
        throw fail('value.type', `binary: ${String(v)}`);
      }
      return len > 0 ? v.slice(0, len * 2) : v;
    };
  },
};

const makeFit = (column) => {
  const fit = (FITTERS[column.kind] || FITTERS.string)(column);
  return v => (v === null || v === undefined ? null : fit(v));
};

// ---- helpers for the kinds ------------------------------------------------
const isNumeric = column => column.kind === 'int' || column.kind === 'decimal';

// a prepared list: random or cycling, values already fitted
const listPicker = (values, order, random) => {
  const count = values.length;
  if (order === 'cycle') {
    return rowIndex => values[rowIndex % count];
  }
  return () => values[Math.floor(random.next() * count)];
};

const loadedList = (kind, key, params, ctx, fit) => {
  const lists = (ctx.lists && ctx.lists[kind]) || {};
  const list = Object.prototype.hasOwnProperty.call(lists, key) ? lists[key] : undefined;
  if (!Array.isArray(list)) throw fail(`${kind}.missing`, key);
  if (list.length === 0) throw fail(`${kind}.empty`, key);
  return listPicker(list.map(fit), params.order, ctx.random);
};

const VOWELS = 'aeiou';
const CONSONANTS = 'bcdfghklmnprstvz';
// a pronounceable word of exactly `length` letters
const word = (random, length) => {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    const chars = i % 2 === 0 ? CONSONANTS : VOWELS;
    text += chars.charAt(Math.floor(random.next() * chars.length));
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const dateFormatter = (column, dateOnly) => {
  if (column.kind === 'date') return formatDate;
  if (column.kind === 'time') return formatTime;
  if (column.kind === 'datetime') return formatDateTime;
  return dateOnly ? formatDate : formatDateTime;
};

// uniform between two naive instants, by day for date columns, else by second
const dateBetween = (from, to, column, dateOnly, random) => {
  const format = dateFormatter(column, dateOnly);
  const unit = column.kind === 'date' || (dateOnly && column.kind !== 'datetime'
    && column.kind !== 'time') ? DAY_MS : 1000;
  const lo = Math.floor(from / unit);
  const hi = Math.floor(to / unit);
  return () => format(random.int(lo, hi) * unit);
};

// ---- auto: decided from the column ----------------------------------------
const AUTO = {
  int: (column, ctx) => {
    const limit = intLimit(column);
    if (column.primaryKey || column.autoIncrement) {
      return rowIndex => Math.min(rowIndex + 1, limit);
    }
    const max = Math.min(limit, 10000);
    return () => ctx.random.int(0, max);
  },
  decimal: (column, ctx) => {
    const limit = decimalLimit(column);
    const scale = sizeOf(column.len) === 0 && sizeOf(column.scale) === 0 ? 2 : limit.scale;
    const p = 10 ** scale;
    const top = Math.floor(Math.min(limit.max, 10000) * p);
    return () => ctx.random.int(0, top) / p;
  },
  string: (column, ctx) => {
    const len = sizeOf(column.len);
    if (column.primaryKey) {
      const width = len > 0 ? Math.min(len, 10) : 10;
      return rowIndex => String(rowIndex + 1).padStart(width, '0');
    }
    const max = len > 0 ? Math.min(len, 16) : 16;
    const min = Math.max(1, Math.ceil(max / 2));
    return () => word(ctx.random, ctx.random.int(min, max));
  },
  date: (column, ctx, now) => dateBetween(now - 365 * DAY_MS, now, column, true, ctx.random),
  datetime: (column, ctx, now) => dateBetween(now - 365 * DAY_MS, now, column, false, ctx.random),
  time: (column, ctx) => () => formatTime(ctx.random.int(0, 86399) * 1000),
  bool: (column, ctx) => () => ctx.random.next() < 0.5,
  binary: (column, ctx) => {
    if (!column.notNull && !column.primaryKey) return () => null;
    const len = sizeOf(column.len);
    const bytes = len > 0 ? Math.min(len, 8) : 8;
    return () => randomText(ctx.random, CHARSETS.hex, bytes * 2);
  },
};

// ---- one builder per rule kind: (params, column, ctx, fit, now) -> raw generator
// `prefit` kinds return fitted values themselves, the others go through `fit`
const KINDS = {
  auto: (p, column, ctx, fit, now) => (AUTO[column.kind] || AUTO.string)(column, ctx, now),
  sequence: (p, column) => {
    const start = paramNumber(p.start, 1);
    const step = paramNumber(p.step, 1);
    const pad = paramNumber(p.pad, 0);
    const prefix = p.prefix === undefined || p.prefix === null ? '' : String(p.prefix);
    const suffix = p.suffix === undefined || p.suffix === null ? '' : String(p.suffix);
    if (column.kind !== 'string') {
      if (prefix || suffix) throw fail('sequence.affix.type', column.kind);
      return rowIndex => start + step * rowIndex;
    }
    return (rowIndex) => {
      const n = start + step * rowIndex;
      const body = n < 0 ? `-${String(-n).padStart(pad, '0')}` : String(n).padStart(pad, '0');
      return prefix + body + suffix;
    };
  },
  number: (p, column, ctx) => {
    let decimals = paramNumber(p.decimals, 0);
    let limit = MAX_SAFE;
    if (column.kind === 'int') {
      decimals = 0;
      limit = intLimit(column);
    } else if (column.kind === 'decimal') {
      const range = decimalLimit(column);
      decimals = Math.min(decimals, range.scale);
      limit = range.max;
    } else if (sizeOf(column.len) > 0) {
      limit = Math.min(10 ** sizeOf(column.len) - 1, MAX_SAFE);
    }
    const min = paramNumber(p.min, 0);
    const max = paramNumber(p.max, Math.max(min, Math.min(limit, 1000000)));
    if (min > max) throw fail('number.range');
    const scale = 10 ** decimals;
    // whole steps of 10^-decimals inside both the rule and the column
    const steps = n => (decimals === 0 ? n : Math.round(n * scale * 1e6) / 1e6);
    const lo = Math.ceil(steps(Math.max(min, -limit)));
    const hi = Math.floor(steps(Math.min(max, limit)));
    if (lo > hi) throw fail('number.range.column');
    if (isNumeric(column)) return () => ctx.random.int(lo, hi) / scale;
    return () => (ctx.random.int(lo, hi) / scale).toFixed(decimals);
  },
  date: (p, column, ctx, fit, now) => {
    const from = resolveDateSpec(p.from === undefined || p.from === null || p.from === ''
      ? 'now-365d' : p.from, now);
    const to = resolveDateSpec(p.to === undefined || p.to === null || p.to === ''
      ? 'now' : p.to, now);
    if (!from) throw fail('date.from.invalid');
    if (!to) throw fail('date.to.invalid');
    if (from.ms > to.ms) throw fail('date.range');
    // a `to` without a time means the whole of that day
    const end = to.hasTime ? to.ms : to.ms + DAY_MS - 1000;
    return dateBetween(from.ms, end, column, !from.hasTime && !to.hasTime, ctx.random);
  },
  text: (p, column, ctx) => {
    const chars = CHARSETS[p.charset || 'alnum'];
    if (!chars) throw fail('text.charset.unknown', p.charset);
    let cap = sizeOf(column.len);
    if (isNumeric(column)) {
      // keep digit texts inside the numeric range of the column
      const limit = column.kind === 'int' ? intLimit(column) : decimalLimit(column).max;
      cap = Math.max(1, String(Math.floor(limit)).length - 1);
    }
    let max = paramNumber(p.max, cap > 0 ? Math.min(cap, 20) : 20);
    let min = paramNumber(p.min, Math.min(5, max));
    if (min > max) throw fail('text.range');
    if (cap > 0) {
      max = Math.min(max, cap);
      min = Math.min(min, max);
    }
    return () => randomText(ctx.random, chars, ctx.random.int(min, max));
  },
  list: (p, column, ctx, fit) => {
    const items = (Array.isArray(p.items) ? p.items : [])
      .map(item => (item !== null && typeof item === 'object' ? item : { value: item }))
      .map(item => ({ value: item.value, weight: paramNumber(item.weight, 1) }))
      .filter(item => item.weight > 0);
    if (items.length === 0) throw fail('list.items.empty');
    const values = items.map(item => fit(item.value));
    const even = items.every(item => item.weight === items[0].weight);
    if (p.order === 'cycle' || even) return listPicker(values, p.order, ctx.random);
    // cumulative weights + binary search
    const sums = [];
    let total = 0;
    items.forEach((item) => {
      total += item.weight;
      sums.push(total);
    });
    return () => {
      const r = ctx.random.next() * total;
      let lo = 0;
      let hi = sums.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (r < sums[mid]) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      return values[lo];
    };
  },
  pattern: (p, column, ctx) => {
    const mask = compileMask(p.mask);
    return () => mask(ctx.random);
  },
  dict: (p, column, ctx, fit) => {
    const id = p.dict || (ctx.field && ctx.field.refDict);
    if (!id) throw fail('dict.missing');
    const dicts = (ctx.dataSource && ctx.dataSource.dicts) || [];
    const dict = dicts.find(d => d.id === id) || dicts.find(d => d.defKey === id);
    if (!dict) throw fail('dict.missing', id);
    const values = (dict.items || []).filter(item => item && item.enabled !== false)
      .map(item => (p.use === 'name' ? item.defName : item.defKey))
      .filter(v => v !== undefined && v !== null && v !== '');
    if (values.length === 0) throw fail('dict.empty', id);
    return listPicker(values.map(fit), 'random', ctx.random);
  },
  builtin: (p, column, ctx) => {
    const generate = builtinGenerator(p.name);
    if (!generate) throw fail('builtin.name.unknown', p.name);
    return () => generate(ctx.random);
  },
  file: (p, column, ctx, fit) => loadedList('file', p.path, p, ctx, fit),
  query: (p, column, ctx, fit) => loadedList('query', p.sql, p, ctx, fit),
  expr: (p, column, ctx) => {
    const compiled = compileExpr(p.expr);
    const entity = ctx.field && ((ctx.dataSource && ctx.dataSource.entities) || [])
      .find(e => (e.fields || []).some(f => f === ctx.field
        || (ctx.field.id !== undefined && f.id === ctx.field.id)));
    if (entity) {
      const unknown = compiled.columns
        .find(key => !(entity.fields || []).some(f => f.defKey === key));
      if (unknown !== undefined) throw fail('expr.column.unknown', unknown);
    }
    const env = {
      random: ctx.random,
      now: ctx.now,
    };
    const { run } = compiled;
    return (rowIndex, row) => run(row || {}, rowIndex, env);
  },
  constant: (p, column, ctx, fit) => {
    if (p.value === undefined || p.value === null) throw fail('constant.value.missing');
    const value = fit(p.value);
    return () => value;
  },
};

const PREFIT = ['list', 'dict', 'file', 'query', 'constant'];
// kinds whose first value is tried in the factory, so that a rule that can
// never fit the column (a name in a number column) fails before generation
const PROBED = ['sequence', 'number', 'date', 'text', 'pattern', 'builtin'];

// (rule, column, ctx) -> (rowIndex, row) => value fitting the column.
// Throws an Error with a stable `code` when the rule cannot work for the column.
export const makeValueGenerator = (rule, column, ctx) => {
  const col = column || { kind: 'string' };
  const context = { ...(ctx || {}) };
  if (!context.random) context.random = createRandom(1);
  if (!(context.now instanceof Date)) context.now = new Date();
  const kind = rule && rule.kind ? rule.kind : 'auto';
  if (kind === 'foreign') throw fail('rule.kind.foreign');
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw fail('rule.kind.unknown', kind);
  const params = (rule && rule.params) || {};
  const problems = validateRule({ kind, params }, { now: context.now });
  if (problems.length > 0) throw fail(problems[0], problems.join(','));
  const now = naiveNow(context.now);
  const fit = makeFit(col);
  if (PROBED.includes(kind) && col.kind !== 'string') {
    // on a separate stream: the real one must not be consumed by the trial
    const trial = { ...context, random: context.random.fork('#probe') };
    fit(KINDS[kind](params, col, trial, fit, now)(0, {}));
  }
  const generate = KINDS[kind](params, col, context, fit, now);
  if (PREFIT.includes(kind)) return generate;
  if (kind === 'auto' && col.kind !== 'string') {
    return generate; // already of the column kind and inside its limits
  }
  return (rowIndex, row) => fit(generate(rowIndex, row));
};

export const exprColumns = readExprColumns;
