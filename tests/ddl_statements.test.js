import { splitStatements, isDestructive, dialectOfConn } from '../src/lib/ddl_statements';

describe('splitStatements', () => {
  test('splits several ALTER statements and drops the trailing semicolons', () => {
    const script = `ALTER TABLE a ADD COLUMN x INT;
ALTER TABLE b ADD COLUMN y VARCHAR(10);

ALTER TABLE c DROP COLUMN z;`;
    expect(splitStatements(script, 'mysql')).toEqual([
      'ALTER TABLE a ADD COLUMN x INT',
      'ALTER TABLE b ADD COLUMN y VARCHAR(10)',
      'ALTER TABLE c DROP COLUMN z',
    ]);
  });

  test('a semicolon inside a string does not split, doubled quotes included', () => {
    expect(splitStatements("UPDATE t SET a = 'x;y''s; z'; SELECT 1", 'postgresql')).toEqual([
      "UPDATE t SET a = 'x;y''s; z'",
      'SELECT 1',
    ]);
  });

  test('a semicolon inside line and block comments does not split', () => {
    const script = `-- first; still a comment
ALTER TABLE a ADD x INT; /* note; with ; semicolons */
ALTER TABLE b /* inside; */ ADD y INT -- tail;
;`;
    expect(splitStatements(script, 'generic')).toEqual([
      'ALTER TABLE a ADD x INT',
      'ALTER TABLE b /* inside; */ ADD y INT',
    ]);
  });

  test('MySQL back quotes and SQL Server brackets are names, not separators', () => {
    expect(splitStatements('ALTER TABLE `a;b` ADD `c;d` INT; SELECT 1', 'mysql'))
      .toEqual(['ALTER TABLE `a;b` ADD `c;d` INT', 'SELECT 1']);
    expect(splitStatements('ALTER TABLE [a;b] ADD [c;d] INT; SELECT 1', 'mssql'))
      .toEqual(['ALTER TABLE [a;b] ADD [c;d] INT', 'SELECT 1']);
    expect(splitStatements('ALTER TABLE "a;b" ADD "c;d" INT; SELECT 1', 'oracle'))
      .toEqual(['ALTER TABLE "a;b" ADD "c;d" INT', 'SELECT 1']);
  });

  test('a PostgreSQL function body in dollar quotes is one statement', () => {
    const fn = `CREATE OR REPLACE FUNCTION touch() RETURNS trigger AS $body$
BEGIN
  NEW.updated := now();
  RETURN NEW;
END;
$body$ LANGUAGE plpgsql`;
    const other = 'CREATE FUNCTION one() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql';
    expect(splitStatements(`${fn};\n${other};\nALTER TABLE t ADD c INT;`, 'postgresql'))
      .toEqual([fn, other, 'ALTER TABLE t ADD c INT']);
  });

  test('an Oracle trigger keeps END; and the slash line ends it', () => {
    const trigger = `CREATE OR REPLACE TRIGGER trg_t
BEFORE INSERT ON t FOR EACH ROW
DECLARE
  v NUMBER;
BEGIN
  IF :NEW.id IS NULL THEN
    SELECT seq.NEXTVAL INTO v FROM dual;
    :NEW.id := v;
  END IF;
END;`;
    const script = `ALTER TABLE t ADD (c NUMBER);\n${trigger}\n/\nALTER TABLE t ADD (d NUMBER);\n`;
    expect(splitStatements(script, 'oracle')).toEqual([
      'ALTER TABLE t ADD (c NUMBER)',
      trigger,
      'ALTER TABLE t ADD (d NUMBER)',
    ]);
  });

  test('an Oracle procedure with declarations before BEGIN stays whole', () => {
    const proc = `CREATE OR REPLACE PROCEDURE p(a IN NUMBER) IS
  x NUMBER := CAST(a AS NUMBER);
BEGIN
  x := x + 1;
END p;`;
    expect(splitStatements(`${proc}\n/\n`, 'oracle')).toEqual([proc]);
    expect(splitStatements(`${proc}\nSELECT 1 FROM dual;`, 'oracle')).toEqual([proc, 'SELECT 1 FROM dual']);
  });

  test('an Oracle package spec and body are each one statement', () => {
    const spec = `CREATE OR REPLACE PACKAGE pk AS
  PROCEDURE a;
  FUNCTION b RETURN NUMBER;
END pk;`;
    const body = `CREATE OR REPLACE PACKAGE BODY pk AS
  PROCEDURE a IS
  BEGIN
    NULL;
  END a;
  FUNCTION b RETURN NUMBER IS
  BEGIN
    RETURN 1;
  END b;
END pk;`;
    expect(splitStatements(`${spec}\n/\n${body}\n/\n`, 'oracle')).toEqual([spec, body]);
  });

  test('SQL Server GO lines are separators, in any case and with spaces', () => {
    const proc = `CREATE PROCEDURE dbo.p AS
SET NOCOUNT ON;
SELECT 1;`;
    const script = `ALTER TABLE t ADD c INT\nGO\n${proc}\n  go  \nALTER TABLE t ADD d INT\nGo`;
    expect(splitStatements(script, 'mssql')).toEqual([
      'ALTER TABLE t ADD c INT',
      'CREATE PROCEDURE dbo.p AS\nSET NOCOUNT ON;\nSELECT 1',
      'ALTER TABLE t ADD d INT',
    ]);
  });

  test('GO and a slash only separate when they are alone on their line', () => {
    expect(splitStatements('SELECT a / b FROM go_table\nWHERE go = 1', 'mssql'))
      .toEqual(['SELECT a / b FROM go_table\nWHERE go = 1']);
  });

  test('CASE ... END inside a procedure does not end it', () => {
    const proc = `CREATE PROCEDURE p()
BEGIN
  DECLARE v INT;
  SET v = CASE WHEN 1 = 1 THEN 1 ELSE 0 END;
  CASE v
    WHEN 1 THEN SELECT 'one';
    ELSE SELECT 'other';
  END CASE;
  WHILE v < 3 DO
    SET v = v + 1;
  END WHILE;
END`;
    expect(splitStatements(`${proc};\nALTER TABLE t ADD c INT;`, 'mysql'))
      .toEqual([proc, 'ALTER TABLE t ADD c INT']);
  });

  test('an anonymous block keeps its inner semicolons', () => {
    const block = `BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE t ADD c NUMBER';
  EXECUTE IMMEDIATE 'ALTER TABLE t ADD d NUMBER';
END;`;
    expect(splitStatements(`${block}\n/`, 'oracle')).toEqual([block]);
    expect(splitStatements(`${block}\nSELECT 1;`, 'postgresql')).toEqual([block.slice(0, -1), 'SELECT 1']);
  });

  test('a transaction BEGIN is not a block', () => {
    expect(splitStatements('BEGIN TRANSACTION; ALTER TABLE t ADD c INT; COMMIT;', 'mssql'))
      .toEqual(['BEGIN TRANSACTION', 'ALTER TABLE t ADD c INT', 'COMMIT']);
  });

  test('Oracle plain SQL loses its semicolon, everything else is kept as typed', () => {
    expect(splitStatements('ALTER TABLE t MODIFY (c VARCHAR2(20));\n/\n', 'oracle'))
      .toEqual(['ALTER TABLE t MODIFY (c VARCHAR2(20))']);
  });

  test('blank statements and statements of only comments are dropped', () => {
    expect(splitStatements('  ;\n;\n-- nothing here;\n/* nor here */;\n\n', 'mysql')).toEqual([]);
    expect(splitStatements('', 'generic')).toEqual([]);
    expect(splitStatements(undefined, 'generic')).toEqual([]);
  });

  test('a MySQL backslash escape inside a string does not end it', () => {
    expect(splitStatements("INSERT INTO t VALUES ('a\\';b'); SELECT 1", 'mysql'))
      .toEqual(["INSERT INTO t VALUES ('a\\';b')", 'SELECT 1']);
  });
});

