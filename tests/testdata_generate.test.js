import { buildPlan } from '../src/lib/testdata/plan';
import { createGenerator } from '../src/lib/testdata/generate';
import {
  project, entity, field, link, rule, collect,
} from './testdata_planner_helpers';

jest.mock('../src/lib/testdata/model', () => require('./testdata_planner_helpers').fakeModel);
jest.mock('../src/lib/testdata/values', () => require('./testdata_planner_helpers').fakeValues);

const pk = {
  primaryKey: true,
  notNull: true,
};
const now = new Date(2024, 0, 1);
const customer = () => entity('CUSTOMER', [field('ID', 'INT', pk), field('NAME', 'VARCHAR', { len: 20 })]);
const orders = (more = {}) => entity('ORDERS', [
  field('ID', 'INT', pk),
  field('CUSTOMER_ID', 'INT', { notNull: true }),
  field('NOTE', 'VARCHAR', { len: 50 }),
], {
  correlations: [link('ORDERS.CUSTOMER_ID', 'CUSTOMER', 'ID')],
  ...more,
});
const shopOf = (tables = {}, testData = {}) => project([customer(), orders()], {
  ...testData,
  settings: { tables },
});
const run = async (ds, ids, options = {}, external) => {
  const plan = buildPlan(ds, {
    entityIds: ids,
    external,
  });
  const generator = createGenerator(ds, plan, {
    seed: 7,
    now,
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
    generator,
  };
};
const values = (rows, at) => rows.map(r => r[at]);
const distinct = list => new Set(list).size;

describe('rows and batches', () => {
  test('rows are arrays in the order of the columns, in batches', async () => {
    const ds = shopOf({ CUSTOMER: { rows: 25 } });
    const plan = buildPlan(ds, { entityIds: ['CUSTOMER'] });
    const calls = [];
    const { rows, result } = await collect(createGenerator(ds, plan, { seed: 1 }), 'CUSTOMER', {
      batchSize: 10,
      onBatch: (batch, done, total) => calls.push([batch.length, done, total]),
    });
    expect(result).toEqual({
      rows: 25,
      stopped: false,
    });
    expect(calls).toEqual([[10, 10, 25], [10, 20, 25], [5, 25, 25]]);
    expect(rows).toHaveLength(25);
    rows.forEach((r) => {
      expect(r).toHaveLength(2);
      expect(typeof r[0]).toBe('number');
      expect(typeof r[1]).toBe('string');
    });
  });

  test('the event loop gets a turn between batches and the writer is waited for', async () => {
    const ds = shopOf({ CUSTOMER: { rows: 50 } });
    const plan = buildPlan(ds, { entityIds: ['CUSTOMER'] });
    let turns = 0;
    const timer = setInterval(() => {
      turns += 1;
    }, 0);
    let writing = 0;
    let overlap = false;
    await createGenerator(ds, plan, { seed: 1 }).table('CUSTOMER', {
      batchSize: 5,
      onBatch: () => {
        overlap = overlap || writing > 0;
        writing += 1;
        return new Promise(resolve => setTimeout(() => {
          writing -= 1;
          resolve();
        }, 2));
      },
    });
    clearInterval(timer);
    expect(turns).toBeGreaterThanOrEqual(5);
    expect(overlap).toBe(false);
    expect(writing).toBe(0);
  });

  test('an error of the writer ends the table', async () => {
    const ds = shopOf();
    const plan = buildPlan(ds, { entityIds: ['CUSTOMER'] });
    await expect(createGenerator(ds, plan, { seed: 1 }).table('CUSTOMER', {
      batchSize: 10,
      onBatch: () => Promise.reject(new Error('disk full')),
    })).rejects.toThrow('disk full');
  });

  test('shouldStop ends the table between batches', async () => {
    const ds = shopOf({ CUSTOMER: { rows: 1000 } });
    const plan = buildPlan(ds, { entityIds: ['CUSTOMER'] });
    let seen = 0;
    const { rows, result } = await collect(createGenerator(ds, plan, { seed: 1 }), 'CUSTOMER', {
      batchSize: 100,
      onBatch: (batch, done) => {
        seen = done;
      },
      shouldStop: () => seen >= 300,
    });
    expect(result).toEqual({
      rows: 300,
      stopped: true,
    });
    expect(rows).toHaveLength(300);
  });

  test('a table outside the plan, zero rows', async () => {
    const ds = shopOf({ CUSTOMER: { rows: 0 } });
    const plan = buildPlan(ds, { entityIds: ['CUSTOMER'] });
    const generator = createGenerator(ds, plan, {});
    await expect(generator.table('ORDERS')).rejects.toMatchObject({ code: 'tableNotPlanned' });
    expect(await generator.table('CUSTOMER')).toEqual({
      rows: 0,
      stopped: false,
    });
  });
});

describe('determinism', () => {
  test('the same seed gives the same rows whatever the batch size', async () => {
    const ds = shopOf({ CUSTOMER: { rows: 333 } });
    const plan = buildPlan(ds, { entityIds: ['CUSTOMER'] });
    const a = await collect(createGenerator(ds, plan, { seed: 5 }), 'CUSTOMER', { batchSize: 1 });
    const b = await collect(createGenerator(ds, plan, { seed: 5 }), 'CUSTOMER', { batchSize: 1000 });
    const c = await collect(createGenerator(ds, plan, { seed: 6 }), 'CUSTOMER');
    expect(a.rows).toEqual(b.rows);
    expect(c.rows).not.toEqual(a.rows);
  });

  test('a table does not change when other tables are selected or columns are added', async () => {
    const alone = await run(shopOf(), ['CUSTOMER']);
    const both = await run(shopOf(), ['ORDERS', 'CUSTOMER']);
    expect(both.data.CUSTOMER).toEqual(alone.data.CUSTOMER);
    const wider = project([entity('CUSTOMER', [field('EXTRA', 'VARCHAR', { len: 5 }),
      field('ID', 'INT', pk), field('NAME', 'VARCHAR', { len: 20 })])]);
    const more = await run(wider, ['CUSTOMER']);
    expect(more.data.CUSTOMER.map(r => r.slice(1))).toEqual(alone.data.CUSTOMER);
  });

  test('the seed of the project is used when none is given', async () => {
    const ds = shopOf({}, {});
    ds.profile.testData.settings.seed = {
      fixed: true,
      value: 42,
    };
    const plan = buildPlan(ds, { entityIds: ['CUSTOMER'] });
    expect(createGenerator(ds, plan, {}).seed).toBe(42);
    expect(createGenerator(ds, plan, { seed: 3 }).seed).toBe(3);
    ds.profile.testData.settings.seed = { fixed: false };
    expect(createGenerator(ds, plan, {}).seed).not.toBe(createGenerator(shopOf(), plan, {}).seed);
    expect(createGenerator(shopOf(), plan, {}).seed).toBe(1);
  });
});

describe('foreign keys', () => {
  test('children point at generated parent rows', async () => {
    const { data } = await run(shopOf({ CUSTOMER: { rows: 20 } }), ['ORDERS', 'CUSTOMER']);
    const ids = values(data.CUSTOMER, 0);
    expect(data.ORDERS).toHaveLength(100);
    values(data.ORDERS, 1).forEach(v => expect(ids).toContain(v));
    expect(distinct(values(data.ORDERS, 1))).toBeGreaterThan(10);
  });

  test('keys read from the database', async () => {
    const parentKeys = { CUSTOMER: { 'CUSTOMER.ID': [11, 22, 33] } };
    const { data } = await run(shopOf(), ['ORDERS'], { parentKeys }, { CUSTOMER: 'database' });
    expect([...new Set(values(data.ORDERS, 1))].sort()).toEqual([11, 22, 33]);
  });

  test('what cannot work says so', async () => {
    const ds = shopOf();
    const undecided = buildPlan(ds, { entityIds: ['ORDERS'] });
    await expect(createGenerator(ds, undecided, {}).table('ORDERS'))
      .rejects.toMatchObject({
        code: 'missingParent',
        entityId: 'ORDERS',
        fieldId: 'ORDERS.CUSTOMER_ID',
      });
    const fromDb = buildPlan(ds, {
      entityIds: ['ORDERS'],
      external: { CUSTOMER: 'database' },
    });
    await expect(createGenerator(ds, fromDb, {}).table('ORDERS'))
      .rejects.toMatchObject({ code: 'parentKeysMissing' });
    await expect(createGenerator(ds, fromDb, { parentKeys: { CUSTOMER: { 'CUSTOMER.ID': [] } } })
      .table('ORDERS')).rejects.toMatchObject({ code: 'noParentRows' });
    const both = buildPlan(ds, { entityIds: ['ORDERS', 'CUSTOMER'] });
    await expect(createGenerator(ds, both, {}).table('ORDERS'))
      .rejects.toMatchObject({ code: 'parentNotGenerated' });
  });

  test('a nullable key is NULL when there is no parent row, and at its null rate', async () => {
    const child = () => entity('ORDERS', [field('ID', 'INT', pk), field('CUSTOMER_ID', 'INT', {
      testData: { nullRate: 30 },
    })], { correlations: [link('ORDERS.CUSTOMER_ID', 'CUSTOMER', 'ID')] });
    const none = await run(project([customer(), child()],
      { settings: { tables: { CUSTOMER: { rows: 0 } } } }), ['CUSTOMER', 'ORDERS']);
    expect(values(none.data.ORDERS, 1).every(v => v === null)).toBe(true);
    const some = await run(project([customer(), child()],
      { settings: { tables: { ORDERS: { rows: 5000 } } } }), ['CUSTOMER', 'ORDERS']);
    const share = values(some.data.ORDERS, 1).filter(v => v === null).length / 5000;
    expect(share).toBeGreaterThan(0.27);
    expect(share).toBeLessThan(0.33);
  });

  test('rows per parent: every parent gets between min and max children', async () => {
    const { data, plan } = await run(shopOf({
      CUSTOMER: { rows: 200 },
      ORDERS: {
        perParent: {
          field: 'ORDERS.CUSTOMER_ID',
          min: 2,
          max: 5,
        },
      },
    }), ['CUSTOMER', 'ORDERS']);
    expect(plan.problems).toEqual([]);
    const counts = {};
    values(data.ORDERS, 1).forEach((v) => {
      counts[v] = (counts[v] || 0) + 1;
    });
    expect(Object.keys(counts)).toHaveLength(200);
    const sizes = Object.values(counts);
    expect(Math.min(...sizes)).toBe(2);
    expect(Math.max(...sizes)).toBe(5);
    // all four sizes occur about equally often
    [2, 3, 4, 5].forEach(n => expect(sizes.filter(s => s === n).length).toBeGreaterThan(25));
    expect(data.ORDERS).toHaveLength(sizes.reduce((a, b) => a + b, 0));
    // the children of one parent follow each other
    const seen = values(data.ORDERS, 1).filter((v, i, list) => i === 0 || list[i - 1] !== v);
    expect(seen).toEqual(values(data.CUSTOMER, 0));
  });

  test('rows per parent: total is announced up front, min 0 leaves parents without children', async () => {
    const ds = shopOf({
      CUSTOMER: { rows: 50 },
      ORDERS: {
        perParent: {
          field: 'ORDERS.CUSTOMER_ID',
          min: 0,
          max: 1,
        },
      },
    });
    const plan = buildPlan(ds, { entityIds: ['CUSTOMER', 'ORDERS'] });
    const generator = createGenerator(ds, plan, { seed: 3 });
    await generator.table('CUSTOMER');
    const totals = [];
    const { rows } = await collect(generator, 'ORDERS', {
      batchSize: 7,
      onBatch: (batch, done, total) => totals.push(total),
    });
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.length).toBeLessThan(40);
    expect(new Set(totals)).toEqual(new Set([rows.length]));
    expect(distinct(values(rows, 1))).toBe(rows.length);
  });

  test('a composite key copies all its columns from one parent row', async () => {
    const parent = entity('P', [field('A', 'INT', pk), field('B', 'VARCHAR', {
      ...pk,
      len: 8,
    })]);
    const child = entity('C', [field('ID', 'INT', pk), field('PA', 'INT'), field('PB', 'VARCHAR', { len: 8 })],
      { correlations: [link('C.PA', 'P', 'A'), link('C.PB', 'P', 'B')] });
    const { data } = await run(project([parent, child]), ['P', 'C']);
    const pairs = data.P.map(r => `${r[0]}|${r[1]}`);
    data.C.forEach(r => expect(pairs).toContain(`${r[1]}|${r[2]}`));
    expect(distinct(data.C.map(r => r[1]))).toBeGreaterThan(30);
  });

  test('a table that points at itself uses earlier rows', async () => {
    const tree = notNull => project([entity('NODE', [field('ID', 'INT', pk),
      field('PARENT_ID', 'INT', { notNull })], { correlations: [link('NODE.PARENT_ID', 'NODE', 'ID')] })]);
    const loose = (await run(tree(false), ['NODE'])).data.NODE;
    expect(loose[0][1]).toBeNull();
    loose.slice(1).forEach((r, i) => expect(values(loose.slice(0, i + 1), 0)).toContain(r[1]));
    const strict = (await run(tree(true), ['NODE'])).data.NODE;
    // the first row can only be its own parent
    expect(strict[0][1]).toBe(strict[0][0]);
    strict.forEach((r, i) => expect(values(strict.slice(0, i + 1), 0)).toContain(r[1]));
  });

  test('a cycle: the key that was cut stays NULL', async () => {
    const ds = project([
      entity('A', [field('ID', 'INT', pk), field('B_ID', 'INT', { notNull: true })],
        { correlations: [link('A.B_ID', 'B', 'ID')] }),
      entity('B', [field('ID', 'INT', pk), field('A_ID', 'INT')],
        { correlations: [link('B.A_ID', 'A', 'ID')] }),
    ]);
    const { data } = await run(ds, ['A', 'B']);
    expect(values(data.B, 1).every(v => v === null)).toBe(true);
    values(data.A, 1).forEach(v => expect(values(data.B, 0)).toContain(v));
  });
});

