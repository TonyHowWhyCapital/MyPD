// Sample values of a rule, made by the real generator with a fixed seed so that the
// same rule shows the same values every time it is looked at.
import { makeValueGenerator, exprColumns } from '../../../../../lib/testdata/values';
import { createRandom } from '../../../../../lib/testdata/random';
import { fieldColumn, resolveRule } from '../../../../../lib/testdata/columns';
import { numberOf } from '../../../../../lib/testdata/model';
import { checkExpr } from '../../../../../lib/testdata/expr';

export const SAMPLE_COUNT = 10;
export const SAMPLE_SEED = 20240101;

// columns to try a rule on when no real column is at hand
export const GENERIC_COLUMNS = {
  string: { kind: 'string', type: 'VARCHAR', len: 255 },
  int: { kind: 'int', type: 'INT', len: null },
  decimal: { kind: 'decimal', type: 'DECIMAL', len: 14, scale: 2 },
  date: { kind: 'date', type: 'DATE', len: null },
  datetime: { kind: 'datetime', type: 'DATETIME', len: null },
  bool: { kind: 'bool', type: 'BOOLEAN', len: null },
};

export const genericColumn = kind => ({
  id: `generic.${kind}`,
  defKey: '',
  defName: '',
  scale: null,
  notNull: false,
  primaryKey: false,
  autoIncrement: false,
  ...(GENERIC_COLUMNS[kind] || GENERIC_COLUMNS.string),
});

// the generic column a rule is best looked at with
export const defaultGenericKind = (rule) => {
  const p = (rule && rule.params) || {};
  if (rule && rule.kind === 'number') {
    return numberOf(p.decimals) > 0 ? 'decimal' : 'int';
  }
  if (rule && rule.kind === 'date') {
    return /\d{1,2}:\d{2}/.test(`${p.from || ''}${p.to || ''}`) ? 'datetime' : 'date';
  }
  if (rule && rule.kind === 'builtin' && p.name === 'boolean') {
    return 'bool';
  }
  return 'string';
};

const sampleError = (code, detail) => ({ code, detail });

// where a formula goes wrong, when the failure itself does not say
const exprPos = (rule, code) => {
  const problem = rule && rule.kind === 'expr' ? checkExpr((rule.params || {}).expr) : null;
  return problem && problem.code === code ? problem.pos : undefined;
};

// the other columns a formula reads get values from their own rules
const rowMakers = (rule, entity, field, dataSource, random, now) => {
  const keys = exprColumns((rule.params || {}).expr);
  if (keys.length === 0) {
    return { makers: [] };
  }
  if (!entity) {
    return { error: sampleError('sample.expr.needTable', keys.join(', ')) };
  }
  const makers = [];
  for (let i = 0; i < keys.length; i += 1) {
    const other = (entity.fields || []).find(f => f.defKey === keys[i]);
    if (!other) {
      return { error: sampleError('expr.column.unknown', keys[i]) };
    }
    let make = () => null;
    if (!field || other.id !== field.id) {
      const resolved = resolveRule(dataSource, entity, other).rule;
      // a formula reading another formula is shown with plain values for that one
      const usable = resolved.kind === 'expr' || resolved.kind === 'foreign'
        ? { kind: 'auto', params: {} } : resolved;
      try {
        make = makeValueGenerator(usable, fieldColumn(dataSource, other), {
          random: random.fork(`row:${keys[i]}`),
          dataSource,
          field: other,
          now,
        });
      } catch (e) {
        make = makeValueGenerator({ kind: 'auto', params: {} }, fieldColumn(dataSource, other), {
          random: random.fork(`row:${keys[i]}`),
          now,
        });
      }
    }
    makers.push({ key: keys[i], make });
  }
  return { makers };
};

// options: {rule, column, field?, entity?, dataSource?, lists?, count?, seed?, nullRate?, now?}
// -> {values: [value|null], error: null | {code, detail?, pos?}}
export const sampleValues = (options) => {
  const {
    rule, column, field, entity, dataSource, lists, count = SAMPLE_COUNT, seed = SAMPLE_SEED,
  } = options;
  const now = options.now instanceof Date ? options.now : new Date();
  const random = createRandom(seed);
  const col = column || genericColumn('string');
  try {
    const row = rule.kind === 'expr'
      ? rowMakers(rule, entity, field, dataSource, random, now) : { makers: [] };
    if (row.error) {
      return { values: [], error: row.error };
    }
    const generate = makeValueGenerator(rule, col, {
      random: random.fork('value'),
      dataSource,
      field,
      lists: lists || {},
      now,
    });
    const rate = numberOf(options.nullRate);
    const nullable = !col.notNull && !col.primaryKey && !col.autoIncrement;
    const nulls = random.fork('null');
    const values = [];
    for (let i = 0; i < count; i += 1) {
      const rowValues = {};
      row.makers.forEach(({ key, make }) => {
        rowValues[key] = make(i, {});
      });
      const value = generate(i, rowValues);
      values.push(nullable && rate > 0 && nulls.next() * 100 < rate ? null : value);
    }
    return { values, error: null };
  } catch (e) {
    return {
      values: [],
      error: {
        code: e.code || 'sample.failed',
        // a validation failure repeats its codes as the detail
        detail: e.code && `${e.detail || ''}`.split(',')[0] === e.code ? undefined
          : (e.detail || (e.code ? undefined : e.message)),
        pos: e.pos === undefined ? exprPos(rule, e.code) : e.pos,
      },
    };
  }
};

// a value as text for the list of samples
export const valueText = (value) => {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return `${value}`;
};
