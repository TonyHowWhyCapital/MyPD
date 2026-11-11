// Helpers for choosing which database of a server a jdbc connection points at.

// url kinds that can switch database: [matcher, system databases hidden from the list]
const kinds = {
  sqlserver: ['master', 'tempdb', 'model', 'msdb'],
  mysql: ['information_schema', 'mysql', 'performance_schema', 'sys'],
  mariadb: ['information_schema', 'mysql', 'performance_schema', 'sys'],
  postgresql: ['template0', 'template1'],
};

const kindOf = (url) => {
  const kind = (/^jdbc:([a-z0-9]+):\/\//i.exec(url || '') || [])[1];
  return kind && kinds[kind.toLowerCase()] ? kind.toLowerCase() : '';
};

// true when the database of this url can be chosen from a list
export const canChooseDatabase = url => !!kindOf(url);

const sqlServerKey = /;\s*(databaseName|database)\s*=\s*(\{[^}]*\}|[^;]*)/i;
const pathUrl = /^(jdbc:[a-z0-9]+:\/\/[^/?;]*)(\/[^?;]*)?(.*)$/i;

export const databaseOfUrl = (url) => {
  const kind = kindOf(url);
  if (kind === 'sqlserver') {
    return ((sqlServerKey.exec(url) || [])[2] || '').replace(/^\{|\}$/g, '').trim();
  }
  return kind ? decodeURIComponent(((pathUrl.exec(url) || [])[2] || '').slice(1)) : '';
};

// Returns the url pointing at the given database; other parts of the url are kept.
export const withDatabase = (url, database) => {
  const kind = kindOf(url);
  if (!kind || !database) {
    return url;
  }
  if (kind === 'sqlserver') {
    const value = /[;{}\s]/.test(database) ? `{${database}}` : database;
    return sqlServerKey.test(url)
      ? url.replace(sqlServerKey, (all, key) => `;${key}=${value}`)
      : `${url.replace(/;+\s*$/, '')};DatabaseName=${value}`;
  }
  return url.replace(pathUrl, (all, head, path, rest) => `${head}/${encodeURIComponent(database)}${rest}`);
};

// Hides the server's own system databases, but keeps the one the url already uses.
export const userDatabases = (url, names) => {
  const system = kinds[kindOf(url)] || [];
  const current = databaseOfUrl(url).toLowerCase();
  return (names || [])
    .filter(n => n.toLowerCase() === current || !system.includes(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
};
