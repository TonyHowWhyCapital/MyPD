// doT templates (delimiters of _getTemplateString: {{= }}, {{? }}, {{~ }}).
// `it.object` carries derived values prepared by dbobject_util.buildTemplateData.
const L = (...lines) => lines.join('\n');
const SEP = '{{=it.separator}}';
const NAME = '{{=it.object.defKey}}';
const TABLE = '{{=it.entity.defKey}}';
const P = 'it.object.props';
const UNSUPPORTED = {unsupported: true};

const triggerEachEvent = (head, tail) => L(
  '{{~ it.object.triggerNames :t}}',
  head,
  tail,
  '{{~}}',
);

const mysqlTrigger = {
  create: triggerEachEvent(
    `CREATE TRIGGER {{=t.name}} {{=${P}.timing}} {{=t.event}} ON ${TABLE} FOR EACH ROW`,
    L('BEGIN', '{{=it.object.body}}', `END${SEP}`),
  ),
  drop: L('{{~ it.object.triggerNames :t}}', `DROP TRIGGER IF EXISTS {{=t.name}}${SEP}`, '{{~}}'),
};

const sequence = (cycle, noCycle, dropIfExists) => ({
  create: L(
    `CREATE SEQUENCE ${NAME}`,
    `{{? ${P}.start}} START WITH {{=${P}.start}}{{?}}`,
    `{{? ${P}.increment}} INCREMENT BY {{=${P}.increment}}{{?}}`,
    `{{? ${P}.minValue}} MINVALUE {{=${P}.minValue}}{{?}}`,
    `{{? ${P}.maxValue}} MAXVALUE {{=${P}.maxValue}}{{?}}`,
    `{{? ${P}.cache}} CACHE {{=${P}.cache}}{{?}}`,
    `{{? ${P}.cycle}} ${cycle}{{??}} ${noCycle}{{?}}${SEP}`,
  ).replace(/\n/g, ''),
  drop: `DROP SEQUENCE ${dropIfExists ? 'IF EXISTS ' : ''}${NAME}${SEP}`,
});

const rangeOrListValues = (modifyKeyword) => L(
  `ALTER TABLE ${TABLE} ${modifyKeyword}`,
  `{{? ${P}.method === 'HASH'}}PARTITION BY HASH ({{=it.object.columnNames}}) PARTITIONS {{=it.object.partitionCount}}${SEP}`,
  `{{??}}PARTITION BY {{=${P}.method}} ({{=it.object.columnNames}}) (`,
  '{{~ it.object.partitionList :p}}',
  `  PARTITION {{=p.name}} {{? ${P}.method === 'LIST'}}VALUES ({{=p.values}}){{??}}VALUES LESS THAN ({{=p.values}}){{?}}{{=p.comma}}`,
  '{{~}}',
  `)${SEP}`,
  '{{?}}',
);

const mysqlPartition = {
  create: L(
    `ALTER TABLE ${TABLE}`,
    `{{? ${P}.method === 'HASH'}}PARTITION BY HASH ({{=it.object.columnNames}}) PARTITIONS {{=it.object.partitionCount}}${SEP}`,
    `{{??}}PARTITION BY {{=${P}.method}} COLUMNS ({{=it.object.columnNames}}) (`,
    '{{~ it.object.partitionList :p}}',
    `  PARTITION {{=p.name}} {{? ${P}.method === 'LIST'}}VALUES IN ({{=p.values}}){{??}}VALUES LESS THAN ({{=p.values}}){{?}}{{=p.comma}}`,
    '{{~}}',
    `)${SEP}`,
    '{{?}}',
  ),
  drop: `ALTER TABLE ${TABLE} REMOVE PARTITIONING${SEP}`,
};

const grantPrivileges = `{{=it.object.privilegeList}}`;
const withGrant = `{{? ${P}.withGrantOption}} WITH GRANT OPTION{{?}}`;

const procedureSignature = (paramsKey) => `{{=it.object.${paramsKey}}}`;

