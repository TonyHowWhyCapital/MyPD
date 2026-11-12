import demo from '../src/lib/template/教学管理系统.pdma.json';
import {
  dbObjectTypes, getDbObjectTypeList, getEmptyDbObject, validateDbObject,
  addDbObject, updateDbObject, removeDbObject, getDbObjectDDL,
  getAllDbObjectsDDL, getDbObjectsByEntity,
} from '../src/lib/dbobject_util';

const ds = JSON.parse(JSON.stringify(demo));
const dbId = (key) => ds.profile.dataTypeSupports.find(s => s.defKey.toLowerCase() === key).id;
const entity = ds.entities[0];
const field = entity.fields[0];

const make = (type, patch = {}) => {
  const o = getEmptyDbObject(type);
  return {...o, defKey: `my_${type}`, refEntity: entity.id, ...patch, props: {...o.props, ...patch.props}};
};

const samples = {
  trigger: make('trigger', {body: 'SELECT 1;', props: {timing: 'AFTER', events: ['INSERT', 'UPDATE']}}),
  procedure: make('procedure', {
    body: 'SELECT 1;',
    props: {kind: 'FUNCTION', returns: 'INT', params: [{name: 'p1', mode: 'IN', type: 'INT'}]},
  }),
  sequence: make('sequence', {props: {start: 5, increment: 2, cycle: true, cache: 20}}),
  partition: make('partition', {props: {
    method: 'RANGE', columns: [field.id],
    partitions: [{name: 'p0', values: '10'}, {name: 'p1', values: '20'}],
  }}),
  tablespace: make('tablespace', {props: {dataFile: '/data/ts.dbf'}}),
  synonym: make('synonym', {refEntity: '', props: {targetName: 'other.tbl', isPublic: true}}),
  grant: make('grant', {props: {privileges: ['SELECT', 'INSERT'], grantee: 'bob', withGrantOption: true}}),
  view: make('view', {refEntity: '', body: 'select 1 as one'}),
};

test('registry has the eight types with form metadata', () => {
  expect(getDbObjectTypeList().sort()).toEqual(Object.keys(samples).sort());
  getDbObjectTypeList().forEach((t) => {
    expect(dbObjectTypes[t].templates.default).toBeTruthy();
    expect(Array.isArray(dbObjectTypes[t].propFields)).toBe(true);
  });
  expect(() => getEmptyDbObject('nope')).toThrow();
});

