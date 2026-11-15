import fs from 'fs';
import path from 'path';
import {
  DIALECTS, GENERIC_NOTICE, dialectOf, dialectOfName, insertStatements, quoteName, quoteTable,
  rowsPerStatement, sqlBatch, sqlFileEpilogue, sqlFileHeader, sqlFilePrelude, sqlLiteral,
  tableEpilogue, tablePrelude,
} from '../src/lib/testdata/sql';

const template = name => JSON.parse(fs.readFileSync(
  path.join(__dirname, '../src/lib/template', name), 'utf8'));

const NUL = String.fromCharCode(0);

// ---------------------------------------------------------------- dialect of a project

describe('dialectOf', () => {
  const project = template('empty.json');
  const withDb = (defKey) => {
    const support = project.profile.dataTypeSupports.find(s => s.defKey === defKey);
    return {
      ...project,
      profile: { ...project.profile, default: { ...project.profile.default, db: support.id } },
    };
  };

  test('the database types of the project templates', () => {
    expect(dialectOf(project)).toBe('mysql');
    expect(dialectOf(template('教学管理系统.pdma.json'))).toBe('mysql');
    expect(dialectOf(withDb('MYSQL'))).toBe('mysql');
    expect(dialectOf(withDb('ORACLE'))).toBe('oracle');
    expect(dialectOf(withDb('SQLServer'))).toBe('mssql');
    expect(dialectOf(withDb('PostgreSQL'))).toBe('postgresql');
    ['DB2', 'DM', 'GaussDB', 'Kingbase', 'SQLite', 'Hive', 'JAVA', 'C#', 'Doris', 'HighGo']
      .forEach(key => expect([key, dialectOf(withDb(key))]).toEqual([key, 'generic']));
  });

  test('names are read whatever their case, separators and version', () => {
    const names = {
      mssql: ['MSSQL', 'mssql', 'SQLServer', 'sql server', 'SQL_Server', 'SqlServer2019',
        'MS SQL Server', 'Microsoft SQL Server', 'T-SQL'],
      mysql: ['MYSQL', 'MySql', 'mysql8', 'MySQL 5.7', 'MariaDB', 'mariadb-10'],
      postgresql: ['PostgreSQL', 'postgresql', 'Postgres', 'PG', 'pgsql', 'PostgreSQL 15'],
      oracle: ['ORACLE', 'Oracle', 'oracle11g', 'Oracle 19c', 'ora'],
      generic: ['', null, undefined, 'DB2', 'SQLite', 'DM', 'H2', 'JAVA', 'mysqlish', 42],
    };
    Object.keys(names).forEach(dialect => names[dialect]
      .forEach(name => expect([name, dialectOfName(name)]).toEqual([name, dialect])));
  });

  test('an unknown database type falls back to the default connection', () => {
    const conn = (properties, type) => ({
      profile: {
        default: { db: 'x', dbConn: 'c1' },
        dataTypeSupports: [{ id: 'x', defKey: 'JAVA' }, { id: 'o', defKey: 'ORACLE' }],
      },
      dbConn: [{ defKey: 'other', properties: { url: 'jdbc:mysql://h/db' } },
        { defKey: 'c1', type, properties }],
    });
    expect(dialectOf(conn({ url: 'jdbc:sqlserver://h:1433;DatabaseName=a' }))).toBe('mssql');
    expect(dialectOf(conn({ url: ' JDBC:MariaDB://h/db' }))).toBe('mysql');
    expect(dialectOf(conn({ url: 'jdbc:postgresql://h/db' }))).toBe('postgresql');
    expect(dialectOf(conn({ url: 'jdbc:oracle:thin:@h:1521/x' }))).toBe('oracle');
    expect(dialectOf(conn({ driver_class_name: 'com.microsoft.sqlserver.jdbc.SQLServerDriver' })))
      .toBe('mssql');
    expect(dialectOf(conn({ url: 'jdbc:db2://h/db' }, 'o'))).toBe('oracle');
    expect(dialectOf(conn({ url: 'jdbc:db2://h/db' }))).toBe('generic');
    expect(dialectOf(conn(undefined))).toBe('generic');
  });

  test('the type of the project wins over the connection', () => {
    expect(dialectOf({
      profile: {
        default: { db: 'p', dbConn: 'c1' },
        dataTypeSupports: [{ id: 'p', defKey: 'PostgreSQL' }],
      },
      dbConn: [{ defKey: 'c1', properties: { url: 'jdbc:mysql://h/db' } }],
    })).toBe('postgresql');
  });

  test('a project without profile is standard SQL', () => {
    [undefined, null, {}, { profile: {} }, { profile: { default: {} } },
      { profile: { default: { db: 'gone' }, dataTypeSupports: [] } }]
      .forEach(ds => expect(dialectOf(ds)).toBe('generic'));
    expect(dialectOf({ profile: { default: { db: 'MSSQL' } } })).toBe('mssql');
  });
});

