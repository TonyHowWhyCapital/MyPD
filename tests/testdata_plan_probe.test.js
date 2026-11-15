// What the plan finds out before anything is written: rules that do not suit their column,
// formulas that fail for some rows, counters and parent keys that do not fit, and what the
// user should know although it does not stop the run.
import { buildPlan } from '../src/lib/testdata/plan';
import { createGenerator, previewTable } from '../src/lib/testdata/generate';
import { sampleRows } from '../src/lib/testdata/plan_probe';
import {
  getTestData, setTestData, seedNow, stampSeedBase,
} from '../src/lib/testdata/model';
import {
  field, entity, link, project, rule, collect,
} from './testdata_planner_helpers';

const pk = {
  primaryKey: true,
  notNull: true,
};
const on = db => ({
  profile: {
    default: { db: 'x' },
    dataTypeSupports: [{
      id: 'x',
      defKey: db,
    }],
  },
});
// table T: ID, A (INT), X filled by the rule `r`
const withRule = (r, type, more = {}, rows = 1000, extra = []) => project([entity('T', [
  field('ID', 'INT', pk), field('A', 'INT'),
  field('X', type, {
    testData: { rule: 'r' },
    ...more,
  }), ...extra,
])], {
  rules: [{
    ...r,
    id: 'r',
  }],
  settings: { tables: { T: { rows } } },
});
const problemsOf = (ds, ids = ['T'], options = {}) => buildPlan(ds, {
  entityIds: ids,
  ...options,
}).problems;
const run = (ds, ids = ['T'], options = {}) => {
  const plan = buildPlan(ds, { entityIds: ids });
  const generator = createGenerator(ds, plan, {
    seed: 1,
    ...options,
  });
  return ids.reduce((p, id) => p.then(async all => ({
    ...all,
    [id]: (await collect(generator, id)).rows,
  })), Promise.resolve({}));
};

describe('S1: rules are tried against their column when the plan is built', () => {
  test('a rule that never fits is a problem before any table is written', () => {
    expect(problemsOf(withRule(rule('r', 'builtin', { name: 'email' }), 'INT'))).toEqual([
      expect.objectContaining({
        code: 'badRule',
        entityId: 'T',
        fieldId: 'T.X',
        detail: ['value.type'],
      })]);
    expect(problemsOf(withRule(rule('r', 'list', { items: [{ value: 'oops' }] }), 'DATE'))[0])
      .toMatchObject({ detail: ['value.type'] });
    expect(problemsOf(withRule(rule('r', 'number', {
      min: 0,
      max: 5,
      decimals: 2,
    }), 'VARCHAR', { len: 2 }))[0]).toMatchObject({ detail: ['value.length'] });
    expect(problemsOf(withRule(rule('r', 'builtin', { name: 'tw.name' }), 'VARCHAR',
      { len: 20 }))).toEqual([]);
  });

  test('a formula is tried on a sample of rows, the last one included', () => {
    expect(sampleRows(1000)).toEqual(expect.arrayContaining([0, 1, 15, 500, 999]));
    expect(sampleRows(3)).toEqual([0, 1, 2]);
    expect(sampleRows(0)).toEqual([]);
    const late = withRule(rule('r', 'expr', { expr: "if(seq()<500,'2024-01-01','oops')" }),
      'DATE');
    const found = problemsOf(late);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: 'badRule',
      fieldId: 'T.X',
      detail: ['value.type'],
    });
    expect(found[0].row).toBeGreaterThanOrEqual(499);
  });

  test('a row that was not tried still fails cleanly, with table, column and row', async () => {
    const rare = withRule(rule('r', 'expr', { expr: "if(seq()=778,'oops','2024-01-01')" }),
      'DATE');
    expect(problemsOf(rare)).toEqual([]);
    await expect(run(rare)).rejects.toMatchObject({
      code: 'value.type',
      entityId: 'T',
      fieldId: 'T.X',
      row: 777,
    });
  });

  test('file and query rules are tried once their lists are there', () => {
    const ds = withRule(rule('r', 'file', { path: '/tmp/x.txt' }), 'INT');
    expect(problemsOf(ds)).toEqual([]);
    expect(problemsOf(ds, ['T'], { lists: { file: { '/tmp/x.txt': ['1', 'two'] } } })[0])
      .toMatchObject({
        code: 'badRule',
        detail: ['value.type'],
      });
    expect(problemsOf(ds, ['T'], { lists: { file: { '/tmp/x.txt': ['1', '2'] } } })).toEqual([]);
  });
});