describe('isDestructive', () => {
  test('DROP, ALTER TABLE ... DROP and TRUNCATE lose data, wherever they stand', () => {
    [
      'DROP TABLE t',
      'drop view v',
      'DROP INDEX idx_a ON t',
      'DROP SEQUENCE s',
      '-- note\nDROP TABLE IF EXISTS t',
      'ALTER TABLE t DROP COLUMN c',
      'ALTER TABLE t DROP CONSTRAINT pk_t',
      'ALTER TABLE t DROP (c, d)',
      'ALTER TABLE `t` ADD x INT, DROP y',
      'TRUNCATE TABLE t',
      "IF EXISTS (SELECT * FROM sys.objects WHERE name = N'T') DROP TABLE [dbo].[T]",
      "BEGIN\n  EXECUTE IMMEDIATE 'x';\n  DROP TABLE t;\nEND;",
    ].forEach(s => expect([s, isDestructive(s)]).toEqual([s, true]));
  });

  test('additions and changes do not', () => {
    [
      'ALTER TABLE t ADD COLUMN c INT',
      'ALTER TABLE t MODIFY COLUMN c VARCHAR(20)',
      "COMMENT ON COLUMN t.c IS 'DROP me'",
      'CREATE TABLE drop_log (id INT)',
      'ALTER TABLE t ADD "DROP" INT',
      "ALTER TABLE t ADD c VARCHAR(10) DEFAULT 'drop'",
      'CREATE INDEX idx ON t (c)',
      '',
    ].forEach(s => expect([s, isDestructive(s)]).toEqual([s, false]));
  });
});

describe('dialectOfConn', () => {
  const dataSource = {
    profile: {
      dataTypeSupports: [
        { id: 'id-mysql', defKey: 'MYSQL' },
        { id: 'id-ora', defKey: 'ORACLE' },
        { id: 'id-ms', defKey: 'SQLServer' },
        { id: 'id-pg', defKey: 'PostgreSQL' },
        { id: 'id-dm', defKey: 'DM' },
      ],
    },
  };
  const conn = (type, url = '') => ({ type, properties: { url } });

  test('the database type of the connection decides', () => {
    expect(dialectOfConn(dataSource, conn('id-mysql'))).toBe('mysql');
    expect(dialectOfConn(dataSource, conn('id-ora'))).toBe('oracle');
    expect(dialectOfConn(dataSource, conn('id-ms'))).toBe('mssql');
    expect(dialectOfConn(dataSource, conn('id-pg'))).toBe('postgresql');
    expect(dialectOfConn(dataSource, conn('SQLite'))).toBe('sqlite');
  });

  test('the JDBC address decides when the type tells nothing', () => {
    expect(dialectOfConn(dataSource, conn('id-dm', 'jdbc:dm://h:5236/db'))).toBe('generic');
    expect(dialectOfConn(dataSource, conn('', 'jdbc:sqlite:/tmp/x.db'))).toBe('sqlite');
    expect(dialectOfConn(dataSource, conn('x', 'jdbc:sqlserver://h:1433;databaseName=d'))).toBe('mssql');
    expect(dialectOfConn({}, null)).toBe('generic');
  });
});
