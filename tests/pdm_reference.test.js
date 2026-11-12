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
  test('how many rows the child may have is kept and can be changed', () => {
    expect(lines(open(xml))[0].relation).toBe('1:n');
    const saved = save(xml, (ds) => { lines(ds)[0].relation = '1:1,n'; });
    expect(saved).toContain('<a:Cardinality>1..*</a:Cardinality>');
    expect(count(saved, 'o:Reference')).toBe(1);
    const after = open(saved);
    expect(lines(after)[0].relation).toBe('1:1,n');
    expect(after.entities.find(e => e.id === ids.emp).correlations[0].myRows).toBe('1,n');
    expect(applyDataSourceToPdm(saved, after)).toBe(saved);
  });

  test('lines covering a key of several columns become one reference', () => {
    const field = (id, defKey, rest = {}) => ({
      id, defKey, defName: defKey, comment: '', type: 'INT4', len: '', scale: '', primaryKey: false,
      notNull: false, autoIncrement: false, defaultValue: '', domain: '', baseType: '', ...rest,
    });
    const saved = save(xml, (ds) => {
      const table = (id, defKey, fields) => ({ ...ds.entities[0], id, defKey, defName: defKey, indexes: [], correlations: [], fields });
      ds.entities.push(table('stock', 'STOCK', [
        field('s1', 'MARKET', { primaryKey: true, notNull: true }), field('s2', 'CODE', { primaryKey: true, notNull: true })]));
      ds.entities.push(table('quote', 'QUOTE', [
        field('q0', 'ID', { primaryKey: true, notNull: true }), field('q1', 'MARKET'), field('q2', 'CODE')]));
      const cells = ds.diagrams[0].canvasData.cells;
      cells.push({ id: 'n-s', shape: 'table', position: { x: 0, y: 500 }, originKey: 'stock' });
      cells.push({ id: 'n-q', shape: 'table', position: { x: 600, y: 500 }, originKey: 'quote' });
      [['s1', 'q1'], ['s2', 'q2']].forEach(([from, to]) => cells.push({
        id: `l-${from}`, shape: 'erdRelation', relation: '1:n',
        source: { cell: 'n-s', port: `${from}%out` }, target: { cell: 'n-q', port: `${to}%in` },
      }));
    });
    expect(count(saved, 'o:Reference')).toBe(2);
    expect(count(saved, 'o:ReferenceJoin')).toBe(3);
    expect(count(saved, 'o:ReferenceSymbol')).toBe(2);
    const after = open(saved);
    expect(after.entities.find(e => e.defKey === 'QUOTE').correlations).toHaveLength(2);
    expect(lines(after)).toHaveLength(3);
    expect(applyDataSourceToPdm(saved, after)).toBe(saved);
    // taking one of the two lines away leaves the reference alone
    const one = _.cloneDeep(after);
    const cells = one.diagrams[0].canvasData.cells;
    const quote = cells.find(c => c.originKey === after.entities.find(e => e.defKey === 'QUOTE').id).id;
    const drop = cells.find(c => c.shape === 'erdRelation' && c.target.cell === quote).id;
    one.diagrams[0].canvasData.cells = cells.filter(c => c.id !== drop);
    expect(applyDataSourceToPdm(saved, one)).toBe(saved);
  });
});