describe('null rate', () => {
  test('about the given share of a nullable column is NULL, key columns never', async () => {
    const rules = [rule('c', 'constant', { value: 'x' }, { nullRate: 20 })];
    const use = more => ({
      len: 5,
      testData: { rule: 'c' },
      ...more,
    });
    const ds = project([entity('T', [
      field('ID', 'INT', pk),
      field('A', 'VARCHAR', use()),
      field('B', 'VARCHAR', use({ notNull: true })),
      field('C', 'VARCHAR', use({
        testData: {
          rule: 'c',
          nullRate: 75,
        },
      })),
      field('D', 'VARCHAR', { len: 5 }),
      field('E', 'VARCHAR', use({
        testData: {
          rule: 'c',
          nullRate: 100,
        },
      })),
    ])], {
      rules,
      settings: { tables: { T: { rows: 10000 } } },
    });
    const { data } = await run(ds, ['T']);
    const share = at => values(data.T, at).filter(v => v === null).length / 10000;
    expect(share(0)).toBe(0);
    expect(share(1)).toBeGreaterThan(0.18);
    expect(share(1)).toBeLessThan(0.22);
    expect(share(2)).toBe(0);
    expect(share(3)).toBeGreaterThan(0.73);
    expect(share(3)).toBeLessThan(0.77);
    expect(share(4)).toBe(0);
    expect(share(5)).toBe(1);
  });

  test('a column of a unique index is never NULL', async () => {
    const ds = project([entity('T', [field('ID', 'INT', pk), field('A', 'VARCHAR', {
      len: 12,
      testData: { nullRate: 50 },
    })], {
      indexes: [{
        unique: true,
        fields: [{ fieldDefKey: 'T.A' }],
      }],
    })]);
    const { data } = await run(ds, ['T']);
    expect(values(data.T, 1).filter(v => v === null)).toHaveLength(0);
  });
});

