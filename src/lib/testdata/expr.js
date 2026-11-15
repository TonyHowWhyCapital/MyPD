// The formula language of `expr` rules: a tokenizer and a recursive descent
// parser that turns the text straight into closures. No eval, no Function.
//
//   [COLUMN]  123  4.5  'text'  + - * / %  & (concat)  = <> != < <= > >=  ( )
//   name(args)  true false null
//
// Errors are Error objects with a stable `code` and the 0-based `pos` in the text.
import {
  parseDateTime, formatDate, formatDateTime, addMonths, naiveNow, formatNumber, inDateRange,
  DAY_MS, HOUR_MS,
} from './pattern';

const MAX_LENGTH = 4000;
const MAX_DEPTH = 64;
const MAX_PAD = 1000;

export const exprError = (code, pos, detail) => {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.name = 'ExprError';
  error.code = code;
  error.pos = pos;
  if (detail !== undefined) {
    error.detail = detail;
  }
  return error;
};

// ---- tokenizer ------------------------------------------------------------
const isDigit = ch => ch >= '0' && ch <= '9';
const isIdentStart = ch => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
const TWO_CHAR_OPS = ['<=', '>=', '<>', '!=', '=='];
const ONE_CHAR_OPS = '+-*/%&=<>';

const tokenize = (text) => {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    const pos = i;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
    } else if (isDigit(ch) || (ch === '.' && isDigit(text.charAt(i + 1)))) {
      while (isDigit(text.charAt(i))) i += 1;
      if (text.charAt(i) === '.') {
        i += 1;
        while (isDigit(text.charAt(i))) i += 1;
      }
      if (text.charAt(i) === '.' || isIdentStart(text.charAt(i))) {
        throw exprError('expr.number', pos);
      }
      tokens.push({ type: 'num', value: Number(text.slice(pos, i)), pos });
    } else if (ch === '\'' || ch === '"') {
      let value = '';
      i += 1;
      for (;;) {
        if (i >= text.length) {
          throw exprError('expr.string.unterminated', pos);
        }
        const c = text.charAt(i);
        if (c === ch) {
          if (text.charAt(i + 1) !== ch) break;
          i += 1; // a doubled quote is one quote
        }
        value += c;
        i += 1;
      }
      i += 1;
      tokens.push({ type: 'str', value, pos });
    } else if (ch === '[') {
      const end = text.indexOf(']', i);
      if (end < 0) {
        throw exprError('expr.column.unterminated', pos);
      }
      const value = text.slice(i + 1, end).trim();
      if (!value) {
        throw exprError('expr.column.empty', pos);
      }
      tokens.push({ type: 'col', value, pos });
      i = end + 1;
    } else if (isIdentStart(ch)) {
      while (isIdentStart(text.charAt(i)) || isDigit(text.charAt(i))) i += 1;
      tokens.push({ type: 'id', value: text.slice(pos, i), pos });
    } else if (TWO_CHAR_OPS.includes(text.substr(i, 2))) {
      tokens.push({ type: 'op', value: text.substr(i, 2), pos });
      i += 2;
    } else if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ type: 'op', value: ch, pos });
      i += 1;
    } else if (ch === '(' || ch === ')' || ch === ',') {
      tokens.push({ type: ch, value: ch, pos });
      i += 1;
    } else {
      throw exprError('expr.char', pos, ch);
    }
  }
  tokens.push({ type: 'end', value: '', pos: text.length });
  return tokens;
};

// ---- runtime helpers ------------------------------------------------------
const toText = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return formatNumber(v);
  return String(v);
};

// NaN when the value is not numeric
const looseNumber = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
};

const toNumber = (v) => {
  const n = looseNumber(v);
  if (Number.isNaN(n)) {
    throw exprError('expr.type', undefined, toText(v));
  }
  return n;
};

const truthy = v => v !== null && v !== undefined && v !== false && v !== 0 && v !== '';

