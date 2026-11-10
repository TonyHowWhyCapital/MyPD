import demo from '../src/lib/template/教学管理系统.pdma.json';
import empty from '../src/lib/template/empty.json';
import {
  getEntityTemplates, getEmptyEntityTemplate, validateEntityTemplate, saveEntityTemplate,
  removeEntityTemplate, instantiateTemplateFields, createTemplateFromEntity,
  getLinkedEntities, syncEntityWithTemplate, syncLinkedEntities, unlinkEntity,
} from '../src/lib/entity_template_util';
import {_getAllDataSQLByFilter} from '../src/lib/utils';

const clone = o => JSON.parse(JSON.stringify(o));
const tpl = (over = {}) => ({
  ...getEmptyEntityTemplate(),
  defKey: 'AUDIT',
  fields: [
    {id: 't1', defKey: 'CREATED_AT', defName: 'created', type: 'DateTime', notNull: true},
    {id: 't2', defKey: 'CREATED_BY', defName: 'creator', type: 'VarChar', len: 32},
  ],
  ...over,
});
const withEntity = (ds, entity) => ({...ds, entities: (ds.entities || []).concat(entity)});

describe('legacy projects', () => {
  test('files without entityTemplates load and still produce DDL', () => {
    [demo, empty].forEach((ds) => {
      expect(getEntityTemplates(ds)).toEqual([]);
      expect(getLinkedEntities(ds, 'x')).toEqual([]);
    });
    const db = demo.profile.default.db;
    expect(_getAllDataSQLByFilter(demo, db, ['createTable'])).toMatch(/CREATE TABLE/i);
  });
});

describe('add', () => {
  test('saves a valid template without mutating the input', () => {
    const ds = clone(demo);
    const next = saveEntityTemplate(ds, tpl());
    expect(getEntityTemplates(next)).toHaveLength(1);
    expect(getEntityTemplates(ds)).toEqual([]);
    expect(next.entities).toBe(ds.entities);
  });
  test('saving an existing id updates in place', () => {
    const t = tpl();
    const once = saveEntityTemplate(clone(demo), t);
    const twice = saveEntityTemplate(once, {...t, defName: 'renamed'});
    expect(getEntityTemplates(twice)).toHaveLength(1);
    expect(getEntityTemplates(twice)[0].defName).toBe('renamed');
  });
  test('create from an existing table copies fields with fresh ids', () => {
    const entity = demo.entities[0];
    const t = createTemplateFromEntity(entity, {defKey: 'FROM_T', defName: 'n'});
    expect(t.fields.map(f => f.defKey)).toEqual(entity.fields.map(f => f.defKey));
    expect(t.fields[0].id).not.toBe(entity.fields[0].id);
    expect(validateEntityTemplate(t, demo)).toEqual([]);
  });
});

describe('validation errors', () => {
  const saved = saveEntityTemplate(clone(demo), tpl());
  test('empty defKey', () => {
    expect(validateEntityTemplate(tpl({defKey: '  '}), saved)).toEqual(['emptyDefKey']);
  });
  test('duplicate defKey ignores case', () => {
    expect(validateEntityTemplate(tpl({id: 'other', defKey: 'audit'}), saved)).toEqual(['duplicateDefKey']);
  });
  test('duplicate field defKey inside the template', () => {
    const t = tpl({fields: [{id: 'a', defKey: 'X'}, {id: 'b', defKey: 'x'}]});
    expect(validateEntityTemplate(t, demo)).toEqual(['duplicateFieldDefKey']);
  });
  test('save throws with error.codes and leaves data untouched', () => {
    let err;
    try {
      saveEntityTemplate(saved, tpl({id: 'other'}));
    } catch (e) {
      err = e;
    }
    expect(err.codes).toEqual(['duplicateDefKey']);
    expect(getEntityTemplates(saved)).toHaveLength(1);
  });
  test('removing or syncing an unknown template throws', () => {
    expect(() => removeEntityTemplate(saved, 'nope')).toThrow();
    expect(() => syncLinkedEntities(saved, 'nope')).toThrow();
  });
});

