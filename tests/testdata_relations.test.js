import { buildPlan } from '../src/lib/testdata/plan';
import { fkGroups, childPairs } from '../src/lib/testdata/plan_keys';
import shop from '../src/lib/template/电商商城.pdma.json';
import {
  project, entity, field,
} from './testdata_planner_helpers';

jest.mock('../src/lib/testdata/model', () => require('./testdata_planner_helpers').fakeModel);
jest.mock('../src/lib/testdata/values', () => require('./testdata_planner_helpers').fakeValues);

// A relation is kept on one of its two tables. An imported model keeps it on the child
// (n : 1); the app itself keeps it on the table the line of a diagram starts from, which
// is the parent when the line was drawn from the parent (1 : n). Whichever it is, the
// table on the "many" end is the child and holds the foreign key.
const pk = { primaryKey: true, notNull: true };
const users = more => entity('USERS', [field('ID', 'INT', pk), field('NAME', 'VARCHAR', { len: 20 })], more);
const orders = more => entity('ORDERS', [field('ID', 'INT', pk),
  field('USER_ID', 'INT', { notNull: true })], more);
const onChild = { myField: 'ORDERS.USER_ID', refEntity: 'USERS', refField: 'USERS.ID' };
const onParent = { myField: 'USERS.ID', refEntity: 'ORDERS', refField: 'ORDERS.USER_ID' };
const pairsOf = (list, id) => {
  const byId = new Map(list.map(e => [e.id, e]));
  return childPairs(byId.get(id), byId);
};
const keysOf = (list, ids = list.map(e => e.id)) => {
  const plan = buildPlan(project(list), { entityIds: ids });
  return {
    order: plan.tables.map(t => t.defKey),
    keys: plan.tables.reduce((all, t) => all.concat(t.foreignKeys
      .map(k => `${k.fieldId}>${k.refFieldId}`)), []),
    problems: plan.problems.map(p => p.code),
  };
};
const expected = {
  order: ['USERS', 'ORDERS'],
  keys: ['ORDERS.USER_ID>USERS.ID'],
  problems: [],
};

