const { reverseDefault, cleanReverseDefaults } = require('../src/lib/reverse_default');

const MSSQL = 'jdbc:sqlserver://db:1433;databaseName=oms';
const MYSQL = 'jdbc:mysql://db:3306/oms';

describe('reverseDefault on SQL Server', () => {
  test.each([
    // the jar wraps a missing default of a char column as ''
    ["''", ''],
    ['', ''],
    [undefined, ''],
    [null, ''],
    // char columns: the jar adds quotes around the stored ('...') text
    ["'('abc')'", "'abc'"],
    ["'(N'abc')'", "N'abc'"],
    ["'('')'", "''"],
    ["'('(x)')'", "'(x)'"],
    // other columns: the stored text comes back as it is
    ['((0))', '0'],
    ['(getdate())', 'getdate()'],
    ['(newid())', 'newid()'],
    ['((1)+(2))', '(1)+(2)'],
    ['(1)+(2)', '(1)+(2)'],
    ["('a)')", "'a)'"],
    // a value someone already cleaned stays as it is
    ["'abc'", "'abc'"],
    ['0', '0'],
  ])('%p -> %p', (raw, expected) => {
    expect(reverseDefault(raw, MSSQL)).toBe(expected);
  });
});

describe('reverseDefault on other databases', () => {
  test("keeps '' because it can be a real empty-string default", () => {
    expect(reverseDefault("''", MYSQL)).toBe("''");
    expect(reverseDefault('((0))', MYSQL)).toBe('((0))');
  });
});

describe('cleanReverseDefaults', () => {
  const body = () => [{
    defKey: 'ORDERS',
    fields: [
      { defKey: 'NAME', type: 'nvarchar', defaultValue: "''" },
      { defKey: 'CODE', type: 'varchar', defaultValue: "'('X')'" },
      { defKey: 'QTY', type: 'int', defaultValue: '((0))' },
      { defKey: 'MEMO', type: 'text' },
    ],
  }, { defKey: 'EMPTY' }];

  test('cleans every field default for SQL Server', () => {
    const [orders, empty] = cleanReverseDefaults(body(), MSSQL);
    expect(orders.fields.map(f => f.defaultValue)).toEqual(['', "'X'", '0', '']);
    expect(orders.fields[0]).toEqual({ defKey: 'NAME', type: 'nvarchar', defaultValue: '' });
    expect(empty).toEqual({ defKey: 'EMPTY' });
  });

  test('returns the tables unchanged for other databases', () => {
    const tables = body();
    expect(cleanReverseDefaults(tables, MYSQL)).toBe(tables);
  });

  test('copes with a missing body', () => {
    expect(cleanReverseDefaults(undefined, MSSQL)).toEqual([]);
  });
});