const compare = (x, y) => {
  const a = looseNumber(x);
  const b = looseNumber(y);
  if (!Number.isNaN(a) && !Number.isNaN(b)) {
    return a - b;
  }
  const s = toText(x);
  const t = toText(y);
  if (s === t) return 0;
  return s < t ? -1 : 1;
};

const roundTo = (x, n) => {
  const p = 10 ** Math.max(0, Math.min(10, Math.trunc(n)));
  const r = Math.round(Math.abs(x) * p * (1 + Number.EPSILON)) / p;
  return x < 0 ? -r : r;
};

const dateOf = (v) => {
  const d = parseDateTime(toText(v));
  if (!d) {
    throw exprError('expr.date', undefined, toText(v));
  }
  return d;
};

// a date the arithmetic carried out of the years 1 to 9999 is an error, not a text
const inRange = (ms) => {
  if (!inDateRange(ms)) {
    throw exprError('expr.date.range', undefined, String(ms));
  }
  return ms;
};

const formatLike = (d, ms) => (d.hasTime ? formatDateTime(inRange(ms))
  : formatDate(inRange(ms)));

// Text functions count characters, not UTF-16 units: an emoji is one character and is
// never cut in two.
const SURROGATE = /[\uD800-\uDFFF]/;
const charsOf = text => (SURROGATE.test(text) ? Array.from(text) : null);

// null in -> null out, for plain value functions
const lift = fn => args => (row, i, env) => {
  const values = [];
  for (let k = 0; k < args.length; k += 1) {
    const v = args[k](row, i, env);
    if (v === null) return null;
    values.push(v);
  }
  return fn(values, env, i);
};

const FUNCTIONS = {
  rand: {
    min: 0,
    max: 2,
    make: lift((v, env) => {
      if (v.length === 0) return env.random.next();
      const lo = toNumber(v[0]);
      const hi = v.length > 1 ? toNumber(v[1]) : lo;
      if (Number.isInteger(lo) && Number.isInteger(hi)) return env.random.int(lo, hi);
      return lo + env.random.next() * (hi - lo);
    }),
  },
  round: {
    min: 1,
    max: 2,
    make: lift(v => roundTo(toNumber(v[0]), v.length > 1 ? toNumber(v[1]) : 0)),
  },
  floor: { min: 1, max: 1, make: lift(v => Math.floor(toNumber(v[0]))) },
  ceil: { min: 1, max: 1, make: lift(v => Math.ceil(toNumber(v[0]))) },
  abs: { min: 1, max: 1, make: lift(v => Math.abs(toNumber(v[0]))) },
  min: { min: 1, max: 99, make: lift(v => Math.min(...v.map(toNumber))) },
  max: { min: 1, max: 99, make: lift(v => Math.max(...v.map(toNumber))) },
  // text functions read NULL as an empty text
  concat: {
    min: 0,
    max: 99,
    make: args => (row, i, env) => {
      let text = '';
      for (let k = 0; k < args.length; k += 1) text += toText(args[k](row, i, env));
      return text;
    },
  },
  upper: { min: 1, max: 1, make: lift(v => toText(v[0]).toUpperCase()) },
  lower: { min: 1, max: 1, make: lift(v => toText(v[0]).toLowerCase()) },
  // start is 1-based like SQL SUBSTR
  substr: {
    min: 2,
    max: 3,
    make: lift((v) => {
      const start = Math.max(1, Math.trunc(toNumber(v[1]))) - 1;
      const text = toText(v[0]);
      const end = v.length < 3 ? undefined : start + Math.max(0, Math.trunc(toNumber(v[2])));
      const chars = charsOf(text);
      return chars ? chars.slice(start, end).join('') : text.slice(start, end);
    }),
  },
  len: {
    min: 1,
    max: 1,
    make: args => (row, i, env) => {
      const text = toText(args[0](row, i, env));
      return (charsOf(text) || text).length;
    },
  },
  // left pad to n characters, default pad character 0
  pad: {
    min: 2,
    max: 3,
    make: lift((v) => {
      const width = Math.max(0, Math.min(MAX_PAD, Math.trunc(toNumber(v[1]))));
      const fill = v.length > 2 && toText(v[2]) !== '' ? toText(v[2]) : '0';
      const text = toText(v[0]);
      const chars = charsOf(text + fill);
      if (!chars) return text.padStart(width, fill);
      const lead = Array.from(fill);
      let out = '';
      for (let k = 0; k < width - Array.from(text).length; k += 1) {
        out += lead[k % lead.length];
      }
      return out + text;
    }),
  },
  // only the chosen branch is evaluated
  if: {
    min: 3,
    max: 3,
    make: args => (row, i, env) => (
      truthy(args[0](row, i, env)) ? args[1](row, i, env) : args[2](row, i, env)),
  },
  and: {
    min: 2,
    max: 99,
    make: args => (row, i, env) => args.every(a => truthy(a(row, i, env))),
  },
  or: {
    min: 2,
    max: 99,
    make: args => (row, i, env) => args.some(a => truthy(a(row, i, env))),
  },
  not: { min: 1, max: 1, make: args => (row, i, env) => !truthy(args[0](row, i, env)) },
  adddays: {
    min: 2,
    max: 2,
    make: lift((v) => {
      const d = dateOf(v[0]);
      return formatLike(d, d.ms + Math.round(toNumber(v[1]) * DAY_MS));
    }),
  },
  addmonths: {
    min: 2,
    max: 2,
    make: lift((v) => {
      const d = dateOf(v[0]);
      return formatLike(d, addMonths(d.ms, toNumber(v[1])));
    }),
  },
  // the result always carries a time
  addhours: {
    min: 2,
    max: 2,
    make: lift(v => formatDateTime(inRange(
      dateOf(v[0]).ms + Math.round(toNumber(v[1]) * HOUR_MS)))),
  },
  today: { min: 0, max: 0, make: () => (row, i, env) => formatDate(naiveNow(env.now)) },
  now: { min: 0, max: 0, make: () => (row, i, env) => formatDateTime(naiveNow(env.now)) },
  seq: { min: 0, max: 0, make: () => (row, i) => i + 1 },
};

