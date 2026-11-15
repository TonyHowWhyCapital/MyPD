// Identifiers and literals of the SQL dialects the test data is written for.
// Pure functions, no file access. Everything that ends up in a statement passes through
// here, so a value can never break out of its literal.

export const DIALECTS = ['mssql', 'mysql', 'postgresql', 'oracle', 'generic'];

export const DIALECT_NAMES = {
  mssql: 'SQL Server',
  mysql: 'MySQL / MariaDB',
  postgresql: 'PostgreSQL',
  oracle: 'Oracle',
  generic: 'standard SQL',
};

const sqlError = (code, detail) => {
  const error = new Error(`${code}${detail ? `: ${detail}` : ''}`);
  error.code = code;
  return error;
};

export const checkDialect = (dialect) => {
  if (!DIALECTS.includes(dialect)) {
    throw sqlError('testdata.sql.dialect', `${dialect}`);
  }
  return dialect;
};

// ---------------------------------------------------------------- identifiers

// The DDL templates of the project write table and column names without quotes for
// Oracle and PostgreSQL, so the database folded them (upper case on Oracle, lower case on
// PostgreSQL). A quoted name is case sensitive, therefore a name that could be written
// without quotes is folded the same way before it is quoted; quoting then only protects
// reserved words. A name that needs quotes anyway (spaces, leading digit...) is kept.
const FOLD = {
  oracle: /^[A-Za-z\u0080-\uFFFE][A-Za-z0-9_$#\u0080-\uFFFE]*$/,
  postgresql: /^[A-Za-z_\u0080-\uFFFE][A-Za-z0-9_$\u0080-\uFFFE]*$/,
};
// Unknown database: nobody knows how it folds, a plain name stays as the DDL wrote it.
// A reserved word can only exist as a quoted name, so it is quoted here as well.
const PLAIN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(('add all alter and any as asc between by case check column constraint '
  + 'create cross current_date current_time current_timestamp current_user default delete desc '
  + 'distinct drop else end except exists false fetch for foreign from full grant group having '
  + 'in index inner insert intersect into is join key left like limit not null offset on or '
  + 'order outer primary references right select session_user set some table then to true '
  + 'union unique update user using values view when where with').split(' '));

const foldAscii = (name, upper) => name.replace(upper ? /[a-z]+/g : /[A-Z]+/g,
  s => (upper ? s.toUpperCase() : s.toLowerCase()));

// eslint-disable-next-line no-control-regex
const NUL = /\u0000/g;

const cleanName = (name) => {
  const text = `${name === undefined || name === null ? '' : name}`.replace(NUL, '');
  if (!text.trim()) {
    throw sqlError('testdata.sql.emptyName');
  }
  return text;
};

// The name as the database knows it (without quotes).
export const foldName = (name, dialect) => {
  const text = cleanName(name);
  if (dialect === 'oracle') {
    // Oracle has no way to write a double quote inside a name
    const safe = text.replace(/"/g, '');
    return FOLD.oracle.test(safe) ? foldAscii(safe, true) : cleanName(safe);
  }
  if (dialect === 'postgresql' && FOLD.postgresql.test(text)) {
    return foldAscii(text, false);
  }
  return text;
};

export const quoteName = (name, dialect) => {
  const text = foldName(name, checkDialect(dialect));
  if (dialect === 'mssql') {
    return `[${text.replace(/]/g, ']]')}]`;
  }
  if (dialect === 'mysql') {
    return `\`${text.replace(/`/g, '``')}\``;
  }
  if (dialect === 'generic' && PLAIN.test(text) && !RESERVED.has(text.toLowerCase())) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
};

// `schema.table` is quoted part by part, as the unquoted DDL reads it.
export const tableParts = (defKey) => {
  const text = cleanName(defKey);
  const parts = text.split('.');
  return parts.length <= 3 && parts.every(p => p.trim()) ? parts : [text];
};

export const quoteTable = (defKey, dialect) => tableParts(defKey)
  .map(p => quoteName(p, dialect)).join('.');

// ---------------------------------------------------------------- numbers

// A number without exponent and without locale formatting; null when it is no number.
export const plainNumber = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return null;
  }
  if (n === 0) {
    return '0';
  }
  const text = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (!m) {
    return text;
  }
  const digits = m[2] + (m[3] || '');
  const point = m[2].length + Number(m[4]);
  if (point <= 0) {
    return `${m[1]}0.${'0'.repeat(-point)}${digits}`;
  }
  if (point >= digits.length) {
    return `${m[1]}${digits}${'0'.repeat(point - digits.length)}`;
  }
  return `${m[1]}${digits.slice(0, point)}.${digits.slice(point)}`;
};

const NUMERIC = /^[+-]?\d+(\.\d+)?$/;
export const numericText = (text) => {
  const t = `${text}`.trim();
  return NUMERIC.test(t) ? t.replace(/^\+/, '') : null;
};

