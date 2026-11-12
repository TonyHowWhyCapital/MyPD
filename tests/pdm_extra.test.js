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
