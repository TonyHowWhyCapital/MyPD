// Turns a rule into a value generator for one column. Everything expensive
// (parsing, list preparation, range checks) happens once in the factory; the
// returned closure is cheap enough to be called a million times.
// Null rate and uniqueness are applied by the caller (generate.js), not here.
import { validateRule } from './model';
import { builtinGenerator, PLACE_BUILTINS } from './builtin';
import { compileExpr, exprColumns as readExprColumns } from './expr';
import { randomText, compileMask, naiveNow } from './pattern';
import { createRandom } from './random';
import { makeFit, fail, allowsNull } from './fit';
import { AUTO, dateBetween } from './values_auto';
import {
  numberSteps, dateSteps, textShape, listItems, dictValues, loadedValues,
  maskSlots, sequenceValues,
} from './value_space';

// ---- helpers for the kinds ------------------------------------------------
// a list value for a column that cannot hold NULL
const required = (values, column) => {
  if (!allowsNull(column) && values.some(v => v === null)) throw fail('value.null');
  return values;
};

// a prepared list: random or cycling, values already fitted
const listPicker = (values, order, random) => {
  const count = values.length;
  if (order === 'cycle') {
    return rowIndex => values[rowIndex % count];
  }
  return () => values[Math.floor(random.next() * count)];
};

const loadedList = (kind, key, params, column, ctx, fit) => listPicker(
  required(loadedValues(kind, key, ctx, column).map(fit), column), params.order, ctx.random);

// ---- one builder per rule kind: (params, column, ctx, fit, now) -> raw generator
// `prefit` kinds return fitted values themselves, the others go through `fit`
const KINDS = {
  auto: (p, column, ctx, fit, now) => (AUTO[column.kind] || AUTO.string)(column, ctx, now),
  sequence: (p, column) => sequenceValues(p, column),
  number: (p, column, ctx) => {
    const { lo, hi, value } = numberSteps(p, column);
    return () => value(ctx.random.int(lo, hi));
  },
  date: (p, column, ctx, fit, now) => {
    const { lo, hi, value } = dateSteps(p, column, now);
    return dateBetween(lo, hi, 1, value, ctx.random);
  },
  text: (p, column, ctx) => {
    const { chars, min, max } = textShape(p, column);
    return () => randomText(ctx.random, chars, ctx.random.int(min, max));
  },
  list: (p, column, ctx, fit) => {
    const items = listItems(p);
    const values = required(items.map(item => fit(item.value)), column);
    const even = items.every(item => item.weight === items[0].weight);
    if (p.order === 'cycle' || even) return listPicker(values, p.order, ctx.random);
    // cumulative weights + binary search
    const sums = [];
    let total = 0;
    items.forEach((item) => {
      total += item.weight;
      sums.push(total);
    });
    return () => {
      const r = ctx.random.next() * total;
      let lo = 0;
      let hi = sums.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (r < sums[mid]) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      return values[lo];
    };
  },
  pattern: (p, column, ctx) => {
    maskSlots(p.mask, column); // the whole mask must go into the column
    const mask = compileMask(p.mask);
    return () => mask(ctx.random);
  },
  dict: (p, column, ctx, fit) => listPicker(dictValues(p, ctx).map(fit), 'random',
    ctx.random),
  builtin: (p, column, ctx) => {
    const generate = builtinGenerator(p.name);
    if (!generate) throw fail('builtin.name.unknown', p.name);
    if (!PLACE_BUILTINS.includes(p.name)) return () => generate(ctx.random);
    // city, district, postal code and address of one row are the same place
    const places = ctx.rowRandom || ctx.random.fork('#row');
    return rowIndex => generate(ctx.random, places.at(rowIndex));
  },
  file: (p, column, ctx, fit) => loadedList('file', p.path, p, column, ctx, fit),
  query: (p, column, ctx, fit) => loadedList('query', p.sql, p, column, ctx, fit),
  expr: (p, column, ctx) => {
    const entity = ctx.field && ((ctx.dataSource && ctx.dataSource.entities) || [])
      .find(e => (e.fields || []).some(f => f === ctx.field
        || (ctx.field.id !== undefined && f.id === ctx.field.id)));
    // [name] finds the column whatever the case, the way the planner orders the columns
    const keys = entity ? (entity.fields || []).map(f => f.defKey) : null;
    const compiled = compileExpr(p.expr, keys ? (key) => {
      const found = keys.includes(key) ? key
        : keys.find(k => `${k}`.toLowerCase() === key.toLowerCase());
      if (found === undefined) throw fail('expr.column.unknown', key);
      return found;
    } : undefined);
    const env = {
      random: ctx.random,
      now: ctx.now,
    };
    const { run } = compiled;
    return (rowIndex, row) => run(row || {}, rowIndex, env);
  },
  constant: (p, column, ctx, fit) => {
    if (p.value === undefined || p.value === null) throw fail('constant.value.missing');
    const value = fit(p.value);
    return () => value;
  },
};

