import fs from 'fs';
import os from 'os';
import path from 'path';
import { runAll, createControl } from '../src/app/container/tools/testdata/generate/run';
import {
  sqlSink, csvSink, xlsxSink, dbSink, existingTargets, targetProblem, csvFileNames,
} from '../src/app/container/tools/testdata/generate/outputs';


// ---- the run -------------------------------------------------------------------
const tick = () => new Promise(resolve => setImmediate(resolve));
const fakeRun = ({
  batches = 3, failAt = null, slow = false,
} = {}) => {
  const log = [];
  const plan = { tables: [{ entityId: 'a', defKey: 'A' }, { entityId: 'b', defKey: 'B' }] };
  const generator = {
    table: async (entityId, { onBatch, shouldStop }) => {
      for (let i = 1; i <= batches; i += 1) {
        if (shouldStop()) {
          return { rows: (i - 1) * 2, stopped: true };
        }
        log.push(`gen ${entityId} ${i}`);
        // eslint-disable-next-line no-await-in-loop
        await onBatch([[i], [i]], i * 2, batches * 2);
      }
      return { rows: batches * 2, stopped: false };
    },
  };
  const sink = (key) => {
    let rows = 0;
    const step = async (what) => {
      log.push(`${key} ${what} start`);
      if (slow) {
        await tick();
        await tick();
      }
      if (failAt === `${key} ${what}`) {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      }
      log.push(`${key} ${what} end`);
    };
    return {
      key,
      create: () => {
        log.push(`${key} create`);
        if (failAt === `${key} create`) {
          throw Object.assign(new Error('no access'), { code: 'EACCES' });
        }
        return {
          beginTable: t => step(`begin ${t.entityId}`),
          rows: (list) => {
            rows += list.length;
            return step('rows');
          },
          endTable: () => step('end'),
          close: async () => {
            await step('close');
            return { rows };
          },
        };
      },
      commit: async (result) => {
        log.push(`${key} commit`);
        if (failAt === `${key} commit`) {
          throw new Error('rename failed');
        }
        return { kind: key, rows: result.rows, dir: `/tmp/${key}` };
      },
      discard: () => log.push(`${key} discard`),
    };
  };
  return { log, plan, generator, sink };
};

