// Problems of a plan and errors of a run, as text a user can act on. Pure: `tr(id, data)`
// gives the text of `testData.<id>` and `ruleTr` the one of `testDataRule.<id>`, so the
// same code runs in the app and in the tests.
import { problemText as ruleProblemText, problemKey } from '../rules/ruleText';
import { count } from './format';

const MAX_ROWS = 1000000;

// What the user can do about a problem of the plan. The first one is the main action.
//   generateParent / readParent  answer for a parent table that is not selected
//   programIncrement             let the program number the parent's key
//   fixedRows / defaultRows      go back to a fixed / the default number of rows
//   unselect                     take the table out of the run
//   column / table               show the column / the table
export const PLAN_FIXES = {
  missingParent: ['generateParent', 'readParent'],
  entityNotFound: ['unselect'],
  noColumns: ['unselect'],
  badRows: ['defaultRows'],
  tooManyRows: ['table'],
  perParentNotForeignKey: ['fixedRows'],
  perParentRange: ['table', 'fixedRows'],
  autoIncrementParentKey: ['programIncrement'],
  cycle: ['column'],
  badRule: ['column'],
  uniqueImpossible: ['column', 'table'],
  incrementOverflow: ['table'],
  foreignKeyFit: ['column'],
  exprUnknownColumn: ['column'],
  exprCycle: ['column'],
  selfReference: ['column'],
  needsConnection: ['connection', 'generateParent'],
};

// codes the generator and the writers stop a run with
export const RUN_CODES = ['uniqueExhausted', 'tableNotPlanned', 'tooManyRows', 'noParentRows',
  'parentKeysMissing', 'parentNotGenerated', 'incrementOverflow', 'foreignKeyFit',
  'missingParent', 'cycle', 'testdata.writer.closed',
  'testdata.writer.noTable', 'testdata.writer.table', 'testdata.writer.tableOpen',
  'testdata.sql.dialect', 'testdata.sql.emptyName', 'NO_CONNECTION'];

// errors of the file system worth explaining
export const FS_CODES = ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EBUSY', 'EISDIR', 'ENOTDIR',
  'EROFS', 'EEXIST', 'EMFILE', 'ENAMETOOLONG'];

