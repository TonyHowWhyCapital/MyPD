import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import langs from '../src/lang';
import { noticeText } from '../src/app/container/tools/testdata/generate/problems';
import { problemItems } from '../src/app/container/tools/testdata/generate/problemItems';
import {
  requestsOf, createLoader, NO_CONNECTION, PARENT_EMPTY,
} from '../src/app/container/tools/testdata/generate/needs';
import {
  parseJdbc, safeUrl, connTarget, pickConn, connections,
} from '../src/app/container/tools/testdata/generate/connInfo';
import {
  withTabRules, patchTabData, dirtyEntityIds, ownRuleCount, parentChoices, plannedRows,
  totalRows, columnLines, groupedEntities, matchesKeyword,
} from '../src/app/container/tools/testdata/generate/planView';
import {
  count, fileSize, duration, typeText, percent,
} from '../src/app/container/tools/testdata/generate/format';
import { buildPlan } from '../src/lib/testdata/plan';
import {
  root, LANGS, tr, ruleTr, keyPaths, field, project,
} from './testdata_ui_generate_helpers';

describe('lines of the problem panel', () => {
  const build = (ds, entityIds, external, hasConn, log = []) => {
    const plan = buildPlan(ds, { entityIds, external });
    const action = name => (...args) => log.push([name].concat(args));
    return problemItems({
      plan,
      view: ds,
      tr: tr('en'),
      ruleTr: ruleTr('en'),
      hasConn,
      external,
      actions: {
        answerParent: action('answerParent'),
        unselect: action('unselect'),
        patchTable: action('patchTable'),
        gotoTable: action('gotoTable'),
        gotoColumn: action('gotoColumn'),
        connSettings: action('connSettings'),
      },
    });
  };
  test('a parent that is not selected is one line with both answers', () => {
    const log = [];
    const items = build(project(), ['items'], {}, false, log);
    const missing = items.filter(i => i.id.startsWith('missing-'));
    expect(missing).toHaveLength(1);
    expect(missing[0].text).toContain('ITEMS refers to ORDERS');
    expect(missing[0].blocking).toBe(true);
    expect(missing[0].fixes.map(f => f.key)).toEqual(['generateParent', 'readParent']);
    expect(missing[0].fixes[1].disabled).toBe(true);
    missing[0].fixes[0].run();
    expect(log).toEqual([['answerParent', 'orders', 'generate']]);
    const withConn = build(project(), ['items'], {}, true);
    expect(withConn[0].fixes[1].disabled).toBe(false);
  });
  test('reading keys from the database without a connection is a problem of its own', () => {
    const log = [];
    const items = build(project(), ['items'], { orders: 'database' }, false, log);
    expect(items.map(i => i.id)).toEqual(['conn-orders']);
    expect(items[0].fixes.map(f => f.key)).toEqual(['connection', 'generateParent']);
    items[0].fixes[0].run();
    items[0].fixes[1].run();
    expect(log).toEqual([['connSettings'], ['answerParent', 'orders', 'generate']]);
    expect(build(project(), ['items'], { orders: 'database' }, true)).toEqual([]);
  });
  test('a parent key left to the database offers to let the program number the parent', () => {
    const log = [];
    const ds = project({ tables: { users: { autoIncrement: 'database' } } });
    const items = build(ds, ['users', 'orders'], {}, true, log);
    const item = items.find(i => i.id.startsWith('autoIncrementParentKey'));
    expect(item.entityId).toBe('orders');
    expect(item.fieldId).toBe('o_user');
    expect(item.fixes.map(f => f.key)).toEqual(['programIncrement']);
    item.fixes[0].run();
    expect(log).toEqual([['patchTable', 'users', { autoIncrement: undefined }]]);
  });
});


