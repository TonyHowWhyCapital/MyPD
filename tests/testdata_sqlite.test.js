import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { createSqlWriter } from '../src/lib/testdata/files';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mypd-testdata-sqlite-'));
afterAll(() => fs.rmdirSync(root, { recursive: true }));
const tmp = name => path.join(root, name);

const BS = String.fromCharCode(92);

// the tables one after the other, the rows in pieces of `size`, every call awaited
const feed = (writer, tables, size = 1000) => tables.reduce((work, [table, rows]) => {
  let next = work.then(() => writer.beginTable(table));
  for (let i = 0; i < rows.length; i += size) {
    next = next.then(() => writer.rows(rows.slice(i, i + size)));
  }
  return next.then(() => writer.endTable());
}, Promise.resolve()).then(() => writer.close());

// ---------------------------------------------------------------- SQLite reads the script

const sqlite = spawnSync('sqlite3', ['-version']).status === 0;

(sqlite ? describe : describe.skip)('standard SQL in a real database (SQLite)', () => {
  const table = {
    defKey: 'Test Data',
    columns: [
      { defKey: 'Id', kind: 'int', autoIncrement: true },
      { defKey: 'order', kind: 'string' }, // a reserved word, quoted by the DDL below
      { defKey: 'Amount', kind: 'decimal' },
      { defKey: 'Day', kind: 'date' },
      { defKey: 'At', kind: 'datetime' },
      { defKey: 'Clock', kind: 'time' },
      { defKey: 'Flag', kind: 'bool' },
      { defKey: 'Raw', kind: 'binary' },
    ],
  };
  // No carriage return among the texts: standard SQL has no escape for it, it stands raw in
  // the literal, and the sqlite3 shell turns CR LF into LF while it reads its input.
  const texts = ["O'Brien", "'; DROP TABLE \"Test Data\"; --", `back${BS}slash${BS}`, 'line\nbreak\n;',
    '臺北市信義區 😀', '', '  padded  ', '"quoted"', "''", 'x'.repeat(50000), '-- comment', '/* c */',
    '%_&$', null];
  const rows = texts.map((text, i) => [i + 1, text, i % 2 ? -(i * 1.25) : i * 1000000.5,
    '2024-02-29', '2024-01-31 23:59:58', '08:05:00', i % 2 === 0, i % 3 ? '00ff10' : null]);

  test('every value arrives as it was generated', () => {
    const file = tmp('sqlite.sql');
    const db = tmp('sqlite.db');
    return feed(createSqlWriter(file, 'generic'), [[table, rows]], 5).then(() => {
      execFileSync('sqlite3', [db, 'CREATE TABLE "Test Data" (Id INTEGER PRIMARY KEY, "order" TEXT, '
        + 'Amount NUMERIC, Day TEXT, At TEXT, Clock TEXT, Flag INTEGER, Raw BLOB);']);
      const run = spawnSync('sqlite3', ['-bail', db], { input: fs.readFileSync(file) });
      expect(run.stderr.toString()).toBe('');
      expect(run.status).toBe(0);
      const back = JSON.parse(execFileSync('sqlite3', ['-json', db, 'SELECT Id, "order" AS t, Amount, '
        + 'Day, At, Clock, Flag, hex(Raw) AS raw, typeof(Raw) AS kind FROM "Test Data" ORDER BY Id;'],
      { maxBuffer: 64 * 1024 * 1024 }).toString());
      expect(back).toHaveLength(rows.length);
      back.forEach((row, i) => {
        expect(row.Id).toBe(rows[i][0]);
        expect(row.t).toBe(rows[i][1]);
        expect(row.Amount).toBe(rows[i][2]);
        expect([row.Day, row.At, row.Clock]).toEqual(['2024-02-29', '2024-01-31 23:59:58', '08:05:00']);
        expect(row.Flag).toBe(rows[i][6] ? 1 : 0);
        expect([row.raw, row.kind]).toEqual(rows[i][7] ? ['00FF10', 'blob'] : ['', 'null']);
      });
      const count = sql => execFileSync('sqlite3', [db, sql]).toString().trim();
      expect(count('SELECT count(*) FROM "Test Data" WHERE "order" IS NULL')).toBe('1');
      expect(count('SELECT count(*) FROM "Test Data" WHERE "order" = \'\'')).toBe('1');
    });
  });

  test('multi-row statements work too', () => {
    const file = tmp('sqlite-multi.sql');
    const db = tmp('sqlite-multi.db');
    const many = Array.from({ length: 1234 }, (v, i) => [i + 1, `r'${i}`, i / 8, null, null, null,
      true, null]);
    return feed(createSqlWriter(file, 'generic', { multiRow: true }), [[table, many]]).then(() => {
      execFileSync('sqlite3', [db, 'CREATE TABLE "Test Data" (Id INTEGER PRIMARY KEY, "order" TEXT, '
        + 'Amount NUMERIC, Day TEXT, At TEXT, Clock TEXT, Flag INTEGER, Raw BLOB);']);
      const run = spawnSync('sqlite3', ['-bail', db], { input: fs.readFileSync(file) });
      expect([run.stderr.toString(), run.status]).toEqual(['', 0]);
      expect(execFileSync('sqlite3', [db, 'SELECT count(*), sum(Id), max("order"), sum(Amount) '
        + 'FROM "Test Data";']).toString().trim()).toBe(`1234|761995|r'999|${(1233 * 1234) / 16}`);
      expect(fs.readFileSync(file, 'utf8').match(/^INSERT INTO/gm)).toHaveLength(3);
    });
  });
});
