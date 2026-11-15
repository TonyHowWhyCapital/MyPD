// Test data rules stored in a project: reading, immutable updates, validation,
// import and export. Nothing here mutates its input.
import '../Math';
import { checkExpr } from './expr';
import { maskProblem, resolveDateSpec, naiveNow, CHARSETS } from './pattern';

// kinds a user can choose; `foreign` is internal (set by the planner for FK columns)
export const RULE_KINDS = [
  'auto', 'sequence', 'number', 'date', 'text', 'list', 'pattern', 'dict', 'builtin', 'file',
  'query', 'expr', 'constant',
];

export const BUILTIN_NAMES = [
  'tw.name', 'tw.surname', 'tw.givenName', 'tw.mobile', 'tw.phone', 'tw.address', 'tw.city',
  'tw.district', 'tw.zip', 'tw.company', 'tw.taxId', 'tw.nationalId', 'en.name',
  'en.firstName', 'en.lastName', 'en.company', 'email', 'username', 'url', 'ipv4', 'uuid',
  'boolean', 'color',
];

export const DEFAULT_ROWS = 100;
export const MAX_ROWS = 1000000;
export const EXPORT_TYPE = 'mypd.testdata.rules';
export const EXPORT_VERSION = 1;
const MAX_IMPORT_CHARS = 5000000;
const MAX_IMPORT_RULES = 2000;
const MAX_LIST_ITEMS = 10000;
const MAX_TEXT = 4000;
const MAX_NAME = 200;
const ORDERS = ['random', 'cycle'];

const DEFAULT_PARAMS = {
  auto: () => ({}),
  sequence: () => ({ start: 1, step: 1, prefix: '', suffix: '', pad: 0 }),
  number: () => ({ min: 0, max: 1000, decimals: 0 }),
  date: () => ({ from: 'now-365d', to: 'now' }),
  text: () => ({ min: 5, max: 20, charset: 'alnum' }),
  list: () => ({ items: [], order: 'random' }),
  pattern: () => ({ mask: '' }),
  dict: () => ({ use: 'key' }),
  builtin: () => ({ name: 'tw.name' }),
  file: () => ({ path: '', column: 0, header: false, order: 'random' }),
  query: () => ({ sql: '' }),
  expr: () => ({ expr: '' }),
  constant: () => ({ value: '' }),
};

// param names accepted on import, per kind
const PARAM_KEYS = {
  ...Object.keys(DEFAULT_PARAMS).reduce((all, kind) => ({
    ...all,
    [kind]: Object.keys(DEFAULT_PARAMS[kind]()),
  }), {}),
  dict: ['dict', 'use'],
};

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScalar = v => ['string', 'number', 'boolean'].includes(typeof v);
const missing = v => v === undefined || v === null || v === '';

// undefined = not given, NaN = given but not a number
export const numberOf = (v) => {
  if (missing(v)) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
};

const isInt = n => n !== undefined && Number.isInteger(n);

// ---- reading and writing --------------------------------------------------
export const getTestData = (dataSource) => {
  const raw = isObject(dataSource?.profile?.testData) ? dataSource.profile.testData : {};
  const settings = isObject(raw.settings) ? raw.settings : {};
  const seed = isObject(settings.seed) ? settings.seed : {};
  const rows = numberOf(settings.defaultRows);
  const seedValue = numberOf(seed.value);
  const domainRules = isObject(raw.domainRules) ? raw.domainRules : {};
  return {
    rules: (Array.isArray(raw.rules) ? raw.rules : [])
      .filter(r => isObject(r) && typeof r.id === 'string' && r.id !== ''),
    domainRules: Object.keys(domainRules).reduce((all, domainId) => {
      const ruleId = domainRules[domainId];
      return typeof ruleId === 'string' && ruleId ? { ...all, [domainId]: ruleId } : all;
    }, {}),
    settings: {
      ...settings,
      defaultRows: isInt(rows) && rows >= 1 ? Math.min(rows, MAX_ROWS) : DEFAULT_ROWS,
      seed: {
        fixed: seed.fixed !== false,
        value: seedValue === undefined || Number.isNaN(seedValue) ? 1 : seedValue,
      },
      tables: isObject(settings.tables) ? { ...settings.tables } : {},
    },
  };
};