// names as written in formulas, for the UI
export const EXPR_FUNCTIONS = [
  'rand', 'round', 'floor', 'ceil', 'abs', 'min', 'max', 'concat', 'upper', 'lower', 'substr',
  'len', 'pad', 'if', 'and', 'or', 'not', 'addDays', 'addMonths', 'addHours', 'today', 'now',
  'seq',
];

const CONSTANTS = { true: true, false: false, null: null };

const arithmetic = (op, a, b) => (row, i, env) => {
  const x = a(row, i, env);
  const y = b(row, i, env);
  if (x === null || y === null) return null;
  const m = toNumber(x);
  const n = toNumber(y);
  if (op === '+') return m + n;
  if (op === '-') return m - n;
  if (op === '*') return m * n;
  if (n === 0) return null; // division by zero gives NULL
  return op === '/' ? m / n : m % n;
};

const comparison = (op, a, b) => (row, i, env) => {
  const x = a(row, i, env);
  const y = b(row, i, env);
  if (x === null || y === null) {
    if (op === '=' || op === '==') return x === y;
    return op === '<>' || op === '!=' ? x !== y : false;
  }
  const c = compare(x, y);
  switch (op) {
    case '=':
    case '==': return c === 0;
    case '<>':
    case '!=': return c !== 0;
    case '<': return c < 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    default: return c >= 0;
  }
};

// ---- parser ---------------------------------------------------------------
const COMPARE_OPS = ['=', '==', '<>', '!=', '<', '<=', '>', '>='];

