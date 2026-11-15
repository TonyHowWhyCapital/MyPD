import {
  columnKind, entityColumns, resolveRule, fieldType, parseType,
} from '../src/lib/testdata/columns';
import shop from '../src/lib/template/电商商城.pdma.json';
import { project, entity, field, rule } from './testdata_planner_helpers';

jest.mock('../src/lib/testdata/model', () => require('./testdata_planner_helpers').fakeModel);

const on = (db) => {
  const ds = project([]);
  ds.profile.dataTypeSupports = [{
    id: 'x',
    defKey: db,
  }];
  ds.profile.default.db = 'x';
  return ds;
};
const kind = (db, type, len = '', scale = '') => columnKind(on(db), {
  type,
  len,
  scale,
});

test('type text is split into name and numbers', () => {
  expect(parseType(' numeric( 10 , 2 ) ')).toEqual({
    name: 'NUMERIC',
    args: [10, 2],
  });
  expect(parseType('int unsigned').name).toBe('INT');
  expect(parseType('timestamp(6) with time zone').name).toBe('TIMESTAMP WITH TIME ZONE');
  expect(parseType('varchar2(30 char)')).toEqual({
    name: 'VARCHAR2',
    args: [30],
  });
  expect(parseType(undefined)).toEqual({
    name: '',
    args: [],
  });
});

