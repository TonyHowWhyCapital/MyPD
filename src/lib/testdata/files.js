// Streaming writers for generated test data: the SQL script and the bundle the Java tool
// loads into a database. A writer gets one table after the other:
//   beginTable(table) -> rows(rows) ... -> endTable() -> ... -> close()
// abort() instead of close() stops at once, whatever is under way (a write, the close
// itself), and removes every file the writer made; its promise resolves when that is done.
// Every call returns a promise; the one of rows() settles when the file has taken the
// data (backpressure), so a caller that waits for it never piles up a table in memory.
import fs from 'fs';
import path from 'path';
import {
  checkDialect, insertStatements, rowsPerStatement, sqlBatch, sqlFileEpilogue, sqlFileHeader,
  sqlFilePrelude, tableComment, tableEpilogue, tablePrelude, writesIdentity,
} from './sql';

const READY = Promise.resolve();

export const writerError = (code, detail) => {
  const error = new Error(`${code}${detail ? `: ${detail}` : ''}`);
  error.code = code;
  return error;
};

// ---------------------------------------------------------------- file sink

// resolves when every stream has let go of its file (so that the file can be removed on
// Windows too), or after a moment when one of them never says so
const CLOSED = new WeakSet();
// a stream made here, remembered once it has closed its file
export const tracked = (stream) => {
  stream.once('close', () => CLOSED.add(stream));
  return stream;
};

export const streamsClosed = (streams, patience = 2000) => Promise.all(streams.map(stream => (
  new Promise((resolve) => {
    if (!stream || CLOSED.has(stream)) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, patience);
    stream.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  }))));

// A file write stream whose write() tells when to go on. destroy() stops at once: what
// waits for the stream is rejected with `testdata.writer.aborted`, and the promise it
// returns resolves when the file is closed.
export const createSink = (filePath) => {
  const stream = tracked(fs.createWriteStream(filePath));
  let failure = null;
  let waiters = [];
  let ending = null;
  const settle = () => {
    const list = waiters;
    waiters = [];
    list.forEach(w => (failure ? w.reject(failure) : w.resolve()));
  };
  const fail = (e) => {
    failure = failure || e;
    settle();
    if (ending) {
      ending.reject(failure);
    }
  };
  stream.on('error', fail);
  stream.on('drain', settle);
  return {
    write: (chunk) => {
      if (failure) {
        return Promise.reject(failure);
      }
      if (!chunk || chunk.length === 0 || stream.write(chunk)) {
        return READY;
      }
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    // resolves with the size of the file
    end: () => new Promise((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      ending = { reject };
      stream.once('finish', () => resolve(stream.bytesWritten));
      stream.end();
    }),
    destroy: () => {
      fail(writerError('testdata.writer.aborted'));
      stream.destroy();
      return streamsClosed([stream]);
    },
  };
};

export const removeQuietly = (file) => {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    // it was not there
  }
};

// ---------------------------------------------------------------- names

const RESERVED_FILE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

// A file name (without extension) made from a table name: no path separators, nothing
// Windows or macOS refuses, never empty and not used twice (`used` holds lower case names).
export const safeFileName = (name, used) => {
  let base = `${name === undefined || name === null ? '' : name}`
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F<>:"/\\|?*]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  base = Array.from(base).slice(0, 80).join('') || 'table';
  if (RESERVED_FILE.test(base)) {
    base = `_${base}`;
  }
  if (!used) {
    return base;
  }
  let result = base;
  for (let n = 2; used.has(result.toLowerCase()); n += 1) {
    result = `${base}_${n}`;
  }
  used.add(result.toLowerCase());
  return result;
};

