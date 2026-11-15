import { buildPlan, MAX_ROWS } from '../src/lib/testdata/plan';
import { stableOrder, orderTables } from '../src/lib/testdata/plan_order';
import {
  project, entity, field, link, rule,
} from './testdata_planner_helpers';

jest.mock('../src/lib/testdata/model', () => require('./testdata_planner_helpers').fakeModel);
jest.mock('../src/lib/testdata/values', () => require('./testdata_planner_helpers').fakeValues);

const pk = {
  primaryKey: true,
  notNull: true,
};
const customer = () => entity('CUSTOMER', [field('ID', 'INT', pk), field('NAME', 'VARCHAR', { len: 20 })]);
const orders = (more = {}) => entity('ORDERS', [
  field('ID', 'INT', pk),
  field('CUSTOMER_ID', 'INT', { notNull: true }),
  field('NOTE', 'VARCHAR', { len: 50 }),
], {
  correlations: [link('ORDERS.CUSTOMER_ID', 'CUSTOMER', 'ID')],
  ...more,
});
const lines = () => entity('LINE', [
  field('ORDER_ID', 'INT', pk), field('NO', 'INT', pk), field('QTY', 'INT'),
], { correlations: [link('LINE.ORDER_ID', 'ORDERS', 'ID')] });
const codes = (plan, code) => plan.problems.filter(p => p.code === code);
const names = plan => plan.tables.map(t => t.defKey);
const tableOf = (plan, id) => plan.tables.find(t => t.entityId === id);

describe('order and parents', () => {
  test('parents come before children whatever the order of selection', () => {
    const ds = project([lines(), orders(), customer()]);
    const plan = buildPlan(ds, { entityIds: ['LINE', 'ORDERS', 'CUSTOMER'] });
    expect(names(plan)).toEqual(['CUSTOMER', 'ORDERS', 'LINE']);
    expect(plan.problems).toEqual([]);
    expect(plan.missingParents).toEqual([]);
    expect(tableOf(plan, 'ORDERS')).toMatchObject({
      entityId: 'ORDERS',
      defKey: 'ORDERS',
      rows: 100,
      perParent: null,
      autoIncrement: 'generate',
      startAt: 1,
      foreignKeys: [{
        fieldId: 'ORDERS.CUSTOMER_ID',
        refEntityId: 'CUSTOMER',
        refFieldId: 'CUSTOMER.ID',
        source: 'generated',
        group: 0,
      }],
    });
    expect(tableOf(plan, 'ORDERS').columns.map(c => c.defKey)).toEqual(['ID', 'CUSTOMER_ID', 'NOTE']);
  });

  test('independent tables keep the order they were chosen in', () => {
    const ds = project([customer(), entity('B', [field('ID', 'INT', pk)]),
      entity('A', [field('ID', 'INT', pk)])]);
    expect(names(buildPlan(ds, { entityIds: ['B', 'CUSTOMER', 'A'] }))).toEqual(['B', 'CUSTOMER', 'A']);
  });

  test('a parent that is not selected is reported until the user decides', () => {
    const ds = project([lines(), orders(), customer()]);
    const plan = buildPlan(ds, { entityIds: ['ORDERS'] });
    expect(names(plan)).toEqual(['ORDERS']);
    expect(plan.missingParents).toEqual([{
      entityId: 'ORDERS',
      fieldId: 'ORDERS.CUSTOMER_ID',
      refEntityId: 'CUSTOMER',
    }]);
    expect(plan.tables[0].foreignKeys[0].source).toBe('missing');
    expect(plan.needs.parentKeys).toEqual([]);
  });

  test("answer 'generate' adds the parent, whose own parents are then missing in turn", () => {
    const ds = project([lines(), orders(), customer()]);
    const plan = buildPlan(ds, {
      entityIds: ['LINE'],
      external: { ORDERS: 'generate' },
    });
    expect(names(plan)).toEqual(['ORDERS', 'LINE']);
    expect(plan.missingParents).toEqual([{
      entityId: 'ORDERS',
      fieldId: 'ORDERS.CUSTOMER_ID',
      refEntityId: 'CUSTOMER',
    }]);
    const all = buildPlan(ds, {
      entityIds: ['LINE'],
      external: {
        ORDERS: 'generate',
        CUSTOMER: 'generate',
      },
    });
    expect(names(all)).toEqual(['CUSTOMER', 'ORDERS', 'LINE']);
    expect(all.missingParents).toEqual([]);
  });

  test("answer 'database' takes the keys from the database", () => {
    const ds = project([lines(), orders(), customer()]);
    const plan = buildPlan(ds, {
      entityIds: ['ORDERS'],
      external: { CUSTOMER: 'database' },
    });
    expect(plan.missingParents).toEqual([]);
    expect(plan.tables[0].foreignKeys[0].source).toBe('database');
    expect(plan.needs.parentKeys).toEqual([{
      entityId: 'CUSTOMER',
      fieldId: 'CUSTOMER.ID',
    }]);
    expect(plan.problems).toEqual([]);
  });

  test('unknown tables and dangling correlations', () => {
    const ds = project([orders({
      correlations: [link('ORDERS.CUSTOMER_ID', 'GONE', 'ID'), link('ORDERS.NOPE', 'ORDERS', 'ID')],
    })]);
    const plan = buildPlan(ds, { entityIds: ['ORDERS', 'NOPE'] });
    expect(plan.problems).toEqual([{
      code: 'entityNotFound',
      entityId: 'NOPE',
    }]);
    expect(plan.tables[0].foreignKeys).toEqual([]);
    expect(buildPlan(ds).tables).toEqual([]);
  });
});

