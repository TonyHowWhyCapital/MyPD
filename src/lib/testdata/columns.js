// Columns of a table as the test data generator sees them: the database type text of a
// field (taken through its base type and its domain, the same way the DDL does) reduced
// to a small set of kinds, plus the rule that fills the column.
import { getTestData } from './model';
import { dialectOf } from './sql';

export const COLUMN_KINDS = ['int', 'decimal', 'string', 'date', 'datetime', 'time', 'bool', 'binary'];

const INT_TYPES = ['INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT', 'INT2', 'INT4',
  'INT8', 'SERIAL', 'BIGSERIAL', 'SMALLSERIAL', 'SERIAL2', 'SERIAL4', 'SERIAL8', 'YEAR',
  'PLS_INTEGER', 'BINARY_INTEGER', 'BYTE', 'SHORT'];
// exact numbers: integer or decimal depending on the scale
const NUMERIC_TYPES = ['NUMBER', 'NUMERIC', 'DECIMAL', 'DEC'];
const DECIMAL_TYPES = ['FLOAT', 'DOUBLE', 'DOUBLE PRECISION', 'REAL', 'MONEY', 'SMALLMONEY',
  'BINARY_FLOAT', 'BINARY_DOUBLE', 'FLOAT4', 'FLOAT8'];
const DATETIME_TYPES = ['DATETIME', 'DATETIME2', 'SMALLDATETIME', 'TIMESTAMP', 'TIMESTAMPTZ',
  'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITHOUT TIME ZONE', 'TIMESTAMP WITH LOCAL TIME ZONE',
  'DATETIMEOFFSET'];
const TIME_TYPES = ['TIME', 'TIMETZ', 'TIME WITH TIME ZONE', 'TIME WITHOUT TIME ZONE'];
const BOOL_TYPES = ['BOOLEAN', 'BOOL'];
const BINARY_TYPES = ['BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BINARY', 'VARBINARY',
  'IMAGE', 'BYTEA', 'RAW', 'LONG RAW', 'BFILE', 'ROWVERSION', 'BINARY VARYING', 'GEOMETRY',
  'GEOGRAPHY', 'HIERARCHYID', 'SQL_VARIANT'];
const UUID_TYPES = ['UNIQUEIDENTIFIER', 'UUID'];
// words after the type name that do not change what the column holds
const NOISE = /\b(UNSIGNED|SIGNED|ZEROFILL|IDENTITY|AUTO_INCREMENT|CHAR|BYTE)\b$/;

const toNumber = (v) => {
  if (v === undefined || v === null || v === '') {
    return null;
  }
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

// 'numeric( 10 , 2 ) unsigned' -> { name: 'NUMERIC', args: [10, 2] }
export const parseType = (text) => {
  const raw = `${text === undefined || text === null ? '' : text}`.trim().toUpperCase();
  const found = /^([^(]*)(?:\(([^)]*)\))?(.*)$/.exec(raw) || [];
  let name = `${found[1] || ''} ${found[3] || ''}`.replace(/\s+/g, ' ').trim();
  while (NOISE.test(name) && name.indexOf(' ') > 0) {
    name = name.replace(NOISE, '').trim();
  }
  const args = found[2] === undefined ? [] : found[2].split(',').map(a => toNumber(a.trim()));
  return {
    name,
    args,
  };
};

// What the words around the type name say: 'INT(10) UNSIGNED' -> unsigned,
// 'VARCHAR2(20 CHAR)' -> length in characters, "ENUM('a','b')" -> the listed values.
export const typeTraits = (text) => {
  const raw = `${text === undefined || text === null ? '' : text}`.trim();
  const inner = (/\(([^)]*)\)/.exec(raw) || [])[1] || '';
  const values = [];
  const quoted = /'((?:[^']|'')*)'/g;
  let found = quoted.exec(inner);
  while (found) {
    values.push(found[1].replace(/''/g, "'"));
    found = quoted.exec(inner);
  }
  return {
    unsigned: /\bUNSIGNED\b/i.test(raw),
    lengthIn: (/^\s*\d+\s+(CHAR|BYTE)\s*$/i.exec(inner) || [])[1],
    values,
  };
};

