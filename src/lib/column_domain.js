// A database has no place for the model's domains, so the link between a column and its
// domain is written into the database and read back when reversing:
//   SQL Server  -> a column extended property named Domain
//   PostgreSQL  -> a real CREATE DOMAIN used as the column type
// No dom or react imports, utils.js runs this inside the worker.
import './Math';

export const DOMAIN_PROPERTY = 'Domain';

const lower = v => `${v === undefined || v === null ? '' : v}`.toLowerCase();

export const domainDialect = (dataSource, dbId) => {
  const supports = (dataSource && dataSource.profile && dataSource.profile.dataTypeSupports) || [];
  const name = lower((supports.find(s => s.id === dbId) || {}).defKey || dbId);
  if (name === 'sqlserver' || name === 'mssql') {
    return 'sqlserver';
  }
  return name === 'postgresql' ? 'postgresql' : '';
};

export const domainInDdl = dataSource => !!(dataSource && dataSource.profile
  && dataSource.profile.sql && dataSource.profile.sql.domainInDdl === true);

export const canCarryDomains = url => /^jdbc:(sqlserver|postgresql):/i.test(url || '');

// Always quoted, so a code such as Int or Money stays apart from the built-in type. An
// all-lowercase code equal to a built-in name cannot be told apart and is not written.
const ident = name => `"${`${name}`.replace(/"/g, '""')}"`;
const PG_TYPES = ['bigint', 'bigserial', 'bit', 'bool', 'boolean', 'box', 'bytea', 'char',
  'character', 'cidr', 'circle', 'date', 'decimal', 'float', 'float4', 'float8', 'inet', 'int',
  'int2', 'int4', 'int8', 'integer', 'interval', 'json', 'jsonb', 'line', 'macaddr', 'money',
  'name', 'numeric', 'oid', 'path', 'point', 'polygon', 'real', 'serial', 'smallint', 'text',
  'time', 'timestamp', 'timestamptz', 'timetz', 'uuid', 'varbit', 'varchar', 'xml'];
const quote = text => `${text}`.replace(/'/g, "''");
const measure = (len, scale) => {
  if (!(len > 0)) {
    return '';
  }
  return scale > 0 ? `(${len},${scale})` : `(${len})`;
};

// `entity` is the table as the DDL template receives it, each field already carrying the
// resolved type and `domainData`. Returns the table to render plus statements to put
// around the CREATE TABLE. `seen` keeps one CREATE DOMAIN per domain across tables.
export const domainDdl = (dataSource, dbId, entity, seen = new Set()) => {
  const plain = { entity, before: '', after: '' };
  const dialect = domainInDdl(dataSource) ? domainDialect(dataSource, dbId) : '';
  const linked = f => !!(f.domainData && f.domainData.defKey);
  if (!dialect || !entity || !(entity.fields || []).some(linked)) {
    return plain;
  }
  if (dialect === 'sqlserver') {
    return {
      ...plain,
      after: entity.fields.filter(linked).map(f => `EXEC sp_addextendedproperty '${DOMAIN_PROPERTY}', `
        + `'${quote(f.domainData.defKey)}', 'SCHEMA', dbo, 'table', ${entity.defKey}, `
        + `'column', ${f.defKey};`).join('\n'),
    };
  }
  const before = [];
  const fields = entity.fields.map((f) => {
    // SERIAL columns keep their own type.
    if (!linked(f) || f.autoIncrement || !f.type || PG_TYPES.includes(f.domainData.defKey)) {
      return f;
    }
    const name = ident(f.domainData.defKey);
    if (!seen.has(lower(name))) {
      seen.add(lower(name));
      before.push(`DO $$ BEGIN CREATE DOMAIN ${name} AS ${f.type}${measure(f.len, f.scale)}; `
        + 'EXCEPTION WHEN duplicate_object THEN NULL; END $$;');
    }
    return { ...f, type: name, len: '', scale: '' };
  });
  return { entity: { ...entity, fields }, before: before.join('\n'), after: '' };
};

export const wrapDomainDdl = (ddl, { before, after }) => [before, ddl, after]
  .filter(part => part && `${part}`.trim()).join('\n');

// Marks reversed columns with the domain code found in the database. For PostgreSQL the
// row also carries the base type, which replaces the domain name the driver reports.
export const applyColumnDomains = (entities, rows) => {
  const found = new Map((rows || []).filter(r => r && r.domain)
    .map(r => [`${lower(r.table)}\n${lower(r.column)}`, r]));
  if (found.size === 0) {
    return entities || [];
  }
  return (entities || []).map(e => ({
    ...e,
    fields: (e.fields || []).map((f) => {
      const row = found.get(`${lower(e.originDefKey || e.defKey)}\n${lower(f.defKey)}`);
      if (!row) {
        return f;
      }
      const base = row.type ? { type: row.type, len: row.len || '', scale: row.scale || '' } : {};
      return { ...f, ...base, domainKey: row.domain };
    }),
  }));
};

// Links the marked columns to model domains, by code and ignoring case. A domain the
// model does not have yet is created from the column's own type.
export const resolveColumnDomains = (dataSource, entities, dbId) => {
  const ds = dataSource || {};
  let domains = ds.domains || [];
  let mappings = (ds.dataTypeMapping && ds.dataTypeMapping.mappings) || [];
  const db = dbId || (ds.profile && ds.profile.default && ds.profile.default.db) || '';
  const domainFor = (f) => {
    const known = domains.find(d => lower(d.defKey) === lower(f.domainKey));
    if (known) {
      return known;
    }
    let mapping = mappings.find(m => f.type && lower(m[db]) === lower(f.type));
    if (!mapping) {
      mapping = { id: Math.uuid(), defKey: f.type || f.domainKey, defName: f.type || f.domainKey, [db]: f.type || '' };
      mappings = mappings.concat(mapping);
    }
    const domain = {
      id: Math.uuid(),
      defKey: f.domainKey,
      defName: f.domainKey,
      applyFor: mapping.id,
      len: f.len === null || f.len === undefined ? '' : f.len,
      scale: f.scale === null || f.scale === undefined ? '' : f.scale,
      uiHint: '',
    };
    domains = domains.concat(domain);
    return domain;
  };
  const links = {};
  const next = (entities || []).map(e => ({
    ...e,
    fields: (e.fields || []).map((f) => {
      if (!f.domainKey) {
        return f;
      }
      const { domainKey, ...rest } = f;
      const domain = domainFor(f);
      links[f.id] = { domain: domain.id, baseType: domain.applyFor, type: '', len: '', scale: '' };
      return { ...rest, ...links[f.id] };
    }),
  }));
  return {
    entities: next,
    links,
    dataSource: links && Object.keys(links).length > 0
      ? { ...ds, domains, dataTypeMapping: { ...ds.dataTypeMapping, mappings } } : ds,
  };
};

// Re-applies the links after a step that guessed domains from types alone.
export const keepColumnDomains = (entities, links) => (entities || []).map(e => ({
  ...e,
  fields: (e.fields || []).map((f) => {
    const { domainKey, ...rest } = f;
    return links[f.id] ? { ...rest, ...links[f.id] } : rest;
  }),
}));
