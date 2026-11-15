import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import {
  checkQuery, checkWarnings, configure, placeOf, runQuery, CANCELLED, JAVA_NOT_FOUND,
} from '../src/lib/testdata/db';

// The check of a query by the database, against a throwaway SQLite file with the driver
// inside the engine jar. Skipped when java, the jar or the sqlite3 command is not there.
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
  && fs.existsSync(path.join(tools, 'mypd/TestDataCheck.class'));
const hasAll = hasJava && fs.existsSync(jar) && works('sqlite3', ['-version']);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mypd-td-check-'));
const tmpDir = path.join(work, 'tmp');
const dbFile = path.join(work, 'test.db');
const password = 'S3cret-pw-5582';
const conn = {
  defKey: 'sqlite',
  properties: {
    driver_class_name: 'org.sqlite.JDBC',
    url: `jdbc:sqlite:${dbFile}`,
    username: 'tester',
    password,
  },
};
const sql = text => execFileSync('sqlite3', [dbFile, text]).toString().trim();
const fail = promise => promise.then(() => {
  throw new Error('expected a rejection');
}, e => e);
const check = (text, options) => checkQuery({}, {}, conn, text, options);

jest.setTimeout(120000);
afterAll(() => fs.rmdirSync(work, { recursive: true }));

describe('pure parts', () => {
  test('line and column of an offset', () => {
    expect(placeOf('SELECT a\nFROM t\nWHERE x', 0)).toEqual({ offset: 0, line: 1, column: 1 });
    expect(placeOf('SELECT a\nFROM t\nWHERE x', 9)).toEqual({ offset: 9, line: 2, column: 1 });
    expect(placeOf('SELECT a\nFROM t\nWHERE x', 22)).toEqual({ offset: 22, line: 3, column: 7 });
    expect(placeOf('abc', 99)).toEqual({ offset: 3, line: 1, column: 4 });
    expect(placeOf(undefined, 5)).toEqual({ offset: 0, line: 1, column: 1 });
  });
  test('what is worth knowing about an accepted query', () => {
    expect(checkWarnings({ columns: [{}], sample: ['a', 'b'] })).toEqual([]);
    expect(checkWarnings({ columns: [{}, {}, {}], sample: [] }))
      .toEqual([{ code: 'multipleColumns', count: 3 }, { code: 'noRows' }]);
    expect(checkWarnings({ columns: [{}], sample: [1, null, 1, '1', null, 1] }))
      .toEqual([{ code: 'nullValues', count: 2 }, { code: 'duplicateValues', count: 2 }]);
    expect(checkWarnings({})).toEqual([{ code: 'noRows' }]);
  });
  test('without Java the check says so', async () => {
    configure({ jarPath: jar, tmpDir: os.tmpdir() });
    const error = await fail(checkQuery({}, { javaHome: '/nonexistent/java/home' }, conn, 'SELECT 1'));
    expect(error.code).toBe(JAVA_NOT_FOUND);
  });
});

