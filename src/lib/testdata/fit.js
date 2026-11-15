// What a column can hold (ranges of whole numbers per database, precision and scale,
// length of text in the unit the database counts) and the fitters that turn a raw value
// into a value of the column. A number that is too large or a date that is none is an
// error with a code, never a silently changed value; only text is cut to the length.
import { numberOf } from './model';
import {
  parseDateTime, parseTime, formatDate, formatDateTime, formatTime, formatNumber,
} from './pattern';

export const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const DECIMAL_LIMIT = 1e15;
const TRUE_WORDS = ['true', '1', 'y', 'yes', 't', 'on', '是'];
const FALSE_WORDS = ['false', '0', 'n', 'no', 'f', 'off', '否', ''];
const HEX_RE = /^(?:[0-9a-fA-F]{2})*$/;
const NOT_ASCII = /[^\u0000-\u007f]/; // eslint-disable-line no-control-regex

export const fail = (code, detail) => {
  const error = new Error(detail === undefined ? code : `${code}: ${String(detail)}`);
  error.code = code;
  if (detail !== undefined) {
    error.detail = detail;
  }
  return error;
};

// len / scale of a column as a non-negative integer, 0 = not set
export const sizeOf = (v) => {
  const n = numberOf(v);
  return n > 0 ? Math.floor(n) : 0;
};

// ---- whole numbers --------------------------------------------------------
const span = (bits, unsigned) => (unsigned ? {
  min: 0,
  max: Math.min((2 ** bits) - 1, MAX_SAFE),
} : {
  min: Math.max(-(2 ** (bits - 1)), -MAX_SAFE),
  max: Math.min((2 ** (bits - 1)) - 1, MAX_SAFE),
});

// TINYINT is 0..255 on SQL Server and -128..127 (0..255 UNSIGNED) on MySQL; where the
// database is not known only what both take is used.
const tinyRange = (column) => {
  if (column.dialect === 'mssql' || column.unsigned) {
    return span(8, true);
  }
  return column.dialect === 'mysql' ? span(8, false) : {
    min: 0,
    max: 127,
  };
};

// {min, max}: the whole numbers the column takes. The number in `INT(5)` of MySQL is a
// display width and does not count; the one in NUMBER(5) does.
export const intRange = (column) => {
  const type = String(column.type || '').toLowerCase();
  if (column.subtype === 'year') {
    return {
      min: 1901,
      max: 2155,
    };
  }
  const unsigned = !!column.unsigned && column.dialect !== 'mssql';
  if (/tinyint|byte/.test(type)) return tinyRange(column);
  if (/small|int2|short/.test(type)) return span(16, unsigned);
  if (/mediumint/.test(type)) return span(24, unsigned);
  if (/big|int8|long/.test(type)) return span(64, unsigned);
  if (/int|serial/.test(type)) return span(32, unsigned);
  // NUMBER(p) / NUMERIC(p) / DECIMAL(p) used as an integer
  const len = sizeOf(column.len);
  const max = len > 0 ? Math.min((10 ** len) - 1, MAX_SAFE) : 2147483647;
  return {
    min: unsigned ? 0 : -max,
    max,
  };
};

// {scale, max}: digits after the point and the largest absolute value
export const decimalLimit = (column) => {
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
    max: Math.min((10 ** (len - scale)) - (10 ** -scale), DECIMAL_LIMIT),
  };
};

// ---- length of text -------------------------------------------------------
// units one UTF-16 code unit takes in the column
const unitCost = (code, unit) => {
  if (code < 0x80) return 1;
  if (unit === 'dbcs') return 2;
  if (code < 0x800) return 2;
  // a surrogate pair is 4 bytes of UTF-8: 2 per half
  return code >= 0xD800 && code <= 0xDFFF ? 2 : 3;
};

// length of a text the way the column counts it
export const textLength = (text, column) => {
  const unit = column && column.lenUnit;
  if (!unit || !NOT_ASCII.test(text)) {
    return text.length;
  }
  let total = 0;
  for (let i = 0; i < text.length; i += 1) {
    total += unitCost(text.charCodeAt(i), unit);
  }
  return total;
};