describe('DDL per type', () => {
  const expectations = {
    trigger: {
      mysql: [['CREATE TRIGGER my_trigger_insert AFTER INSERT ON', 'FOR EACH ROW', 'SELECT 1;'], ['DROP TRIGGER IF EXISTS my_trigger_update']],
      oracle: [['CREATE OR REPLACE TRIGGER my_trigger', 'AFTER INSERT OR UPDATE ON'], ['DROP TRIGGER my_trigger']],
      postgresql: [['CREATE OR REPLACE FUNCTION my_trigger_fn()', 'EXECUTE FUNCTION my_trigger_fn()'], ['DROP TRIGGER IF EXISTS my_trigger ON', 'DROP FUNCTION IF EXISTS my_trigger_fn()']],
      sqlserver: [['CREATE OR ALTER TRIGGER my_trigger ON', 'AFTER INSERT, UPDATE'], ['DROP TRIGGER IF EXISTS my_trigger']],
    },
    procedure: {
      mysql: [['CREATE FUNCTION my_procedure(p1 INT)', 'RETURNS INT', 'END;'], ['DROP FUNCTION IF EXISTS my_procedure']],
      oracle: [['CREATE OR REPLACE FUNCTION my_procedure(p1 IN INT)', 'RETURN INT'], ['DROP FUNCTION my_procedure']],
      postgresql: [['CREATE OR REPLACE FUNCTION my_procedure(IN p1 INT)', 'LANGUAGE plpgsql'], ['DROP FUNCTION IF EXISTS my_procedure']],
      sqlserver: [['CREATE OR ALTER FUNCTION my_procedure(@p1 INT)', 'RETURNS INT'], ['DROP FUNCTION IF EXISTS my_procedure']],
    },
    sequence: {
      oracle: [['CREATE SEQUENCE my_sequence START WITH 5 INCREMENT BY 2', 'CACHE 20', 'CYCLE;'], ['DROP SEQUENCE my_sequence;']],
      postgresql: [['CREATE SEQUENCE my_sequence START WITH 5', 'CYCLE;'], ['DROP SEQUENCE IF EXISTS my_sequence']],
    },
    partition: {
      mysql: [['PARTITION BY RANGE COLUMNS (', 'PARTITION p0 VALUES LESS THAN (10),', 'PARTITION p1 VALUES LESS THAN (20)'], ['REMOVE PARTITIONING']],
      oracle: [['MODIFY', 'PARTITION BY RANGE', 'VALUES LESS THAN (20)'], ['DROP PARTITION p1']],
      postgresql: [['PARTITION OF', 'FOR VALUES FROM (10) TO (20)', 'FROM (MINVALUE) TO (10)'], ['DROP TABLE IF EXISTS p0']],
    },
    tablespace: {
      mysql: [["CREATE TABLESPACE my_tablespace ADD DATAFILE '/data/ts.dbf'"], ['DROP TABLESPACE my_tablespace']],
      oracle: [["DATAFILE '/data/ts.dbf' SIZE 100M AUTOEXTEND ON"], ['INCLUDING CONTENTS']],
      postgresql: [["CREATE TABLESPACE my_tablespace LOCATION '/data/ts.dbf'"], ['DROP TABLESPACE IF EXISTS']],
    },
    synonym: {
      oracle: [['CREATE OR REPLACE PUBLIC SYNONYM my_synonym FOR other.tbl'], ['DROP PUBLIC SYNONYM my_synonym']],
      sqlserver: [['CREATE SYNONYM my_synonym FOR other.tbl'], ['DROP SYNONYM IF EXISTS my_synonym']],
    },
    grant: {
      mysql: [['GRANT SELECT, INSERT ON', 'TO bob WITH GRANT OPTION;'], ['REVOKE SELECT, INSERT ON', 'FROM bob']],
      oracle: [['GRANT SELECT, INSERT ON'], ['REVOKE']],
      postgresql: [['GRANT SELECT, INSERT ON'], ['REVOKE']],
    },
  };
  Object.keys(expectations).forEach((type) => {
    Object.keys(expectations[type]).forEach((db) => {
      test(`${type} on ${db}`, () => {
        const [create, drop] = expectations[type][db];
        const createSql = getDbObjectDDL(samples[type], ds, dbId(db), 'create');
        create.forEach(f => expect(createSql).toContain(f));
        const dropSql = getDbObjectDDL(samples[type], ds, dbId(db), 'drop');
        drop.forEach(f => expect(dropSql).toContain(f));
      });
    });
  });

  test('table-bound statements use the resolved entity name and column names', () => {
    expect(getDbObjectDDL(samples.partition, ds, dbId('mysql'))).toContain(`ALTER TABLE ${entity.defKey}`);
    expect(getDbObjectDDL(samples.partition, ds, dbId('mysql'))).toContain(`(${field.defKey})`);
  });
});

test('unsupported combinations become a single comment line', () => {
  const mysqlSeq = getDbObjectDDL(samples.sequence, ds, dbId('mysql'));
  expect(mysqlSeq).toBe('-- sequence is not supported by MYSQL');
  expect(getDbObjectDDL(samples.synonym, ds, dbId('postgresql'), 'drop')).toMatch(/^-- synonym is not supported/);
  expect(getDbObjectDDL(samples.partition, ds, dbId('sqlserver'))).toMatch(/^--/);
});