describe('which table of a relation is the child', () => {
  test('kept on the child, n : 1 (imported models, the templates)', () => {
    const list = [orders({ correlations: [{ ...onChild, myRows: 'n', refRows: '1' }] }), users()];
    expect(keysOf(list)).toEqual(expected);
    expect(pairsOf(list, 'USERS')).toEqual([]);
  });

  test('kept on the parent, 1 : n (a line drawn from the parent in a diagram)', () => {
    const list = [orders(), users({ correlations: [{ ...onParent, myRows: '1', refRows: 'n' }] })];
    expect(pairsOf(list, 'ORDERS')).toEqual([onChild]);
    expect(pairsOf(list, 'USERS')).toEqual([]);
    expect(keysOf(list)).toEqual(expected);
  });

  test.each([['0,n', '1'], ['1,n', '0,1'], ['N', '1']])('many is "%s" against "%s"', (n, one) => {
    expect(keysOf([orders({ correlations: [{ ...onChild, myRows: n, refRows: one }] }), users()]))
      .toEqual(expected);
    expect(keysOf([orders(), users({ correlations: [{ ...onParent, myRows: one, refRows: n }] })]))
      .toEqual(expected);
  });

  test.each([['1', '1'], ['n', 'n'], ['', ''], [undefined, undefined]])(
    'rows that do not tell (%s : %s): the end that is not a primary key is the child',
    (a, b) => {
      expect(keysOf([orders({ correlations: [{ ...onChild, myRows: a, refRows: b }] }), users()]))
        .toEqual(expected);
      expect(keysOf([orders(), users({ correlations: [{ ...onParent, myRows: a, refRows: b }] })]))
        .toEqual(expected);
    },
  );

  test('both ends primary keys and no rows said: as it is kept', () => {
    const detail = entity('DETAIL', [field('ID', 'INT', pk)], {
      correlations: [{ myField: 'DETAIL.ID', refEntity: 'USERS', refField: 'USERS.ID' }],
    });
    expect(keysOf([detail, users()])).toEqual({
      order: ['USERS', 'DETAIL'], keys: ['DETAIL.ID>USERS.ID'], problems: [],
    });
  });

  test('the same line in two diagrams, and kept on both tables, is one key', () => {
    const list = [
      orders({ correlations: [{ ...onChild, myRows: 'n', refRows: '1' }] }),
      users({
        correlations: [{ ...onParent, myRows: '1', refRows: 'n' },
          { ...onParent, myRows: '1', refRows: 'n' }],
      }),
    ];
    expect(keysOf(list)).toEqual(expected);
  });

  test('a table that points at itself, kept either way', () => {
    const tree = rows => entity('TREE', [field('ID', 'INT', pk), field('PARENT_ID', 'INT')], {
      correlations: [rows],
    });
    const stored = { myField: 'TREE.PARENT_ID', refEntity: 'TREE', refField: 'TREE.ID', myRows: 'n', refRows: '1' };
    const drawn = { myField: 'TREE.ID', refEntity: 'TREE', refField: 'TREE.PARENT_ID', myRows: '1', refRows: 'n' };
    [stored, drawn].forEach((c) => {
      const list = [tree(c)];
      const groups = fkGroups(list[0], new Map([['TREE', list[0]]]));
      expect(groups).toEqual([{
        refEntityId: 'TREE', self: true, pairs: [{ fieldId: 'TREE.PARENT_ID', refFieldId: 'TREE.ID' }],
      }]);
    });
  });

  test('a composite key drawn from the parent stays one key', () => {
    const parent = entity('P', [field('A', 'INT', pk), field('B', 'INT', pk)], {
      correlations: [
        { myField: 'P.A', refEntity: 'C', refField: 'C.PA', myRows: '1', refRows: 'n' },
        { myField: 'P.B', refEntity: 'C', refField: 'C.PB', myRows: '1', refRows: 'n' }],
    });
    const child = entity('C', [field('ID', 'INT', pk), field('PA', 'INT'), field('PB', 'INT')]);
    const byId = new Map([['P', parent], ['C', child]]);
    expect(fkGroups(child, byId)).toEqual([{
      refEntityId: 'P',
      self: false,
      pairs: [{ fieldId: 'C.PA', refFieldId: 'P.A' }, { fieldId: 'C.PB', refFieldId: 'P.B' }],
    }]);
    expect(fkGroups(parent, byId)).toEqual([]);
  });

  test('the shop template gives the same keys after the app has rewritten its relations', () => {
    // what the app writes when the diagram "KeyEntities" is edited and saved: every line
    // of the diagram, on the table it starts from (see updateAllEntity in datasource_util)
    const id = key => shop.entities.find(e => e.defKey === key).id;
    const fid = (key, name) => shop.entities.find(e => e.defKey === key).fields
      .find(f => f.defKey === name).id;
    const drawn = [
      ['BUYR_USER', 'USER_ID', 'BUYR_CART', 'USER_ID'],
      ['BUYR_CART', 'CART_ID', 'BUYR_ORDER', 'CART_ID'],
      ['BUYR_ADDRESS', 'ADDRESS_ID', 'BUYR_ORDER', 'ADDRESS_ID'],
      ['BUYR_CART', 'CART_ID', 'BUYR_ITEM', 'CART_ID'],
      ['BUYR_ORDER', 'ORDER_ID', 'BUYR_ITEM', 'ORDER_ID'],
    ];
    const rewritten = {
      ...shop,
      entities: shop.entities.map(e => ({
        ...e,
        correlations: drawn.filter(d => d[0] === e.defKey).map(d => ({
          myField: fid(d[0], d[1]),
          refEntity: id(d[2]),
          refField: fid(d[2], d[3]),
          myRows: '1',
          refRows: 'n',
          innerType: '',
        })),
      })),
    };
    const ids = ['BUYR_USER', 'BUYR_CART', 'BUYR_ORDER', 'BUYR_ITEM', 'BUYR_ADDRESS'].map(id);
    const keys = ds => buildPlan(ds, { entityIds: ids }).tables.map(t => [t.defKey,
      t.foreignKeys.map(k => `${k.fieldId}>${k.refFieldId}`).sort()]).sort();
    expect(keys(rewritten)).toEqual(keys(shop));
    expect(keys(shop).reduce((n, t) => n + t[1].length, 0)).toBe(5);
    expect(buildPlan(rewritten, { entityIds: ids }).problems).toEqual([]);
  });
});
