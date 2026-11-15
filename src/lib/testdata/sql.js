// INSERT scripts for the generated test data, per SQL dialect.
// table = { defKey, columns: [{defKey, kind, type, autoIncrement}] }, rows = arrays of
// values in the order of the columns.
import {
  DIALECT_NAMES, checkDialect, foldName, quoteName, quoteTable, sqlLiteral, tableParts,
} from './sql_dialects';

export {
  DIALECTS, DIALECT_NAMES, checkDialect, quoteName, quoteTable, sqlLiteral, stringLiteral,
  plainNumber,
} from './sql_dialects';

// ---------------------------------------------------------------- dialect of a project

// defKey of profile.dataTypeSupports, lower case without separators and version numbers.
// Databases that only resemble one of the four (DM, Kingbase, GaussDB, Doris...) are not
// mapped: their script is written as standard SQL and says so.
const ALIASES = {
  mssql: 'mssql',
  sqlserver: 'mssql',
  mssqlserver: 'mssql',
  microsoftsqlserver: 'mssql',
  tsql: 'mssql',
  azuresql: 'mssql',
  mysql: 'mysql',
  mariadb: 'mysql',
  postgresql: 'postgresql',
  postgres: 'postgresql',
  postgre: 'postgresql',
  pgsql: 'postgresql',
  pg: 'postgresql',
  oracle: 'oracle',
  ora: 'oracle',
};

const JDBC = [
  [/^jdbc:(sqlserver|jtds:sqlserver|microsoft:sqlserver):/i, 'mssql'],
  [/^jdbc:(mysql|mariadb):/i, 'mysql'],
  [/^jdbc:postgresql:/i, 'postgresql'],
  [/^jdbc:oracle:/i, 'oracle'],
];
const DRIVERS = [
  [/sqlserver|jtds/i, 'mssql'],
  [/mysql|mariadb/i, 'mysql'],
  [/postgresql/i, 'postgresql'],
  [/^oracle\./i, 'oracle'],
];

const text = v => `${v === undefined || v === null ? '' : v}`;

export const dialectOfName = (name) => {
  // `Oracle 11g`, `SqlServer2019`: what follows the first digit is the version
  const key = text(name).toLowerCase().replace(/\d.*$/, '').replace(/[^a-z]/g, '');
  return ALIASES[key] || 'generic';
};

const firstMatch = (list, value) => (list.find(([pattern]) => pattern.test(text(value).trim()))
  || [])[1];

const dialectOfConn = (conn, supports) => {
  if (!conn) {
    return 'generic';
  }
  const byType = dialectOfName((supports.find(s => s.id === conn.type) || {}).defKey
    || conn.type);
  if (byType !== 'generic') {
    return byType;
  }
  const props = conn.properties || {};
  return firstMatch(JDBC, props.url) || firstMatch(DRIVERS, props.driver_class_name)
    || 'generic';
};

// The database type of the project decides (the DDL was written for it); when that is no
// database this module knows, the default connection is asked.
export const dialectOf = (dataSource) => {
  const profile = (dataSource && dataSource.profile) || {};
  const supports = Array.isArray(profile.dataTypeSupports) ? profile.dataTypeSupports : [];
  const db = profile.default && profile.default.db;
  const support = supports.find(s => s && (s.id === db || s === db));
  const byDb = dialectOfName(support && typeof support === 'object' ? support.defKey : db);
  if (byDb !== 'generic') {
    return byDb;
  }
  const connKey = profile.default && profile.default.dbConn;
  const conn = (Array.isArray(dataSource && dataSource.dbConn) ? dataSource.dbConn : [])
    .find(c => c && c.defKey === connKey);
  return dialectOfConn(conn, supports.filter(s => s && typeof s === 'object'));
};

// ---------------------------------------------------------------- statements

// Rows per INSERT. SQL Server takes at most 1000 rows in one VALUES list. Oracle has no
// multi-row VALUES before 23c and INSERT ALL gets slow and has its own limits, so it is
// one statement per row. Standard SQL: one row per statement unless asked for.
const ROW_LIMIT = {
  mssql: 1000, mysql: 500, postgresql: 1000, oracle: 1, generic: 500,
};
const ROW_DEFAULT = {
  mssql: 1000, mysql: 500, postgresql: 1000, oracle: 1, generic: 1,
};
// A statement is closed early at this size: max_allowed_packet of MySQL was 1 MB once.
const STATEMENT_CHARS = 200000;
// SQL*Plus refuses input lines above 2499 characters: longer Oracle statements are
// written with one value per line.
const ORACLE_LINE = 2000;

