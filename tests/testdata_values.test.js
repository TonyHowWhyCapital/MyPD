import { makeValueGenerator, exprColumns } from '../src/lib/testdata/values';
import { createRandom } from '../src/lib/testdata/random';
import { BUILTIN_NAMES } from '../src/lib/testdata/model';

const now = new Date(2026, 0, 15, 10, 30, 45);
const col = (kind, extra = {}) => ({
  id: 'c', defKey: 'C', defName: 'C', kind, type: '', len: '', scale: '', ...extra,
});
const ctxOf = (extra = {}, seed = 1) => ({ random: createRandom(seed), now, ...extra });
const gen = (rule, column, extra, n = 200, seed = 1) => {
  const make = makeValueGenerator(rule, column, ctxOf(extra, seed));
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(make(i, {}));
  return out;
};
const codeOf = (rule, column, extra) => {
  try {
    makeValueGenerator(rule, column, ctxOf(extra))(0, {});
  } catch (e) {
    return e.code;
  }
  return null;
};
const DATE = /^\d{4}-\d\d-\d\d$/;
const DATETIME = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/;
const TIME = /^\d\d:\d\d:\d\d$/;

describe('auto', () => {
  const auto = { kind: 'auto' };

  test('fits every column kind', () => {
    gen(auto, col('int', { type: 'INT' })).forEach((v) => {
      expect(Number.isInteger(v) && v >= 0 && v <= 10000).toBe(true);
    });
    gen(auto, col('int', { type: 'TINYINT' })).forEach(v => expect(v >= 0 && v <= 127).toBe(true));
    gen(auto, col('int', { type: 'NUMBER', len: 2 })).forEach(v => expect(v <= 99).toBe(true));
    gen(auto, col('decimal', { type: 'DECIMAL', len: 5, scale: 2 })).forEach((v) => {
      expect(v >= 0 && v <= 999.99).toBe(true);
      expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
    });
    gen(auto, col('decimal', { type: 'DECIMAL', len: 3, scale: 3 }))
      .forEach(v => expect(v >= 0 && v <= 0.999).toBe(true));
    gen(auto, col('decimal', { type: 'DECIMAL', len: 6 }))
      .forEach(v => expect(Number.isInteger(v)).toBe(true));
    gen(auto, col('decimal', { type: 'DOUBLE' }))
      .forEach(v => expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6));
    gen(auto, col('date')).forEach(v => expect(v).toMatch(DATE));
    gen(auto, col('datetime')).forEach(v => expect(v).toMatch(DATETIME));
    gen(auto, col('time')).forEach(v => expect(v).toMatch(TIME));
    gen(auto, col('date')).forEach(v => expect(v >= '2025-01-15' && v <= '2026-01-15').toBe(true));
    const flags = gen(auto, col('bool'));
    expect(new Set(flags)).toEqual(new Set([true, false]));
  });

  test('string length follows the column', () => {
    gen(auto, col('string', { len: 1 })).forEach(v => expect(v).toMatch(/^[A-Z]$/));
    gen(auto, col('string', { len: 3 })).forEach(v => expect(v).toMatch(/^[A-Z][a-z]{1,2}$/));
    gen(auto, col('string', { len: 255 })).forEach(v => expect(v).toMatch(/^[A-Z][a-z]{7,15}$/));
    gen(auto, col('string', { len: 0 })).forEach(v => expect(v.length).toBeGreaterThan(0));
    gen(auto, col('string', { len: '' })).forEach(v => expect(v.length <= 16).toBe(true));
    gen(auto, col('string', { len: '4' })).forEach(v => expect(v.length <= 4).toBe(true));
  });

  test('keys count up so that they are unique', () => {
    expect(gen(auto, col('int', { primaryKey: true }), {}, 3)).toEqual([1, 2, 3]);
    expect(gen(auto, col('int', { autoIncrement: true }), {}, 3)).toEqual([1, 2, 3]);
    expect(gen(auto, col('int', { type: 'TINYINT', primaryKey: true }), {}, 200)[199]).toBe(127);
    expect(gen(auto, col('string', { primaryKey: true, len: 32 }), {}, 2))
      .toEqual(['0000000001', '0000000002']);
    expect(gen(auto, col('string', { primaryKey: true, len: 3 }), {}, 2)).toEqual(['001', '002']);
  });

  test('binary: NULL when nullable, short hex otherwise', () => {
    expect(gen(auto, col('binary'), {}, 3)).toEqual([null, null, null]);
    gen(auto, col('binary', { notNull: true })).forEach(v => expect(v).toMatch(/^[0-9A-F]{16}$/));
    gen(auto, col('binary', { primaryKey: true, len: 2 }))
      .forEach(v => expect(v).toMatch(/^[0-9A-F]{4}$/));
  });

  test('a missing rule, missing ctx and an unknown column kind still work', () => {
    expect(typeof makeValueGenerator(undefined, col('string'), undefined)(0, {})).toBe('string');
    expect(typeof makeValueGenerator(null, undefined, {})(0)).toBe('string');
    expect(typeof gen(auto, col('geometry'))[0]).toBe('string');
  });
});