// ---- lists and keys read before a run ----------------------------------------------
describe('what is read before rows are made', () => {
  const withFile = () => {
    const ds = project();
    ds.profile.testData.rules = [
      { id: 'r1', name: 'names', kind: 'file', params: { path: '/data/names.csv', column: 2, header: true } },
      { id: 'r2', name: 'q', kind: 'query', params: { sql: 'select name from t' } }];
    ds.entities[0].fields[1].testData = { rule: 'r1' };
    ds.entities[1].fields.push(field('o_note', { type: 'VARCHAR', len: 20, testData: { rule: 'r2' } }));
    return ds;
  };
  test('files with their column, queries, and parent keys of composite keys as rows', () => {
    const ds = withFile();
    const plan = buildPlan(ds, { entityIds: ['items'], external: { orders: 'database' } });
    expect(requestsOf(ds, plan, 'c1')).toEqual([{
      kind: 'keyRows',
      id: 'keyRows|c1|ORDERS|O_ID,O_NO',
      entityId: 'orders',
      table: 'ORDERS',
      needsConnection: true,
      fieldIds: ['o_id', 'o_no'],
      columns: ['O_ID', 'O_NO'],
    }]);
    const all = buildPlan(ds, { entityIds: ['orders'], external: { users: 'database' } });
    expect(requestsOf(ds, all, 'c1').map(r => r.id)).toEqual([
      'query|c1|select name from t', 'keys|c1|USERS|U_ID']);
    const files = buildPlan(ds, { entityIds: ['users'] });
    expect(requestsOf(ds, files, '')).toEqual([{
      kind: 'file',
      id: 'file|/data/names.csv|/data/names.csv\n2\n1\nauto',
      key: '/data/names.csv\n2\n1\nauto',
      path: '/data/names.csv',
      file: '/data/names.csv',
      params: { column: 2, header: true, encoding: 'auto' },
    }]);
  });
  const io = (log, connected = true) => ({
    hasConnection: () => connected,
    readFile: (file) => {
      log.push(`file ${file}`);
      return file === '/gone' ? Promise.reject(Object.assign(new Error('x'), { code: 'file.read' }))
        : Promise.resolve(['a', 'b']);
    },
    runQuery: (sql) => {
      log.push(`query ${sql}`);
      return Promise.resolve([1, 2, 3]);
    },
    readKeys: (table, column) => {
      log.push(`keys ${table}.${column}`);
      return Promise.resolve(table === 'EMPTY' ? [] : [10, 20]);
    },
    readKeyRows: (table, columns) => {
      log.push(`rows ${table}.${columns.join('+')}`);
      return Promise.resolve([[1, 'x'], [2, 'y']]);
    },
  });
  const requests = [
    { kind: 'file', id: 'f1', key: '/list', path: '/list', file: '/list', params: {} },
    { kind: 'query', id: 'q1', sql: 'select 1', needsConnection: true },
    { kind: 'keys', id: 'k1', entityId: 'p', table: 'P', columns: ['ID'], fieldIds: ['pid'], needsConnection: true },
    { kind: 'keyRows', id: 'k2', entityId: 'c', table: 'C', columns: ['A', 'B'], fieldIds: ['fa', 'fb'], needsConnection: true },
  ];
  test('everything is read once and handed to the generator in its shapes', async () => {
    const log = [];
    const loader = createLoader(io(log));
    const first = await loader.load(requests);
    expect(first.errors).toEqual([]);
    expect(first.lists).toEqual({ file: { '/list': ['a', 'b'] }, query: { 'select 1': [1, 2, 3] } });
    // the columns of a composite key stay side by side: row i of each list is one parent row
    expect(first.parentKeys).toEqual({ p: { pid: [10, 20] }, c: { fa: [1, 2], fb: ['x', 'y'] } });
    expect(loader.isLoaded(requests)).toBe(true);
    await loader.load(requests);
    await Promise.all([loader.load(requests), loader.load(requests)]);
    expect(log).toEqual(['file /list', 'query select 1', 'keys P.ID', 'rows C.A+B']);
    loader.clear();
    await loader.load(requests.slice(0, 1));
    expect(log).toHaveLength(5);
  });
  test('errors are reported per source and kept until asked to read again', async () => {
    const log = [];
    const loader = createLoader(io(log));
    const bad = [{ kind: 'file', id: 'gone', key: '/gone', path: '/gone', file: '/gone', params: {} },
      { kind: 'keys', id: 'e', entityId: 'p', table: 'EMPTY', columns: ['ID'], fieldIds: ['pid'], needsConnection: true }];
    const result = await loader.load(bad.concat(requests[0]));
    expect(result.errors.map(e => [e.request.id, e.error.code]))
      .toEqual([['gone', 'file.read'], ['e', PARENT_EMPTY]]);
    expect(result.lists.file).toEqual({ '/list': ['a', 'b'] });
    await loader.load(bad);
    expect(log.filter(l => l === 'file /gone')).toHaveLength(1);
    loader.clear(true);
    await loader.load(bad.concat(requests[0]));
    expect(log.filter(l => l === 'file /gone')).toHaveLength(2);
    expect(log.filter(l => l === 'file /list')).toHaveLength(1);
  });
  test('without a connection nothing is tried, and it is tried once there is one', async () => {
    const log = [];
    let connected = false;
    const loader = createLoader({ ...io(log), hasConnection: () => connected });
    const none = await loader.load(requests);
    expect(none.errors.map(e => e.error.code)).toEqual([NO_CONNECTION, NO_CONNECTION, NO_CONNECTION]);
    expect(log).toEqual(['file /list']);
    connected = true;
    const now = await loader.load(requests);
    expect(now.errors).toEqual([]);
    expect(log).toHaveLength(4);
  });
  test('a source that throws at once is an error, not a crash', async () => {
    const loader = createLoader({
      hasConnection: () => true,
      readFile: () => {
        throw Object.assign(new Error('bad'), { code: 'TOOL_FAILED' });
      },
    });
    const result = await loader.load([requests[0]]);
    expect(result.errors[0].error.code).toBe('TOOL_FAILED');
  });
});