describe('self references and cycles', () => {
  const tree = notNull => entity('NODE', [field('ID', 'INT', pk), field('PARENT_ID', 'INT', { notNull })],
    { correlations: [link('NODE.PARENT_ID', 'NODE', 'ID')] });

  test('a table may point at itself', () => {
    const plan = buildPlan(project([tree(false)]), { entityIds: ['NODE'] });
    expect(plan.problems).toEqual([]);
    expect(plan.missingParents).toEqual([]);
    expect(plan.tables[0].foreignKeys[0]).toMatchObject({
      source: 'generated',
      self: true,
    });
    expect(buildPlan(project([tree(true)]), { entityIds: ['NODE'] }).problems).toEqual([]);
  });

  test('a column that points at itself cannot be filled', () => {
    const ds = project([entity('X', [field('ID', 'INT', pk)],
      { correlations: [link('X.ID', 'X', 'ID')] })]);
    expect(buildPlan(ds, { entityIds: ['X'] }).problems).toEqual([{
      code: 'selfReference',
      entityId: 'X',
      fieldId: 'X.ID',
      detail: ['ID'],
    }]);
  });

  const pair = (aNull, bNull) => [
    entity('A', [field('ID', 'INT', pk), field('B_ID', 'INT', { notNull: !aNull })],
      { correlations: [link('A.B_ID', 'B', 'ID')] }),
    entity('B', [field('ID', 'INT', pk), field('A_ID', 'INT', { notNull: !bNull })],
      { correlations: [link('B.A_ID', 'A', 'ID')] }),
  ];

  test('a cycle is cut at a key that may be NULL', () => {
    const plan = buildPlan(project(pair(false, true)), { entityIds: ['A', 'B'] });
    expect(plan.problems).toEqual([]);
    // B.A_ID stays NULL, so B goes first
    expect(names(plan)).toEqual(['B', 'A']);
    expect(tableOf(plan, 'B').foreignKeys[0].deferred).toBe(true);
    expect(tableOf(plan, 'A').foreignKeys[0].deferred).toBeUndefined();
  });

  test('a cycle of mandatory keys is a problem', () => {
    const plan = buildPlan(project(pair(false, false)), { entityIds: ['A', 'B'] });
    expect(plan.problems).toEqual([{
      code: 'cycle',
      entityId: 'A',
      fieldId: 'A.B_ID',
      detail: { refEntityId: 'B' },
    }]);
    expect(plan.tables).toHaveLength(2);
  });

  test('ordering helpers', () => {
    expect(stableOrder(4, [[3], [], [1], []])).toEqual({
      order: [1, 2, 3, 0],
      cycle: null,
    });
    const blocked = stableOrder(4, [[], [2], [1], [1]]);
    expect(blocked.order).toEqual([0, 1, 2, 3]);
    expect(blocked.cycle.sort()).toEqual([1, 2]);
    // 0 -> 1 -> 2 -> 0, only the edge 2 -> 0 is nullable
    const edges = [[0, 1, false], [1, 2, false], [2, 0, true]].map(([child, parent, nullable]) => ({
      child,
      parent,
      nullable,
    }));
    const result = orderTables(3, edges);
    expect(result.order).toEqual([2, 1, 0]);
    expect(result.cut).toEqual([edges[2]]);
    expect(result.stuck).toEqual([]);
  });
});