test('unmapped databases fall back to the default template', () => {
  expect(getDbObjectDDL(samples.sequence, ds, dbId('sqlite'))).toContain('CREATE SEQUENCE my_sequence');
});

test('customDDL replaces the create statement only', () => {
  const o = {...samples.sequence, customDDL: '  CREATE SEQUENCE custom;  '};
  expect(getDbObjectDDL(o, ds, dbId('oracle'))).toBe('CREATE SEQUENCE custom;');
  expect(getDbObjectDDL(o, ds, dbId('oracle'), 'drop')).toBe('DROP SEQUENCE my_sequence;');
});

describe('collection operations', () => {
  test('add, update, remove, query by entity', () => {
    let next = addDbObject(ds, samples.grant);
    expect(next.dbObjects).toHaveLength(1);
    expect(ds.dbObjects).toBeUndefined();
    next = updateDbObject(next, {...samples.grant, comment: 'changed'});
    expect(next.dbObjects[0].comment).toBe('changed');
    expect(getDbObjectsByEntity(next, entity.id)).toHaveLength(1);
    expect(getDbObjectsByEntity(next, 'other')).toHaveLength(0);
    next = removeDbObject(next, samples.grant.id);
    expect(next.dbObjects).toEqual([]);
  });

  test('validation errors carry codes', () => {
    const base = addDbObject(ds, samples.trigger);
    expect(validateDbObject({...samples.trigger, defKey: ' '}, ds)).toContain('emptyDefKey');
    expect(validateDbObject({...samples.trigger, id: 'x', defKey: 'MY_TRIGGER'}, base)).toContain('duplicate');
    expect(validateDbObject({...samples.sequence, id: 'y', defKey: 'MY_TRIGGER'}, base)).toEqual([]);
    expect(validateDbObject({...samples.trigger, type: 'bogus'}, ds)).toContain('unknownType');
    expect(validateDbObject({...samples.trigger, refEntity: ''}, ds)).toContain('missingEntity');
    expect(validateDbObject({...samples.trigger, refEntity: 'nope'}, ds)).toContain('unknownEntity');
    let error;
    try {
      addDbObject(base, {...samples.trigger, id: 'z'});
    } catch (e) {
      error = e;
    }
    expect(error.codes).toEqual(['duplicate']);
    expect(() => updateDbObject(ds, samples.trigger)).toThrow();
  });
});

test('getAllDbObjectsDDL orders by dependency and supports filters and drop', () => {
  const all = {...ds, dbObjects: ['grant', 'trigger', 'synonym', 'procedure', 'partition', 'sequence', 'tablespace']
    .map(t => samples[t])};
  const sql = getAllDbObjectsDDL(all, dbId('oracle'));
  const positions = ['CREATE TABLESPACE', 'CREATE SEQUENCE', 'PARTITION BY', 'CREATE OR REPLACE FUNCTION',
    'CREATE OR REPLACE TRIGGER', 'SYNONYM', 'GRANT'].map(k => sql.indexOf(k));
  expect(positions.every(p => p >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(getAllDbObjectsDDL(all, dbId('oracle'), {types: ['grant']})).not.toContain('TABLESPACE');
  expect(getAllDbObjectsDDL(all, dbId('oracle'), {ids: [samples.grant.id]})).toMatch(/^GRANT/);
  expect(getAllDbObjectsDDL(all, dbId('oracle'), {types: ['sequence'], withDrop: true}))
    .toMatch(/^DROP SEQUENCE my_sequence;\nCREATE SEQUENCE/);
});

test('legacy project without dbObjects still works', () => {
  expect(ds.dbObjects).toBeUndefined();
  expect(getAllDbObjectsDDL(ds, dbId('mysql'))).toBe('');
  expect(getDbObjectsByEntity(ds, entity.id)).toEqual([]);
  expect(removeDbObject(ds, 'x').dbObjects).toEqual([]);
});
