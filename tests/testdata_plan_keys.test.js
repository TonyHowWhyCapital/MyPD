import { buildPlan } from '../src/lib/testdata/plan';
import { fkGroups, uniqueSets, ruleCapacity, neverRepeats } from '../src/lib/testdata/plan_keys';
import shop from '../src/lib/template/电商商城.pdma.json';
import {
  project, entity, field, link, rule,
} from './testdata_planner_helpers';

jest.mock('../src/lib/testdata/model', () => require('./testdata_planner_helpers').fakeModel);
jest.mock('../src/lib/testdata/values', () => require('./testdata_planner_helpers').fakeValues);

const pk = {
  primaryKey: true,
  notNull: true,
};
const codes = (plan, code) => plan.problems.filter(p => p.code === code);
const names = plan => plan.tables.map(t => t.defKey);
const tableOf = (plan, id) => plan.tables.find(t => t.entityId === id);

describe('uniqueness', () => {
  const three = rule('three', 'list', { items: [{ value: 'a' }, { value: 'b' }, { value: 'c' }] });
  const seq = rule('seq', 'sequence', { prefix: 'N' });
  const make = (ruleId, more = {}, rows = 100) => project([entity('T', [
    field('ID', 'INT', pk),
    field('CODE', 'VARCHAR', {
      len: 20,
      testData: { rule: ruleId },
    }),
    field('KIND', 'VARCHAR', {
      len: 20,
      testData: { rule: 'three' },
    }),
  ], more)], {
    rules: [three, seq, {
      ...three,
      id: 'three-unique',
      unique: true,
    }],
    settings: { tables: { T: { rows } } },
  });
  const index = (...ids) => ({
    defKey: 'UX',
    unique: true,
    fields: ids.map(id => ({
      fieldDefKey: id,
      ascOrDesc: 'A',
    })),
  });

  test('a unique column on a list of three values cannot hold 100 rows', () => {
    const plan = buildPlan(make('three', { indexes: [index('T.CODE')] }), { entityIds: ['T'] });
    expect(plan.tables[0].uniques).toEqual([['T.ID'], ['T.CODE']]);
    expect(plan.problems).toEqual([{
      code: 'uniqueImpossible',
      entityId: 'T',
      fieldId: 'T.CODE',
      detail: {
        fields: ['T.CODE'],
        capacity: 3,
        rows: 100,
      },
    }]);
    // three rows fit
    expect(buildPlan(make('three', { indexes: [index('T.CODE')] }, 3), { entityIds: ['T'] }).problems)
      .toEqual([]);
  });

  test('a sequence is fine, and so is a rule marked unique on enough values', () => {
    expect(buildPlan(make('seq', { indexes: [index('T.CODE')] }), { entityIds: ['T'] }).problems)
      .toEqual([]);
    const marked = buildPlan(make('three-unique'), { entityIds: ['T'] });
    expect(marked.tables[0].uniques).toEqual([['T.ID'], ['T.CODE']]);
    expect(codes(marked, 'uniqueImpossible')).toHaveLength(1);
  });

  test('a composite unique index counts the combinations', () => {
    const plan = buildPlan(make('three', { indexes: [index('T.CODE', 'T.KIND')] }, 9),
      { entityIds: ['T'] });
    expect(plan.tables[0].uniques).toEqual([['T.ID'], ['T.CODE', 'T.KIND']]);
    expect(plan.problems).toEqual([]);
    expect(codes(buildPlan(make('three', { indexes: [index('T.CODE', 'T.KIND')] }, 10),
      { entityIds: ['T'] }), 'uniqueImpossible')[0].detail.capacity).toBe(9);
  });

  test('indexes by column name, alternate keys, and what does not count', () => {
    const ds = make('seq', {
      indexes: [index('code'), {
        ...index('T.KIND'),
        unique: false,
      }, index('T.GONE'), index('T.ID', 'T.KIND')],
      keys: [{
        primary: true,
        fields: ['T.ID'],
      }, {
        primary: false,
        fields: ['T.KIND', 'T.CODE'],
      }],
    }, 3);
    // (ID, KIND) contains the primary key, (KIND, CODE) contains the unique CODE
    expect(buildPlan(ds, { entityIds: ['T'] }).tables[0].uniques).toEqual([['T.ID'], ['T.CODE']]);
  });

  test('a composite primary key of foreign keys is limited by the parents', () => {
    const ds = project([
      entity('U', [field('ID', 'INT', pk)]), entity('R', [field('ID', 'INT', pk)]),
      entity('UR', [field('U_ID', 'INT', pk), field('R_ID', 'INT', pk)],
        { correlations: [link('UR.U_ID', 'U', 'ID'), link('UR.R_ID', 'R', 'ID')] }),
    ], {
      settings: {
        tables: {
          U: { rows: 5 },
          R: { rows: 4 },
          UR: { rows: 21 },
        },
      },
    });
    const plan = buildPlan(ds, { entityIds: ['UR', 'U', 'R'] });
    expect(names(plan)).toEqual(['U', 'R', 'UR']);
    expect(plan.problems).toEqual([{
      code: 'uniqueImpossible',
      entityId: 'UR',
      fieldId: 'UR.U_ID',
      detail: {
        fields: ['UR.U_ID', 'UR.R_ID'],
        capacity: 20,
        rows: 21,
      },
    }]);
  });

  test('capacity of rules', () => {
    const col = (kind, len = null, type = '') => ({
      kind,
      len,
      type,
    });
    const cap = (kind, params, column = col('string', 50)) => ruleCapacity({
      kind,
      params,
    }, column, { dicts: [{
      id: 'd',
      items: [{ defKey: '1' }, { defKey: '2' }, {
        defKey: '3',
        enabled: false,
      }],
    }] }, { refDict: 'd' });
    expect(cap('constant', { value: 1 })).toBe(1);
    expect(cap('list', { items: [{ value: 1 }, { value: 1 }, { value: 2 }] })).toBe(2);
    expect(cap('dict', {})).toBe(2);
    expect(cap('dict', { dict: 'none' })).toBe(Infinity);
    expect(cap('pattern', { mask: 'A-##\\#' })).toBe(2600);
    expect(cap('number', {
      min: 1,
      max: 10,
    })).toBe(10);
    expect(cap('number', {
      min: 0,
      max: 1,
      decimals: 2,
    })).toBe(101);
    expect(cap('text', {
      max: 2,
      charset: 'digit',
    })).toBe(100);
    expect(cap('builtin', { name: 'boolean' })).toBe(2);
    expect(cap('builtin', { name: 'tw.name' })).toBe(Infinity);
    expect(cap('sequence', {})).toBe(Infinity);
    // AB1 ... AB99
    expect(cap('sequence', { prefix: 'AB' }, col('string', 4))).toBe(99);
    expect(cap('auto', {}, col('string', 1))).toBe(36);
    // 1 ... 127 where the database is not known
    expect(cap('auto', {}, col('int', null, 'TINYINT'))).toBe(127);
    expect(cap('auto', {}, col('bool'))).toBe(2);
    expect(cap('file', {})).toBe(Infinity);
    const s = {
      kind: 'sequence',
      params: {
        prefix: 'AB',
        pad: 3,
      },
    };
    expect(neverRepeats(s, col('string', 5), 999)).toBe(true);
    expect(neverRepeats(s, col('string', 5), 1000)).toBe(false);
    expect(neverRepeats(s, col('string'), 1000000)).toBe(true);
    expect(neverRepeats({
      kind: 'sequence',
      params: { step: 0 },
    }, col('int'), 10)).toBe(false);
    expect(neverRepeats({ kind: 'list' }, col('int'), 10)).toBe(false);
  });
});

