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
const domain = (ds, id) => ds.domains.find(d => d.id === id);
const withDomainDetails = buildPdm().replace('<a:Code>D_NAME</a:Code>',
  '<a:Code>D_NAME</a:Code>\n<a:Comment>A name</a:Comment>\n<a:DefaultValue>\'-\'</a:DefaultValue>')
  .replace('<a:Length>100</a:Length>', '<a:Length>100</a:Length>\n<a:PhysicalDomain.Mandatory>1</a:PhysicalDomain.Mandatory>');

describe('what a domain says beyond its type', () => {
  test('default value, mandatory and comment are read', () => {
    const d = domain(open(withDomainDetails), ids.domName);
    expect([d.defaultValue, d.notNull, d.comment]).toEqual(["'-'", true, 'A name']);
    const plain = domain(open(withDomainDetails), ids.domId);
    expect([plain.defaultValue, plain.notNull, plain.comment]).toEqual(['', false, '']);
  });

  test('saving without a change keeps the file as it is', () => {
    expect(save(withDomainDetails, () => {})).toBe(withDomainDetails);
  });

  test('changes are written and read back', () => {
    const saved = save(withDomainDetails, (ds) => {
      Object.assign(domain(ds, ids.domName), { defaultValue: "'?'", notNull: false, comment: '' });
      Object.assign(domain(ds, ids.domId), { defaultValue: '0', notNull: true, comment: 'Key' });
    });
    const after = open(saved);
    const name = domain(after, ids.domName);
    const id = domain(after, ids.domId);
    expect([name.defaultValue, name.notNull, name.comment]).toEqual(["'?'", false, '']);
    expect([id.defaultValue, id.notNull, id.comment]).toEqual(['0', true, 'Key']);
  });

  test('a project that never read these values does not wipe them', () => {
    const saved = save(withDomainDetails, (ds) => {
      ds.domains = ds.domains.map(d => _.omit(d, ['defaultValue', 'notNull', 'comment']));
    });
    expect(saved).toBe(withDomainDetails);
  });
});

describe('keys of a table', () => {
  const xml = buildPdm();
  const emp = ds => ds.entities.find(e => e.id === ids.dept);
  const alternate = ds => emp(ds).keys.filter(k => !k.primary);

  test('the primary key is listed with its columns', () => {
    const keys = emp(open(xml)).keys;
    expect(keys.filter(k => k.primary)).toHaveLength(1);
    expect(keys.find(k => k.primary).fields).toEqual(emp(open(xml)).fields.filter(f => f.primaryKey).map(f => f.id));
    expect(save(xml, () => {})).toBe(xml);
  });

  test('an alternate key is written, renamed, changed and removed', () => {
    const added = save(xml, (ds) => {
      emp(ds).keys.push({ id: 'ak', defKey: 'AK_EMP', defName: 'AK_EMP', constraintName: 'UQ_DEPT', primary: false, fields: [ids.deptName, ids.deptId] });
    });
    const first = open(added);
    expect(alternate(first)).toHaveLength(1);
    expect(alternate(first)[0]).toMatchObject({ defKey: 'AK_EMP', constraintName: 'UQ_DEPT', fields: [ids.deptName, ids.deptId] });
    expect(emp(first).keys.filter(k => k.primary)).toHaveLength(1);
    expect(applyDataSourceToPdm(added, first)).toBe(added);

    const changed = save(added, (ds) => { Object.assign(alternate(ds)[0], { constraintName: 'UQ_2', fields: [ids.deptName] }); });
    expect(alternate(open(changed))[0]).toMatchObject({ constraintName: 'UQ_2', fields: [ids.deptName] });

    const dropped = save(changed, (ds) => { emp(ds).keys = emp(ds).keys.filter(k => k.primary); });
    expect(alternate(open(dropped))).toEqual([]);
    expect(emp(open(dropped)).keys).toHaveLength(1);
  });

  test('the name of the primary key constraint is written', () => {
    const saved = save(xml, (ds) => { emp(ds).keys.find(k => k.primary).constraintName = 'PK_DEPT'; });
    expect(saved).toContain('<a:ConstraintName>PK_DEPT</a:ConstraintName>');
    expect(emp(open(saved)).keys.find(k => k.primary).constraintName).toBe('PK_DEPT');
  });

  test('a key over a new column, and a table that does not list keys at all', () => {
    const saved = save(xml, (ds) => {
      emp(ds).fields.push({ ...emp(ds).fields[1], id: 'badge', defKey: 'BADGE', defName: 'Badge', primaryKey: false });
      emp(ds).keys.push({ id: 'ak2', defKey: 'AK_BADGE', defName: 'AK_BADGE', constraintName: '', primary: false, fields: ['badge'] });
    });
    const after = open(saved);
    const badge = emp(after).fields.find(f => f.defKey === 'BADGE');
    expect(alternate(after)[0].fields).toEqual([badge.id]);
    expect(save(saved, (ds) => { ds.entities.forEach((e) => { delete e.keys; }); })).toBe(saved);
  });
});