describe('S2 and S3: formulas', () => {
  test('NULL from a formula never goes into a NOT NULL column', async () => {
    const div = withRule(rule('r', 'expr', { expr: '[A] / 0' }), 'INT', { notNull: true });
    expect(problemsOf(div)[0]).toMatchObject({
      code: 'badRule',
      detail: ['value.null'],
      row: 0,
    });
    await expect(run(div)).rejects.toMatchObject({
      code: 'value.null',
      entityId: 'T',
      fieldId: 'T.X',
      row: 0,
    });
    const nullable = withRule(rule('r', 'expr', { expr: '[A] / 0' }), 'INT', {}, 5);
    expect(problemsOf(nullable)).toEqual([]);
    expect((await run(nullable)).T.map(r => r[2])).toEqual([null, null, null, null, null]);
    // a nullable column the formula reads: tried with its NULLs
    const fromNull = project([entity('T', [field('ID', 'INT', pk),
      field('A', 'INT', { testData: { nullRate: 100 } }),
      field('X', 'INT', {
        notNull: true,
        testData: { rule: 'r' },
      })])], { rules: [rule('r', 'expr', { expr: '[A] + 1' })] });
    expect(problemsOf(fromNull)[0]).toMatchObject({ detail: ['value.null'] });
  });

  test('[a] finds the column A in the plan and in the run', async () => {
    const ds = withRule(rule('r', 'expr', { expr: '[a] + [Id]' }), 'INT', {}, 5);
    expect(problemsOf(ds)).toEqual([]);
    const rows = (await run(ds)).T;
    rows.forEach(r => expect(r[2]).toBe(r[0] + r[1]));
    expect(problemsOf(withRule(rule('r', 'expr', { expr: '[nope] + 1' }), 'INT'))).toEqual([
      expect.objectContaining({
        code: 'exprUnknownColumn',
        detail: 'nope',
      })]);
  });
});

describe('S7: counters and parent keys must fit', () => {
  test('auto increment past the type of the column', async () => {
    const tiny = project([entity('T', [field('ID', 'TINYINT', {
      ...pk,
      autoIncrement: true,
    })])], { settings: { tables: { T: { rows: 200 } } } });
    expect(problemsOf(tiny)).toEqual([{
      code: 'incrementOverflow',
      entityId: 'T',
      fieldId: 'T.ID',
      detail: {
        startAt: 1,
        rows: 200,
        last: 200,
      },
    }]);
    await expect(run(tiny)).rejects.toMatchObject({
      code: 'incrementOverflow',
      entityId: 'T',
      fieldId: 'T.ID',
    });
    // SQL Server: 0..255
    expect(problemsOf({
      ...tiny,
      ...on('SQLServer'),
      profile: {
        ...on('SQLServer').profile,
        testData: tiny.profile.testData,
      },
    })).toEqual([]);
    const high = project([entity('T', [field('ID', 'INT', {
      ...pk,
      autoIncrement: true,
    })])], {
      settings: {
        tables: {
          T: {
            rows: 300,
            startAt: 2147483640,
          },
        },
      },
    });
    expect(problemsOf(high)[0]).toMatchObject({ code: 'incrementOverflow' });
  });

  test('a parent key that does not go into the child column', async () => {
    const parent = entity('P', [field('ID', 'INT', pk)]);
    const child = (type, more) => entity('C', [field('ID', 'INT', pk),
      field('P_ID', type, more)], { correlations: [link('C.P_ID', 'P', 'ID')] });
    const ds = c => project([parent, c], {
      settings: {
        tables: {
          P: { rows: 500 },
          C: { rows: 500 },
        },
      },
    });
    expect(problemsOf(ds(child('TINYINT')), ['P', 'C'])).toEqual([expect.objectContaining({
      code: 'foreignKeyFit',
      entityId: 'C',
      fieldId: 'C.P_ID',
      detail: expect.objectContaining({
        refEntityId: 'P',
        refFieldId: 'P.ID',
      }),
    })]);
    expect(problemsOf(ds(child('VARCHAR', { len: 2 })), ['P', 'C'])[0])
      .toMatchObject({ code: 'foreignKeyFit' });
    expect(problemsOf(ds(child('VARCHAR', { len: 3 })), ['P', 'C'])).toEqual([]);
    expect(problemsOf(ds(child('BIGINT')), ['P', 'C'])).toEqual([]);
    const rows = (await run(ds(child('VARCHAR', { len: 3 })), ['P', 'C'])).C;
    rows.forEach(r => expect(r[1]).toMatch(/^\d{1,3}$/)); // the number as text, whole
    // keys read from the database are checked while the rows are made
    const plan = buildPlan(ds(child('TINYINT')), {
      entityIds: ['C'],
      external: { P: 'database' },
    });
    expect(plan.problems).toEqual([]);
    await expect(createGenerator(ds(child('TINYINT')), plan, {
      seed: 1,
      parentKeys: { P: { 'P.ID': [1, 2, 500] } },
    }).table('C')).rejects.toMatchObject({
      code: 'foreignKeyFit',
      entityId: 'C',
      fieldId: 'C.P_ID',
    });
  });
});