describe('composite foreign keys', () => {
  test('pairs to the same parent on different columns are one key', () => {
    const parent = entity('P', [field('A', 'INT', pk), field('B', 'INT', pk)]);
    const child = entity('C', [field('ID', 'INT', pk), field('PA', 'INT'), field('PB', 'INT'),
      field('QA', 'INT'), field('QB', 'INT'), field('OTHER', 'INT')], {
      correlations: [link('C.PA', 'P', 'A'), link('C.QA', 'P', 'A'), link('C.PB', 'P', 'B'),
        link('C.QB', 'P', 'B'), link('C.PA', 'P', 'B')],
    });
    const byId = new Map([['P', parent], ['C', child]]);
    expect(fkGroups(child, byId).map(g => g.pairs.map(p => p.fieldId))).toEqual([
      ['C.PA', 'C.PB'], ['C.QA', 'C.QB']]);
    const plan = buildPlan(project([parent, child]), { entityIds: ['C', 'P'] });
    expect(tableOf(plan, 'C').foreignKeys.map(k => [k.fieldId, k.group])).toEqual([
      ['C.PA', 0], ['C.PB', 0], ['C.QA', 1], ['C.QB', 1]]);
  });

  test('unique sets helper ignores columns that are not generated', () => {
    const e = entity('T', [field('ID', 'INT', pk), field('X', 'INT')]);
    expect(uniqueSets(e, [{ id: 'T.X' }], () => ({ unique: true }))).toEqual([['T.X']]);
  });
});

