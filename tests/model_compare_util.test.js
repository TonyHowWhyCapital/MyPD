import demo from '../src/lib/template/教学管理系统.pdma.json';
import {
  compareModels, selectChanges, generateAlterScript, mergeSelected, allSelectableKeys,
} from '../src/lib/model_compare_util';

jest.mock('../src/lib/dbobject_util', () => ({
  getDbObjectDDL: (obj, ds, dbId, kind) => `-- ${kind} ${obj.type} ${obj.defKey}`,
}), {virtual: true});

const clone = () => JSON.parse(JSON.stringify(demo));
const find = (ds, key) => ds.entities.find(e => e.defKey === key);
const item = (r, key) => r.items.find(i => i.key === key);
const all = (r) => allSelectableKeys(r);

describe('compareModels', () => {
  test('identical models yield no items', () => {
    const r = compareModels(clone(), clone());
    expect(r.items).toEqual([]);
    expect(r.changes).toEqual([]);
  });

  test('reports added, removed and changed tables with field and index children', () => {
    const source = clone();
    const target = clone();
    find(source, 'SIMS_COLLEGE').defName = 'Renamed';
    Object.assign(find(source, 'SIMS_MAJOR').fields[1], {domain: '', baseType: '', type: 'VARCHAR', len: 77});
    find(source, 'SIMS_CLASS').fields.splice(2, 1);
    find(source, 'SIMS_TEACHER').fields.push({...find(source, 'SIMS_TEACHER').fields[1], id: 'NEWF', defKey: 'AGE_X', domain: '', baseType: '', type: 'INT', len: '', scale: ''});
    find(target, 'SIMS_EXAM').defKey = 'ONLY_IN_TARGET';
    source.entities.push({...clone().entities[0], defKey: 'ONLY_IN_SOURCE', id: 'X1'});
    find(source, 'SIMS_STUDENT').indexes = [];
    const r = compareModels(source, target);
    expect(item(r, 'entity:only_in_source').opt).toBe('add');
    expect(item(r, 'entity:only_in_target').opt).toBe('delete');
    expect(item(r, 'entity:sims_college').children[0]).toMatchObject({part: 'base', after: {defName: 'Renamed'}});
    expect(item(r, 'entity:sims_major').children[0]).toMatchObject({part: 'field', opt: 'update'});
    expect(item(r, 'entity:sims_class').children.filter(c => c.opt === 'delete')).toHaveLength(1);
    expect(item(r, 'entity:sims_teacher').children[0]).toMatchObject({part: 'field', opt: 'add', defKey: 'AGE_X'});
    const idx = item(r, 'entity:sims_student');
    expect(idx.children.map(c => c.part)).toEqual(['index', 'index']);
    expect(idx.children[0].opt).toBe('delete');
  });

  test('invalid input throws', () => {
    expect(() => compareModels(null, clone())).toThrow(/Invalid data source/);
    expect(() => compareModels(clone(), {entities: 'x'})).toThrow(/Invalid data source/);
    expect(() => generateAlterScript({}, [], clone())).toThrow(/Invalid compare result/);
    const r = compareModels(clone(), clone());
    expect(() => selectChanges(r, 'abc')).toThrow(/selectedKeys/);
  });
});

describe('script generation', () => {
  const build = () => {
    const source = clone();
    const target = clone();
    const e = find(source, 'SIMS_COLLEGE');
    e.fields[1].len = 77;
    e.fields[2].defName = 'changed name';
    e.fields.push({...e.fields[1], id: 'NEWF', defKey: 'EXTRA_COL', domain: '', baseType: '', type: 'INT', len: '', scale: ''});
    find(source, 'SIMS_MAJOR').fields.pop();
    find(source, 'SIMS_STUDENT').indexes[0].unique = true;
    return {source, target, r: compareModels(source, target)};
  };

  test('empty selection gives an empty script and no changes', () => {
    const {r, target} = build();
    expect(selectChanges(r, [])).toEqual([]);
    expect(generateAlterScript(r, [], target)).toBe('');
  });

  test('partial selection renders only the ticked statements', () => {
    const {r, target} = build();
    const colleges = item(r, 'entity:sims_college').children;
    const added = colleges.find(c => c.opt === 'add');
    const sql = generateAlterScript(r, [added.key], target);
    expect(sql).toMatch(/EXTRA_COL/);
    expect(sql).not.toMatch(/MODIFY COLUMN/);
    expect(sql).not.toMatch(/SIMS_MAJOR/);
    expect(sql).not.toMatch(/DROP SIMS_MAJOR|DROP /);
    const sel = selectChanges(r, [added.key]);
    expect(sel).toHaveLength(1);
    expect(sel[0].data.fieldModified).toBeNull();
    expect(sel[0].data.indexChanged).toBe(false);
  });

  test('field removal, modification and index rebuild render', () => {
    const {r, target} = build();
    const removed = item(r, 'entity:sims_major').children[0];
    expect(removed.opt).toBe('delete');
    expect(generateAlterScript(r, [removed.key], target)).toMatch(/DROP /);
    const mod = item(r, 'entity:sims_college').children.filter(c => c.opt === 'update');
    expect(generateAlterScript(r, mod.map(c => c.key), target)).toMatch(/MODIFY COLUMN/);
    const index = item(r, 'entity:sims_student').children[0];
    const idxSql = generateAlterScript(r, [index.key], target);
    expect(idxSql).toMatch(/CREATE UNIQUE INDEX IDX_SMIS_STUDENT_01 ON SIMS_STUDENT\(/);
    expect(idxSql).not.toMatch(/ADD COLUMN/);
  });

  test('ticking an added table creates it and a deleted table drops it', () => {
    const source = clone();
    const target = clone();
    source.entities.pop();
    const r = compareModels(source, target);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].opt).toBe('delete');
    expect(generateAlterScript(r, [r.items[0].key], target)).toMatch(/DROP TABLE/i);
    const back = compareModels(target, source);
    expect(generateAlterScript(back, [back.items[0].key], source)).toMatch(/CREATE TABLE/i);
  });
});

