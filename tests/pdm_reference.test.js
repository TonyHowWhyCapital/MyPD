import _ from 'lodash';
import { pdmToDataSource, applyDataSourceToPdm } from '../src/lib/pdm';
import base from '../src/lib/template/empty.json';
import { buildPdm, ids, danglingRefs } from './fixtures/pdm';

const open = xml => pdmToDataSource(xml, base);
const save = (xml, change) => {
  const ds = _.cloneDeep(open(xml));
  change(ds);
  const saved = applyDataSourceToPdm(xml, ds, { now: 1800000000, user: 'jest' });
  expect(danglingRefs(saved)).toEqual([]);
  return saved;
};
const count = (xml, tag) => (xml.match(new RegExp(`<${tag} Id=`, 'g')) || []).length;
const lines = ds => ds.diagrams[0].canvasData.cells.filter(c => c.shape === 'erdRelation');
const relations = ds => ds.entities.reduce((a, e) => a.concat(e.correlations.map(c => `${e.id}.${c.myField}>${c.refEntity}.${c.refField}`)), []);
const xml = buildPdm();

describe('references of a pdm file follow the lines drawn in the diagrams', () => {
  test('the fixture has one reference with its line', () => {
    expect(count(xml, 'o:Reference')).toBe(1);
    expect(lines(open(xml))).toHaveLength(1);
  });

  test('taking the line out of the diagram removes the reference', () => {
    const saved = save(xml, (ds) => {
      const d = ds.diagrams[0];
      d.canvasData.cells = d.canvasData.cells.filter(c => c.shape !== 'erdRelation');
    });
    expect(count(saved, 'o:Reference')).toBe(0);
    expect(count(saved, 'o:ReferenceSymbol')).toBe(0);
    expect(relations(open(saved))).toEqual([]);
  });

  test('a reference stays when only the stored relations were lost', () => {
    const saved = save(xml, (ds) => { ds.entities.forEach((e) => { e.correlations = []; }); });
    expect(saved).toBe(xml);
  });

  test('a reference stays when its diagram is not part of the project', () => {
    const saved = save(xml, (ds) => { ds.diagrams = []; });
    expect(saved).toBe(xml);
  });

  test('a line drawn in the project becomes a reference with its line', () => {
    const before = open(xml);
    const bare = save(xml, (ds) => {
      const d = ds.diagrams[0];
      d.canvasData.cells = d.canvasData.cells.filter(c => c.shape !== 'erdRelation');
    });
    // drawn the other way round, as a line from the child's side
    const saved = (() => {
      const ds = _.cloneDeep(open(bare));
      const cells = ds.diagrams[0].canvasData.cells;
      const cellOf = id => cells.find(c => c.originKey === id).id;
      cells.push({
        id: 'new-line',
        shape: 'erdRelation',
        relation: 'n:1',
        source: { cell: cellOf(ids.emp), port: `${ids.empDept}%out` },
        target: { cell: cellOf(ids.dept), port: `${ids.deptId}%in` },
      });
      const out = applyDataSourceToPdm(bare, ds, { now: 1800000000, user: 'jest' });
      expect(danglingRefs(out)).toEqual([]);
      return out;
    })();
    expect(count(saved, 'o:Reference')).toBe(1);
    expect(count(saved, 'o:ReferenceJoin')).toBe(1);
    expect(count(saved, 'o:ReferenceSymbol')).toBe(1);
    expect(saved).toContain('<c:ParentKey>');
    const after = open(saved);
    expect(relations(after)).toEqual(relations(before));
    expect(lines(after)).toHaveLength(1);
    expect(lines(after)[0].source.port).toBe(`${ids.deptId}%out`);
  });

  test('a line to a column that is not the parent key is not written', () => {
    const saved = save(xml, (ds) => {
      const cells = ds.diagrams[0].canvasData.cells;
      const cellOf = id => cells.find(c => c.originKey === id).id;
      cells.push({
        id: 'odd',
        shape: 'erdRelation',
        relation: '1:n',
        source: { cell: cellOf(ids.dept), port: `${ids.deptName}%out` },
        target: { cell: cellOf(ids.emp), port: `${ids.empSalary}%in` },
      });
    });
    expect(saved).toBe(xml);
  });
});
