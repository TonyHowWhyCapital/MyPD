// Small stand-ins for the rule modules (model.js / values.js) and hand-built projects, so
// the planner and generator tests do not depend on how the rules are implemented.

export const fakeModel = {
  // everything else (numberOf, seedNow ...) is the real thing
  ...jest.requireActual('../src/lib/testdata/model'),
  getTestData: (dataSource) => {
    const td = (dataSource && dataSource.profile && dataSource.profile.testData) || {};
    const settings = td.settings || {};
    return {
      rules: td.rules || [],
      domainRules: td.domainRules || {},
      settings: {
        defaultRows: 100,
        seed: {
          fixed: true,
          value: 1,
        },
        ...settings,
        tables: settings.tables || {},
      },
    };
  },
  validateRule: rule => (rule.kind === 'broken' ? ['brokenRule'] : []),
};

const HEX = '0123456789abcdef';

const autoValue = (column, random) => {
  switch (column.kind) {
    case 'int': return random.int(1, 1000000000);
    case 'decimal': return random.int(0, 100000) / 100;
    case 'bool': return random.next() < 0.5;
    case 'date': return `2024-01-${`${random.int(1, 28)}`.padStart(2, '0')}`;
    case 'datetime': return `2024-01-${`${random.int(1, 28)}`.padStart(2, '0')} 08:00:00`;
    case 'time': return '08:00:00';
    case 'binary': return column.notNull ? 'ff' : null;
    default: {
      const size = Math.min(column.len || 12, 12);
      let text = '';
      for (let i = 0; i < size; i += 1) {
        text += HEX[random.int(0, 15)];
      }
      return text;
    }
  }
};

const columnsOf = expr => (`${expr}`.match(/\[([^\]]+)\]/g) || []).map(m => m.slice(1, -1));

export const fakeValues = {
  exprColumns: (expr) => {
    if (`${expr}`.includes('!!')) {
      const error = new Error('bad formula');
      error.code = 'exprSyntax';
      throw error;
    }
    return columnsOf(expr);
  },
  makeValueGenerator: (rule, column, ctx) => {
    const params = rule.params || {};
    const { random } = ctx;
    switch (rule.kind) {
      case 'sequence': {
        const start = params.start === undefined ? 1 : params.start;
        const step = params.step === undefined ? 1 : params.step;
        return (i) => {
          const n = start + i * step;
          return column.kind === 'string'
            ? `${params.prefix || ''}${`${n}`.padStart(params.pad || 0, '0')}${params.suffix || ''}` : n;
        };
      }
      case 'constant': return () => params.value;
      case 'number': return () => random.int(params.min, params.max);
      case 'list':
        return params.order === 'cycle' ? i => params.items[i % params.items.length].value
          : () => random.weighted(params.items).value;
      case 'file': {
        const list = ctx.lists.file[params.path];
        if (!list) {
          const error = new Error('file not loaded');
          error.code = 'listMissing';
          throw error;
        }
        return () => random.pick(list);
      }
      // the fake formula joins the columns it names
      case 'expr': return (i, row) => columnsOf(params.expr).map(k => row[k]).join('+');
      case 'broken': {
        const error = new Error('broken rule');
        error.code = 'brokenRule';
        throw error;
      }
      default: return () => autoValue(column, random);
    }
  },
};

const DB = 'db-mysql';

export const field = (defKey, type, more = {}) => ({
  id: `${more.entity || ''}${defKey}`,
  defKey,
  defName: defKey,
  type,
  len: '',
  scale: '',
  primaryKey: false,
  notNull: false,
  autoIncrement: false,
  ...more,
});

// entity('ORDERS', [field(...)], { correlations, indexes, keys }); field ids are
// '<table>.<column>'
export const entity = (defKey, fields, more = {}) => ({
  id: defKey,
  defKey,
  defName: defKey,
  fields: fields.map(f => ({
    ...f,
    id: `${defKey}.${f.defKey}`,
  })),
  correlations: [],
  indexes: [],
  ...more,
});

export const link = (myField, refEntity, refField) => ({
  myField,
  refEntity,
  refField: `${refEntity}.${refField}`,
  myRows: 'n',
  refRows: '1',
});

export const project = (entities, testData = {}, more = {}) => ({
  entities,
  domains: [],
  dicts: [],
  dataTypeMapping: { mappings: [] },
  ...more,
  profile: {
    default: { db: DB },
    dataTypeSupports: [{
      id: DB,
      defKey: 'MYSQL',
    }],
    testData,
    ...(more.profile || {}),
  },
});

export const rule = (id, kind, params = {}, more = {}) => ({
  id,
  name: id,
  kind,
  params,
  ...more,
});

// runs a table and returns all of its rows
export const collect = async (generator, entityId, options = {}) => {
  const rows = [];
  const result = await generator.table(entityId, {
    ...options,
    onBatch: (batch, done, total) => {
      batch.forEach(r => rows.push(r));
      return options.onBatch ? options.onBatch(batch, done, total) : undefined;
    },
  });
  return {
    rows,
    result,
  };
};

export const columnAt = (plan, entityId, defKey) => plan.tables
  .find(t => t.entityId === entityId).columns.findIndex(c => c.defKey === defKey);
