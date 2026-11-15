import demo from '../src/lib/template/教学管理系统.pdma.json';
import {
  ruleByName, copiedRule, pastedTestData, testDataFromText,
} from '../src/lib/testdata/field_copy';
import { compareModels, mergeSelected, allSelectableKeys } from '../src/lib/model_compare_util';
import { packageChanges } from '../src/lib/datasource_version_util';

jest.mock('../src/lib/dbobject_util', () => ({
  getDbObjectDDL: () => '',
}), { virtual: true });

const clone = () => JSON.parse(JSON.stringify(demo));
const withRules = (ds, rules) => ({
  ...ds,
  profile: { ...ds.profile, testData: { rules } },
});
const names = { id: 'r-names', name: 'Names', kind: 'builtin', params: { name: 'tw.name' } };
const codes = { id: 'r-codes', name: 'Codes', kind: 'pattern', params: { mask: 'A-###' } };

describe('the rule of a column that is copied', () => {
  const source = withRules({}, [names, codes]);

  test('the name and the kind travel with the column', () => {
    expect(copiedRule(source, { testData: { rule: 'r-names', nullRate: 5 } }))
      .toEqual({ name: 'Names', kind: 'builtin' });
    expect(copiedRule(source, { testData: { rule: 'gone' } })).toBeUndefined();
    expect(copiedRule(source, { testData: { nullRate: 5 } })).toBeUndefined();
    expect(copiedRule(source, {})).toBeUndefined();
  });

  test('the same project: the rule stays', () => {
    expect(pastedTestData(source, { testData: { rule: 'r-names', nullRate: 5 } }))
      .toEqual({ rule: 'r-names', nullRate: 5 });
  });

  test('another project: its rule of the same name, else no rule and never a foreign id', () => {
    const copied = { name: 'Names', kind: 'builtin' };
    const field = { testData: { rule: 'r-names', nullRate: 5 } };
    const twin = withRules({}, [{ ...names, id: 'other-id', name: ' names ' }]);
    expect(pastedTestData(twin, field, copied)).toEqual({ rule: 'other-id', nullRate: 5 });
    // a rule that only shares the name is another rule
    const other = withRules({}, [{ ...codes, id: 'x', name: 'Names' }]);
    expect(pastedTestData(other, field, copied)).toEqual({ nullRate: 5 });
    expect(pastedTestData(withRules({}, []), field, copied)).toEqual({ nullRate: 5 });
    expect(pastedTestData({}, { testData: { rule: 'r-names' } }, copied)).toBeUndefined();
    expect(pastedTestData(twin, { testData: { rule: 'r-names' } })).toBeUndefined();
    expect(pastedTestData(twin, {})).toBeUndefined();
  });

  test('a line pasted from a spreadsheet binds the rule named in the rule column', () => {
    expect(testDataFromText(source, 'Names')).toEqual({ rule: 'r-names' });
    expect(testDataFromText(source, ' codes ')).toEqual({ rule: 'r-codes' });
    expect(testDataFromText(source, '自动')).toBeUndefined();
    expect(testDataFromText(source, '')).toBeUndefined();
    expect(testDataFromText(source, undefined)).toBeUndefined();
    expect(ruleByName({}, 'Names')).toBeNull();
  });
});

describe('the rule of a column is no change of the table', () => {
  const bind = (ds, value) => {
    const next = clone();
    next.profile.testData = ds.profile.testData;
    next.entities[0].fields[1].testData = value;
    return next;
  };

  test('version history: binding, changing and removing a rule changes nothing', () => {
    const before = withRules(clone(), [names, codes]);
    const bound = bind(before, { rule: 'r-names' });
    expect(packageChanges(bound, before)).toEqual([]);
    expect(packageChanges(bind(before, { rule: 'r-codes', nullRate: 10 }), bound)).toEqual([]);
    expect(packageChanges(before, bound)).toEqual([]);
    // a real change is still found
    const renamed = bind(before, { rule: 'r-names' });
    renamed.entities[0].fields[1].defName = 'renamed';
    expect(packageChanges(renamed, before)).toHaveLength(1);
  });

  test('model compare: no difference, and a merged column gets a rule of the target only', () => {
    const target = withRules(clone(), [{ ...names, id: 'target-names' }]);
    const source = bind(withRules(clone(), [names, codes]), { rule: 'r-names' });
    expect(compareModels(source, target).items).toEqual([]);
    const extra = { ...source.entities[0].fields[1], id: 'F-NEW', defKey: 'TD_EXTRA', testData: { rule: 'r-names' } };
    const lost = { ...extra, id: 'F-LOST', defKey: 'TD_LOST', testData: { rule: 'r-codes', nullRate: 3 } };
    source.entities[0].fields.push(extra, lost);
    const result = compareModels(source, target);
    const merged = mergeSelected(target, source, result, allSelectableKeys(result));
    const fields = merged.entities.find(e => e.defKey === source.entities[0].defKey).fields;
    expect(fields.find(f => f.defKey === 'TD_EXTRA').testData).toEqual({ rule: 'target-names' });
    expect(fields.find(f => f.defKey === 'TD_LOST').testData).toEqual({ nullRate: 3 });
  });
});

