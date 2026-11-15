import fs from 'fs';
import os from 'os';
import path from 'path';
import { createCsvWriter, csvField, csvLine } from '../src/lib/testdata/csv';
import { createDbBundleWriter, createSqlWriter, safeFileName } from '../src/lib/testdata/files';
import { DIALECTS } from '../src/lib/testdata/sql';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mypd-testdata-files-'));
afterAll(() => fs.rmdirSync(root, { recursive: true }));
const tmp = name => path.join(root, name);

const BS = String.fromCharCode(92);
const BOM = String.fromCharCode(0xFEFF);

const orders = {
  entityId: 'e1',
  defKey: 'Orders',
  autoIncrement: 'generate',
  columns: [
    { defKey: 'Id', kind: 'int', autoIncrement: true },
    { defKey: 'Name', kind: 'string' },
    { defKey: 'Amount', kind: 'decimal' },
    { defKey: 'Created', kind: 'datetime' },
    { defKey: 'Paid', kind: 'bool' },
  ],
};
const items = {
  entityId: 'e2',
  defKey: 'Order Items',
  columns: [
    { defKey: 'Order Id', kind: 'int' },
    { defKey: 'Day', kind: 'date' },
    { defKey: 'Note', kind: 'string' },
  ],
};
const orderRows = [
  [1, "O'Brien", 12.5, '2024-01-31 10:00:00', true],
  [2, null, -3, null, false],
  [3, '臺北, "信義"\r\n區', 0.001, '1999-12-31 23:59:59', true],
];
const itemRows = [[1, '2024-02-29', ''], [1, null, ` lead${BS}n`], [3, '2024-03-01', 'x;--']];

// the tables one after the other, the rows in pieces of `size`, every call awaited
const feed = (writer, tables, size = 1000) => tables.reduce((work, [table, rows]) => {
  let next = work.then(() => writer.beginTable(table));
  for (let i = 0; i < rows.length; i += size) {
    next = next.then(() => writer.rows(rows.slice(i, i + size)));
  }
  return next.then(() => writer.endTable());
}, Promise.resolve()).then(() => writer.close());

const both = [[orders, orderRows], [items, itemRows]];

// ---------------------------------------------------------------- file names

describe('safeFileName', () => {
  test('a table name cannot leave the directory', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('..')).toBe('table');
    expect(safeFileName('.')).toBe('table');
    expect(safeFileName(`a/b${BS}c:d`)).toBe('a_b_c_d');
    expect(safeFileName('C:\\Windows')).toBe('C__Windows');
    expect(safeFileName(`x${String.fromCharCode(0)}y\n`)).toBe('x_y_');
    ['../x', '/abs', '~/x', 'a/../../b', '..\\..\\x', '.hidden', 'x.'].forEach((name) => {
      const safe = safeFileName(name);
      expect(path.basename(safe)).toBe(safe);
      expect(path.win32.basename(safe)).toBe(safe);
      expect(safe).not.toMatch(/^\.|\.$/);
      expect(path.dirname(path.join(root, `${safe}.csv`))).toBe(root);
    });
  });

  test('names Windows keeps for devices, empty and long names', () => {
    expect(safeFileName('CON')).toBe('_CON');
    expect(safeFileName('nul')).toBe('_nul');
    expect(safeFileName('COM1')).toBe('_COM1');
    expect(safeFileName('lpt9.x')).toBe('_lpt9.x');
    expect(safeFileName('CONTACT')).toBe('CONTACT');
    expect(safeFileName('')).toBe('table');
    expect(safeFileName(null)).toBe('table');
    expect(safeFileName(' . ')).toBe('table');
    expect(safeFileName('訂單*明細?')).toBe('訂單_明細_');
    expect(Array.from(safeFileName('表'.repeat(300)))).toHaveLength(80);
    expect(Buffer.byteLength(safeFileName('😀'.repeat(300)))).toBeLessThanOrEqual(320);
  });

  test('two tables never share a file, whatever the case', () => {
    const used = new Set();
    expect(['Orders', 'ORDERS', 'orders', 'a/b', 'a_b', 'Orders_2'].map(n => safeFileName(n, used)))
      .toEqual(['Orders', 'ORDERS_2', 'orders_3', 'a_b', 'a_b_2', 'Orders_2_2']);
  });
});