(hasJava ? describe : describe.skip)('error codes of a query (Java, no database)', () => {
  // [dialect, SQL state, vendor code, message, expected]: what the real servers answered in
  // the Docker runs (SQL Server 2022, MySQL 8, PostgreSQL 16, Oracle 23)
  const cases = [
    ['mssql', 'S0001', 102, "Incorrect syntax near 'TD_Q_CUST'.", 'SQL_SYNTAX'],
    ['mssql', 'S0001', 156, "Incorrect syntax near the keyword 'FROM'.", 'SQL_SYNTAX'],
    ['mssql', 'S0002', 208, "Invalid object name 'TD_Q_NOPE'.", 'TABLE_MISSING'],
    ['mssql', 'S0001', 207, "Invalid column name 'NOPE'.", 'COLUMN_MISSING'],
    ['mssql', 'S0001', 4104, 'The multi-part identifier "x.ID" could not be bound.', 'COLUMN_MISSING'],
    ['mssql', 'S0005', 229, "The SELECT permission was denied on the object 'TD_Q_SECRET'", 'PERMISSION_DENIED'],
    ['mssql', 'HY008', 0, 'The query has timed out.', 'TIMEOUT'],
    ['mysql', '42000', 1064, "You have an error in your SQL syntax; near 'x' at line 1", 'SQL_SYNTAX'],
    ['mysql', '42S02', 1146, "Table 'tdtest.TD_Q_NOPE' doesn't exist", 'TABLE_MISSING'],
    ['mysql', '42S22', 1054, "Unknown column 'NOPE' in 'field list'", 'COLUMN_MISSING'],
    ['mysql', '42000', 1142, "SELECT command denied to user 'td_ro'@'%' for table 'TD_Q_SECRET'", 'PERMISSION_DENIED'],
    ['mysql', null, 0, 'Statement cancelled due to timeout or client request', 'TIMEOUT'],
    ['postgresql', '42601', 0, 'ERROR: syntax error at or near "FROM"', 'SQL_SYNTAX'],
    ['postgresql', '42P01', 0, 'ERROR: relation "td_q_nope" does not exist', 'TABLE_MISSING'],
    ['postgresql', '42703', 0, 'ERROR: column "nope" does not exist', 'COLUMN_MISSING'],
    ['postgresql', '42501', 0, 'ERROR: permission denied for table td_q_secret', 'PERMISSION_DENIED'],
    ['postgresql', '57014', 0, 'ERROR: canceling statement due to user request', 'TIMEOUT'],
    ['postgresql', '42883', 0, 'ERROR: function nope() does not exist', 'SQL_ERROR'],
    ['oracle', '42000', 923, 'ORA-00923: FROM keyword not found where expected', 'SQL_SYNTAX'],
    ['oracle', '42000', 907, 'ORA-00907: missing right parenthesis', 'SQL_SYNTAX'],
    ['oracle', '42000', 936, 'ORA-00936: missing expression', 'SQL_SYNTAX'],
    ['oracle', '42000', 933, 'ORA-00933: SQL command not properly ended', 'SQL_SYNTAX'],
    ['oracle', '42000', 942, 'ORA-00942: table or view "TDTEST"."TD_Q_NOPE" does not exist', 'TABLE_MISSING'],
    ['oracle', '42000', 904, 'ORA-00904: "C"."NOPE": invalid identifier', 'COLUMN_MISSING'],
    ['oracle', '42000', 918, 'ORA-00918: column ambiguously defined', 'SQL_ERROR'],
    ['oracle', '42000', 932, 'ORA-00932: inconsistent datatypes', 'BAD_VALUE'],
    ['oracle', '72000', 1013, 'ORA-01013: user requested cancel of current operation', 'TIMEOUT'],
    ['sqlite', null, 1, '[SQLITE_ERROR] SQL error or missing database (near "FORM": syntax error)', 'SQL_SYNTAX'],
    ['sqlite', null, 1, '[SQLITE_ERROR] SQL error or missing database (no such table: NOPE)', 'TABLE_MISSING'],
    ['sqlite', null, 1, '[SQLITE_ERROR] SQL error or missing database (no such column: NOPE)', 'COLUMN_MISSING'],
    // the wording alone decides nothing for the other databases
    ['mssql', 'S0001', 50000, 'no such table: x, syntax error', 'SQL_ERROR'],
  ];
  test('each database tells syntax, a missing table and a missing column apart', () => {
    const input = path.join(work, 'errors.json');
    const out = path.join(work, 'errors-out.json');
    fs.writeFileSync(input, JSON.stringify(cases.map(c => ({
      dialect: c[0], state: c[1], code: c[2], message: c[3], timeout: c[4] === 'TIMEOUT' && !c[1],
    }))));
    execFileSync('java', ['-cp', tools, 'mypd.TestDataErrors', input, out]);
    const result = JSON.parse(fs.readFileSync(out, 'utf8'));
    cases.forEach((c, i) => expect([c[0], c[2] || c[1], c[3], result[i]])
      .toEqual([c[0], c[2] || c[1], c[3], c[4]]));
  });
});