describe('mergeSelected', () => {
  test('full merge converges', () => {
    const source = clone();
    const target = clone();
    find(source, 'SIMS_COLLEGE').defName = 'Renamed';
    Object.assign(find(source, 'SIMS_MAJOR').fields[1], {domain: '', baseType: '', type: 'VARCHAR', len: 77});
    find(source, 'SIMS_CLASS').fields.splice(2, 1);
    const e = find(source, 'SIMS_TEACHER');
    e.fields.splice(1, 0, {...e.fields[1], id: 'NEWF', defKey: 'EXTRA_COL', domain: '', baseType: '', type: 'INT', len: '', scale: ''});
    find(source, 'SIMS_STUDENT').indexes.pop();
    source.entities.push({...clone().entities[0], defKey: 'ONLY_IN_SOURCE', id: demo.entities[1].id});
    target.entities.pop();
    const r = compareModels(source, target);
    expect(r.items.length).toBeGreaterThan(4);
    const merged = mergeSelected(target, source, r, all(r));
    expect(find(merged, 'ONLY_IN_SOURCE').id).not.toBe(demo.entities[1].id);
    expect(find(merged, 'SIMS_TEACHER').fields[1].defKey).toBe('EXTRA_COL');
    const again = compareModels(source, merged);
    expect(again.items.filter(i => i.objectType === 'entity' && i.opt !== 'delete')).toEqual([]);
    expect(target.entities.length).toBe(demo.entities.length - 1);
  });

  test('deleting a table also removes it from view groups', () => {
    const source = clone();
    const target = clone();
    const removed = source.entities.pop();
    const r = compareModels(source, target);
    const merged = mergeSelected(target, source, r, [r.items[0].key]);
    expect(find(merged, removed.defKey)).toBeUndefined();
    merged.viewGroups.forEach(g => expect(g.refEntities).not.toContain(removed.id));
  });

  test('different domains resolve to concrete types', () => {
    const source = clone();
    const target = clone();
    target.domains = [];
    target.dataTypeMapping = {...target.dataTypeMapping, mappings: []};
    const r = compareModels(source, target);
    const merged = mergeSelected(target, source, r, all(r));
    const changed = item(r, 'entity:sims_college').children.map(c => c.defKey);
    expect(changed.length).toBeGreaterThan(0);
    find(merged, 'SIMS_COLLEGE').fields.filter(f => changed.includes(f.defKey))
      .forEach(f => expect(!f.domain && !f.baseType && !!f.type).toBe(true));
    expect(compareModels(source, merged).items.filter(i => i.objectType === 'entity')).toEqual([]);
  });

  test('partial merge applies only ticked parts', () => {
    const source = clone();
    const target = clone();
    find(source, 'SIMS_COLLEGE').defName = 'Renamed';
    find(source, 'SIMS_COLLEGE').fields[1].len = 77;
    const r = compareModels(source, target);
    const base = item(r, 'entity:sims_college').children.find(c => c.part === 'base');
    const merged = mergeSelected(target, source, r, [base.key]);
    expect(find(merged, 'SIMS_COLLEGE').defName).toBe('Renamed');
    expect(find(merged, 'SIMS_COLLEGE').fields[1].len).toBe(find(target, 'SIMS_COLLEGE').fields[1].len);
  });
});

describe('dbObjects', () => {
  const obj = (over = {}) => ({id: 'o1', type: 'procedure', defKey: 'P1', defName: 'p', comment: '', props: {}, body: 'select 1', ...over});

  test('legacy projects without dbObjects compare and merge unchanged', () => {
    const r = compareModels(clone(), clone());
    expect(r.dbObjectChanges).toEqual([]);
    const merged = mergeSelected(clone(), clone(), r, []);
    expect('dbObjects' in merged).toBe(false);
  });

  test('add, update and delete are detected, scripted and merged', () => {
    const source = {...clone(), dbObjects: [obj(), obj({id: 'o2', defKey: 'P2', body: 'new'})]};
    const target = {...clone(), dbObjects: [obj({id: 't2', defKey: 'p2', body: 'old'}), obj({id: 't3', defKey: 'P3'})]};
    const r = compareModels(source, target);
    const byKey = Object.fromEntries(r.items.filter(i => i.objectType === 'dbObject').map(i => [i.key, i.opt]));
    expect(byKey).toEqual({
      'dbObject:procedure:p1': 'add',
      'dbObject:procedure:p2': 'update',
      'dbObject:procedure:p3': 'delete',
    });
    const sql = generateAlterScript(r, Object.keys(byKey), target);
    expect(sql).toContain('-- create procedure P1');
    expect(sql).toContain('-- drop procedure p2\n\n-- create procedure P2');
    expect(sql).toContain('-- drop procedure P3');
    const merged = mergeSelected(target, source, r, Object.keys(byKey));
    expect(merged.dbObjects.map(o => o.defKey).sort()).toEqual(['P1', 'P2']);
    expect(merged.dbObjects.find(o => o.defKey === 'P2').id).toBe('t2');
    expect(compareModels(source, merged).dbObjectChanges).toEqual([]);
  });
});
