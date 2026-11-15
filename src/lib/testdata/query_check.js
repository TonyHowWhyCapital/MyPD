// Checks the SQL of a `query` rule against the tables and columns of the project, without a
// database. It only reads simple queries (one SELECT over tables and joins) and says so when
// a query is beyond it. The binding rule: it never reports something it is not sure about.
// A name it cannot place - a function, a keyword, an alias, a column of a table it does not
// know - is left alone; whether the query really runs is for the database to say
// (checkQuery in db.js). Pure.
//
// checkAgainstModel(sql, dataSource) -> {status, reason?, findings, tables}
//   status    'empty' | 'analysed' | 'notAnalysed'
//   reason    why it was not analysed: one of SKIP_REASONS
//   tables    [{name, alias, known, modelName}] the tables of FROM and JOIN
//   findings  [{code, severity, name, start, end, table?, tables?, suggestions?}]
//     tableUnknown     warning  the table is not in the model (it may still be in the database)
//     columnUnknown    warning  `table` of the model has no such column
//     columnNowhere    warning  none of the joined `tables` of the model has the column
//     columnAmbiguous  info     the unqualified column is in several of the joined `tables`
//     noFrom           info     the query names columns but reads no table
//     start, end: the place of the name in the text (without quotes), for pointing at it and
//     for replacing it with one of `suggestions`.
import {
  tokenize, isOp, isWord, upper, nearest,
} from './query_tokens';
import { KEYWORDS, PLAIN_FUNCTIONS, PSEUDO_COLUMNS } from './query_words';

export const FINDING_CODES = ['tableUnknown', 'columnUnknown', 'columnNowhere', 'columnAmbiguous',
  'noFrom'];
export const SKIP_REASONS = ['notSelect', 'cte', 'setOperation', 'subquery', 'derivedTable',
  'tableFunction', 'fromShape', 'unterminated', 'quoting', 'unbalanced', 'multiple', 'tooLong'];
const MAX_LENGTH = 20000;

const CLAUSES = ['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'FETCH', 'FOR', 'WINDOW',
  'OPTION', 'QUALIFY', 'INTO'];
const SET_WORDS = ['UNION', 'INTERSECT', 'EXCEPT', 'MINUS'];
const JOIN_WORDS = ['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'NATURAL',
  'STRAIGHT_JOIN'];
const NOT_A_TABLE = ['SELECT', 'VALUES', 'TABLE', 'UNNEST', 'ONLY', 'ON', 'USING', 'AS', 'WITH',
  'WHERE'].concat(JOIN_WORDS);
const NOT_AN_ALIAS = ['ON', 'USING', 'WITH', 'AS', 'PARTITION', 'FOR'].concat(JOIN_WORDS);
// schemas of the databases themselves: their tables are never in a model
const SYSTEM_SCHEMAS = ['sys', 'information_schema', 'pg_catalog', 'mysql', 'performance_schema',
  'sysibm', 'sysibmadm'];
// what an expression may begin after, and what may follow its last name
const BEFORE_OPS = [',', '(', '=', '<', '>', '<=', '>=', '<>', '!=', '+', '-', '*', '/', '%', '||'];
const BEFORE_WORDS = ['SELECT', 'DISTINCT', 'ALL', 'WHERE', 'AND', 'OR', 'NOT', 'ON', 'BY',
  'HAVING', 'WHEN', 'THEN', 'ELSE', 'CASE', 'BETWEEN', 'LIKE'];
const AFTER_OPS = [',', ')', '=', '<', '>', '<=', '>=', '<>', '!=', '+', '-', '*', '/', '%', '||'];
const AFTER_WORDS = ['FROM', 'WHERE', 'AND', 'OR', 'AS', 'IS', 'IN', 'NOT', 'LIKE', 'BETWEEN',
  'ASC', 'DESC', 'THEN', 'ELSE', 'END', 'WHEN', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
  'FETCH'].concat(JOIN_WORDS);
// in front of a parenthesis these open a group of expressions, not the arguments of a function
const GROUP_WORDS = ['AND', 'OR', 'NOT', 'WHERE', 'ON', 'WHEN', 'THEN', 'ELSE', 'SELECT',
  'HAVING', 'IN', 'BY', 'DISTINCT', 'ALL'];
const ALIAS_AFTER_NOT = ['AND', 'OR', 'NOT', 'IN', 'LIKE', 'IS', 'BETWEEN', 'THEN', 'ELSE',
  'WHEN', 'CASE', 'DISTINCT', 'ALL', 'BY', 'SELECT'];

const lower = name => `${name}`.toLowerCase();
const isKeyword = t => !!t && t.type === 'word' && KEYWORDS.has(t.text.toUpperCase());
// something that can be the name of a table, a column or an alias
const isName = t => !!t && (t.type === 'quoted' || (t.type === 'word' && !isKeyword(t)));
const anyName = t => !!t && (t.type === 'quoted' || t.type === 'word');