export const rowsPerStatement = (dialect, multiRow) => {
  const limit = ROW_LIMIT[checkDialect(dialect)];
  if (multiRow === false) {
    return 1;
  }
  if (multiRow === true) {
    return limit;
  }
  if (typeof multiRow === 'number' && multiRow >= 1) {
    return Math.min(Math.floor(multiRow), limit);
  }
  return ROW_DEFAULT[dialect];
};

const columnsOf = table => (table && Array.isArray(table.columns) ? table.columns : []);

const wrap = (items, indent, width) => {
  const lines = [];
  let line = '';
  items.forEach((item, i) => {
    const piece = i < items.length - 1 ? `${item},` : item;
    if (line && line.length + piece.length + 1 > width) {
      lines.push(line);
      line = '';
    }
    line = line ? `${line} ${piece}` : piece;
  });
  return lines.concat(line).map(l => `${indent}${l}`).join('\n');
};

const rowValues = (columns, row, dialect) => columns
  .map((column, i) => sqlLiteral(row ? row[i] : null, column, dialect));

// MySQL: the client may be told to go on after an error (mysql --force, "continue on error"
// in a GUI) and would then reach the COMMIT with half of the data. The script therefore
// counts the rows it wrote in this variable and commits only when none is missing.
export const MYSQL_ROWS = '@mypd_rows';
const counted = (dialect, options) => (dialect === 'mysql' && options && options.count
  ? `SET ${MYSQL_ROWS} = ${MYSQL_ROWS} + ROW_COUNT();\n` : '');

// A table of which every column is filled by the database.
const defaultRows = (name, rows, dialect, options) => {
  if (dialect === 'oracle') {
    return `-- ${rows.length} rows of ${name} not written: no column to insert\n`;
  }
  const one = dialect === 'mysql' ? `INSERT INTO ${name} () VALUES ();\n${counted(dialect, options)}`
    : `INSERT INTO ${name} DEFAULT VALUES;\n`;
  return one.repeat(rows.length);
};

const oracleInsert = (name, columnNames, values) => {
  const short = `INSERT INTO ${name} (${columnNames.join(', ')}) VALUES (${values.join(', ')});`;
  if (short.length <= ORACLE_LINE && short.indexOf('\n') < 0) {
    return `${short}\n`;
  }
  return `INSERT INTO ${name} (\n${wrap(columnNames, '  ', 1000)}\n) VALUES (\n  ${
    values.join(',\n  ')}\n);\n`;
};

// INSERT statements for a batch of rows of one table, each line ends with a line feed.
// options = { multiRow, count }; count: MySQL only, see MYSQL_ROWS.
export const insertStatements = (table, rows, dialect, options = {}) => {
  checkDialect(dialect);
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    return '';
  }
  const columns = columnsOf(table);
  const name = quoteTable(table.defKey, dialect);
  if (columns.length === 0) {
    return defaultRows(name, list, dialect, options);
  }
  const columnNames = columns.map(c => quoteName(c.defKey, dialect));
  if (dialect === 'oracle') {
    return list.map(row => oracleInsert(name, columnNames, rowValues(columns, row, dialect)))
      .join('');
  }
  const head = `INSERT INTO ${name} (${columnNames.join(', ')}) VALUES`;
  const perStatement = rowsPerStatement(dialect, options.multiRow);
  const count = counted(dialect, options);
  if (perStatement === 1) {
    return list.map(row => `${head} (${rowValues(columns, row, dialect).join(', ')});\n${count}`)
      .join('');
  }
  const out = [];
  let lines = [];
  let size = 0;
  const flush = () => {
    if (lines.length) {
      out.push(`${head}\n${lines.join(',\n')};\n${count}`);
      lines = [];
      size = 0;
    }
  };
  list.forEach((row) => {
    const line = `  (${rowValues(columns, row, dialect).join(', ')})`;
    if (lines.length >= perStatement || (lines.length && size + line.length > STATEMENT_CHARS)) {
      flush();
    }
    lines.push(line);
    size += line.length + 2;
  });
  flush();
  return out.join('');
};

// ---------------------------------------------------------------- around a table

// eslint-disable-next-line no-control-regex
const comment = value => text(value).replace(/[\u0000-\u001F\u007F]+/g, ' ');

const identityColumns = table => columnsOf(table).filter(c => c && c.autoIncrement);