// ---------------------------------------------------------------- identifiers

describe('identifiers', () => {
  test('each dialect has its quotes and doubles them inside a name', () => {
    expect(quoteName('order', 'mssql')).toBe('[order]');
    expect(quoteName('a]b', 'mssql')).toBe('[a]]b]');
    expect(quoteName('a[b', 'mssql')).toBe('[a[b]');
    expect(quoteName('order', 'mysql')).toBe('`order`');
    expect(quoteName('a`b', 'mysql')).toBe('`a``b`');
    expect(quoteName('a"b', 'postgresql')).toBe('"a""b"');
    expect(quoteName('a"b c', 'generic')).toBe('"a""b c"');
  });

  test('a name the DDL wrote without quotes is folded as the database folded it', () => {
    // the templates write CREATE TABLE ORDERS / Orders unquoted
    expect(quoteName('Orders', 'oracle')).toBe('"ORDERS"');
    expect(quoteName('order_id$#', 'oracle')).toBe('"ORDER_ID$#"');
    expect(quoteName('Orders', 'postgresql')).toBe('"orders"');
    expect(quoteName('USER', 'postgresql')).toBe('"user"');
    expect(quoteName('订单Tab', 'postgresql')).toBe('"订单tab"');
    expect(quoteName('订单Tab', 'oracle')).toBe('"订单TAB"');
    // SQL Server and MySQL keep the name
    expect(quoteName('Orders', 'mssql')).toBe('[Orders]');
    expect(quoteName('Orders', 'mysql')).toBe('`Orders`');
  });

  test('a name that only exists quoted keeps its case', () => {
    expect(quoteName('Order Detail', 'oracle')).toBe('"Order Detail"');
    expect(quoteName('1st', 'oracle')).toBe('"1st"');
    expect(quoteName('_x', 'oracle')).toBe('"_x"');
    expect(quoteName('Order Detail', 'postgresql')).toBe('"Order Detail"');
    expect(quoteName('a"b', 'oracle')).toBe('"AB"');
  });

  test('standard SQL leaves a plain name alone and quotes the rest', () => {
    expect(quoteName('Orders', 'generic')).toBe('Orders');
    expect(quoteName('order id', 'generic')).toBe('"order id"');
    expect(quoteName('订单', 'generic')).toBe('"订单"');
    expect(quoteName('1a', 'generic')).toBe('"1a"');
    expect(quoteName('a;drop', 'generic')).toBe('"a;drop"');
    // a reserved word can only be the name of a column that was created quoted
    expect(quoteName('order', 'generic')).toBe('"order"');
    expect(quoteName('User', 'generic')).toBe('"User"');
    expect(quoteName('orders', 'generic')).toBe('orders');
  });

  test('a table name with a schema is quoted part by part', () => {
    expect(quoteTable('dbo.Orders', 'mssql')).toBe('[dbo].[Orders]');
    expect(quoteTable('db.sales.Orders', 'mssql')).toBe('[db].[sales].[Orders]');
    expect(quoteTable('Sales.Orders', 'oracle')).toBe('"SALES"."ORDERS"');
    expect(quoteTable('shop.orders', 'mysql')).toBe('`shop`.`orders`');
    expect(quoteTable('a..b', 'mysql')).toBe('`a..b`');
    expect(quoteTable('a.b.c.d', 'mysql')).toBe('`a.b.c.d`');
  });

  test('no name, no statement', () => {
    ['', '  ', null, undefined, NUL].forEach((name) => {
      expect(() => quoteName(name, 'mysql')).toThrow('testdata.sql.emptyName');
    });
    expect(() => quoteName('"', 'oracle')).toThrow('testdata.sql.emptyName');
    expect(() => quoteName('a', 'sybase')).toThrow('testdata.sql.dialect');
    expect(() => sqlLiteral(1, null, 'sybase')).toThrow('testdata.sql.dialect');
    expect(quoteName(`a${NUL}b`, 'mssql')).toBe('[ab]');
  });
});