export const setTestData = (dataSource, testData) => ({
  ...dataSource,
  profile: {
    ...(dataSource?.profile || {}),
    testData,
  },
});

export const newRule = (kind = 'auto') => ({
  id: Math.uuid(),
  name: '',
  kind,
  params: DEFAULT_PARAMS[kind] ? DEFAULT_PARAMS[kind]() : {},
});

// ---- validation -----------------------------------------------------------
const checkRange = (params, kind, problems, whole) => {
  const min = numberOf(params.min);
  const max = numberOf(params.max);
  const bad = n => Number.isNaN(n) || (whole && n !== undefined && (!isInt(n) || n < 0));
  if (bad(min)) problems.push(`${kind}.min.invalid`);
  if (bad(max)) problems.push(`${kind}.max.invalid`);
  if (!bad(min) && !bad(max) && min !== undefined && max !== undefined && min > max) {
    problems.push(`${kind}.range`);
  }
};

// leading blanks and comments removed
const sqlHead = sql => sql.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, '').slice(0, 10);

const PARAM_CHECKS = {
  auto: () => {},
  sequence: (p, problems) => {
    if (Number.isNaN(numberOf(p.start))) problems.push('sequence.start.invalid');
    const step = numberOf(p.step);
    if (Number.isNaN(step) || step === 0) problems.push('sequence.step.invalid');
    const pad = numberOf(p.pad);
    if (pad !== undefined && (!isInt(pad) || pad < 0 || pad > 50)) {
      problems.push('sequence.pad.invalid');
    }
  },
  number: (p, problems) => {
    checkRange(p, 'number', problems, false);
    const decimals = numberOf(p.decimals);
    if (decimals !== undefined && (!isInt(decimals) || decimals < 0 || decimals > 10)) {
      problems.push('number.decimals.invalid');
    }
  },
  date: (p, problems, opts) => {
    const now = naiveNow(opts.now);
    const from = missing(p.from) ? undefined : resolveDateSpec(p.from, now);
    const to = missing(p.to) ? undefined : resolveDateSpec(p.to, now);
    if (from === null) problems.push('date.from.invalid');
    if (to === null) problems.push('date.to.invalid');
    if (from && to && from.ms > to.ms) problems.push('date.range');
  },
  text: (p, problems) => {
    checkRange(p, 'text', problems, true);
    if (!missing(p.charset) && !Object.prototype.hasOwnProperty.call(CHARSETS, p.charset)) {
      problems.push('text.charset.unknown');
    }
  },
  list: (p, problems) => {
    const items = Array.isArray(p.items) ? p.items : [];
    const weights = items.map(item => (isObject(item) ? numberOf(item.weight) : undefined));
    if (weights.some(w => Number.isNaN(w) || w < 0)) {
      problems.push('list.weight.invalid');
    } else if (!weights.some(w => w === undefined || w > 0)) {
      problems.push('list.items.empty'); // also when every weight is 0
    }
    if (!missing(p.order) && !ORDERS.includes(p.order)) problems.push('list.order.unknown');
  },
  pattern: (p, problems) => {
    const problem = maskProblem(p.mask);
    if (problem) problems.push(problem);
  },
  dict: (p, problems) => {
    if (!missing(p.use) && !['key', 'name'].includes(p.use)) problems.push('dict.use.unknown');
  },
  builtin: (p, problems) => {
    if (!BUILTIN_NAMES.includes(p.name)) problems.push('builtin.name.unknown');
  },
  file: (p, problems) => {
    if (typeof p.path !== 'string' || p.path.trim() === '') problems.push('file.path.empty');
    const column = numberOf(p.column);
    if (column !== undefined && (!isInt(column) || column < 0)) {
      problems.push('file.column.invalid');
    }
    if (!missing(p.order) && !ORDERS.includes(p.order)) problems.push('file.order.unknown');
  },
  query: (p, problems) => {
    if (typeof p.sql !== 'string' || p.sql.trim() === '') {
      problems.push('query.sql.empty');
    } else if (!/^(select|with)\b/i.test(sqlHead(p.sql))) {
      problems.push('query.sql.notSelect');
    }
  },
  expr: (p, problems) => {
    const problem = checkExpr(p.expr);
    if (problem) problems.push(problem.code);
  },
  constant: (p, problems) => {
    if (p.value === undefined || p.value === null) problems.push('constant.value.missing');
  },
  foreign: () => {},
};

