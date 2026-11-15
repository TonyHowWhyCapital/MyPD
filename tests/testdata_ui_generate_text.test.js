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

describe('what the window shows of tables and columns', () => {
  test('the rule of a column follows a tab with unsaved edits; the structure does not', () => {
    const ds = project();
    ds.entities[0].fields[1].testData = { rule: 'saved' };
    const tabs = {
      t1: {
        type: 'entity',
        key: 'users',
        isInit: false,
        data: {
          id: 'users',
          defKey: 'RENAMED',
          fields: [{ ...ds.entities[0].fields[1], defKey: 'CHANGED', testData: { rule: 'fromTab', nullRate: 5 } },
            field('brand_new', { testData: { rule: 'x' } })],
        },
      },
      t2: { type: 'entity', key: 'orders', isInit: true, data: { id: 'orders', fields: [] } },
      t3: { type: 'diagram', key: 'd', data: {} },
    };
    const view = withTabRules(ds, tabs);
    expect(view.entities[0].defKey).toBe('USERS');
    expect(view.entities[0].fields.map(f => f.defKey)).toEqual(['U_ID', 'U_NAME']);
    expect(view.entities[0].fields[1].testData).toEqual({ rule: 'fromTab', nullRate: 5 });
    expect(view.entities[1]).toBe(ds.entities[1]);
    expect(ds.entities[0].fields[1].testData).toEqual({ rule: 'saved' });
    expect(dirtyEntityIds(tabs)).toEqual(['users']);
    expect(withTabRules(ds, {})).toBe(ds);
    expect(withTabRules(ds, { t2: tabs.t2 })).toBe(ds);
    // a rule removed in the tab is removed in the view as well
    const cleared = withTabRules(ds, {
      t1: { ...tabs.t1, data: { fields: [{ ...ds.entities[0].fields[1], testData: undefined }] } },
    });
    expect('testData' in cleared.entities[0].fields[1]).toBe(false);
  });
  test('a change made in the window reaches the tab without touching its other edits', () => {
    const data = {
      id: 'users',
      defKey: 'EDITED_NAME',
      fields: [field('u_id'), { ...field('u_name'), defKey: 'EDITED', testData: { rule: 'a' } }],
    };
    const next = patchTabData(data, 'u_name', { rule: 'b', nullRate: 10 });
    expect(next.defKey).toBe('EDITED_NAME');
    expect(next.fields[1]).toMatchObject({ defKey: 'EDITED', testData: { rule: 'b', nullRate: 10 } });
    expect(next.fields[0]).toBe(data.fields[0]);
    expect(data.fields[1].testData).toEqual({ rule: 'a' });
    expect('testData' in patchTabData(data, 'u_name', undefined).fields[1]).toBe(false);
    expect(patchTabData(data, 'u_name', { rule: 'a' })).toBeNull();
    expect(patchTabData(data, 'removed_in_tab', { rule: 'b' })).toBeNull();
  });
  test('rows of a table: fixed, a range through a generated parent, open through the database',
    () => {
      const ds = project({
        defaultRows: 10,
        tables: { orders: { perParent: { field: 'o_user', min: 2, max: 4 } } },
      });
      const plan = buildPlan(ds, { entityIds: ['users', 'orders'] });
      const byId = id => plan.tables.find(t => t.entityId === id);
      expect(plannedRows(plan, byId('users'))).toEqual({ kind: 'fixed', min: 10, max: 10 });
      expect(plannedRows(plan, byId('orders'))).toEqual({ kind: 'range', min: 20, max: 40 });
      expect(totalRows(plan)).toEqual({ min: 30, max: 50, open: false });
      const open = buildPlan(ds, { entityIds: ['orders'], external: { users: 'database' } });
      expect(plannedRows(open, open.tables[0]).kind).toBe('unknown');
      expect(totalRows(open).open).toBe(true);
      expect(parentChoices(ds, ds.entities[2])).toEqual([{
        fieldId: 'i_order', column: 'I_ORDER, I_NO', parentId: 'orders', parent: 'ORDERS',
      }]);
      expect(parentChoices(ds, ds.entities[0])).toEqual([]);
    });
  test('lines of the columns say how each one is filled', () => {
    const ds = project({ tables: { users: { autoIncrement: 'database' } } });
    ds.entities[0].fields[1].testData = { nullRate: 30 };
    const plan = buildPlan(ds, { entityIds: ['users', 'orders'] });
    const users = columnLines(ds, ds.entities[0], plan.tables.find(t => t.entityId === 'users'));
    expect(users.map(l => [l.column.defKey, l.role])).toEqual([['U_ID', 'omitted'], ['U_NAME', 'rule']]);
    expect(users[0]).toMatchObject({ nullable: false, notes: [], notices: [] });
    expect(users[1]).toMatchObject({ nullable: true, nullRate: 30, unique: false });
    const orders = columnLines(ds, ds.entities[1], plan.tables.find(t => t.entityId === 'orders'));
    expect(orders.map(l => l.role)).toEqual(['rule', 'rule', 'foreign']);
    expect(orders[2].foreign).toMatchObject({ refEntityId: 'users', source: 'generated' });
    expect(orders[0].unique).toBe(true);
    expect(ownRuleCount(ds.entities[0])).toBe(1);
    expect(ownRuleCount(ds.entities[1])).toBe(0);
  });
  test('notices of the plan stand beside their column', () => {
    const ds = project();
    // a null rate on a column of the primary key cannot be honoured
    ds.entities[1].fields[0] = { ...ds.entities[1].fields[0], notNull: false, primaryKey: false };
    ds.entities[1].indexes = [{ defKey: 'ux', unique: true, fields: [{ fieldDefKey: 'o_id' }] }];
    ds.entities[1].fields[0].testData = { nullRate: 40 };
    const plan = buildPlan(ds, { entityIds: ['users', 'orders'] });
    expect((plan.notices || []).map(n => [n.code, n.entityId, n.fieldId]))
      .toEqual([['nullRateIgnored', 'orders', 'o_id']]);
    const lines = columnLines(ds, ds.entities[1], plan.tables.find(t => t.entityId === 'orders'),
      plan.notices);
    expect(lines[0].notices).toHaveLength(1);
    expect(lines[0].nullRate).toBe(0);
    expect(lines[1].notices).toEqual([]);
    expect(noticeText(tr('en'), lines[0].notices[0]))
      .toBe('Part of a key or unique index: never NULL (the 40% set is not applied)');
    expect(noticeText(tr('zh'), { code: 'columnSkipped', detail: 'rowversion' })).toContain('rowversion');
    expect(noticeText(tr('en'), { code: 'laterNotice', detail: { a: 1 } })).toContain('laterNotice');
  });
  test('tables are grouped as in the navigation and found by name', () => {
    const ds = project();
    const groups = groupedEntities(ds, 'Ungrouped');
    expect(groups.map(g => [g.name, g.entities.map(e => e.defKey)])).toEqual([
      ['Sales', ['ORDERS', 'ITEMS']], ['Ungrouped', ['USERS']]]);
    expect(matchesKeyword(ds.entities[0], ' user ')).toBe(true);
    expect(matchesKeyword(ds.entities[0], 'USERS')).toBe(true);
    expect(matchesKeyword(ds.entities[0], 'order')).toBe(false);
    expect(matchesKeyword(ds.entities[0], '')).toBe(true);
  });
  test('numbers, sizes and times', () => {
    expect(count(1234567)).toBe('1,234,567');
    expect(count(999)).toBe('999');
    expect(count(undefined)).toBe('');
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(150499)).toBe('147 KB');
    expect(fileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(duration(tr('en'), 400)).toBe('less than a second');
    expect(duration(tr('en'), 59400)).toBe('59 s');
    expect(duration(tr('en'), 125000)).toBe('2 min 5 s');
    expect(typeText({ type: 'VARCHAR', len: 32, scale: null })).toBe('VARCHAR(32)');
    expect(typeText({ type: 'DECIMAL', len: 10, scale: 2 })).toBe('DECIMAL(10,2)');
    expect(typeText({ type: 'INT', len: null })).toBe('INT');
    expect(percent(5, 0)).toBe(0);
    expect(percent(1, 3)).toBe(33);
    expect(percent(9, 3)).toBe(100);
  });
});