// ---------------------------------------------------------------- statements

const orders = {
  entityId: 'e1',
  defKey: 'Orders',
  columns: [
    { defKey: 'Id', kind: 'int', autoIncrement: true },
    { defKey: 'Name', kind: 'string' },
    { defKey: 'Amount', kind: 'decimal' },
    { defKey: 'Created', kind: 'datetime' },
    { defKey: 'Paid', kind: 'bool' },
  ],
};
const twoRows = [
  [1, "O'Brien", 12.5, '2024-01-31 10:00:00', true],
  [2, null, -3, null, false],
];
const plain = { defKey: 'T', columns: [{ defKey: 'A', kind: 'int' }] };
const numbered = n => Array.from({ length: n }, (v, i) => [i + 1]);
const statementsOf = sql => sql.split(/;\n/).filter(s => s.trim());

describe('insertStatements', () => {
  test('SQL Server', () => {
    expect(insertStatements(orders, twoRows, 'mssql')).toBe(
      'INSERT INTO [Orders] ([Id], [Name], [Amount], [Created], [Paid]) VALUES\n'
      + "  (1, N'O''Brien', 12.5, '2024-01-31T10:00:00', 1),\n"
      + '  (2, NULL, -3, NULL, 0);\n',
    );
  });

  test('MySQL', () => {
    expect(insertStatements(orders, twoRows, 'mysql')).toBe(
      'INSERT INTO `Orders` (`Id`, `Name`, `Amount`, `Created`, `Paid`) VALUES\n'
      + "  (1, 'O''Brien', 12.5, '2024-01-31 10:00:00', 1),\n"
      + '  (2, NULL, -3, NULL, 0);\n',
    );
  });

  test('PostgreSQL', () => {
    expect(insertStatements(orders, twoRows, 'postgresql')).toBe(
      'INSERT INTO "orders" ("id", "name", "amount", "created", "paid") VALUES\n'
      + "  (1, 'O''Brien', 12.5, '2024-01-31 10:00:00', TRUE),\n"
      + '  (2, NULL, -3, NULL, FALSE);\n',
    );
  });

  test('Oracle writes one statement per row', () => {
    expect(insertStatements(orders, twoRows, 'oracle', { multiRow: true })).toBe(
      'INSERT INTO "ORDERS" ("ID", "NAME", "AMOUNT", "CREATED", "PAID") VALUES '
      + "(1, 'O''Brien', 12.5, TIMESTAMP '2024-01-31 10:00:00', 1);\n"
      + 'INSERT INTO "ORDERS" ("ID", "NAME", "AMOUNT", "CREATED", "PAID") VALUES '
      + '(2, NULL, -3, NULL, 0);\n',
    );
  });

  test('standard SQL writes one statement per row unless asked', () => {
    expect(insertStatements(orders, twoRows, 'generic')).toBe(
      'INSERT INTO Orders (Id, Name, Amount, Created, Paid) VALUES '
      + "(1, 'O''Brien', 12.5, '2024-01-31 10:00:00', 1);\n"
      + 'INSERT INTO Orders (Id, Name, Amount, Created, Paid) VALUES (2, NULL, -3, NULL, 0);\n',
    );
    expect(statementsOf(insertStatements(orders, twoRows, 'generic', { multiRow: true })))
      .toHaveLength(1);
  });

  test('no rows, no statement', () => {
    DIALECTS.forEach((d) => {
      expect(insertStatements(orders, [], d)).toBe('');
      expect(insertStatements(orders, undefined, d)).toBe('');
    });
  });

  test('rows per statement', () => {
    expect(DIALECTS.map(d => rowsPerStatement(d))).toEqual([1000, 500, 1000, 1, 1]);
    expect(DIALECTS.map(d => rowsPerStatement(d, true))).toEqual([1000, 500, 1000, 1, 500]);
    expect(DIALECTS.map(d => rowsPerStatement(d, false))).toEqual([1, 1, 1, 1, 1]);
    expect(DIALECTS.map(d => rowsPerStatement(d, 5000))).toEqual([1000, 500, 1000, 1, 500]);
    expect(DIALECTS.map(d => rowsPerStatement(d, 50))).toEqual([50, 50, 50, 1, 50]);
  });

  test('SQL Server never gets more than 1000 rows in one VALUES list', () => {
    const rowsIn = sql => statementsOf(sql).map(s => s.split('\n').length - 1);
    expect(rowsIn(insertStatements(plain, numbered(2500), 'mssql'))).toEqual([1000, 1000, 500]);
    expect(rowsIn(insertStatements(plain, numbered(2500), 'mssql', { multiRow: 100000 })))
      .toEqual([1000, 1000, 500]);
    expect(rowsIn(insertStatements(plain, numbered(1001), 'mssql', { multiRow: true })))
      .toEqual([1000, 1]);
    expect(rowsIn(insertStatements(plain, numbered(1200), 'mysql'))).toEqual([500, 500, 200]);
    expect(rowsIn(insertStatements(plain, numbered(7), 'postgresql', { multiRow: 3 })))
      .toEqual([3, 3, 1]);
    expect(statementsOf(insertStatements(plain, numbered(7), 'mssql', { multiRow: false })))
      .toHaveLength(7);
    expect(statementsOf(insertStatements(plain, numbered(1500), 'oracle'))).toHaveLength(1500);
  });

  test('a statement is closed before it grows beyond 200,000 characters', () => {
    const wide = { defKey: 'T', columns: [{ defKey: 'A', kind: 'string' }] };
    const rows = Array.from({ length: 100 }, () => ['x'.repeat(30000)]);
    const all = statementsOf(insertStatements(wide, rows, 'mysql'));
    expect(all.length).toBeGreaterThan(10);
    all.forEach(s => expect(s.length).toBeLessThan(200200));
    expect(all.reduce((n, s) => n + s.split('\n').length - 1, 0)).toBe(100);
  });

  test('a long Oracle statement is spread over lines SQL*Plus accepts', () => {
    const wide = {
      defKey: 'Wide',
      columns: Array.from({ length: 300 }, (v, i) => ({ defKey: `Column_${i}`, kind: 'string' })),
    };
    const row = wide.columns.map((c, i) => (i === 7 ? '中'.repeat(3000) : `value ${i}`));
    const sql = insertStatements(wide, [row], 'oracle');
    sql.split('\n').forEach(line => expect(line.length).toBeLessThan(2499));
    expect(sql.trimEnd().split('\n').some(line => line.trim() === '')).toBe(false);
    expect(sql.startsWith('INSERT INTO "WIDE" (\n  "COLUMN_0", "COLUMN_1",')).toBe(true);
    expect(sql.endsWith("  'value 299'\n);\n")).toBe(true);
    // no line ends with something SQL*Plus takes as the end or a continuation
    sql.trimEnd().split('\n').slice(0, -1)
      .forEach(line => expect(line).not.toMatch(/[;-]$/));
  });

  test('a missing value is NULL, a value too many is ignored', () => {
    expect(insertStatements(orders, [[9]], 'generic')).toBe(
      'INSERT INTO Orders (Id, Name, Amount, Created, Paid) VALUES (9, NULL, NULL, NULL, NULL);\n',
    );
    expect(insertStatements(plain, [[1, 2, 3]], 'generic')).toBe('INSERT INTO T (A) VALUES (1);\n');
  });

  test('a table whose columns are all filled by the database', () => {
    const none = { defKey: 'T', columns: [] };
    expect(insertStatements(none, [[], []], 'mssql'))
      .toBe('INSERT INTO [T] DEFAULT VALUES;\nINSERT INTO [T] DEFAULT VALUES;\n');
    expect(insertStatements(none, [[]], 'mysql')).toBe('INSERT INTO `T` () VALUES ();\n');
    expect(insertStatements(none, [[]], 'oracle')).toMatch(/^-- 1 rows of "T" not written/);
  });

  test('odd names cannot leave their quotes', () => {
    const odd = { defKey: 'a];DROP TABLE x;--', columns: [{ defKey: 'c`d"e', kind: 'int' }] };
    expect(insertStatements(odd, [[1]], 'mssql', { multiRow: false }))
      .toBe('INSERT INTO [a]];DROP TABLE x;--] ([c`d"e]) VALUES (1);\n');
    expect(insertStatements(odd, [[1]], 'mysql', { multiRow: false }))
      .toBe('INSERT INTO `a];DROP TABLE x;--` (`c``d"e`) VALUES (1);\n');
    expect(insertStatements(odd, [[1]], 'postgresql', { multiRow: false }))
      .toBe('INSERT INTO "a];DROP TABLE x;--" ("c`d""e") VALUES (1);\n');
  });
});