(hasAll ? describe : describe.skip)('checkQuery against SQLite', () => {
  beforeAll(() => {
    fs.mkdirSync(tmpDir);
    configure({ jarPath: jar, tmpDir });
    sql(`CREATE TABLE CUSTOMER (ID INTEGER PRIMARY KEY, NAME VARCHAR(20) NOT NULL, EMAIL VARCHAR(50));
CREATE TABLE EMPTY_ONE (ID INTEGER);
INSERT INTO CUSTOMER VALUES (1,'Ann','a@x.tw'),(2,'Bob',NULL),(3,'Cat','a@x.tw'),(4,'Dan','d@x.tw'),
  (5,'Eve','e@x.tw'),(6,'Fay','f@x.tw'),(7,'Gus','g@x.tw');`);
  });
  afterEach(() => {
    // nothing is left behind, whatever happened: neither the password nor the query
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  test('an accepted query gives the columns, the first values and what to know', async () => {
    const result = await check('SELECT NAME FROM CUSTOMER ORDER BY ID');
    expect(result).toMatchObject({
      ok: true, sample: ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'], rowsSeen: 5, truncated: true, warnings: [],
    });
    expect(result.columns).toHaveLength(1);
    expect(result.firstColumn).toMatchObject({ name: 'NAME' });
    expect(typeof result.firstColumn.typeName).toBe('string');
    expect(typeof result.firstColumn.jdbcType).toBe('number');
    const all = await check('SELECT ID FROM CUSTOMER ORDER BY ID;', { sample: 50 });
    expect(all).toMatchObject({ sample: [1, 2, 3, 4, 5, 6, 7], rowsSeen: 7, truncated: false });
    const two = await check('SELECT EMAIL, NAME -- two\nFROM CUSTOMER ORDER BY ID', { sample: 3 });
    expect(two.sample).toEqual(['a@x.tw', null, 'a@x.tw']);
    expect(two.warnings).toEqual([{ code: 'multipleColumns', count: 2 },
      { code: 'nullValues', count: 1 }, { code: 'duplicateValues', count: 1 }]);
    expect(two.columns.map(c => c.name)).toEqual(['EMAIL', 'NAME']);
    expect(await check('SELECT ID FROM EMPTY_ONE')).toMatchObject({
      ok: true, sample: [], rowsSeen: 0, truncated: false, warnings: [{ code: 'noRows' }],
    });
  });

  test('a refused query says what and where', async () => {
    expect(await fail(check('SELECT NAME FROM NOPE'))).toMatchObject({
      code: 'TABLE_MISSING', object: 'NOPE', position: { offset: 17, line: 1, column: 18 },
    });
    // the place is the one in the text as typed: the comment and the first lines count
    const missing = await fail(check('-- names\nSELECT NAME,\n  c.NOPE /* ? */ FROM CUSTOMER c'));
    expect(missing).toMatchObject({
      code: 'COLUMN_MISSING', object: 'c.NOPE', position: { offset: 24, line: 3, column: 3 },
    });
    expect(missing.message).toMatch(/no such column/);
    expect(await fail(check('SELECT NAME FORM CUSTOMER'))).toMatchObject({ code: 'SQL_SYNTAX' });
    expect(await fail(check('SELECT NAME,\nFROM CUSTOMER'))).toMatchObject({
      code: 'SQL_SYNTAX', near: 'FROM', position: { offset: 13, line: 2, column: 1 },
    });
    expect(await fail(check('SELECT NAME FROM CUSTOMER WHERE (ID = 1')))
      .toMatchObject({ code: 'SQL_SYNTAX' });
  });

  test('the same refusals as runQuery, before any connection', async () => {
    expect(await fail(check('DELETE FROM CUSTOMER'))).toMatchObject({ code: 'SQL_NOT_SELECT' });
    expect(await fail(check('SELECT 1; DELETE FROM CUSTOMER'))).toMatchObject({ code: 'SQL_MULTIPLE' });
    expect(await fail(check('SELECT ID INTO X FROM CUSTOMER'))).toMatchObject({ code: 'SQL_FORBIDDEN' });
    expect(await fail(check(''))).toMatchObject({ code: 'SQL_EMPTY' });
    expect(sql('SELECT COUNT(*) FROM CUSTOMER')).toBe('7');
  });

  test('runQuery names the object and the place too', async () => {
    expect(await fail(runQuery({}, {}, conn, 'SELECT NAME\nFROM NOPE'))).toMatchObject({
      code: 'TABLE_MISSING', object: 'NOPE', position: { offset: 17, line: 2, column: 6 },
    });
  });

  test('a check can be cancelled, and a bad driver or file is reported', async () => {
    const run = check('SELECT NAME FROM CUSTOMER');
    run.cancel();
    expect(await fail(run)).toMatchObject({ code: CANCELLED });
    const noDriver = { properties: { ...conn.properties, driver_class_name: 'no.such.Driver' } };
    expect(await fail(checkQuery({}, {}, noDriver, 'SELECT 1'))).toMatchObject({ code: 'DRIVER_MISSING' });
    const error = await fail(checkQuery({}, {}, {
      properties: { ...conn.properties, url: `jdbc:sqlite:${path.join(work, 'no/such/dir/x.db')}` },
    }, 'SELECT 1'));
    expect(error.code).toBe('CONNECT_FAILED');
    expect(`${error.message}`).not.toContain(password);
  });
});
