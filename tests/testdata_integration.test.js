// Planner and generator against the real rule modules (nothing mocked).
import { buildPlan } from '../src/lib/testdata/plan';
import { createGenerator, previewTable } from '../src/lib/testdata/generate';
import { setTestData, getTestData } from '../src/lib/testdata/model';
import shop from '../src/lib/template/电商商城.pdma.json';
import {
  project, entity, field, link, rule, collect,
} from './testdata_planner_helpers';

const now = new Date(2024, 5, 1, 12, 0, 0);
const pk = {
  primaryKey: true,
  notNull: true,
};
const runAll = async (ds, ids, options = {}) => {
  const plan = buildPlan(ds, { entityIds: ids });
  const generator = createGenerator(ds, plan, {
    seed: 11,
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
  };
};

const CHECKS = {
  int: v => Number.isInteger(v),
  decimal: v => typeof v === 'number',
  string: v => typeof v === 'string',
  date: v => /^\d{4}-\d\d-\d\d$/.test(v),
  datetime: v => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v),
  time: v => /^\d\d:\d\d:\d\d$/.test(v),
  bool: v => typeof v === 'boolean',
  binary: v => typeof v === 'string',
};

test('real template with automatic rules: valid values, unique keys, matching foreign keys', async () => {
  const { plan, data } = await runAll(shop, shop.entities.map(e => e.id));
  expect(plan.problems).toEqual([]);
  expect(plan.tables).toHaveLength(11);
  plan.tables.forEach((t) => {
    const rows = data[t.entityId];
    expect(rows).toHaveLength(100);
    t.columns.forEach((c, at) => rows.forEach((r) => {
      const v = r[at];
      if (v === null) {
        expect(c.notNull || c.primaryKey).toBe(false);
      } else {
        expect([c.defKey, v, CHECKS[c.kind](v)]).toEqual([c.defKey, v, true]);
        if (c.kind === 'string' && c.len) {
          expect(v.length).toBeLessThanOrEqual(c.len);
        }
      }
    }));
    t.uniques.forEach((set) => {
      const at = set.map(f => t.columns.findIndex(c => c.id === f));
      expect(new Set(rows.map(r => at.map(p => r[p]).join('|'))).size).toBe(rows.length);
    });
    t.foreignKeys.forEach((k) => {
      const parent = plan.tables.find(p => p.entityId === k.refEntityId);
      const keys = new Set(data[k.refEntityId]
        .map(r => r[parent.columns.findIndex(c => c.id === k.refFieldId)]));
      const mine = t.columns.findIndex(c => c.id === k.fieldId);
      rows.forEach(r => expect(r[mine] === null || keys.has(r[mine])).toBe(true));
    });
  });
  // the same seed gives the same data again
  const again = await runAll(shop, shop.entities.map(e => e.id));
  expect(again.data).toEqual(data);
});