// text -> {columns: [defKey], run(row, rowIndex, env) -> value}; env = {random, now}.
// resolve(name) gives the real name of the column written as [name] (the caller knows the
// columns of the table and may throw for an unknown one); without it names are taken as
// written.
export const compileExpr = (source, resolve) => {
  if (typeof source !== 'string' || source.trim() === '') {
    throw exprError('expr.empty', 0);
  }
  if (source.length > MAX_LENGTH) {
    throw exprError('expr.tooLong', MAX_LENGTH);
  }
  const tokens = tokenize(source);
  const columns = [];
  let index = 0;
  let depth = 0;
  const peek = () => tokens[index];
  const take = () => {
    index += 1;
    return tokens[index - 1];
  };
  const isOp = (token, ops) => token.type === 'op' && ops.includes(token.value);
  const unexpected = token => (token.type === 'end'
    ? exprError('expr.end', token.pos) : exprError('expr.unexpected', token.pos, token.value));
  const binary = (operand, ops, build) => () => {
    let left = operand();
    while (isOp(peek(), ops)) {
      left = build(take().value, left, operand());
    }
    return left;
  };
  let expression;
  const call = (name) => {
    const key = name.value.toLowerCase();
    const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, key) ? FUNCTIONS[key] : null;
    if (!fn) {
      throw exprError('expr.function.unknown', name.pos, name.value);
    }
    take(); // (
    const args = [];
    if (peek().type !== ')') {
      do {
        args.push(expression());
      } while (peek().type === ',' && take());
    }
    if (peek().type !== ')') {
      throw peek().type === 'end' ? exprError('expr.paren', peek().pos) : unexpected(peek());
    }
    take();
    if (args.length < fn.min || args.length > fn.max) {
      throw exprError('expr.function.args', name.pos, name.value);
    }
    return fn.make(args);
  };
  const primary = () => {
    const token = take();
    if (token.type === 'num' || token.type === 'str') {
      const { value } = token;
      return () => value;
    }
    if (token.type === 'col') {
      const key = resolve ? resolve(token.value) : token.value;
      if (!columns.includes(key)) columns.push(key);
      return (row) => {
        // own values only: [constructor] must not reach Object.prototype
        const v = Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
        return v === undefined ? null : v;
      };
    }
    if (token.type === 'id') {
      if (peek().type === '(') return call(token);
      const word = token.value.toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(CONSTANTS, word)) {
        throw exprError('expr.unexpected', token.pos, token.value);
      }
      const value = CONSTANTS[word];
      return () => value;
    }
    if (token.type === '(') {
      const inner = expression();
      if (peek().type !== ')') {
        throw peek().type === 'end' ? exprError('expr.paren', token.pos) : unexpected(peek());
      }
      take();
      return inner;
    }
    index -= 1;
    throw unexpected(token);
  };
  const unary = () => {
    if (isOp(peek(), ['-', '+'])) {
      const negative = take().value === '-';
      depth += 1;
      if (depth > MAX_DEPTH) throw exprError('expr.tooDeep', peek().pos);
      const operand = unary();
      depth -= 1;
      return (row, i, env) => {
        const v = operand(row, i, env);
        if (v === null) return null;
        return negative ? -toNumber(v) : toNumber(v);
      };
    }
    return primary();
  };
  const product = binary(unary, ['*', '/', '%'], arithmetic);
  const sum = binary(product, ['+', '-'], arithmetic);
  const joined = binary(sum, ['&'], (op, a, b) => (row, i, env) => (
    toText(a(row, i, env)) + toText(b(row, i, env))));
  const compared = binary(joined, COMPARE_OPS, comparison);
  expression = () => {
    depth += 1;
    if (depth > MAX_DEPTH) throw exprError('expr.tooDeep', peek().pos);
    const result = compared();
    depth -= 1;
    return result;
  };
  const run = expression();
  if (peek().type !== 'end') {
    throw unexpected(peek());
  }
  return {
    columns,
    run,
  };
};

// null when the formula parses, otherwise {code, pos, message}
export const checkExpr = (source) => {
  try {
    compileExpr(source);
    return null;
  } catch (e) {
    return {
      code: e.code || 'expr.invalid',
      pos: e.pos === undefined ? 0 : e.pos,
      message: e.message,
    };
  }
};

// columns a formula reads; a formula that does not parse reads none
export const exprColumns = (source) => {
  try {
    return compileExpr(source).columns;
  } catch (e) {
    return [];
  }
};