describe('row counts', () => {
  const make = (tables, more = {}) => project([lines(), orders(), customer()], {
    settings: {
      tables,
      ...more,
    },
  });
  const ids = ['CUSTOMER', 'ORDERS', 'LINE'];

  test('rows of the table, else the default of the project, else 100', () => {
    const plan = buildPlan(make({ CUSTOMER: { rows: 7 } }, { defaultRows: 30 }),
      { entityIds: ids });
    expect(plan.tables.map(t => t.rows)).toEqual([7, 30, 30]);
    expect(buildPlan(make({}), { entityIds: ids }).tables.map(t => t.rows))
      .toEqual([100, 100, 100]);
    expect(buildPlan(make({ CUSTOMER: { rows: 0 } }), { entityIds: ids }).tables[0].rows).toBe(0);
  });

  test('rows per parent win over a fixed number', () => {
    const per = {
      field: 'ORDERS.CUSTOMER_ID',
      min: 1,
      max: 5,
    };
    const plan = buildPlan(make({
      CUSTOMER: { rows: 10 },
      ORDERS: {
        rows: 999,
        perParent: per,
      },
    }), { entityIds: ids });
    expect(plan.problems).toEqual([]);
    expect(tableOf(plan, 'ORDERS')).toMatchObject({
      rows: null,
      perParent: per,
      maxRows: 50,
    });
  });

  test('rows per parent need a foreign key and a sensible range', () => {
    const bad = buildPlan(make({
      ORDERS: {
        perParent: {
          field: 'ORDERS.NOTE',
          min: 1,
          max: 2,
        },
      },
      LINE: {
        perParent: {
          field: 'LINE.ORDER_ID',
          min: 3,
          max: 2,
        },
      },
    }), { entityIds: ids });
    expect(bad.problems.map(p => [p.code, p.fieldId])).toEqual([
      ['perParentNotForeignKey', 'ORDERS.NOTE'], ['perParentRange', 'LINE.ORDER_ID']]);
    expect(bad.tables.map(t => t.rows)).toEqual([100, 100, 100]);
  });

  test('more than a million rows per table is refused', () => {
    const plan = buildPlan(make({
      CUSTOMER: { rows: MAX_ROWS },
      ORDERS: { rows: MAX_ROWS + 1 },
      LINE: {
        perParent: {
          field: 'LINE.ORDER_ID',
          min: 1,
          max: 2,
        },
      },
    }), { entityIds: ids });
    expect(codes(plan, 'tooManyRows')).toEqual([{
      code: 'tooManyRows',
      entityId: 'ORDERS',
      detail: {
        rows: MAX_ROWS + 1,
        max: MAX_ROWS,
      },
    }, {
      code: 'tooManyRows',
      entityId: 'LINE',
      detail: {
        rows: (MAX_ROWS + 1) * 2,
        max: MAX_ROWS,
      },
    }]);
  });

  test('a number of rows that is no number', () => {
    const plan = buildPlan(make({ CUSTOMER: { rows: -3 } }), { entityIds: ['CUSTOMER'] });
    expect(plan.problems).toEqual([{
      code: 'badRows',
      entityId: 'CUSTOMER',
      detail: { rows: -3 },
    }]);
  });
});

