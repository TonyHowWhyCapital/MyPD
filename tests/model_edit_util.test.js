import _ from 'lodash';
import {
  getTableRows, getColumnRows, getDomainRows, resolveColumnType,
  updateTable, updateColumn, addColumn, removeTables, removeColumns,
  updateDomain, addDomain, removeDomains, domainUsage,
} from '../src/lib/model_edit_util';

const mysql = 'db-mysql';
const strMapping = { id: 'm-str', defKey: 'string', defName: '字串', [mysql]: 'VARCHAR' };
const intMapping = { id: 'm-int', defKey: 'integer', defName: '整数', [mysql]: 'INT' };

const build = () => ({
  name: 'M',
  profile: { default: { db: mysql }, dataTypeSupports: [{ id: mysql, defKey: 'MYSQL' }] },
  dataTypeMapping: { mappings: [strMapping, intMapping] },
  domains: [{ id: 'dom-code', defKey: 'Code', defName: '代码', applyFor: 'm-str', len: 20, scale: '' }],
  entities: [
    {
      id: 'e1', defKey: 'users', defName: '用户', comment: 'u',
      fields: [
        { id: 'f1', defKey: 'id', defName: '主键', type: 'INT', len: '', scale: '', primaryKey: true, notNull: true },
        { id: 'f2', defKey: 'code', defName: '编码', domain: 'dom-code', baseType: 'm-str' },
      ],
      correlations: [{ myField: 'f2', refEntity: 'e2', refField: 'f3' }],
      indexes: [{ id: 'i1', defKey: 'ix', unique: false, fields: [{ fieldDefKey: 'f2', ascOrDesc: 'A' }] }],
    },
    {
      id: 'e2', defKey: 'roles', defName: '角色', comment: '',
      fields: [{ id: 'f3', defKey: 'id', defName: '主键', type: 'INT', primaryKey: true }],
      correlations: [{ myField: 'f3', refEntity: 'e1', refField: 'f1' }],
      indexes: [],
    },
  ],
  diagrams: [{
    id: 'd1', canvasData: { cells: [
      { id: 'n1', shape: 'table', originKey: 'e1' },
      { id: 'n2', shape: 'table', originKey: 'e2' },
      { id: 'edge', shape: 'erdRelation', source: { cell: 'n2', port: 'f3%out' }, target: { cell: 'n1', port: 'f2%in' } },
    ] } }],
  viewGroups: [{ id: 'g1', defKey: 'g', refEntities: ['e1', 'e2'] }],
});

describe('grid views of the model', () => {
  const ds = build();
  test('lists tables with column counts', () => {
    expect(getTableRows(ds)).toEqual([
      { id: 'e1', defKey: 'users', defName: '用户', comment: 'u', fieldCount: 2 },
      { id: 'e2', defKey: 'roles', defName: '角色', comment: '', fieldCount: 1 },
    ]);
  });
  test('lists every column across tables with its owning table and resolved type', () => {
    const rows = getColumnRows(ds);
    expect(rows.map(r => `${r.entityKey}.${r.defKey}`)).toEqual(['users.id', 'users.code', 'roles.id']);
    expect(rows[1]).toMatchObject({ entityId: 'e1', domain: 'dom-code', domainName: '代码', resolvedType: 'VARCHAR', len: 20 });
    expect(resolveColumnType(ds, { type: 'INT', len: 11, scale: '' })).toEqual({ type: 'INT', len: 11, scale: '' });
  });
  test('lists domains with their mapped type', () => {
    expect(getDomainRows(ds)).toEqual([
      { id: 'dom-code', defKey: 'Code', defName: '代码', applyFor: 'm-str', applyForName: 'string(字串)', len: 20, scale: '' },
    ]);
  });
});

describe('editing from the table angle', () => {
  test('renames a table without touching others', () => {
    const next = updateTable(build(), 'e1', { defKey: 'members', defName: '成员', fieldCount: 99 });
    expect(next.entities[0]).toMatchObject({ defKey: 'members', defName: '成员' });
    expect(next.entities[0].fields).toHaveLength(2);
    expect(next.entities[1].defKey).toBe('roles');
  });
  test('deleting a table removes its references, diagram node, edge and group membership', () => {
    const next = removeTables(build(), ['e2']);
    expect(next.entities.map(e => e.id)).toEqual(['e1']);
    expect(next.entities[0].correlations).toEqual([]);
    const cells = next.diagrams[0].canvasData.cells;
    expect(cells.map(c => c.id)).toEqual(['n1']);
    expect(next.viewGroups[0].refEntities).toEqual(['e1']);
  });
});