describe('apply', () => {
  test('instantiate without link gives fresh ids and no templateFieldId', () => {
    const t = tpl();
    const fields = instantiateTemplateFields(t, {keepLink: false});
    expect(fields.map(f => f.defKey)).toEqual(['CREATED_AT', 'CREATED_BY']);
    expect(fields.every(f => !('templateFieldId' in f))).toBe(true);
    expect(fields[0].id).not.toBe('t1');
    expect(instantiateTemplateFields(t)).toHaveLength(2);
  });
  test('instantiate with link records the template field id', () => {
    const fields = instantiateTemplateFields(tpl(), {keepLink: true});
    expect(fields.map(f => f.templateFieldId)).toEqual(['t1', 't2']);
  });
  test('instantiated fields are usable in generated DDL', () => {
    const t = tpl();
    const entity = {
      ...clone(demo.entities[0]),
      id: 'new1',
      defKey: 'TPL_TABLE',
      templateRef: t.id,
      fields: instantiateTemplateFields(t, {keepLink: true}),
      indexes: [],
      correlations: [],
    };
    const db = demo.profile.default.db;
    expect(_getAllDataSQLByFilter(withEntity(demo, entity), db, ['createTable']))
      .toMatch(/TPL_TABLE[\s\S]*CREATED_AT/);
  });
});

describe('sync', () => {
  const setup = () => {
    const t = tpl();
    const fields = instantiateTemplateFields(t, {keepLink: true});
    const entity = {id: 'e1', defKey: 'E1', templateRef: t.id, fields: [
      {id: 'own', defKey: 'OWN', type: 'VarChar'},
      ...fields,
    ]};
    const ds = withEntity(saveEntityTemplate(clone(demo), t), entity);
    return {t, ds};
  };
  test('adds missing fields, updates linked props, keeps own fields and order', () => {
    const {t, ds} = setup();
    const newer = {
      ...t,
      fields: [
        {...t.fields[0], defName: 'created time', type: 'Timestamp'},
        t.fields[1],
        {id: 't3', defKey: 'UPDATED_AT', type: 'DateTime'},
      ],
    };
    const next = syncLinkedEntities({
      ...ds,
      profile: {...ds.profile, entityTemplates: [newer]},
    }, t.id);
    const e = next.entities.find(x => x.id === 'e1');
    expect(e.fields.map(f => f.defKey)).toEqual(['OWN', 'CREATED_AT', 'CREATED_BY', 'UPDATED_AT']);
    expect(e.fields[1].defName).toBe('created time');
    expect(e.fields[1].type).toBe('Timestamp');
    expect(e.fields[3].templateFieldId).toBe('t3');
  });
  test('a field removed from the template stays in the table', () => {
    const {t, ds} = setup();
    const trimmed = {...t, fields: [t.fields[0]]};
    const e = syncEntityWithTemplate(ds.entities.find(x => x.id === 'e1'), trimmed);
    expect(e.fields.map(f => f.defKey)).toEqual(['OWN', 'CREATED_AT', 'CREATED_BY']);
  });
  test('sync is idempotent and ignores unlinked tables', () => {
    const {t, ds} = setup();
    const once = syncLinkedEntities(ds, t.id);
    expect(syncLinkedEntities(once, t.id)).toEqual(once);
    const plain = ds.entities[0];
    expect(once.entities[0]).toBe(plain);
  });
  test('unlinkEntity drops templateRef and templateFieldId', () => {
    const {ds} = setup();
    const e = unlinkEntity(ds.entities.find(x => x.id === 'e1'));
    expect('templateRef' in e).toBe(false);
    expect(e.fields.some(f => 'templateFieldId' in f)).toBe(false);
    expect(e.fields).toHaveLength(3);
  });
});

describe('delete', () => {
  test('removes the template and unlinks tables while keeping their columns', () => {
    const t = tpl();
    const entity = {id: 'e1', defKey: 'E1', templateRef: t.id,
      fields: instantiateTemplateFields(t, {keepLink: true})};
    const ds = withEntity(saveEntityTemplate(clone(demo), t), entity);
    expect(getLinkedEntities(ds, t.id)).toHaveLength(1);
    const next = removeEntityTemplate(ds, t.id);
    expect(getEntityTemplates(next)).toEqual([]);
    const e = next.entities.find(x => x.id === 'e1');
    expect(e.templateRef).toBeUndefined();
    expect(e.fields).toHaveLength(2);
    expect(e.fields.every(f => !f.templateFieldId)).toBe(true);
    expect(getEntityTemplates(ds)).toHaveLength(1);
  });
});