// ---------------------------------------------------------------- CSV

describe('CSV', () => {
  test('fields follow RFC 4180', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(csvField('a\rb')).toBe('"a\rb"');
    expect(csvField(' x')).toBe('" x"');
    expect(csvField('x ')).toBe('"x "');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField('')).toBe('""');
    expect(csvField(-12.5)).toBe('-12.5');
    expect(csvField(1e21)).toBe('1000000000000000000000');
    expect(csvField(NaN)).toBe('');
    expect(csvField(true)).toBe('1');
    expect(csvField(false)).toBe('0');
    expect(csvField('001')).toBe('001');
    expect(csvLine([1, 'a,b', null])).toBe('1,"a,b",\r\n');
  });

  test('one file per table: byte order mark, CRLF, heading, NULL apart from empty', () => {
    const dir = tmp('csv');
    return feed(createCsvWriter(dir), both, 2).then((result) => {
      expect(fs.readdirSync(dir).sort()).toEqual(['Order Items.csv', 'Orders.csv']);
      const bytes = fs.readFileSync(path.join(dir, 'Orders.csv'));
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xEF, 0xBB, 0xBF]);
      expect(bytes.toString('utf8')).toBe(`${BOM}Id,Name,Amount,Created,Paid\r\n`
        + "1,O'Brien,12.5,2024-01-31 10:00:00,1\r\n"
        + '2,,-3,,0\r\n'
        + '3,"臺北, ""信義""\r\n區",0.001,1999-12-31 23:59:59,1\r\n');
      expect(fs.readFileSync(path.join(dir, 'Order Items.csv'), 'utf8')).toBe(
        `${BOM}Order Id,Day,Note\r\n1,2024-02-29,""\r\n1,," lead${BS}n"\r\n3,2024-03-01,x;--\r\n`,
      );
      expect(result).toEqual({
        dir,
        rows: 6,
        files: [
          {
            table: 'Orders', file: 'Orders.csv', path: path.join(dir, 'Orders.csv'), rows: 3,
          },
          {
            table: 'Order Items',
            file: 'Order Items.csv',
            path: path.join(dir, 'Order Items.csv'),
            rows: 3,
          },
        ],
      });
    });
  });

  test('odd table names stay inside the directory', () => {
    const dir = tmp('csv-odd');
    const table = name => [{ defKey: name, columns: [{ defKey: 'A', kind: 'int' }] }, [[1]]];
    return feed(createCsvWriter(dir), [table('../escape'), table('a/b'), table('A/B'), table('..')])
      .then((result) => {
        expect(result.files.map(f => f.file))
          .toEqual(['_escape.csv', 'a_b.csv', 'A_B_2.csv', 'table.csv']);
        expect(fs.readdirSync(dir).sort()).toEqual(['A_B_2.csv', '_escape.csv', 'a_b.csv', 'table.csv']);
        expect(fs.existsSync(path.join(root, 'escape.csv'))).toBe(false);
      });
  });
});

// ---------------------------------------------------------------- SQL script