// [] = valid. opts.library also requires an id, a name and a user-selectable kind;
// opts.now (Date) is the clock relative dates are compared with.
export const validateRule = (rule, opts = {}) => {
  if (!isObject(rule)) return ['rule.invalid'];
  if (!Object.prototype.hasOwnProperty.call(PARAM_CHECKS, rule.kind)) {
    return ['rule.kind.unknown'];
  }
  const problems = [];
  if (opts.library) {
    if (typeof rule.id !== 'string' || rule.id === '') problems.push('rule.id.missing');
    if (typeof rule.name !== 'string' || rule.name.trim() === '') {
      problems.push('rule.name.empty');
    }
    if (!RULE_KINDS.includes(rule.kind)) problems.push('rule.kind.internal');
  }
  const nullRate = numberOf(rule.nullRate);
  if (nullRate !== undefined && !(nullRate >= 0 && nullRate <= 100)) {
    problems.push('rule.nullRate.range');
  }
  if (rule.params !== undefined && rule.params !== null && !isObject(rule.params)) {
    problems.push('rule.params.invalid');
    return problems;
  }
  PARAM_CHECKS[rule.kind](rule.params || {}, problems, opts);
  return problems;
};

// ---- library updates ------------------------------------------------------
export const upsertRule = (td, rule) => {
  const rules = td?.rules || [];
  const exists = rules.some(r => r.id === rule.id);
  return {
    ...td,
    rules: exists ? rules.map(r => (r.id === rule.id ? rule : r)) : rules.concat(rule),
  };
};

export const removeRule = (td, ruleId) => {
  const domainRules = td?.domainRules || {};
  return {
    ...td,
    rules: (td?.rules || []).filter(r => r.id !== ruleId),
    domainRules: Object.keys(domainRules).reduce((all, domainId) => (
      domainRules[domainId] === ruleId ? all : { ...all, [domainId]: domainRules[domainId] }
    ), {}),
  };
};

export const setDomainRule = (td, domainId, ruleId) => {
  const { [domainId]: removed, ...others } = td?.domainRules || {};
  return {
    ...td,
    domainRules: ruleId ? { ...others, [domainId]: ruleId } : others,
  };
};

// value = {rule, nullRate} | null; an empty value removes `field.testData`
export const setFieldRule = (dataSource, entityId, fieldId, value) => {
  const next = {};
  if (isObject(value)) {
    if (typeof value.rule === 'string' && value.rule) next.rule = value.rule;
    const nullRate = numberOf(value.nullRate);
    if (nullRate !== undefined && !Number.isNaN(nullRate)) {
      next.nullRate = Math.max(0, Math.min(100, nullRate));
    }
  }
  const apply = (field) => {
    const { testData, ...rest } = field;
    return Object.keys(next).length > 0 ? { ...rest, testData: next } : rest;
  };
  return {
    ...dataSource,
    entities: (dataSource?.entities || []).map(entity => (entity.id !== entityId ? entity : {
      ...entity,
      fields: (entity.fields || []).map(f => (f.id === fieldId ? apply(f) : f)),
    })),
  };
};

export const ruleUsage = (dataSource, ruleId) => {
  const fields = [];
  (dataSource?.entities || []).forEach((entity) => {
    (entity.fields || []).forEach((f) => {
      if (f.testData && f.testData.rule === ruleId) {
        fields.push({ entityId: entity.id, fieldId: f.id });
      }
    });
  });
  const { domainRules } = getTestData(dataSource);
  return {
    fields,
    domains: Object.keys(domainRules).filter(domainId => domainRules[domainId] === ruleId),
  };
};

