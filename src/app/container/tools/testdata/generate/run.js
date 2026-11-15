// One run: every planned table is generated once and its rows go to all chosen outputs,
// so the files and the database get the same data. No file access here: the outputs come
// in as sinks (see outputs.js), which keeps the order of events testable.
//
// sink = {
//   key,                    'sql' | 'csv' | 'xlsx' | 'db'
//   create() -> writer      {beginTable, rows, endTable, close, abort}, every call a
//                           promise; abort() stops at once and removes what was written
//   commit(result) -> info  called when all rows are written: puts the output in place
//   discard()               removes everything the sink made (also after commit for 'db')
// }
// database = { sink: 'db', write(info) -> {promise, cancel} }   optional last stage
// control  = { cancelled: bool, abort: fn|null }   set `cancelled` (and call `abort`) to stop
//
// Resolves, never rejects:
// { status: 'done' | 'cancelled' | 'failed', stage: 'generate' | 'finish' | 'database',
//   tables: [{entityId, defKey, rows}], outputs: {[key]: info}, database?, error?, elapsed }
// A run that stops before its files are complete leaves no file behind. Once the files are
// complete they stay, whatever happens to the database afterwards.

const quiet = async (fn) => {
  try {
    await fn();
  } catch (e) {
    // already failing: the first error is the one to report
  }
};

const eachInTurn = async (list, fn) => {
  for (let i = 0; i < list.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await fn(list[i], i);
  }
};

export const createControl = () => ({
  cancelled: false,
  abort: null,
  cancel() {
    this.cancelled = true;
    if (this.abort) {
      this.abort();
    }
  },
});

const generateAll = async ({
  plan, generator, batchSize, onEvent, control,
}, open) => {
  const tables = [];
  let cancelled = false;
  await eachInTurn(plan.tables, async (table) => {
    if (cancelled || control.cancelled) {
      cancelled = true;
      return;
    }
    onEvent({
      type: 'table', entityId: table.entityId, state: 'running',
    });
    await eachInTurn(open, o => o.writer.beginTable(table));
    const result = await generator.table(table.entityId, {
      batchSize,
      shouldStop: () => control.cancelled,
      onBatch: async (rows, done, total) => {
        await eachInTurn(open, o => o.writer.rows(rows));
        onEvent({
          type: 'rows', entityId: table.entityId, done, total,
        });
      },
    });
    if (result.stopped || control.cancelled) {
      cancelled = true;
      return;
    }
    await eachInTurn(open, o => o.writer.endTable());
    tables.push({
      entityId: table.entityId,
      defKey: table.defKey,
      rows: result.rows,
    });
    onEvent({
      type: 'table', entityId: table.entityId, state: 'done', rows: result.rows,
    });
  });
  return {
    tables,
    cancelled,
  };
};

export const runAll = async ({
  plan, generator, sinks = [], database = null, batchSize = 1000, onEvent = () => {},
  control = createControl(), now = () => Date.now(),
}) => {
  const started = now();
  const open = [];
  const outputs = {};
  let tables = [];
  const end = (status, stage, more = {}) => ({
    status,
    stage,
    tables,
    outputs,
    ...more,
    elapsed: now() - started,
  });
  // a writer is stopped where it stands (never finished first), then its files go
  const stop = (o) => {
    if (!o.closed && !o.stopping) {
      Object.assign(o, {
        stopping: quiet(() => (o.writer.abort ? o.writer.abort() : o.writer.close())),
      });
    }
    return o.stopping || null;
  };
  const stopAll = () => Promise.all(open.map(stop));
  const dropAll = async () => {
    await stopAll();
    // last made first: a folder two outputs share was made by the first of them
    sinks.slice().reverse().forEach(s => quiet(() => s.discard()));
  };
  // "cancel" reaches a writer in the middle of a write or of its close
  let aborted = false;
  Object.assign(control, {
    abort: () => {
      aborted = true;
      return stopAll();
    },
  });
  // ---- the rows
  onEvent({
    type: 'stage', stage: 'generate',
  });
  try {
    sinks.forEach((sink) => {
      open.push({
        sink,
        writer: sink.create(),
        closed: false,
      });
    });
    const made = await generateAll({
      plan, generator, batchSize, onEvent, control,
    }, open);
    ({ tables } = made);
    if (made.cancelled) {
      await dropAll();
      Object.assign(control, { abort: null });
      return end('cancelled', 'generate');
    }
  } catch (error) {
    await dropAll();
    Object.assign(control, { abort: null });
    return control.cancelled ? end('cancelled', 'generate') : end('failed', 'generate', { error });
  }
  // ---- the files
  onEvent({
    type: 'stage', stage: 'finish',
  });
  try {
    await eachInTurn(open, async (o) => {
      const result = await o.writer.close();
      Object.assign(o, {
        closed: true,
        result,
      });
    });
    // the files are whole: putting them in place is a rename, nothing to interrupt
    Object.assign(control, { abort: null });
    await eachInTurn(open, async (o) => {
      outputs[o.sink.key] = await o.sink.commit(o.result);
      Object.assign(o, { committed: true });
    });
  } catch (error) {
    await stopAll();
    Object.assign(control, { abort: null });
    // what is already in place stays and is reported; the rest is taken away
    open.filter(o => !o.committed || o.sink.key === (database && database.sink)).reverse()
      .forEach(o => quiet(() => o.sink.discard()));
    return aborted ? end('cancelled', 'finish') : end('failed', 'finish', { error });
  }
  Object.assign(control, { abort: null });
  if (!database) {
    return end('done', 'finish');
  }
  // ---- the database
  const bundle = open.find(o => o.sink.key === database.sink);
  try {
    if (control.cancelled) {
      return end('cancelled', 'database');
    }
    onEvent({
      type: 'stage', stage: 'database',
    });
    const handle = database.write(outputs[database.sink]);
    Object.assign(control, { abort: handle.cancel });
    if (control.cancelled) {
      handle.cancel();
    }
    const written = await handle.promise;
    return end('done', 'database', { database: written });
  } catch (error) {
    const stopped = control.cancelled || (error && error.code === 'CANCELLED');
    return end(stopped ? 'cancelled' : 'failed', 'database', { error });
  } finally {
    Object.assign(control, { abort: null });
    delete outputs[database.sink];
    if (bundle) {
      await quiet(() => bundle.sink.discard());
    }
  }
};