export const writesIdentity = table => identityColumns(table).length > 0;

// Before the rows of a table. SQL Server only accepts a value for an IDENTITY column
// while IDENTITY_INSERT is on for that table (one table per session at a time).
export const tablePrelude = (table, dialect) => {
  checkDialect(dialect);
  if (dialect === 'mssql' && writesIdentity(table)) {
    return `SET IDENTITY_INSERT ${quoteTable(table.defKey, dialect)} ON;\n`;
  }
  return '';
};

// After the rows of a table.
export const tableEpilogue = (table, dialect) => {
  checkDialect(dialect);
  const identity = identityColumns(table);
  if (identity.length === 0) {
    return '';
  }
  const name = quoteTable(table.defKey, dialect);
  if (dialect === 'mssql') {
    return `SET IDENTITY_INSERT ${name} OFF;\n`;
  }
  if (dialect === 'postgresql') {
    // The sequence of a SERIAL column does not follow explicit values: move it behind
    // the highest one. Nothing happens when the column owns no sequence (setval of NULL).
    // The first argument is read as an identifier, the second one as it is written.
    return identity.filter(c => !c.kind || c.kind === 'int').map((c) => {
      const column = quoteName(c.defKey, dialect);
      return `SELECT setval(pg_get_serial_sequence(${sqlLiteral(name, null, dialect)}, ${
        sqlLiteral(foldName(c.defKey, dialect), null, dialect)}), `
        + `(SELECT GREATEST(MAX(${column}), 1) FROM ${name}));\n`;
    }).join('');
  }
  if (dialect === 'oracle') {
    const flat = comment(name);
    return identity.map(c => comment(quoteName(c.defKey, dialect))).map(column => `-- ${
      flat}.${column} was written with explicit values (a GENERATED ALWAYS column refuses `
      + 'them). An identity\n-- column does not move forward by itself: see the end of the '
      + 'script.\n').join('');
  }
  return '';
};

// ---------------------------------------------------------------- around the file

export const GENERIC_NOTICE = '-- Standard SQL. This database type is not one the generator '
  + 'knows (SQL Server, MySQL,\n-- PostgreSQL, Oracle): the script is UNVERIFIED for it. '
  + 'Check literals, quoting and\n-- auto increment columns, and run it inside a '
  + 'transaction if your tool can.\n';

const useGo = (dialect, options) => dialect === 'mssql' && (options || {}).go !== false;

// One batch of statements. SQL Server: a file of a million rows cannot be one batch, so
// batches end with GO (sqlcmd, SSMS, Azure Data Studio, DBeaver). After a failed batch
// the transaction is gone (XACT_ABORT) and the client would go on with the next batch in
// autocommit mode: every batch therefore switches itself off when no transaction is open.
export const sqlBatch = (sql, dialect, options) => {
  if (!sql) {
    return '';
  }
  return useGo(dialect, options) ? `IF @@TRANCOUNT = 0 SET NOEXEC ON;\n${sql}GO\n` : sql;
};

// First statements of a script: character set and the transaction that keeps a failed
// run from leaving half of the data.
export const sqlFilePrelude = (dialect, options) => {
  checkDialect(dialect);
  if (dialect === 'mssql') {
    // sqlcmd switches QUOTED_IDENTIFIER off, and then every INSERT into a table with a
    // filtered index, an indexed view or an indexed computed column is refused (Msg 1934)
    return `SET NOCOUNT ON;\nSET QUOTED_IDENTIFIER ON;\nSET XACT_ABORT ON;\nBEGIN TRANSACTION;\n${
      useGo(dialect, options) ? 'GO\n' : ''}`;
  }
  if (dialect === 'mysql') {
    // an explicit 0 in an AUTO_INCREMENT column would be replaced with the next number
    return `SET NAMES utf8mb4;\nSET @mypd_sql_mode = @@SESSION.sql_mode;\n`
      + "SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), "
      + `'NO_AUTO_VALUE_ON_ZERO');\nSET ${MYSQL_ROWS} = 0;\nSTART TRANSACTION;\n`;
  }
  if (dialect === 'postgresql') {
    return "SET client_encoding = 'UTF8';\nBEGIN;\n";
  }
  if (dialect === 'oracle') {
    // SQL*Plus / SQLcl / SQL Developer commands: no substitution of &name, blank lines
    // allowed, stop and roll back at the first error. Oracle opens the transaction itself.
    return 'SET DEFINE OFF\nSET SQLBLANKLINES ON\nSET FEEDBACK OFF\n'
      + 'WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK\n';
  }
  return '';
};

