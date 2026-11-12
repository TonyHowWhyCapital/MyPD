import _ from 'lodash';
import { pdmToDataSource, mergePdm, createPdm } from '../src/lib/pdm';
import base from '../src/lib/template/empty.json';
import { buildPdm, ids } from './fixtures/pdm';

const read = project => pdmToDataSource(buildPdm(), project);

describe('importing a pdm file into an open project', () => {
  const imported = read(base);
  const merged = mergePdm(base, imported);
  const emp = imported.entities.find(e => e.id === ids.emp);

  test('brings the tables, the domains and the diagram', () => {
    expect(merged.entities.map(e => e.id)).toEqual(expect.arrayContaining([ids.dept, ids.emp]));
    expect(merged.domains.map(d => d.id)).toEqual(expect.arrayContaining([ids.domId, ids.domName]));
    expect(merged.diagrams.map(d => d.id)).toEqual([ids.diagram]);
    expect(merged.diagrams[0].canvasData.cells.filter(c => c.shape === 'table')).toHaveLength(2);
  });

  test('keeps the columns linked to their domains and the tables to each other', () => {
    const linked = ds => ds.entities.reduce((a, e) => a.concat(e.fields.filter(f => f.domain).map(f => `${f.id}>${f.domain}`)), []);
    expect(linked(imported).length).toBeGreaterThan(0);
    expect(linked(merged)).toEqual(linked(imported));
    const after = merged.entities.find(e => e.id === ids.emp);
    expect(after.correlations).toEqual(emp.correlations);
    expect(after.correlations[0].refEntity).toBe(ids.dept);
  });

  test('leaves the project default database alone and fills new types for it', () => {
    expect(merged.profile).toEqual(base.profile);
    const db = base.profile.default.db;
    merged.dataTypeMapping.mappings.forEach(m => expect(m[db]).toBeTruthy());
  });

  test('takes only the chosen tables and drops what points outside them', () => {
    const one = mergePdm(base, imported, { entityIds: [ids.emp] });
    expect(one.entities.map(e => e.id)).toEqual([ids.emp]);
    expect(one.entities[0].correlations).toEqual([]);
    const cells = one.diagrams[0].canvasData.cells;
    expect(cells).toHaveLength(1);
    expect(cells[0].originKey).toBe(ids.emp);
  });

  test('a table the project already has is replaced under its own ids', () => {
    const project = _.cloneDeep(base);
    project.entities = [{
      ..._.cloneDeep(imported.entities.find(e => e.id === ids.dept)),
      id: 'mine',
      fields: imported.entities.find(e => e.id === ids.dept).fields.map((f, i) => ({ ...f, id: `mine-${i}` })),
    }];
    project.viewGroups = [{ id: 'g1', defKey: 'G1', defName: 'G1', refEntities: ['mine'], refViews: [], refDiagrams: [], refDicts: [] }];
    const again = mergePdm(project, read(project), { groupOf: { [ids.dept]: 'g1', [ids.emp]: 'g1' } });
    expect(again.entities.map(e => e.id)).toEqual(['mine', ids.emp]);
    const ref = again.entities[1].correlations[0];
    expect(ref.refEntity).toBe('mine');
    expect(ref.refField).toMatch(/^mine-/);
    const cells = again.diagrams[0].canvasData.cells;
    expect(cells.filter(c => c.shape === 'table').map(c => c.originKey).sort()).toEqual([ids.emp, 'mine'].sort());
    expect(cells.find(c => c.source).source.port).toMatch(/^mine-\d+%out$/);
    expect(again.viewGroups[0].refEntities.sort()).toEqual([ids.emp, 'mine'].sort());
    expect(again.viewGroups[0].refDiagrams).toEqual([ids.diagram]);
  });

  test('a project domain of the same code with another type is kept and not linked', () => {
    const project = _.cloneDeep(base);
    const used = imported.entities.reduce((a, e) => a.concat(e.fields), []).find(f => f.domain).domain;
    const source = imported.domains.find(d => d.id === used);
    project.domains = [...(project.domains || []), { ...source, id: 'own', len: 999 }];
    const result = mergePdm(project, read(project));
    expect(result.domains.filter(d => d.defKey === source.defKey).map(d => d.id)).toEqual(['own']);
    const fields = result.entities.reduce((a, e) => a.concat(e.fields), []);
    expect(fields.some(f => f.domain === 'own' || f.domain === used)).toBe(false);
  });

  test('two domains of the file sharing a code are both kept', () => {
    const twice = read(base);
    twice.domains = twice.domains.concat({ ...twice.domains[0], id: 'second' });
    expect(mergePdm(base, twice).domains.filter(d => d.defKey === twice.domains[0].defKey)).toHaveLength(2);
  });

  test('importing the same file twice changes nothing more', () => {
    expect(mergePdm(merged, read(merged))).toEqual(merged);
  });

  test('the merged project can be written out and read back as a pdm file', () => {
    const xml = createPdm(merged, { name: 'Back', domainIds: merged.domains.map(d => d.id) });
    const back = pdmToDataSource(xml, base);
    expect(back.entities.map(e => e.defKey).sort()).toEqual(merged.entities.map(e => e.defKey).sort());
    const linked = ds => ds.entities.reduce((a, e) => a.concat(e.fields.filter(f => f.domain).map(f => `${e.defKey}.${f.defKey}`)), []).sort();
    expect(linked(back)).toEqual(linked(merged));
  });
});

describe('exporting a project that came from a pdm file', () => {
  const { rememberSource, projectToPdm } = require('../src/lib/pdm');
  const xml = buildPdm();
  const project = rememberSource(mergePdm(base, read(base)), 'staff.pdm', xml);

  test('an unchanged project gives the file back as it was', () => {
    expect(projectToPdm(project)).toBe(xml);
  });

  test('a change reaches the file and the rest of it stays', () => {
    const changed = _.cloneDeep(project);
    changed.entities.find(e => e.id === ids.dept).defName = 'Renamed';
    const out = projectToPdm(changed, { now: 1800000000, user: 'jest' });
    expect(out).toContain('<a:Name>Renamed</a:Name>');
    expect(out.split('\n').filter((line, i) => line !== xml.split('\n')[i]).length).toBeLessThan(6);
  });

  test('the first file is remembered, the same file again is refreshed', () => {
    expect(rememberSource(project, 'other.pdm', '<x/>').profile.pdmSource.name).toBe('staff.pdm');
    expect(rememberSource(project, 'staff.pdm', '<x/>').profile.pdmSource.xml).toBe('<x/>');
  });

  test('a project without a remembered file is written as a new one', () => {
    const fresh = mergePdm(base, read(base));
    const back = pdmToDataSource(projectToPdm(fresh), base);
    expect(back.entities.map(e => e.defKey).sort()).toEqual(fresh.entities.map(e => e.defKey).sort());
  });
});