describe('D1 and D2: notices of the plan', () => {
  test('SQL Server timestamp / rowversion columns are left out', () => {
    const table = entity('T', [field('ID', 'INT', pk), field('RV', 'TIMESTAMP', { notNull: true }),
      field('RV2', 'ROWVERSION'), field('NAME', 'NVARCHAR', { len: 10 })]);
    const mssql = buildPlan(project([table], {}, on('SQLServer')), { entityIds: ['T'] });
    expect(mssql.tables[0].columns.map(c => c.defKey)).toEqual(['ID', 'NAME']);
    expect(mssql.problems).toEqual([]);
    expect(mssql.notices).toEqual([{
      code: 'columnSkipped',
      entityId: 'T',
      fieldId: 'T.RV',
      detail: 'rowversion',
    }, {
      code: 'columnSkipped',
      entityId: 'T',
      fieldId: 'T.RV2',
      detail: 'rowversion',
    }]);
    // on MySQL a TIMESTAMP is a point in time
    const mysql = buildPlan(project([entity('T', [field('ID', 'INT', pk),
      field('RV', 'TIMESTAMP')])]), { entityIds: ['T'] });
    expect(mysql.tables[0].columns.map(c => c.defKey)).toEqual(['ID', 'RV']);
    expect(mysql.notices).toEqual([]);
  });

  test('a null rate on a unique column is ignored, and the plan says so', async () => {
    const ds = project([entity('T', [field('ID', 'INT', pk),
      field('EMAIL', 'VARCHAR', {
        len: 60,
        testData: {
          rule: 'mail',
          nullRate: 10,
        },
      }),
      field('NOTE', 'VARCHAR', {
        len: 20,
        testData: { nullRate: 50 },
      })], {
      indexes: [{
        defKey: 'UX',
        unique: true,
        fields: [{ fieldDefKey: 'T.EMAIL' }],
      }],
    })], {
      rules: [rule('mail', 'builtin', { name: 'email' })],
      settings: { tables: { T: { rows: 300 } } },
    });
    const plan = buildPlan(ds, { entityIds: ['T'] });
    expect(plan.problems).toEqual([]);
    expect(plan.notices).toEqual([{
      code: 'nullRateIgnored',
      entityId: 'T',
      fieldId: 'T.EMAIL',
      detail: { nullRate: 10 },
    }]);
    const rows = (await run(ds)).T;
    expect(rows.filter(r => r[1] === null)).toHaveLength(0);
    expect(rows.filter(r => r[2] === null).length).toBeGreaterThan(100);
  });
});

