import crypto from 'crypto';
import {
  parseNavicat, parseDbxRows, parseDbxJson, toDbConn, importDbConns, resolveType, decodeNavicatPassword,
} from '../src/lib/dbconn_import';
import base from '../src/lib/template/empty.json';

const encrypt = (text) => {
  const cipher = crypto.createCipheriv('aes-128-cbc', 'libcckeylibcckey', 'libcciv libcciv ');
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('hex').toUpperCase();
};
const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<Connections Ver="1.4">
	<Connection ConnectionName="Shop &amp; Co" ConnType="MYSQL" Host="10.0.0.5" Port="3307" UserName="root" Password="${encrypt('s3cret!')}" SavePassword="true"/>
	<Connection ConnectionName="ERP" ConnType="SQLSERVER" Host="erp.local" Port="1433" Database="ERPDB" UserName="sa" Password=""/>
	<Connection ConnectionName="Old" ConnType="POSTGRESQL" Host="pg" Port="" UserName="u" Password="ABCDEF"/>
	<Connection ConnectionName="Docs" ConnType="MONGODB" Host="mongo" Port="27017" UserName="" Password=""/>
</Connections>`;
const typeKey = id => base.profile.dataTypeSupports.find(s => s.id === id).defKey;

describe('navicat connection file', () => {
  const conns = parseNavicat(ncx);

  test('reads name, host, port, user and decodes the password', () => {
    expect(conns[0]).toMatchObject({
      name: 'Shop & Co', kind: 'mysql', host: '10.0.0.5', port: '3307', username: 'root', password: 's3cret!',
    });
  });

  test('leaves the password empty when it is absent or in an unknown format', () => {
    expect(conns[1].password).toBe('');
    expect(conns[2].password).toBe('');
    expect(decodeNavicatPassword('00112233445566778899AABBCCDDEEFF')).toBe('');
  });

  test('builds a jdbc connection for the matching database type', () => {
    const erp = toDbConn(conns[1], base);
    expect(typeKey(erp.type)).toBe('SQLServer');
    expect(erp).toMatchObject({
      defName: 'ERP',
      properties: {
        driver_class_name: 'com.microsoft.sqlserver.jdbc.SQLServerDriver',
        url: 'jdbc:sqlserver://erp.local:1433;DatabaseName=ERPDB',
        username: 'sa',
      },
    });
    expect(toDbConn(conns[0], base).properties.url).toMatch(/^jdbc:mysql:\/\/10\.0\.0\.5:3307\/\?/);
  });

  test('uses the default port and database when the file has none', () => {
    expect(toDbConn(conns[2], base).properties.url).toBe('jdbc:postgresql://pg:5432/postgres');
  });

  test('flags database types the project cannot connect to', () => {
    expect(resolveType(conns[3], base)).toBe('');
    expect(() => toDbConn(conns[3], base)).toThrow(/Unsupported database type: MONGODB/);
    expect(resolveType(conns[0], { profile: { dataTypeSupports: [] } })).toBe('');
  });

  test('rejects a file that is not a navicat export', () => {
    expect(() => parseNavicat('<Model></Model>')).toThrow(/Invalid Navicat connection file/);
    expect(() => parseNavicat('not xml <')).toThrow(/Invalid Navicat connection file/);
  });
});

describe('dbx connections', () => {
  const rows = [
    { config_json: JSON.stringify({ name: 'Report', db_type: 'postgres', host: 'db.local', port: 5433, username: 'app', password: '', database: 'report' }) },
    { config_json: JSON.stringify({ name: 'Local', db_type: 'sqlite', host: '', port: 0, username: '', database: '/data/app.db' }) },
    { config_json: '{broken' },
  ];
  const conns = parseDbxRows(rows);

  test('reads connections without passwords and skips unreadable rows', () => {
    expect(conns).toHaveLength(2);
    expect(conns[0]).toMatchObject({ name: 'Report', kind: 'postgresql', host: 'db.local', username: 'app', password: '' });
  });

  test('builds jdbc urls for server and file databases', () => {
    expect(toDbConn(conns[0], base).properties.url).toBe('jdbc:postgresql://db.local:5433/report');
    expect(toDbConn(conns[1], base).properties).toMatchObject({ driver_class_name: 'org.sqlite.JDBC', url: 'jdbc:sqlite:/data/app.db' });
  });
});

describe('adding imported connections to a project', () => {
  test('keeps existing connections and renames duplicates', () => {
    const conns = parseNavicat(ncx).slice(1, 2);
    const existing = [{ defKey: 'k1', defName: 'ERP', type: 'x', properties: {} }];
    const result = importDbConns(importDbConns(existing, conns, base), conns, base);
    expect(result.map(d => d.defName)).toEqual(['ERP', 'ERP (2)', 'ERP (3)']);
    expect(result[0]).toBe(existing[0]);
    expect(new Set(result.map(d => d.defKey)).size).toBe(3);
  });

  test('a project without connections starts a new list', () => {
    expect(importDbConns(undefined, parseNavicat(ncx).slice(0, 1), base)).toHaveLength(1);
  });
});

describe('dbx json export', () => {
  const file = JSON.stringify({
    connections: [
      { name: 'Plain', db_type: 'sqlserver', host: 'h', port: 1433, username: 'sa', password: 'pw', database: 'IPC' },
      { name: 'NoPass', db_type: 'mysql', host: 'm', port: 3306, username: 'u', password: '', database: '' },
      { db_type: 'mysql' },
    ],
    layout: {},
  });

  test('reads connections and keeps a password the export contains', () => {
    const conns = parseDbxJson(file);
    expect(conns).toHaveLength(2);
    expect(conns[0]).toMatchObject({ name: 'Plain', kind: 'sqlserver', password: 'pw', database: 'IPC' });
    expect(conns[1].password).toBe('');
    expect(toDbConn(conns[0], base).properties).toMatchObject({ url: 'jdbc:sqlserver://h:1433;DatabaseName=IPC', password: 'pw' });
  });

  test('accepts a bare list and rejects other files', () => {
    expect(parseDbxJson(JSON.stringify([{ name: 'A', db_type: 'postgres' }]))).toHaveLength(1);
    expect(() => parseDbxJson('{"tables": []}')).toThrow(/Invalid DBX connection file/);
    expect(() => parseDbxJson('not json')).toThrow(/Invalid DBX connection file/);
  });

  test('a data file row never carries a password', () => {
    expect(parseDbxRows([{ config_json: { name: 'X', db_type: 'mysql', password: 'cipher' } }])[0].password).toBe('');
  });
});
