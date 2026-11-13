// How the statement that creates the table writes its name: with the schema in front of
// it and in the quotes of the database, e.g. [dbo].[EMP]. The keys are written the same way.
const tableOf = (ddl) => {
  const found = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i.exec(ddl || '');
  return found ? found[1] : '';
};

const QUOTES = { '[': ']', '`': '`', '"': '"' };

const quoteOf = (table) => {
  const last = table.split('.').pop() || '';
  const close = QUOTES[last[0]];
  return close && last.endsWith(close) ? name => `${last[0]}${name}${close}` : name => name;
};

// The keys of a table other than its primary key, as the statements that make their
// columns unique. They follow the statement that creates the table.
export const uniqueKeyDdl = (entity, separator = ';', table = '') => {
  const quote = quoteOf(table);
  return ((entity && entity.keys) || []).filter(k => !k.primary).map((key) => {
    const columns = (key.fields || [])
      .map(id => ((entity.fields || []).find(f => f.id === id) || {}).defKey).filter(c => c);
    if (columns.length === 0) {
      return '';
    }
    const name = `${key.constraintName || key.defKey || ''}`.trim();
    return `ALTER TABLE ${table || entity.defKey} ADD ${name ? `CONSTRAINT ${quote(name)} ` : ''}UNIQUE (${columns.map(quote).join(', ')})${separator}`;
  }).filter(line => line);
};

export const withUniqueKeys = (ddl, entity, separator) => {
  const lines = uniqueKeyDdl(entity, separator, tableOf(ddl));
  return lines.length > 0 && ddl ? `${ddl}\n${lines.join('\n')}` : ddl;
};