test('rules of the project: sequence, list, formula, builtin, null rate, domain rule', async () => {
  const rules = [
    rule('seq', 'sequence', {
      start: 1,
      prefix: 'ORD',
      pad: 6,
    }),
    rule('status', 'list', {
      items: [{
        value: 'NEW',
        weight: 3,
      }, { value: 'PAID' }],
      order: 'random',
    }),
    rule('price', 'number', {
      min: 10,
      max: 500,
      decimals: 2,
    }),
    rule('qty', 'number', {
      min: 1,
      max: 9,
    }),
    rule('total', 'expr', { expr: 'round([PRICE] * [QTY], 2)' }),
    rule('name', 'builtin', { name: 'tw.name' }, { nullRate: 50 }),
    rule('mail', 'builtin', { name: 'email' }, { unique: true }),
  ];
  const use = (id, more = {}) => ({
    testData: { rule: id },
    ...more,
  });
  const base = project([
    entity('CUSTOMER', [
      field('ID', 'INT', {
        ...pk,
        autoIncrement: true,
      }),
      field('NAME', 'NVARCHAR', {
        len: 30,
        domain: 'dom-name',
      }),
      field('EMAIL', 'VARCHAR', use('mail', { len: 80 })),
    ]),
    entity('ORDERS', [
      field('NO', 'VARCHAR', use('seq', {
        ...pk,
        len: 12,
      })),
      field('CUSTOMER_ID', 'INT', { notNull: true }),
      field('TOTAL', 'DECIMAL', use('total', {
        len: 12,
        scale: 2,
      })),
      field('STATUS', 'VARCHAR', use('status', { len: 10 })),
      field('PRICE', 'DECIMAL', use('price', {
        len: 10,
        scale: 2,
      })),
      field('QTY', 'INT', use('qty')),
      field('CREATED', 'DATETIME'),
    ], { correlations: [link('ORDERS.CUSTOMER_ID', 'CUSTOMER', 'ID')] }),
  ]);
  const td = getTestData(base);
  const ds = setTestData(base, {
    ...td,
    rules,
    domainRules: { 'dom-name': 'name' },
    settings: {
      ...td.settings,
      tables: {
        CUSTOMER: {
          rows: 400,
          startAt: 100,
        },
        ORDERS: {
          perParent: {
            field: 'ORDERS.CUSTOMER_ID',
            min: 1,
            max: 3,
          },
        },
      },
    },
  });
  const { plan, data } = await runAll(ds, ['ORDERS', 'CUSTOMER']);
  expect(plan.problems).toEqual([]);
  expect(plan.tables.map(t => t.defKey)).toEqual(['CUSTOMER', 'ORDERS']);
  const customers = data.CUSTOMER;
  expect(customers.map(r => r[0])).toEqual(customers.map((r, i) => 100 + i));
  const nulls = customers.filter(r => r[1] === null).length;
  expect(nulls).toBeGreaterThan(160);
  expect(nulls).toBeLessThan(240);
  expect(new Set(customers.map(r => r[2].toLowerCase())).size).toBe(400);
  const rows = data.ORDERS;
  expect(rows.length).toBeGreaterThanOrEqual(400);
  expect(rows.length).toBeLessThanOrEqual(1200);
  expect(rows[0][0]).toBe('ORD000001');
  expect(rows[rows.length - 1][0]).toBe(`ORD${`${rows.length}`.padStart(6, '0')}`);
  rows.forEach((r) => {
    expect(r[1]).toBeGreaterThanOrEqual(100);
    expect(r[1]).toBeLessThan(500);
    expect(r[2]).toBeCloseTo(r[4] * r[5], 2);
    expect(['NEW', 'PAID']).toContain(r[3]);
    expect(r[6]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  });
  const fresh = rows.filter(r => r[3] === 'NEW').length / rows.length;
  expect(fresh).toBeGreaterThan(0.68);
  expect(fresh).toBeLessThan(0.82);
  const preview = await previewTable(ds, plan, 'ORDERS', 5, {
    seed: 11,
    now,
  });
  expect(preview.rows).toHaveLength(5);
  expect(preview.rows.map(r => r[0])).toEqual(rows.slice(0, 5).map(r => r[0]));
});

test('problems found with the real rules', () => {
  const rules = [rule('a', 'expr', { expr: '[B] + 1' }), rule('b', 'expr', { expr: '[A] + 1' }),
    rule('bad', 'list', { items: [] }), rule('syntax', 'expr', { expr: '[A] +* (' })];
  const use = id => ({ testData: { rule: id } });
  const base = project([entity('T', [field('ID', 'INT', pk), field('A', 'INT', use('a')),
    field('B', 'INT', use('b')), field('C', 'VARCHAR', use('bad')),
    field('D', 'VARCHAR', use('syntax'))])]);
  const ds = setTestData(base, {
    ...getTestData(base),
    rules,
  });
  const found = buildPlan(ds, { entityIds: ['T'] }).problems.map(p => [p.code, p.fieldId]);
  expect(found).toContainEqual(['exprCycle', 'T.A']);
  expect(found).toContainEqual(['badRule', 'T.C']);
  expect(found).toContainEqual(['badRule', 'T.D']);
});