const dbOf = (dataSource) => {
  const profile = (dataSource && dataSource.profile) || {};
  const supports = profile.dataTypeSupports || [];
  const id = (profile.default && profile.default.db) || (supports[0] && supports[0].id) || '';
  const found = supports.find(s => s.id === id);
  return {
    id,
    defKey: `${(found && found.defKey) || ''}`.toUpperCase(),
  };
};

const domainOf = (dataSource, field) => (field && field.domain
  ? ((dataSource && dataSource.domains) || []).find(d => d.id === field.domain) : undefined);

// The type, length and scale the DDL writes for a field (see `_transform` in ../utils.js):
// the type of its base type in the project's database, length and scale of its domain.
export const fieldType = (dataSource, field) => {
  const f = field || {};
  const db = dbOf(dataSource);
  const domain = domainOf(dataSource, f);
  const mappings = (dataSource && dataSource.dataTypeMapping
    && dataSource.dataTypeMapping.mappings) || [];
  const baseType = f.baseType || (domain && domain.applyFor);
  const mapping = baseType ? mappings.find(m => m.id === baseType) : undefined;
  const text = (mapping && mapping[db.id]) || f.type;
  const parsed = parseType(text);
  const own = domain || f;
  const len = toNumber(own.len);
  const scale = toNumber(own.scale);
  const traits = typeTraits(text);
  // "ENUM" with the values written where the length goes
  const listed = traits.values.length > 0 ? traits.values : typeTraits(`(${own.len})`).values;
  return {
    unsigned: traits.unsigned,
    lengthIn: traits.lengthIn ? traits.lengthIn.toUpperCase() : '',
    values: listed,
    type: parsed.name,
    // a length written inside the type text ("VARCHAR(50)") counts when no other is given
    len: len === null && parsed.args.length > 0 ? parsed.args[0] : len,
    scale: scale === null && len === null && parsed.args.length > 1 ? parsed.args[1] : scale,
    db: db.defKey,
  };
};

const numericKind = ({ type, len, scale, db }) => {
  if (scale !== null && scale > 0) {
    return 'decimal';
  }
  if (len !== null || scale === 0) {
    return 'int';
  }
  // no precision at all: DECIMAL defaults to (10,0)/(18,0) on MySQL and SQL Server,
  // everywhere else the column takes any number
  return (type === 'DECIMAL' || type === 'DEC') && /MYSQL|MARIADB|SQLSERVER|MSSQL/.test(db)
    ? 'int' : 'decimal';
};

const kindOf = (t) => {
  const { type, len, db } = t;
  if (type === 'TINYINT' && len === 1) {
    return 'bool';
  }
  if (type === 'BIT' || type === 'BIT VARYING' || type === 'VARBIT') {
    return type === 'BIT' && (len === null || len <= 1) ? 'bool' : 'binary';
  }
  if (type === 'LONG') {
    return /ORACLE|DM/.test(db) ? 'string' : 'int';
  }
  if (type === 'DATE') {
    // Oracle DATE carries the time of day
    return /ORACLE/.test(db) ? 'datetime' : 'date';
  }
  if (type === 'TIMESTAMP' && /SQLSERVER|MSSQL/.test(db)) {
    return 'binary'; // row version, not a point in time
  }
  if (INT_TYPES.includes(type)) {
    return 'int';
  }
  if (NUMERIC_TYPES.includes(type)) {
    return numericKind(t);
  }
  const lists = [[DECIMAL_TYPES, 'decimal'], [DATETIME_TYPES, 'datetime'], [TIME_TYPES, 'time'],
    [BOOL_TYPES, 'bool'], [BINARY_TYPES, 'binary']];
  const found = lists.find(l => l[0].includes(type));
  return found ? found[1] : 'string';
};

export const columnKind = (dataSource, field) => kindOf(fieldType(dataSource, field));