describe('sequence, number, date, text', () => {
  test('sequence', () => {
    const rule = { kind: 'sequence', params: { start: 123, prefix: 'ORD', pad: 6 } };
    expect(gen(rule, col('string'), {}, 2)).toEqual(['ORD000123', 'ORD000124']);
    expect(gen({ kind: 'sequence' }, col('int'), {}, 3)).toEqual([1, 2, 3]);
    expect(gen({ kind: 'sequence', params: null }, col('string'), {}, 2)).toEqual(['1', '2']);
    expect(gen({ kind: 'sequence', params: { start: 10, step: -5 } }, col('int'), {}, 4))
      .toEqual([10, 5, 0, -5]);
    expect(gen({ kind: 'sequence', params: { start: -2, pad: 3, suffix: 'x' } }, col('string'), {}, 3))
      .toEqual(['-002x', '-001x', '000x']);
    expect(gen({ kind: 'sequence', params: { start: '7', step: '2' } }, col('decimal'), {}, 2))
      .toEqual([7, 9]);
    expect(gen(rule, col('string', { len: 5 }), {}, 1)).toEqual(['ORD00']);
    expect(gen({ kind: 'sequence', params: { start: 126 } }, col('int', { type: 'tinyint' }), {}, 3))
      .toEqual([126, 127, 127]);
    expect(codeOf(rule, col('int'))).toBe('sequence.affix.type');
    expect(codeOf({ kind: 'sequence', params: { step: 0 } }, col('int')))
      .toBe('sequence.step.invalid');
    expect(codeOf({ kind: 'sequence' }, col('date'))).toBe('value.type');
  });

  test('number', () => {
    const rule = { kind: 'number', params: { min: 10, max: 20, decimals: 2 } };
    gen(rule, col('decimal', { len: 10, scale: 2 })).forEach((v) => {
      expect(typeof v).toBe('number');
      expect(v >= 10 && v <= 20).toBe(true);
      expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
    });
    expect(gen(rule, col('decimal', { len: 10, scale: 2 })).some(v => !Number.isInteger(v)))
      .toBe(true);
    gen(rule, col('int')).forEach(v => expect(Number.isInteger(v) && v >= 10 && v <= 20).toBe(true));
    gen(rule, col('string')).forEach(v => expect(v).toMatch(/^(1\d|20)\.\d\d$/));
    gen(rule, col('decimal', { len: 10, scale: 1 }))
      .forEach(v => expect(Math.abs(v * 10 - Math.round(v * 10))).toBeLessThan(1e-6));
    expect(new Set(gen({ kind: 'number', params: { min: 1, max: 3 } }, col('int'))))
      .toEqual(new Set([1, 2, 3]));
    expect(gen({ kind: 'number', params: { min: 5, max: 5 } }, col('int'), {}, 2)).toEqual([5, 5]);
    gen({ kind: 'number', params: { min: -1.5, max: 1.5, decimals: 1 } }, col('decimal'))
      .forEach(v => expect(v >= -1.5 && v <= 1.5).toBe(true));
  });

  test('number: defaults, column limits and bad ranges', () => {
    gen({ kind: 'number' }, col('int', { type: 'SMALLINT' }))
      .forEach(v => expect(v >= 0 && v <= 32767).toBe(true));
    gen({ kind: 'number', params: {} }, col('decimal', { len: 4, scale: 2 }))
      .forEach(v => expect(v >= 0 && v <= 99.99).toBe(true));
    gen({ kind: 'number', params: { min: null, max: undefined } }, col('string', { len: 2 }))
      .forEach(v => expect(v).toMatch(/^\d{1,2}$/));
    gen({ kind: 'number', params: { min: 0, max: 100000 } }, col('int', { type: 'TINYINT' }))
      .forEach(v => expect(v <= 127).toBe(true));
    gen({ kind: 'number', params: { min: 0, max: 5000 } }, col('decimal', { len: 5, scale: 2 }))
      .forEach(v => expect(v <= 999.99).toBe(true));
    expect(codeOf({ kind: 'number', params: { min: 9, max: 1 } }, col('int'))).toBe('number.range');
    expect(codeOf({ kind: 'number', params: { min: 500, max: 900 } }, col('int', { type: 'TINYINT' })))
      .toBe('number.range.column');
    expect(codeOf({ kind: 'number', params: { min: 0.2, max: 0.8 } }, col('int')))
      .toBe('number.range.column');
    expect(codeOf({ kind: 'number', params: { min: 'abc' } }, col('int'))).toBe('number.min.invalid');
    expect(codeOf({ kind: 'number', params: { min: 1, max: 2 } }, col('date'))).toBe('value.type');
  });

  test('date', () => {
    const rule = { kind: 'date', params: { from: '2026-01-01', to: '2026-01-03' } };
    const days = gen(rule, col('date'));
    expect(new Set(days)).toEqual(new Set(['2026-01-01', '2026-01-02', '2026-01-03']));
    const stamps = gen(rule, col('datetime'));
    stamps.forEach((v) => {
      expect(v).toMatch(DATETIME);
      expect(v >= '2026-01-01 00:00:00' && v <= '2026-01-03 23:59:59').toBe(true);
    });
    expect(stamps.some(v => v > '2026-01-03 00:00:00')).toBe(true);
    gen(rule, col('string')).forEach(v => expect(v).toMatch(DATE));
    gen(rule, col('time')).forEach(v => expect(v).toMatch(TIME));
    gen(rule, col('string', { len: 7 })).forEach(v => expect(v).toBe('2026-01'));
    const timed = { kind: 'date', params: { from: '2026-01-01 08:00:00', to: '2026-01-01 09:00:00' } };
    gen(timed, col('string')).forEach((v) => {
      expect(v >= '2026-01-01 08:00:00' && v <= '2026-01-01 09:00:00').toBe(true);
    });
    gen(timed, col('date')).forEach(v => expect(v).toBe('2026-01-01'));
    gen({ kind: 'date', params: { from: 'now-30d', to: 'now+30d' } }, col('date'))
      .forEach(v => expect(v >= '2025-12-16' && v <= '2026-02-14').toBe(true));
    gen({ kind: 'date' }, col('datetime')).forEach((v) => {
      expect(v >= '2025-01-15 10:30:45' && v <= '2026-01-15 10:30:45').toBe(true);
    });
    gen({ kind: 'date', params: { from: 'now', to: 'now' } }, col('datetime'), {}, 3)
      .forEach(v => expect(v).toBe('2026-01-15 10:30:45'));
    expect(codeOf({ kind: 'date', params: { from: '2026-02-01', to: '2026-01-01' } }, col('date')))
      .toBe('date.range');
    expect(codeOf({ kind: 'date', params: { from: 'soon' } }, col('date'))).toBe('date.from.invalid');
    expect(codeOf({ kind: 'date', params: { to: '2026-02-31' } }, col('date')))
      .toBe('date.to.invalid');
    expect(codeOf(rule, col('int'))).toBe('value.type');
  });

  test('text', () => {
    const sets = {
      alnum: /^[A-Za-z0-9]{3,6}$/,
      alpha: /^[A-Za-z]{3,6}$/,
      digit: /^\d{3,6}$/,
      hex: /^[0-9A-F]{3,6}$/,
      zh: /^[\u4e00-\u9fff]{3,6}$/,
    };
    Object.keys(sets).forEach((charset) => {
      const values = gen({ kind: 'text', params: { min: 3, max: 6, charset } }, col('string'));
      values.forEach(v => expect(v).toMatch(sets[charset]));
      expect(new Set(values.map(v => v.length)).size).toBe(4);
    });
    gen({ kind: 'text' }, col('string')).forEach(v => expect(v).toMatch(/^[A-Za-z0-9]{5,20}$/));
    gen({ kind: 'text', params: { min: 10, max: 30 } }, col('string', { len: 4 }))
      .forEach(v => expect(v.length).toBe(4));
    gen({ kind: 'text', params: {} }, col('string', { len: 2 }))
      .forEach(v => expect(v.length).toBe(2));
    gen({ kind: 'text', params: { min: 0, max: 0 } }, col('string'), {}, 3)
      .forEach(v => expect(v).toBe(''));
    gen({ kind: 'text', params: { min: 2, max: 30, charset: 'digit' } }, col('int'))
      .forEach(v => expect(Number.isInteger(v) && v >= 0 && v < 2147483647).toBe(true));
    expect(codeOf({ kind: 'text', params: { min: 9, max: 2 } }, col('string'))).toBe('text.range');
    expect(codeOf({ kind: 'text', params: { charset: 'runes' } }, col('string')))
      .toBe('text.charset.unknown');
    expect(codeOf({ kind: 'text', params: { min: 8, max: 8, charset: 'alpha' } }, col('int')))
      .toBe('value.type');
  });
});