export const dbObjectTypes = {
  tablespace: {
    needsEntity: false,
    hasBody: false,
    defaultProps: {dataFile: '', size: '100M', autoExtend: true},
    propFields: [
      {key: 'dataFile', editor: 'input'},
      {key: 'size', editor: 'input'},
      {key: 'autoExtend', editor: 'checkbox'},
    ],
    templates: {
      default: {
        create: `CREATE TABLESPACE ${NAME} DATAFILE '{{=${P}.dataFile}}'{{? ${P}.size}} SIZE {{=${P}.size}}{{?}}{{? ${P}.autoExtend}} AUTOEXTEND ON{{?}}${SEP}`,
        drop: `DROP TABLESPACE ${NAME} INCLUDING CONTENTS AND DATAFILES${SEP}`,
      },
      mysql: {
        create: `CREATE TABLESPACE ${NAME} ADD DATAFILE '{{=${P}.dataFile}}' ENGINE=InnoDB${SEP}`,
        drop: `DROP TABLESPACE ${NAME}${SEP}`,
      },
      postgresql: {
        create: `CREATE TABLESPACE ${NAME} LOCATION '{{=${P}.dataFile}}'${SEP}`,
        drop: `DROP TABLESPACE IF EXISTS ${NAME}${SEP}`,
      },
      sqlserver: {
        create: L(
          `ALTER DATABASE CURRENT ADD FILEGROUP ${NAME}${SEP}`,
          `ALTER DATABASE CURRENT ADD FILE (NAME = ${NAME}_dat, FILENAME = '{{=${P}.dataFile}}'{{? ${P}.size}}, SIZE = {{=${P}.size}}{{?}}, FILEGROWTH = {{? ${P}.autoExtend}}10%{{??}}0{{?}}) TO FILEGROUP ${NAME}${SEP}`,
        ),
        drop: L(
          `ALTER DATABASE CURRENT REMOVE FILE ${NAME}_dat${SEP}`,
          `ALTER DATABASE CURRENT REMOVE FILEGROUP ${NAME}${SEP}`,
        ),
      },
    },
  },
  sequence: {
    needsEntity: false,
    hasBody: false,
    defaultProps: {start: '1', increment: '1', minValue: '', maxValue: '', cycle: false, cache: ''},
    propFields: [
      {key: 'start', editor: 'number'},
      {key: 'increment', editor: 'number'},
      {key: 'minValue', editor: 'number'},
      {key: 'maxValue', editor: 'number'},
      {key: 'cache', editor: 'number'},
      {key: 'cycle', editor: 'checkbox'},
    ],
    templates: {
      default: sequence('CYCLE', 'NO CYCLE', true),
      mysql: UNSUPPORTED,
      oracle: sequence('CYCLE', 'NOCYCLE', false),
    },
  },
  partition: {
    needsEntity: true,
    hasBody: false,
    defaultProps: {method: 'RANGE', columns: [], partitions: [{name: 'p0', values: ''}]},
    propFields: [
      {key: 'method', editor: 'select', options: ['RANGE', 'LIST', 'HASH']},
      {key: 'columns', editor: 'fields'},
      {key: 'partitions', editor: 'list', itemFields: [
        {key: 'name', editor: 'input'},
        {key: 'values', editor: 'input'},
      ]},
    ],
    templates: {
      default: mysqlPartition,
      mysql: mysqlPartition,
      oracle: {
        create: rangeOrListValues('MODIFY'),
        drop: L(
          `{{? ${P}.method === 'HASH'}}-- hash partitions cannot be dropped one by one, rebuild table ${TABLE}`,
          '{{??}}{{~ it.object.partitionList :p}}',
          `ALTER TABLE ${TABLE} DROP PARTITION {{=p.name}}${SEP}`,
          '{{~}}{{?}}',
        ),
      },
      postgresql: {
        create: L(
          `-- parent table ${TABLE} must be declared with PARTITION BY {{=${P}.method}} ({{=it.object.columnNames}})`,
          '{{~ it.object.partitionList :p}}',
          `CREATE TABLE {{=p.name}} PARTITION OF ${TABLE} {{? ${P}.method === 'HASH'}}FOR VALUES WITH (MODULUS {{=it.object.partitionCount}}, REMAINDER {{=p.index}}){{?? ${P}.method === 'LIST'}}FOR VALUES IN ({{=p.values}}){{??}}FOR VALUES FROM ({{=p.lower}}) TO ({{=p.values}}){{?}}${SEP}`,
          '{{~}}',
        ),
        drop: L('{{~ it.object.partitionList :p}}', `DROP TABLE IF EXISTS {{=p.name}}${SEP}`, '{{~}}'),
      },
      sqlserver: UNSUPPORTED,
    },
  },
  procedure: {
    needsEntity: false,
    hasBody: true,
    defaultProps: {kind: 'PROCEDURE', params: [], returns: ''},
    propFields: [
      {key: 'kind', editor: 'select', options: ['PROCEDURE', 'FUNCTION']},
      {key: 'params', editor: 'list', itemFields: [
        {key: 'name', editor: 'input'},
        {key: 'mode', editor: 'select', options: ['IN', 'OUT', 'INOUT']},
        {key: 'type', editor: 'input'},
      ]},
      {key: 'returns', editor: 'input'},
    ],
    templates: {
      default: {
        create: L(
          `CREATE {{=${P}.kind}} ${NAME}(${procedureSignature('paramsMode')})`,
          `{{? ${P}.kind === 'FUNCTION'}}RETURNS {{=${P}.returns}}{{?}}`,
          'BEGIN',
          '{{=it.object.body}}',
          `END${SEP}`,
        ),
        drop: `DROP {{=${P}.kind}} IF EXISTS ${NAME}${SEP}`,
      },
      mysql: {
        create: L(
          `CREATE {{=${P}.kind}} ${NAME}({{? ${P}.kind === 'FUNCTION'}}${procedureSignature('paramsPlain')}{{??}}${procedureSignature('paramsMode')}{{?}})`,
          `{{? ${P}.kind === 'FUNCTION'}}RETURNS {{=${P}.returns}}{{?}}`,
          'BEGIN',
          '{{=it.object.body}}',
          `END${SEP}`,
        ),
        drop: `DROP {{=${P}.kind}} IF EXISTS ${NAME}${SEP}`,
      },
      oracle: {
        create: L(
          `CREATE OR REPLACE {{=${P}.kind}} ${NAME}{{? it.object.paramsOracle}}(${procedureSignature('paramsOracle')}){{?}}`,
          `{{? ${P}.kind === 'FUNCTION'}}RETURN {{=${P}.returns}}{{?}}`,
          'IS',
          'BEGIN',
          '{{=it.object.body}}',
          `END${SEP}`,
        ),
        drop: `DROP {{=${P}.kind}} ${NAME}${SEP}`,
      },
      postgresql: {
        create: L(
          `CREATE OR REPLACE {{=${P}.kind}} ${NAME}(${procedureSignature('paramsMode')})`,
          `{{? ${P}.kind === 'FUNCTION'}}RETURNS {{=${P}.returns}}{{?}}`,
          'LANGUAGE plpgsql AS $$',
          'BEGIN',
          '{{=it.object.body}}',
          `END;`,
          `$$${SEP}`,
        ),
        drop: `DROP {{=${P}.kind}} IF EXISTS ${NAME}${SEP}`,
      },
      sqlserver: {
        create: L(
          `CREATE OR ALTER {{=${P}.kind}} ${NAME}{{? ${P}.kind === 'FUNCTION'}}(${procedureSignature('paramsAt')})`,
          `RETURNS {{=${P}.returns}}{{??}} ${procedureSignature('paramsAt')}{{?}}`,
          'AS',
          'BEGIN',
          '{{=it.object.body}}',
          `END${SEP}`,
        ),
        drop: `DROP {{=${P}.kind}} IF EXISTS ${NAME}${SEP}`,
      },
    },
  },
  trigger: {
    needsEntity: true,
    hasBody: true,
    defaultProps: {timing: 'BEFORE', events: ['INSERT'], forEach: 'ROW'},
    propFields: [
      {key: 'timing', editor: 'select', options: ['BEFORE', 'AFTER', 'INSTEAD OF']},
      {key: 'events', editor: 'multiSelect', options: ['INSERT', 'UPDATE', 'DELETE']},
      {key: 'forEach', editor: 'select', options: ['ROW', 'STATEMENT']},
    ],
    templates: {
      default: mysqlTrigger,
      mysql: mysqlTrigger,
      oracle: {
        create: L(
          `CREATE OR REPLACE TRIGGER ${NAME}`,
          `{{=${P}.timing}} {{=it.object.eventList}} ON ${TABLE}`,
          `{{? ${P}.forEach === 'ROW'}}FOR EACH ROW{{?}}`,
          'BEGIN',
          '{{=it.object.body}}',
          `END${SEP}`,
        ),
        drop: `DROP TRIGGER ${NAME}${SEP}`,
      },
      postgresql: {
        create: L(
          `CREATE OR REPLACE FUNCTION {{=it.object.fnName}}() RETURNS trigger AS $$`,
          'BEGIN',
          '{{=it.object.body}}',
          'END;',
          `$$ LANGUAGE plpgsql${SEP}`,
          `CREATE TRIGGER ${NAME} {{=${P}.timing}} {{=it.object.eventList}} ON ${TABLE} FOR EACH {{=${P}.forEach}} EXECUTE FUNCTION {{=it.object.fnName}}()${SEP}`,
        ),
        drop: L(
          `DROP TRIGGER IF EXISTS ${NAME} ON ${TABLE}${SEP}`,
          `DROP FUNCTION IF EXISTS {{=it.object.fnName}}()${SEP}`,
        ),
      },
      sqlserver: {
        create: L(
          `CREATE OR ALTER TRIGGER ${NAME} ON ${TABLE}`,
          `{{? ${P}.timing === 'AFTER'}}AFTER{{??}}INSTEAD OF{{?}} {{=it.object.eventListComma}}`,
          'AS',
          'BEGIN',
          '{{=it.object.body}}',
          `END${SEP}`,
        ),
        drop: `DROP TRIGGER IF EXISTS ${NAME}${SEP}`,
      },
    },
  },
  synonym: {
    needsEntity: false,
    hasBody: false,
    defaultProps: {targetName: '', isPublic: false},
    propFields: [
      {key: 'targetName', editor: 'input'},
      {key: 'isPublic', editor: 'checkbox'},
    ],
    templates: {
      default: {
        create: `CREATE SYNONYM ${NAME} FOR {{=it.object.target}}${SEP}`,
        drop: `DROP SYNONYM ${NAME}${SEP}`,
      },
      mysql: UNSUPPORTED,
      postgresql: UNSUPPORTED,
      oracle: {
        create: `CREATE OR REPLACE {{? ${P}.isPublic}}PUBLIC {{?}}SYNONYM ${NAME} FOR {{=it.object.target}}${SEP}`,
        drop: `DROP {{? ${P}.isPublic}}PUBLIC {{?}}SYNONYM ${NAME}${SEP}`,
      },
      sqlserver: {
        create: `CREATE SYNONYM ${NAME} FOR {{=it.object.target}}${SEP}`,
        drop: `DROP SYNONYM IF EXISTS ${NAME}${SEP}`,
      },
    },
  },
  grant: {
    needsEntity: true,
    hasBody: false,
    defaultProps: {privileges: ['SELECT'], grantee: '', withGrantOption: false},
    propFields: [
      {key: 'privileges', editor: 'multiSelect',
        options: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'ALTER', 'INDEX']},
      {key: 'grantee', editor: 'input'},
      {key: 'withGrantOption', editor: 'checkbox'},
    ],
    templates: {
      default: {
        create: `GRANT ${grantPrivileges} ON ${TABLE} TO {{=${P}.grantee}}${withGrant}${SEP}`,
        drop: `REVOKE ${grantPrivileges} ON ${TABLE} FROM {{=${P}.grantee}}${SEP}`,
      },
    },
  },
};