const has = v => v !== undefined && v !== null && v !== '';
const filled = text => !!text && !/^testData(Rule)?\./.test(text);
const short = (value, max = 80) => {
  const s = `${value}`.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// detail of unknown shape as a few readable words, never JSON
export const detailText = (detail) => {
  if (!has(detail)) {
    return '';
  }
  if (Array.isArray(detail)) {
    return detail.filter(has).map(d => (typeof d === 'object' ? detailText(d) : `${d}`))
      .join(', ');
  }
  if (typeof detail === 'object') {
    return Object.keys(detail).filter(k => has(detail[k]) && typeof detail[k] !== 'object')
      .map(k => `${k}: ${detail[k]}`).join(', ');
  }
  return `${detail}`;
};

const lookup = (tr, group, key, data) => {
  const id = `${group}.${key}`;
  const text = tr(id, data);
  return filled(text) && text !== id ? text : '';
};

// a code nobody translated: the code itself and what came with it
export const unknownText = (tr, code, detail) => (has(detail)
  ? tr('problem.unknownDetail', { code, detail: short(detail, 300) })
  : tr('problem.unknown', { code }));

// The text of a code a rule or a value failed with: the window's own words when it has
// them, else the ones of the rule editor. `said` is what the engine added ("123 (0..99)").
export const codeText = (tr, ruleTr, code, said) => {
  const own = lookup(tr, 'problem', problemKey(code));
  const text = own || ruleProblemText(ruleTr, code);
  return has(said) ? tr('problem.withDetail', { text, detail: short(said, 120) }) : text;
};

// "value.range: 123 (0..99)" -> "123 (0..99)"
const saidOf = (code, message) => {
  const text = `${has(message) ? message : ''}`;
  if (text.startsWith(`${code}: `)) {
    return text.slice(`${code}`.length + 2);
  }
  return text === `${code}` ? '' : text;
};

const nameOf = o => (o ? (o.defKey || o.defName || '') : '');

// names of what a problem points at, for the placeholders of its message
export const problemNames = (dataSource, problem) => {
  const p = problem || {};
  const detail = p.detail && typeof p.detail === 'object' && !Array.isArray(p.detail)
    ? p.detail : {};
  const entities = (dataSource && dataSource.entities) || [];
  const entity = entities.find(e => e.id === p.entityId);
  const fieldOf = (e, id) => ((e && e.fields) || []).find(f => f.id === id);
  const parent = entities.find(e => e.id === (detail.refEntityId || p.refEntityId));
  const columns = Array.isArray(detail.fields)
    ? detail.fields.map(id => nameOf(fieldOf(entity, id)) || id) : [];
  return {
    table: nameOf(entity) || (has(p.table) ? `${p.table}` : ''),
    column: nameOf(fieldOf(entity, p.fieldId)),
    parent: nameOf(parent),
    parentColumn: nameOf(fieldOf(parent, detail.refFieldId)),
    columns: columns.join(', '),
  };
};

// the message of a problem of the plan
export const planProblemText = (tr, ruleTr, problem, dataSource) => {
  const p = problem || {};
  const names = problemNames(dataSource, p);
  const detail = p.detail && typeof p.detail === 'object' && !Array.isArray(p.detail)
    ? p.detail : {};
  const data = {
    ...Object.keys(detail).reduce((all, k) => ({
      ...all,
      [k]: typeof detail[k] === 'number' ? count(detail[k]) : detail[k],
    }), {}),
    ...names,
    code: p.code,
    detail: detailText(p.detail),
  };
  let key = problemKey(p.code);
  if (p.code === 'badRule') {
    // found by trying the rule: the engine says what went wrong and at which row
    const codes = (Array.isArray(p.detail) ? p.detail : [p.detail]).filter(has);
    data.detail = codes.map(code => codeText(tr, ruleTr, code,
      codes.length === 1 ? saidOf(code, p.message) : '')).join('；');
    if (typeof p.row === 'number') {
      data.detail = tr('problem.atRow', {
        detail: data.detail,
        row: count(p.row + 1),
      });
    }
  } else if (p.code === 'exprCycle' || p.code === 'selfReference') {
    data.columns = detailText(p.detail);
  } else if (p.code === 'uniqueImpossible' && detail.perParent) {
    key = 'uniqueImpossiblePerParent';
  } else if (p.code === 'foreignKeyFit') {
    data.reason = saidOf('foreignKeyFit', detail.reason).replace(/^value\.\w+: /, '');
  }
  const text = lookup(tr, 'problem', key, data);
  if (text) {
    return text;
  }
  const where = [names.table, names.column].filter(has).join('.');
  return unknownText(tr, p.code, [where, data.detail].filter(has).join(' — '));
};

// true when the run cannot start while the problem is there
export const isBlocking = problem => !(problem && (problem.level === 'warning'
  || problem.level === 'notice' || problem.severity === 'warning' || problem.blocking === false));

export const fixesOf = problem => PLAN_FIXES[problem && problem.code]
  || (problem && problem.fieldId ? ['column'] : ['table']);

// the text of a code of the database tool, '' when the code is not known
export const dbCodeText = (tr, code, data) => lookup(tr, 'dbError', `${code}`, data);

// One failed row or failed call of the database: what happened in plain words, and the
// message of the database itself, which stays visible.
export const dbErrorParts = (tr, error) => {
  const e = error || {};
  const raw = has(e.message) && e.message !== e.code ? short(e.message, 400) : '';
  const known = has(e.code) ? dbCodeText(tr, e.code, { table: e.table || '', row: e.row }) : '';
  return {
    text: known || (has(e.code) ? tr('dbError.unknown', { code: e.code }) : tr('dbError.none')),
    raw,
    code: has(e.code) ? `${e.code}` : '',
  };
};

// Any error of a run as one message. Engine errors carry a stable `code`; errors of the
// file system are explained when they are common ones; anything else shows its own text.
export const runErrorText = (tr, ruleTr, error, dataSource) => {
  const e = error || {};
  const code = has(e.code) ? `${e.code}` : '';
  if (!code) {
    return short(e.message || `${error}`, 300);
  }
  if (FS_CODES.includes(code)) {
    return lookup(tr, 'fsError', code, { path: e.path || '' })
      || tr('fsError.other', { code, path: e.path || '' });
  }
  const known = dbCodeText(tr, code, { table: e.table || '', row: e.row });
  if (known) {
    const raw = has(e.message) && e.message !== code ? short(e.message, 300) : '';
    return raw ? tr('dbError.withRaw', { text: known, raw }) : known;
  }
  const names = problemNames(dataSource, e);
  const text = lookup(tr, 'problem', problemKey(code), {
    ...names,
    row: typeof e.row === 'number' ? count(e.row + 1) : '',
    rows: typeof e.rows === 'number' ? count(e.rows) : e.rows,
    max: count(MAX_ROWS),
    detail: detailText(e.detail),
    startAt: '',
    last: '',
    reason: saidOf(code, e.message),
    code,
  });
  if (text) {
    // a value that did not fit: the table, the column and the row belong to the message
    const where = [names.table, names.column].filter(has).join('.');
    if (/^(value|sequence|number|date|text|list|dict)\./.test(code)) {
      const body = codeText(tr, ruleTr, code, saidOf(code, e.message));
      const full = typeof e.row === 'number' ? tr('problem.atRow', {
        detail: body,
        row: count(e.row + 1),
      }) : body;
      return where ? `${where}：${full}` : full;
    }
    return text;
  }
  const ruleKey = `problem.${problemKey(code)}`;
  const ruleText = ruleTr(ruleKey);
  if (filled(ruleText) && ruleText !== ruleKey) {
    const where = [names.table, names.column].filter(has).join('.');
    let body = ruleProblemText(ruleTr, code, {
      detail: `${e.detail || ''}`.split(',')[0] === code ? undefined : e.detail,
      pos: e.pos,
    });
    if (typeof e.row === 'number') {
      body = tr('problem.atRow', {
        detail: body,
        row: count(e.row + 1),
      });
    }
    return where ? `${where}：${body}` : body;
  }
  // an unknown code: the code and whatever the engine said, never a blank
  return unknownText(tr, code, has(e.message) && e.message !== code
    ? short(e.message, 300) : detailText(e.detail));
};

// A notice of the plan (plan.notices): something to know that does not stop the run.
export const noticeText = (tr, notice) => {
  const n = notice || {};
  const detail = n.detail && typeof n.detail === 'object' && !Array.isArray(n.detail)
    ? n.detail : {};
  return lookup(tr, 'notice', problemKey(n.code), {
    ...detail,
    detail: detailText(n.detail),
  }) || unknownText(tr, n.code, detailText(n.detail));
};