test.each([
  // SQL Server
  ['SQLServer', 'INT', '', '', 'int'], ['SQLServer', 'BIGINT', '', '', 'int'],
  ['SQLServer', 'TINYINT', '', '', 'int'], ['SQLServer', 'BIT', '', '', 'bool'],
  ['SQLServer', 'DECIMAL', 18, 2, 'decimal'], ['SQLServer', 'DECIMAL', 18, 0, 'int'],
  ['SQLServer', 'DECIMAL', '', '', 'int'], ['SQLServer', 'MONEY', '', '', 'decimal'],
  ['SQLServer', 'FLOAT', '', '', 'decimal'], ['SQLServer', 'NVARCHAR', 50, '', 'string'],
  ['SQLServer', 'NVARCHAR(MAX)', '', '', 'string'], ['SQLServer', 'NTEXT', '', '', 'string'],
  ['SQLServer', 'DATE', '', '', 'date'], ['SQLServer', 'DATETIME2', '', '', 'datetime'],
  ['SQLServer', 'SMALLDATETIME', '', '', 'datetime'], ['SQLServer', 'DATETIMEOFFSET', '', '', 'datetime'],
  ['SQLServer', 'TIME', '', '', 'time'], ['SQLServer', 'VARBINARY', 100, '', 'binary'],
  ['SQLServer', 'IMAGE', '', '', 'binary'], ['SQLServer', 'UNIQUEIDENTIFIER', '', '', 'string'],
  ['SQLServer', 'TIMESTAMP', '', '', 'binary'], ['SQLServer', 'ROWVERSION', '', '', 'binary'],
  // MySQL
  ['MYSQL', 'INT', '', '', 'int'], ['MYSQL', 'MEDIUMINT', '', '', 'int'],
  ['MYSQL', 'TINYINT', 1, '', 'bool'], ['MYSQL', 'TINYINT', 4, '', 'int'],
  ['MYSQL', 'tinyint(1)', '', '', 'bool'], ['MYSQL', 'BIGINT UNSIGNED', '', '', 'int'],
  ['MYSQL', 'DECIMAL', '', '', 'int'], ['MYSQL', 'DECIMAL', 10, 2, 'decimal'],
  ['MYSQL', 'DOUBLE', '', '', 'decimal'], ['MYSQL', 'VARCHAR', 32, '', 'string'],
  ['MYSQL', 'LONGTEXT', '', '', 'string'], ['MYSQL', 'JSON', '', '', 'string'],
  ['MYSQL', 'ENUM', '', '', 'string'], ['MYSQL', 'DATE', '', '', 'date'],
  ['MYSQL', 'DATETIME', '', '', 'datetime'], ['MYSQL', 'TIMESTAMP', '', '', 'datetime'],
  ['MYSQL', 'TIME', '', '', 'time'], ['MYSQL', 'YEAR', '', '', 'int'],
  ['MYSQL', 'BIT', 1, '', 'bool'], ['MYSQL', 'BIT', 8, '', 'binary'],
  ['MYSQL', 'BOOLEAN', '', '', 'bool'], ['MYSQL', 'BLOB', '', '', 'binary'],
  ['MYSQL', 'LONGBLOB', '', '', 'binary'], ['MYSQL', 'VARBINARY', 16, '', 'binary'],
  // PostgreSQL
  ['PostgreSQL', 'INTEGER', '', '', 'int'], ['PostgreSQL', 'INT8', '', '', 'int'],
  ['PostgreSQL', 'BIGSERIAL', '', '', 'int'], ['PostgreSQL', 'NUMERIC', '', '', 'decimal'],
  ['PostgreSQL', 'NUMERIC', 12, '', 'int'], ['PostgreSQL', 'NUMERIC', 12, 4, 'decimal'],
  ['PostgreSQL', 'DOUBLE PRECISION', '', '', 'decimal'], ['PostgreSQL', 'REAL', '', '', 'decimal'],
  ['PostgreSQL', 'CHARACTER VARYING', 20, '', 'string'], ['PostgreSQL', 'TEXT', '', '', 'string'],
  ['PostgreSQL', 'JSONB', '', '', 'string'], ['PostgreSQL', 'UUID', '', '', 'string'],
  ['PostgreSQL', 'DATE', '', '', 'date'], ['PostgreSQL', 'TIMESTAMP', '', '', 'datetime'],
  ['PostgreSQL', 'TIMESTAMPTZ', '', '', 'datetime'],
  ['PostgreSQL', 'TIMESTAMP WITHOUT TIME ZONE', '', '', 'datetime'],
  ['PostgreSQL', 'TIME WITH TIME ZONE', '', '', 'time'], ['PostgreSQL', 'BOOLEAN', '', '', 'bool'],
  ['PostgreSQL', 'BOOL', '', '', 'bool'], ['PostgreSQL', 'BYTEA', '', '', 'binary'],
  // Oracle
  ['ORACLE', 'NUMBER', 10, 0, 'int'], ['ORACLE', 'NUMBER', 10, '', 'int'],
  ['ORACLE', 'NUMBER', 10, 2, 'decimal'], ['ORACLE', 'NUMBER', '', '', 'decimal'],
  ['ORACLE', 'NUMBER(12,3)', '', '', 'decimal'], ['ORACLE', 'INT', '', '', 'int'],
  ['ORACLE', 'BINARY_DOUBLE', '', '', 'decimal'], ['ORACLE', 'VARCHAR2', 64, '', 'string'],
  ['ORACLE', 'NVARCHAR2', 64, '', 'string'], ['ORACLE', 'CLOB', '', '', 'string'],
  ['ORACLE', 'NCLOB', '', '', 'string'], ['ORACLE', 'LONG', '', '', 'string'],
  ['ORACLE', 'DATE', '', '', 'datetime'], ['ORACLE', 'TIMESTAMP', '', '', 'datetime'],
  ['ORACLE', 'TIMESTAMP WITH LOCAL TIME ZONE', '', '', 'datetime'],
  ['ORACLE', 'BLOB', '', '', 'binary'], ['ORACLE', 'RAW', 16, '', 'binary'],
  ['ORACLE', 'LONG RAW', '', '', 'binary'],
  // anything unknown is text
  ['MYSQL', 'WHATEVER', '', '', 'string'], ['MYSQL', '', '', '', 'string'],
])('%s %s(%s,%s) is %s', (db, type, len, scale, expected) => {
  expect(kind(db, type, len, scale)).toBe(expected);
});

test('lengths: uuid columns hold 36 characters, a bare CHAR one', () => {
  const ds = on('PostgreSQL');
  const cols = entityColumns(ds, entity('T', [
    field('A', 'UUID'), field('B', 'CHAR'), field('C', 'VARCHAR(40)'), field('D', 'TEXT'),
    field('E', 'NUMERIC', {
      len: 10,
      scale: 2,
    }),
    field('F', 'VARCHAR', { len: '20' }),
  ]));
  expect(cols.map(c => [c.kind, c.len, c.scale])).toEqual([
    ['string', 36, null], ['string', 1, null], ['string', 40, null], ['string', null, null],
    ['decimal', 10, 2], ['string', 20, null],
  ]);
  expect(cols[0]).toEqual({
    id: 'T.A',
    defKey: 'A',
    defName: 'A',
    kind: 'string',
    type: 'UUID',
    len: 36,
    scale: null,
    notNull: false,
    primaryKey: false,
    autoIncrement: false,
  });
});