// ---------------------------------------------------------------- around table and file

describe('tablePrelude and tableEpilogue', () => {
  const noIdentity = { defKey: 'Orders', columns: orders.columns.slice(1) };

  test('SQL Server switches IDENTITY_INSERT on for a table that writes its identity', () => {
    expect(tablePrelude(orders, 'mssql')).toBe('SET IDENTITY_INSERT [Orders] ON;\n');
    expect(tableEpilogue(orders, 'mssql')).toBe('SET IDENTITY_INSERT [Orders] OFF;\n');
    expect(tablePrelude({ ...orders, defKey: 'dbo.Orders' }, 'mssql'))
      .toBe('SET IDENTITY_INSERT [dbo].[Orders] ON;\n');
    expect(tablePrelude(noIdentity, 'mssql')).toBe('');
    expect(tableEpilogue(noIdentity, 'mssql')).toBe('');
  });

  test('PostgreSQL moves the sequence behind the ids it was given', () => {
    expect(tablePrelude(orders, 'postgresql')).toBe('');
    expect(tableEpilogue(orders, 'postgresql')).toBe(
      'SELECT setval(pg_get_serial_sequence(\'"orders"\', \'id\'), '
      + '(SELECT GREATEST(MAX("id"), 1) FROM "orders"));\n',
    );
    const odd = { defKey: "s.It's", columns: [{ defKey: 'My Id', kind: 'int', autoIncrement: true }] };
    expect(tableEpilogue(odd, 'postgresql')).toBe(
      'SELECT setval(pg_get_serial_sequence(\'"s"."It\'\'s"\', \'My Id\'), '
      + '(SELECT GREATEST(MAX("My Id"), 1) FROM "s"."It\'s"));\n',
    );
    expect(tableEpilogue(noIdentity, 'postgresql')).toBe('');
  });

  test('MySQL and standard SQL need nothing', () => {
    ['mysql', 'generic'].forEach((d) => {
      expect(tablePrelude(orders, d)).toBe('');
      expect(tableEpilogue(orders, d)).toBe('');
    });
  });

  test('Oracle gets a comment about the identity column', () => {
    expect(tablePrelude(orders, 'oracle')).toBe('');
    const note = tableEpilogue(orders, 'oracle');
    note.trimEnd().split('\n').forEach(line => expect(line.startsWith('-- ')).toBe(true));
    expect(note).toContain('"ORDERS"."ID" was written with explicit values');
    expect(tableEpilogue(noIdentity, 'oracle')).toBe('');
  });
});