// The tables and views of the project: {[lower name]: {name, columns: {[lower name]: name}}}
export const modelTables = (dataSource) => {
  const ds = dataSource || {};
  return (ds.entities || []).concat(ds.views || []).reduce((all, table) => {
    const key = table && table.defKey ? lower(table.defKey) : '';
    if (!key || all[key]) {
      return all;
    }
    return {
      ...all,
      [key]: {
        name: table.defKey,
        columns: (table.fields || []).reduce((columns, f) => (f && f.defKey
          ? { ...columns, [lower(f.defKey)]: f.defKey } : columns), {}),
      },
    };
  }, {});
};

const skipped = reason => ({
  status: 'notAnalysed', reason, findings: [], tables: [],
});

const finding = (kind, severity, token, more) => ({
  code: kind,
  severity,
  name: token.name,
  start: token.from,
  end: token.to,
  ...more,
});

// Reads `FROM a x JOIN b AS y ON ... , c`. -> {refs, exprs, using} or {reason}
const readFrom = (seg) => {
  const refs = [];
  const exprs = [];
  let using = false;
  let i = 0;
  const base = seg.length > 0 ? seg[0].depth : 0;
  const closeParen = () => {
    // seg[i] is '(' : moves behind its ')'
    const { depth } = seg[i];
    i += 1;
    while (i < seg.length && !(isOp(seg[i], ')') && seg[i].depth === depth)) {
      i += 1;
    }
    i += 1;
  };
  const readRef = () => {
    const first = seg[i];
    if (isOp(first, '(')) {
      return isWord(seg[i + 1], 'SELECT') ? 'derivedTable' : 'fromShape';
    }
    if (!anyName(first) || (first.type === 'word' && NOT_A_TABLE.includes(upper(first)))) {
      return 'fromShape';
    }
    const parts = [first];
    i += 1;
    while (isOp(seg[i], '.')) {
      if (!anyName(seg[i + 1])) {
        return 'fromShape';
      }
      parts.push(seg[i + 1]);
      i += 2;
    }
    if (parts.length > 3) {
      return 'fromShape';
    }
    if (isOp(seg[i], '(')) {
      return 'tableFunction';
    }
    let alias = null;
    if (isWord(seg[i], 'AS')) {
      if (!anyName(seg[i + 1])) {
        return 'fromShape';
      }
      alias = seg[i + 1];
      i += 2;
    } else if (anyName(seg[i]) && !NOT_AN_ALIAS.includes(upper(seg[i]))) {
      alias = seg[i];
      i += 1;
    }
    if (isWord(seg[i], 'WITH') && isOp(seg[i + 1], '(')) {
      // a table hint of SQL Server: WITH (NOLOCK)
      i += 1;
      closeParen();
    }
    if (isOp(seg[i], '(')) {
      return 'fromShape';
    }
    refs.push({ parts, alias });
    return '';
  };
  let reason = readRef();
  while (!reason && i < seg.length) {
    if (isOp(seg[i], ',')) {
      i += 1;
      reason = readRef();
    } else {
      let joined = false;
      while (!joined && JOIN_WORDS.includes(upper(seg[i]))) {
        joined = ['JOIN', 'STRAIGHT_JOIN'].includes(upper(seg[i]));
        using = using || isWord(seg[i], 'NATURAL');
        i += 1;
      }
      reason = joined ? readRef() : 'fromShape';
      if (!reason && isWord(seg[i], 'ON')) {
        i += 1;
        const start = i;
        while (i < seg.length && !(seg[i].depth === base
          && (isOp(seg[i], ',') || JOIN_WORDS.includes(upper(seg[i]))))) {
          i += 1;
        }
        exprs.push(seg.slice(start, i));
      } else if (!reason && isWord(seg[i], 'USING') && isOp(seg[i + 1], '(')) {
        using = true;
        i += 1;
        closeParen();
      }
    }
  }
  return reason ? { reason } : { refs, exprs, using };
};