// MySQL: commit when every row arrived (options.rows, counted in MYSQL_ROWS by statements
// written with the `count` option), else roll back and say so.
const mysqlEnd = (options) => {
  const rows = (options || {}).rows;
  const restore = 'SET SESSION sql_mode = @mypd_sql_mode;\n';
  if (!Number.isInteger(rows) || rows < 0) {
    return `COMMIT;\n${restore}`;
  }
  const ok = `${MYSQL_ROWS} = ${rows}`;
  return `SET @mypd_end = IF(${ok}, 'COMMIT', 'ROLLBACK');\nPREPARE mypd_end FROM @mypd_end;\n`
    + `EXECUTE mypd_end;\nDEALLOCATE PREPARE mypd_end;\n${restore}`
    + `SELECT IF(${ok}, 'Test data written: ${rows} rows', CONCAT('Test data was NOT written: `
    + `a statement failed and everything was rolled back (', ${MYSQL_ROWS}, ' of ${rows} rows `
    + "arrived)')) AS result;\n";
};

// Oracle: an identity column does not follow explicit values. Moving it is DDL, which
// commits, so it stands behind the COMMIT. identity = [{table, columns: [defKey]}]
const oracleIdentities = (identity) => {
  const list = (identity || []).filter(t => t && (t.columns || []).length);
  if (list.length === 0) {
    return '';
  }
  const alters = list.map((t) => {
    const name = quoteTable(t.table, 'oracle');
    return t.columns.map(c => `  BEGIN\n    EXECUTE IMMEDIATE '${
      `ALTER TABLE ${name} MODIFY ${quoteName(c, 'oracle')} `.replace(/'/g, "''")
    }GENERATED AS IDENTITY (START WITH LIMIT VALUE)';\n  EXCEPTION WHEN OTHERS THEN NULL;\n`
      + '  END;\n').join('');
  }).join('');
  return '\n-- Identity columns that were written with explicit values start behind the highest '
    + 'one from now on\n-- (12.2 or later). A column that is no identity, for instance one fed '
    + 'by a sequence and a trigger,\n-- is left alone: move that sequence yourself.\n'
    + `BEGIN\n${alters}END;\n/\n`;
};

// options = { go, rows, identity }: rows (MySQL) and identity (Oracle) are known to the
// writer only when the last table is done.
export const sqlFileEpilogue = (dialect, options) => {
  checkDialect(dialect);
  if (dialect === 'mssql') {
    if (!useGo(dialect, options)) {
      return 'COMMIT TRANSACTION;\n';
    }
    return 'SET NOEXEC OFF;\nGO\nIF @@TRANCOUNT > 0 COMMIT TRANSACTION;\n'
      + "ELSE RAISERROR(N'Test data was not written: a statement failed and everything "
      + "was rolled back.', 16, 1);\nGO\n";
  }
  if (dialect === 'mysql') {
    return mysqlEnd(options);
  }
  if (dialect === 'oracle') {
    return `COMMIT;\n${oracleIdentities((options || {}).identity)}`;
  }
  return dialect === 'generic' ? '' : 'COMMIT;\n';
};

// Comment at the top of a script. info = { generator, generatedAt, tables: [{name, rows}] }
// Without generatedAt no time is written, so the same data gives the same file.
export const sqlFileHeader = (dialect, info = {}) => {
  checkDialect(dialect);
  const tables = info.tables || [];
  const total = tables.reduce((sum, t) => sum + (t.rows || 0), 0);
  const lines = [
    `Test data generated by ${comment(info.generator || 'MyPD')}`,
    `Dialect: ${DIALECT_NAMES[dialect]} (${dialect})`,
    'Encoding: UTF-8',
  ];
  if (info.generatedAt) {
    lines.push(`Generated at: ${comment(info.generatedAt)}`);
  }
  lines.push(`Tables: ${tables.length}, rows: ${total} (in insert order, parents first)`);
  tables.forEach(t => lines.push(`  ${comment(t.name)}: ${t.rows || 0} rows`));
  return `${dialect === 'generic' ? GENERIC_NOTICE : ''}${lines.map(l => `-- ${l}\n`).join('')}`;
};

export const tableComment = table => `\n-- ${comment(tableParts(table.defKey).join('.'))} (${
  columnsOf(table).length} columns)\n`;
