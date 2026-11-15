// Unique values are drawn without repeating from the values of the rule: a table with as
// many rows as there are values gets every one of them, and no value is ever made up.
import { buildPlan } from '../src/lib/testdata/plan';
import { createGenerator } from '../src/lib/testdata/generate';
import { createPermutation } from '../src/lib/testdata/permute';
import { createRandom } from '../src/lib/testdata/random';
import { ruleSpace } from '../src/lib/testdata/value_space';
import { ruleCapacity, neverRepeats } from '../src/lib/testdata/plan_keys';
import { uniqueKey } from '../src/lib/testdata/generate_unique';
import {
  field, entity, link, project, rule, collect,
} from './testdata_planner_helpers';

const NOW = new Date(2026, 10, 15, 10, 0, 0);
const pk = {
  primaryKey: true,
  notNull: true,
};

// one table T with column V filled by `r` (unique), `rows` rows
const single = (r, type, more, rows, db) => project([entity('T', [field('V', type, {
  notNull: true,
  testData: { rule: 'u' },
  ...more,
})])], {
  rules: [{
    ...r,
    id: 'u',
    unique: true,
  }],
  settings: { tables: { T: { rows } } },
}, db ? {
  profile: {
    default: { db: 'x' },
    dataTypeSupports: [{
      id: 'x',
      defKey: db,
    }],
  },
} : {});

const make = async (ds, ids = ['T'], options = {}) => {
  const plan = buildPlan(ds, {
    entityIds: ids,
    now: NOW,
  });
  const generator = createGenerator(ds, plan, {
    seed: 7,
    now: NOW,
    ...options,
  });
  const data = {};
  for (let i = 0; i < plan.tables.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    data[plan.tables[i].entityId] = (await collect(generator, plan.tables[i].entityId)).rows;
  }
  return {
    plan,
    data,
  };
};
const column = (rows, at = 0) => rows.map(r => r[at]);
const distinct = list => new Set(list.map(v => uniqueKey(v))).size;