// The items of the SELECT list without DISTINCT / TOP n, and the names they are given
const readSelectList = (list) => {
  let i = 0;
  while (['DISTINCT', 'ALL', 'DISTINCTROW', 'SQL_CALC_FOUND_ROWS'].includes(upper(list[i]))) {
    i += 1;
  }
  if (isWord(list[i], 'TOP')) {
    i += 1;
    if (isOp(list[i], '(')) {
      const { depth } = list[i];
      while (i < list.length && !(isOp(list[i], ')') && list[i].depth === depth)) {
        i += 1;
      }
    }
    i += 1;
    i += isWord(list[i], 'PERCENT') ? 1 : 0;
    i += isWord(list[i], 'WITH') && isWord(list[i + 1], 'TIES') ? 2 : 0;
  }
  const base = list.length > 0 ? list[0].depth : 0;
  const items = [[]];
  list.slice(i).forEach((t) => {
    if (isOp(t, ',') && t.depth === base) {
      items.push([]);
    } else {
      items[items.length - 1].push(t);
    }
  });
  const aliases = [];
  const kept = items.map((item) => {
    const last = item[item.length - 1];
    const before = item[item.length - 2];
    if (item.length >= 2 && (isName(last) || (last.type === 'string' && isWord(before, 'AS')))) {
      if (isWord(before, 'AS')) {
        aliases.push(lower(last.name || last.text.slice(1, -1)));
        return item.slice(0, -2);
      }
      const operand = before.type === 'quoted' || before.type === 'number'
        || before.type === 'string' || isOp(before, ')') || isOp(before, ']')
        || (before.type === 'word' && !ALIAS_AFTER_NOT.includes(upper(before)));
      if (operand) {
        aliases.push(lower(last.name));
        return item.slice(0, -1);
      }
    }
    if (item.length >= 2 && isName(item[0]) && isOp(item[1], '=')) {
      // SQL Server: name = expression
      aliases.push(lower(item[0].name));
    }
    return item;
  });
  return { items: kept, aliases };
};

const resolve = (ref, model) => {
  const names = ref.parts.map(p => p.name);
  const last = names[names.length - 1];
  const system = (names.length > 1 && SYSTEM_SCHEMAS.includes(lower(names[names.length - 2])))
    || (names.length === 1 && lower(last) === 'dual');
  return {
    ...ref,
    name: names.join('.'),
    token: ref.parts[ref.parts.length - 1],
    key: lower(ref.alias ? ref.alias.name : last),
    system,
    table: system ? null : model[lower(names.join('.'))] || model[lower(last)] || null,
  };
};

