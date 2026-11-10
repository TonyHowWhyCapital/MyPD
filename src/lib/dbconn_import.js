import crypto from 'crypto';
import './Math';
import { parseXml, walk } from './pdm/xml';

// kind -> [dataTypeSupports defKey, driver class, default port, url builder]
const kinds = {
  mysql: ['MYSQL', 'com.mysql.cj.jdbc.Driver', 3306,
    c => `jdbc:mysql://${c.host}:${c.port}/${c.database}?characterEncoding=UTF-8&useSSL=false&useUnicode=true&serverTimezone=UTC`],
  postgresql: ['PostgreSQL', 'org.postgresql.Driver', 5432,
    c => `jdbc:postgresql://${c.host}:${c.port}/${c.database || 'postgres'}`],
  sqlserver: ['SQLServer', 'com.microsoft.sqlserver.jdbc.SQLServerDriver', 1433,
    c => `jdbc:sqlserver://${c.host}:${c.port}${c.database ? `;DatabaseName=${c.database}` : ''}`],
  oracle: ['ORACLE', 'oracle.jdbc.driver.OracleDriver', 1521,
    c => `jdbc:oracle:thin:@${c.host}:${c.port}/${c.database}`],
  sqlite: ['SQLite', 'org.sqlite.JDBC', '', c => `jdbc:sqlite:${c.database}`],
  db2: ['DB2', 'com.ibm.db2.jcc.DB2Driver', 50000,
    c => `jdbc:db2://${c.host}:${c.port}/${c.database}:progressiveStreaming=2`],
  dm: ['DM', 'dm.jdbc.driver.DmDriver', 5236, c => `jdbc:dm://${c.host}:${c.port}/${c.database}`],
  kingbase: ['Kingbase', 'com.kingbase8.Driver', 54321,
    c => `jdbc:kingbase8://${c.host}:${c.port}/${c.database}`],
};

const aliases = {
  mariadb: 'mysql', postgres: 'postgresql', pgsql: 'postgresql', mssql: 'sqlserver',
  dameng: 'dm', kingbasees: 'kingbase',
};

export const normalizeKind = (name) => {
  const key = `${name || ''}`.toLowerCase().replace(/[\s_-]/g, '');
  const kind = aliases[key] || key;
  return kinds[kind] ? kind : '';
};

// Navicat 12+ export files store the password as AES-128-CBC hex with a fixed key.
// Older files use another scheme; those passwords are left empty.
export const decodeNavicatPassword = (hex) => {
  if (!/^([0-9a-f]{32})+$/i.test(hex || '')) {
    return '';
  }
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', 'libcckeylibcckey', 'libcciv libcciv ');
    return Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()]).toString('utf8');
  } catch (e) {
    return '';
  }
};

const connection = (source, name, type, rest) => ({
  id: Math.uuid(),
  source,
  name,
  sourceType: type,
  kind: normalizeKind(type),
  host: '',
  port: '',
  database: '',
  username: '',
  password: '',
  ...rest,
});

export const parseNavicat = (xml) => {
  let root;
  try {
    root = parseXml(xml);
  } catch (e) {
    throw new Error('Invalid Navicat connection file');
  }
  const found = [];
  walk(root, (el) => {
    if (el.tag === 'Connection' && el.attrs.ConnectionName) {
      found.push(el.attrs);
    }
  });
  if (!root.children.some(c => c.type === 'el' && c.tag === 'Connections')) {
    throw new Error('Invalid Navicat connection file');
  }
  return found.map(a => connection('navicat', a.ConnectionName, a.ConnType, {
    host: a.Host || '',
    port: a.Port || '',
    database: a.Database || a.ServiceName || a.SID || a.DatabaseFileName || '',
    username: a.UserName || '',
    password: decodeNavicatPassword(a.Password),
  }));
};

// rows: [{config_json}] from the connections table of a DBX data file.
// DBX keeps passwords encrypted with its own key, so they are not imported.
export const parseDbxRows = (rows) => {
  return (rows || []).map((row) => {
    let config;
    try {
      config = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
    } catch (e) {
      config = null;
    }
    return config && config.name ? connection('dbx', config.name, config.db_type, {
      host: config.host || '',
      port: config.port || '',
      database: config.database || '',
      username: config.username || '',
    }) : null;
  }).filter(c => c);
};

// A connection can be imported when the project has a matching database type.
export const resolveType = (conn, dataSource) => {
  const support = kinds[conn.kind] && (dataSource?.profile?.dataTypeSupports || [])
    .find(s => s.defKey.toLowerCase() === kinds[conn.kind][0].toLowerCase());
  return support ? support.id : '';
};

export const toDbConn = (conn, dataSource) => {
  const type = resolveType(conn, dataSource);
  if (!type) {
    throw new Error(`Unsupported database type: ${conn.sourceType || ''}`);
  }
  const [, driver, defaultPort, buildUrl] = kinds[conn.kind];
  return {
    defKey: Math.uuid(),
    defName: conn.name,
    type,
    properties: {
      driver_class_name: driver,
      url: buildUrl({ ...conn, port: conn.port || defaultPort }),
      username: conn.username,
      password: conn.password,
    },
  };
};

// Appends the chosen connections, renaming on a name clash so nothing is overwritten.
export const importDbConns = (dbConn, conns, dataSource) => {
  const names = new Set((dbConn || []).map(d => d.defName));
  return (dbConn || []).concat(conns.map((conn) => {
    const item = toDbConn(conn, dataSource);
    let name = item.defName;
    for (let i = 2; names.has(name); i += 1) {
      name = `${item.defName} (${i})`;
    }
    names.add(name);
    return { ...item, defName: name };
  }));
};
