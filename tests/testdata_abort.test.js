import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSqlWriter, createDbBundleWriter, createSink } from '../src/lib/testdata/files';
import { createCsvWriter } from '../src/lib/testdata/csv';
import { createXlsxWriter } from '../src/lib/testdata/xlsx';
import { runAll, createControl } from '../src/app/container/tools/testdata/generate/run';
import {
  sqlSink, csvSink, xlsxSink, dbSink,
} from '../src/app/container/tools/testdata/generate/outputs';

// Stopping a writer: at once, whatever it is doing, and nothing of it stays on disk.
let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-abort-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const table = {
  entityId: 't',
  defKey: 'T',
  columns: [{ defKey: 'ID', kind: 'int' }, { defKey: 'NAME', kind: 'string' }],
};
const rowsOf = (n, from = 0) => Array.from({ length: n }, (v, i) => [from + i,
  `name ${from + i} ${'x'.repeat(200)}`]);
const left = () => fs.readdirSync(dir).sort();
const codeOf = promise => promise.then(() => 'resolved', e => e.code || `${e}`);
const xlsxTemps = () => fs.readdirSync(dir).filter(n => n.startsWith('mypd-xlsx-'));

const WRITERS = {
  sql: () => createSqlWriter(path.join(dir, 'out.sql'), 'mysql'),
  csv: () => createCsvWriter(dir),
  xlsx: () => createXlsxWriter(path.join(dir, 'out.xlsx'), { tempDir: dir }),
  db: () => createDbBundleWriter(dir, 'mysql'),
};

describe('abort of a writer', () => {
  Object.keys(WRITERS).forEach((kind) => {
    test(`${kind}: in the middle of a table nothing is left and nothing more is taken`, async () => {
      const writer = WRITERS[kind]();
      await writer.beginTable(table);
      await writer.rows(rowsOf(2000));
      // a write that is still under way when the stop comes
      const pending = codeOf(writer.rows(rowsOf(20000, 2000)));
      const before = Date.now();
      await writer.abort();
      expect(Date.now() - before).toBeLessThan(1500);
      expect(['resolved', 'testdata.writer.aborted']).toContain(await pending);
      expect(left()).toEqual([]);
      expect(['testdata.writer.closed', 'testdata.writer.aborted'])
        .toContain(await codeOf(writer.rows(rowsOf(1))));
      expect(['testdata.writer.closed', 'testdata.writer.aborted'])
        .toContain(await codeOf(writer.close()));
      // a second stop is the first one
      await writer.abort();
      expect(left()).toEqual([]);
    });

    test(`${kind}: while it is being closed`, async () => {
      const writer = WRITERS[kind]();
      await writer.beginTable(table);
      await writer.rows(rowsOf(30000));
      const closing = codeOf(writer.close());
      await writer.abort();
      const outcome = await closing;
      // the close either got through before the stop or was stopped; never hangs
      expect(['resolved', 'testdata.writer.aborted', 'testdata.writer.closed']).toContain(outcome);
      if (outcome !== 'resolved') {
        expect(left()).toEqual([]);
      }
      expect(xlsxTemps()).toEqual([]);
    });
  });

  test('before anything was written', async () => {
    const writers = Object.keys(WRITERS).map(kind => WRITERS[kind]());
    await Promise.all(writers.map(w => w.abort()));
    expect(left()).toEqual([]);
  });

  test('a sink that is destroyed rejects what waits for it, the end included', async () => {
    const sink = createSink(path.join(dir, 'a.bin'));
    const big = Buffer.alloc(4 * 1024 * 1024, 1);
    const writes = [sink.write(big), sink.write(big), sink.write(big), sink.end()].map(codeOf);
    await sink.destroy();
    const codes = await Promise.all(writes);
    expect(codes.slice(1)).toEqual(expect.arrayContaining(['testdata.writer.aborted']));
    expect(codes[3]).toBe('testdata.writer.aborted');
    expect(await codeOf(sink.write('x'))).toBe('testdata.writer.aborted');
  });
});

describe('a run that is cancelled or fails', () => {
  const plan = { tables: [{ ...table, entityId: 'a', defKey: 'A' }, { ...table, entityId: 'b', defKey: 'B' }] };
  const generator = (batches, onBatchNo) => ({
    table: async (entityId, { onBatch, shouldStop }) => {
      for (let i = 0; i < batches; i += 1) {
        if (shouldStop()) {
          return { rows: i * 1000, stopped: true };
        }
        onBatchNo && onBatchNo(entityId, i);
        // eslint-disable-next-line no-await-in-loop
        await onBatch(rowsOf(1000, i * 1000), (i + 1) * 1000, batches * 1000);
      }
      return { rows: batches * 1000, stopped: false };
    },
  });
  const sinks = () => [sqlSink(path.join(dir, 'out', 'x.sql'), 'mssql', {}),
    csvSink(path.join(dir, 'out', 'csv')), xlsxSink(path.join(dir, 'out', 'x.xlsx')),
    dbSink('mssql', dir)];
  const everything = () => {
    const all = [];
    const walk = (d) => {
      fs.readdirSync(d).forEach((name) => {
        const full = path.join(d, name);
        all.push(path.relative(dir, full));
        if (fs.statSync(full).isDirectory()) {
          walk(full);
        }
      });
    };
    walk(dir);
    return all;
  };

  test('cancel while rows are written: stopped at once, no file and no folder stays', async () => {
    const control = createControl();
    const result = await runAll({
      plan,
      generator: generator(40, (id, i) => id === 'b' && i === 3 && control.cancel()),
      sinks: sinks(),
      control,
    });
    expect([result.status, result.stage]).toEqual(['cancelled', 'generate']);
    expect(result.outputs).toEqual({});
    expect(everything()).toEqual([]);
    expect(control.abort).toBeNull();
  });

  test('cancel while the files are being finished: not finished first', async () => {
    const control = createControl();
    const result = await runAll({
      plan,
      generator: generator(30),
      sinks: sinks(),
      control,
      onEvent: e => e.type === 'stage' && e.stage === 'finish' && control.cancel(),
    });
    expect([result.status, result.stage]).toEqual(['cancelled', 'finish']);
    expect(result.outputs).toEqual({});
    expect(everything()).toEqual([]);
  });

  test('a failure in the middle takes every output away, the xlsx temp folder too', async () => {
    const before = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('mypd-xlsx-'));
    const failing = generator(5);
    const table0 = failing.table;
    failing.table = (id, options) => (id === 'b'
      ? Promise.reject(Object.assign(new Error('x'), { code: 'uniqueExhausted' }))
      : table0(id, options));
    const result = await runAll({ plan, generator: failing, sinks: sinks() });
    expect([result.status, result.stage, result.error.code])
      .toEqual(['failed', 'generate', 'uniqueExhausted']);
    expect(everything()).toEqual([]);
    expect(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('mypd-xlsx-'))).toEqual(before);
  });

  test('a run that gets through is untouched by all this', async () => {
    const result = await runAll({ plan, generator: generator(3), sinks: sinks().slice(0, 3) });
    expect(result.status).toBe('done');
    expect(everything().sort()).toEqual(['out', 'out/csv', 'out/csv/A.csv', 'out/csv/B.csv',
      'out/x.sql', 'out/x.xlsx']);
    expect(result.outputs.sql.rows).toBe(6000);
  });
});