test('type comes from the base type in the project database, size from the domain', () => {
  const ds = project([], {}, {
    domains: [{
      id: 'dom',
      defKey: 'Money',
      applyFor: 'map-double',
      len: 24,
      scale: 6,
    }],
    dataTypeMapping: {
      mappings: [{
        id: 'map-double',
        defKey: 'double',
        'db-mysql': 'DECIMAL',
        'db-ora': 'NUMBER',
      }],
    },
  });
  // what the field itself says is out of date
  const f = {
    id: 'f',
    defKey: 'AMOUNT',
    type: 'INT',
    len: 5,
    scale: '',
    domain: 'dom',
    baseType: 'map-double',
  };
  expect(fieldType(ds, f)).toEqual({
    type: 'DECIMAL',
    len: 24,
    scale: 6,
    db: 'MYSQL',
  });
  expect(columnKind(ds, f)).toBe('decimal');
  // a field with an empty type and only a domain (as in the teaching template)
  expect(fieldType(ds, {
    type: '',
    domain: 'dom',
  }).type).toBe('DECIMAL');
  // a domain that is gone: the field's own values count
  expect(fieldType(ds, {
    type: 'INT',
    len: 5,
    domain: 'gone',
  })).toMatchObject({
    type: 'INT',
    len: 5,
  });
});

test('real template: every column gets a kind', () => {
  const kinds = {};
  shop.entities.forEach(e => entityColumns(shop, e).forEach((c) => {
    kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  }));
  // the NUMBER(32,8) fields have the base type "double", DECIMAL on MySQL
  expect(kinds).toEqual({
    string: 83,
    int: 14,
    decimal: 8,
    datetime: 25,
  });
  const order = shop.entities.find(e => e.defKey === 'BUYR_ORDER');
  expect(entityColumns(shop, order)[0]).toMatchObject({
    defKey: 'ORDER_ID',
    kind: 'string',
    type: 'VARCHAR',
    len: 32,
    primaryKey: true,
    notNull: true,
  });
});

describe('resolveRule', () => {
  const rules = [rule('r-field', 'constant', { value: 'x' }, { nullRate: 40 }),
    rule('r-domain', 'sequence')];
  const make = (testData, more = {}) => {
    const ds = project([entity('T', [field('A', 'VARCHAR', {
      domain: 'dom',
      ...more,
    })])], {
      rules,
      domainRules: { dom: 'r-domain' },
      ...testData,
    });
    return {
      ds,
      f: ds.entities[0].fields[0],
    };
  };
  const resolve = ({ ds, f }) => resolveRule(ds, ds.entities[0], f);

  test('field rule, then domain rule, then automatic', () => {
    expect(resolve(make({}, { testData: { rule: 'r-field' } }))).toEqual({
      rule: rules[0],
      source: 'field',
      nullRate: 40,
    });
    expect(resolve(make({}))).toEqual({
      rule: rules[1],
      source: 'domain',
      nullRate: 0,
    });
    expect(resolve(make({ domainRules: {} }))).toMatchObject({
      rule: { kind: 'auto' },
      source: 'auto',
      nullRate: 0,
    });
  });

  test('a reference to a rule that is gone falls through', () => {
    expect(resolve(make({}, { testData: { rule: 'gone' } })).source).toBe('domain');
    expect(resolve(make({ domainRules: { dom: 'gone' } }, { testData: { rule: 'gone' } })).source)
      .toBe('auto');
  });

  test('null rate: the field wins over the rule, and only nullable columns have one', () => {
    const own = {
      rule: 'r-field',
      nullRate: 10,
    };
    expect(resolve(make({}, { testData: own })).nullRate).toBe(10);
    expect(resolve(make({}, { testData: { nullRate: 25 } }))).toMatchObject({
      source: 'domain',
      nullRate: 25,
    });
    expect(resolve(make({}, {
      testData: own,
      notNull: true,
    })).nullRate).toBe(0);
    expect(resolve(make({}, {
      testData: own,
      primaryKey: true,
    })).nullRate).toBe(0);
    expect(resolve(make({}, { testData: { nullRate: 250 } })).nullRate).toBe(100);
  });
});
