import demo from '../src/lib/template/教学管理系统.pdma.json';
import {simplePackageChanges, packageChanges} from '../src/lib/datasource_version_util';
import {diffRows, typeText, KIND_ORDER, KIND_LANG_KEY, ATTR_LANG_KEY} from '../src/lib/compare_diff_rows';
import zh from '../src/lang/zh';
import en from '../src/lang/en';

const clone = () => JSON.parse(JSON.stringify(demo));
const find = (ds, key) => ds.entities.find(e => e.defKey === key);
const plain = (f, props) => Object.assign(f, {domain: '', baseType: '', ...props});

// model = what the user edits, db = the live database snapshot
const rowsOf = (model, db) => diffRows(simplePackageChanges(model, db, null, true));

describe('diffRows', () => {
  test('identical model and database yield no rows', () => {
    expect(rowsOf(clone(), clone())).toEqual([]);
    expect(diffRows([])).toEqual([]);
    expect(diffRows()).toEqual([]);
  });

  test('table only in the model is listed as added with its field count', () => {
    const model = clone();
    const db = clone();
    const gone = find(db, 'SIMS_EXAM');
    db.entities = db.entities.filter(e => e !== gone);
    const exam = find(model, 'SIMS_EXAM');
    const rows = rowsOf(model, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({kind: 'tableAdd', before: ''});
    expect(rows[0].table).toContain('SIMS_EXAM');
    expect(rows[0].after).toContain(`(${exam.fields.length})`);
  });

  test('table only in the database is listed as removed with an empty after', () => {
    const model = clone();
    const db = clone();
    model.entities = model.entities.filter(e => e.defKey !== 'SIMS_EXAM');
    const rows = rowsOf(model, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({kind: 'tableRemove', after: ''});
    expect(rows[0].before).toContain('SIMS_EXAM');
  });

  test('table name and comment changes show database value before and model value after', () => {
    const model = clone();
    const db = clone();
    find(db, 'SIMS_COLLEGE').defName = 'Old name';
    find(model, 'SIMS_COLLEGE').defName = 'New name';
    find(db, 'SIMS_COLLEGE').comment = '';
    find(model, 'SIMS_COLLEGE').comment = 'New comment';
    const rows = rowsOf(model, db);
    expect(rows.map(r => [r.kind, r.attr, r.before, r.after])).toEqual([
      ['tableBase', 'defName', 'Old name', 'New name'],
      ['tableBase', 'comment', '', 'New comment'],
    ]);
  });

  test('field only in the model is added, field only in the database is removed', () => {
    const model = clone();
    const db = clone();
    const base = find(model, 'SIMS_TEACHER').fields[1];
    find(model, 'SIMS_TEACHER').fields.push(plain({...base, id: 'NEWF', defKey: 'AGE_X', defName: 'Age'}, {type: 'INT', len: '', scale: ''}));
    find(db, 'SIMS_TEACHER').fields.push(plain({...base, id: 'OLDF', defKey: 'OLD_X', defName: ''}, {type: 'VARCHAR', len: 20, scale: ''}));
    const rows = rowsOf(model, db);
    expect(rows).toEqual([
      expect.objectContaining({kind: 'fieldAdd', target: 'AGE_X', before: '', after: 'INT [Age]'}),
      expect.objectContaining({kind: 'fieldRemove', target: 'OLD_X', before: 'VARCHAR(20)', after: ''}),
    ]);
  });

  test('length change reads VARCHAR(32) to VARCHAR(64)', () => {
    const model = clone();
    const db = clone();
    plain(find(db, 'SIMS_COLLEGE').fields[1], {type: 'VARCHAR', len: 32, scale: ''});
    plain(find(model, 'SIMS_COLLEGE').fields[1], {type: 'VARCHAR', len: 64, scale: ''});
    const rows = rowsOf(model, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({kind: 'fieldModify', attr: 'type', before: 'VARCHAR(32)', after: 'VARCHAR(64)'});
    expect(rows[0].target).toBe(find(model, 'SIMS_COLLEGE').fields[1].defKey);
  });

  test('changing only the scale yields a single type row', () => {
    const model = clone();
    const db = clone();
    plain(find(db, 'SIMS_COLLEGE').fields[1], {type: 'DECIMAL', len: 10, scale: 0});
    plain(find(model, 'SIMS_COLLEGE').fields[1], {type: 'DECIMAL', len: 10, scale: 2});
    const rows = rowsOf(model, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({attr: 'type', before: 'DECIMAL(10,0)', after: 'DECIMAL(10,2)'});
  });

  test('field name and comment changes are separate rows', () => {
    const model = clone();
    const db = clone();
    find(db, 'SIMS_COLLEGE').fields[2].defName = 'Old field name';
    find(db, 'SIMS_COLLEGE').fields[2].comment = 'old';
    find(model, 'SIMS_COLLEGE').fields[2].defName = 'New field name';
    find(model, 'SIMS_COLLEGE').fields[2].comment = 'new';
    const rows = rowsOf(model, db);
    expect(rows.map(r => [r.kind, r.attr, r.before, r.after])).toEqual([
      ['fieldModify', 'defName', 'Old field name', 'New field name'],
      ['fieldModify', 'comment', 'old', 'new'],
    ]);
  });

  test('rows are sorted by table then by kind order', () => {
    const model = clone();
    const db = clone();
    find(model, 'SIMS_MAJOR').defName = 'x';
    find(model, 'SIMS_MAJOR').fields[1].defName = 'y';
    find(model, 'SIMS_COLLEGE').fields[1].defName = 'z';
    model.entities = model.entities.filter(e => e.defKey !== 'SIMS_EXAM');
    const rows = rowsOf(model, db);
    const tables = rows.map(r => r.table);
    expect(tables).toEqual([...tables].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    const major = rows.filter(r => r.table.startsWith('SIMS_MAJOR')).map(r => r.kind);
    expect(major).toEqual(['tableBase', 'fieldModify']);
  });
});

// current = this version, pre = the previous version
const versionRows = (current, pre) => diffRows(packageChanges(current, pre, current.profile.default.db));

describe('diffRows on version changes', () => {
  test('identical versions yield no rows', () => {
    expect(versionRows(clone(), clone())).toEqual([]);
  });

  test('field attributes beyond type and names are listed', () => {
    const current = clone();
    const pre = clone();
    const field = find(current, 'SIMS_COLLEGE').fields[2];
    field.notNull = !field.notNull;
    field.defaultValue = 'N/A';
    const rows = versionRows(current, pre);
    expect(rows.map(r => [r.kind, r.target, r.attr])).toEqual([
      ['fieldModify', field.defKey, 'notNull'],
      ['fieldModify', field.defKey, 'defaultValue'],
    ]);
    expect(rows[1]).toMatchObject({before: '', after: 'N/A'});
    expect(rows[0].after).toBe(field.notNull ? '✓' : '');
  });

  test('a renamed field shows the old and new code', () => {
    const current = clone();
    const pre = clone();
    const oldKey = find(pre, 'SIMS_COLLEGE').fields[2].defKey;
    find(current, 'SIMS_COLLEGE').fields[2].defKey = 'RENAMED';
    const rows = versionRows(current, pre);
    expect(rows).toEqual([expect.objectContaining({
      kind: 'fieldModify', target: 'RENAMED', attr: 'defKey', before: oldKey, after: 'RENAMED',
    })]);
  });

  test('a removed table is listed as removed', () => {
    const current = clone();
    const pre = clone();
    current.entities = current.entities.filter(e => e.defKey !== 'SIMS_EXAM');
    const rows = versionRows(current, pre);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({kind: 'tableRemove', after: ''});
  });

  test('index changes show the index columns before and after', () => {
    const current = clone();
    const pre = clone();
    const student = find(current, 'SIMS_STUDENT');
    const index = student.indexes[0];
    index.unique = true;
    const rows = versionRows(current, pre).filter(r => r.kind === 'indexModify');
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe(index.defKey);
    expect(rows[0].before.startsWith('(')).toBe(true);
    expect(rows[0].after.startsWith('UNIQUE (')).toBe(true);
    const keys = index.fields.map(f => student.fields.find(x => x.id === f.fieldDefKey).defKey);
    keys.forEach(k => expect(rows[0].after).toContain(k));
  });

  test('a changed property shows the previous value before', () => {
    const current = clone();
    const pre = clone();
    find(pre, 'SIMS_COLLEGE').properties = {partitionBy: 'old'};
    find(current, 'SIMS_COLLEGE').properties = {partitionBy: 'new', engine: 'InnoDB'};
    const rows = versionRows(current, pre);
    expect(rows.map(r => [r.kind, r.target, r.before, r.after])).toEqual([
      ['propAdd', 'engine', '', 'InnoDB'],
      ['propModify', 'partitionBy', 'old', 'new'],
    ]);
  });

  test('a removed view is listed with the view kind', () => {
    const current = clone();
    const pre = clone();
    current.views = current.views.slice(1);
    const rows = versionRows(current, pre);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('viewRemove');
  });
});

const has = (lang, id) => id.split('.').reduce((p, k) => (p == null ? p : p[k]), lang) !== undefined;

describe('kind table', () => {
  test('every kind has a language key', () => {
    expect(Object.keys(KIND_LANG_KEY).sort()).toEqual([...KIND_ORDER].sort());
  });
  test('every kind, attribute and column label exists in both languages', () => {
    const scene = ['diffBefore', 'diffAfter', 'diffNone', 'diffBeforeVersion', 'diffAfterVersion',
      'diffNoneVersion', 'diffBeforeTable', 'diffAfterTable', 'diffNoneTable', 'diffKind_tableExtra',
      'diffKind_onlyCheck', 'diffKind_onlyDiff', 'diffExtraNote', 'diffList', 'diffListTitle']
      .map(k => `components.compare.${k}`);
    const ids = [...Object.values(KIND_LANG_KEY), ...Object.values(ATTR_LANG_KEY), ...scene];
    [zh, en].forEach((lang) => {
      expect(ids.filter(id => !has(lang, id))).toEqual([]);
    });
  });
  test('typeText formats type, length and scale', () => {
    expect(typeText({type: 'INT', len: '', scale: ''})).toBe('INT');
    expect(typeText({type: 'DECIMAL', len: 10, scale: 2})).toBe('DECIMAL(10,2)');
    expect(typeText(null)).toBe('');
  });
});