// ---- what the plan says about one column, shown where its rule is chosen ----------------
describe('the column window says what a run would do with the column', () => {
  /* eslint-disable global-require */
  const { columnFacts, columnNoteLines, ruleUnused } = require('../src/app/container/tools/testdata/rules/columnNotes');
  const langs = require('../src/lang').default;
  const get = require('lodash').get;
  /* eslint-enable global-require */
  const text = (lang, block) => (id, data) => `${get(langs[lang], `${block}.${id}`, '')}`
    .replace(/\{(\w+)\}/g, (all, name) => (data && data[name] !== undefined ? data[name] : all));
  const lines = (ds, entity, field, value, lang = 'zhTW') => columnNoteLines(
    text(lang, 'testDataRule'), text(lang, 'testData'), columnFacts(ds, entity, field, value));
  const f = (id, type, more) => ({ id, defKey: id.toUpperCase(), type, len: '', scale: '', ...more });
  const parent = {
    id: 'p',
    defKey: 'PARENT',
    fields: [f('pid', 'VARCHAR', { len: 32, primaryKey: true, notNull: true }), f('pname', 'VARCHAR', { len: 20 })],
  };
  const child = {
    id: 'c',
    defKey: 'CHILD',
    fields: [
      f('cid', 'TINYINT', { primaryKey: true, notNull: true, autoIncrement: true }),
      f('ref', 'VARCHAR', { len: 8, notNull: true }),
      f('code', 'VARCHAR', { len: 10 }),
      f('note', 'VARCHAR', { len: 10 }),
    ],
    correlations: [{ myField: 'ref', refEntity: 'p', refField: 'pid', myRows: 'n', refRows: '1' }],
    indexes: [{ defKey: 'u', unique: true, fields: [{ fieldDefKey: 'code' }] }],
  };
  const ds = {
    entities: [parent, child],
    profile: { testData: { rules: [names], settings: { defaultRows: 1000 } } },
  };
  const field = id => child.fields.find(x => x.id === id);

  test('a foreign key: the rule is not used, and a key that does not fit is told', () => {
    const facts = columnFacts(ds, child, field('ref'), { rule: 'r-names' });
    expect(ruleUnused(facts)).toBe(true);
    const out = lines(ds, child, field('ref'), { rule: 'r-names' });
    expect(out[0]).toEqual({ level: 'info', text: '這是外鍵欄位：產生資料時值取自上層資料表的 PARENT.PID，不使用規則' });
    // PARENT.PID is VARCHAR(32), CHILD.REF only VARCHAR(8)
    expect(out[1].level).toBe('bad');
    expect(out[1].text).toMatch(/^CHILD\.REF 放不下 PARENT\.PID 的鍵值/);
    expect(lines(ds, child, field('ref'), undefined, 'en')[1].text)
      .toMatch(/^CHILD\.REF cannot hold/);
  });

  test('an auto increment column: numbered, and told when the numbers will not fit', () => {
    const out = lines(ds, child, field('cid'));
    expect(out[0].text).toBe('這是自動編號欄位：產生資料時由程式依序編號或交給資料庫，不使用規則');
    // 1000 rows in a TINYINT
    expect(out[1]).toMatchObject({ level: 'bad' });
    expect(out[1].text).toMatch(/^CHILD\.CID 的自動編號/);
  });

  test('a column of a unique index never gets the NULL rate that was set', () => {
    expect(lines(ds, child, field('code'), { rule: 'r-names', nullRate: 20 }).map(l => l.text))
      .toEqual(['欄位屬於主鍵或唯一索引，不會留 NULL（設定的 20% 不套用）']);
  });

  test('an ordinary column, and a column that cannot be planned, say nothing', () => {
    expect(lines(ds, child, field('note'), { rule: 'r-names' })).toEqual([]);
    expect(ruleUnused(columnFacts(ds, child, field('note')))).toBe(false);
    expect(lines(ds, null, field('note'))).toEqual([]);
    expect(lines(null, child, field('note'))).toEqual([]);
    // a table that is not in the project yet (being made) is planned as it is on screen
    const fresh = { ...child, id: 'new', correlations: [] };
    expect(columnFacts(ds, fresh, field('note')).line.role).toBe('rule');
  });
});
