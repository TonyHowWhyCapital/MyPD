const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  domainDdl, wrapDomainDdl, applyColumnDomains, resolveColumnDomains, keepColumnDomains,
  canCarryDomains,
} = require('../src/lib/column_domain');
const { _getAllDataSQLByFilter } = require('../src/lib/utils');
const { createPdm, pdmToDataSource } = require('../src/lib/pdm');

const shop = () => JSON.parse(JSON.stringify(require('../src/lib/template/电商商城.pdma.json')));
const dbId = (ds, key) => ds.profile.dataTypeSupports.find(s => s.defKey === key).id;
const enabled = ds => ({
  ...ds, profile: { ...ds.profile, sql: { ...ds.profile.sql, domainInDdl: true } },
});
const linkedEntity = (ds) => {
  const entity = ds.entities.find(e => e.fields.some(f => f.domain && !f.autoIncrement));
  const field = entity.fields.find(f => f.domain && !f.autoIncrement);
  return { entity, field, domain: ds.domains.find(d => d.id === field.domain) };
};
const createTable = (ds, key, entity) => _getAllDataSQLByFilter(ds, dbId(ds, key),
  ['createTable'], { entities: [entity.id] });

describe('domains written into CREATE TABLE', () => {
  test('nothing changes unless the project turns it on', () => {
    const ds = shop();
    const { entity } = linkedEntity(ds);
    expect(createTable(ds, 'SQLServer', entity)).not.toContain("'Domain'");
    expect(createTable(ds, 'PostgreSQL', entity)).not.toContain('CREATE DOMAIN');
    expect(createTable(enabled(ds), 'MYSQL', entity)).not.toMatch(/Domain'|CREATE DOMAIN/);
  });

  test('SQL Server gets one Domain extended property per linked column', () => {
    const ds = enabled(shop());
    const { entity, field, domain } = linkedEntity(ds);
    expect(createTable(ds, 'SQLServer', entity)).toContain(
      `EXEC sp_addextendedproperty 'Domain', '${domain.defKey}', 'SCHEMA', dbo, `
      + `'table', ${entity.defKey}, 'column', ${field.defKey};`);
  });

  test('PostgreSQL creates each domain once and types the column with it', () => {
    const ds = enabled(shop());
    const { entity, field, domain } = linkedEntity(ds);
    const ddl = _getAllDataSQLByFilter(ds, dbId(ds, 'PostgreSQL'), ['createTable']);
    const creates = ddl.match(new RegExp(`CREATE DOMAIN "${domain.defKey}" AS `, 'g'));
    expect(creates).toHaveLength(1);
    expect(createTable(ds, 'PostgreSQL', entity))
      .toMatch(new RegExp(`\\n\\s+${field.defKey} "${domain.defKey}"[ ,\\n]`));
  });

  test('a column without a resolved type is left alone', () => {
    const ds = enabled(shop());
    const entity = { defKey: 't', fields: [{ defKey: 'c', type: '', domainData: { defKey: 'D' } }] };
    const out = domainDdl(ds, dbId(ds, 'PostgreSQL'), entity);
    expect(out.before).toBe('');
    expect(wrapDomainDdl('X', out)).toBe('X');
  });
});

describe('domains read back when reversing', () => {
  const reversed = () => [{
    id: 'e1',
    defKey: 'CASE_MAIN',
    fields: [
      { id: 'f1', defKey: 'CASE_NO', type: 'varchar', len: 12, scale: null },
      { id: 'f2', defKey: 'NOTE', type: 'varchar', len: 12, scale: null },
    ],
  }];

  test('only SQL Server and PostgreSQL connections are asked', () => {
    expect(canCarryDomains('jdbc:sqlserver://h:1433;DatabaseName=a')).toBe(true);
    expect(canCarryDomains('jdbc:postgresql://h/a')).toBe(true);
    expect(canCarryDomains('jdbc:mysql://h/a')).toBe(false);
  });

  test('links to the model domain with the same code, ignoring case', () => {
    const ds = shop();
    const domain = ds.domains[0];
    const marked = applyColumnDomains(reversed(),
      [{ table: 'case_main', column: 'case_no', domain: domain.defKey.toUpperCase() }]);
    const out = resolveColumnDomains(ds, marked);
    expect(out.entities[0].fields[0]).toMatchObject({ domain: domain.id, baseType: domain.applyFor, type: '' });
    expect(out.entities[0].fields[1]).toEqual(reversed()[0].fields[1]);
    expect(out.dataSource.domains).toHaveLength(ds.domains.length);
  });

  test('creates a missing domain from the column type and keeps it out of type guessing', () => {
    const ds = shop();
    const pg = dbId(ds, 'PostgreSQL');
    const marked = applyColumnDomains(reversed(),
      [{ table: 'CASE_MAIN', column: 'CASE_NO', domain: 'CaseNo', type: 'varchar', len: '12', scale: '' }]);
    const out = resolveColumnDomains(ds, marked, pg);
    const created = out.dataSource.domains.find(d => d.defKey === 'CaseNo');
    expect(created).toMatchObject({ len: '12', scale: '' });
    const mapping = out.dataSource.dataTypeMapping.mappings.find(m => m.id === created.applyFor);
    expect(mapping[pg].toLowerCase()).toBe('varchar');
    const guessed = marked.map(e => ({ ...e, fields: e.fields.map(f => ({ ...f, domain: '' })) }));
    const kept = keepColumnDomains(guessed, out.links)[0].fields;
    expect(kept[0].domain).toBe(created.id);
    expect(kept[1].domain).toBe('');
    expect(kept[0]).not.toHaveProperty('domainKey');
  });

  test('the link survives into a generated PDM file', () => {
    const ds = shop();
    const sqlServer = dbId(ds, 'SQLServer');
    const marked = applyColumnDomains(reversed(),
      [{ table: 'CASE_MAIN', column: 'CASE_NO', domain: 'CaseNo' }]);
    const out = resolveColumnDomains(ds, marked, sqlServer);
    const xml = createPdm({ ...out.dataSource, entities: out.entities },
      {
        name: 'x', dbId: sqlServer, now: 1800000000, domainIds: Object.values(out.links).map(l => l.domain),
      });
    const back = pdmToDataSource(xml, ds);
    const column = back.entities[0].fields.find(f => f.defKey === 'CASE_NO');
    expect(back.domains.find(d => d.id === column.domain).defKey).toBe('CaseNo');
    expect(column).toMatchObject({ len: 12 });
    expect(back.entities[0].fields.find(f => f.defKey === 'NOTE').domain || '').toBe('');
  });
});

// Runs against a real server: MYPD_PG_URL=jdbc:postgresql://127.0.0.1:55432/shop MYPD_PG_USER=mypd
const pgUrl = process.env.MYPD_PG_URL;
(pgUrl ? describe : describe.skip)('PostgreSQL round trip on a live server', () => {
  const jar = path.join(__dirname, '../public/jar/pdmaner-java.jar');
  const user = process.env.MYPD_PG_USER || '';
  const conn = ['driver_class_name=org.postgresql.Driver', `url=${pgUrl}`, `username=${user}`, 'password='];
  const read = (args) => {
    const out = path.join(os.tmpdir(), `mypd-${Date.now()}-${Math.random()}.json`);
    try {
      execFileSync('java', [...args, ...conn, `out=${out}`], { stdio: 'pipe' });
    } catch (e) { /* the out file carries the failure */ }
    const body = JSON.parse(fs.readFileSync(out, 'utf8'));
    fs.unlinkSync(out);
    expect(body.status).toBe('SUCCESS');
    return body.body;
  };

  test('DDL creates the tables, reversing restores every domain link', () => {
    const ds = enabled(shop());
    const pg = dbId(ds, 'PostgreSQL');
    const ddl = _getAllDataSQLByFilter(ds, pg, ['createTable']);
    const m = /^jdbc:postgresql:\/\/([^:/]+):(\d+)\/(\w+)/.exec(pgUrl);
    execFileSync('psql', ['-h', m[1], '-p', m[2], '-U', user, '-d', m[3], '-v', 'ON_ERROR_STOP=1',
      '-q', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'], { stdio: 'pipe' });
    execFileSync('psql', ['-h', m[1], '-p', m[2], '-U', user, '-d', m[3], '-v', 'ON_ERROR_STOP=1',
      '-q'], { input: ddl, stdio: 'pipe' });

    const rows = read(['-cp', jar, `-Dloader.path=${path.join(path.dirname(jar), 'tools')}${path.sep}`,
      '-Dloader.main=mypd.ListColumnDomains', 'org.springframework.boot.loader.PropertiesLauncher']);
    const tables = ds.entities.map(e => e.defKey).join(',');
    const engine = read(['-jar', jar, 'DBReverseGetTableDDL', `tables=${tables}`]);
    const out = resolveColumnDomains(ds, applyColumnDomains(engine, rows), pg);

    const expected = [];
    const actual = [];
    ds.entities.forEach((e) => {
      const got = out.entities.find(x => x.defKey.toLowerCase() === e.defKey.toLowerCase());
      e.fields.filter(f => !f.autoIncrement).forEach((f) => {
        const g = got.fields.find(x => x.defKey.toLowerCase() === f.defKey.toLowerCase());
        expected.push(`${e.defKey}.${f.defKey}=${f.domain || ''}`);
        actual.push(`${e.defKey}.${f.defKey}=${g.domain || ''}`);
      });
    });
    expect(expected.filter(x => !x.endsWith('=')).length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
    expect(out.dataSource.domains).toHaveLength(ds.domains.length);
  });
});
