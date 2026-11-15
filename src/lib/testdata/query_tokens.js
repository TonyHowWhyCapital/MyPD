// A tolerant reader of SQL text for the model check of a `query` rule (query_check.js): it
// splits the text into tokens and knows strings, quoted names, comments, numbers and
// parameters of the four databases. It does not judge anything. Pure.
//
// token = {type, text, start, end, depth}
//   type   'word' | 'quoted' | 'string' | 'number' | 'param' | 'op'
//   name   word and quoted: the name without its quotes
//   quote  quoted: the opening character (" ` [)
//   from, to  the place of `name` in the text (inside the quotes)
//   depth  how many parentheses are open around the token

const isSpace = c => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'
  || c === ' ' || c === '　';
const isDigit = c => c >= '0' && c <= '9';
// letters of any script (Chinese names are common), `_`, and inside a name digits, $ and #
const isWordStart = c => /[A-Za-z_\u0080-￿]/.test(c);
const isWordPart = c => isWordStart(c) || isDigit(c) || c === '$' || c === '#';

const OPS = ['->>', '::', '<=', '>=', '<>', '!=', '||', '->', ':=', '=>', '==', '^='];
// letters that may stand directly before a quote: N'text', E'text', B'0101', X'1F'
const STRING_PREFIX = ['N', 'E', 'B', 'X'];

// problems that stop the reading: the text cannot be split with confidence
export const UNTERMINATED = 'unterminated';
export const QUOTING = 'quoting';
export const UNBALANCED = 'unbalanced';

// -> {tokens, problem?}
export const tokenize = (sql) => {
  const text = `${sql === undefined || sql === null ? '' : sql}`;
  const n = text.length;
  const tokens = [];
  let depth = 0;
  let i = 0;
  const stop = problem => ({ tokens, problem });
  const push = (type, start, end, more) => tokens.push({
    type, text: text.slice(start, end), start, end, depth, ...more,
  });
  // the index after the closing character; a doubled one belongs to the text; -1 = not closed
  const closing = (start, close) => {
    let j = start + 1;
    while (j < n) {
      if (text[j] === close) {
        if (text[j + 1] !== close) {
          return j + 1;
        }
        j += 1;
      }
      j += 1;
    }
    return -1;
  };
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    const last = tokens[tokens.length - 1];
    if (isSpace(c)) {
      i += 1;
    } else if (c === '-' && d === '-') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') {
        i += 1;
      }
    } else if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) {
        return stop(UNTERMINATED);
      }
      i = end + 2;
    } else if (c === '\'') {
      const end = closing(i, '\'');
      if (end < 0) {
        return stop(UNTERMINATED);
      }
      if (text.slice(i, end).includes('\\')) {
        // databases disagree about a backslash inside quotes
        return stop(QUOTING);
      }
      let start = i;
      if (last && last.type === 'word' && last.end === i
        && STRING_PREFIX.includes(last.text.toUpperCase())) {
        ({ start } = tokens.pop());
      }
      push('string', start, end);
      i = end;
    } else if (c === '"' || c === '`') {
      const end = closing(i, c);
      if (end < 0) {
        return stop(UNTERMINATED);
      }
      push('quoted', i, end, {
        name: text.slice(i + 1, end - 1).split(c + c).join(c),
        quote: c,
        from: i + 1,
        to: end - 1,
      });
      i = end;
    } else if (c === '[' && !(last && last.end === i
      && (last.type === 'word' || last.type === 'quoted' || last.text === ')' || last.text === ']'))) {
      // [name] of SQL Server; directly behind a name or a bracket it is an index (PostgreSQL)
      const end = text.indexOf(']', i + 1);
      const inner = end < 0 ? '' : text.slice(i + 1, end);
      if (end < 0) {
        return stop(UNTERMINATED);
      }
      if (/['"`[\n]/.test(inner)) {
        return stop(QUOTING);
      }
      push('quoted', i, end + 1, {
        name: inner, quote: '[', from: i + 1, to: end,
      });
      i = end + 1;
    } else if (c === '#' || (c === '$' && /^\$[A-Za-z_]*\$/.test(text.slice(i, i + 64)))) {
      // a MySQL comment or a temporary table; PostgreSQL dollar quoting
      return stop(QUOTING);
    } else if (isDigit(c) || (c === '.' && isDigit(d || ''))) {
      const found = /^(?:0[xX][0-9a-fA-F]+|\d*\.?\d*(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 80));
      const end = i + Math.max(1, found[0].length);
      push('number', i, end);
      i = end;
    } else if (isWordStart(c)) {
      let end = i + 1;
      while (end < n && isWordPart(text[end])) {
        end += 1;
      }
      push('word', i, end, { name: text.slice(i, end), from: i, to: end });
      i = end;
    } else if (c === '?' || ((c === '@' || c === ':' || c === '$' || c === '%')
      && d !== undefined && (isWordPart(d) || d === '@') && !(c === ':' && d === ':'))) {
      let end = i + 1;
      while (end < n && (isWordPart(text[end]) || text[end] === '@')) {
        end += 1;
      }
      push('param', i, end);
      i = end;
    } else {
      const op = OPS.find(o => text.startsWith(o, i)) || c;
      if (op === ')' || op === ']') {
        depth -= 1;
        if (depth < 0) {
          return stop(UNBALANCED);
        }
      }
      push('op', i, i + op.length);
      if (op === '(' || op === '[') {
        depth += 1;
      }
      i += op.length;
    }
  }
  return depth === 0 ? { tokens } : stop(UNBALANCED);
};

export const isOp = (t, text) => !!t && t.type === 'op' && t.text === text;
export const upper = t => (t && t.type === 'word' ? t.text.toUpperCase() : '');
export const isWord = (t, word) => upper(t) === word;

// Edit distance between two names, for "did you mean"; two letters swapped count as one slip
export const distance = (a, b) => {
  let before = [];
  let prev = Array.from({ length: b.length + 1 }, (v, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], before[j - 2] + 1);
      }
    }
    before = prev;
    prev = row;
  }
  return prev[b.length];
};

const plain = name => name.toLowerCase().replace(/[_\s-]/g, '');

// The names closest to `name`, nearest first, at most three; [] when none is close
export const nearest = (name, names) => {
  const wanted = plain(`${name}`);
  if (!wanted) {
    return [];
  }
  const limit = Math.min(3, Math.max(1, Math.floor(wanted.length / 3)));
  const scored = names.map(candidate => ({
    candidate,
    d: distance(wanted, plain(candidate)),
  })).filter(s => s.d <= limit && s.d < Math.max(wanted.length, plain(s.candidate).length));
  const best = Math.min(...scored.map(s => s.d));
  return scored.filter(s => s.d === best).map(s => s.candidate).sort().slice(0, 3);
};
