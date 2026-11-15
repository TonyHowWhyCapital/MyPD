import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import {
  configure, connParams, countRows, inspectTables, jvmArgs, readKeyRows, readKeys, runQuery,
  writeBundle, CANCELLED, DEFAULT_JVM, JAVA_NOT_FOUND,
} from '../src/lib/testdata/db';

// Runs the real Java tool against a throwaway SQLite file with the driver inside the engine jar.
// Skipped when java, the jar or the sqlite3 command is not there.
const root = path.resolve(__dirname, '..');
const jar = path.join(root, 'public/jar/pdmaner-java.jar');
const tools = path.join(root, 'public/jar/tools');
const works = (cmd, args) => {
  try {
    return spawnSync(cmd, args).status === 0;
  } catch (e) {
    return false;
  }
};
const hasJava = works('java', ['-version'])
  && fs.existsSync(path.join(tools, 'mypd/TestData.class'));
const hasAll = hasJava && fs.existsSync(jar) && works('sqlite3', ['-version']);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mypd-td-test-'));
const tmpDir = path.join(work, 'tmp');
const dbFile = path.join(work, 'test.db');
const password = 'S3cret-pw-9471';
const conn = {
  defKey: 'sqlite',
  properties: {
    driver_class_name: 'org.sqlite.JDBC',
    url: `jdbc:sqlite:${dbFile}?foreign_keys=on`,
    username: 'tester',
    password,
  },
};
const sql = text => execFileSync('sqlite3', [dbFile, text]).toString().trim();
const fail = promise => promise.then(() => {
  throw new Error('expected a rejection');
}, e => e);