describe('the target of a database write', () => {
  test('server and database are read from the address, never the credentials', () => {
    expect(parseJdbc('jdbc:sqlserver://127.0.0.1:1433;DatabaseName=shop;encrypt=false'))
      .toEqual({ kind: 'sqlserver', host: '127.0.0.1:1433', database: 'shop' });
    expect(parseJdbc('jdbc:sqlserver://db.local\\SQLEXPRESS;databaseName=My DB'))
      .toEqual({ kind: 'sqlserver', host: 'db.local\\SQLEXPRESS', database: 'My DB' });
    expect(parseJdbc('jdbc:mysql://10.0.0.5:3306/shop?characterEncoding=UTF-8&useSSL=false'))
      .toEqual({ kind: 'mysql', host: '10.0.0.5:3306', database: 'shop' });
    expect(parseJdbc('jdbc:mysql://root:secret@10.0.0.5/shop'))
      .toEqual({ kind: 'mysql', host: '10.0.0.5', database: 'shop' });
    expect(parseJdbc('jdbc:postgresql://localhost:5432/shop?currentSchema=s1'))
      .toEqual({ kind: 'postgresql', host: 'localhost:5432', database: 'shop' });
    expect(parseJdbc('jdbc:postgresql://localhost/'))
      .toEqual({ kind: 'postgresql', host: 'localhost', database: '' });
    expect(parseJdbc('jdbc:oracle:thin:@//ora.local:1521/FREEPDB1'))
      .toEqual({ kind: 'oracle', host: 'ora.local:1521', database: 'FREEPDB1' });
    expect(parseJdbc('jdbc:oracle:thin:@127.0.0.1:1521/FREEPDB1'))
      .toEqual({ kind: 'oracle', host: '127.0.0.1:1521', database: 'FREEPDB1' });
    expect(parseJdbc('jdbc:oracle:thin:scott/tiger@ora.local:1521:ORCL'))
      .toEqual({ kind: 'oracle', host: 'ora.local:1521', database: 'ORCL' });
    expect(parseJdbc('')).toEqual({ kind: '', host: '', database: '' });
    expect(parseJdbc('nonsense')).toEqual({ kind: '', host: '', database: '' });
  });
  test('an address shown as it is has its secrets masked', () => {
    expect(safeUrl('jdbc:mysql://root:secret@10.0.0.5/shop?user=bob&password=p%40ss&x=1'))
      .toBe('jdbc:mysql://10.0.0.5/shop?user=***&password=***&x=1');
    expect(safeUrl('jdbc:sqlserver://h;user=sa;password=Secret1;databaseName=d'))
      .toBe('jdbc:sqlserver://h;user=***;password=***;databaseName=d');
    expect(safeUrl('jdbc:oracle:thin:scott/tiger@host:1521:ORCL'))
      .toBe('jdbc:oracle:thin:@host:1521:ORCL');
  });
  const ds = {
    profile: {
      default: { dbConn: 'c2' },
      dataTypeSupports: [{ id: 'pg', defKey: 'PostgreSQL' }, { id: 'x', defKey: 'DM' }],
    },
    dbConn: [
      { defKey: 'c1', defName: 'first', type: 'pg', properties: { url: 'jdbc:postgresql://h:5432/shop', driver_class_name: 'org.postgresql.Driver', username: 'u', password: 'secret' } },
      { defKey: 'c2', defName: 'second', type: 'x', properties: { url: 'jdbc:dm://h2:5236', driver_class_name: 'dm.jdbc.driver.DmDriver', password: 'secret' } },
      { defKey: 'c3', defName: '', type: '', properties: { url: '', driver_class_name: '' } },
      { defName: 'no key' },
    ],
  };
  test('the default connection is used unless another one is chosen', () => {
    expect(connections(ds).map(c => c.defKey)).toEqual(['c1', 'c2', 'c3']);
    expect(pickConn(ds, '').defKey).toBe('c2');
    expect(pickConn(ds, 'c1').defKey).toBe('c1');
    expect(pickConn(ds, 'gone').defKey).toBe('c2');
    expect(pickConn({ dbConn: [ds.dbConn[0]] }, '').defKey).toBe('c1');
    expect(pickConn({ dbConn: ds.dbConn.slice(0, 2), profile: {} }, '')).toBeNull();
    expect(pickConn({}, '')).toBeNull();
  });
  test('what must be typed before data is deleted: the database, else the connection', () => {
    const first = connTarget(ds, ds.dbConn[0]);
    expect(first).toMatchObject({
      name: 'first',
host: 'h:5432',
database: 'shop',
confirm: 'shop',
byDatabase: true,
      dialect: 'postgresql',
complete: true,
address: '',
    });
    const second = connTarget(ds, ds.dbConn[1]);
    expect(second).toMatchObject({
      name: 'second',
host: 'h2:5236',
database: '',
confirm: 'second',
byDatabase: false,
      dialect: 'generic',
    });
    const third = connTarget(ds, ds.dbConn[2]);
    expect(third).toMatchObject({ name: 'c3', confirm: 'c3', complete: false });
    expect(JSON.stringify([first, second, third])).not.toContain('secret');
    expect(connTarget(ds, null)).toBeNull();
  });
});