// ---------------------------------------------------------------- strings

const quoted = text => `'${text.replace(/'/g, "''")}'`;

// Text between the characters that must not stand in a literal: [text, char, text, ...]
// eslint-disable-next-line no-control-regex
const CONTROL = /([\u0000-\u0008\u000A-\u001F\u007F])/;
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BACKSLASH = /([\u0000-\u0008\u000A-\u001F\u007F\\])/;

const pieces = (text, pattern, plain, special) => text.split(pattern)
  .map((part, i) => {
    if (i % 2 === 1) {
      return special(part.charCodeAt(0));
    }
    return part === '' ? '' : plain(part);
  }).filter(p => p !== '');

// SQL Server: N'...' keeps unicode whatever the code page of the database is. Line breaks
// become NCHAR(): a line holding only GO would end the batch in sqlcmd and SSMS, and a
// backslash before a line break is a line continuation inside a T-SQL literal.
const mssqlString = (text) => {
  const parts = pieces(text, CONTROL, p => `N${quoted(p)}`, code => `NCHAR(${code})`);
  if (parts.length === 0) {
    return "N''";
  }
  if (parts.length > 1 && text.length > 4000) {
    // operands that are not (max) are cut at 4000 characters when concatenated
    parts[0] = `CAST(${parts[0]} AS nvarchar(max))`;
  }
  return parts.join(' + ');
};

// MySQL: a backslash is an escape character unless NO_BACKSLASH_ESCAPES is set. Writing
// it as CHAR(92) is right in both modes, the same goes for control characters.
const mysqlString = (text) => {
  const parts = pieces(text, CONTROL_OR_BACKSLASH, quoted,
    code => `CHAR(${code} USING utf8mb4)`);
  if (parts.length === 0) {
    return "''";
  }
  return parts.length === 1 ? parts[0] : `CONCAT(${parts.join(', ')})`;
};

// PostgreSQL: a plain literal has no escapes with standard_conforming_strings (default
// since 9.1). With a backslash or a control character E'...' is used, which reads the
// same whatever that setting is. A NUL cannot be stored in a text value and is dropped.
const PG_ESCAPES = {
  8: '\\b', 10: '\\n', 12: '\\f', 13: '\\r', 92: '\\\\',
};
const postgresString = (value) => {
  const text = value.replace(NUL, '');
  if (!CONTROL_OR_BACKSLASH.test(text)) {
    return quoted(text);
  }
  const body = text.split(CONTROL_OR_BACKSLASH).map((part, i) => {
    if (i % 2 === 0) {
      return part.replace(/'/g, "''");
    }
    const code = part.charCodeAt(0);
    return PG_ESCAPES[code] || `\\u${`000${code.toString(16)}`.slice(-4)}`;
  }).join('');
  return `E'${body}'`;
};

const utf8Length = text => Buffer.byteLength(text, 'utf8');

// Oracle: '' is NULL; a literal holds at most 4000 bytes, so long text is cut into
// pieces of 1000 characters (at most 4000 bytes in AL32UTF8) and joined; beyond 4000
// bytes in total the pieces are CLOBs, VARCHAR2 concatenation stops there. Pieces are put
// on lines of their own: SQL*Plus refuses input lines longer than 2499 characters.
const ORACLE_PIECE = 1000;
const cut = (text, size) => {
  const chars = Array.from(text); // by code point, a surrogate pair is never split
  if (chars.length <= size) {
    return [text];
  }
  const out = [];
  for (let i = 0; i < chars.length; i += size) {
    out.push(chars.slice(i, i + size).join(''));
  }
  return out;
};
const oracleString = (text) => {
  if (text === '') {
    return 'NULL';
  }
  const clob = utf8Length(text) > 4000;
  const parts = [];
  text.split(CONTROL).forEach((part, i) => {
    if (i % 2 === 1) {
      parts.push(`CHR(${part.charCodeAt(0)})`);
    } else if (part !== '') {
      cut(part, ORACLE_PIECE).forEach(p => parts.push(clob ? `TO_CLOB(${quoted(p)})` : quoted(p)));
    }
  });
  if (clob && parts[0].indexOf('TO_CLOB(') !== 0) {
    parts[0] = `TO_CLOB(${parts[0]})`;
  }
  let line = 0;
  return parts.reduce((sql, part) => {
    if (sql === '') {
      line = part.length;
      return part;
    }
    if (line + part.length > ORACLE_PIECE) {
      line = part.length;
      return `${sql} ||\n    ${part}`;
    }
    line += part.length + 4;
    return `${sql} || ${part}`;
  }, '');
};

// Standard SQL knows no escapes: only the quote is doubled. NUL is dropped, most tools
// end a statement there.
const genericString = text => quoted(text.replace(NUL, ''));

const STRING = {
  mssql: mssqlString,
  mysql: mysqlString,
  postgresql: postgresString,
  oracle: oracleString,
  generic: genericString,
};

export const stringLiteral = (text, dialect) => STRING[checkDialect(dialect)](`${text}`);

// ---------------------------------------------------------------- other kinds

const boolLiteral = (flag, dialect, column) => {
  if (dialect === 'postgresql') {
    // BIT(1) takes a bit string, not a boolean
    if (/^\s*(bit|varbit)/i.test((column && column.type) || '')) {
      return flag ? "B'1'" : "B'0'";
    }
    return flag ? 'TRUE' : 'FALSE';
  }
  return flag ? '1' : '0';
};

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(\.\d{1,9})?)?$/;
const TIME = /^(\d{2}:\d{2}:\d{2})(\.\d{1,9})?$/;