describe('list, pattern, constant, builtin', () => {
  test('list: weights, cycle, plain values, fitting', () => {
    const items = [{ value: 'A', weight: 8 }, { value: 'B', weight: 2 }, { value: 'C', weight: 0 }];
    const values = gen({ kind: 'list', params: { items } }, col('string'), {}, 10000);
    const count = v => values.filter(x => x === v).length;
    expect(count('C')).toBe(0);
    expect(Math.abs(count('A') - 8000)).toBeLessThan(300);
    expect(count('A') + count('B')).toBe(10000);
    expect(gen({ kind: 'list', params: { items, order: 'cycle' } }, col('string'), {}, 5))
      .toEqual(['A', 'B', 'A', 'B', 'A']);
    expect(new Set(gen({ kind: 'list', params: { items: ['x', 'y', 'z'] } }, col('string'))))
      .toEqual(new Set(['x', 'y', 'z']));
    expect(new Set(gen({ kind: 'list', params: { items: ['1', 2, '3.7'] } }, col('int'))))
      .toEqual(new Set([1, 2, 4]));
    expect(gen({ kind: 'list', params: { items: ['abcdef'] } }, col('string', { len: 3 }), {}, 1))
      .toEqual(['abc']);
    expect(new Set(gen({ kind: 'list', params: { items: ['Y', 'N'] } }, col('bool'))))
      .toEqual(new Set([true, false]));
    expect(gen({ kind: 'list', params: { items: ['2026-1-5'] } }, col('datetime'), {}, 1))
      .toEqual(['2026-01-05 00:00:00']);
    expect(codeOf({ kind: 'list', params: { items: [] } }, col('string'))).toBe('list.items.empty');
    expect(codeOf({ kind: 'list' }, col('string'))).toBe('list.items.empty');
    expect(codeOf({ kind: 'list', params: { items: ['a', 'b'] } }, col('int'))).toBe('value.type');
    expect(codeOf({ kind: 'list', params: { items: [{ value: 1, weight: -2 }] } }, col('int')))
      .toBe('list.weight.invalid');
  });

  test('pattern', () => {
    gen({ kind: 'pattern', params: { mask: 'A-####' } }, col('string'))
      .forEach(v => expect(v).toMatch(/^[A-Z]-\d{4}$/));
    gen({ kind: 'pattern', params: { mask: 'A-####' } }, col('string', { len: 4 }))
      .forEach(v => expect(v).toMatch(/^[A-Z]-\d\d$/));
    gen({ kind: 'pattern', params: { mask: '9###' } }, col('int'))
      .forEach(v => expect(v >= 9000 && v <= 9999).toBe(true));
    gen({ kind: 'pattern', params: { mask: '20##-11-1#' } }, col('date'))
      .forEach(v => expect(v).toMatch(/^20\d\d-11-1\d$/));
    expect(codeOf({ kind: 'pattern', params: {} }, col('string'))).toBe('pattern.mask.empty');
    expect(codeOf({ kind: 'pattern', params: { mask: 'AA' } }, col('int'))).toBe('value.type');
  });

  test('constant', () => {
    expect(gen({ kind: 'constant', params: { value: 'x' } }, col('string'), {}, 2)).toEqual(['x', 'x']);
    expect(gen({ kind: 'constant', params: { value: '12.345' } }, col('decimal', { len: 6, scale: 2 }), {}, 1))
      .toEqual([12.35]);
    expect(gen({ kind: 'constant', params: { value: 12345 } }, col('decimal', { len: 4, scale: 1 }), {}, 1))
      .toEqual([999.9]);
    expect(gen({ kind: 'constant', params: { value: 0 } }, col('bool'), {}, 1)).toEqual([false]);
    expect(gen({ kind: 'constant', params: { value: true } }, col('string', { len: 1 }), {}, 1))
      .toEqual(['1']);
    expect(gen({ kind: 'constant', params: { value: false } }, col('string'), {}, 1))
      .toEqual(['false']);
    expect(gen({ kind: 'constant', params: { value: '' } }, col('string'), {}, 1)).toEqual(['']);
    expect(gen({ kind: 'constant', params: { value: '0aFF' } }, col('binary', { len: 1 }), {}, 1))
      .toEqual(['0a']);
    expect(gen({ kind: 'constant', params: { value: 'ab😀cd' } }, col('string', { len: 3 }), {}, 1))
      .toEqual(['ab']);
    expect(gen({ kind: 'constant', params: { value: '9:05' } }, col('time'), {}, 1))
      .toEqual(['09:05:00']);
    expect(codeOf({ kind: 'constant', params: {} }, col('string'))).toBe('constant.value.missing');
    expect(codeOf({ kind: 'constant', params: { value: 'maybe' } }, col('bool'))).toBe('value.type');
    expect(codeOf({ kind: 'constant', params: { value: 'xyz' } }, col('binary'))).toBe('value.type');
  });

  test('builtin: every name works on a string column and respects its length', () => {
    BUILTIN_NAMES.forEach((name) => {
      const rule = { kind: 'builtin', params: { name } };
      gen(rule, col('string'), {}, 50).forEach(v => expect(typeof v).toBe('string'));
      gen(rule, col('string', { len: 4 }), {}, 50).forEach(v => expect(v.length <= 4).toBe(true));
    });
    expect(new Set(gen({ kind: 'builtin', params: { name: 'boolean' } }, col('bool'))))
      .toEqual(new Set([true, false]));
    expect(new Set(gen({ kind: 'builtin', params: { name: 'boolean' } }, col('int'))))
      .toEqual(new Set([0, 1]));
    gen({ kind: 'builtin', params: { name: 'tw.zip' } }, col('int'))
      .forEach(v => expect(v >= 100 && v <= 983).toBe(true));
    expect(codeOf({ kind: 'builtin', params: { name: 'nope' } }, col('string')))
      .toBe('builtin.name.unknown');
    expect(codeOf({ kind: 'builtin', params: { name: 'tw.name' } }, col('int'))).toBe('value.type');
  });
});