let bundles = 0;
const bundle = (tables) => {
  bundles += 1;
  const dir = path.join(work, `bundle${bundles}`);
  fs.mkdirSync(dir);
  const manifest = {
    version: 1,
    dialect: 'generic',
    tables: tables.map((t, i) => {
      const file = `${String(i + 1).padStart(4, '0')}.ndjson`;
      fs.writeFileSync(path.join(dir, file), t.rows.map(r => `${JSON.stringify(r)}\n`).join(''));
      return { name: t.name, file, rows: t.rows.length, columns: t.columns };
    }),
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
};
const customerColumns = [
  { name: 'ID', kind: 'int', autoIncrement: true },
  { name: 'NAME', kind: 'string' },
  { name: 'EMAIL', kind: 'string' },
  { name: 'BIRTH', kind: 'date' },
  { name: 'CREATED', kind: 'datetime' },
  { name: 'OPEN_AT', kind: 'time' },
  { name: 'ACTIVE', kind: 'bool' },
  { name: 'BALANCE', kind: 'decimal' },
  { name: 'PHOTO', kind: 'binary' },
  { name: 'BIG', kind: 'int' },
];
const customer = (id, email = `c${id}@example.com`) => [id, `name ${id}`, email, '2001-02-03',
  '2024-05-06 07:08:09', '10:11:12', id % 2 === 0, 10.5, null, null];
const orderColumns = [
  { name: 'ID', kind: 'int' },
  { name: 'CUSTOMER_ID', kind: 'int' },
  { name: 'NOTE', kind: 'string' },
];
const write = (dir, options) => writeBundle({}, {}, conn, dir, options).promise;
const counts = () => countRows({}, {}, conn, ['CUSTOMER', 'ORDERS']);

jest.setTimeout(180000);

afterAll(() => {
  fs.rmdirSync(work, { recursive: true });
});

(hasJava ? describe : describe.skip)('query check (Java, no database)', () => {
  const check = (statements) => {
    const cases = path.join(work, 'cases.json');
    const out = path.join(work, 'checked.json');
    fs.writeFileSync(cases, JSON.stringify(statements));
    execFileSync('java', ['-cp', tools, 'mypd.TestDataSqlCheck', cases, out]);
    const result = JSON.parse(fs.readFileSync(out, 'utf8'));
    fs.unlinkSync(cases);
    fs.unlinkSync(out);
    return result;
  };

  test('accepts one SELECT and sends it without comments or trailing semicolon', () => {
    const accepted = [
      ['select code from dict', 'select code from dict'],
      ['  SELECT a FROM t;  ', 'SELECT a FROM t'],
      ['SELECT a -- note\nFROM t /* x */ WHERE b = 1;', 'SELECT a  \nFROM t   WHERE b = 1'],
      ["SELECT 'it''s; DROP -- /* not code' FROM t", "SELECT 'it''s; DROP -- /* not code' FROM t"],
      ['WITH x AS (SELECT 1 AS a) SELECT a FROM x', 'WITH x AS (SELECT 1 AS a) SELECT a FROM x'],
      ['(SELECT a FROM t) UNION (SELECT b FROM u)', '(SELECT a FROM t) UNION (SELECT b FROM u)'],
      ['SELECT [Order Id], update_time, "INTO" FROM [dbo].[t]',
        'SELECT [Order Id], update_time, "INTO" FROM [dbo].[t]'],
      ['SELECT `id` FROM `t` WHERE n = N\'中文\'', 'SELECT `id` FROM `t` WHERE n = N\'中文\''],
      ['SELECT arr[1] FROM t', 'SELECT arr[1] FROM t'],
    ];
    const result = check(accepted.map(a => a[0]));
    accepted.forEach((a, i) => expect(result[i]).toEqual({ ok: true, sql: a[1] }));
  });

  test('refuses everything else', () => {
    const refused = [
      ['', 'SQL_EMPTY'],
      ['  -- only a comment', 'SQL_EMPTY'],
      ['DELETE FROM t', 'SQL_NOT_SELECT'],
      ['update t set a = 1', 'SQL_NOT_SELECT'],
      ['EXEC sp_who', 'SQL_NOT_SELECT'],
      ['SELECT 1; DROP TABLE t', 'SQL_MULTIPLE'],
      ['SELECT 1; SELECT 2', 'SQL_MULTIPLE'],
      ['SELECT * INTO backup FROM t', 'SQL_FORBIDDEN'],
      ['SELECT a FROM t FOR UPDATE', 'SQL_FORBIDDEN'],
      ['WITH d AS (DELETE FROM t RETURNING id) SELECT id FROM d', 'SQL_FORBIDDEN'],
      ['WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', 'SQL_FORBIDDEN'],
      ['WITH x AS (VALUES (1)) TABLE x', 'SQL_NOT_SELECT'],
      ['select a from t where b in (select c from u) union select d from v; truncate table t',
        'SQL_MULTIPLE'],
      ['SELECT * FROM OPENROWSET(\'x\', \'y\', \'z\')', 'SQL_FORBIDDEN'],
      ['SELECT/**/1/**/;/**/DROP/**/TABLE t', 'SQL_MULTIPLE'],
      ['SELECT 1 /* open', 'SQL_UNTERMINATED'],
      ["SELECT 'open", 'SQL_UNTERMINATED'],
      // quoting that databases read differently could hide a statement inside a "text"
      ["SELECT 'a\\' ; DROP TABLE t -- '", 'SQL_QUOTING'],
      ["SELECT $$ ' $$ ; DROP TABLE t; --'", 'SQL_QUOTING'],
      ["SELECT $tag$ ' $tag$ ; DROP TABLE t; --'", 'SQL_QUOTING'],
      ["SELECT q'[x']' FROM dual ; DROP TABLE t --'", 'SQL_QUOTING'],
      ["SELECT [a'] ; DROP TABLE t --'", 'SQL_QUOTING'],
      ["SELECT [a]]'] ; DROP TABLE t --'", 'SQL_QUOTING'],
      ["SELECT [a--]\n ' ] ; DROP TABLE t --'", 'SQL_QUOTING'],
      ["SELECT `a'` ; DROP TABLE t --'", 'SQL_QUOTING'],
      ["SELECT 1 # ' \n ; DROP TABLE t; -- '", 'SQL_QUOTING'],
      ['SELECT [a ; DROP TABLE t]', 'SQL_MULTIPLE'],
      ['SELECT `a ; DROP TABLE t`', 'SQL_MULTIPLE'],
    ];
    const result = check(refused.map(r => r[0]));
    refused.forEach((r, i) => expect([r[0], result[i]]).toEqual([r[0], { ok: false, code: r[1] }]));
  });
});

(hasJava ? describe : describe.skip)('error codes (Java, no database)', () => {
  // [dialect, SQL state, vendor code, message, expected]: what the real servers answered in
  // the Docker runs (SQL Server 2022, MySQL 8.4, PostgreSQL 16, Oracle 23)
  const cases = [
    ['mssql', 'S0001', 18456, "Login failed for user 'sa'.", 'LOGIN_FAILED'],
    ['mssql', 'S0001', 8152, 'String or binary data would be truncated.', 'VALUE_TOO_LONG'],
    ['mssql', 'S0001', 2628, 'String or binary data would be truncated in table', 'VALUE_TOO_LONG'],
    ['mssql', 'S0008', 8115, 'Arithmetic overflow error converting numeric', 'VALUE_OUT_OF_RANGE'],
    ['mssql', 'S0002', 8169, 'Conversion failed when converting to uniqueidentifier.', 'BAD_VALUE'],
    ['mssql', 'S0001', 241, 'Conversion failed when converting date and/or time', 'BAD_VALUE'],
    ['mssql', '23000', 2627, 'Violation of PRIMARY KEY constraint', 'CONSTRAINT'],
    ['mssql', '23000', 515, 'Cannot insert the value NULL into column', 'CONSTRAINT'],
    ['mssql', '23000', 547, 'The INSERT statement conflicted with the FOREIGN KEY', 'CONSTRAINT'],
    ['mssql', 'S0005', 229, 'The SELECT permission was denied on the object', 'PERMISSION_DENIED'],
    ['mssql', 'S0002', 208, "Invalid object name 'X'.", 'SQL_ERROR'],
    ['mssql', 'HY008', 0, 'The query has timed out.', 'TIMEOUT'],
    ['mssql', '08S01', 0, 'The TCP/IP connection to the host has failed.', 'CONNECT_FAILED'],
    ['mysql', '28000', 1045, "Access denied for user 'root'", 'LOGIN_FAILED'],
    ['mysql', '22001', 1406, "Data truncation: Data too long for column 'NAME'", 'VALUE_TOO_LONG'],
    // MySQL files these two under the state of "too long"
    ['mysql', '22001', 1264, 'Data truncation: Out of range value for column', 'VALUE_OUT_OF_RANGE'],
    ['mysql', '22001', 1292, 'Data truncation: Incorrect datetime value', 'BAD_VALUE'],
    ['mysql', 'HY000', 1366, 'Incorrect integer value', 'BAD_VALUE'],
    ['mysql', '23000', 1062, 'Duplicate entry', 'CONSTRAINT'],
    ['mysql', '23000', 1451, 'Cannot delete or update a parent row', 'CONSTRAINT'],
    ['mysql', '23000', 1452, 'Cannot add or update a child row', 'CONSTRAINT'],
    ['mysql', 'HY000', 1364, "Field 'X' doesn't have a default value", 'CONSTRAINT'],
    ['mysql', '42000', 1142, 'SELECT command denied to user', 'PERMISSION_DENIED'],
    ['mysql', 'HY000', 3024, 'Query execution was interrupted, maximum statement execution time', 'TIMEOUT'],
    ['postgresql', '28P01', 0, 'password authentication failed', 'LOGIN_FAILED'],
    ['postgresql', '08001', 0, 'Connection refused', 'CONNECT_FAILED'],
    ['postgresql', '22001', 0, 'value too long for type character varying(50)', 'VALUE_TOO_LONG'],
    ['postgresql', '22003', 0, 'numeric field overflow', 'VALUE_OUT_OF_RANGE'],
    ['postgresql', '22P02', 0, 'invalid input syntax for type uuid', 'BAD_VALUE'],
    ['postgresql', '22007', 0, 'invalid input syntax for type timestamp', 'BAD_VALUE'],
    ['postgresql', '23505', 0, 'duplicate key value violates unique constraint', 'CONSTRAINT'],
    ['postgresql', '23503', 0, 'violates foreign key constraint', 'CONSTRAINT'],
    ['postgresql', '42501', 0, 'permission denied for table customer', 'PERMISSION_DENIED'],
    ['postgresql', '42P01', 0, 'relation "x" does not exist', 'SQL_ERROR'],
    ['postgresql', '57014', 0, 'canceling statement due to statement timeout', 'TIMEOUT'],
    ['oracle', '72000', 1017, 'ORA-01017: invalid credential or not authorized', 'LOGIN_FAILED'],
    ['oracle', '72000', 12899, 'ORA-12899: value too large for column', 'VALUE_TOO_LONG'],
    ['oracle', '22003', 1438, 'ORA-01438: value larger than specified precision', 'VALUE_OUT_OF_RANGE'],
    ['oracle', '42000', 1722, 'ORA-01722: invalid number', 'BAD_VALUE'],
    ['oracle', '23000', 1, 'ORA-00001: unique constraint violated', 'CONSTRAINT'],
    ['oracle', '23000', 1400, 'ORA-01400: cannot insert NULL into', 'CONSTRAINT'],
    ['oracle', '23000', 2291, 'ORA-02291: integrity constraint violated - parent key not found', 'CONSTRAINT'],
    ['oracle', '42000', 1031, 'ORA-01031: insufficient privileges', 'PERMISSION_DENIED'],
    ['oracle', '08006', 17002, 'IO Error: The Network Adapter could not establish the connection', 'CONNECT_FAILED'],
    ['sqlite', null, 19, '[SQLITE_CONSTRAINT_UNIQUE] A UNIQUE constraint failed', 'CONSTRAINT'],
    ['generic', '22003', 0, 'numeric value out of range', 'VALUE_OUT_OF_RANGE'],
    ['generic', 'XX000', 0, 'something else', 'DB_ERROR'],
  ];

  test('vendor codes decide before SQL states', () => {
    const input = path.join(work, 'errors.json');
    const out = path.join(work, 'errors-out.json');
    fs.writeFileSync(input, JSON.stringify(cases.map(c => ({
      dialect: c[0],
      state: c[1],
      code: c[2],
      message: c[3],
    })).concat({ dialect: 'oracle', state: '72000', code: 1013, message: 'ORA-01013', timeout: true })));
    execFileSync('java', ['-cp', tools, 'mypd.TestDataErrors', input, out]);
    const result = JSON.parse(fs.readFileSync(out, 'utf8'));
    cases.forEach((c, i) => expect([c[0], c[2] || c[1], result[i]])
      .toEqual([c[0], c[2] || c[1], c[4]]));
    expect(result[cases.length]).toBe('TIMEOUT');
  });
});

test('the JVM options of the settings reach the tool, the default is the one of the app', () => {
  expect(jvmArgs({})).toEqual(['-Xms128m', '-Xmx1024m', '-XX:-UseGCOverheadLimit']);
  expect(jvmArgs(undefined)).toEqual(jvmArgs({}));
  expect(jvmArgs({ jvm: '  -Xmx256m   -Dx=1 ' })).toEqual(['-Xmx256m', '-Dx=1']);
  // an empty setting must not become an empty argument, which java takes for the class name
  expect(jvmArgs({ jvm: '' })).toEqual([]);
  const source = fs.readFileSync(path.join(root, 'src/lib/datasource_util.js'), 'utf8');
  expect(/export const defaultJVM = '([^']*)'/.exec(source)[1]).toBe(DEFAULT_JVM);
});

