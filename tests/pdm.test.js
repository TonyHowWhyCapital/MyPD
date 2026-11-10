import _ from 'lodash';
import { pdmToDataSource, applyDataSourceToPdm, isPdmFile } from '../src/lib/pdm';
import base from '../src/lib/template/empty.json';
import { buildPdm, ids, danglingRefs } from './fixtures/pdm';

const open = xml => pdmToDataSource(xml, base);
const entity = (ds, id) => ds.entities.find(e => e.id === id);
const field = (ds, entityId, id) => entity(ds, entityId).fields.find(f => f.id === id);
const edit = (xml, change) => {
  const ds = _.cloneDeep(open(xml));
  change(ds);
  const saved = applyDataSourceToPdm(xml, ds, { now: 1800000000, user: 'jest' });
  expect(danglingRefs(saved)).toEqual([]);
  return { saved, ds: open(saved) };
};
const newField = (id, defKey, rest = {}) => ({
  id, defKey, defName: defKey, comment: '', type: 'VARCHAR', len: 20, scale: '',
  primaryKey: false, notNull: false, autoIncrement: false, defaultValue: '', domain: '', baseType: '', ...rest,
});

describe('opening a pdm file', () => {
  const ds = open(buildPdm());

  test('recognises pdm paths', () => {
    expect(isPdmFile('/a/b/Model.PDM')).toBe(true);
    expect(isPdmFile('/a/b/Model.pdma.json')).toBe(false);
  });

  test('reads the model name and picks the database from the target', () => {
    const db = ds.profile.dataTypeSupports.find(s => s.id === ds.profile.default.db);
    expect(ds.name).toBe('Staff');
    expect(db.defKey).toBe('PostgreSQL');
  });

  test('reads tables with name, code and multi-line comment', () => {
    expect(ds.entities.map(e => e.defKey)).toEqual(['DEPT', 'EMP']);
    expect(entity(ds, ids.dept)).toMatchObject({ defName: 'Department', comment: 'Line one\nline two' });
  });

  test('reads column type, length, scale, default and flags', () => {
    expect(field(ds, ids.emp, ids.empSalary)).toMatchObject({
      defKey: 'SALARY', type: 'numeric', len: 10, scale: 2, defaultValue: '0', notNull: false, primaryKey: false,
    });
    expect(field(ds, ids.dept, ids.deptId)).toMatchObject({
      type: 'INT4', len: '', primaryKey: true, notNull: true, autoIncrement: true,
    });
  });

  test('links a column to its domain so it inherits the domain type', () => {
    expect(ds.domains.map(d => d.defKey)).toEqual(['D_ID', 'D_NAME']);
    expect(ds.domains[1]).toMatchObject({ len: 100, scale: '' });
    expect(field(ds, ids.dept, ids.deptId).domain).toBe(ids.domId);
  });

  test('keeps the column type when the file column diverges from its domain', () => {
    expect(field(ds, ids.dept, ids.deptName)).toMatchObject({ domain: '', type: 'VARCHAR', len: 40 });
  });

  test('reads indexes and foreign key references', () => {
    expect(entity(ds, ids.emp).indexes).toMatchObject([
      { id: ids.empIndex, defKey: 'IX_EMP_DEPT', unique: true, fields: [{ fieldDefKey: ids.empDept, ascOrDesc: 'A' }] },
    ]);
    expect(entity(ds, ids.emp).correlations).toEqual([
      { myField: ids.empDept, refEntity: ids.dept, refField: ids.deptId, myRows: 'n', refRows: '1', innerType: '' },
    ]);
  });

  test('builds a diagram with table nodes and a relation edge', () => {
    const { cells } = ds.diagrams[0].canvasData;
    const nodes = cells.filter(c => c.shape === 'table');
    expect(nodes.map(n => n.originKey)).toEqual([ids.dept, ids.emp]);
    expect(nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(nodes[1].position.x).toBeGreaterThan(0);
    expect(nodes[1].position.y).toBeGreaterThan(0);
    expect(cells.find(c => c.shape === 'erdRelation')).toMatchObject({
      source: { cell: nodes[0].id, port: `${ids.deptId}%out` },
      target: { cell: nodes[1].id, port: `${ids.empDept}%in` },
    });
  });

  test('rejects files that are not a pdm model', () => {
    expect(() => open('<a><b></a>')).toThrow(/Invalid XML/);
    expect(() => open('<?xml version="1.0"?><Model></Model>')).toThrow(/Invalid PDM file/);
    expect(() => open('PK\u0003\u0004 binary')).toThrow(/Invalid PDM file/);
  });
});

describe('saving a pdm file', () => {
  test.each([['LF', '\n'], ['CRLF', '\r\n']])('saving without changes keeps the file byte for byte (%s)', (name, eol) => {
    const xml = buildPdm(eol);
    expect(applyDataSourceToPdm(xml, open(xml))).toBe(xml);
  });

  test('renaming a table and a column changes only those values', () => {
    const xml = buildPdm();
    const { saved, ds } = edit(xml, (d) => {
      entity(d, ids.emp).defKey = 'WORKER';
      entity(d, ids.emp).comment = 'a < b';
      field(d, ids.emp, ids.empSalary).defName = 'Pay';
    });
    expect(entity(ds, ids.emp)).toMatchObject({ defKey: 'WORKER', comment: 'a < b' });
    expect(field(ds, ids.emp, ids.empSalary).defName).toBe('Pay');
    const changed = saved.split('\n').filter(l => !xml.split('\n').includes(l));
    expect(changed).toEqual(['<a:Code>WORKER</a:Code>', '<a:Comment>a &lt; b</a:Comment>', '<a:Name>Pay</a:Name>']);
  });

  test('changing a column type rewrites data type, length and precision', () => {
    const { saved, ds } = edit(buildPdm(), (d) => {
      Object.assign(field(d, ids.emp, ids.empSalary), { type: 'VARCHAR', len: 30, scale: '' });
      Object.assign(field(d, ids.emp, ids.empId), { notNull: false, autoIncrement: true });
    });
    expect(field(ds, ids.emp, ids.empSalary)).toMatchObject({ type: 'VARCHAR', len: 30, scale: '' });
    expect(field(ds, ids.emp, ids.empId)).toMatchObject({ notNull: false, autoIncrement: true });
    expect(saved).not.toContain('<a:Precision>2</a:Precision>');
  });

  test('adds a column in the edited position and keeps its id', () => {
    const id = 'AAAAAAAA-0000-4000-8000-000000000001';
    const { ds } = edit(buildPdm('\r\n'), (d) => {
      entity(d, ids.emp).fields.splice(1, 0, newField(id, 'EMP_NAME', { notNull: true, comment: 'full name' }));
    });
    expect(entity(ds, ids.emp).fields.map(f => f.defKey)).toEqual(['EMP_ID', 'EMP_NAME', 'DEPT_ID', 'SALARY']);
    expect(field(ds, ids.emp, id)).toMatchObject({ type: 'VARCHAR', len: 20, notNull: true, comment: 'full name' });
  });

  test('adds a table with a primary key and an index', () => {
    const tableId = 'BBBBBBBB-0000-4000-8000-000000000001';
    const pk = 'BBBBBBBB-0000-4000-8000-000000000002';
    const { ds } = edit(buildPdm(), (d) => {
      d.entities.push({
        id: tableId, defKey: 'ROLE', defName: '', comment: '', correlations: [],
        fields: [newField(pk, 'ROLE_ID', { primaryKey: true, notNull: true }), newField('BBBBBBBB-0000-4000-8000-000000000003', 'ROLE_NAME')],
        indexes: [{ id: 'BBBBBBBB-0000-4000-8000-000000000004', defKey: 'IX_ROLE', unique: false, fields: [{ id: 'x', fieldDefKey: pk, ascOrDesc: 'D' }] }],
      });
    });
    const role = entity(ds, tableId);
    expect(role).toMatchObject({ defKey: 'ROLE', defName: 'ROLE' });
    expect(role.fields.map(f => [f.defKey, f.primaryKey])).toEqual([['ROLE_ID', true], ['ROLE_NAME', false]]);
    expect(role.indexes).toMatchObject([{ defKey: 'IX_ROLE', unique: false, fields: [{ fieldDefKey: pk, ascOrDesc: 'D' }] }]);
  });

  test('moves the primary key to another column', () => {
    const { ds } = edit(buildPdm(), (d) => {
      field(d, ids.dept, ids.deptId).primaryKey = false;
      field(d, ids.dept, ids.deptName).primaryKey = true;
      field(d, ids.emp, ids.empId).primaryKey = true;
    });
    expect(entity(ds, ids.dept).fields.map(f => f.primaryKey)).toEqual([false, true]);
    expect(entity(ds, ids.emp).fields.map(f => f.primaryKey)).toEqual([true, false, false]);
  });

  test('deleting a foreign key column removes its reference, index and diagram link', () => {
    const { saved, ds } = edit(buildPdm(), (d) => {
      _.remove(entity(d, ids.emp).fields, f => f.id === ids.empDept);
    });
    expect(entity(ds, ids.emp).fields.map(f => f.defKey)).toEqual(['EMP_ID', 'SALARY']);
    expect(entity(ds, ids.emp).correlations).toEqual([]);
    expect(entity(ds, ids.emp).indexes).toEqual([]);
    expect(saved).not.toContain('o:ReferenceSymbol');
    expect(ds.diagrams[0].canvasData.cells.map(c => c.shape)).toEqual(['table', 'table']);
  });

  test('deleting a table removes its symbol and the references to it', () => {
    const { saved, ds } = edit(buildPdm(), (d) => {
      _.remove(d.entities, e => e.id === ids.dept);
    });
    expect(ds.entities.map(e => e.defKey)).toEqual(['EMP']);
    expect(entity(ds, ids.emp).correlations).toEqual([]);
    expect(saved).not.toContain('<c:References>');
    expect(ds.diagrams[0].canvasData.cells.map(c => c.originKey)).toEqual([ids.emp]);
  });

  test('adds, edits and deletes domains and applies a domain to a column', () => {
    const domainId = 'CCCCCCCC-0000-4000-8000-000000000001';
    const xml = buildPdm();
    const added = edit(xml, (d) => {
      const applyFor = d.domains.find(x => x.id === ids.domName).applyFor;
      d.domains.push({ id: domainId, defKey: 'D_CODE', defName: 'Code', applyFor, len: 12, scale: '' });
      d.domains.find(x => x.id === ids.domName).len = 60;
      Object.assign(field(d, ids.emp, ids.empSalary), { domain: domainId, baseType: applyFor });
    });
    expect(added.ds.domains.map(d => [d.defKey, d.len])).toEqual([['D_ID', ''], ['D_NAME', 60], ['D_CODE', 12]]);
    expect(field(added.ds, ids.emp, ids.empSalary)).toMatchObject({ domain: domainId, type: 'VARCHAR', len: 12 });

    const removed = edit(added.saved, (d) => {
      _.remove(d.domains, x => x.id === ids.domId);
    });
    expect(removed.ds.domains.map(d => d.defKey)).toEqual(['D_NAME', 'D_CODE']);
    expect(field(removed.ds, ids.dept, ids.deptId)).toMatchObject({ domain: '', type: 'INT4' });
  });

  test('saving twice after an edit is stable', () => {
    const { saved, ds } = edit(buildPdm('\r\n'), (d) => {
      entity(d, ids.emp).fields.push(newField('DDDDDDDD-0000-4000-8000-000000000001', 'NOTE'));
    });
    expect(applyDataSourceToPdm(saved, ds)).toBe(saved);
    expect(saved.replace(/\r\n/g, '')).not.toContain('\n');
  });

  test('refuses to save into a file that is not a pdm model', () => {
    expect(() => applyDataSourceToPdm('<Model></Model>', open(buildPdm()))).toThrow(/Invalid PDM file/);
  });
});
