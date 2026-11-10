import demo from '../src/lib/template/教学管理系统.pdma.json';
import {simplePackageChanges, getChanges} from '../src/lib/datasource_version_util';
import {_getAllDataSQLByFilter} from '../src/lib/utils';

test('existing engine produces ALTER and CREATE scripts', () => {
  const next = JSON.parse(JSON.stringify(demo));
  next.entities[0].fields[1].len = 99;
  next.entities.pop();
  const changes = simplePackageChanges(next, demo, null, true);
  expect(changes.length).toBeGreaterThan(0);
  const sql = getChanges(changes, next);
  console.log(sql.slice(0, 600), JSON.stringify(changes.map(c => [c.opt, c.data.defKey || c.data.baseInfo.defKey])));
  const db = next.profile.default.db;
  expect(_getAllDataSQLByFilter(next, db, ['createTable'])).toMatch(/CREATE TABLE/i);
});
