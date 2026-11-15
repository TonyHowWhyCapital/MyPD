// The automatic rule: values decided from the column alone (kind, length, what the type
// is for). AUTO gives the random generators, autoSpace the values to draw from when the
// column must be unique.
import { intRange, decimalLimit, sizeOf, MAX_SAFE } from './fit';
import {
  CHARSETS, randomText, formatDate, formatDateTime, formatTime, DAY_MS,
} from './pattern';
import { builtinGenerator } from './builtin';
import {
  rangeSpace, listSpace, slotsSpace, joinSpaces,
} from './spaces';

const VOWELS = 'aeiou';
const CONSONANTS = 'bcdfghklmnprstvz';
const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MANY = 1000000; // the most rows of a table
const FIRST_DAY = Date.UTC(1900, 0, 1) / DAY_MS;
const LAST_DAY = Math.floor(Date.UTC(9999, 11, 31) / DAY_MS);

// a pronounceable word of exactly `length` letters
const word = (random, length) => {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    const chars = i % 2 === 0 ? CONSONANTS : VOWELS;
    text += chars.charAt(Math.floor(random.next() * chars.length));
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const wordLengths = (column) => {
  const len = sizeOf(column.len);
  const max = len > 0 ? Math.min(len, 16) : 16;
  return {
    min: Math.max(1, Math.ceil(max / 2)),
    max,
  };
};

const two = n => (n < 10 ? `0${n}` : String(n));

// INTERVAL YEAR TO MONTH is written 'years-months', every other interval
// 'days hours:minutes:seconds' (the SQL standard forms PostgreSQL and Oracle read)
const intervalText = (column, random) => {
  const type = String(column.type || '');
  if (/YEAR|MONTH/.test(type) && !/DAY|HOUR|MINUTE|SECOND/.test(type)) {
    return `${random.int(0, 20)}-${random.int(0, 11)}`;
  }
  return `${random.int(0, 99)} ${two(random.int(0, 23))}:${two(random.int(0, 59))}:${
    two(random.int(0, 59))}`;
};

const SUBTYPES = {
  uuid: (column, ctx) => {
    const uuid = builtinGenerator('uuid');
    return () => uuid(ctx.random);
  },
  enum: (column, ctx) => {
    const values = column.values || [];
    return values.length > 0 ? () => values[Math.floor(ctx.random.next() * values.length)]
      : null;
  },
  json: (column, ctx) => () => JSON.stringify({
    id: ctx.random.int(1, 1000000000),
    name: word(ctx.random, 6),
    active: ctx.random.next() < 0.5,
  }),
  interval: (column, ctx) => () => intervalText(column, ctx.random),
};
SUBTYPES.set = SUBTYPES.enum;

// ---- values to draw from when the column must be unique -------------------
// whole numbers counted up from 1 (from the lowest number of the column when that is more)
const counter = (column) => {
  const { min, max } = intRange(column);
  return rangeSpace(Math.max(1, min), max, n => n, true);
};

// '0000000001', '0000000002' ...; letters join in when ten digits per place would not
// reach a million rows ('01' ... '09', '0A' ...)
const textCounter = (column) => {
  const len = sizeOf(column.len);
  const width = len > 0 ? Math.min(len, 10) : 10;
  const radix = 10 ** width >= MANY ? 10 : 36;
  return rangeSpace(1, Math.min((radix ** width) - 1, MAX_SAFE),
    n => n.toString(radix).toUpperCase().padStart(width, '0'), true);
};

const wordSpace = (column) => {
  const { min, max } = wordLengths(column);
  const spaces = [];
  for (let length = min; length <= max; length += 1) {
    const slots = [];
    for (let i = 0; i < length; i += 1) {
      const chars = i % 2 === 0 ? CONSONANTS : VOWELS;
      slots.push({ chars: i === 0 ? chars.toUpperCase() : chars });
    }
    spaces.push(slotsSpace(slots));
  }
  const words = joinSpaces(spaces);
  if (words.size >= MANY) {
    return words;
  }
  // too few words in so short a column: every text of digits and letters instead
  return slotsSpace(new Array(sizeOf(column.len)).fill({ chars: BASE36 }));
};

// today, yesterday ... back to 1900, then tomorrow and on: a date never comes twice
const daySpace = (now) => {
  const today = Math.floor(now / DAY_MS);
  const back = today - FIRST_DAY + 1;
  return {
    size: back + (LAST_DAY - today),
    at: i => formatDate((i < back ? today - i : today + (i - back) + 1) * DAY_MS),
    ordered: true,
  };
};

// the seconds of the last year; SMALLDATETIME keeps minutes only, so three years of them
const instantSpace = (column, now) => {
  const coarse = /SMALLDATETIME/i.test(String(column.type || ''));
  const unit = coarse ? 60000 : 1000;
  const hi = Math.floor(now / unit);
  const lo = Math.floor((now - ((coarse ? 3 : 1) * 365 * DAY_MS)) / unit);
  return rangeSpace(lo, hi, n => formatDateTime(n * unit), false);
};

const decimalSpace = (column) => {
  const limit = decimalLimit(column);
  const whole = Math.floor(limit.max);
  if (whole >= MANY) {
    return rangeSpace(1, whole, n => n, true);
  }
  const p = 10 ** limit.scale;
  return rangeSpace(1, Math.floor((limit.max * p) + 0.5), n => n / p, true);
};

const SPACES = {
  int: column => (column.subtype === 'year' ? rangeSpace(1901, 2155, n => n, false)
    : counter(column)),
  decimal: decimalSpace,
  string: (column) => {
    if (column.subtype === 'enum' || column.subtype === 'set') {
      return (column.values || []).length > 0 ? listSpace(column.values, false) : null;
    }
    if (column.subtype) {
      return null; // uuid, json, interval: random, practically never the same twice
    }
    return column.primaryKey ? textCounter(column) : wordSpace(column);
  },
  date: (column, now) => daySpace(now),
  datetime: instantSpace,
  time: () => rangeSpace(0, 86399, n => formatTime(n * 1000), false),
  bool: () => listSpace([true, false], false),
  binary: (column) => {
    const len = sizeOf(column.len);
    return slotsSpace(new Array((len > 0 ? Math.min(len, 8) : 8) * 2)
      .fill({ chars: CHARSETS.hex }));
  },
};

// now: milliseconds on the naive time line
export const autoSpace = (column, now) => (SPACES[column.kind] || SPACES.string)(column, now);

// ---- random values ---------------------------------------------------------
// uniform between two naive instants, by day for date columns, else by second
export const dateBetween = (lo, hi, unit, format, random) => () => format(
  random.int(lo, hi) * unit);

// A key column counts; past the last number of the column it starts again (the generator
// draws from autoSpace instead where the column alone has to be unique).
const counting = (space) => {
  const { size } = space;
  return rowIndex => space.at(rowIndex < size ? rowIndex : rowIndex % size);
};

export const AUTO = {
  int: (column, ctx, now) => {
    const { min, max } = intRange(column);
    if (column.subtype === 'year') {
      const year = new Date(now).getUTCFullYear();
      return () => ctx.random.int(Math.max(min, year - 50), Math.min(max, year));
    }
    if (column.primaryKey || column.autoIncrement) {
      return counting(counter(column));
    }
    const lo = Math.max(0, min);
    const hi = Math.min(max, 10000);
    return () => ctx.random.int(lo, hi);
  },
  decimal: (column, ctx) => {
    const limit = decimalLimit(column);
    const scale = sizeOf(column.len) === 0 && sizeOf(column.scale) === 0 ? 2 : limit.scale;
    const p = 10 ** scale;
    const top = Math.floor(Math.min(limit.max, 10000) * p);
    return () => ctx.random.int(0, top) / p;
  },
  string: (column, ctx) => {
    const special = SUBTYPES[column.subtype] && SUBTYPES[column.subtype](column, ctx);
    if (special) {
      return special;
    }
    if (column.primaryKey) {
      return counting(textCounter(column));
    }
    const { min, max } = wordLengths(column);
    return () => word(ctx.random, ctx.random.int(min, max));
  },
  date: (column, ctx, now) => dateBetween(Math.floor((now - (365 * DAY_MS)) / DAY_MS),
    Math.floor(now / DAY_MS), DAY_MS, formatDate, ctx.random),
  datetime: (column, ctx, now) => dateBetween(Math.floor((now - (365 * DAY_MS)) / 1000),
    Math.floor(now / 1000), 1000, formatDateTime, ctx.random),
  time: (column, ctx) => () => formatTime(ctx.random.int(0, 86399) * 1000),
  bool: (column, ctx) => () => ctx.random.next() < 0.5,
  binary: (column, ctx) => {
    if (!column.notNull && !column.primaryKey) return () => null;
    const len = sizeOf(column.len);
    const bytes = len > 0 ? Math.min(len, 8) : 8;
    return () => randomText(ctx.random, CHARSETS.hex, bytes * 2);
  },
};