describe('editing from the column angle', () => {
  test('edits a column in place', () => {
    const next = updateColumn(build(), 'e1', 'f1', { defName: 'ID', notNull: false, len: 10 });
    expect(next.entities[0].fields[0]).toMatchObject({ defName: 'ID', notNull: false, len: 10, defKey: 'id' });
  });
  test('setting a raw type clears any domain link', () => {
    const next = updateColumn(build(), 'e1', 'f2', { type: 'TEXT' });
    expect(next.entities[0].fields[1]).toMatchObject({ type: 'TEXT', domain: '', baseType: '' });
  });
  test('choosing a domain clears the raw type and sets the base mapping', () => {
    const next = updateColumn(build(), 'e1', 'f1', { domain: 'dom-code' });
    expect(next.entities[0].fields[0]).toMatchObject({ domain: 'dom-code', baseType: 'm-str', type: '' });
  });
  test('adds a column to a table and returns its id', () => {
    const { next, id } = addColumn(build(), 'e2');
    const added = next.entities[1].fields.find(f => f.id === id);
    expect(next.entities[1].fields).toHaveLength(2);
    expect(added).toMatchObject({ type: 'VARCHAR', primaryKey: false });
  });
  test('deleting a column removes its index entry, correlation and diagram edge', () => {
    const next = removeColumns(build(), [{ entityId: 'e1', fieldId: 'f2' }]);
    expect(next.entities[0].fields.map(f => f.id)).toEqual(['f1']);
    expect(next.entities[0].indexes).toEqual([]);
    expect(next.entities[0].correlations).toEqual([]);
    expect(next.diagrams[0].canvasData.cells.map(c => c.id)).toEqual(['n1', 'n2']);
  });
});

describe('editing from the domain angle', () => {
  test('edits a domain', () => {
    const next = updateDomain(build(), 'dom-code', { defName: 'C', applyFor: 'm-int', len: 8 });
    expect(next.domains[0]).toMatchObject({ defName: 'C', applyFor: 'm-int', len: 8 });
  });
  test('adds a domain with the first mapping', () => {
    const { next, id } = addDomain(build());
    expect(next.domains.find(d => d.id === id)).toMatchObject({ applyFor: 'm-str' });
  });
  test('refuses to delete a domain that columns use, deletes an unused one', () => {
    const ds = build();
    expect(domainUsage(ds, 'dom-code')).toBe(1);
    const blocked = removeDomains(ds, ['dom-code']);
    expect(blocked.removed).toEqual([]);
    expect(blocked.blocked).toEqual(['dom-code']);
    expect(blocked.next.domains).toHaveLength(1);
    const freed = removeColumns(ds, [{ entityId: 'e1', fieldId: 'f2' }]);
    const removed = removeDomains(freed, ['dom-code']);
    expect(removed.removed).toEqual(['dom-code']);
    expect(removed.next.domains).toEqual([]);
  });
});

test('a legacy project without diagrams, groups or indexes still edits cleanly', () => {
  const ds = { entities: [{ id: 'e1', defKey: 't', fields: [{ id: 'f1', defKey: 'a' }] }] };
  expect(removeColumns(ds, [{ entityId: 'e1', fieldId: 'f1' }]).entities[0].fields).toEqual([]);
  expect(removeTables(ds, ['e1']).entities).toEqual([]);
  expect(getColumnRows(ds)).toHaveLength(1);
});

describe('multi-column sort', () => {
  const { toggleSort, sortRows } = require('../src/lib/model_edit_util');
  const rows = [
    { id: 1, table: 'b', type: 'INT', len: 10 },
    { id: 2, table: 'a', type: 'VARCHAR', len: 2 },
    { id: 3, table: 'b', type: 'CHAR', len: '' },
    { id: 4, table: 'a', type: 'CHAR', len: 100 },
  ];
  const ids = list => list.map(r => r.id);

  test('header click cycles ascending, descending, off and keeps priority order', () => {
    let sorts = toggleSort([], 'table');
    sorts = toggleSort(sorts, 'type');
    expect(sorts).toEqual([{ key: 'table', dir: 'asc' }, { key: 'type', dir: 'asc' }]);
    sorts = toggleSort(sorts, 'table');
    expect(sorts).toEqual([{ key: 'table', dir: 'desc' }, { key: 'type', dir: 'asc' }]);
    expect(toggleSort(sorts, 'table')).toEqual([{ key: 'type', dir: 'asc' }]);
  });

  test('later columns break ties of earlier ones', () => {
    expect(ids(sortRows(rows, [{ key: 'table', dir: 'asc' }, { key: 'type', dir: 'asc' }])))
      .toEqual([4, 2, 3, 1]);
    expect(ids(sortRows(rows, [{ key: 'table', dir: 'desc' }, { key: 'type', dir: 'desc' }])))
      .toEqual([1, 3, 2, 4]);
  });

  test('numbers sort numerically, blanks first, and no sort keeps the original order', () => {
    expect(ids(sortRows(rows, [{ key: 'len', dir: 'asc' }]))).toEqual([3, 2, 1, 4]);
    expect(sortRows(rows, [])).toBe(rows);
  });

  test('a getter supplies the displayed value', () => {
    const getters = { label: r => (r.id % 2 ? 'odd' : 'even') };
    expect(ids(sortRows(rows, [{ key: 'label', dir: 'asc' }], getters))).toEqual([2, 4, 1, 3]);
  });
});
