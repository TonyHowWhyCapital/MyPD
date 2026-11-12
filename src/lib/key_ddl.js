// The keys of a table other than its primary key, as the statements that make their
// columns unique. They follow the statement that creates the table.
export const uniqueKeyDdl = (entity, separator = ';') => {
  return ((entity && entity.keys) || []).filter(k => !k.primary).map((key) => {
    const columns = (key.fields || [])
      .map(id => ((entity.fields || []).find(f => f.id === id) || {}).defKey).filter(c => c);
    if (columns.length === 0) {
      return '';
    }
    const name = `${key.constraintName || key.defKey || ''}`.trim();
    return `ALTER TABLE ${entity.defKey} ADD ${name ? `CONSTRAINT ${name} ` : ''}UNIQUE (${columns.join(', ')})${separator}`;
  }).filter(line => line);
};

export const withUniqueKeys = (ddl, entity, separator) => {
  const lines = uniqueKeyDdl(entity, separator);
  return lines.length > 0 && ddl ? `${ddl}\n${lines.join('\n')}` : ddl;
};