describe('auto increment', () => {
  const auto = more => entity('T', [field('ID', 'INT', {
    ...pk,
    autoIncrement: true,
  }), field('NAME', 'VARCHAR', { len: 10 })], more);

  test("mode 'generate' keeps the column, 'database' leaves it out", () => {
    const keep = buildPlan(project([auto()], { settings: { tables: { T: { startAt: 500 } } } }),
      { entityIds: ['T'] });
    expect(keep.tables[0]).toMatchObject({
      autoIncrement: 'generate',
      startAt: 500,
    });
    expect(keep.tables[0].columns.map(c => c.defKey)).toEqual(['ID', 'NAME']);
    const drop = buildPlan(project([auto()],
      { settings: { tables: { T: { autoIncrement: 'database' } } } }), { entityIds: ['T'] });
    expect(drop.tables[0].autoIncrement).toBe('database');
    expect(drop.tables[0].columns.map(c => c.defKey)).toEqual(['NAME']);
    expect(drop.tables[0].uniques).toEqual([]);
  });

  test('children cannot point at numbers the database hands out', () => {
    const child = entity('C', [field('ID', 'INT', pk), field('T_ID', 'INT')],
      { correlations: [link('C.T_ID', 'T', 'ID')] });
    const ds = project([auto(), child], { settings: { tables: { T: { autoIncrement: 'database' } } } });
    expect(buildPlan(ds, { entityIds: ['T', 'C'] }).problems).toEqual([{
      code: 'autoIncrementParentKey',
      entityId: 'C',
      fieldId: 'C.T_ID',
      detail: {
        refEntityId: 'T',
        refFieldId: 'T.ID',
      },
    }]);
  });
});

describe('rules', () => {
  const table = (fields, more) => entity('T', [field('ID', 'INT', pk), ...fields], more);

  test('files and queries the caller has to load', () => {
    const rules = [rule('f1', 'file', { path: '/tmp/a.txt' }), rule('q1', 'query', { sql: 'select 1' })];
    const ds = project([table([
      field('A', 'VARCHAR', { testData: { rule: 'f1' } }),
      field('B', 'VARCHAR', { testData: { rule: 'f1' } }),
      field('C', 'VARCHAR', { domain: 'dom' }),
    ])], {
      rules,
      domainRules: { dom: 'q1' },
    });
    expect(buildPlan(ds, { entityIds: ['T'] }).needs).toEqual({
      files: ['/tmp/a.txt'],
      queries: ['select 1'],
      parentKeys: [],
    });
  });

  test('a rule that does not validate', () => {
    const ds = project([table([field('A', 'VARCHAR', { testData: { rule: 'b' } })])],
      { rules: [rule('b', 'broken')] });
    expect(buildPlan(ds, { entityIds: ['T'] }).problems).toEqual([{
      code: 'badRule',
      entityId: 'T',
      fieldId: 'T.A',
      detail: ['brokenRule'],
    }]);
  });

  test('formulas: unknown columns, circles and broken text', () => {
    const rules = [rule('ab', 'expr', { expr: '[B] & [C]' }), rule('ba', 'expr', { expr: '[A]' }),
      rule('zz', 'expr', { expr: '[ZZ]' }), rule('me', 'expr', { expr: '[D]' }),
      rule('no', 'expr', { expr: '!!' })];
    const use = id => ({ testData: { rule: id } });
    const ds = project([table([field('A', 'VARCHAR', use('ab')), field('B', 'VARCHAR', use('ba')),
      field('C', 'VARCHAR', use('zz')), field('D', 'VARCHAR', use('me')),
      field('E', 'VARCHAR', use('no'))])], { rules });
    const found = buildPlan(ds, { entityIds: ['T'] }).problems.map(p => [p.code, p.fieldId, p.detail]);
    expect(found).toEqual([
      ['exprUnknownColumn', 'T.C', 'ZZ'],
      ['badRule', 'T.E', ['exprSyntax']],
      ['exprCycle', 'T.D', ['D']],
      ['exprCycle', 'T.A', ['A', 'B']],
    ]);
  });
});
