// What is shown about a database connection before anything is written through it: its
// name, the server and the database, never the user name or the password. Pure.
import { defaultConn } from '../../../../../lib/conn_db';
import { dialectOfName } from '../../../../../lib/testdata/sql';

const text = v => `${v === undefined || v === null ? '' : v}`.trim();

export const connections = dataSource => ((dataSource && dataSource.dbConn) || [])
  .filter(c => c && c.defKey);

// the connection in use: the chosen one, else the default of the project, else the only one
export const pickConn = (dataSource, key) => {
  const list = connections(dataSource);
  return list.find(c => c.defKey === key) || defaultConn(dataSource)
    || (list.length === 1 ? list[0] : null) || null;
};

const property = (url, names) => {
  const found = new RegExp(`[;?&](?:${names.join('|')})=([^;&]*)`, 'i').exec(url);
  return found ? decodeURIComponent(found[1].replace(/\+/g, ' ')).trim() : '';
};

const hostPort = (value) => {
  const at = value.lastIndexOf('@');
  return (at >= 0 ? value.slice(at + 1) : value).replace(/^\[|\]$/g, '');
};

// {kind, host, database}; what cannot be told stays ''
export const parseJdbc = (jdbcUrl) => {
  const url = text(jdbcUrl);
  const kind = (/^jdbc:([a-z0-9]+)/i.exec(url) || [])[1] || '';
  const result = {
    kind: kind.toLowerCase(),
    host: '',
    database: '',
  };
  if (/^jdbc:oracle:/i.test(url)) {
    const target = url.slice(url.indexOf('@') + 1);
    const named = /^\/\/([^/?]+)\/([^?;]+)/.exec(target) || /^([^/:?]+(?::\d+)?)\/([^?;]+)/.exec(target);
    const sid = /^([^/:?(]+):(\d+):([^?;/]+)$/.exec(target);
    if (named) {
      [, result.host, result.database] = named;
    } else if (sid) {
      result.host = `${sid[1]}:${sid[2]}`;
      [, , , result.database] = sid;
    }
    return result;
  }
  if (/^jdbc:sqlserver:/i.test(url)) {
    result.host = hostPort((/^jdbc:sqlserver:\/\/([^;]*)/i.exec(url) || [])[1] || '');
    result.database = property(url, ['databaseName', 'database']);
    return result;
  }
  const generic = /^jdbc:(?:[a-z0-9]+:)*\/\/([^/?;]*)(?:\/([^?;]*))?/i.exec(url);
  if (generic) {
    result.host = hostPort(generic[1] || '');
    result.database = decodeURIComponent(generic[2] || '').trim()
      || property(url, ['databaseName', 'database']);
  }
  return result;
};

// the address without anything secret, for the rare case nothing could be read from it
export const safeUrl = jdbcUrl => text(jdbcUrl)
  .replace(/\/\/[^/@?;]*@/, '//')
  .replace(/(:thin:)[^@]*@/i, '$1@')
  .replace(/([;?&](?:password|pwd|user|username|uid)=)[^;&]*/gi, '$1***');

const dialectOfConn = (dataSource, conn) => {
  const supports = (dataSource && dataSource.profile && dataSource.profile.dataTypeSupports) || [];
  const support = supports.find(s => s && s.id === conn.type);
  const byType = dialectOfName((support && support.defKey) || conn.type);
  if (byType !== 'generic') {
    return byType;
  }
  const byUrl = {
    sqlserver: 'mssql',
    jtds: 'mssql',
    mysql: 'mysql',
    mariadb: 'mysql',
    postgresql: 'postgresql',
    oracle: 'oracle',
  };
  return byUrl[parseJdbc((conn.properties || {}).url).kind] || 'generic';
};

// name     as the user called the connection
// host     server (and port), database: as far as the address tells
// confirm  what has to be typed before data is deleted: the database, else the name
// byDatabase  true when `confirm` is the name of the database
export const connTarget = (dataSource, conn) => {
  if (!conn) {
    return null;
  }
  const props = conn.properties || {};
  const parsed = parseJdbc(props.url);
  const name = text(conn.defName) || text(conn.defKey);
  return {
    key: conn.defKey,
    name,
    host: parsed.host,
    database: parsed.database,
    address: parsed.host ? '' : safeUrl(props.url),
    confirm: parsed.database || name,
    byDatabase: !!parsed.database,
    dialect: dialectOfConn(dataSource, conn),
    complete: !!text(props.url) && !!text(props.driver_class_name),
  };
};