// Shared bookkeeping of the writers: which table is open, how many rows it got.
export const createTableState = () => {
  let current = null;
  let closed = false;
  const done = [];
  return {
    begin: (table, extra) => {
      if (closed) {
        throw writerError('testdata.writer.closed');
      }
      if (current) {
        throw writerError('testdata.writer.tableOpen', current.table.defKey);
      }
      if (!table || !Array.isArray(table.columns)) {
        throw writerError('testdata.writer.table');
      }
      current = { table, rows: 0, ...extra };
      return current;
    },
    current: () => {
      if (!current) {
        throw writerError(closed ? 'testdata.writer.closed' : 'testdata.writer.noTable');
      }
      return current;
    },
    isOpen: () => !!current,
    end: (summary) => {
      done.push(summary);
      current = null;
    },
    close: () => {
      if (closed) {
        throw writerError('testdata.writer.closed');
      }
      closed = true;
    },
    // after abort() nothing more is taken; -> the table that was open, if any
    abort: () => {
      const open = current;
      closed = true;
      current = null;
      return open;
    },
    done,
  };
};

// Calls that reject keep rejecting: a failed write must not be followed by more output.
const guarded = (fn) => {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(e);
  }
};

// ---------------------------------------------------------------- SQL script

const BOM = String.fromCharCode(0xFEFF);

// options = { multiRow, go, bom, generator, generatedAt }
//   multiRow    rows per INSERT (true = as many as the dialect takes, false = one)
//   go          SQL Server: false writes one batch without GO
//   bom         byte order mark; default only for SQL Server (SSMS and sqlcmd need it to
//               read UTF-8, the clients of the other databases stumble over it)
//   generatedAt text for the header; left out by default so the file is reproducible
// The statements go to `<file>.part` first; close() writes the header, which lists the
// tables with the rows actually written, and appends them.
export const createSqlWriter = (filePath, dialect, options = {}) => {
  checkDialect(dialect);
  const partPath = `${filePath}.part`;
  const body = createSink(partPath);
  const state = createTableState();
  const identity = [];
  const perStatement = rowsPerStatement(dialect, options.multiRow);
  const batch = sql => sqlBatch(sql, dialect, options);
  const statements = (table, rows) => {
    if (perStatement === 1) {
      return batch(insertStatements(table, rows, dialect, {
        multiRow: false,
        count: true,
      }));
    }
    let out = '';
    for (let i = 0; i < rows.length; i += perStatement) {
      out += batch(insertStatements(table, rows.slice(i, i + perStatement), dialect, {
        multiRow: perStatement,
        count: true,
      }));
    }
    return out;
  };
  body.write(sqlFilePrelude(dialect, options));

  let joining = null; // the streams of assemble() while it runs
  let aborted = null;
  const assemble = () => new Promise((resolve, reject) => {
    if (aborted) {
      reject(writerError('testdata.writer.aborted'));
      return;
    }
    const out = tracked(fs.createWriteStream(filePath));
    const input = tracked(fs.createReadStream(partPath));
    joining = { out, input, reject };
    out.on('error', reject);
    input.on('error', reject);
    out.on('finish', () => resolve(out.bytesWritten));
    const bom = options.bom === undefined ? dialect === 'mssql' : options.bom;
    out.write(`${bom ? BOM : ''}${sqlFileHeader(dialect, {
      generator: options.generator,
      generatedAt: options.generatedAt,
      tables: state.done,
    })}\n`);
    input.pipe(out);
  });

  const endTable = () => guarded(() => {
    const cur = state.current();
    const sql = statements(cur.table, cur.pending) + batch(tableEpilogue(cur.table, dialect));
    const auto = cur.table.columns.filter(c => c && c.autoIncrement).map(c => c.defKey);
    if (auto.length && cur.rows > 0) {
      identity.push({
        table: cur.table.defKey,
        columns: auto,
      });
    }
    state.end({ name: cur.table.defKey, rows: cur.rows });
    return body.write(sql);
  });

  return {
    beginTable: table => guarded(() => {
      state.begin(table, { pending: [] });
      return body.write(tableComment(table) + batch(tablePrelude(table, dialect)));
    }),
    // Rows are regrouped into full statements, so the file does not depend on how the
    // caller happens to cut its batches.
    rows: rows => guarded(() => {
      const cur = state.current();
      const all = cur.pending.length ? cur.pending.concat(rows) : rows;
      const full = perStatement === 1 ? all.length
        : all.length - (all.length % perStatement);
      cur.pending = full === all.length ? [] : all.slice(full);
      cur.rows += rows.length;
      return body.write(statements(cur.table, full === all.length ? all : all.slice(0, full)));
    }),
    endTable,
    // -> { file, bytes, tables: [{name, rows}], rows }
    close: () => guarded(() => (state.isOpen() ? endTable() : READY))
      .then(() => {
        state.close();
        return body.write(`\n${sqlFileEpilogue(dialect, {
          ...options,
          rows: state.done.reduce((sum, t) => sum + t.rows, 0),
          identity,
        })}`);
      })
      .then(() => body.end())
      .then(assemble)
      .then((bytes) => {
        joining = null;
        removeQuietly(partPath);
        return {
          file: filePath,
          bytes,
          tables: state.done,
          rows: state.done.reduce((sum, t) => sum + t.rows, 0),
        };
      }, e => (aborted || body.destroy().then(() => removeQuietly(partPath))).then(() => {
        throw e;
      })),
    abort: () => {
      if (!aborted) {
        state.abort();
        const streams = joining ? [joining.out, joining.input] : [];
        if (joining) {
          joining.reject(writerError('testdata.writer.aborted'));
          joining.input.unpipe();
          streams.forEach(stream => stream.destroy());
        }
        aborted = Promise.all([body.destroy(), streamsClosed(streams)]).then(() => {
          removeQuietly(partPath);
          if (streams.length > 0) {
            removeQuietly(filePath);
          }
        });
      }
      return aborted;
    },
  };
};

