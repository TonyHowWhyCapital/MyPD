import demo from '../src/lib/template/教学管理系统.pdma.json';
import empty from '../src/lib/template/empty.json';
import {compareModels, generateAlterScript, mergeSelected, allSelectableKeys} from '../src/lib/model_compare_util';
import {addDbObject, getEmptyDbObject, getAllDbObjectsDDL} from '../src/lib/dbobject_util';
import {analyzeImpact, createImpactModel, saveImpactModel} from '../src/lib/impact_util';
import {getDefaultReportTemplates, buildReport, renderReport} from '../src/lib/report';

const clone = d => JSON.parse(JSON.stringify(d));
const db = demo.profile.default.db;

const withObjects = () => {
  const entity = demo.entities[0];
  const seq = {...getEmptyDbObject('sequence'), defKey: 'SEQ_ORDER'};
  const trigger = {...getEmptyDbObject('trigger'), defKey: 'TRG_AUDIT', refEntity: entity.id, body: 'SET NEW.REVISION = 1;'};
  return addDbObject(addDbObject(clone(demo), seq), trigger);
};

test('database objects flow through compare, script, and merge with the real DDL generator', () => {
  const source = withObjects();
  const target = clone(demo);
  const result = compareModels(source, target);
  const keys = allSelectableKeys(result);
  expect(keys.some(k => k.startsWith('dbObject:trigger:'))).toBe(true);
  const sql = generateAlterScript(result, keys, target);
  expect(sql).toMatch(/TRG_AUDIT/);
  expect(sql).toMatch(/CREATE\s+TRIGGER/i);
  const merged = mergeSelected(target, source, result, keys);
  expect(merged.dbObjects.map(o => o.defKey).sort()).toEqual(['SEQ_ORDER', 'TRG_AUDIT']);
  expect(compareModels(source, merged).items).toEqual([]);
  expect(getAllDbObjectsDDL(merged, db)).toMatch(/TRG_AUDIT/);
});

test('deleting a table reports its trigger, and the saved analysis appears in a report', () => {
  const ds = withObjects();
  const action = {type: 'deleteEntity', entityId: demo.entities[0].id};
  const impact = analyzeImpact(ds, action);
  expect(impact.items.some(i => i.objectType === 'dbObject' && i.objectDefKey === 'TRG_AUDIT')).toBe(true);
  const saved = saveImpactModel(ds, createImpactModel(ds, action, {defName: 'drop college'}));
  const tpl = getDefaultReportTemplates().find(t => t.kind === 'document');
  const withSections = {...tpl, sections: tpl.sections.concat([
    {id: 'x1', type: 'dbObjectList', title: 'objects'},
    {id: 'x2', type: 'impactAnalysisList', title: 'impact'},
  ])};
  const doc = buildReport(withSections, [saved, clone(demo)]);
  const md = renderReport(doc, 'markdown').data;
  expect(md).toMatch(/TRG_AUDIT/);
  expect(md).toMatch(/drop college/);
  const docx = renderReport(doc, 'docx').data;
  expect(docx[0]).toBe(0x50);
  expect(docx[1]).toBe(0x4b);
});

test('a project created before these features is unaffected', () => {
  const legacy = clone(empty);
  expect(compareModels(legacy, clone(empty)).items).toEqual([]);
  expect(getAllDbObjectsDDL(legacy, legacy.profile.default.db)).toBe('');
  const tpl = getDefaultReportTemplates()[0];
  expect(buildReport(tpl, [legacy]).blocks.length).toBeGreaterThan(0);
});
