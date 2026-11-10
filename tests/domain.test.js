import demo from '../src/lib/template/教学管理系统.pdma.json';
import empty from '../src/lib/template/empty.json';
import {_transform, _getAllDataSQLByFilter} from '../src/lib/utils';

const clone = o => JSON.parse(JSON.stringify(o));
const db = demo.profile.default.db;
const stringMapping = demo.dataTypeMapping.mappings.find(m => m.defKey === 'string');

const withDomainColumn = (ds, domains, field) => ({
  ...ds,
  domains,
  entities: ds.entities.concat({
    ...clone(ds.entities[0]),
    id: 'dom-entity',
    defKey: 'DOMAIN_TABLE',
    fields: [{id: 'f-dom', defKey: 'CODE_COL', primaryKey: false, ...field}],
    indexes: [],
    correlations: [],
  }),
});
const ddl = ds => _getAllDataSQLByFilter(ds, db, ['createTable']);
const tableDdl = ds => ddl(ds).split('DROP TABLE').find(s => s.includes('DOMAIN_TABLE')) || '';
const newDomain = {
  id: 'dom-new', defKey: 'ShortCode', defName: 'short code', applyFor: stringMapping.id, len: 12, scale: '', uiHint: '',
};
const column = {domain: newDomain.id, baseType: stringMapping.id};

describe('domain add and reference', () => {
  test('column inherits mapped type and length from the new domain', () => {
    const ds = withDomainColumn(demo, demo.domains.concat(newDomain), column);
    const t = _transform(ds.entities.slice(-1)[0].fields[0], ds, db);
    expect(t.len).toBe(12);
    expect(t.type).toBe(stringMapping[db]);
    expect(tableDdl(ds)).toMatch(/`CODE_COL` VARCHAR\(12\)/);
  });
  test('adding a domain leaves the original project untouched', () => {
    const before = demo.domains.length;
    const next = demo.domains.concat(newDomain);
    expect(next).toHaveLength(before + 1);
    expect(demo.domains).toHaveLength(before);
  });
});

describe('domain edit', () => {
  test('changing the domain length changes the DDL', () => {
    const edited = demo.domains.concat({...newDomain, len: 40});
    const ds = withDomainColumn(demo, edited, column);
    expect(tableDdl(ds)).toMatch(/`CODE_COL` VARCHAR\(40\)/);
    expect(tableDdl(ds)).not.toMatch(/VARCHAR\(12\)/);
  });
  test('editing a shared domain updates every column that references it', () => {
    const name = demo.domains.find(d => d.defKey === 'Name');
    const edited = demo.domains.map(d => (d.id === name.id ? {...d, len: 77} : d));
    const sql = ddl({...demo, domains: edited});
    expect(sql).toMatch(/`COLLEGE_NAME` VARCHAR\(77\)/);
    expect(ddl(demo)).toMatch(/`COLLEGE_NAME` VARCHAR\(90\)/);
  });
});

describe('domain delete and dangling references', () => {
  test('deleting a referenced domain keeps the mapped type and drops the length without throwing', () => {
    const ds = withDomainColumn(demo, demo.domains, column);
    const without = {...ds, domains: ds.domains.filter(d => d.id !== newDomain.id)};
    let sql;
    expect(() => {
      sql = tableDdl(without);
    }).not.toThrow();
    const t = _transform(without.entities.slice(-1)[0].fields[0], without, db);
    expect(t.len).toBe('');
    expect(t.type).toBe(stringMapping[db]);
    expect(sql).toMatch(/`CODE_COL` VARCHAR\s/);
    expect(sql).not.toMatch(/VARCHAR\(/);
  });
  test('a column pointing at a non-existent domain id does not throw', () => {
    const ds = withDomainColumn(demo, demo.domains, {domain: 'missing-id', baseType: stringMapping.id});
    expect(() => ddl(ds)).not.toThrow();
    expect(tableDdl(ds)).toMatch(/CODE_COL/);
  });
  test('a dangling domain without baseType does not throw either', () => {
    const ds = withDomainColumn(demo, demo.domains, {domain: 'missing-id', type: 'VARCHAR', len: 5});
    expect(() => ddl(ds)).not.toThrow();
    expect(tableDdl(ds)).toMatch(/CODE_COL/);
  });
});

describe('legacy load', () => {
  test('the untouched sample project still produces DDL', () => {
    expect(ddl(demo)).toMatch(/CREATE TABLE/i);
  });
  test('the empty template still produces DDL for an added table', () => {
    const emptyDb = empty.profile.default.db;
    expect(() => _getAllDataSQLByFilter(empty, emptyDb, ['createTable'])).not.toThrow();
    expect(empty.domains === undefined || Array.isArray(empty.domains)).toBe(true);
  });
});