test('connection parameters come from a dbConn entry or its properties', () => {
  expect(connParams(conn)).toEqual({ ...conn.properties, customer_driver: '' });
  expect(connParams(conn.properties)).toEqual(connParams(conn));
  expect(connParams(undefined).url).toBe('');
});

(hasAll ? describe : describe.skip)('test data against SQLite', () => {
  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    configure({ jarPath: jar, tmpDir });
    sql(`CREATE TABLE CUSTOMER (ID INTEGER PRIMARY KEY, NAME VARCHAR(50) NOT NULL,
      EMAIL VARCHAR(80) UNIQUE, BIRTH DATE, CREATED DATETIME, OPEN_AT TIME, ACTIVE BOOLEAN,
      BALANCE DECIMAL(12,2), PHOTO BLOB, BIG NUMERIC);
      CREATE TABLE ORDERS (ID INTEGER PRIMARY KEY,
      CUSTOMER_ID INTEGER NOT NULL REFERENCES CUSTOMER(ID), NOTE VARCHAR(100));`);
  });

  afterEach(() => {
    // parameter, result and progress files never outlive a call
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  test('counts rows, null for a missing table, names in any case', async () => {
    expect(await countRows({}, {}, conn, ['CUSTOMER', 'orders', 'NO_SUCH_TABLE']))
      .toEqual({ CUSTOMER: 0, orders: 0, NO_SUCH_TABLE: null });
  });

  test('appends a bundle with every kind of value and reports progress', async () => {
    const progress = [];
    const dir = bundle([
      {
        name: 'CUSTOMER',
        columns: customerColumns,
        rows: [
          [1, '王小明 "quote" \\ tab\there', 'a@example.com', '2001-02-03', '2024-05-06 07:08:09',
            '10:11:12', true, 1234.56, 'CAFE00ff', 9007199254740993],
          [2, "O'Brien é 😀", null, null, null, null, false, -0.01, null, null],
          [3, 'third', 'c@example.com', '2024-02-29', '2024-12-31 23:59:59', '00:00:00', true, 0,
            '', 1],
        ],
      },
      {
        name: 'ORDERS',
        columns: orderColumns,
        rows: [[1, 1, 'first'], [2, 1, null], [3, 3, 'x'], [4, 2, 'y']],
      },
    ]);
    // an integer beyond 64 bits goes in as a decimal (SQLite itself then keeps it as a real)
    const file = path.join(dir, '0001.ndjson');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('9007199254740992]',
      '12345678901234567890123]'));
    const result = await write(dir, { onProgress: p => progress.push(p) });
    expect(result.tables.map(t => [t.name, t.written, t.failed, t.errors]))
      .toEqual([['CUSTOMER', 3, 0, []], ['ORDERS', 4, 0, []]]);
    expect(await counts()).toEqual({ CUSTOMER: 3, ORDERS: 4 });
    expect(sql('SELECT ID, NAME, EMAIL, BIRTH, CREATED, OPEN_AT, ACTIVE, BALANCE, hex(PHOTO), BIG,'
      + ' typeof(BIRTH), typeof(ACTIVE) FROM CUSTOMER ORDER BY ID').split('\n')).toEqual([
      '1|王小明 "quote" \\ tab\there|a@example.com|2001-02-03|2024-05-06 07:08:09|10:11:12|1|1234.56'
        + '|CAFE00FF|1.2345678901234568e+22|text|integer',
      "2|O'Brien é 😀|||||0|-0.01|||null|integer",
      '3|third|c@example.com|2024-02-29|2024-12-31 23:59:59|00:00:00|1|0||1|text|integer',
    ]);
    expect(sql('SELECT ID, CUSTOMER_ID, NOTE FROM ORDERS ORDER BY ID'))
      .toBe('1|1|first\n2|1|\n3|3|x\n4|2|y');
    const last = progress[progress.length - 1];
    expect(last).toMatchObject({ table: 'ORDERS', done: 4, total: 4, tableIndex: 1, tableCount: 2 });
  });

  test('reads existing keys with a limit', async () => {
    expect((await readKeys({}, {}, conn, 'CUSTOMER', 'ID', 100)).sort()).toEqual([1, 2, 3]);
    expect(await readKeys({}, {}, conn, 'customer', 'email')).toEqual(
      ['a@example.com', 'c@example.com']);
    expect(await readKeys({}, {}, conn, 'ORDERS', 'CUSTOMER_ID', 2)).toHaveLength(2);
    expect(await fail(readKeys({}, {}, conn, 'CUSTOMER', 'NOPE', 5)))
      .toMatchObject({ code: 'COLUMN_MISSING', table: 'CUSTOMER' });
    expect(await fail(readKeys({}, {}, conn, 'NOPE', 'ID', 5)))
      .toMatchObject({ code: 'TABLE_MISSING', table: 'NOPE' });
  });

  test('reads rows of several columns for composite keys, rows with a NULL left out', async () => {
    // ORDERS: [1, 1, 'first'], [2, 1, null], [3, 3, 'x'], [4, 2, 'y']
    expect(await readKeyRows({}, {}, conn, 'orders', ['customer_id', 'ID'], 100))
      .toEqual([[1, 1], [1, 2], [3, 3], [2, 4]]);
    expect(await readKeyRows({}, {}, conn, 'ORDERS', ['ID', 'NOTE']))
      .toEqual([[1, 'first'], [3, 'x'], [4, 'y']]);
    expect(await readKeyRows({}, {}, conn, 'ORDERS', ['ID', 'CUSTOMER_ID'], 2)).toHaveLength(2);
    expect(await readKeyRows({}, {}, conn, 'CUSTOMER', ['ID', 'BIRTH', 'CREATED', 'OPEN_AT']))
      .toEqual([[1, '2001-02-03', '2024-05-06 07:08:09', '10:11:12'],
        [3, '2024-02-29', '2024-12-31 23:59:59', '00:00:00']]);
    expect(await fail(readKeyRows({}, {}, conn, 'ORDERS', ['ID', 'NOPE'])))
      .toMatchObject({ code: 'COLUMN_MISSING', table: 'ORDERS' });
    expect(await fail(readKeyRows({}, {}, conn, 'NOPE', ['ID'])))
      .toMatchObject({ code: 'TABLE_MISSING', table: 'NOPE' });
    expect(await fail(readKeyRows({}, {}, conn, 'ORDERS', []))).toMatchObject({ code: 'BAD_PARAMS' });
  });

  test('inspectTables tells a missing table from one with rows', async () => {
    expect(await inspectTables({}, {}, conn, ['CUSTOMER', 'orders', 'NO_SUCH_TABLE'])).toEqual({
      CUSTOMER: { exists: true, rows: 3 },
      orders: { exists: true, rows: 4 },
      NO_SUCH_TABLE: { exists: false, rows: null },
    });
    expect(await inspectTables({}, {}, conn, [])).toEqual({});
  });

  test('a view that cannot be read exists, has no count and says why', async () => {
    sql('CREATE VIEW BROKEN AS SELECT ID FROM GONE_TABLE');
    const info = await inspectTables({}, {}, conn, ['BROKEN', 'CUSTOMER']);
    sql('DROP VIEW BROKEN');
    expect(info.BROKEN).toMatchObject({ exists: true, rows: null });
    expect(info.BROKEN.error.message).toMatch(/GONE_TABLE/);
    expect(typeof info.BROKEN.error.code).toBe('string');
    expect(info.CUSTOMER).toEqual({ exists: true, rows: 3 });
    expect(await countRows({}, {}, conn, ['BROKEN', 'CUSTOMER'])).toEqual({ BROKEN: null, CUSTOMER: 3 });
  });

  test('runs one SELECT and nothing else', async () => {
    expect(await runQuery({}, {}, conn, 'SELECT NAME, ID FROM CUSTOMER -- c\n ORDER BY ID DESC;', 2))
      .toEqual(['third', "O'Brien é 😀"]);
    expect(await runQuery({}, {}, conn, 'SELECT BALANCE FROM CUSTOMER ORDER BY ID'))
      .toEqual([1234.56, -0.01, 0]);
    expect(await runQuery({}, {}, conn, 'SELECT NULL')).toEqual([null]);
    expect(await runQuery({}, {}, conn, 'SELECT ID FROM CUSTOMER ORDER BY ID', 2, { timeout: 5 }))
      .toEqual([1, 2]);
    expect(await fail(runQuery({}, {}, conn, 'DELETE FROM ORDERS')))
      .toMatchObject({ code: 'SQL_NOT_SELECT' });
    expect(await fail(runQuery({}, {}, conn, 'SELECT 1; DROP TABLE ORDERS')))
      .toMatchObject({ code: 'SQL_MULTIPLE' });
    expect(await fail(runQuery({}, {}, conn, 'SELECT X FROM NO_SUCH_TABLE'))).toHaveProperty('code');
    expect(await counts()).toEqual({ CUSTOMER: 3, ORDERS: 4 });
  });

  const duplicate = () => bundle([{
    name: 'CUSTOMER',
    columns: customerColumns,
    rows: [customer(10), customer(11, 'a@example.com'), customer(12)],
  }, {
    name: 'ORDERS',
    columns: orderColumns,
    rows: [[10, 10, 'kept'], [11, 11, 'parent was skipped'], [12, 12, 'kept']],
  }]);

  test('rollback: the first failing row undoes everything and is named', async () => {
    const error = await fail(write(duplicate(), { onError: 'rollback' }));
    expect(error).toMatchObject({ code: 'CONSTRAINT', table: 'CUSTOMER', row: 2 });
    expect(error.message).toMatch(/UNIQUE/i);
    expect(await counts()).toEqual({ CUSTOMER: 3, ORDERS: 4 });
  });

  test('skip: bad rows are left out and listed, the rest is kept', async () => {
    const result = await write(duplicate(), { onError: 'skip' });
    expect(result.tables.map(t => [t.name, t.written, t.failed, t.errors.map(e => e.row)]))
      .toEqual([['CUSTOMER', 2, 1, [2]], ['ORDERS', 2, 1, [2]]]);
    expect(result.tables[0].errors[0]).toMatchObject({ code: 'CONSTRAINT' });
    expect(result.tables[0].errors[0].message).toMatch(/UNIQUE/i);
    expect(result.tables[1].errors[0].message).toMatch(/FOREIGN KEY/i);
    expect(await counts()).toEqual({ CUSTOMER: 5, ORDERS: 6 });
    expect(sql('SELECT ID FROM CUSTOMER ORDER BY ID')).toBe('1\n2\n3\n10\n12');
  });

  test('skip: the error list is capped, the count is not', async () => {
    const rows = [];
    for (let i = 0; i < 1300; i += 1) {
      // every fifth row repeats an existing key, one value is not a date
      rows.push(i % 5 === 0 ? customer(1, `dup${i}@example.com`) : customer(1000 + i));
    }
    rows[7][3] = '2024-02-31';
    const result = await write(bundle([{ name: 'CUSTOMER', columns: customerColumns, rows }]),
      { onError: 'skip' });
    expect(result.tables[0]).toMatchObject({ written: 1039, failed: 261 });
    expect(result.tables[0].errors).toHaveLength(100);
    expect(result.tables[0].errors.slice(0, 3).map(e => [e.row, e.code])).toEqual(
      [[8, 'BAD_VALUE'], [1, 'CONSTRAINT'], [6, 'CONSTRAINT']]);
    expect(await counts()).toEqual({ CUSTOMER: 1044, ORDERS: 6 });
  });

  const replacement = extra => bundle([{
    name: 'CUSTOMER',
    columns: customerColumns,
    rows: [customer(1), customer(2), customer(3)].concat(extra),
  }, {
    name: 'ORDERS',
    columns: orderColumns,
    rows: [[1, 1, 'new'], [2, 3, 'new']],
  }]);

  test('clear + rollback: a failure brings the deleted rows back', async () => {
    const error = await fail(write(replacement([customer(4, 'c1@example.com')]),
      { existing: 'clear', onError: 'rollback' }));
    expect(error).toMatchObject({ code: 'CONSTRAINT', table: 'CUSTOMER', row: 4 });
    expect(await counts()).toEqual({ CUSTOMER: 1044, ORDERS: 6 });
  });

  test('clear: children are emptied before parents, then the bundle is written', async () => {
    const result = await write(replacement([]), { existing: 'clear' });
    expect(result.tables.map(t => [t.name, t.deleted, t.written]))
      .toEqual([['CUSTOMER', 1044, 3], ['ORDERS', 6, 2]]);
    expect(await counts()).toEqual({ CUSTOMER: 3, ORDERS: 2 });
    expect(sql('SELECT NOTE FROM ORDERS ORDER BY ID')).toBe('new\nnew');
  });

  test('bad values, missing tables and columns are reported before or with the row', async () => {
    const bad = bundle([{
      name: 'ORDERS',
      columns: orderColumns,
      rows: [[20, 1, 'ok'], [21, 'abc', 'not a number'], [22, 1]],
    }]);
    expect(await fail(write(bad))).toMatchObject({ code: 'BAD_VALUE', table: 'ORDERS', row: 2 });
    const skipped = await write(bad, { onError: 'skip' });
    expect(skipped.tables[0]).toMatchObject({ written: 1, failed: 2 });
    expect(skipped.tables[0].errors.map(e => e.row)).toEqual([2, 3]);
    const columns = [{ name: 'ID', kind: 'int' }];
    expect(await fail(write(bundle([{ name: 'NO_SUCH_TABLE', columns, rows: [[1]] }]))))
      .toMatchObject({ code: 'TABLE_MISSING', table: 'NO_SUCH_TABLE' });
    expect(await fail(write(bundle([{
      name: 'ORDERS',
      columns: columns.concat({ name: 'NOPE', kind: 'string' }),
      rows: [[30, 'x']],
    }])))).toMatchObject({ code: 'COLUMN_MISSING', table: 'ORDERS' });
    expect(await fail(write(path.join(work, 'no-bundle')))).toMatchObject({ code: 'BUNDLE_INVALID' });
    expect(await counts()).toEqual({ CUSTOMER: 3, ORDERS: 3 });
  });

  test('driver, connection and java problems have their own codes', async () => {
    const other = properties => ({ properties: { ...conn.properties, ...properties } });
    expect(await fail(countRows({}, {}, other({ driver_class_name: 'no.such.Driver' }), ['A'])))
      .toMatchObject({ code: 'DRIVER_MISSING' });
    const unreachable = await fail(countRows({}, {},
      other({ url: `jdbc:sqlite:${work}/missing-dir/x.db?password=${password}` }), ['A']));
    expect(unreachable.code).toBe('CONNECT_FAILED');
    expect(unreachable.message).not.toContain(password);
    expect(await fail(countRows({}, { javaHome: path.join(work, 'no-java') }, conn, ['A'])))
      .toMatchObject({ code: JAVA_NOT_FOUND });
  });

  test('cancel ends the tool, nothing of a rollback run stays, no secret on the command line',
    async () => {
      const dir = path.join(work, 'big');
      fs.mkdirSync(dir);
      const total = 600000;
      const out = fs.openSync(path.join(dir, '0001.ndjson'), 'w');
      for (let i = 0; i < total; i += 1000) {
        let chunk = '';
        for (let j = i; j < i + 1000; j += 1) {
          chunk += `${JSON.stringify([100000 + j, 3, `note ${j}`])}\n`;
        }
        fs.writeSync(out, chunk);
      }
      fs.closeSync(out);
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
        version: 1,
        dialect: 'generic',
        tables: [{ name: 'ORDERS', file: '0001.ndjson', rows: total, columns: orderColumns }],
      }));
      let seen;
      let commandLine = '';
      const run = writeBundle({}, {}, conn, dir, {
        onProgress: (p) => {
          if (p.done > 0 && !seen) {
            seen = p;
            commandLine = execFileSync('ps', ['-eo', 'args']).toString().split('\n')
              .filter(l => l.includes('mypd.TestData')).join('\n');
            run.cancel();
          }
        },
      });
      expect(await fail(run.promise)).toMatchObject({ code: CANCELLED });
      expect(seen.done).toBeGreaterThan(0);
      expect(seen.done).toBeLessThan(total);
      expect(commandLine).toContain('params=');
      expect(commandLine).not.toContain(password);
      expect(commandLine).not.toContain('jdbc:');
      expect(await counts()).toEqual({ CUSTOMER: 3, ORDERS: 3 });
      // the same bundle goes in completely when it is left alone
      const result = await write(dir);
      expect(result.tables[0]).toMatchObject({ written: total, failed: 0 });
      expect(await counts()).toEqual({ CUSTOMER: 3, ORDERS: 3 + total });
    });
});