describe('S5: a fixed seed fixes the clock', () => {
  const dated = seed => project([entity('T', [field('ID', 'INT', pk), field('D', 'DATE'),
    field('TS', 'DATETIME'), field('X', 'VARCHAR', {
      len: 30,
      testData: { rule: 'r' },
    })])], {
    rules: [rule('r', 'expr', { expr: "today() & '/' & now()" })],
    settings: {
      seed,
      tables: { T: { rows: 20 } },
    },
  });

  test('seedNow: the base date for a fixed seed, the real time for a random one', () => {
    const real = new Date(2026, 10, 15, 13, 45, 12);
    const at = d => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(),
      d.getMinutes(), d.getSeconds()];
    expect(at(seedNow({
      seed: {
        fixed: true,
        baseDate: '2025-03-09',
      },
    }, real))).toEqual([2025, 3, 9, 0, 0, 0]);
    expect(at(seedNow({ seed: { fixed: true } }, real))).toEqual([2026, 11, 15, 0, 0, 0]);
    expect(at(seedNow({}, real))).toEqual([2026, 11, 15, 0, 0, 0]);
    expect(seedNow({ seed: { fixed: false } }, real)).toBe(real);
    expect(at(seedNow({
      seed: {
        fixed: true,
        baseDate: '2025-02-30',
      },
    }, real))).toEqual([2026, 11, 15, 0, 0, 0]);
  });

  test('stampSeedBase writes today once and getTestData keeps it', () => {
    const empty = getTestData({});
    expect(empty.settings.seed).toEqual({
      fixed: true,
      value: 1,
    });
    const stamped = stampSeedBase(empty, new Date(2026, 10, 15, 23, 59, 59));
    expect(stamped.settings.seed).toEqual({
      fixed: true,
      value: 1,
      baseDate: '2026-11-15',
    });
    expect(stampSeedBase(stamped, new Date(2027, 0, 1))).toBe(stamped);
    expect(getTestData(setTestData({}, stamped)).settings.seed.baseDate).toBe('2026-11-15');
    const free = {
      ...empty,
      settings: {
        ...empty.settings,
        seed: {
          fixed: false,
          value: 1,
        },
      },
    };
    expect(stampSeedBase(free, new Date())).toBe(free);
    expect(getTestData({
      profile: { testData: { settings: { seed: { baseDate: 'yesterday' } } } },
    }).settings.seed).toEqual({
      fixed: true,
      value: 1,
    });
  });

  test('the same settings give the same data whenever the run starts', async () => {
    const seed = {
      fixed: true,
      value: 4,
      baseDate: '2026-11-15',
    };
    const ds = dated(seed);
    const plan = buildPlan(ds, { entityIds: ['T'] });
    const first = (await collect(createGenerator(ds, plan), 'T')).rows;
    await new Promise(resolve => setTimeout(resolve, 1100)); // the clock moves on
    const second = (await collect(createGenerator(ds, plan), 'T')).rows;
    expect(second).toEqual(first);
    expect(first[0][3]).toBe('2026-11-15/2026-11-15 00:00:00');
    first.forEach(r => expect(r[1] <= '2026-11-15' && r[1] >= '2025-11-15').toBe(true));
    expect(createGenerator(ds, plan).now.getTime()).toBe(new Date(2026, 10, 15).getTime());
    expect((await previewTable(ds, plan, 'T', 20)).rows).toEqual(first);
    // another base date, other dates
    const moved = (await collect(createGenerator(dated({
      ...seed,
      baseDate: '2020-01-01',
    }), plan), 'T')).rows;
    expect(moved[0][3]).toBe('2020-01-01/2020-01-01 00:00:00');
    // an explicit clock still wins
    const explicit = createGenerator(ds, plan, { now: new Date(2024, 0, 1, 8, 0, 0) });
    expect((await collect(explicit, 'T')).rows[0][3]).toBe('2024-01-01/2024-01-01 08:00:00');
  });
});
