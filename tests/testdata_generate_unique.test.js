import { buildPlan } from '../src/lib/testdata/plan';
import { createGenerator, previewTable } from '../src/lib/testdata/generate';
import { createHashSet, createUniqueTracker } from '../src/lib/testdata/generate_unique';
import { createSchedule } from '../src/lib/testdata/generate_fk';
import { createRandom } from '../src/lib/testdata/random';
import shop from '../src/lib/template/电商商城.pdma.json';
import {
  project, entity, field, link, rule, collect, columnAt,
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

describe('uniqueness', () => {
  const few = (n, more = {}) => rule(`few${n}`, 'number', {
    min: 1,
    max: n,
  }, more);

  test('a primary key on few values gets every value once', async () => {
    const ds = project([entity('T', [field('ID', 'INT', {
      ...pk,
      testData: { rule: 'few120' },
    })])], { rules: [few(120)] });
    const { data, plan } = await run(ds, ['T']);
    expect(plan.problems).toEqual([]);
    expect(distinct(values(data.T, 0))).toBe(100);
    // completely full: random tries run out, the step by step search finds the rest
    const full = project([entity('T', [field('ID', 'INT', {
      ...pk,
      len: 3,
      testData: { rule: 'few100' },
    })])], { rules: [few(100)] });
    expect(distinct(values((await run(full, ['T'])).data.T, 0))).toBe(100);
  });

  test('a rule marked unique, text compared without case', async () => {
    const letters = rule('l', 'list', {
      items: ['a', 'A', 'b', 'B', 'c', 'd'].map(value => ({ value })),
    }, { unique: true });
    const ds = project([entity('T', [field('ID', 'INT', pk), field('CODE', 'VARCHAR', {
      len: 10,
      testData: { rule: 'l' },
    })])], {
      rules: [letters],
      settings: { tables: { T: { rows: 6 } } },
    });
    const { data } = await run(ds, ['T']);
    expect(distinct(values(data.T, 1).map(v => v.toLowerCase()))).toBe(6);
    // four of them had to be changed, and still fit the column
    values(data.T, 1).forEach(v => expect(v.length).toBeLessThanOrEqual(10));
  });

  test('composite primary key and composite unique index are unique as tuples', async () => {
    const ds = project([entity('T', [
      field('A', 'INT', {
        ...pk,
        testData: { rule: 'few10' },
      }),
      field('B', 'INT', {
        ...pk,
        testData: { rule: 'few10' },
      }),
      field('C', 'INT', { testData: { rule: 'few10' } }),
      field('D', 'INT', { testData: { rule: 'few12' } }),
    ], {
      indexes: [{
        unique: true,
        fields: [{ fieldDefKey: 'T.C' }, { fieldDefKey: 'T.D' }],
      }],
    })], {
      rules: [few(10), few(12)],
      settings: { tables: { T: { rows: 95 } } },
    });
    const { data, plan } = await run(ds, ['T']);
    expect(plan.problems).toEqual([]);
    expect(distinct(data.T.map(r => `${r[0]}|${r[1]}`))).toBe(95);
    expect(distinct(data.T.map(r => `${r[2]}|${r[3]}`))).toBe(95);
    // the single columns do repeat
    expect(distinct(values(data.T, 0))).toBeLessThanOrEqual(10);
  });

  test('a link table fills up to every combination of its parents', async () => {
    const ds = project([
      entity('U', [field('ID', 'INT', pk)]), entity('R', [field('ID', 'INT', pk)]),
      entity('UR', [field('U_ID', 'INT', pk), field('R_ID', 'INT', pk)],
        { correlations: [link('UR.U_ID', 'U', 'ID'), link('UR.R_ID', 'R', 'ID')] }),
    ], {
      settings: {
        tables: {
          U: { rows: 6 },
          R: { rows: 5 },
          UR: { rows: 29 },
        },
      },
    });
    const { data, plan } = await run(ds, ['U', 'R', 'UR']);
    expect(plan.problems).toEqual([]);
    expect(distinct(data.UR.map(r => `${r[0]}|${r[1]}`))).toBe(29);
  });

  test('a unique foreign key gives every parent at most one child', async () => {
    const ds = project([customer(), orders({
      indexes: [{
        unique: true,
        fields: [{ fieldDefKey: 'ORDERS.CUSTOMER_ID' }],
      }],
    })], { settings: { tables: { ORDERS: { rows: 100 } } } });
    const { data } = await run(ds, ['CUSTOMER', 'ORDERS']);
    expect(distinct(values(data.ORDERS, 1))).toBe(100);
  });

  test('no more values is an error with a code', async () => {
    const ds = project([entity('T', [field('ID', 'INT', pk), field('DAY', 'DATE', {
      testData: { rule: 'u' },
    })])], { rules: [rule('u', 'constant', { value: '2024-01-01' }, { unique: true })] });
    const plan = buildPlan(ds, { entityIds: ['T'] });
    expect(plan.problems.map(p => p.code)).toEqual(['uniqueImpossible']);
    await expect(createGenerator(ds, plan, {}).table('T')).rejects.toMatchObject({
      code: 'uniqueExhausted',
      entityId: 'T',
      fieldId: 'T.DAY',
      row: 1,
    });
  });

  test('hash set and tracker', () => {
    const set = createHashSet(4);
    for (let i = 0; i < 5000; i += 1) {
      expect(set.has(`k${i}`)).toBe(false);
      set.add(`k${i}`);
    }
    expect(set.size()).toBe(5000);
    for (let i = 0; i < 5000; i += 1) {
      expect(set.has(`k${i}`)).toBe(true);
    }
    expect(set.has('k5000')).toBe(false);
    const tracker = createUniqueTracker([[0], [1, 2]], 10);
    expect(tracker.violated(['Ab ', 1, 'x'])).toBeNull();
    tracker.accept();
    expect(tracker.violated(['aB', 2, 'x'])).toEqual([0]);
    expect(tracker.violated(['c', 1, 'X'])).toEqual([1]);
    expect(tracker.violated(['c', '1', 'y'])).toBeNull();
    // 1 and '1x' must not be confused with '1', 'x'
    expect(tracker.violated(['d', '1x', ''])).toBeNull();
  });

  test('schedule of rows per parent', () => {
    const make = () => createRandom(9).fork('x');
    const schedule = createSchedule(1000, 0, 3, make);
    const counts = new Array(1000).fill(0);
    for (let i = 0; i < schedule.total; i += 1) {
      counts[schedule.next()] += 1;
    }
    expect(Math.max(...counts)).toBe(3);
    expect(Math.min(...counts)).toBe(0);
    expect(schedule.total).toBeGreaterThan(1300);
    expect(schedule.total).toBeLessThan(1700);
    expect(createSchedule(10, 2, 2, make).total).toBe(20);
  });
});

describe('rules and formulas', () => {
  test('a formula is worked out after the columns it reads', async () => {
    const rules = [rule('sum', 'expr', { expr: '[B] [C]' }), rule('seq', 'sequence', { start: 10 }),
      rule('twice', 'expr', { expr: '[A]' })];
    const use = id => ({ testData: { rule: id } });
    const ds = project([entity('T', [
      field('Z', 'VARCHAR', use('twice')), field('A', 'VARCHAR', use('sum')),
      field('B', 'INT', use('seq')), field('C', 'INT', use('seq')),
    ])], {
      rules,
      settings: { tables: { T: { rows: 3 } } },
    });
    const { data } = await run(ds, ['T']);
    expect(data.T).toEqual([['10+10', '10+10', 10, 10], ['11+11', '11+11', 11, 11],
      ['12+12', '12+12', 12, 12]]);
  });

  test('a formula circle and a broken rule stop the table with their code', async () => {
    const rules = [rule('a', 'expr', { expr: '[B]' }), rule('b', 'expr', { expr: '[A]' }),
      rule('x', 'broken')];
    const use = id => ({ testData: { rule: id } });
    const circle = project([entity('T', [field('A', 'INT', use('a')), field('B', 'INT', use('b'))])],
      { rules });
    await expect(createGenerator(circle, buildPlan(circle, { entityIds: ['T'] }), {}).table('T'))
      .rejects.toMatchObject({
        code: 'exprCycle',
        entityId: 'T',
      });
    const broken = project([entity('T', [field('A', 'INT', use('x'))])], { rules });
    await expect(createGenerator(broken, buildPlan(broken, { entityIds: ['T'] }), {}).table('T'))
      .rejects.toMatchObject({
        code: 'brokenRule',
        entityId: 'T',
        fieldId: 'T.A',
      });
  });

  test('lists loaded by the caller reach the rules', async () => {
    const ds = project([entity('T', [field('A', 'VARCHAR', { testData: { rule: 'f' } })])],
      { rules: [rule('f', 'file', { path: '/tmp/x.txt' })] });
    const plan = buildPlan(ds, { entityIds: ['T'] });
    await expect(createGenerator(ds, plan, {}).table('T')).rejects.toMatchObject({ code: 'listMissing' });
    const lists = { file: { '/tmp/x.txt': ['p', 'q'] } };
    const { rows } = await collect(createGenerator(ds, plan, { lists }), 'T');
    expect([...new Set(values(rows, 0))].sort()).toEqual(['p', 'q']);
  });
});

describe('limits', () => {
  test('more than a million rows is refused when the table starts', async () => {
    const ds = shopOf({ CUSTOMER: { rows: 1000001 } });
    const plan = buildPlan(ds, { entityIds: ['CUSTOMER'] });
    expect(plan.problems.map(p => p.code)).toEqual(['tooManyRows']);
    await expect(createGenerator(ds, plan, {}).table('CUSTOMER'))
      .rejects.toMatchObject({ code: 'tooManyRows' });
  });
});

describe('preview', () => {
  test('first rows of a child, parents made on the way', async () => {
    const ds = shopOf({
      CUSTOMER: { rows: 5000 },
      ORDERS: { rows: 5000 },
    });
    const plan = buildPlan(ds, { entityIds: ['CUSTOMER', 'ORDERS'] });
    const preview = await previewTable(ds, plan, 'ORDERS', 10, { seed: 7 });
    expect(preview.columns.map(c => c.defKey)).toEqual(['ID', 'CUSTOMER_ID', 'NOTE']);
    expect(preview.rows).toHaveLength(10);
    preview.rows.forEach(r => expect(typeof r[1]).toBe('number'));
    // columns that do not hang on a parent are the ones of the full run
    const full = await run(ds, ['CUSTOMER', 'ORDERS']);
    expect(preview.rows.map(r => r[2])).toEqual(full.data.ORDERS.slice(0, 10).map(r => r[2]));
    const parent = await previewTable(ds, plan, 'CUSTOMER', 10, { seed: 7 });
    expect(parent.rows).toEqual(full.data.CUSTOMER.slice(0, 10));
  });

  test('keys that were not loaded show as NULL instead of failing', async () => {
    const ds = shopOf();
    const plan = buildPlan(ds, { entityIds: ['ORDERS'] });
    const preview = await previewTable(ds, plan, 'ORDERS', 3, {});
    expect(preview.rows.map(r => r[1])).toEqual([null, null, null]);
    await expect(previewTable(ds, plan, 'NOPE', 3, {})).rejects.toMatchObject({ code: 'tableNotPlanned' });
  });
});

describe('real template', () => {
  const id = key => shop.entities.find(e => e.defKey === key).id;

  test('all tables: keys are unique and every foreign key finds its parent', async () => {
    const ds = {
      ...shop,
      profile: {
        ...shop.profile,
        testData: {
          settings: {
            tables: {
              [id('BUYR_ITEM')]: { rows: 500 },
              [id('BUYR_CART')]: {
                perParent: {
                  field: shop.entities.find(e => e.defKey === 'BUYR_CART').fields
                    .find(f => f.defKey === 'USER_ID').id,
                  min: 1,
                  max: 3,
                },
              },
            },
          },
        },
      },
    };
    const { plan, data } = await run(ds, shop.entities.map(e => e.id));
    expect(plan.problems).toEqual([]);
    plan.tables.forEach((t) => {
      const rows = data[t.entityId];
      expect(rows.length).toBe(t.rows === null ? rows.length : t.rows);
      rows.forEach(r => expect(r).toHaveLength(t.columns.length));
      t.uniques.forEach((set) => {
        const at = set.map(f => t.columns.findIndex(c => c.id === f));
        expect(distinct(rows.map(r => at.map(p => r[p]).join('|')))).toBe(rows.length);
      });
      t.foreignKeys.forEach((k) => {
        const parent = plan.tables.find(p => p.entityId === k.refEntityId);
        const keys = new Set(values(data[k.refEntityId],
          parent.columns.findIndex(c => c.id === k.refFieldId)));
        const mine = t.columns.findIndex(c => c.id === k.fieldId);
        rows.forEach(r => expect(r[mine] === null || keys.has(r[mine])).toBe(true));
      });
    });
    const carts = data[id('BUYR_CART')];
    expect(carts.length).toBeGreaterThanOrEqual(100);
    expect(carts.length).toBeLessThanOrEqual(300);
    expect(data[id('BUYR_ITEM')]).toHaveLength(500);
    // mandatory columns are filled
    const order = plan.tables.find(t => t.defKey === 'BUYR_ORDER');
    const cart = columnAt(plan, order.entityId, 'CART_ID');
    expect(values(data[order.entityId], cart).every(v => v !== null)).toBe(true);
  });
});
