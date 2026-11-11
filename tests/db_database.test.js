import { canChooseDatabase, databaseOfUrl, withDatabase, userDatabases } from '../src/lib/db_database';

describe('database of a jdbc url', () => {
  test('sql server: reads, adds and replaces the database', () => {
    const bare = 'jdbc:sqlserver://10.0.0.1:1433';
    expect(databaseOfUrl(bare)).toBe('');
    expect(withDatabase(bare, 'IPC')).toBe('jdbc:sqlserver://10.0.0.1:1433;DatabaseName=IPC');
    const full = 'jdbc:sqlserver://h:1433;databaseName=master;encrypt=false';
    expect(databaseOfUrl(full)).toBe('master');
    expect(withDatabase(full, 'CS.TBS')).toBe('jdbc:sqlserver://h:1433;databaseName=CS.TBS;encrypt=false');
    expect(withDatabase('jdbc:sqlserver://h;encrypt=false;', 'my db')).toBe('jdbc:sqlserver://h;encrypt=false;DatabaseName={my db}');
    expect(databaseOfUrl('jdbc:sqlserver://h;DatabaseName={my db}')).toBe('my db');
  });

  test('mysql and postgresql: the database is the url path', () => {
    const my = 'jdbc:mysql://h:3306/?characterEncoding=UTF-8&useSSL=false';
    expect(databaseOfUrl(my)).toBe('');
    expect(withDatabase(my, 'shop')).toBe('jdbc:mysql://h:3306/shop?characterEncoding=UTF-8&useSSL=false');
    expect(withDatabase('jdbc:postgresql://h:5432/postgres', 'oms')).toBe('jdbc:postgresql://h:5432/oms');
    expect(withDatabase('jdbc:postgresql://h:5432', 'oms')).toBe('jdbc:postgresql://h:5432/oms');
    expect(databaseOfUrl('jdbc:postgresql://h:5432/oms?ssl=true')).toBe('oms');
  });

  test('other databases and an empty choice leave the url alone', () => {
    const oracle = 'jdbc:oracle:thin:@h:1521/orcl';
    expect(canChooseDatabase(oracle)).toBe(false);
    expect(canChooseDatabase('jdbc:sqlite:/data/a.db')).toBe(false);
    expect(withDatabase(oracle, 'x')).toBe(oracle);
    expect(withDatabase('jdbc:mysql://h/a', '')).toBe('jdbc:mysql://h/a');
    expect(canChooseDatabase('jdbc:sqlserver://h')).toBe(true);
  });

  test('system databases are hidden unless the url uses one', () => {
    const names = ['tempdb', 'IPC', 'master', 'model', 'msdb', 'Alpha'];
    expect(userDatabases('jdbc:sqlserver://h', names)).toEqual(['Alpha', 'IPC']);
    expect(userDatabases('jdbc:sqlserver://h;DatabaseName=master', names)).toEqual(['Alpha', 'IPC', 'master']);
    expect(userDatabases('jdbc:postgresql://h/postgres', ['template1', 'postgres', 'oms'])).toEqual(['oms', 'postgres']);
  });
});