describe('auto increment', () => {
  const auto = () => entity('T', [field('ID', 'INT', {
    ...pk,
    autoIncrement: true,
  }), field('NAME', 'VARCHAR', { len: 10 })]);
  const child = () => entity('C', [field('ID', 'INT', pk), field('T_ID', 'INT', { notNull: true })],
    { correlations: [link('C.T_ID', 'T', 'ID')] });

  test("mode 'generate' counts up from startAt, children use those numbers", async () => {
    const ds = project([auto(), child()], {
      settings: {
        tables: {
          T: {
            rows: 10,
            startAt: 1000,
          },
        },
      },
    });
    const { data } = await run(ds, ['T', 'C']);
    expect(values(data.T, 0)).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009]);
    values(data.C, 1).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(1009);
    });
    expect(distinct(values(data.C, 1))).toBe(10);
  });

  test("mode 'database' leaves the column out of the rows", async () => {
    const ds = project([auto()], { settings: { tables: { T: { autoIncrement: 'database' } } } });
    const { data, plan } = await run(ds, ['T']);
    expect(plan.tables[0].columns.map(c => c.defKey)).toEqual(['NAME']);
    data.T.forEach(r => expect(r).toHaveLength(1));
    // the other column is the same as when the numbers are generated
    const kept = await run(project([auto()]), ['T']);
    expect(values(kept.data.T, 1)).toEqual(values(data.T, 0));
  });
});