describe('texts of the window', () => {
  test('the three languages have the same keys', () => {
    expect(keyPaths(langs.en.testData)).toEqual(keyPaths(langs.zh.testData));
    expect(keyPaths(langs.zhTW.testData)).toEqual(keyPaths(langs.zh.testData));
  });
  test('no text is empty and placeholders are the same in every language', () => {
    const holes = s => (s.match(/\{\w+\}/g) || []).filter((h, i, l) => l.indexOf(h) === i)
      .sort().join();
    keyPaths(langs.zh.testData).forEach((key) => {
      const zh = _.get(langs.zh.testData, key);
      LANGS.forEach((lang) => {
        const value = _.get(langs[lang].testData, key);
        expect([lang, key, typeof value === 'string' && value.trim() !== '']).toEqual([lang, key, true]);
        expect([lang, key, holes(value)]).toEqual([lang, key, holes(zh)]);
      });
    });
  });
  test('Traditional Chinese uses the words of Taiwan', () => {
    const all = JSON.stringify(langs.zhTW.testData);
    ['資料表', '欄位', '資料庫', '連線', '筆', '檔案', '資料夾', '預覽', '活頁簿'].forEach((word) => {
      expect(all).toContain(word);
    });
    ['数据', '字段', '文件', '程式碼', '隻能', '賬號', '型別」', '二進位制'].forEach((word) => {
      expect([word, all.includes(word)]).toEqual([word, false]);
    });
  });
  test('every text the window asks for exists', () => {
    const dir = path.join(root, 'src/app/container/tools/testdata/generate');
    const files = fs.readdirSync(dir).filter(f => /\.js$/.test(f));
    const ids = [];
    files.forEach((f) => {
      const source = fs.readFileSync(path.join(dir, f), 'utf8');
      const re = /\btr\(\s*'([\w.]+)'/g;
      let m = re.exec(source);
      while (m) {
        ids.push([f, m[1]]);
        m = re.exec(source);
      }
      // tr(cond ? 'a' : 'b', …)
      const pick = /\btr\([^'`)]*\?\s*'([\w.]+)'\s*:\s*'([\w.]+)'/g;
      m = pick.exec(source);
      while (m) {
        ids.push([f, m[1]], [f, m[2]]);
        m = pick.exec(source);
      }
    });
    expect(ids.length).toBeGreaterThan(150);
    const missing = ids.filter(([, id]) => typeof _.get(langs.zh.testData, id) !== 'string');
    expect(missing).toEqual([]);
    // ids built at run time
    const built = {
      step: ['tables', 'columns', 'output'],
      dialect: ['mssql', 'mysql', 'postgresql', 'oracle', 'generic'],
      load: ['file', 'query', 'keys', 'keyRows'],
      note: ['deferred', 'binaryNull', 'binaryHex'],
      notice: ['columnSkipped', 'nullRateIgnored'],
      'output.path': ['empty', 'relative', 'isDirectory', 'isFile', 'parentIsFile'],
      'run.stage': ['load', 'generate', 'finish', 'database'],
    };
    Object.keys(built).forEach(group => built[group].forEach((key) => {
      expect([group, key, typeof _.get(langs.en.testData, `${group}.${key}`)])
        .toEqual([group, key, 'string']);
    }));
  });
});