describe('dict, file, query, expr, foreign', () => {
  const dataSource = {
    dicts: [
      {
        id: 'd1',
        defKey: 'Gender',
        items: [
          { defKey: 'M', defName: '男', enabled: true },
          { defKey: 'F', defName: '女' },
          { defKey: 'U', defName: '未知', enabled: false },
        ],
      },
      { id: 'd2', defKey: 'Empty', items: [{ defKey: 'X', defName: 'x', enabled: false }] },
    ],
    entities: [{
      id: 'e1',
      fields: [{ id: 'f1', defKey: 'PRICE' }, { id: 'f2', defKey: 'QTY' }, { id: 'f3', defKey: 'T' }],
    }],
  };

  test('dict', () => {
    const byKey = gen({ kind: 'dict', params: { dict: 'd1' } }, col('string'), { dataSource });
    expect(new Set(byKey)).toEqual(new Set(['M', 'F']));
    const byName = gen({ kind: 'dict', params: { dict: 'd1', use: 'name' } }, col('string'),
      { dataSource });
    expect(new Set(byName)).toEqual(new Set(['男', '女']));
    const viaField = gen({ kind: 'dict', params: {} }, col('string'),
      { dataSource, field: { refDict: 'd1' } });
    expect(new Set(viaField)).toEqual(new Set(['M', 'F']));
    expect(new Set(gen({ kind: 'dict', params: { dict: 'Gender' } }, col('string'), { dataSource })))
      .toEqual(new Set(['M', 'F']));
    expect(codeOf({ kind: 'dict' }, col('string'), { dataSource, field: {} })).toBe('dict.missing');
    expect(codeOf({ kind: 'dict' }, col('string'), {})).toBe('dict.missing');
    expect(codeOf({ kind: 'dict', params: { dict: 'gone' } }, col('string'), { dataSource }))
      .toBe('dict.missing');
    expect(codeOf({ kind: 'dict', params: { dict: 'd2' } }, col('string'), { dataSource }))
      .toBe('dict.empty');
    expect(codeOf({ kind: 'dict', params: { dict: 'd1' } }, col('int'), { dataSource }))
      .toBe('value.type');
  });

  test('file and query read the lists the caller loaded', () => {
    const lists = {
      file: { '/tmp/a.txt': ['x', 'y', 'z'], '/tmp/empty.txt': [] },
      query: { 'select id from t': [10, 20, '30'], 'select 1 where 0': [] },
    };
    const file = { kind: 'file', params: { path: '/tmp/a.txt' } };
    expect(new Set(gen(file, col('string'), { lists }))).toEqual(new Set(['x', 'y', 'z']));
    expect(gen({ kind: 'file', params: { path: '/tmp/a.txt', order: 'cycle' } }, col('string'),
      { lists }, 4)).toEqual(['x', 'y', 'z', 'x']);
    expect(gen(file, col('string', { len: 0 }), { lists }, 1)[0].length).toBe(1);
    const query = { kind: 'query', params: { sql: 'select id from t' } };
    expect(new Set(gen(query, col('int'), { lists }))).toEqual(new Set([10, 20, 30]));
    expect(new Set(gen(query, col('string'), { lists }))).toEqual(new Set(['10', '20', '30']));
    expect(codeOf({ kind: 'file', params: { path: '/tmp/none.txt' } }, col('string'), { lists }))
      .toBe('file.missing');
    expect(codeOf(file, col('string'), {})).toBe('file.missing');
    expect(codeOf({ kind: 'file', params: { path: '/tmp/empty.txt' } }, col('string'), { lists }))
      .toBe('file.empty');
    expect(codeOf({ kind: 'file', params: { path: 'constructor' } }, col('string'), { lists }))
      .toBe('file.missing');
    expect(codeOf({ kind: 'query', params: { sql: 'select x from y' } }, col('string'), { lists }))
      .toBe('query.missing');
    expect(codeOf({ kind: 'query', params: { sql: 'select 1 where 0' } }, col('string'), { lists }))
      .toBe('query.empty');
    expect(codeOf(file, col('int'), { lists })).toBe('value.type');
  });

  test('expr reads the row and fits the column', () => {
    const rule = { kind: 'expr', params: { expr: '[PRICE] * [QTY]' } };
    const make = makeValueGenerator(rule, col('decimal', { len: 8, scale: 2 }), ctxOf({ dataSource }));
    expect(make(0, { PRICE: 12.345, QTY: 3 })).toBe(37.04);
    expect(make(1, { PRICE: null, QTY: 3 })).toBe(null);
    expect(make(2, { PRICE: 1e9, QTY: 1 })).toBe(999999.99);
    const text = makeValueGenerator({ kind: 'expr', params: { expr: "'N' & pad(seq(), 4)" } },
      col('string', { len: 4 }), ctxOf());
    expect([text(0, {}), text(41, {})]).toEqual(['N000', 'N004']);
    const due = makeValueGenerator({ kind: 'expr', params: { expr: 'addDays(today(), seq())' } },
      col('datetime'), ctxOf());
    expect(due(0, {})).toBe('2026-01-16 00:00:00');
    expect(exprColumns('[PRICE] * [QTY] + [PRICE]')).toEqual(['PRICE', 'QTY']);
    expect(codeOf({ kind: 'expr', params: { expr: '[PRICE] *' } }, col('int'))).toBe('expr.end');
    expect(codeOf({ kind: 'expr', params: {} }, col('int'))).toBe('expr.empty');
    expect(codeOf({ kind: 'expr', params: { expr: '[NOPE] + 1' } }, col('int'),
      { dataSource, field: dataSource.entities[0].fields[2] })).toBe('expr.column.unknown');
    expect(codeOf({ kind: 'expr', params: { expr: '[QTY] + 1' } }, col('int'),
      { dataSource, field: { id: 'f3' } })).toBe(null);
    expect(codeOf({ kind: 'expr', params: { expr: "'abc' + 1" } }, col('int'))).toBe('expr.type');
    expect(codeOf({ kind: 'expr', params: { expr: "'abc'" } }, col('int'))).toBe('value.type');
  });

  test('foreign and unknown kinds are refused', () => {
    expect(codeOf({ kind: 'foreign', params: {} }, col('int'))).toBe('rule.kind.foreign');
    expect(codeOf({ kind: 'magic' }, col('int'))).toBe('rule.kind.unknown');
    expect(codeOf({ kind: 'toString' }, col('int'))).toBe('rule.kind.unknown');
  });
});

