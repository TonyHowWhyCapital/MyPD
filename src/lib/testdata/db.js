// Test data against a real database: row counts, existing keys, a read-only query and writing a
// bundle of generated rows. The work is done by the Java tool mypd.TestData (scripts/java/mypd),
// started the same way as runJavaTool in ../json.js, except that the connection and the options
// travel in an owner-only temporary file instead of the command line, where the password would
// show in the process list.

import fs from 'fs';
import os from 'os';
import path from 'path';

const { spawn } = require('child_process');

// Stable codes of the errors this module rejects with (err.code); the Java tool adds its own:
// DRIVER_MISSING, CONNECT_FAILED, LOGIN_FAILED, TABLE_MISSING, COLUMN_MISSING, VALUE_TOO_LONG,
// CONSTRAINT, BAD_VALUE, BUNDLE_INVALID, SQL_ERROR, TIMEOUT, DB_ERROR, TOOL_ERROR and the SQL_*
// codes of the query check (SQL_EMPTY, SQL_MULTIPLE, SQL_NOT_SELECT, SQL_FORBIDDEN, SQL_QUOTING,
// SQL_UNTERMINATED, SQL_AMBIGUOUS, SQL_TOO_LONG).
export const CANCELLED = 'CANCELLED';
export const JAVA_NOT_FOUND = 'JAVA_NOT_FOUND';
export const TOOL_FAILED = 'TOOL_FAILED';

const MAIN = 'mypd.TestData';
const PROGRESS_INTERVAL = 300;
const KILL_AFTER = 3000;
const STDERR_KEPT = 8192;

const environment = {
  jarPath: '',   // engine jar; asked from the main process when empty
  tmpDir: '',    // where the temporary directories go; the system one when empty
};

// For tests and tools outside Electron: {jarPath, tmpDir}
export const configure = (options = {}) => {
  Object.assign(environment, options);
};

const engineJar = () => {
  if (environment.jarPath) {
    return environment.jarPath;
  }
  // required here and not at the top: this module must load without Electron (jest)
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  return require('electron').ipcRenderer.sendSync('jarPath');
};

// conn: an entry of dataSource.dbConn ({properties}) or the properties themselves
export const connParams = (conn) => {
  const p = (conn && conn.properties) || conn || {};
  return {
    driver_class_name: p.driver_class_name || '',
    url: p.url || '',
    username: p.username || '',
    password: p.password || '',
    customer_driver: p.customer_driver || '',
  };
};

const javaOf = (dataSource, config) => {
  const javaHome = (config && config.javaHome)
    || (dataSource && dataSource.profile && dataSource.profile.javaHome) || '';
  return javaHome ? path.join(javaHome, 'bin', 'java') : 'java';
};

const toolError = (code, message, more = {}) => {
  const error = new Error(message || code);
  return Object.assign(error, more, { code });
};

const removeDir = (dir) => {
  try {
    fs.readdirSync(dir).forEach((name) => {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch (e) {
        // already gone
      }
    });
    fs.rmdirSync(dir);
  } catch (e) {
    // already gone
  }
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return undefined;
  }
};