describe('real template', () => {
  const id = key => shop.entities.find(e => e.defKey === key).id;
  const all = shop.entities.map(e => e.id);

  test('all tables: parents first, nothing missing', () => {
    const plan = buildPlan(shop, { entityIds: all });
    expect(plan.tables).toHaveLength(11);
    const at = key => names(plan).indexOf(key);
    expect(at('BUYR_USER')).toBeLessThan(at('BUYR_CART'));
    expect(at('BUYR_CART')).toBeLessThan(at('BUYR_ORDER'));
    expect(at('BUYR_ADDRESS')).toBeLessThan(at('BUYR_ORDER'));
    expect(at('BUYR_ORDER')).toBeLessThan(at('BUYR_ITEM'));
    expect(at('GPPT_USER')).toBeLessThan(at('GDPT_USER_ROLE'));
    expect(at('GDPT_ROLE')).toBeLessThan(at('GDPT_USER_ROLE'));
    expect(plan.missingParents).toEqual([]);
    expect(plan.problems).toEqual([]);
    expect(plan.needs).toEqual({
      files: [],
      queries: [],
      parentKeys: [],
    });
    expect(plan.tables.every(t => t.rows === 100)).toBe(true);
    const item = tableOf(plan, id('BUYR_ITEM'));
    expect(item.uniques).toHaveLength(1);
    expect(item.uniques[0]).toHaveLength(3);
    expect(item.foreignKeys.map(k => k.source)).toEqual(['generated', 'generated']);
  });

  test('one child alone: its parents are missing, then answered', () => {
    const plan = buildPlan(shop, { entityIds: [id('BUYR_ORDER')] });
    expect(plan.missingParents.map(m => m.refEntityId).sort())
      .toEqual([id('BUYR_CART'), id('BUYR_ADDRESS')].sort());
    const answered = buildPlan(shop, {
      entityIds: [id('BUYR_ORDER')],
      external: {
        [id('BUYR_CART')]: 'generate',
        [id('BUYR_ADDRESS')]: 'database',
      },
    });
    expect(names(answered)).toEqual(['BUYR_CART', 'BUYR_ORDER']);
    // the cart that was added has a parent of its own
    expect(answered.missingParents.map(m => m.refEntityId)).toEqual([id('BUYR_USER')]);
    expect(answered.needs.parentKeys).toHaveLength(1);
    expect(answered.needs.parentKeys[0].entityId).toBe(id('BUYR_ADDRESS'));
  });
});
