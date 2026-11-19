// SQL Server keeps a column default as the text of its constraint, always in brackets:
// ('abc'), ((0)), (getdate()). The jar returns that text, an empty string when there is no
// default, and for a char column puts quotes around it, so no default comes back as ''
// and 'abc' as '('abc')'. This turns both back into what the column really has.

const isSqlServer = url => /^jdbc:sqlserver:/i.test(url || '');

// Index of the bracket that closes the one at 0, skipping brackets inside string literals.
const closingBracket = (text) => {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'") {
      quoted = !quoted;
    } else if (!quoted && c === '(') {
      depth += 1;
    } else if (!quoted && c === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
};

const unbracket = (text) => {
  let result = text.trim();
  while (result.startsWith('(') && closingBracket(result) === result.length - 1) {
    result = result.slice(1, -1).trim();
  }
  return result;
};

export const reverseDefault = (value, url) => {
  const text = value === undefined || value === null ? '' : `${value}`;
  if (!isSqlServer(url)) {
    return text;
  }
  const quoted = text.length >= 2 && text.startsWith("'") && text.endsWith("'");
  const inner = quoted ? text.slice(1, -1) : '';
  if (quoted && (inner === '' || inner.startsWith('('))) {
    return unbracket(inner);
  }
  return unbracket(text);
};

export const cleanReverseDefaults = (tables, url) => {
  if (!isSqlServer(url)) {
    return tables;
  }
  return (tables || []).map(t => (t.fields ? {
    ...t,
    fields: t.fields.map(f => ({ ...f, defaultValue: reverseDefault(f.defaultValue, url) })),
  } : t));
};
