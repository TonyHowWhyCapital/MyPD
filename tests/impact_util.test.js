import demo from '../src/lib/template/教学管理系统.pdma.json';
import {
  analyzeImpact, createImpactModel, saveImpactModel, removeImpactModel, getImpactModels,
} from '../src/lib/impact_util';

const clone = () => JSON.parse(JSON.stringify(demo));

const build = () => {
  const ds = clone();
  const [a, b] = ds.entities;
  const pk = a.fields.find(f => f.primaryKey) || a.fields[0];
  ds.diagrams = [{
    id: 'dg1', defKey: 'dg', defName: 'DG',
    canvasData: { cells: [
      { id: 'n1', shape: 'table', originKey: a.id },
      { id: 'n2', shape: 'table', originKey: b.id },
      { id: 'e1', shape: 'erdRelation', source: { cell: 'n1', port: 'out1', portOrigin: `${pk.id}%out` }, target: { cell: 'n2', port: 'in1' } },
    ] },
  }];
  ds.viewGroups = [{ id: 'g1', defKey: 'g', defName: 'G', refEntities: [a.id], refViews: [], refDiagrams: [], refDicts: [] }];
  b.correlations = [{ myField: b.fields[0].id, refEntity: a.id, refField: pk.id }];
  a.indexes = [{ id: 'ix1', defKey: 'IX', fields: [{ id: 'x', fieldDefKey: pk.id }] }];
  ds.views = [{ id: 'v1', defKey: 'V', defName: 'View', refEntities: [a.id],
    fields: [{ id: 'vf1', defKey: 'VF', refEntity: a.id, refEntityField: pk.id }] }];
  ds.dbObjects = [{ id: 'o1', type: 'trigger', defKey: 'TRG', defName: 'T', refEntity: a.id }];
  return { ds, a, b, pk };
};

const reasons = r => r.items.map(i => i.reason);

test('deleteEntity finds every kind of reference', () => {
  const { ds, a } = build();
  const r = analyzeImpact(ds, { type: 'deleteEntity', entityId: a.id });
  expect(r.action.entityDefKey).toBe(a.defKey);
  ['fkReference', 'viewReference', 'indexMember', 'diagramNode', 'diagramEdge', 'groupMember', 'dbObjectReference']
    .forEach(x => expect(reasons(r)).toContain(x));
  expect(r.summary.total).toBe(r.items.length);
  expect(r.summary.bySeverity.break).toBeGreaterThan(0);
  expect(r.summary.byObjectType.view).toBe(1);
});

test('deleteField only reports items tied to the field', () => {
  const { ds, a, pk } = build();
  const r = analyzeImpact(ds, { type: 'deleteField', entityId: a.id, fieldId: pk.id });
  expect(r.action.fieldDefKey).toBe(pk.defKey);
  expect(reasons(r)).toEqual(expect.arrayContaining(['fkReference', 'indexMember', 'viewReference', 'diagramEdge']));
  expect(reasons(r)).not.toContain('groupMember');
  expect(reasons(r)).not.toContain('dbObjectReference');
});

test('changeFieldType on a primary key flags referencing fields', () => {
  const { ds, a, pk } = build();
  const r = analyzeImpact(ds, { type: 'changeFieldType', entityId: a.id, fieldId: pk.id, after: { type: 'BIGINT' } });
  expect(r.action.before.type).toBe(pk.type);
  expect(r.action.after.type).toBe('BIGINT');
  const fk = r.items.find(i => i.reason === 'fkReference');
  expect(fk.severity).toBe('change');
  expect(fk.detail).toContain('BIGINT');
});

test('save, replace and remove models', () => {
  const { ds, a } = build();
  const m = createImpactModel(ds, { type: 'deleteEntity', entityId: a.id }, { defName: 'x', now: new Date(2024, 0, 2, 3, 4, 5) });
  expect(m.createdTime).toBe('2024-01-02 03:04:05');
  const s1 = saveImpactModel(ds, m);
  expect(getImpactModels(s1)).toHaveLength(1);
  const s2 = saveImpactModel(s1, { ...m, note: 'n' });
  expect(getImpactModels(s2)).toHaveLength(1);
  expect(getImpactModels(s2)[0].note).toBe('n');
  expect(getImpactModels(removeImpactModel(s2, m.id))).toHaveLength(0);
  expect(ds.impactAnalyses).toBeUndefined();
});

test('legacy project without optional arrays works', () => {
  const ds = clone();
  delete ds.dbObjects;
  delete ds.impactAnalyses;
  expect(getImpactModels(ds)).toEqual([]);
  expect(removeImpactModel(ds, 'nope').impactAnalyses).toEqual([]);
  const r = analyzeImpact(ds, { type: 'deleteEntity', entityId: ds.entities[0].id });
  expect(r.summary.total).toBe(r.items.length);
});

test('invalid input throws clear errors', () => {
  const ds = clone();
  const e = ds.entities[0];
  expect(() => analyzeImpact(ds, { type: 'bogus', entityId: e.id })).toThrow(/Unknown impact action/);
  expect(() => analyzeImpact(ds, { type: 'deleteEntity', entityId: 'zz' })).toThrow(/Entity not found/);
  expect(() => analyzeImpact(ds, { type: 'deleteField', entityId: e.id, fieldId: 'zz' })).toThrow(/Field not found/);
  expect(() => analyzeImpact(ds, { type: 'changeFieldType', entityId: e.id, fieldId: e.fields[0].id })).toThrow(/after.type/);
});