describe('SQL script', () => {
  test('SQL Server: header, transaction, batches, IDENTITY_INSERT', () => {
    const file = tmp('mssql.sql');
    return feed(createSqlWriter(file, 'mssql'), both).then((result) => {
      expect(fs.readFileSync(file, 'utf8')).toBe(`${BOM}-- Test data generated by MyPD
-- Dialect: SQL Server (mssql)
-- Encoding: UTF-8
-- Tables: 2, rows: 6 (in insert order, parents first)
--   Orders: 3 rows
--   Order Items: 3 rows

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO

-- Orders (5 columns)
IF @@TRANCOUNT = 0 SET NOEXEC ON;
SET IDENTITY_INSERT [Orders] ON;
GO
IF @@TRANCOUNT = 0 SET NOEXEC ON;
INSERT INTO [Orders] ([Id], [Name], [Amount], [Created], [Paid]) VALUES
  (1, N'O''Brien', 12.5, '2024-01-31T10:00:00', 1),
  (2, NULL, -3, NULL, 0),
  (3, N'臺北, "信義"' + NCHAR(13) + NCHAR(10) + N'區', 0.001, '1999-12-31T23:59:59', 1);
GO
IF @@TRANCOUNT = 0 SET NOEXEC ON;
SET IDENTITY_INSERT [Orders] OFF;
GO

-- Order Items (3 columns)
IF @@TRANCOUNT = 0 SET NOEXEC ON;
INSERT INTO [Order Items] ([Order Id], [Day], [Note]) VALUES
  (1, '20240229', N''),
  (1, NULL, N' lead${BS}n'),
  (3, '20240301', N'x;--');
GO

SET NOEXEC OFF;
GO
IF @@TRANCOUNT > 0 COMMIT TRANSACTION;
ELSE RAISERROR(N'Test data was not written: a statement failed and everything was rolled back.', 16, 1);
GO
`);
      expect(result).toEqual({
        file,
        bytes: fs.statSync(file).size,
        rows: 6,
        tables: [{ name: 'Orders', rows: 3 }, { name: 'Order Items', rows: 3 }],
      });
      expect(fs.existsSync(`${file}.part`)).toBe(false);
    });
  });

  test('SQL Server without GO is one batch in one transaction', () => {
    const file = tmp('mssql-nogo.sql');
    return feed(createSqlWriter(file, 'mssql', { go: false, bom: false }), both).then(() => {
      const sql = fs.readFileSync(file, 'utf8');
      expect(sql).not.toMatch(/^GO$/m);
      expect(sql).not.toContain('NOEXEC');
      expect(sql.startsWith('-- Test data')).toBe(true);
      expect(sql).toContain('BEGIN TRANSACTION;\n\n-- Orders (5 columns)\nSET IDENTITY_INSERT [Orders] ON;\n');
      expect(sql.endsWith('\nCOMMIT TRANSACTION;\n')).toBe(true);
    });
  });

  test('PostgreSQL: transaction and the sequence after the rows', () => {
    const file = tmp('pg.sql');
    return feed(createSqlWriter(file, 'postgresql'), both).then(() => {
      const sql = fs.readFileSync(file, 'utf8');
      expect(sql.charCodeAt(0)).not.toBe(0xFEFF);
      expect(sql).toContain("\nSET client_encoding = 'UTF8';\nBEGIN;\n\n-- Orders (5 columns)\n"
        + 'INSERT INTO "orders" ("id", "name", "amount", "created", "paid") VALUES\n');
      expect(sql).toContain(`E'臺北, "信義"${BS}r${BS}n區'`);
      expect(sql).toContain('TRUE);\nSELECT setval(pg_get_serial_sequence(\'"orders"\', \'id\'), '
        + '(SELECT GREATEST(MAX("id"), 1) FROM "orders"));\n\n-- Order Items (3 columns)\n');
      expect(sql).toContain(`(1, NULL, E' lead${BS}${BS}n'),`);
      expect(sql.endsWith("'x;--');\n\nCOMMIT;\n")).toBe(true);
    });
  });

  test('MySQL and Oracle', () => {
    const mysql = tmp('mysql.sql');
    const oracle = tmp('oracle.sql');
    return feed(createSqlWriter(mysql, 'mysql', { generatedAt: '2024-01-31 08:00' }), both)
      .then(() => feed(createSqlWriter(oracle, 'oracle'), both))
      .then(() => {
        const my = fs.readFileSync(mysql, 'utf8');
        expect(my).toContain('-- Generated at: 2024-01-31 08:00\n');
        expect(my).toContain('\nSET NAMES utf8mb4;\nSTART TRANSACTION;\n\n-- Orders (5 columns)\n'
          + 'INSERT INTO `Orders` (`Id`, `Name`, `Amount`, `Created`, `Paid`) VALUES\n');
        expect(my).toContain("(1, NULL, CONCAT(' lead', CHAR(92 USING utf8mb4), 'n')),");
        expect(my.endsWith('\nCOMMIT;\n')).toBe(true);
        const ora = fs.readFileSync(oracle, 'utf8');
        expect(ora).toContain('\nSET DEFINE OFF\nSET SQLBLANKLINES ON\n'
          + 'WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK\n\n-- Orders (5 columns)\n'
          + 'INSERT INTO "ORDERS" ("ID", "NAME", "AMOUNT", "CREATED", "PAID") VALUES '
          + "(1, 'O''Brien', 12.5, TIMESTAMP '2024-01-31 10:00:00', 1);\n");
        expect(ora).toContain('INSERT INTO "Order Items" ("Order Id", "DAY", "NOTE") VALUES '
          + "(1, DATE '2024-02-29', NULL);\n");
        expect(ora).toContain('-- "ORDERS"."ID" was written with explicit values.');
        expect(ora.match(/^INSERT INTO/gm)).toHaveLength(6);
        expect(ora.endsWith('\nCOMMIT;\n')).toBe(true);
      });
  });

  test('the file does not depend on how the rows arrive, and is the same every time', () => {
    const rows = Array.from({ length: 2345 }, (v, i) => [i + 1, `n${i}`, i / 4, null, i % 2 === 0]);
    const write = (name, dialect, size) => feed(createSqlWriter(tmp(name), dialect),
      [[orders, rows]], size).then(() => fs.readFileSync(tmp(name), 'utf8'));
    return DIALECTS.reduce((work, dialect) => work
      .then(() => Promise.all([write(`a-${dialect}.sql`, dialect, 1000),
        write(`b-${dialect}.sql`, dialect, 7), write(`c-${dialect}.sql`, dialect, 5000)]))
      .then(([a, b, c]) => {
        expect(b).toBe(a);
        expect(c).toBe(a);
        expect(a).toContain('--   Orders: 2345 rows\n');
        expect(a).not.toMatch(/20\d\d-\d\d-\d\d/); // no time stamp
        const perStatement = {
          mssql: [1000, 1000, 345], mysql: [500, 500, 500, 500, 345], postgresql: [1000, 1000, 345],
        }[dialect];
        const inserts = a.split(/^(?=INSERT INTO)/m).slice(1)
          .map(s => s.slice(0, s.indexOf(';\n')).split('\n').length);
        expect(inserts).toEqual(perStatement ? perStatement.map(n => n + 1)
          : Array.from({ length: 2345 }, () => 1));
        if (dialect === 'mssql') {
          expect(a.match(/^GO$/gm)).toHaveLength(1 + 1 + 3 + 1 + 2);
        }
      }), Promise.resolve());
  });

  test('standard SQL says first that it is unverified', () => {
    const file = tmp('generic.sql');
    return feed(createSqlWriter(file, 'generic'), both).then(() => {
      const sql = fs.readFileSync(file, 'utf8');
      expect(sql.startsWith('-- Standard SQL. This database type is not one the generator knows'))
        .toBe(true);
      expect(sql).toContain('UNVERIFIED');
      expect(sql).not.toMatch(/BEGIN|COMMIT|START TRANSACTION/);
    });
  });

  test('a writer is used in order, and a file that cannot be written fails', () => {
    const writer = createSqlWriter(tmp('order.sql'), 'mysql');
    const code = promise => promise.then(() => 'no error', e => e.code);
    return code(writer.rows([[1]]))
      .then(c => expect(c).toBe('testdata.writer.noTable'))
      .then(() => code(writer.endTable()))
      .then(c => expect(c).toBe('testdata.writer.noTable'))
      .then(() => writer.beginTable(orders))
      .then(() => code(writer.beginTable(items)))
      .then(c => expect(c).toBe('testdata.writer.tableOpen'))
      .then(() => writer.close()) // closes the open table
      .then(result => expect(result.tables).toEqual([{ name: 'Orders', rows: 0 }]))
      .then(() => code(writer.beginTable(items)))
      .then(c => expect(c).toBe('testdata.writer.closed'))
      .then(() => expect(() => createSqlWriter(tmp('x.sql'), 'sybase')).toThrow('testdata.sql.dialect'))
      .then(() => code(feed(createSqlWriter(path.join(root, 'no-such-dir', 'x.sql'), 'mysql'), both)))
      .then(c => expect(c).toBe('ENOENT'));
  });
});