describe('determinism and speed', () => {
  const rules = [
    { kind: 'auto' },
    { kind: 'number', params: { min: 0, max: 1000, decimals: 2 } },
    { kind: 'date', params: { from: '2020-01-01', to: '2026-01-01' } },
    { kind: 'text', params: { min: 3, max: 9, charset: 'zh' } },
    { kind: 'list', params: { items: [{ value: 'a', weight: 5 }, { value: 'b' }] } },
    { kind: 'pattern', params: { mask: 'AA-###-**' } },
    { kind: 'builtin', params: { name: 'tw.address' } },
    { kind: 'expr', params: { expr: "rand(1, 100) & '-' & seq()" } },
  ];

  test('same seed gives the same values, another seed does not', () => {
    rules.forEach((rule) => {
      const a = gen(rule, col('string', { len: 60 }), {}, 100, 77);
      expect(gen(rule, col('string', { len: 60 }), {}, 100, 77)).toEqual(a);
      expect(gen(rule, col('string', { len: 60 }), {}, 100, 78)).not.toEqual(a);
    });
  });

  test('building a generator does not consume the random stream', () => {
    const plain = createRandom(5);
    const used = createRandom(5);
    makeValueGenerator({ kind: 'builtin', params: { name: 'boolean' } }, col('int'),
      { random: used, now });
    makeValueGenerator({ kind: 'number', params: { min: 1, max: 9 } }, col('int'),
      { random: used, now });
    expect(used.next()).toBe(plain.next());
  });

  test('a column of 200,000 values is quick', () => {
    const start = Date.now();
    rules.forEach((rule) => {
      const make = makeValueGenerator(rule, col('string', { len: 60 }), ctxOf());
      const row = {};
      for (let i = 0; i < 200000; i += 1) make(i, row);
    });
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