// Starts the tool in one mode. Returns {promise, cancel}; the promise resolves with the body of
// the result. Everything written for the run lives in one private directory removed at the end.
const runTool = (dataSource, config, conn, mode, options = {}, onProgress) => {
  let child;
  let cancelled = false;
  let killTimer;
  const cancel = () => {
    cancelled = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      // a process that ignores the request is ended for good
      killTimer = killTimer || setTimeout(() => child.kill('SIGKILL'), KILL_AFTER);
    }
  };
  const promise = new Promise((res, rej) => {
    let dir;
    let timer;
    let lastProgress = '';
    const finish = (settle, value) => {
      clearInterval(timer);
      clearTimeout(killTimer);
      removeDir(dir);
      settle(value);
    };
    const poll = () => {
      let text = '';
      try {
        text = fs.readFileSync(path.join(dir, 'progress.json'), 'utf8');
      } catch (e) {
        return;
      }
      if (text && text !== lastProgress) {
        lastProgress = text;
        try {
          onProgress(JSON.parse(text));
        } catch (e) {
          // a broken listener or a half-read file must not stop the write
        }
      }
    };
    try {
      const params = connParams(conn);
      const jar = engineJar();
      dir = fs.mkdtempSync(path.join(environment.tmpDir || os.tmpdir(), 'mypd-testdata-'));
      const paramFile = path.join(dir, 'params.json');
      const outFile = path.join(dir, 'out.json');
      const { customer_driver: customerDriver, ...connection } = params;
      fs.writeFileSync(paramFile, JSON.stringify({
        ...options,
        ...connection,
        mode,
        out: outFile,
        ...(onProgress ? { progress: path.join(dir, 'progress.json') } : {}),
      }), { mode: 0o600, flag: 'wx' });
      const args = [
        '-Dfile.encoding=utf-8',
        '-cp', jar,
        `-Dloader.path=${path.join(path.dirname(jar), 'tools')}${path.sep}`,
        `-Dloader.main=${MAIN}`,
        'org.springframework.boot.loader.PropertiesLauncher',
        `params=${paramFile}`,
      ];
      if (customerDriver) {
        args.unshift(`-Xbootclasspath/a:${customerDriver}`);
      }
      let stderr = '';
      child = spawn(javaOf(dataSource, config), args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      child.stderr.on('data', (chunk) => {
        // only the end is of interest, and nothing may grow without limit
        stderr = `${stderr}${chunk}`.slice(-STDERR_KEPT);
      });
      child.on('error', (error) => {
        finish(rej, error.code === 'ENOENT'
          ? toolError(JAVA_NOT_FOUND, 'Java was not found')
          : toolError(TOOL_FAILED, error.message));
      });
      child.on('close', () => {
        if (onProgress) {
          poll();
        }
        const result = readJson(outFile);
        if (cancelled && !(result && result.status === 'SUCCESS')) {
          finish(rej, toolError(CANCELLED, 'Cancelled'));
        } else if (result && result.status === 'SUCCESS') {
          finish(res, result.body);
        } else if (result && result.body && typeof result.body === 'object') {
          const { code, message, ...more } = result.body;
          finish(rej, toolError(code || TOOL_FAILED, message, more));
        } else {
          finish(rej, toolError(TOOL_FAILED, `${(result && result.body) || stderr}`.trim()
            || 'The Java tool ended without a result'));
        }
      });
      if (onProgress) {
        timer = setInterval(poll, PROGRESS_INTERVAL);
      }
      if (cancelled) {
        cancel();
      }
    } catch (error) {
      finish(rej, error.code ? error : toolError(TOOL_FAILED, error.message));
    }
  });
  return { promise, cancel };
};

// Rows in each table; null for a table that does not exist (or cannot be read)
export const countRows = (dataSource, config, conn, tableNames) => {
  return runTool(dataSource, config, conn, 'count', { tables: tableNames || [] }).promise
    .then(body => (tableNames || []).reduce((counts, name) => {
      const n = body.counts[name];
      return { ...counts, [name]: typeof n === 'number' ? n : null };
    }, {}));
};

// Existing values of one column, NULL left out, at most `limit` of them (default 10000)
export const readKeys = (dataSource, config, conn, table, column, limit) => {
  return runTool(dataSource, config, conn, 'keys', { table, column, limit: limit || 0 }).promise;
};

// First column of one read-only SELECT, at most `limit` rows (default 10000). Anything that is
// not a single SELECT is refused before the database is reached (err.code starts with SQL_).
export const runQuery = (dataSource, config, conn, sql, limit) => {
  return runTool(dataSource, config, conn, 'query', { sql, limit: limit || 0 }).promise;
};

// Writes the bundle in `dir` (see createDbBundleWriter). Returns {promise, cancel}.
// promise -> {tables: [{name, written, failed, deleted, errors: [{row, code, message}], warnings}]}
// onError 'rollback': the first failing row rejects with {code, message, table, row} and nothing
// is kept. 'skip': bad rows are left out and listed (the first 100 of a table; `failed` counts
// all). onProgress({table, done, total, tableIndex, tableCount, phase, written, failed}), with
// tableIndex counted from 0.
// cancel() ends the Java process: what was not committed is rolled back by the database, and the
// promise rejects with code CANCELLED. In 'skip' mode the batches already committed stay.
export const writeBundle = (dataSource, config, conn, dir, options = {}) => {
  const { existing = 'append', onError = 'rollback', onProgress } = options;
  const run = runTool(dataSource, config, conn, 'write', {
    dir,
    existing: existing === 'clear' ? 'clear' : 'append',
    onError: onError === 'skip' ? 'skip' : 'rollback',
  }, onProgress || (() => {}));
  return {
    promise: run.promise.then(body => ({ tables: body.tables })),
    cancel: run.cancel,
  };
};
