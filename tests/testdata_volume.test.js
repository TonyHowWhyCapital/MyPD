import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createCsvWriter } from '../src/lib/testdata/csv';
import { createDbBundleWriter, createSqlWriter } from '../src/lib/testdata/files';
import { createXlsxWriter } from '../src/lib/testdata/xlsx';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mypd-testdata-volume-'));
afterAll(() => fs.rmdirSync(root, { recursive: true }));
const tmp = name => path.join(root, name);

// ---------------------------------------------------------------- volume

describe('200,000 rows', () => {
  const table = {
    defKey: 'Big',
    columns: [
      { defKey: 'Id', kind: 'int', autoIncrement: true },
      { defKey: 'Name', kind: 'string' },
      { defKey: 'City', kind: 'string' },
      { defKey: 'Amount', kind: 'decimal' },
      { defKey: 'Day', kind: 'date' },
      { defKey: 'At', kind: 'datetime' },
      { defKey: 'Flag', kind: 'bool' },
      { defKey: 'Note', kind: 'string' },
    ],
  };
  const TOTAL = 200000;
  const batch = from => Array.from({ length: 1000 }, (v, i) => {
    const n = from + i + 1;
    return [n, `王小明${n}`, '臺北市信義區', n / 100, '2024-02-29', '2024-01-31 23:59:58', n % 2 === 0,
      n % 5 ? `note ${n} with 'quotes' and, commas` : null];
  });
  const report = [];
  afterAll(() => process.stdout.write(`\n200,000 rows x 8 columns:\n${report.join('\n')}\n`));

  // memory is sampled while the rows go through: a writer that kept the table would grow
  // by far more than the limit
  const run = (name, writer, sizeOf) => {
    if (global.gc) {
      global.gc();
    }
    const start = process.memoryUsage().heapUsed;
    const started = Date.now();
    let peak = start;
    const sample = () => {
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    };
    let work = writer.beginTable(table);
    for (let from = 0; from < TOTAL; from += 1000) {
      work = work.then(() => writer.rows(batch(from))).then(sample);
    }
    return work.then(() => writer.endTable()).then(() => writer.close()).then((result) => {
      const mb = n => (n / 1048576).toFixed(1);
      report.push(`  ${name}: ${Date.now() - started} ms, ${mb(sizeOf(result))} MB written, `
        + `heap grew by at most ${mb(peak - start)} MB`);
      expect(result.rows).toBe(TOTAL);
      expect(peak - start).toBeLessThan(150 * 1048576);
      return result;
    });
  };
  const size = file => fs.statSync(file).size;

  test('SQL script', () => run('sql (mssql)', createSqlWriter(tmp('big.sql'), 'mssql'), r => r.bytes)
    .then(() => {
      const sql = fs.readFileSync(tmp('big.sql'), 'utf8');
      expect(sql.match(/^INSERT INTO/gm)).toHaveLength(200);
      expect(sql).toContain("\n  (200000, N'王小明200000', N'臺北市信義區', 2000, '20240229', "
        + "'2024-01-31T23:59:58', 1, NULL);\nGO\n");
    }), 60000);

  test('CSV', () => run('csv', createCsvWriter(tmp('big-csv')), r => size(r.files[0].path))
    .then((result) => {
      const text = fs.readFileSync(result.files[0].path, 'utf8');
      expect(text.split('\r\n')).toHaveLength(TOTAL + 2);
      expect(text.endsWith('200000,王小明200000,臺北市信義區,2000,2024-02-29,2024-01-31 23:59:58,1,\r\n'))
        .toBe(true);
    }), 60000);

  test('bundle', () => run('bundle', createDbBundleWriter(tmp('big-bundle'), 'mssql'),
    r => size(path.join(r.dir, r.tables[0].file))).then((result) => {
    expect(result.tables[0].rows).toBe(TOTAL);
    const lines = fs.readFileSync(path.join(result.dir, '0001.ndjson'), 'utf8').split('\n');
    expect(lines).toHaveLength(TOTAL + 1);
    expect(JSON.parse(lines[TOTAL - 1])).toEqual(batch(TOTAL - 1000)[999]);
  }), 60000);

  test('XLSX', () => run('xlsx', createXlsxWriter(tmp('big.xlsx'), { tempDir: root }), r => r.bytes)
    .then((result) => {
      expect(result.sheets).toEqual([{ name: 'Big', table: 'Big', rows: TOTAL }]);
      if (spawnSync('unzip', ['-v']).status === 0) {
        const check = spawnSync('unzip', ['-t', tmp('big.xlsx')]);
        expect(check.status).toBe(0);
        expect(check.stdout.toString()).toContain('No errors detected');
      }
      expect(fs.readdirSync(root).filter(n => n.startsWith('mypd-xlsx-'))).toEqual([]);
    }), 120000);
});
