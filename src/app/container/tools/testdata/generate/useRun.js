// Starts a run and keeps what the window shows of it: the state of every table, the
// stage, and the result at the end.
import { useEffect, useRef, useState } from 'react';
import { createGenerator } from '../../../../../lib/testdata/generate';
import { writeBundle } from '../../../../../lib/testdata/db';
import { runAll, createControl } from './run';
import {
  sqlSink, csvSink, xlsxSink, dbSink,
} from './outputs';
import { requestsOf } from './needs';
import { getProjectFile } from '../rules/projectFile';

const REDRAW = 150;

const snapshot = live => ({
  ...live,
  tables: live.tables.map(t => ({ ...t, db: { ...t.db } })),
});

const applyEvent = (live, event) => {
  const l = live;
  if (event.type === 'stage') {
    l.stage = event.stage;
    return;
  }
  const table = l.tables.find(t => t.entityId === event.entityId);
  if (!table) {
    return;
  }
  if (event.type === 'rows') {
    table.done = event.done;
    table.total = event.total;
  } else if (event.state === 'running') {
    table.state = 'running';
  } else {
    table.state = 'done';
    table.done = event.rows;
    table.total = event.rows;
    table.db.total = event.rows;
  }
};

// progress of the database tool: tables before the one at work are through
const applyDbProgress = (live, p) => {
  live.tables.forEach((t, i) => {
    const db = t.db;
    if (i < p.tableIndex && db.state !== 'done') {
      db.state = 'done';
      db.done = db.total;
    } else if (i === p.tableIndex && p.phase !== 'clear') {
      db.state = p.done >= p.total && p.total > 0 ? 'done' : 'running';
      db.done = p.done;
      db.total = p.total || db.total;
      db.written = p.written;
      db.failed = p.failed;
    }
  });
};

const settle = (live, result) => {
  const l = live;
  const mark = result.status === 'cancelled' ? 'stopped' : 'failed';
  const written = (result.database && result.database.tables) || [];
  l.tables.forEach((t) => {
    const table = t;
    if (table.state !== 'done') {
      table.state = table.state === 'running' ? mark : 'waiting';
    }
    const done = written.find(w => w.name === table.defKey);
    if (done) {
      table.db = {
        ...table.db,
        state: 'done',
        written: done.written,
        failed: done.failed,
        done: done.written + done.failed,
      };
    } else if (result.stage === 'database' && result.status !== 'done'
      && table.db.state !== 'waiting') {
      table.db.state = table.db.state === 'running' ? mark : table.db.state;
      // one transaction: what was written went with the rest
      if (l.options.onError !== 'skip') {
        table.db.state = mark;
        table.db.written = 0;
        table.db.undone = true;
      }
    }
  });
  l.status = 'finished';
  l.result = result;
};

export default () => {
  const [run, setRun] = useState(null);
  const ref = useRef({
    control: null,
    live: null,
    waiting: [],
  });
  useEffect(() => () => {
    // the window is gone: nothing may go on writing
    if (ref.current.control) {
      ref.current.control.cancel();
    }
  }, []);
  // job = { view, plan, seed, config, loader, connKey, conn, dialect, connDialect,
  //         targets: {sql, csv, xlsx}, sqlOptions, db: {existing, onError} | null }
  const start = async (job) => {
    const control = createControl();
    const live = {
      status: 'loading',
      stage: 'load',
      withDb: !!job.db,
      options: job.db || {},
      result: null,
      tables: job.plan.tables.map(t => ({
        entityId: t.entityId,
        defKey: t.defKey,
        state: 'waiting',
        done: 0,
        total: t.rows || 0,
        db: {
          state: 'waiting', done: 0, total: 0, written: 0, failed: 0,
        },
      })),
    };
    let dirty = false;
    Object.assign(ref.current, {
      control,
      live,
    });
    setRun(snapshot(live));
    const timer = setInterval(() => {
      if (dirty) {
        dirty = false;
        setRun(snapshot(live));
      }
    }, REDRAW);
    const started = Date.now();
    const stopped = (stage, more) => ({
      status: control.cancelled ? 'cancelled' : 'failed',
      stage,
      tables: [],
      outputs: {},
      ...more,
    });
    let result;
    try {
      // A run reads its lists, query results and parent keys anew: what a preview read a
      // while ago may be out of date (a file edited since, rows a run before this one
      // wrote into the database).
      job.loader.clear();
      const loaded = await job.loader.load(requestsOf(job.view, job.plan, job.connKey,
        getProjectFile()));
      if (control.cancelled) {
        result = stopped('generate');
      } else if (loaded.errors.length > 0) {
        result = stopped('load', { loadErrors: loaded.errors });
      } else if (job.recheck && job.recheck(loaded.lists).length > 0) {
        result = stopped('load', { problems: job.recheck(loaded.lists) });
      } else {
        const generator = createGenerator(job.view, job.plan, {
          seed: job.seed,
          lists: loaded.lists,
          parentKeys: loaded.parentKeys,
          now: job.now || new Date(),
        });
        const sinks = [];
        if (job.targets.sql) {
          sinks.push(sqlSink(job.targets.sql, job.dialect, job.sqlOptions));
        }
        if (job.targets.csv) {
          sinks.push(csvSink(job.targets.csv));
        }
        if (job.targets.xlsx) {
          sinks.push(xlsxSink(job.targets.xlsx));
        }
        if (job.db) {
          sinks.push(dbSink(job.connDialect));
        }
        live.status = 'running';
        result = await runAll({
          plan: job.plan,
          generator,
          sinks,
          control,
          database: job.db ? {
            sink: 'db',
            write: info => writeBundle(job.view, job.config, job.conn, info.dir, {
              existing: job.db.existing,
              onError: job.db.onError,
              onProgress: (p) => {
                applyDbProgress(live, p);
                dirty = true;
              },
            }),
          } : null,
          onEvent: (event) => {
            applyEvent(live, event);
            dirty = true;
          },
        });
      }
    } catch (error) {
      result = stopped('generate', { error });
    }
    clearInterval(timer);
    if (job.db) {
      // the database is not what the previews read any more
      job.loader.clear();
    }
    settle(live, {
      ...result,
      elapsed: Date.now() - started,
    });
    ref.current.control = null;
    setRun(snapshot(live));
    ref.current.waiting.splice(0).forEach(fn => fn());
  };
  const active = () => !!ref.current.control;
  return {
    run,
    start,
    active,
    cancel: () => {
      const { control, live } = ref.current;
      if (control && !control.cancelled) {
        control.cancel();
        live.status = 'cancelling';
        setRun(snapshot(live));
      }
    },
    // calls fn once no run is at work (at once when none is)
    whenIdle: fn => (active() ? ref.current.waiting.push(fn) : fn()),
    reset: () => setRun(null),
  };
};
