// Text shapes shared by the rule generators: character sets, masks, and the
// canonical date strings (`YYYY-MM-DD`, `YYYY-MM-DD HH:mm:ss`, `HH:mm:ss`).
// Dates are "naive" wall clock values kept as milliseconds on a UTC time line,
// so no time zone or daylight saving shift can change a generated value.
import { ZH_CHARS } from './builtin_data';

const DIGITS = '0123456789';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';

export const CHARSETS = {
  alnum: UPPER + LOWER + DIGITS,
  alpha: UPPER + LOWER,
  digit: DIGITS,
  zh: ZH_CHARS,
  hex: '0123456789ABCDEF',
};

export const randomText = (random, chars, length) => {
  let text = '';
  const n = chars.length;
  for (let i = 0; i < length; i += 1) {
    text += chars.charAt(Math.floor(random.next() * n));
  }
  return text;
};

// ---- masks ----------------------------------------------------------------
const MASK_CLASSES = {
  '#': DIGITS,
  A: UPPER,
  a: LOWER,
  '*': UPPER + LOWER + DIGITS,
};

// null when the mask is usable, otherwise a problem code
export const maskProblem = (mask) => {
  if (typeof mask !== 'string' || mask === '') {
    return 'pattern.mask.empty';
  }
  for (let i = 0; i < mask.length; i += 1) {
    if (mask.charAt(i) === '\\') {
      if (i === mask.length - 1) {
        return 'pattern.mask.escape';
      }
      i += 1;
    }
  }
  return null;
};

// mask -> (random) => string. `#` digit, `A` upper, `a` lower, `*` alnum,
// `\x` literal x, anything else literal.
export const compileMask = (mask) => {
  const problem = maskProblem(mask);
  if (problem) {
    const error = new Error(problem);
    error.code = problem;
    throw error;
  }
  // parts: {text} = literal run, {chars} = one random character of that set
  const parts = [];
  let literal = '';
  const flush = () => {
    if (literal) {
      parts.push({ text: literal });
      literal = '';
    }
  };
  for (let i = 0; i < mask.length; i += 1) {
    const ch = mask.charAt(i);
    if (ch === '\\') {
      i += 1;
      literal += mask.charAt(i);
    } else if (MASK_CLASSES[ch]) {
      flush();
      parts.push({ chars: MASK_CLASSES[ch] });
    } else {
      literal += ch;
    }
  }
  flush();
  const count = parts.length;
  return (random) => {
    let text = '';
    for (let i = 0; i < count; i += 1) {
      const part = parts[i];
      if (part.chars) {
        text += part.chars.charAt(Math.floor(random.next() * part.chars.length));
      } else {
        text += part.text;
      }
    }
    return text;
  };
};

// ---- canonical dates ------------------------------------------------------
export const DAY_MS = 86400000;
export const HOUR_MS = 3600000;

const two = n => (n < 10 ? `0${n}` : String(n));
const four = (n) => {
  const text = String(n);
  return text.length >= 4 ? text : `${'0000'.slice(text.length)}${text}`;
};

export const formatDate = (ms) => {
  const d = new Date(ms);
  return `${four(d.getUTCFullYear())}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
};

export const formatTime = (ms) => {
  const d = new Date(ms);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
};

export const formatDateTime = ms => `${formatDate(ms)} ${formatTime(ms)}`;

const DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

// 'YYYY-MM-DD[ HH:mm[:ss]]' -> {ms, hasTime}, null when it is not a real date
export const parseDateTime = (text) => {
  if (typeof text !== 'string') {
    return null;
  }
  const m = DATE_RE.exec(text.trim());
  if (!m) {
    return null;
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hasTime = m[4] !== undefined;
  const hour = hasTime ? Number(m[4]) : 0;
  const minute = hasTime ? Number(m[5]) : 0;
  const second = m[6] !== undefined ? Number(m[6]) : 0;
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59
    || second > 59) {
    return null;
  }
  const date = new Date(Date.UTC(2000, month - 1, day, hour, minute, second));
  date.setUTCFullYear(year);
  // an impossible day (02-30) rolls over into the next month
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return {
    ms: date.getTime(),
    hasTime,
  };
};

// 'HH:mm[:ss]' -> canonical 'HH:mm:ss', null when invalid
export const parseTime = (text) => {
  if (typeof text !== 'string') {
    return null;
  }
  const m = TIME_RE.exec(text.trim());
  if (!m) {
    return null;
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] !== undefined ? Number(m[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  return `${two(hour)}:${two(minute)}:${two(second)}`;
};

// the wall clock of a JS Date (local time) on the naive time line, whole seconds
export const naiveNow = (date) => {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(),
    d.getSeconds());
};

// month arithmetic keeps the day when possible: 01-31 + 1 month = 02-28/29
export const addMonths = (ms, months) => {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Math.trunc(months));
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
};

const RELATIVE_RE = /^now(?:\s*([+-])\s*(\d{1,6})\s*([dhMy]))?$/;

// a `from`/`to` of a date rule: a canonical date, `now`, `now-365d`, `now+30d`
// (units: d days, h hours, M months, y years) -> {ms, hasTime} or null
export const resolveDateSpec = (spec, nowMs) => {
  if (typeof spec !== 'string') {
    return null;
  }
  const text = spec.trim();
  const m = RELATIVE_RE.exec(text);
  if (!m) {
    return parseDateTime(text);
  }
  let ms = nowMs;
  if (m[1]) {
    const amount = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    if (m[3] === 'd') {
      ms += amount * DAY_MS;
    } else if (m[3] === 'h') {
      ms += amount * HOUR_MS;
    } else if (m[3] === 'M') {
      ms = addMonths(ms, amount);
    } else {
      ms = addMonths(ms, amount * 12);
    }
  }
  return {
    ms,
    hasTime: true,
  };
};