describe('one run feeds every output from the same rows', () => {
  test('tables in plan order; each batch is taken by every writer before the next is made',
    async () => {
      const {
        log, plan, generator, sink,
      } = fakeRun({ batches: 2, slow: true });
      const events = [];
      const result = await runAll({
        plan, generator, sinks: [sink('sql'), sink('csv')], onEvent: e => events.push(e),
      });
      expect(result.status).toBe('done');
      expect(result.stage).toBe('finish');
      expect(result.tables).toEqual([{ entityId: 'a', defKey: 'A', rows: 4 },
        { entityId: 'b', defKey: 'B', rows: 4 }]);
      expect(result.outputs.sql).toEqual({ kind: 'sql', rows: 8, dir: '/tmp/sql' });
      expect(result.outputs.csv.rows).toBe(8);
      // every call ended before the next one began: nothing overlaps
      const calls = log.filter(l => / (start|end)$/.test(l));
      for (let i = 0; i < calls.length; i += 2) {
        expect(calls[i + 1]).toBe(calls[i].replace(/start$/, 'end'));
      }
      const order = log.filter(l => !/ start$/.test(l)).map(l => l.replace(/ end$/, ''));
      expect(order).toEqual([
        'sql create', 'csv create',
        'sql begin a', 'csv begin a',
        'gen a 1', 'sql rows', 'csv rows', 'gen a 2', 'sql rows', 'csv rows',
        'sql end', 'csv end',
        'sql begin b', 'csv begin b',
        'gen b 1', 'sql rows', 'csv rows', 'gen b 2', 'sql rows', 'csv rows',
        'sql end', 'csv end',
        'sql close', 'csv close', 'sql commit', 'csv commit',
      ]);
      expect(log.some(l => / discard$/.test(l))).toBe(false);
      expect(events.filter(e => e.type === 'stage').map(e => e.stage)).toEqual(['generate', 'finish']);
      expect(events.filter(e => e.type === 'rows' && e.entityId === 'a')
        .map(e => [e.done, e.total])).toEqual([[2, 4], [4, 4]]);
      expect(events.filter(e => e.type === 'table').map(e => `${e.entityId} ${e.state}`))
        .toEqual(['a running', 'a done', 'b running', 'b done']);
    });
  test('cancel: writers are closed, every output is taken away, nothing is put in place',
    async () => {
      const {
        log, plan, generator, sink,
      } = fakeRun({ batches: 5 });
      const control = createControl();
      const result = await runAll({
        plan,
        generator,
        sinks: [sink('sql'), sink('xlsx')],
        control,
        onEvent: (e) => {
          if (e.type === 'rows' && e.entityId === 'a' && e.done === 4) {
            control.cancel();
          }
        },
      });
      expect(result.status).toBe('cancelled');
      expect(result.stage).toBe('generate');
      expect(result.outputs).toEqual({});
      expect(log).not.toContain('gen a 3');
      expect(log).not.toContain('gen b 1');
      expect(log.filter(l => / commit$/.test(l))).toEqual([]);
      expect(log.filter(l => / close end$/.test(l))).toEqual(['sql close end', 'xlsx close end']);
      expect(log.slice(-2)).toEqual(['sql discard', 'xlsx discard']);
    });
  test('a writer that fails stops the run and leaves nothing behind', async () => {
    const {
      log, plan, generator, sink,
    } = fakeRun({ failAt: 'csv rows' });
    const result = await runAll({ plan, generator, sinks: [sink('sql'), sink('csv')] });
    expect(result.status).toBe('failed');
    expect(result.stage).toBe('generate');
    expect(result.error.code).toBe('ENOSPC');
    expect(result.outputs).toEqual({});
    expect(log).not.toContain('gen a 2');
    expect(log.filter(l => / commit$/.test(l))).toEqual([]);
    expect(log.filter(l => / discard$/.test(l))).toEqual(['sql discard', 'csv discard']);
  });
  test('a generator error and a sink that cannot be made are cleaned up the same way',
    async () => {
      const first = fakeRun();
      first.generator.table = async () => {
        throw Object.assign(new Error('no more values'), { code: 'uniqueExhausted' });
      };
      const a = await runAll({
        plan: first.plan, generator: first.generator, sinks: [first.sink('sql')],
      });
      expect([a.status, a.stage, a.error.code]).toEqual(['failed', 'generate', 'uniqueExhausted']);
      expect(first.log.slice(-1)).toEqual(['sql discard']);
      const second = fakeRun({ failAt: 'csv create' });
      const b = await runAll({
        plan: second.plan, generator: second.generator, sinks: [second.sink('sql'), second.sink('csv')],
      });
      expect([b.status, b.stage, b.error.code]).toEqual(['failed', 'generate', 'EACCES']);
      expect(second.log.filter(l => / discard$/.test(l))).toEqual(['sql discard', 'csv discard']);
      expect(second.log).not.toContain('gen a 1');
    });
  test('a file that cannot be put in place: what is in place stays, the rest goes', async () => {
    const {
      log, plan, generator, sink,
    } = fakeRun({ failAt: 'csv commit' });
    const result = await runAll({
      plan, generator, sinks: [sink('sql'), sink('csv'), sink('xlsx')],
    });
    expect([result.status, result.stage]).toEqual(['failed', 'finish']);
    expect(Object.keys(result.outputs)).toEqual(['sql']);
    expect(log.filter(l => / discard$/.test(l))).toEqual(['csv discard', 'xlsx discard']);
  });
  test('the database is written after the files and its bundle never outlives the run',
    async () => {
      const {
        log, plan, generator, sink,
      } = fakeRun({ batches: 1 });
      const result = await runAll({
        plan,
        generator,
        sinks: [sink('sql'), sink('db')],
        database: {
          sink: 'db',
          write: (info) => {
            log.push(`write ${info.dir}`);
            return {
              promise: Promise.resolve({ tables: [{ name: 'A', written: 2, failed: 0 }] }),
              cancel: () => log.push('write cancel'),
            };
          },
        },
      });
      expect([result.status, result.stage]).toEqual(['done', 'database']);
      expect(result.database.tables[0].written).toBe(2);
      expect(Object.keys(result.outputs)).toEqual(['sql']);
      expect(log.slice(-4)).toEqual(['sql commit', 'db commit', 'write /tmp/db', 'db discard']);
    });
  test('a failed or cancelled database write keeps the files and removes the bundle',
    async () => {
      const failing = fakeRun({ batches: 1 });
      const failed = await runAll({
        plan: failing.plan,
        generator: failing.generator,
        sinks: [failing.sink('csv'), failing.sink('db')],
        database: {
          sink: 'db',
          write: () => ({
            promise: Promise.reject(Object.assign(new Error('dup'), {
              code: 'CONSTRAINT', table: 'A', row: 1,
            })),
            cancel: () => {},
          }),
        },
      });
      expect([failed.status, failed.stage, failed.error.code])
        .toEqual(['failed', 'database', 'CONSTRAINT']);
      expect(Object.keys(failed.outputs)).toEqual(['csv']);
      expect(failing.log.slice(-1)).toEqual(['db discard']);
      expect(failing.log).not.toContain('csv discard');

      const stopping = fakeRun({ batches: 1 });
      const control = createControl();
      let reject;
      const cancelled = await runAll({
        plan: stopping.plan,
        generator: stopping.generator,
        sinks: [stopping.sink('db')],
        control,
        onEvent: (e) => {
          if (e.type === 'stage' && e.stage === 'database') {
            setImmediate(() => control.cancel());
          }
        },
        database: {
          sink: 'db',
          write: () => ({
            promise: new Promise((res, rej) => {
              reject = rej;
            }),
            cancel: () => {
              stopping.log.push('write cancel');
              reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }));
            },
          }),
        },
      });
      expect([cancelled.status, cancelled.stage]).toEqual(['cancelled', 'database']);
      expect(stopping.log.slice(-2)).toEqual(['write cancel', 'db discard']);
      expect(control.abort).toBeNull();
    });
});