// ---------------------------------------------------------------- bundle for the database

describe('bundle for the Java tool', () => {
  test('manifest.json and NDJSON as the contract says', () => {
    const dir = tmp('bundle');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'manifest.json'), 'stale');
    const writer = createDbBundleWriter(dir, 'mssql');
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(false);
    return feed(writer, both, 2).then((result) => {
      expect(fs.readdirSync(dir).sort()).toEqual(['0001.ndjson', '0002.ndjson', 'manifest.json']);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      expect(manifest).toEqual({
        version: 1,
        dialect: 'mssql',
        tables: [
          {
            name: 'Orders',
            file: '0001.ndjson',
            rows: 3,
            columns: [{ name: 'Id', kind: 'int', autoIncrement: true }, { name: 'Name', kind: 'string' },
              { name: 'Amount', kind: 'decimal' }, { name: 'Created', kind: 'datetime' },
              { name: 'Paid', kind: 'bool' }],
            identityInsert: true,
          },
          {
            name: 'Order Items',
            file: '0002.ndjson',
            rows: 3,
            columns: [{ name: 'Order Id', kind: 'int' }, { name: 'Day', kind: 'date' },
              { name: 'Note', kind: 'string' }],
            identityInsert: false,
          },
        ],
      });
      expect(Object.keys(manifest.tables[0]))
        .toEqual(['name', 'file', 'rows', 'columns', 'identityInsert']);
      const text = fs.readFileSync(path.join(dir, '0001.ndjson'), 'utf8');
      expect(text.endsWith('\n')).toBe(true);
      expect(text.split('\n').slice(0, -1).map(line => JSON.parse(line))).toEqual(orderRows);
      expect(text.split('\n')[0]).toBe('[1,"O\'Brien",12.5,"2024-01-31 10:00:00",true]');
      // a line break inside a value never breaks a line of the file
      expect(text.split('\n')).toHaveLength(4);
      expect(fs.readFileSync(path.join(dir, '0002.ndjson'), 'utf8').split('\n').slice(0, -1)
        .map(line => JSON.parse(line))).toEqual(itemRows);
      expect(result.manifest).toBe(path.join(dir, 'manifest.json'));
      expect(result.rows).toBe(6);
      expect(result.tables).toEqual(manifest.tables);
    });
  });

  test('identityInsert only on SQL Server, only when the identity column is written', () => {
    const byDatabase = { ...orders, columns: orders.columns.slice(1) };
    const identity = (dialect, table) => feed(createDbBundleWriter(tmp(`b-${dialect}-${
      table.columns.length}`), dialect), [[table, []]])
      .then(result => [result.tables[0].identityInsert, result.tables[0].rows]);
    return Promise.all([identity('mssql', orders), identity('mssql', byDatabase),
      identity('mysql', orders), identity('postgresql', orders), identity('oracle', orders),
      identity('generic', orders), identity(undefined, orders)])
      .then(all => expect(all).toEqual([[true, 0], [false, 0], [false, 0], [false, 0], [false, 0],
        [false, 0], [false, 0]]));
  });

  test('a value JSON cannot carry becomes null, a short row is filled up', () => {
    const dir = tmp('bundle-odd');
    return feed(createDbBundleWriter(dir, 'mysql'), [[orders, [[1, undefined, NaN, Infinity], [2]]]])
      .then(() => {
        expect(fs.readFileSync(path.join(dir, '0001.ndjson'), 'utf8'))
          .toBe('[1,null,null,null,null]\n[2,null,null,null,null]\n');
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).dialect)
          .toBe('mysql');
      });
  });
});
