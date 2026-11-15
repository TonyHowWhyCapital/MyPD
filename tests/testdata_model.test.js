import {
  RULE_KINDS, BUILTIN_NAMES, getTestData, setTestData, newRule, validateRule, upsertRule,
  removeRule, setFieldRule, setDomainRule, ruleUsage, exportRules, importRules, copyRules,
} from '../src/lib/testdata/model';
import { BUILTINS } from '../src/lib/testdata/builtin';

const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.keys(value).forEach(key => freeze(value[key]));
  }
  return value;
};

const project = () => freeze({
  name: 'P',
  profile: {
    default: { db: 'mysql' },
    testData: {
      rules: [
        { id: 'r1', name: 'Order no', kind: 'sequence', params: { start: 1, prefix: 'ORD' } },
        { id: 'r2', name: 'Amount', kind: 'number', params: { min: 0, max: 99 } },
      ],
      domainRules: { d1: 'r2', d2: 'r1' },
      settings: { defaultRows: 50, seed: { fixed: false, value: 9 }, tables: { e1: { rows: 5 } } },
    },
  },
  entities: [
    {
      id: 'e1',
      defKey: 'orders',
      fields: [
        { id: 'f1', defKey: 'id', testData: { rule: 'r1' } },
        { id: 'f2', defKey: 'amount', testData: { rule: 'r2', nullRate: 10 } },
        { id: 'f3', defKey: 'note' },
      ],
    },
    { id: 'e2', defKey: 'items', fields: [{ id: 'f1', defKey: 'id', testData: { rule: 'r1' } }] },
  ],
});

describe('getTestData / setTestData', () => {
  test('defaults for a project without test data', () => {
    const expected = {
      rules: [],
      domainRules: {},
      settings: { defaultRows: 100, seed: { fixed: true, value: 1 }, tables: {} },
    };
    expect(getTestData({})).toEqual(expected);
    expect(getTestData(undefined)).toEqual(expected);
    expect(getTestData(null)).toEqual(expected);
    expect(getTestData({ profile: {} })).toEqual(expected);
    expect(getTestData({ profile: { testData: null } })).toEqual(expected);
    expect(getTestData({ profile: { testData: 'x' } })).toEqual(expected);
  });

  test('partial and damaged data is normalised', () => {
    const td = getTestData({
      profile: {
        testData: {
          rules: [null, 'x', { name: 'no id' }, { id: 'ok', kind: 'auto' }],
          domainRules: { d1: 'ok', d2: 5, d3: '' },
          settings: { defaultRows: -3, seed: 'x', tables: [], extra: 1 },
        },
      },
    });
    expect(td.rules).toEqual([{ id: 'ok', kind: 'auto' }]);
    expect(td.domainRules).toEqual({ d1: 'ok' });
    expect(td.settings).toEqual({
      defaultRows: 100, seed: { fixed: true, value: 1 }, tables: {}, extra: 1,
    });
    expect(getTestData({ profile: { testData: { rules: {}, domainRules: [] } } }).rules).toEqual([]);
    expect(getTestData({ profile: { testData: { settings: { defaultRows: 5e7 } } } })
      .settings.defaultRows).toBe(1000000);
    expect(getTestData({ profile: { testData: { settings: { seed: { value: '42' } } } } })
      .settings.seed).toEqual({ fixed: true, value: 42 });
  });

  test('stored data is read back and nothing is mutated', () => {
    const ds = project();
    const td = getTestData(ds);
    expect(td.rules.length).toBe(2);
    expect(td.settings.defaultRows).toBe(50);
    expect(td.settings.seed).toEqual({ fixed: false, value: 9 });
    expect(td.settings.tables).toEqual({ e1: { rows: 5 } });
    const next = setTestData(ds, { ...td, rules: [] });
    expect(next).not.toBe(ds);
    expect(next.profile.default).toBe(ds.profile.default);
    expect(getTestData(next).rules).toEqual([]);
    expect(getTestData(ds).rules.length).toBe(2);
    expect(getTestData(setTestData({}, td)).rules.length).toBe(2);
  });
});