describe('B1: a unique column at its capacity', () => {
  test('pattern ## x 100: every value once, all of the shape of the mask', async () => {
    const { plan, data } = await make(single(rule('u', 'pattern', { mask: '##' }), 'VARCHAR',
      { len: 10 }, 100));
    expect(plan.problems).toEqual([]);
    const values = column(data.T);
    values.forEach(v => expect(v).toMatch(/^\d\d$/));
    expect(distinct(values)).toBe(100);
  });

  test('list of 60 x 60, number 1..100 x 100, TINYINT 0..127 x 128', async () => {
    const items = Array.from({ length: 60 }, (x, i) => ({ value: `code${i}` }));
    const list = column((await make(single(rule('u', 'list', { items }), 'VARCHAR', { len: 20 },
      60))).data.T);
    expect(list.slice().sort()).toEqual(items.map(i => i.value).sort());
    const numbers = column((await make(single(rule('u', 'number', {
      min: 1,
      max: 100,
    }), 'INT', {}, 100))).data.T);
    expect(numbers.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 100 },
      (x, i) => i + 1));
    const tiny = column((await make(single(rule('u', 'number', {
      min: 0,
      max: 127,
    }), 'TINYINT', {}, 128))).data.T);
    expect(Math.max(...tiny)).toBe(127);
    expect(distinct(tiny)).toBe(128);
  });

  test('number 1..10000 x 10000 and a date range of 30 days x 30 are feasible', async () => {
    const numbers = column((await make(single(rule('u', 'number', {
      min: 1,
      max: 10000,
    }), 'INT', {}, 10000))).data.T);
    expect(distinct(numbers)).toBe(10000);
    expect(numbers.every(n => n >= 1 && n <= 10000)).toBe(true);
    expect(numbers.slice(0, 5)).not.toEqual([1, 2, 3, 4, 5]); // drawn, not counted
    const days = column((await make(single(rule('u', 'date', {
      from: '2024-01-01',
      to: '2024-01-30',
    }), 'DATE', {}, 30))).data.T);
    expect(days.slice().sort()[0]).toBe('2024-01-01');
    expect(days.slice().sort()[29]).toBe('2024-01-30');
    expect(distinct(days)).toBe(30);
  });

  test('one row more than there are values: a problem of the plan and a coded error', async () => {
    const ds = single(rule('u', 'pattern', { mask: '##' }), 'VARCHAR', { len: 10 }, 101);
    const plan = buildPlan(ds, { entityIds: ['T'] });
    expect(plan.problems).toEqual([expect.objectContaining({
      code: 'uniqueImpossible',
      detail: expect.objectContaining({
        capacity: 100,
        rows: 101,
      }),
    })]);
    const rows = [];
    await expect(createGenerator(ds, plan, { seed: 1 }).table('T', {
      onBatch: batch => batch.forEach(r => rows.push(r[0])),
      batchSize: 10,
    })).rejects.toMatchObject({
      code: 'uniqueExhausted',
      entityId: 'T',
      fieldId: 'T.V',
      row: 100,
    });
    rows.forEach(v => expect(v).toMatch(/^\d\d$/)); // nothing like '09~2p'
  });

  test('dict, bool, text, cycle, file and query lists', async () => {
    const dicts = [{
      id: 'd1',
      defKey: 'D',
      items: ['A', 'B', 'C', 'D'].map(k => ({
        defKey: k,
        defName: k,
      })),
    }];
    const dict = single(rule('u', 'dict', { dict: 'd1' }), 'VARCHAR', { len: 5 }, 4);
    dict.dicts = dicts;
    expect(column((await make(dict)).data.T).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(column((await make(single(rule('u', 'builtin', { name: 'boolean' }), 'BOOLEAN', {},
      2))).data.T).sort()).toEqual([false, true]);
    const text = column((await make(single(rule('u', 'text', {
      min: 1,
      max: 2,
      charset: 'digit',
    }), 'VARCHAR', { len: 5 }, 110))).data.T);
    expect(distinct(text)).toBe(110); // 10 of one digit + 100 of two
    const cycle = column((await make(single(rule('u', 'list', {
      items: ['x', 'y', 'z'].map(value => ({ value })),
      order: 'cycle',
    }), 'VARCHAR', { len: 5 }, 3))).data.T);
    expect(cycle).toEqual(['x', 'y', 'z']); // a cycling list keeps its order
    const lists = {
      file: { '/tmp/a.txt': ['p', 'q', 'q', 'r'] },
      query: { 'select k from t': [3, 1, 2] },
    };
    const file = single(rule('u', 'file', { path: '/tmp/a.txt' }), 'VARCHAR', { len: 5 }, 3);
    expect(column((await make(file, ['T'], { lists })).data.T).sort()).toEqual(['p', 'q', 'r']);
    const query = single(rule('u', 'query', { sql: 'select k from t' }), 'INT', {}, 3);
    expect(column((await make(query, ['T'], { lists })).data.T).sort()).toEqual([1, 2, 3]);
    await expect(make(single(rule('u', 'file', { path: '/tmp/a.txt' }), 'VARCHAR', { len: 5 }, 4),
      ['T'], { lists })).rejects.toMatchObject({ code: 'uniqueExhausted' });
  });

  test('letters that differ by case only are one value, and the case still varies', async () => {
    const space = ruleSpace({
      kind: 'pattern',
      params: { mask: '*' },
    }, {
      kind: 'string',
      len: 5,
    }, {});
    expect(space.size).toBe(36);
    const { data } = await make(single(rule('u', 'pattern', { mask: 'a*' }), 'VARCHAR',
      { len: 5 }, 26 * 36));
    expect(distinct(column(data.T))).toBe(26 * 36);
    expect(column(data.T).some(v => /[A-Z]/.test(v.charAt(1)))).toBe(true);
    expect(column(data.T).some(v => /[a-z]/.test(v.charAt(1)))).toBe(true);
  });

  test('a million unique values of a space of exactly a million', async () => {
    const ds = single(rule('u', 'pattern', { mask: '######' }), 'CHAR', { len: 6 }, 1000000);
    const plan = buildPlan(ds, { entityIds: ['T'] });
    expect(plan.problems).toEqual([]);
    const seen = new Uint8Array(1000000);
    let repeats = 0;
    const before = process.memoryUsage().heapUsed;
    await createGenerator(ds, plan, { seed: 3 }).table('T', {
      onBatch: batch => batch.forEach((r) => {
        repeats += seen[Number(r[0])];
        seen[Number(r[0])] = 1;
      }),
    });
    expect(repeats).toBe(0);
    expect(seen.every(v => v === 1)).toBe(true);
    // nothing is remembered per row
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(60 * 1048576);
  }, 30000);

  test('the permutation is one-to-one for any size and depends on the seed', () => {
    [1, 2, 3, 7, 100, 4096, 4097, 65537, 100000].forEach((size) => {
      const permute = createPermutation(size, createRandom(5).fork('p'));
      const seen = new Uint8Array(size);
      let wrong = 0;
      for (let i = 0; i < size; i += 1) {
        const v = permute(i);
        wrong += v >= 0 && v < size && seen[v] === 0 ? 0 : 1;
        seen[v] = 1;
      }
      expect({ size, wrong }).toEqual({ size, wrong: 0 });
    });
    const big = createPermutation(2 ** 52, createRandom(5).fork('p'));
    const other = createPermutation(2 ** 52, createRandom(6).fork('p'));
    const values = Array.from({ length: 2000 }, (x, i) => big(i));
    expect(new Set(values).size).toBe(2000);
    values.forEach(v => expect(Number.isSafeInteger(v) && v < 2 ** 52).toBe(true));
    expect(values).toEqual(Array.from({ length: 2000 }, (x, i) => big(i)));
    expect(values).not.toEqual(Array.from({ length: 2000 }, (x, i) => other(i)));
  });
});

