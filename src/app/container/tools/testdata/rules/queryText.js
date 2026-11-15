// The words for the checks of a `query` rule, shared by the rule editor, the reminder before
// saving and the generate window. Pure: `say(id, data)` gives the text of a full language
// key ('' when there is none).

const has = v => v !== undefined && v !== null && `${v}` !== '';
const NOT_FROM_DATABASE = /^(SQL_(?!SYNTAX$|ERROR$)|JAVA_NOT_FOUND$|CANCELLED$|BAD_PARAMS$)/;
// the query never reached the database / the database was never reached
const REFUSED = /^SQL_(?!SYNTAX$|ERROR$)/;
const NOT_RUN = ['JAVA_NOT_FOUND', 'TOOL_FAILED', 'TOOL_ERROR', 'BAD_PARAMS', 'DRIVER_MISSING',
  'CONNECT_FAILED', 'LOGIN_FAILED', 'CANCELLED', 'TIMEOUT'];
// a query of these shapes is not one a rule may use: the database is not asked either
const NOT_ALLOWED = ['notSelect', 'multiple'];

export const findingText = (say, item) => say(`testDataQuery.model.finding.${item.code}`, {
  name: item.name,
  table: item.table || '',
  tables: (item.tables || []).join(' / '),
});

export const skipText = (say, reason) => say(
  `testDataQuery.model.${NOT_ALLOWED.includes(reason) ? 'notAllowed' : 'notAnalysed'}`,
  { reason: say(`testDataQuery.model.reason.${reason}`) || reason });

export const warningText = (say, warning) => say(
  `testDataQuery.check.warning.${warning.code}`, { count: warning.count });

// line and character of a place; '' when the database did not tell
export const placeText = (say, position) => {
  if (!position || typeof position.line !== 'number') {
    return '';
  }
  return position.lineOnly ? say('testDataQuery.check.placeLine', { line: position.line })
    : say('testDataQuery.check.place', { line: position.line, column: position.column });
};

export const errorCodeText = (say, code, object) => {
  const named = has(object) ? say(`testDataQuery.error.${code}_named`, { object }) : '';
  return named || say(`testDataQuery.error.${code}`) || say(`testData.dbError.${code}`)
    || say('testData.dbError.unknown', { code });
};

// whether `code` is one a database call answers with (and not one of the generator)
export const isCheckCode = (say, code) => has(code)
  && !!(say(`testDataQuery.error.${code}`) || say(`testData.dbError.${code}`));

// What a failed check says:
//   title  what kind of failure it is (refused before the database / could not be made /
//          the database said no)
//   text   the failure in plain words, with the name of the object when the database names it
//   object, place (text), position ({offset, line, column}), near
//   raw    the message of the database itself, '' when the answer did not come from it
export const checkErrorParts = (say, error) => {
  const e = error || {};
  const code = has(e.code) ? `${e.code}` : '';
  let kind = 'failed';
  if (REFUSED.test(code)) {
    kind = 'refused';
  } else if (NOT_RUN.includes(code)) {
    kind = 'notRun';
  }
  const message = has(e.message) && e.message !== code ? `${e.message}`.trim() : '';
  return {
    code,
    kind,
    title: say(`testDataQuery.check.${kind}`),
    text: code ? errorCodeText(say, code, e.object) : message || say('testData.dbError.none'),
    object: has(e.object) ? `${e.object}` : '',
    position: e.position && typeof e.position.offset === 'number' ? e.position : null,
    place: placeText(say, e.position),
    near: has(e.near) && !e.position ? `${e.near}` : '',
    raw: code && NOT_FROM_DATABASE.test(code) ? '' : message.slice(0, 600),
  };
};

// The same as one line: for a list of problems and for the reminder before saving
export const checkErrorLine = (say, error) => {
  const parts = checkErrorParts(say, error);
  const where = parts.place || (parts.near ? say('testDataQuery.check.near', { near: parts.near }) : '');
  const head = where ? say('testDataQuery.check.at', { text: parts.text, where }) : parts.text;
  return parts.raw ? say('testData.dbError.withRaw', { text: head, raw: parts.raw.slice(0, 300) })
    || `${head} ${parts.raw}` : head;
};

export const sampleText = (value) => {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  const text = `${value}`;
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
};

const two = n => `${n}`.padStart(2, '0');
export const timeText = (at) => {
  const d = new Date(at);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

// name plus server and database, never the account
export const connWhere = target => (target
  ? [target.host, target.database].filter(has).join(' / ') || target.address || '' : '');

// The status line of a query: what is known about the SQL as it is now
export const statusText = (say, state) => {
  const { entry } = state;
  if (entry) {
    return say(`testDataQuery.check.status.${entry.status}`, {
      time: timeText(entry.at),
      conn: entry.conn,
    });
  }
  return say('testDataQuery.check.status.unchecked');
};