export const checkAgainstModel = (sql, dataSource) => {
  const text = `${sql === undefined || sql === null ? '' : sql}`;
  if (text.trim() === '') {
    return { status: 'empty', findings: [], tables: [] };
  }
  if (text.length > MAX_LENGTH) {
    return skipped('tooLong');
  }
  const read = tokenize(text);
  if (read.problem) {
    return skipped(read.problem);
  }
  let { tokens } = read;
  while (tokens.length > 0 && isOp(tokens[tokens.length - 1], ';')) {
    tokens = tokens.slice(0, -1);
  }
  if (tokens.length === 0) {
    return { status: 'empty', findings: [], tables: [] };
  }
  const words = tokens.map(upper);
  if (tokens.some(t => isOp(t, ';'))) {
    return skipped('multiple');
  }
  if (words[0] !== 'SELECT') {
    return skipped(words[0] === 'WITH' ? 'cte' : 'notSelect');
  }
  if (words.some(w => SET_WORDS.includes(w))) {
    return skipped('setOperation');
  }
  const second = words.indexOf('SELECT', 1);
  if (second > 0) {
    const opener = upper(tokens[second - 2]);
    return skipped(isOp(tokens[second - 1], '(') && (opener === 'FROM' || opener === 'JOIN'
      || isOp(tokens[second - 2], ',')) && tokens[second - 1].depth === 0
      ? 'derivedTable' : 'subquery');
  }
  const at = word => tokens.findIndex((t, i) => i > 0 && t.depth === 0 && words[i] === word);
  const fromAt = at('FROM');
  const { items, aliases } = readSelectList(tokens.slice(1, fromAt < 0 ? tokens.length : fromAt));
  if (fromAt < 0) {
    const named = items.map(item => item.find((t, i) => isName(t) && !isOp(item[i + 1], '(')
      && !isOp(item[i + 1], '.') && !isOp(item[i - 1], '.'))).filter(t => t);
    return {
      status: 'analysed',
      tables: [],
      findings: named.slice(0, 1).map(t => finding('noFrom', 'info', t)),
    };
  }
  let fromEnd = tokens.findIndex((t, i) => i > fromAt && t.depth === 0
    && CLAUSES.includes(words[i]));
  fromEnd = fromEnd < 0 ? tokens.length : fromEnd;
  const from = readFrom(tokens.slice(fromAt + 1, fromEnd));
  if (from.reason) {
    return skipped(from.reason);
  }
  const model = modelTables(dataSource);
  const refs = from.refs.map(ref => resolve(ref, model));
  const scope = {};
  if (refs.some((ref) => {
    const taken = !!scope[ref.key];
    scope[ref.key] = ref;
    return taken;
  })) {
    return skipped('fromShape');
  }
  const tableNames = Object.keys(model).map(k => model[k].name);
  const findings = refs.filter(ref => !ref.table && !ref.system)
    .map(ref => finding('tableUnknown', 'warning', ref.token, {
      suggestions: nearest(ref.token.name, tableNames),
    }));
  const index = new Map(tokens.map((t, i) => [t, i]));
  const allKnown = refs.every(ref => ref.table);
  const reported = [];
  const missing = (token, table) => {
    const name = lower(token.name);
    if (!table.columns[name] && !PSEUDO_COLUMNS.has(name.toUpperCase())) {
      findings.push(finding('columnUnknown', 'warning', token, {
        table: table.name,
        suggestions: nearest(token.name, Object.keys(table.columns).map(k => table.columns[k])),
      }));
    }
  };
  // one stretch of expressions; `ambiguity` is off where a name may be one of the SELECT list
  const scan = (part, ambiguity) => {
    const stack = [];
    part.forEach((t, k) => {
      const g = index.get(t);
      const prev = tokens[g - 1];
      const next = tokens[g + 1];
      // an item of the SELECT list ends where its alias begins
      const left = k > 0 ? prev : undefined;
      const right = k < part.length - 1 ? next : undefined;
      if (isOp(t, '(')) {
        const group = !prev || (prev.type === 'op' && !isOp(prev, ')') && !isOp(prev, ']'))
          || GROUP_WORDS.includes(upper(prev));
        const plainCall = !!prev && prev.type === 'word' && !isOp(tokens[g - 2], '.')
          && PLAIN_FUNCTIONS.has(upper(prev));
        stack.push(group || plainCall ? 'open' : 'opaque');
        return;
      }
      if (isOp(t, ')')) {
        stack.pop();
        return;
      }
      if (!anyName(t) || isOp(prev, '.')) {
        return;
      }
      if (isOp(next, '.')) {
        // qualifier.column: judged when the qualifier is a table of this query
        const column = tokens[g + 2];
        const ref = scope[lower(t.name)];
        if (ref && ref.table && anyName(column) && !isOp(tokens[g + 3], '.')
          && !isOp(tokens[g + 3], '(')) {
          missing(column, ref.table);
        }
        return;
      }
      const name = lower(t.name);
      const before = !left || (left.type === 'op' && BEFORE_OPS.includes(left.text))
        || BEFORE_WORDS.includes(upper(left));
      const after = !right || (right.type === 'op' && AFTER_OPS.includes(right.text))
        || AFTER_WORDS.includes(upper(right));
      // "text" may be a string in MySQL; a keyword may be anything
      if (!isName(t) || t.quote === '"' || !before || !after || stack.includes('opaque')
        || aliases.includes(name) || scope[name] || PSEUDO_COLUMNS.has(name.toUpperCase())) {
        return;
      }
      if (refs.length === 1 && refs[0].table) {
        missing(t, refs[0].table);
      } else if (refs.length > 1 && allKnown) {
        const owners = refs.filter(ref => ref.table.columns[name]).map(ref => ref.table.name);
        if (owners.length === 0) {
          // every joined table is known and none has it
          findings.push(finding('columnNowhere', 'warning', t, {
            tables: refs.map(ref => ref.table.name),
            suggestions: nearest(t.name, refs.reduce((all, ref) => all.concat(
              Object.keys(ref.table.columns).map(k => ref.table.columns[k])), [])
              .filter((c, i, l) => l.indexOf(c) === i)),
          }));
        } else if (owners.length > 1 && ambiguity && !from.using && !reported.includes(name)) {
          reported.push(name);
          findings.push(finding('columnAmbiguous', 'info', t, { tables: owners }));
        }
      }
    });
  };
  items.forEach(item => scan(item, true));
  from.exprs.forEach(expr => scan(expr, true));
  // hints and locking clauses are not expressions
  const stop = tokens.findIndex((t, i) => i >= fromEnd && t.depth === 0
    && ['OPTION', 'FOR', 'INTO', 'WINDOW'].includes(words[i]));
  const rest = tokens.slice(fromEnd, stop < 0 ? tokens.length : stop);
  const orderAt = rest.findIndex(t => t.depth === 0 && isWord(t, 'ORDER'));
  scan(orderAt < 0 ? rest : rest.slice(0, orderAt), true);
  if (orderAt >= 0) {
    scan(rest.slice(orderAt), false);
  }
  return {
    status: 'analysed',
    tables: refs.map(ref => ({
      name: ref.name,
      alias: ref.alias ? ref.alias.name : '',
      known: !!ref.table,
      modelName: ref.table ? ref.table.name : '',
    })),
    findings: findings.sort((a, b) => a.start - b.start),
  };
};

// The text with the name of a finding replaced by a suggestion
export const applySuggestion = (sql, item, name) => `${sql.slice(0, item.start)}${name}${
  sql.slice(item.end)}`;