describe('B1: groups of columns', () => {
  const two = (rows, more = {}) => project([entity('T', [
    field('A', 'VARCHAR', {
      ...pk,
      len: 5,
      testData: { rule: 'a' },
    }),
    field('B', 'INT', {
      ...pk,
      testData: { rule: 'b' },
    }),
    field('C', 'VARCHAR', { len: 10 }),
  ])], {
    rules: [rule('a', 'list', { items: ['x', 'y', 'z'].map(value => ({ value })) }),
      rule('b', 'number', {
        min: 1,
        max: 4,
      })],
    settings: { tables: { T: { rows } } },
    ...more,
  });

  test('two listed columns give every combination exactly once', async () => {
    const { plan, data } = await make(two(12));
    expect(plan.problems).toEqual([]);
    expect(new Set(data.T.map(r => `${r[0]}/${r[1]}`)).size).toBe(12);
    await expect(make(two(13))).rejects.toMatchObject({
      code: 'uniqueExhausted',
      row: 12,
    });
    expect(buildPlan(two(13), { entityIds: ['T'] }).problems[0]).toMatchObject({
      code: 'uniqueImpossible',
      detail: {
        capacity: 12,
        rows: 13,
      },
    });
  });

  test('one column with enough values carries the group, the others stay random', async () => {
    const ds = project([entity('T', [
      field('A', 'INT', {
        ...pk,
        testData: { rule: 'a' },
      }),
      field('B', 'VARCHAR', {
        ...pk,
        len: 5,
        testData: { rule: 'b' },
      }),
    ])], {
      rules: [rule('a', 'number', {
        min: 1,
        max: 500,
      }), rule('b', 'list', { items: ['x', 'y'].map(value => ({ value })) })],
      settings: { tables: { T: { rows: 500 } } },
    });
    const { data } = await make(ds);
    expect(distinct(column(data.T, 0))).toBe(500); // A alone is unique
    expect(distinct(column(data.T, 1))).toBe(2);
  });

  test('a link table fills up to every pair of parents; a composite key counts once', async () => {
    const a = entity('A', [field('ID', 'INT', pk)]);
    const b = entity('B', [field('K1', 'INT', pk), field('K2', 'VARCHAR', {
      ...pk,
      len: 4,
    })]);
    const linkTable = entity('L', [field('A_ID', 'INT', pk), field('B1', 'INT', pk),
      field('B2', 'VARCHAR', {
        ...pk,
        len: 4,
      })], {
      correlations: [link('L.A_ID', 'A', 'ID'), link('L.B1', 'B', 'K1'), link('L.B2', 'B', 'K2')],
    });
    const ds = rows => project([a, b, linkTable], {
      settings: {
        tables: {
          A: { rows: 5 },
          B: { rows: 4 },
          L: { rows },
        },
      },
    });
    const { plan, data } = await make(ds(20), ['A', 'B', 'L']);
    expect(plan.problems).toEqual([]);
    expect(new Set(data.L.map(r => r.join('/'))).size).toBe(20);
    const pairs = data.B.map(r => r.join('/'));
    data.L.forEach(r => expect(pairs).toContain(`${r[1]}/${r[2]}`));
    // 5 x 4 parents: the two columns of the key to B are one choice, not 4 x 4
    expect(buildPlan(ds(21), { entityIds: ['A', 'B', 'L'] }).problems).toEqual([
      expect.objectContaining({
        code: 'uniqueImpossible',
        detail: expect.objectContaining({
          capacity: 20,
          rows: 21,
        }),
      })]);
  });

  test('rows per parent: the children of one parent differ in the other key column', async () => {
    const parent = entity('P', [field('ID', 'INT', pk)]);
    const child = entity('C', [field('P_ID', 'INT', pk), field('LINE', 'INT', {
      ...pk,
      testData: { rule: 'line' },
    })], { correlations: [link('C.P_ID', 'P', 'ID')] });
    const ds = max => project([parent, child], {
      rules: [rule('line', 'number', {
        min: 1,
        max: 3,
      })],
      settings: {
        tables: {
          P: { rows: 50 },
          C: {
            perParent: {
              field: 'C.P_ID',
              min: 3,
              max,
            },
          },
        },
      },
    });
    const { plan, data } = await make(ds(3), ['P', 'C']);
    expect(plan.problems).toEqual([]);
    expect(data.C).toHaveLength(150);
    expect(new Set(data.C.map(r => r.join('/'))).size).toBe(150);
    expect(buildPlan(ds(4), { entityIds: ['P', 'C'] }).problems).toEqual([
      expect.objectContaining({
        code: 'uniqueImpossible',
        detail: expect.objectContaining({
          capacity: 3,
          rows: 4,
          perParent: true,
        }),
      })]);
  });
});