describe('around the file', () => {
  // found against real databases (Docker): see tests/testdata_db_docker.test.js
  test('SQL Server: QUOTED_IDENTIFIER is on before the first INSERT (sqlcmd switches it off)', () => {
    // without it a table with a filtered index refuses every INSERT with Msg 1934
    const lines = sqlFilePrelude('mssql').split('\n');
    expect(lines.indexOf('SET QUOTED_IDENTIFIER ON;')).toBeGreaterThan(-1);
    expect(lines.indexOf('SET QUOTED_IDENTIFIER ON;')).toBeLessThan(lines.indexOf('BEGIN TRANSACTION;'));
  });

  test('MySQL: rows are counted and the script commits only when none is missing', () => {
    const t = {
      defKey: 'T',
      columns: [{ defKey: 'A', kind: 'int' }],
    };
    const count = 'SET @mypd_rows = @mypd_rows + ROW_COUNT();\n';
    expect(insertStatements(t, [[1], [2], [3]], 'mysql', { multiRow: 2, count: true }))
      .toBe(`INSERT INTO \`T\` (\`A\`) VALUES\n  (1),\n  (2);\n${count}`
        + `INSERT INTO \`T\` (\`A\`) VALUES\n  (3);\n${count}`);
    expect(insertStatements(t, [[1], [2]], 'mysql', { multiRow: false, count: true }))
      .toBe(`INSERT INTO \`T\` (\`A\`) VALUES (1);\n${count}INSERT INTO \`T\` (\`A\`) VALUES (2);\n${count}`);
    expect(insertStatements({ defKey: 'T', columns: [] }, [[], []], 'mysql', { count: true }))
      .toBe(`INSERT INTO \`T\` () VALUES ();\n${count}`.repeat(2));
    // not asked for, and never for another database
    expect(insertStatements(t, [[1]], 'mysql')).not.toContain('@mypd_rows');
    expect(insertStatements(t, [[1]], 'postgresql', { count: true })).not.toContain('@mypd_rows');
    const end = sqlFileEpilogue('mysql', { rows: 3 });
    expect(end).toContain("SET @mypd_end = IF(@mypd_rows = 3, 'COMMIT', 'ROLLBACK');\n"
      + 'PREPARE mypd_end FROM @mypd_end;\nEXECUTE mypd_end;\nDEALLOCATE PREPARE mypd_end;\n');
    expect(end).not.toMatch(/^COMMIT;$/m);
    expect(end).toContain('was NOT written');
  });

  test('MySQL: an explicit 0 in an AUTO_INCREMENT column is kept', () => {
    expect(sqlFilePrelude('mysql')).toContain('NO_AUTO_VALUE_ON_ZERO');
    expect(sqlFileEpilogue('mysql', { rows: 1 })).toContain('SET SESSION sql_mode = @mypd_sql_mode;');
  });

  test('Oracle: identity columns are moved behind the COMMIT, errors swallowed', () => {
    const end = sqlFileEpilogue('oracle', {
      identity: [{ table: 'hr.Orders', columns: ['Id'] }, { table: 'Empty', columns: [] }],
    });
    expect(end).toBe('COMMIT;\n\n'
      + '-- Identity columns that were written with explicit values start behind the highest '
      + 'one from now on\n-- (12.2 or later). A column that is no identity, for instance one fed '
      + 'by a sequence and a trigger,\n-- is left alone: move that sequence yourself.\n'
      + 'BEGIN\n  BEGIN\n    EXECUTE IMMEDIATE \'ALTER TABLE "HR"."ORDERS" MODIFY "ID" '
      + 'GENERATED AS IDENTITY (START WITH LIMIT VALUE)\';\n  EXCEPTION WHEN OTHERS THEN NULL;\n'
      + '  END;\nEND;\n/\n');
    expect(sqlFileEpilogue('oracle', { identity: [] })).toBe('COMMIT;\n');
    // a quote in a name cannot end the string of EXECUTE IMMEDIATE
    expect(sqlFileEpilogue('oracle', { identity: [{ table: "O'x", columns: ['ID'] }] }))
      .toContain("'ALTER TABLE \"O''x\" MODIFY \"ID\" GENERATED");
  });

  test('every database but the unknown one runs the script in a transaction', () => {
    expect(sqlFilePrelude('mssql'))
      .toBe('SET NOCOUNT ON;\nSET QUOTED_IDENTIFIER ON;\nSET XACT_ABORT ON;\nBEGIN TRANSACTION;\nGO\n');
    expect(sqlFileEpilogue('mssql')).toMatch(
      /^SET NOEXEC OFF;\nGO\nIF @@TRANCOUNT > 0 COMMIT TRANSACTION;\nELSE RAISERROR\(.*\);\nGO\n$/,
    );
    expect(sqlFilePrelude('mssql', { go: false }))
      .toBe('SET NOCOUNT ON;\nSET QUOTED_IDENTIFIER ON;\nSET XACT_ABORT ON;\nBEGIN TRANSACTION;\n');
    expect(sqlFileEpilogue('mssql', { go: false })).toBe('COMMIT TRANSACTION;\n');
    expect(sqlFilePrelude('mysql')).toBe('SET NAMES utf8mb4;\n'
      + 'SET @mypd_sql_mode = @@SESSION.sql_mode;\n'
      + "SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), "
      + "'NO_AUTO_VALUE_ON_ZERO');\nSET @mypd_rows = 0;\nSTART TRANSACTION;\n");
    expect(sqlFileEpilogue('mysql')).toBe('COMMIT;\nSET SESSION sql_mode = @mypd_sql_mode;\n');
    expect(sqlFilePrelude('postgresql')).toBe("SET client_encoding = 'UTF8';\nBEGIN;\n");
    expect(sqlFileEpilogue('postgresql')).toBe('COMMIT;\n');
    expect(sqlFilePrelude('oracle')).toBe('SET DEFINE OFF\nSET SQLBLANKLINES ON\n'
      + 'SET FEEDBACK OFF\nWHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK\n');
    expect(sqlFileEpilogue('oracle')).toBe('COMMIT;\n');
    expect(sqlFilePrelude('generic')).toBe('');
    expect(sqlFileEpilogue('generic')).toBe('');
  });

  test('a SQL Server batch ends with GO and switches itself off after a failure', () => {
    expect(sqlBatch('INSERT 1;\n', 'mssql')).toBe('IF @@TRANCOUNT = 0 SET NOEXEC ON;\nINSERT 1;\nGO\n');
    expect(sqlBatch('INSERT 1;\n', 'mssql', { go: false })).toBe('INSERT 1;\n');
    expect(sqlBatch('', 'mssql')).toBe('');
    expect(sqlBatch('INSERT 1;\n', 'mysql')).toBe('INSERT 1;\n');
  });

  test('the header names the dialect and the tables, and no time unless given', () => {
    const tables = [{ name: 'Orders', rows: 500 }, { name: 'Order\nItems', rows: 1500 }];
    expect(sqlFileHeader('mssql', { tables })).toBe(
      '-- Test data generated by MyPD\n'
      + '-- Dialect: SQL Server (mssql)\n'
      + '-- Encoding: UTF-8\n'
      + '-- Tables: 2, rows: 2000 (in insert order, parents first)\n'
      + '--   Orders: 500 rows\n'
      + '--   Order Items: 1500 rows\n',
    );
    expect(sqlFileHeader('mysql', { tables: [], generator: 'X 1.0', generatedAt: '2024-01-31' }))
      .toBe('-- Test data generated by X 1.0\n-- Dialect: MySQL / MariaDB (mysql)\n'
        + '-- Encoding: UTF-8\n-- Generated at: 2024-01-31\n'
        + '-- Tables: 0, rows: 0 (in insert order, parents first)\n');
  });

  test('standard SQL starts with the remark that it is unverified', () => {
    const header = sqlFileHeader('generic', { tables: [] });
    expect(header.startsWith(GENERIC_NOTICE)).toBe(true);
    expect(header.split('\n')[0]).toMatch(/^-- Standard SQL/);
    expect(GENERIC_NOTICE).toMatch(/UNVERIFIED/);
    header.trimEnd().split('\n').forEach(line => expect(line.startsWith('-- ')).toBe(true));
    DIALECTS.filter(d => d !== 'generic')
      .forEach(d => expect(sqlFileHeader(d, {})).not.toMatch(/UNVERIFIED/));
  });
});
