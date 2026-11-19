// Splits a DDL script into the statements to send one by one through JDBC. Pure.
//
// dialect: the names of mypd.TestDataDb (mssql | mysql | postgresql | oracle | sqlite | generic).
// A statement ends at a `;` outside strings, quoted names and comments, or at a line holding
// only `/` or `GO`. Procedure, function, trigger and package bodies and anonymous blocks keep
// their inner `;` until their outer END. Oracle blocks keep their `END;`; every other statement
// is sent without its trailing `;`.

export const DIALECTS = ['mssql', 'mysql', 'postgresql', 'oracle', 'sqlite', 'generic'];

// defKey of profile.dataTypeSupports, lower case, letters only, version numbers left out
const TYPE_DIALECTS = {
  mysql: 'mysql',
  mariadb: 'mysql',
  oracle: 'oracle',
  sqlserver: 'mssql',
  mssql: 'mssql',
  postgresql: 'postgresql',
  postgres: 'postgresql',
  pgsql: 'postgresql',
  sqlite: 'sqlite',
};
const URL_DIALECTS = [
  [/^jdbc:(sqlserver|jtds:sqlserver|microsoft:sqlserver):/i, 'mssql'],
  [/^jdbc:(mysql|mariadb):/i, 'mysql'],
  [/^jdbc:postgresql:/i, 'postgresql'],
  [/^jdbc:oracle:/i, 'oracle'],
  [/^jdbc:sqlite:/i, 'sqlite'],
];

const typeKey = name => `${name || ''}`.toLowerCase().replace(/\d.*$/, '').replace(/[^a-z]/g, '');

// conn: an entry of dataSource.dbConn; its type is the id (or the defKey) of a database type
export const dialectOfConn = (dataSource, conn) => {
  if (!conn) {
    return 'generic';
  }
  const supports = (dataSource && dataSource.profile && dataSource.profile.dataTypeSupports) || [];
  const support = supports.find(s => s && s.id === conn.type);
  const byType = TYPE_DIALECTS[typeKey((support && support.defKey) || conn.type)];
  if (byType) {
    return byType;
  }
  const url = `${(conn.properties && conn.properties.url) || ''}`.trim();
  return (URL_DIALECTS.find(([pattern]) => pattern.test(url)) || [])[1] || 'generic';
};

// postgresql, mssql and sqlite undo DDL with a rollback; the others commit each one at once
// (mypd.ApplyDdl decides the same way)
export const isTransactional = dialect => ['postgresql', 'mssql', 'sqlite'].includes(dialect);

const isWordChar = c => /[A-Za-z0-9_$#\u0080-￿]/.test(c);
const SEPARATOR_LINE = /^\s*(?:\/|go)\s*$/i;

// token = {type: 'word' | 'quoted' | 'string' | 'semi' | 'sep' | 'open' | 'close' | 'other',
//          start, end, word (upper case, words only)}; comments and spaces leave no token
const scan = (text, dialect) => {
  const tokens = [];
  const n = text.length;
  const mysql = dialect === 'mysql';
  const brackets = !['mysql', 'postgresql', 'oracle'].includes(dialect);
  const push = (type, start, end) => tokens.push({
    type, start, end, word: type === 'word' ? text.slice(start, end).toUpperCase() : undefined,
  });
  // the index after the closing quote; a doubled one is part of the text; unclosed: the end
  const quoteEnd = (start, close, backslash) => {
    let j = start + 1;
    while (j < n) {
      if (backslash && text[j] === '\\') {
        j += 2;
      } else if (text[j] === close && text[j + 1] === close) {
        j += 2;
      } else if (text[j] === close) {
        return j + 1;
      } else {
        j += 1;
      }
    }
    return n;
  };
  const lineEnd = (from) => {
    const at = text.indexOf('\n', from);
    return at < 0 ? n : at;
  };
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    const dollar = c === '$' && !(i > 0 && isWordChar(text[i - 1]))
      && /^\$(?:[A-Za-z_]\w*)?\$/.exec(text.slice(i, i + 64));
    if ((i === 0 || text[i - 1] === '\n') && SEPARATOR_LINE.test(text.slice(i, lineEnd(i)))) {
      const end = lineEnd(i);
      push('sep', i, end);
      i = end;
    } else if (/\s/.test(c)) {
      i += 1;
    } else if ((c === '-' && d === '-') || (mysql && c === '#')) {
      i = lineEnd(i);
    } else if (c === '/' && d === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? n : close + 2;
    } else if (c === '\'' || c === '"' || c === '`') {
      const end = quoteEnd(i, c, mysql && c !== '`');
      push(c === '\'' ? 'string' : 'quoted', i, end);
      i = end;
    } else if (c === '[' && brackets) {
      const close = text.indexOf(']', i + 1);
      const end = close < 0 ? n : close + 1;
      push('quoted', i, end);
      i = end;
    } else if (dollar) {
      const close = text.indexOf(dollar[0], i + dollar[0].length);
      const end = close < 0 ? n : close + dollar[0].length;
      push('string', i, end);
      i = end;
    } else if (isWordChar(c) && c !== '$') {
      let end = i + 1;
      while (end < n && isWordChar(text[end])) {
        end += 1;
      }
      push('word', i, end);
      i = end;
    } else {
      push({ ';': 'semi', '(': 'open', ')': 'close' }[c] || 'other', i, i + 1);
      i += 1;
    }
  }
  return tokens;
};