const dateLiteral = (text, dialect) => {
  const m = DATE_TIME.exec(text.trim());
  if (!m) {
    return null;
  }
  if (dialect === 'mssql') {
    return `'${m[1]}${m[2]}${m[3]}'`; // read the same under any DATEFORMAT and language
  }
  const iso = `'${m[1]}-${m[2]}-${m[3]}'`;
  return dialect === 'oracle' ? `DATE ${iso}` : iso;
};

const dateTimeLiteral = (text, dialect) => {
  const m = DATE_TIME.exec(text.trim());
  if (!m) {
    return null;
  }
  const time = `${m[4] || '00:00:00'}${m[5] || ''}`;
  if (dialect === 'mssql') {
    return `'${m[1]}-${m[2]}-${m[3]}T${time}'`; // ISO 8601, independent of DATEFORMAT
  }
  const iso = `'${m[1]}-${m[2]}-${m[3]} ${time}'`;
  return dialect === 'oracle' ? `TIMESTAMP ${iso}` : iso;
};

const timeLiteral = (text, dialect, column) => {
  const whole = DATE_TIME.exec(text.trim());
  const m = whole && whole[4] ? [null, whole[4], whole[5]] : TIME.exec(text.trim());
  if (!m) {
    return null;
  }
  if (dialect === 'oracle' && /DATE|TIMESTAMP/i.test((column && column.type) || '')) {
    // Oracle has no time of day type, such a column is a DATE
    return `TO_DATE('1970-01-01 ${m[1]}', 'YYYY-MM-DD HH24:MI:SS')`;
  }
  return `'${m[1]}${m[2] || ''}'`;
};

const HEX = /^(?:0x)?((?:[0-9a-f]{2})*)$/i;
const binaryLiteral = (text, dialect) => {
  const m = HEX.exec(text.trim());
  const hex = (m ? m[1] : Buffer.from(text, 'utf8').toString('hex')).toUpperCase();
  if (dialect === 'mssql') {
    return `0x${hex}`;
  }
  if (dialect === 'postgresql') {
    return `decode('${hex}', 'hex')`; // no backslash, unlike '\x...'
  }
  if (dialect === 'oracle') {
    return hex ? `HEXTORAW('${hex}')` : 'NULL';
  }
  return `X'${hex}'`;
};

const TRUE_TEXT = /^(true|1)$/i;
const FALSE_TEXT = /^(false|0)$/i;

const textLiteral = (text, kind, column, dialect) => {
  if (kind === 'int' || kind === 'decimal') {
    return numericText(text) || stringLiteral(text, dialect);
  }
  if (kind === 'bool' && (TRUE_TEXT.test(text) || FALSE_TEXT.test(text))) {
    return boolLiteral(TRUE_TEXT.test(text), dialect, column);
  }
  if (kind === 'date') {
    return dateLiteral(text, dialect) || stringLiteral(text, dialect);
  }
  if (kind === 'datetime') {
    return dateTimeLiteral(text, dialect) || stringLiteral(text, dialect);
  }
  if (kind === 'time') {
    return timeLiteral(text, dialect, column) || stringLiteral(text, dialect);
  }
  if (kind === 'binary') {
    return binaryLiteral(text, dialect);
  }
  return stringLiteral(text, dialect);
};

// The value as it stands in a VALUES list of the dialect.
export const sqlLiteral = (value, column, dialect) => {
  checkDialect(dialect);
  if (value === null || value === undefined) {
    return 'NULL';
  }
  const kind = (column && column.kind) || '';
  if (typeof value === 'boolean') {
    if (kind === 'string') {
      return stringLiteral(value ? '1' : '0', dialect);
    }
    return kind === 'bool' ? boolLiteral(value, dialect, column) : (value && '1') || '0';
  }
  if (typeof value === 'number') {
    const text = plainNumber(value);
    if (text === null) {
      return 'NULL';
    }
    if (kind === 'bool') {
      return boolLiteral(value !== 0, dialect, column);
    }
    return kind === 'string' ? stringLiteral(text, dialect) : text;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'string') {
    return textLiteral(value, kind, column, dialect);
  }
  return stringLiteral(value instanceof Date ? value.toISOString() : JSON.stringify(value),
    dialect);
};
