// What the app remembers about the database checks of `query` rules while it is open.
// Nothing of this is stored in the project: a stored "checked" mark would make the project
// count as modified and would go stale with the next change of the database.
//
// A check is remembered by the exact text of the SQL and the connection it ran on, so a
// query that was edited, or checked on another connection, counts as not checked.
import { checkQuery, CANCELLED, JAVA_NOT_FOUND } from '../../../../../lib/testdata/db';
import { connections, pickConn, connTarget } from '../generate/connInfo';

const TIMEOUT = 20;   // seconds a query may run in a check
const SAMPLE = 5;

const listeners = [];
// fn is called whenever something remembered here changes; returns how to stop listening
export const onSessionChange = (fn) => {
  listeners.push(fn);
  return () => {
    const at = listeners.indexOf(fn);
    at >= 0 && listeners.splice(at, 1);
  };
};
const changed = () => listeners.slice().forEach((fn) => {
  try {
    fn();
  } catch (e) {
    // a broken listener must not stop a check from being remembered
  }
});

const session = {
  config: {},        // the settings of the app (Java location, JVM options)
  chosen: '',        // key of the connection the user chose for checks
  javaMissing: false,
  checks: new Map(),
};

// the app tells its settings here (src/app/main/index.js), as it does for the project file
export const setAppConfig = (config) => {
  session.config = config || {};
};

export const resetQuerySession = () => {
  session.chosen = '';
  session.javaMissing = false;
  session.checks.clear();
};

const identity = (conn) => {
  const p = (conn && conn.properties) || {};
  return [conn && conn.defKey, p.url, p.username].join('\n');
};
const keyOf = (conn, sql) => `${identity(conn)}\n\n${sql}`;

// The connection checks run on: the one chosen here, else the default of the project, else
// the only one, else the first
export const checkConn = dataSource => pickConn(dataSource, session.chosen)
  || connections(dataSource)[0] || null;

export const chooseConn = (key) => {
  session.chosen = key || '';
  changed();
};

export const retryJava = () => {
  session.javaMissing = false;
  changed();
};

export const sqlOf = rule => `${(rule && rule.params && rule.params.sql) || ''}`;

// Where a query stands: {state, conn, target, entry}
//   state  'noConnection' | 'incomplete' | 'noJava' | 'unchecked' | 'ok' | 'failed'
//   entry  the remembered check: {status, at, conn (name), result | error}
export const queryState = (dataSource, sql) => {
  const conn = checkConn(dataSource);
  if (!conn) {
    return { state: 'noConnection', conn: null, target: null };
  }
  const target = connTarget(dataSource, conn);
  if (!target.complete) {
    return { state: 'incomplete', conn, target };
  }
  const entry = session.checks.get(keyOf(conn, sql)) || null;
  if (!entry && session.javaMissing) {
    return { state: 'noJava', conn, target };
  }
  return {
    state: entry ? entry.status : 'unchecked', conn, target, entry,
  };
};

// Saving asks about a query rule unless the database accepted exactly this SQL in this
// session. A stored rule whose SQL was not touched is never asked about.
export const needsReminder = (rule, original, dataSource) => {
  if (!rule || rule.kind !== 'query' || sqlOf(rule).trim() === '') {
    return false;
  }
  if (original && original.kind === 'query' && sqlOf(original) === sqlOf(rule)) {
    return false;
  }
  return queryState(dataSource, sqlOf(rule)).state !== 'ok';
};

// Lets the database check `sql` on the connection in use and remembers the outcome.
// -> a promise of the entry ({status: 'ok', result} | {status: 'failed', error}) with
// cancel(); it rejects only when cancelled (code CANCELLED).
export const runCheck = (dataSource, sql, options = {}) => {
  const { check = checkQuery } = options;
  const conn = checkConn(dataSource);
  const target = connTarget(dataSource, conn);
  const run = check(dataSource, session.config, conn, sql, { timeout: TIMEOUT, sample: SAMPLE });
  const keep = (entry) => {
    const full = { ...entry, at: Date.now(), conn: target ? target.name : '' };
    session.checks.set(keyOf(conn, sql), full);
    changed();
    return full;
  };
  const promise = run.then((result) => {
    session.javaMissing = false;
    return keep({ status: 'ok', result });
  }, (error) => {
    if (error && error.code === CANCELLED) {
      throw error;
    }
    if (error && error.code === JAVA_NOT_FOUND) {
      session.javaMissing = true;
    }
    return keep({ status: 'failed', error: error || {} });
  });
  promise.cancel = () => run.cancel && run.cancel();
  return promise;
};

export const CHECK_TIMEOUT = TIMEOUT;
