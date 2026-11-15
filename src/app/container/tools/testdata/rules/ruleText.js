// Texts of the test data rules: what a rule does in a few words, and the message of a
// problem code. Pure: `tr(id, data)` gives the text of `testDataRule.<id>` in the language
// in use, so the same code runs in the app and in the tests.
import { numberOf, BUILTIN_NAMES } from '../../../../../lib/testdata/model';

const MAX_TEXT = 40;
const LIST_SHOWN = 3;

export const KIND_ICONS = {
  auto: 'fa-magic',
  sequence: 'fa-sort-numeric-asc',
  number: 'fa-hashtag',
  date: 'fa-calendar',
  text: 'fa-font',
  list: 'fa-list-ul',
  pattern: 'fa-th',
  dict: 'fa-book',
  builtin: 'fa-user',
  file: 'fa-file-text-o',
  query: 'fa-database',
  expr: 'fa-calculator',
  constant: 'fa-thumb-tack',
};

export const BUILTIN_GROUPS = [
  { key: 'tw', names: BUILTIN_NAMES.filter(n => n.startsWith('tw.')) },
  { key: 'en', names: BUILTIN_NAMES.filter(n => n.startsWith('en.')) },
  { key: 'common', names: BUILTIN_NAMES.filter(n => !n.includes('.')) },
];

// how each function of a formula is written, and a call that can be tried as it is
export const EXPR_SIGNATURES = {
  rand: ['rand(min, max)', 'rand(1, 100)'],
  round: ['round(x, n)', 'round(3.14159, 2)'],
  floor: ['floor(x)', 'floor(3.7)'],
  ceil: ['ceil(x)', 'ceil(3.2)'],
  abs: ['abs(x)', 'abs(-5)'],
  min: ['min(a, b, …)', 'min(3, 8)'],
  max: ['max(a, b, …)', 'max(3, 8)'],
  concat: ['concat(a, b, …)', 'concat(\'NO-\', seq())'],
  upper: ['upper(s)', 'upper(\'abc\')'],
  lower: ['lower(s)', 'lower(\'ABC\')'],
  substr: ['substr(s, start, len)', 'substr(\'ABCDEF\', 2, 3)'],
  len: ['len(s)', 'len(\'ABC\')'],
  pad: ['pad(s, n, ch)', 'pad(seq(), 6, \'0\')'],
  if: ['if(cond, a, b)', 'if(rand(1, 10) > 5, \'Y\', \'N\')'],
  and: ['and(a, b, …)', 'and(1 < 2, 2 < 3)'],
  or: ['or(a, b, …)', 'or(1 > 2, 2 < 3)'],
  not: ['not(x)', 'not(1 > 2)'],
  addDays: ['addDays(d, n)', 'addDays(today(), 7)'],
  addMonths: ['addMonths(d, n)', 'addMonths(today(), 1)'],
  addHours: ['addHours(d, n)', 'addHours(now(), 8)'],
  today: ['today()', 'today()'],
  now: ['now()', 'now()'],
  seq: ['seq()', 'seq()'],
};

// `sequence.start.invalid` -> the key under `testDataRule.problem`
export const problemKey = code => `${code}`.replace(/\./g, '_');

