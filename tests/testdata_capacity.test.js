// How many different values a column can get (what the plan reports is what the generator
// can do), and which values count as the same.
import { buildPlan } from '../src/lib/testdata/plan';
import { createGenerator } from '../src/lib/testdata/generate';
import { ruleCapacity } from '../src/lib/testdata/plan_keys';
import { uniqueKey, createUniqueTracker } from '../src/lib/testdata/generate_unique';
import { fieldColumn } from '../src/lib/testdata/columns';
import {
  field, entity, project, collect,
} from './testdata_planner_helpers';

const NOW = new Date(2026, 10, 15, 10, 0, 0);
const pk = {
  primaryKey: true,
  notNull: true,
};
const make = async (ds) => {
  const plan = buildPlan(ds, {
    entityIds: ['T'],
    now: NOW,
  });
  const generator = createGenerator(ds, plan, {
    seed: 7,
    now: NOW,
  });
  return {
    plan,
    data: { T: (await collect(generator, 'T')).rows },
  };
};
const column = (rows, at = 0) => rows.map(r => r[at]);
const distinct = list => new Set(list.map(v => uniqueKey(v))).size;

describe('S8: capacities are what the generator can do', () => {
  const cap = (type, more = {}, r = { kind: 'auto' }, db = 'MYSQL') => {
    const ds = project([], {}, {
      profile: {
        default: { db: 'x' },
        dataTypeSupports: [{
          id: 'x',
          defKey: db,
        }],
      },
    });
    return ruleCapacity(r, fieldColumn(ds, field('V', type, more)), ds, {}, { now: NOW });
  };

  test('zh has 298 characters, INT(5) is a display width, TINYINT depends on the database', () => {
    expect(cap('VARCHAR', { len: 1 }, {
      kind: 'text',
      params: {
        min: 1,
        max: 1,
        charset: 'zh',
      },
    })).toBe(298);
    expect(cap('INT(5)', { primaryKey: true })).toBe(2147483647);
    expect(cap('NUMBER', {
      len: 5,
      primaryKey: true,
    }, { kind: 'auto' }, 'ORACLE')).toBe(99999);
    expect(cap('TINYINT', {}, { kind: 'auto' }, 'SQLServer')).toBe(255);
    expect(cap('TINYINT')).toBe(127);
    expect(cap('TINYINT UNSIGNED')).toBe(255);
  });

  test('automatic dates, times and decimals have an end too', () => {
    expect(cap('TIME')).toBe(86400);
    expect(cap('DATE')).toBeGreaterThan(1000000);
    expect(cap('DECIMAL', {
      len: 3,
      scale: 1,
    })).toBe(999);
    expect(cap('CHAR', { len: 2 })).toBe(1296);
    expect(cap('BOOLEAN', {}, { kind: 'auto' }, 'PostgreSQL')).toBe(2);
  });

  test('a DATE key of 400 rows and a TIME key of a whole day work', async () => {
    const dates = project([entity('T', [field('D', 'DATE', pk)])], {
      settings: { tables: { T: { rows: 400 } } },
    });
    const { plan, data } = await make(dates);
    expect(plan.problems).toEqual([]);
    expect(distinct(column(data.T))).toBe(400);
    expect(data.T[0][0]).toBe('2026-11-15'); // today, then back day by day
    expect(data.T[399][0]).toBe('2025-10-12');
    const times = project([entity('T', [field('D', 'TIME', pk)])], {
      settings: { tables: { T: { rows: 86400 } } },
    });
    expect(distinct(column((await make(times)).data.T))).toBe(86400);
    expect(buildPlan(project([entity('T', [field('D', 'TIME', pk)])], {
      settings: { tables: { T: { rows: 86401 } } },
    }), { entityIds: ['T'] }).problems[0]).toMatchObject({ code: 'uniqueImpossible' });
  });
});

describe('M6: what counts as the same value', () => {
  test('NULL is not the text null, true is not the text true; accents and case fold', () => {
    expect(uniqueKey(null)).not.toBe(uniqueKey('null'));
    expect(uniqueKey(true)).not.toBe(uniqueKey('true'));
    expect(uniqueKey(1)).toBe(uniqueKey('1')); // one column holds one type
    expect(uniqueKey('é')).toBe(uniqueKey('E'));
    expect(uniqueKey('Amélie ')).toBe(uniqueKey('amelie'));
    expect(uniqueKey('陳')).not.toBe(uniqueKey('林'));
    const tracker = createUniqueTracker([[0]], 10);
    const add = (v) => {
      const bad = tracker.violated([v]);
      if (!bad) tracker.accept();
      return !bad;
    };
    expect([null, 'null', 'NULL', true, 'true', 'é', 'e', null].map(add))
      .toEqual([true, true, false, true, true, true, false, false]);
    // every database but SQL Server takes several NULLs in a unique index
    const lax = createUniqueTracker([[0]], 10, { nullsDiffer: true });
    expect(lax.violated([null])).toBe(null);
    lax.accept();
    expect(lax.violated([null])).toBe(null);
  });
});