// ---------------------------------------------------------------- bundle for the database

const jsonValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  return value instanceof Date ? value.toISOString() : JSON.stringify(value);
};

const manifestColumn = (column) => {
  const out = { name: column.defKey, kind: column.kind };
  if (column.autoIncrement) {
    out.autoIncrement = true;
  }
  return out;
};

// manifest.json + one NDJSON file per table, in the order the tables are written (parents
// first). The manifest is written last, by rename: a directory with a manifest is complete.
// `dialect` goes into the manifest; identityInsert is true for a SQL Server table that
// gets values for its auto increment column.
export const createDbBundleWriter = (dir, dialect = 'generic') => {
  checkDialect(dialect);
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  removeQuietly(manifestPath);
  const state = createTableState();
  const files = [];
  let aborted = null;

  const endTable = () => guarded(() => {
    const cur = state.current();
    const { table } = cur;
    state.end({
      name: table.defKey,
      file: cur.file,
      rows: cur.rows,
      columns: table.columns.map(manifestColumn),
      identityInsert: dialect === 'mssql' && writesIdentity(table),
    });
    return cur.sink.end();
  });

  return {
    beginTable: table => guarded(() => {
      const n = state.done.length + 1;
      const cur = state.begin(table, {
        file: `${n < 10000 ? `000${n}`.slice(-4) : n}.ndjson`,
        width: table.columns.length,
      });
      files.push(path.join(dir, cur.file));
      cur.sink = createSink(path.join(dir, cur.file));
      return READY;
    }),
    rows: rows => guarded(() => {
      const cur = state.current();
      let out = '';
      for (let r = 0; r < rows.length; r += 1) {
        const row = rows[r] || [];
        const line = new Array(cur.width);
        for (let c = 0; c < cur.width; c += 1) {
          line[c] = jsonValue(row[c]);
        }
        out += `${JSON.stringify(line)}\n`;
      }
      cur.rows += rows.length;
      return cur.sink.write(out);
    }),
    endTable,
    // -> { dir, manifest: path, tables, rows }
    close: () => guarded(() => (state.isOpen() ? endTable() : READY)).then(() => {
      state.close();
      const manifest = { version: 1, dialect, tables: state.done };
      fs.writeFileSync(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
      fs.renameSync(`${manifestPath}.tmp`, manifestPath);
      return {
        dir,
        manifest: manifestPath,
        tables: state.done,
        rows: state.done.reduce((sum, t) => sum + t.rows, 0),
      };
    }),
    // the folder itself was the caller's and stays
    abort: () => {
      if (!aborted) {
        const open = state.abort();
        aborted = (open && open.sink ? open.sink.destroy() : READY).then(() => {
          files.concat(manifestPath, `${manifestPath}.tmp`).forEach(removeQuietly);
        });
      }
      return aborted;
    },
  };
};