const cut = (text, max = MAX_TEXT) => {
  const s = `${text === undefined || text === null ? '' : text}`.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const has = v => v !== undefined && v !== null && v !== '';

// what the engine adds to a code, without its own shorthand: "datetime: abc" -> "abc"
export const plainDetail = (code, detail) => (code === 'value.type' && typeof detail === 'string'
  ? detail.replace(/^(int|decimal|string|date|datetime|time|bool|binary): /, '') : detail);

// extra: {detail, pos}; `pos` is the 0-based place in a formula
export const problemText = (tr, code, extra = {}) => {
  const key = `problem.${problemKey(code)}`;
  let text = tr(key);
  if (!text || text === key) {
    text = tr('problem.unknown', { code });
  }
  if (extra.pos !== undefined && extra.pos !== null && `${code}`.startsWith('expr.')) {
    text += tr('problemAt', { pos: extra.pos + 1 });
  }
  const detail = plainDetail(code, extra.detail);
  if (has(detail) && typeof detail !== 'object') {
    text += tr('problemDetail', { detail: cut(detail, 60) });
  }
  return text;
};

// an Error of the engine (stable `code`) as a message; anything else as it is
export const errorText = (tr, error) => {
  if (error && error.code) {
    return problemText(tr, error.code, {
      // the engine repeats the list of codes as the detail of a validation failure
      detail: `${error.detail || ''}`.split(',')[0] === error.code ? undefined : error.detail,
      pos: error.pos,
    });
  }
  return (error && error.message) || `${error}`;
};

// `now-365d` -> "365 days ago"; a plain date stays as written
export const dateSpecText = (tr, spec) => {
  const text = `${has(spec) ? spec : ''}`.trim();
  const found = /^now(?:\s*([+-])\s*(\d{1,6})\s*([dhMy]))?$/.exec(text);
  if (!found) {
    return text;
  }
  if (!found[1] || Number(found[2]) === 0) {
    return tr('summary.now');
  }
  return tr(`summary.${found[1] === '-' ? 'ago' : 'later'}`, {
    n: Number(found[2]),
    unit: tr(`unit.${found[3]}`),
  });
};

const sequenceValue = (p, index) => {
  const start = numberOf(p.start);
  const step = numberOf(p.step);
  const pad = numberOf(p.pad);
  const n = (Number.isFinite(start) ? start : 1) + (Number.isFinite(step) ? step : 1) * index;
  const width = Number.isFinite(pad) && pad > 0 ? Math.min(pad, 50) : 0;
  const body = n < 0 ? `-${String(-n).padStart(width, '0')}` : String(n).padStart(width, '0');
  return `${has(p.prefix) ? p.prefix : ''}${body}${has(p.suffix) ? p.suffix : ''}`;
};

const baseName = path => `${path || ''}`.split(/[\\/]/).pop();

const SUMMARY = {
  auto: tr => tr('summary.auto'),
  sequence: (tr, p) => tr('summary.sequence', {
    first: sequenceValue(p, 0),
    second: sequenceValue(p, 1),
  }),
  number: (tr, p) => {
    const decimals = numberOf(p.decimals);
    const range = tr('summary.range', {
      min: has(p.min) ? p.min : 0,
      max: has(p.max) ? p.max : tr('summary.columnMax'),
    });
    return decimals > 0 ? tr('summary.numberDecimals', { range, decimals })
      : tr('summary.numberWhole', { range });
  },
  date: (tr, p) => tr('summary.range', {
    min: dateSpecText(tr, has(p.from) ? p.from : 'now-365d'),
    max: dateSpecText(tr, has(p.to) ? p.to : 'now'),
  }),
  text: (tr, p) => tr('summary.text', {
    range: has(p.min) && has(p.max) && `${p.min}` === `${p.max}` ? `${p.min}`
      : tr('summary.range', {
        min: has(p.min) ? p.min : 5,
        max: has(p.max) ? p.max : tr('summary.columnMax'),
      }),
    charset: tr(`charset.${p.charset || 'alnum'}`),
  }),
  list: (tr, p) => {
    const items = (Array.isArray(p.items) ? p.items : [])
      .map(item => (item !== null && typeof item === 'object' ? item : { value: item }));
    if (items.length === 0) {
      return tr('summary.listEmpty');
    }
    const weighted = items.some(item => has(item.weight) && Number(item.weight) !== 1);
    const shown = items.slice(0, LIST_SHOWN).map(item => cut(item.value, 12)).join(tr('summary.sep'));
    const parts = [items.length > LIST_SHOWN
      ? tr('summary.listMore', { values: shown, count: items.length }) : shown];
    if (weighted) {
      parts.push(tr('summary.weighted'));
    }
    if (p.order === 'cycle') {
      parts.push(tr('order.cycle'));
    }
    return parts.join(tr('summary.comma'));
  },
  pattern: (tr, p) => (has(p.mask) ? cut(p.mask) : tr('summary.notSet')),
  dict: (tr, p, ctx) => {
    const dict = has(p.dict)
      ? (ctx.dicts || []).find(d => d.id === p.dict || d.defKey === p.dict) : null;
    let name = tr('summary.dictOfColumn');
    if (has(p.dict)) {
      name = dict ? (dict.defName || dict.defKey) : tr('summary.dictGone');
    }
    return tr('summary.dict', {
      name,
      use: tr(`dictUse.${p.use === 'name' ? 'name' : 'key'}`),
    });
  },
  builtin: (tr, p) => (BUILTIN_NAMES.includes(p.name) ? tr(`builtin.${problemKey(p.name)}`)
    : tr('summary.notSet')),
  file: (tr, p) => (has(p.path) ? tr('summary.file', {
    name: cut(baseName(p.path), 28),
    column: (Number.isFinite(numberOf(p.column)) ? numberOf(p.column) : 0) + 1,
  }) : tr('summary.notSet')),
  query: (tr, p) => (has(p.sql) ? cut(p.sql) : tr('summary.notSet')),
  expr: (tr, p) => (has(p.expr) ? cut(p.expr) : tr('summary.notSet')),
  constant: (tr, p) => (has(p.value) ? tr('summary.constant', { value: cut(p.value, 30) })
    : tr('summary.constantEmpty')),
};

// one line saying what the rule produces; ctx = {dicts} of the project
export const ruleSummary = (tr, rule, ctx = {}) => {
  const kind = rule && rule.kind;
  if (!Object.prototype.hasOwnProperty.call(SUMMARY, kind)) {
    return '';
  }
  const text = SUMMARY[kind](tr, (rule && rule.params) || {}, ctx);
  const rate = numberOf(rule.nullRate);
  const extras = [];
  if (rate > 0) {
    extras.push(tr('summary.nullRate', { rate }));
  }
  if (rule.unique) {
    extras.push(tr('unique'));
  }
  return extras.length > 0 ? `${text}${tr('summary.comma')}${extras.join(tr('summary.comma'))}` : text;
};

export const kindLabel = (tr, kind) => tr(`kind.${kind}`);

// where the rule of a column comes from, as shown beside its name
export const sourceLabel = (tr, source) => tr(`source.${source}`);

// what the grid shows (and exports) for a column: the name of the rule in force
export const effectiveLabel = (tr, resolved) => {
  if (!resolved || resolved.source === 'auto' || !resolved.rule) {
    return tr('auto');
  }
  const name = resolved.rule.name || kindLabel(tr, resolved.rule.kind);
  return resolved.source === 'domain' ? tr('fromDomainName', { name }) : name;
};

// "3 columns, 1 domain" / "not used"
export const usageLabel = (tr, usage) => {
  const fields = (usage && usage.fields ? usage.fields.length : 0);
  const domains = (usage && usage.domains ? usage.domains.length : 0);
  if (fields + domains === 0) {
    return tr('usage.none');
  }
  const parts = [];
  if (fields > 0) {
    parts.push(tr('usage.fields', { count: fields }));
  }
  if (domains > 0) {
    parts.push(tr('usage.domains', { count: domains }));
  }
  return parts.join(tr('summary.comma'));
};