describe('B2: sequences', () => {
  const col = (kind, type, more = {}) => ({
    kind,
    type,
    len: null,
    scale: null,
    ...more,
  });
  const seq = params => ({
    kind: 'sequence',
    params,
  });

  test('never repeats only while it stays inside the real limits of the column', () => {
    expect(neverRepeats(seq({}), col('int', 'INT'), 1000000)).toBe(true);
    expect(neverRepeats(seq({}), col('int', 'TINYINT'), 127)).toBe(true);
    expect(neverRepeats(seq({}), col('int', 'TINYINT'), 128)).toBe(false);
    expect(neverRepeats(seq({}), col('int', 'TINYINT', { dialect: 'mssql' }), 255)).toBe(true);
    expect(neverRepeats(seq({ start: 2147483640 }), col('int', 'INT'), 8)).toBe(true);
    expect(neverRepeats(seq({ start: 2147483640 }), col('int', 'INT'), 9)).toBe(false);
    expect(neverRepeats(seq({ step: 0.4 }), col('int', 'INT'), 3)).toBe(false);
    expect(neverRepeats(seq({ step: 0.5 }), col('decimal', 'DECIMAL', {
      len: 5,
      scale: 1,
    }), 100)).toBe(true);
    expect(neverRepeats(seq({ step: 0.05 }), col('decimal', 'DECIMAL', {
      len: 5,
      scale: 1,
    }), 100)).toBe(false);
    expect(ruleCapacity(seq({}), col('int', 'TINYINT'), {}, {})).toBe(127);
    expect(ruleCapacity(seq({ step: 0 }), col('int', 'INT'), {}, {})).toBe(1);
  });

  test('running past the column is a problem of the plan and stops the run, never a repeat', async () => {
    const ds = single(rule('u', 'sequence', { start: 120 }), 'TINYINT', {}, 20);
    const plan = buildPlan(ds, { entityIds: ['T'] });
    expect(plan.problems.map(p => p.code)).toEqual(['badRule', 'uniqueImpossible']);
    expect(plan.problems[0]).toMatchObject({
      fieldId: 'T.V',
      detail: ['value.range'],
    });
    await expect(make(ds)).rejects.toMatchObject({
      code: 'value.range',
      entityId: 'T',
      fieldId: 'T.V',
      row: 8, // 120 ... 127 are fine
    });
    const fraction = buildPlan(single(rule('u', 'sequence', { step: 0.4 }), 'INT', {}, 5),
      { entityIds: ['T'] });
    expect(fraction.problems[0]).toMatchObject({
      code: 'badRule',
      detail: ['sequence.fraction'],
    });
  });
});