// What a column holds beyond its kind, where the automatic rule has to know:
// 'uuid', 'year', 'enum', 'set', 'json', 'interval', 'rowversion' (SQL Server writes that
// one itself, it cannot be inserted), else ''.
const subtypeOf = (t, kind, dialect) => {
  if (t.type === 'ROWVERSION' || (t.type === 'TIMESTAMP'
    && (dialect === 'mssql' || /SQLSERVER|MSSQL/.test(t.db)))) {
    return 'rowversion';
  }
  if (t.type === 'YEAR') {
    return 'year';
  }
  if (kind !== 'string') {
    return '';
  }
  if (UUID_TYPES.includes(t.type)) {
    return 'uuid';
  }
  if (t.type === 'ENUM' || t.type === 'SET') {
    return t.type.toLowerCase();
  }
  if (t.type === 'JSON' || t.type === 'JSONB') {
    return 'json';
  }
  return /^INTERVAL\b/.test(t.type) ? 'interval' : '';
};

// How the length of a text column is counted: '' = characters (UTF-16 units, what
// NVARCHAR of SQL Server and NVARCHAR2 of Oracle count, and never more than the characters
// MySQL and PostgreSQL count), 'dbcs' = bytes of a double byte code page (VARCHAR and CHAR
// of SQL Server), 'utf8' = bytes of UTF-8 (VARCHAR2 and CHAR of Oracle unless the type says
// CHAR; NLS_LENGTH_SEMANTICS is BYTE by default).
const lengthUnit = (t, kind, dialect) => {
  if (kind !== 'string' || !/^(VARCHAR2?|CHAR|CHARACTER|CHARACTER VARYING)$/.test(t.type)) {
    return '';
  }
  if (dialect === 'mssql') {
    return 'dbcs';
  }
  return dialect === 'oracle' && t.lengthIn !== 'CHAR' ? 'utf8' : '';
};

const lengthOf = (t, kind, subtype) => {
  if (kind !== 'string') {
    return t.len;
  }
  if (subtype === 'uuid') {
    return 36;
  }
  if (subtype !== '') {
    return null; // the numbers of ENUM(...), JSON and INTERVAL DAY(2) are no text length
  }
  if (t.len === null && /^(N?CHAR|CHARACTER|BPCHAR)$/.test(t.type)) {
    return 1;
  }
  return t.len;
};

export const fieldColumn = (dataSource, field) => {
  const t = fieldType(dataSource, field);
  const kind = kindOf(t);
  const dialect = dialectOf(dataSource);
  const subtype = subtypeOf(t, kind, dialect);
  const unit = lengthUnit(t, kind, dialect);
  return {
    id: field.id,
    defKey: field.defKey,
    defName: field.defName || '',
    kind,
    type: t.type,
    len: lengthOf(t, kind, subtype),
    scale: t.scale,
    notNull: !!field.notNull,
    primaryKey: !!field.primaryKey,
    autoIncrement: !!field.autoIncrement,
    // what the limits of the column depend on; only present when they say something
    dialect,
    ...(t.unsigned ? { unsigned: true } : {}),
    ...(subtype ? { subtype } : {}),
    ...(unit ? { lenUnit: unit } : {}),
    ...((subtype === 'enum' || subtype === 'set') ? { values: t.values } : {}),
  };
};

export const entityColumns = (dataSource, entity) => ((entity && entity.fields) || [])
  .filter(f => f && f.defKey).map(f => fieldColumn(dataSource, f));

const AUTO_RULE = {
  kind: 'auto',
  params: {},
};

const clampRate = (v) => {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || Number.isNaN(n)) {
    return null;
  }
  return Math.min(100, Math.max(0, n));
};

// field rule -> rule of the field's domain -> automatic; a reference to a rule that is gone
// falls through. The null rate is 0 for columns that cannot hold NULL.
export const resolveRule = (dataSource, entity, field) => {
  const td = getTestData(dataSource) || {};
  const rules = td.rules || [];
  const own = (field && field.testData) || {};
  const byId = id => (id ? rules.find(r => r && r.id === id) : undefined);
  let rule = byId(own.rule);
  let source = 'field';
  if (!rule) {
    rule = field && field.domain ? byId((td.domainRules || {})[field.domain]) : undefined;
    source = 'domain';
  }
  if (!rule) {
    rule = AUTO_RULE;
    source = 'auto';
  }
  const nullable = !!field && !field.notNull && !field.primaryKey && !field.autoIncrement;
  const fieldRate = clampRate(own.nullRate);
  const rate = fieldRate === null ? clampRate(rule.nullRate) : fieldRate;
  return {
    rule,
    source,
    nullRate: nullable && rate !== null ? rate : 0,
  };
};