const ROUTINES = ['PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER'];
// the first of these after CREATE says what is created
const OBJECTS = ['TABLE', 'VIEW', 'INDEX', 'SEQUENCE', 'SCHEMA', 'DATABASE', 'DOMAIN', 'SYNONYM',
  'USER', 'ROLE', 'MATERIALIZED', 'EXTENSION', 'TYPE', 'PACKAGE', ...ROUTINES];
// BEGIN TRANSACTION and its kin start a transaction, not a block
const TRANSACTION = ['TRAN', 'TRANSACTION', 'WORK', 'DISTRIBUTED', 'ISOLATION', 'READ',
  'DEFERRABLE', 'NOT'];
// END IF, END LOOP...: their start is no BEGIN or CASE
const OTHER_ENDS = ['IF', 'LOOP', 'WHILE', 'REPEAT', 'FOR'];

const opensTransaction = next => !next || next.type === 'semi' || next.type === 'sep'
  || TRANSACTION.includes(next.word);

// 'routine' | 'package' | 'anonymous' when the statement starting at tokens[i] is a block
const blockKind = (tokens, i) => {
  const { word } = tokens[i];
  if (word === 'DECLARE' || (word === 'BEGIN' && !opensTransaction(tokens[i + 1]))) {
    return 'anonymous';
  }
  if (word !== 'CREATE') {
    return null;
  }
  for (let j = i + 1; j < Math.min(tokens.length, i + 12); j += 1) {
    const w = tokens[j].word;
    if (ROUTINES.includes(w)) {
      return 'routine';
    }
    if (w === 'PACKAGE' || (w === 'TYPE' && (tokens[j + 1] || {}).word === 'BODY')) {
      return 'package';
    }
    if (OBJECTS.includes(w) || tokens[j].type === 'semi') {
      return null;
    }
  }
  return null;
};

// The block after one more token. depth: BEGIN / CASE levels open. pending: declarations are
// being read and the body is still to come (Oracle `IS ... BEGIN`, `DECLARE ... BEGIN`, a T-SQL
// body that runs until GO). headed: the AS / IS that starts the body was passed.
const follow = (block, tokens, i, dialect) => {
  const t = tokens[i];
  const next = tokens[i + 1] || {};
  const prev = tokens[i - 1] || {};
  if (t.type === 'open' || t.type === 'close') {
    return { ...block, parens: Math.max(0, block.parens + (t.type === 'open' ? 1 : -1)) };
  }
  if (t.type !== 'word' || block.parens > 0) {
    return block;
  }
  if (t.word === 'BEGIN' && !opensTransaction(next)) {
    return { ...block, depth: block.depth + 1, pending: false };
  }
  if (t.word === 'CASE' && prev.word !== 'END') {
    return { ...block, depth: block.depth + 1 };
  }
  if (t.word === 'END' && !OTHER_ENDS.includes(next.word)) {
    return { ...block, depth: Math.max(0, block.depth - 1) };
  }
  if (t.word === 'DECLARE' && block.depth === 0) {
    return { ...block, pending: true };
  }
  if ((t.word === 'AS' || t.word === 'IS') && block.depth === 0 && !block.headed
    && dialect !== 'mysql') {
    return {
      ...block,
      headed: true,
      depth: block.kind === 'package' ? 1 : 0,
      // PostgreSQL: AS $$ body $$, the body is a string
      pending: block.kind === 'routine' && next.type !== 'string',
    };
  }
  return block;
};

export const splitStatements = (text, dialect = 'generic') => {
  const source = text === undefined || text === null ? '' : `${text}`;
  const lang = DIALECTS.includes(dialect) ? dialect : 'generic';
  const tokens = scan(source, lang);
  const statements = [];
  let first = -1;
  let lastEnd = -1;
  let bodyEnd = -1;
  let block = null;
  const emit = (end) => {
    const statement = first < 0 ? '' : source.slice(first, end).trim();
    if (statement) {
      statements.push(statement);
    }
    first = -1;
    block = null;
  };
  const keepsSemicolon = () => !!block && lang === 'oracle';
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type === 'sep') {
      emit(keepsSemicolon() ? lastEnd : bodyEnd);
    } else if (t.type === 'semi' && !(block && (block.depth > 0 || block.pending))) {
      emit(keepsSemicolon() ? t.end : bodyEnd);
    } else {
      if (first < 0) {
        first = t.start;
        const kind = blockKind(tokens, i);
        block = kind ? {
          kind, depth: 0, parens: 0, pending: false, headed: false,
        } : null;
      }
      block = block && follow(block, tokens, i, lang);
      lastEnd = t.end;
      bodyEnd = t.type === 'semi' ? bodyEnd : t.end;
    }
  }
  emit(keepsSemicolon() ? lastEnd : bodyEnd);
  return statements;
};

// A DROP or TRUNCATE anywhere outside strings, names and comments: DROP TABLE, ALTER TABLE ...
// DROP COLUMN, SQL Server's IF EXISTS (...) DROP TABLE, a block that drops something
export const isDestructive = statement => scan(`${statement || ''}`, 'generic')
  .some(t => t.word === 'DROP' || t.word === 'TRUNCATE');