// ---- sharing --------------------------------------------------------------
export const exportRules = rules => JSON.stringify({
  type: EXPORT_TYPE,
  version: EXPORT_VERSION,
  rules: rules || [],
}, null, 2);

const cleanText = v => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : undefined);

const cleanItems = items => (Array.isArray(items) ? items.slice(0, MAX_LIST_ITEMS) : [])
  .map(item => (isObject(item) ? item : { value: item }))
  .filter(item => isScalar(item.value))
  .map(item => ({
    value: typeof item.value === 'string' ? item.value.slice(0, MAX_TEXT) : item.value,
    weight: isScalar(item.weight) ? item.weight : 1,
  }));

// keeps only known param names with plain values
const cleanParams = (kind, params) => PARAM_KEYS[kind].reduce((all, key) => {
  if (!Object.prototype.hasOwnProperty.call(params, key)) return all;
  const value = params[key];
  if (key === 'items') return { ...all, items: cleanItems(value) };
  if (!isScalar(value)) return all;
  return { ...all, [key]: typeof value === 'string' ? cleanText(value) : value };
}, {});

// text is untrusted: never throws, everything unusable is reported in `problems`
// as {code, index?, name?, detail?}. Imported rules always get fresh ids.
export const importRules = (text) => {
  const fail = code => ({ rules: [], problems: [{ code }] });
  if (typeof text !== 'string' || text.trim() === '') return fail('import.empty');
  if (text.length > MAX_IMPORT_CHARS) return fail('import.tooLarge');
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return fail('import.json');
  }
  const list = Array.isArray(data) ? data : data?.rules;
  if (!Array.isArray(list) || (!Array.isArray(data) && data.type !== EXPORT_TYPE)) {
    return fail('import.format');
  }
  if (!Array.isArray(data) && !(data.version >= 1 && data.version <= EXPORT_VERSION)) {
    return fail('import.version');
  }
  const problems = [];
  if (list.length > MAX_IMPORT_RULES) problems.push({ code: 'import.tooMany' });
  const rules = [];
  list.slice(0, MAX_IMPORT_RULES).forEach((raw, index) => {
    const name = isObject(raw) && typeof raw.name === 'string'
      ? raw.name.trim().slice(0, MAX_NAME) : '';
    if (!isObject(raw) || !RULE_KINDS.includes(raw.kind)) {
      problems.push({ code: 'import.rule.kind', index, name });
      return;
    }
    if (!name) {
      problems.push({ code: 'import.rule.name', index, name });
      return;
    }
    const rule = {
      id: Math.uuid(),
      name,
      kind: raw.kind,
      params: cleanParams(raw.kind, isObject(raw.params) ? raw.params : {}),
    };
    if (isScalar(raw.nullRate)) rule.nullRate = raw.nullRate;
    if (typeof raw.unique === 'boolean') rule.unique = raw.unique;
    if (typeof raw.note === 'string') rule.note = raw.note.slice(0, MAX_TEXT);
    const detail = validateRule(rule);
    if (detail.length > 0) {
      problems.push({ code: 'import.rule.invalid', index, name, detail });
      return;
    }
    rules.push(rule);
  });
  return { rules, problems };
};

// copies with fresh ids; a name already used by `existing` or by an earlier
// copy gets a numbered suffix: `Name (2)`
export const copyRules = (rules, existing = []) => {
  const used = Object.create(null);
  (existing || []).forEach((r) => {
    used[r.name] = true;
  });
  return (rules || []).map((rule) => {
    const base = rule.name || rule.kind || '';
    let name = base;
    for (let n = 2; used[name]; n += 1) {
      name = `${base} (${n})`;
    }
    used[name] = true;
    return {
      ...JSON.parse(JSON.stringify(rule)),
      id: Math.uuid(),
      name,
    };
  });
};