// most characters of `chars` (the dearest one counted) the column takes, 0 = no limit
export const charRoom = (column, chars) => {
  const len = sizeOf(column.len);
  if (len === 0 || !column.lenUnit) {
    return len;
  }
  let worst = 1;
  for (let i = 0; i < chars.length; i += 1) {
    worst = Math.max(worst, unitCost(chars.charCodeAt(i), column.lenUnit));
  }
  return Math.max(1, Math.floor(len / worst));
};

const isHigh = code => code >= 0xD800 && code <= 0xDBFF;

// cut to the length of the column, never through a surrogate pair
const cutText = (text, len, unit) => {
  if (!unit || !NOT_ASCII.test(text)) {
    if (text.length <= len) return text;
    return text.slice(0, isHigh(text.charCodeAt(len - 1)) ? len - 1 : len);
  }
  let used = 0;
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    const pair = isHigh(code) && i + 1 < text.length;
    const cost = unitCost(code, unit) * (pair ? 2 : 1);
    if (used + cost > len) break;
    used += cost;
    i += pair ? 2 : 1;
  }
  return i === text.length ? text : text.slice(0, i);
};

// true when the text goes into the column whole
export const textFits = (column) => {
  const len = column.kind === 'string' ? sizeOf(column.len) : 0;
  return text => len === 0 || textLength(text, column) <= len;
};

// ---- fitting a raw value into the column ----------------------------------
const toNumber = (v, kind) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw fail('value.type', `${kind}: ${String(v)}`);
};

// each fitter: raw value (never null) -> value of the column kind
const FITTERS = {
  int: (column) => {
    const { min, max } = intRange(column);
    return (v) => {
      const n = Math.round(toNumber(v, 'int'));
      if (n < min || n > max) throw fail('value.range', `${n} (${min}..${max})`);
      return n === 0 ? 0 : n; // no -0
    };
  },
  decimal: (column) => {
    const { scale, max } = decimalLimit(column);
    const p = 10 ** scale;
    return (v) => {
      const n = Math.round(toNumber(v, 'decimal') * p) / p;
      if (n < -max || n > max) throw fail('value.range', `${n} (${-max}..${max})`);
      return n === 0 ? 0 : n;
    };
  },
  string: (column) => {
    const len = sizeOf(column.len);
    const short = len > 0 && len < 5;
    const unit = column.lenUnit;
    return (v) => {
      let text;
      if (typeof v === 'string') {
        text = v;
      } else if (typeof v === 'boolean') {
        text = String(v);
        if (short) text = v ? '1' : '0'; // `false` does not fit CHAR(1)
      } else if (typeof v === 'number') {
        text = formatNumber(v); // 0.1 + 0.2 is 0.3, not 0.30000000000000004
      } else {
        text = String(v);
      }
      return len > 0 ? cutText(text, len, unit) : text;
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

export const makeFit = (column) => {
  const fit = (FITTERS[column.kind] || FITTERS.string)(column);
  return v => (v === null || v === undefined ? null : fit(v));
};

export const allowsNull = column => !column.notNull && !column.primaryKey;

// For the value of a foreign key: the key of the parent row as the child column holds it.
// A key that does not go into the column unchanged (500 into a TINYINT, 'AB12' into
// CHAR(2)) would point at no parent row, so that is an error and nothing is cut.
export const makeKeyFit = (column) => {
  const fit = makeFit(column);
  const whole = textFits(column);
  const general = (v) => {
    if (v === null || v === undefined) return null;
    let out;
    try {
      out = fit(v);
    } catch (e) {
      throw fail('foreignKeyFit', `${e.code}: ${String(v)}`);
    }
    if (out === v) return out;
    const same = typeof v === 'string' ? whole(v) && String(out) === v.trim()
      : String(out) === (typeof v === 'number' ? formatNumber(v) : String(v));
    if (!same && !(typeof out === 'boolean')) {
      throw fail('foreignKeyFit', `value.changed: ${String(v)} -> ${String(out)}`);
    }
    return out;
  };
  // the usual pairs (number into number column, text into text column) without detours
  if (column.kind === 'int') {
    const { min, max } = intRange(column);
    return v => (typeof v === 'number' && v >= min && v <= max && Number.isInteger(v)
      ? v : general(v));
  }
  if (column.kind === 'string' && !column.lenUnit) {
    const len = sizeOf(column.len);
    return v => (typeof v === 'string' && (len === 0 || v.length <= len) ? v : general(v));
  }
  return general;
};