describe('rules', () => {
  test('lists', () => {
    expect(RULE_KINDS).toEqual(['auto', 'sequence', 'number', 'date', 'text', 'list', 'pattern',
      'dict', 'builtin', 'file', 'query', 'expr', 'constant']);
    expect(BUILTIN_NAMES.slice().sort()).toEqual(Object.keys(BUILTINS).sort());
    expect(BUILTIN_NAMES.length).toBe(23);
  });

  test('newRule gives an id and default params for every kind', () => {
    const ids = RULE_KINDS.map((kind) => {
      const rule = newRule(kind);
      expect(rule.kind).toBe(kind);
      expect(typeof rule.id).toBe('string');
      expect(rule.id.length).toBeGreaterThan(8);
      expect(rule.params).toEqual(expect.any(Object));
      return rule.id;
    });
    expect(new Set(ids).size).toBe(RULE_KINDS.length);
    expect(newRule('sequence').params).toEqual({ start: 1, step: 1, prefix: '', suffix: '', pad: 0 });
    expect(newRule('list').params.items).not.toBe(newRule('list').params.items);
    expect(newRule().kind).toBe('auto');
    ['auto', 'sequence', 'number', 'date', 'text', 'dict', 'builtin', 'constant']
      .forEach(kind => expect(validateRule(newRule(kind))).toEqual([]));
  });

  test('validateRule: shape, kind, null rate', () => {
    expect(validateRule(null)).toEqual(['rule.invalid']);
    expect(validateRule('x')).toEqual(['rule.invalid']);
    expect(validateRule([])).toEqual(['rule.invalid']);
    expect(validateRule({ kind: 'nope' })).toEqual(['rule.kind.unknown']);
    expect(validateRule({ kind: 'constructor' })).toEqual(['rule.kind.unknown']);
    expect(validateRule({ kind: 'auto' })).toEqual([]);
    expect(validateRule({ kind: 'foreign' })).toEqual([]);
    expect(validateRule({ kind: 'auto', params: null })).toEqual([]);
    expect(validateRule({ kind: 'auto', params: 'x' })).toEqual(['rule.params.invalid']);
    expect(validateRule({ kind: 'auto', nullRate: 101 })).toEqual(['rule.nullRate.range']);
    expect(validateRule({ kind: 'auto', nullRate: -1 })).toEqual(['rule.nullRate.range']);
    expect(validateRule({ kind: 'auto', nullRate: 'x' })).toEqual(['rule.nullRate.range']);
    expect(validateRule({ kind: 'auto', nullRate: 100 })).toEqual([]);
    expect(validateRule({ kind: 'auto' }, { library: true }))
      .toEqual(['rule.id.missing', 'rule.name.empty']);
    expect(validateRule({ id: 'a', name: 'n', kind: 'foreign' }, { library: true }))
      .toEqual(['rule.kind.internal']);
    expect(validateRule({ id: 'a', name: 'n', kind: 'auto' }, { library: true })).toEqual([]);
  });

  test('validateRule: params of each kind', () => {
    const check = (kind, params) => validateRule({ kind, params });
    expect(check('sequence', { start: 'x', step: 0, pad: -1 }))
      .toEqual(['sequence.start.invalid', 'sequence.step.invalid', 'sequence.pad.invalid']);
    expect(check('sequence', {})).toEqual([]);
    expect(check('sequence', { start: '10', step: -5, pad: 6 })).toEqual([]);
    expect(check('number', { min: 5, max: 1 })).toEqual(['number.range']);
    expect(check('number', { min: 'a', max: {}, decimals: 2.5 }))
      .toEqual(['number.min.invalid', 'number.max.invalid', 'number.decimals.invalid']);
    expect(check('number', { min: -5.5, max: '7' })).toEqual([]);
    expect(check('number', {})).toEqual([]);
    expect(check('date', { from: '2026-01-01', to: '2025-01-01' })).toEqual(['date.range']);
    expect(check('date', { from: 'yesterday', to: '2026-02-30' }))
      .toEqual(['date.from.invalid', 'date.to.invalid']);
    expect(check('date', { from: 'now', to: 'now-1d' })).toEqual(['date.range']);
    expect(check('date', { from: 'now-30d', to: 'now+30d' })).toEqual([]);
    expect(check('date', {})).toEqual([]);
    expect(check('text', { min: 9, max: 3 })).toEqual(['text.range']);
    expect(check('text', { min: -1, max: 2.5, charset: 'emoji' }))
      .toEqual(['text.min.invalid', 'text.max.invalid', 'text.charset.unknown']);
    expect(check('text', { charset: 'toString' })).toEqual(['text.charset.unknown']);
    expect(check('text', { min: 1, max: 8, charset: 'zh' })).toEqual([]);
    expect(check('list', {})).toEqual(['list.items.empty']);
    expect(check('list', { items: [] })).toEqual(['list.items.empty']);
    expect(check('list', { items: [{ value: 'a', weight: 0 }] })).toEqual(['list.items.empty']);
    expect(check('list', { items: [{ value: 'a', weight: -1 }] })).toEqual(['list.weight.invalid']);
    expect(check('list', { items: [{ value: 'a' }], order: 'up' })).toEqual(['list.order.unknown']);
    expect(check('list', { items: ['a', { value: 'b', weight: 3 }], order: 'cycle' })).toEqual([]);
    expect(check('pattern', {})).toEqual(['pattern.mask.empty']);
    expect(check('pattern', { mask: 'A\\' })).toEqual(['pattern.mask.escape']);
    expect(check('pattern', { mask: 'A-###' })).toEqual([]);
    expect(check('dict', { use: 'both' })).toEqual(['dict.use.unknown']);
    expect(check('dict', {})).toEqual([]);
    expect(check('builtin', {})).toEqual(['builtin.name.unknown']);
    expect(check('builtin', { name: 'tw.unknown' })).toEqual(['builtin.name.unknown']);
    BUILTIN_NAMES.forEach(name => expect(check('builtin', { name })).toEqual([]));
    expect(check('file', { column: -1, order: 'x' }))
      .toEqual(['file.path.empty', 'file.column.invalid', 'file.order.unknown']);
    expect(check('file', { path: '/tmp/a.csv', column: 2, header: true })).toEqual([]);
    expect(check('query', {})).toEqual(['query.sql.empty']);
    expect(check('query', { sql: 'delete from t' })).toEqual(['query.sql.notSelect']);
    expect(check('query', { sql: 'selection' })).toEqual(['query.sql.notSelect']);
    expect(check('query', { sql: '  -- names\n SELECT name FROM t' })).toEqual([]);
    expect(check('query', { sql: '/* x */ with a as (select 1) select * from a' })).toEqual([]);
    expect(check('expr', {})).toEqual(['expr.empty']);
    expect(check('expr', { expr: '1 +' })).toEqual(['expr.end']);
    expect(check('expr', { expr: '[A] * 2' })).toEqual([]);
    expect(check('constant', {})).toEqual(['constant.value.missing']);
    expect(check('constant', { value: null })).toEqual(['constant.value.missing']);
    expect(check('constant', { value: '' })).toEqual([]);
    expect(check('constant', { value: 0 })).toEqual([]);
  });

  test('upsertRule, removeRule, setDomainRule are immutable', () => {
    const td = freeze(getTestData(project()));
    const added = upsertRule(td, { id: 'r3', name: 'New', kind: 'auto', params: {} });
    expect(added.rules.map(r => r.id)).toEqual(['r1', 'r2', 'r3']);
    const changed = upsertRule(td, { id: 'r1', name: 'Renamed', kind: 'auto', params: {} });
    expect(changed.rules.map(r => r.name)).toEqual(['Renamed', 'Amount']);
    expect(td.rules[0].name).toBe('Order no');
    const removed = removeRule(td, 'r2');
    expect(removed.rules.map(r => r.id)).toEqual(['r1']);
    expect(removed.domainRules).toEqual({ d2: 'r1' });
    expect(removed.settings).toBe(td.settings);
    expect(removeRule(td, 'missing').rules.length).toBe(2);
    expect(setDomainRule(td, 'd3', 'r1').domainRules).toEqual({ d1: 'r2', d2: 'r1', d3: 'r1' });
    expect(setDomainRule(td, 'd1', null).domainRules).toEqual({ d2: 'r1' });
    expect(setDomainRule(td, 'd1', 'r1').domainRules).toEqual({ d1: 'r1', d2: 'r1' });
    expect(td.domainRules).toEqual({ d1: 'r2', d2: 'r1' });
    expect(upsertRule({}, { id: 'a' }).rules).toEqual([{ id: 'a' }]);
    expect(removeRule({}, 'a')).toEqual({ rules: [], domainRules: {} });
  });

  test('setFieldRule', () => {
    const ds = project();
    const set = setFieldRule(ds, 'e1', 'f3', { rule: 'r2', nullRate: 25 });
    expect(set.entities[0].fields[2].testData).toEqual({ rule: 'r2', nullRate: 25 });
    expect(set.entities[1]).toBe(ds.entities[1]);
    expect(set.entities[0].fields[0]).toBe(ds.entities[0].fields[0]);
    expect(ds.entities[0].fields[2].testData).toBeUndefined();
    const cleared = setFieldRule(ds, 'e1', 'f2', null);
    expect('testData' in cleared.entities[0].fields[1]).toBe(false);
    expect(cleared.entities[0].fields[1].defKey).toBe('amount');
    expect(setFieldRule(ds, 'e1', 'f2', {}).entities[0].fields[1].testData).toBeUndefined();
    expect(setFieldRule(ds, 'e1', 'f3', { nullRate: 250 }).entities[0].fields[2].testData)
      .toEqual({ nullRate: 100 });
    expect(setFieldRule(ds, 'e1', 'f3', { rule: 'r1', nullRate: 'x' }).entities[0].fields[2]
      .testData).toEqual({ rule: 'r1' });
    // same field id in another entity is untouched
    expect(setFieldRule(ds, 'e1', 'f1', null).entities[1].fields[0].testData)
      .toEqual({ rule: 'r1' });
    expect(setFieldRule({}, 'e1', 'f1', { rule: 'r1' }).entities).toEqual([]);
  });

  test('ruleUsage', () => {
    const ds = project();
    expect(ruleUsage(ds, 'r1')).toEqual({
      fields: [{ entityId: 'e1', fieldId: 'f1' }, { entityId: 'e2', fieldId: 'f1' }],
      domains: ['d2'],
    });
    expect(ruleUsage(ds, 'r2')).toEqual({
      fields: [{ entityId: 'e1', fieldId: 'f2' }],
      domains: ['d1'],
    });
    expect(ruleUsage(ds, 'none')).toEqual({ fields: [], domains: [] });
    expect(ruleUsage({}, 'r1')).toEqual({ fields: [], domains: [] });
  });
});