// ---- real files ------------------------------------------------------------------
describe('outputs on disk', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mypd-td-ui-'));
  });
  afterEach(() => {
    fs.rmdirSync(dir, { recursive: true });
  });
  const table = {
    entityId: 't',
    defKey: 'T1',
    columns: [{ id: 'c', defKey: 'ID', kind: 'int', type: 'INT' },
      { id: 'n', defKey: 'NAME', kind: 'string', type: 'VARCHAR', len: 20 }],
  };
  const plan = { tables: [table] };
  const generator = rows => ({
    table: async (id, { onBatch }) => {
      await onBatch(rows, rows.length, rows.length);
      return { rows: rows.length, stopped: false };
    },
  });
  const listAll = d => fs.readdirSync(d).sort();

  test('files appear under their names only when the run got through', async () => {
    const sql = path.join(dir, 'out', 'data.sql');
    const xlsx = path.join(dir, 'out', 'data.xlsx');
    const csv = path.join(dir, 'out', 'csv');
    const result = await runAll({
      plan,
      generator: generator([[1, 'a'], [2, 'b']]),
      sinks: [sqlSink(sql, 'postgresql', {}), csvSink(csv), xlsxSink(xlsx)],
    });
    expect(result.status).toBe('done');
    expect(listAll(path.join(dir, 'out'))).toEqual(['csv', 'data.sql', 'data.xlsx']);
    expect(listAll(csv)).toEqual(['T1.csv']);
    expect(fs.readFileSync(sql, 'utf8')).toContain('INSERT INTO');
    expect(fs.readFileSync(path.join(csv, 'T1.csv'), 'utf8')).toBe('﻿ID,NAME\r\n1,a\r\n2,b\r\n');
    expect(result.outputs.sql.bytes).toBe(fs.statSync(sql).size);
    expect(result.outputs.csv.files).toEqual([{
      table: 'T1', file: path.join(csv, 'T1.csv'), rows: 2, bytes: 22,
    }]);
    expect(result.outputs.xlsx.rows).toBe(2);
  });
  test('a cancelled run removes its files, the folders it made, and keeps old files',
    async () => {
      const sql = path.join(dir, 'data.sql');
      const csv = path.join(dir, 'new', 'csv');
      fs.writeFileSync(sql, 'old content');
      const control = createControl();
      const result = await runAll({
        plan,
        generator: {
          table: async (id, { onBatch, shouldStop }) => {
            await onBatch([[1, 'a']], 1, 2);
            control.cancel();
            return { rows: 1, stopped: shouldStop() };
          },
        },
        sinks: [sqlSink(sql, 'mysql', {}), csvSink(csv), xlsxSink(path.join(dir, 'x', 'd.xlsx'))],
        control,
      });
      expect(result.status).toBe('cancelled');
      expect(listAll(dir)).toEqual(['data.sql']);
      expect(fs.readFileSync(sql, 'utf8')).toBe('old content');
    });
  test('a failed run removes its files as well', async () => {
    const sql = path.join(dir, 'data.sql');
    const result = await runAll({
      plan,
      generator: {
        table: async (id, { onBatch }) => {
          await onBatch([[1, 'a']], 1, 2);
          throw Object.assign(new Error('boom'), { code: 'uniqueExhausted' });
        },
      },
      sinks: [sqlSink(sql, 'mssql', {}), csvSink(path.join(dir, 'csv'))],
    });
    expect(result.status).toBe('failed');
    expect(listAll(dir)).toEqual([]);
  });
  test('the bundle for the database lives in a private folder that is removed', async () => {
    let seen = '';
    const result = await runAll({
      plan,
      generator: generator([[1, 'a']]),
      sinks: [dbSink('postgresql', dir)],
      database: {
        sink: 'db',
        write: (info) => {
          seen = info.dir;
          expect(listAll(info.dir)).toEqual(['0001.ndjson', 'manifest.json']);
          return { promise: Promise.resolve({ tables: [] }), cancel: () => {} };
        },
      },
    });
    expect(result.status).toBe('done');
    expect(path.dirname(seen)).toBe(dir);
    expect(fs.existsSync(seen)).toBe(false);
    expect(listAll(dir)).toEqual([]);
  });
  test('files that would be replaced are found before the run', () => {
    const sql = path.join(dir, 'a.sql');
    fs.writeFileSync(sql, '');
    fs.mkdirSync(path.join(dir, 'csv'));
    fs.writeFileSync(path.join(dir, 'csv', 'T1.csv'), '');
    expect(existingTargets({
      sql, xlsx: path.join(dir, 'a.xlsx'), csv: path.join(dir, 'csv'),
    }, [table, { defKey: 'T2' }])).toEqual([sql, path.join(dir, 'csv', 'T1.csv')]);
    expect(existingTargets({}, [table])).toEqual([]);
    expect(csvFileNames([{ defKey: 'a/b' }, { defKey: 'A_B' }, { defKey: 'a_b' }]))
      .toEqual(['a_b.csv', 'A_B_2.csv', 'a_b_3.csv']);
  });
  test('a target that cannot work is told before the run', () => {
    const file = path.join(dir, 'f.txt');
    fs.writeFileSync(file, '');
    expect(targetProblem('', 'file')).toBe('empty');
    expect(targetProblem('out.sql', 'file')).toBe('relative');
    expect(targetProblem(dir, 'file')).toBe('isDirectory');
    expect(targetProblem(file, 'dir')).toBe('isFile');
    expect(targetProblem(path.join(file, 'x.sql'), 'file')).toBe('parentIsFile');
    expect(targetProblem(path.join(dir, 'new', 'deep', 'x.sql'), 'file')).toBe('');
    expect(targetProblem(path.join(dir, 'csv'), 'dir')).toBe('');
  });
});
