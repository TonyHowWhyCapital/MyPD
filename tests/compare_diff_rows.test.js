import demo from '../src/lib/template/教学管理系统.pdma.json';
import {simplePackageChanges} from '../src/lib/datasource_version_util';
import {diffRows, typeText, KIND_ORDER, KIND_LANG_KEY} from '../src/lib/compare_diff_rows';

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

  test('table only in the database is listed as extra with an empty after', () => {
    const model = clone();
    const db = clone();
    model.entities = model.entities.filter(e => e.defKey !== 'SIMS_EXAM');
    const rows = rowsOf(model, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({kind: 'tableExtra', after: ''});
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

describe('kind table', () => {
  test('every kind has a language key', () => {
    expect(Object.keys(KIND_LANG_KEY).sort()).toEqual([...KIND_ORDER].sort());
  });
  test('typeText formats type, length and scale', () => {
    expect(typeText({type: 'INT', len: '', scale: ''})).toBe('INT');
    expect(typeText({type: 'DECIMAL', len: 10, scale: 2})).toBe('DECIMAL(10,2)');
    expect(typeText(null)).toBe('');
  });
});