describe('sharing rules', () => {
  const rules = () => [
    { id: 'a', name: 'Seq', kind: 'sequence', params: { start: 5, prefix: 'X' }, unique: true },
    {
      id: 'b',
      name: '狀態',
      kind: 'list',
      params: { items: [{ value: 'A', weight: 3 }, { value: 'B' }], order: 'cycle' },
      nullRate: 20,
      note: 'n',
    },
  ];

  test('export then import keeps the rules, with fresh ids', () => {
    const text = exportRules(rules());
    const parsed = JSON.parse(text);
    expect(parsed.type).toBe('mypd.testdata.rules');
    expect(parsed.version).toBe(1);
    const { rules: imported, problems } = importRules(text);
    expect(problems).toEqual([]);
    expect(imported.length).toBe(2);
    expect(imported[0]).toEqual({
      id: expect.any(String), name: 'Seq', kind: 'sequence', params: { start: 5, prefix: 'X' },
      unique: true,
    });
    expect(imported[0].id).not.toBe('a');
    expect(imported[1].params.items).toEqual([{ value: 'A', weight: 3 }, { value: 'B', weight: 1 }]);
    expect(imported[1].nullRate).toBe(20);
    expect(imported[1].note).toBe('n');
    expect(importRules(JSON.stringify(rules())).rules.length).toBe(2);
    expect(importRules(exportRules(undefined))).toEqual({ rules: [], problems: [] });
  });

  test('untrusted input is reported, never thrown', () => {
    const codes = text => importRules(text).problems.map(p => p.code);
    expect(codes(undefined)).toEqual(['import.empty']);
    expect(codes(42)).toEqual(['import.empty']);
    expect(codes('  ')).toEqual(['import.empty']);
    expect(codes('{not json')).toEqual(['import.json']);
    expect(codes('null')).toEqual(['import.format']);
    expect(codes('"text"')).toEqual(['import.format']);
    expect(codes('{"rules":{}}')).toEqual(['import.format']);
    expect(codes('{"type":"other","version":1,"rules":[]}')).toEqual(['import.format']);
    expect(codes('{"type":"mypd.testdata.rules","version":2,"rules":[]}'))
      .toEqual(['import.version']);
    expect(codes('{"type":"mypd.testdata.rules","rules":[]}')).toEqual(['import.version']);
    expect(codes(`[${' '.repeat(5000001)}]`)).toEqual(['import.tooLarge']);
    const many = JSON.stringify(new Array(2001).fill({ name: 'n', kind: 'auto' }));
    const result = importRules(many);
    expect(result.problems).toEqual([{ code: 'import.tooMany' }]);
    expect(result.rules.length).toBe(2000);
  });

  test('bad rules are skipped one by one', () => {
    const { rules: imported, problems } = importRules(JSON.stringify([
      null,
      { name: 'x', kind: 'evil' },
      { name: 'fk', kind: 'foreign' },
      { name: '  ', kind: 'auto' },
      { name: 'bad', kind: 'number', params: { min: 9, max: 1 } },
      { name: 'ok', kind: 'constant', params: { value: 1, hack: { a: 1 }, __proto__: { x: 1 } } },
      { name: 'obj', kind: 'constant', params: { value: { nested: true } } },
      { name: 'list', kind: 'list', params: { items: ['a', { value: { x: 1 } }, null, 5] } },
      { name: 'p', kind: 'pattern', params: 'A##' },
    ]));
    expect(problems).toEqual([
      { code: 'import.rule.kind', index: 0, name: '' },
      { code: 'import.rule.kind', index: 1, name: 'x' },
      { code: 'import.rule.kind', index: 2, name: 'fk' },
      { code: 'import.rule.name', index: 3, name: '' },
      { code: 'import.rule.invalid', index: 4, name: 'bad', detail: ['number.range'] },
      { code: 'import.rule.invalid', index: 6, name: 'obj', detail: ['constant.value.missing'] },
      { code: 'import.rule.invalid', index: 8, name: 'p', detail: ['pattern.mask.empty'] },
    ]);
    expect(imported.map(r => r.name)).toEqual(['ok', 'list']);
    expect(imported[0].params).toEqual({ value: 1 });
    expect(imported[1].params.items).toEqual([{ value: 'a', weight: 1 }, { value: 5, weight: 1 }]);
    expect({}.x).toBeUndefined();
  });

  test('long texts are cut', () => {
    const { rules: imported } = importRules(JSON.stringify([
      { name: 'n'.repeat(500), kind: 'constant', params: { value: 'v'.repeat(9000) } },
    ]));
    expect(imported[0].name.length).toBe(200);
    expect(imported[0].params.value.length).toBe(4000);
  });

  test('copyRules gives fresh ids and unique names', () => {
    const source = freeze(rules().concat([{ id: 'c', name: 'Seq', kind: 'auto', params: {} }]));
    const existing = [{ id: 'z', name: 'Seq' }, { id: 'y', name: 'Seq (2)' }];
    const copies = copyRules(source, existing);
    expect(copies.map(r => r.name)).toEqual(['Seq (3)', '狀態', 'Seq (4)']);
    expect(copies.every((r, i) => r.id !== source[i].id && r.id.length > 8)).toBe(true);
    expect(copies[1].params).toEqual(source[1].params);
    expect(copies[1].params.items).not.toBe(source[1].params.items);
    expect(copyRules(source).map(r => r.name)).toEqual(['Seq', '狀態', 'Seq (2)']);
    expect(copyRules([{ id: 'q', name: '', kind: 'text' }], [])[0].name).toBe('text');
    expect(copyRules([{ id: 'q', name: 'constructor', kind: 'auto' }])[0].name)
      .toBe('constructor');
    expect(copyRules(undefined)).toEqual([]);
  });
});