const PREFIT = ['list', 'dict', 'file', 'query', 'constant'];
// kinds whose first value is tried in the factory, so that a rule that can
// never fit the column (a name in a number column) fails before generation.
// Formulas are tried by the planner, which has the other columns of the row.
const PROBED = ['sequence', 'number', 'date', 'text', 'pattern', 'builtin'];

// Every code a value generator can throw besides the codes of validateRule (model.js) and
// of formulas (expr.js), for the windows that put them into words. `value.*` codes come up
// while rows are made, with the table, column and row on the error.
export const VALUE_ERROR_CODES = [
  'value.type', 'value.range', 'value.length', 'value.null', 'sequence.fraction',
  'sequence.affix.type', 'number.range', 'number.range.column', 'date.from.invalid',
  'date.to.invalid', 'date.range', 'text.charset.unknown', 'text.range', 'list.items.empty',
  'dict.missing', 'dict.empty', 'builtin.name.unknown', 'constant.value.missing',
  'file.missing', 'file.empty', 'query.missing', 'query.empty', 'expr.column.unknown',
  'rule.kind.foreign', 'rule.kind.unknown',
];

// (rule, column, ctx) -> (rowIndex, row) => value fitting the column.
// Throws an Error with a stable `code` when the rule cannot work for the column.
export const makeValueGenerator = (rule, column, ctx) => {
  const col = column || { kind: 'string' };
  const context = { ...(ctx || {}) };
  if (!context.random) context.random = createRandom(1);
  if (!(context.now instanceof Date)) context.now = new Date();
  const kind = rule && rule.kind ? rule.kind : 'auto';
  if (kind === 'foreign') throw fail('rule.kind.foreign');
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw fail('rule.kind.unknown', kind);
  const params = (rule && rule.params) || {};
  const problems = validateRule({ kind, params }, { now: context.now });
  if (problems.length > 0) throw fail(problems[0], problems.join(','));
  const now = naiveNow(context.now);
  const fit = makeFit(col);
  if (PROBED.includes(kind)) {
    // on a separate stream: the real one must not be consumed by the trial
    const trial = { ...context, random: context.random.fork('#probe') };
    fit(KINDS[kind](params, col, trial, fit, now)(0, {}));
  }
  const generate = KINDS[kind](params, col, context, fit, now);
  if (PREFIT.includes(kind)) return generate;
  if (kind === 'auto' && col.kind !== 'string') {
    return generate; // already of the column kind and inside its limits
  }
  if (kind === 'expr' && !allowsNull(col)) {
    // a formula may work out to NULL (division by zero, a NULL column): not for this column
    return (rowIndex, row) => {
      const value = fit(generate(rowIndex, row));
      if (value === null) throw fail('value.null');
      return value;
    };
  }
  return (rowIndex, row) => fit(generate(rowIndex, row));
};

export const exprColumns = readExprColumns;
