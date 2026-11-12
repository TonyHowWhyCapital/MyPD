import _ from 'lodash';
import { pdmToDataSource, applyDataSourceToPdm, createPdm } from '../src/lib/pdm';
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
const nodeOf = (ds, tableId, n = 0) => ds.diagrams[n].canvasData.cells.find(c => c.originKey === tableId);
const rects = xml => (xml.match(/<a:Rect>[^<]*<\/a:Rect>/g) || []);
const xml = buildPdm();
const newField = (id, defKey, rest = {}) => ({
  id, defKey, defName: defKey, comment: '', type: 'INT4', len: '', scale: '',
  primaryKey: false, notNull: false, autoIncrement: false, defaultValue: '', domain: '', baseType: '', ...rest,
});

describe('diagrams of a pdm file follow the project', () => {
  test('a moved table keeps its size and lands where the project has it', () => {
    const start = open(xml);
    const gap = n => nodeOf(n, ids.emp).position.x - nodeOf(n, ids.dept).position.x;
    const saved = save(xml, (ds) => { nodeOf(ds, ids.emp).position.x += 100; });
    expect(rects(saved).filter((r, i) => r !== rects(xml)[i])).toHaveLength(1);
    expect(gap(open(saved))).toBe(gap(start) + 100);
    const size = (text) => {
      const n = text.match(/-?\d+/g).map(Number);
      return [Math.abs(n[2] - n[0]), Math.abs(n[3] - n[1])];
    };
    rects(saved).forEach((r, i) => expect(size(r)).toEqual(size(rects(xml)[i])));
  });

  test('a table taken off the diagram loses its symbol, the reference stays', () => {
    const saved = save(xml, (ds) => {
      const d = ds.diagrams[0];
      const gone = nodeOf(ds, ids.emp).id;
      d.canvasData.cells = d.canvasData.cells
        .filter(c => c.id !== gone && c.source?.cell !== gone && c.target?.cell !== gone);
    });
    expect(count(saved, 'o:TableSymbol')).toBe(count(xml, 'o:TableSymbol') - 1);
    expect(count(saved, 'o:ReferenceSymbol')).toBe(0);
    expect(count(saved, 'o:Reference')).toBe(1);
    expect(count(saved, 'o:Table')).toBe(count(xml, 'o:Table'));
  });

  test('a new table put on the diagram with a line gets symbol, reference and line', () => {
    const saved = save(xml, (ds) => {
      ds.entities.push({
        ...ds.entities[0], id: 'room', defKey: 'ROOM', defName: 'Room', indexes: [], correlations: [],
        fields: [newField('room-id', 'ID', { primaryKey: true, notNull: true }), newField('room-dept', 'DEPT_ID')],
      });
      const cells = ds.diagrams[0].canvasData.cells;
      cells.push({ id: 'n-room', shape: 'table', position: { x: 40, y: 400 }, originKey: 'room' });
      cells.push({
        id: 'l-room', shape: 'erdRelation', relation: '1:n',
        source: { cell: nodeOf(ds, ids.dept).id, port: `${ids.deptId}%out` },
        target: { cell: 'n-room', port: 'room-dept%in' },
      });
    });
    expect(count(saved, 'o:TableSymbol')).toBe(count(xml, 'o:TableSymbol') + 1);
    expect(count(saved, 'o:Reference')).toBe(2);
    expect(count(saved, 'o:ReferenceSymbol')).toBe(2);
    const after = open(saved);
    const room = after.entities.find(e => e.defKey === 'ROOM');
    expect(nodeOf(after, room.id)).toBeTruthy();
    expect(room.correlations).toHaveLength(1);
    expect(after.diagrams[0].canvasData.cells.filter(c => c.shape === 'erdRelation')).toHaveLength(2);
  });

  test('a diagram made in the project is written with its tables', () => {
    const saved = save(xml, (ds) => {
      ds.diagrams.push({
        id: 'mine', defKey: 'MINE', defName: 'Mine', relationType: 'field',
        canvasData: { cells: [
          { id: 'a', shape: 'table', position: { x: 0, y: 0 }, originKey: ids.dept },
          { id: 'b', shape: 'table', position: { x: 600, y: 200 }, originKey: ids.emp },
        ] },
      });
    });
    const after = open(saved);
    expect(after.diagrams.map(d => d.defKey)).toEqual([open(xml).diagrams[0].defKey, 'MINE']);
    expect(nodeOf(after, ids.emp, 1).position).toEqual({ x: 600, y: 200 });
    expect(saved).toBe(applyDataSourceToPdm(saved, after));
  });

  test('a new file takes the diagrams of the project, or a grid when it has none', () => {
    const ds = open(xml);
    const own = pdmToDataSource(createPdm(ds, { name: 'New' }), base);
    const withTables = own.diagrams.filter(d => d.canvasData.cells.length > 0);
    expect(withTables).toHaveLength(1);
    expect(withTables[0].canvasData.cells.filter(c => c.shape === 'table')).toHaveLength(2);
    expect(withTables[0].canvasData.cells.filter(c => c.shape === 'erdRelation')).toHaveLength(1);
    const grid = pdmToDataSource(createPdm({ ...ds, diagrams: [] }, { name: 'New' }), base);
    expect(grid.diagrams[0].canvasData.cells.filter(c => c.shape === 'table')).toHaveLength(2);
  });
});
