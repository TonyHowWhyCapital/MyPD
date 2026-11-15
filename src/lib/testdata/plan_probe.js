// Tries the rules of a planned table before anything is written: the value generators
// are built the way the run builds them and a sample of rows is made (the first rows, the
// last one and rows spread in between), so a rule that does not suit its column, a formula
// that fails for some rows, a counter that outgrows its column or a parent key that does
// not go into the child column shows as a problem of the plan. It is a sample: a formula
// can still fail on a row that was not tried, and then stops the run with the table,
// column and row.
import { createRandom } from './random';
import { makeValueGenerator } from './values';
import { makeKeyFit } from './fit';
import { fileListKey } from './file_list';

const FIRST = 16;
const SPREAD = 47;

// row numbers (0-based) that are tried
export const sampleRows = (rows) => {
  const picked = [];
  const add = i => (i >= 0 && i < rows && !picked.includes(i) ? picked.push(i) : 0);
  for (let i = 0; i < FIRST; i += 1) {
    add(i);
  }
  for (let k = 1; k <= SPREAD; k += 1) {
    add(Math.floor((rows * k) / (SPREAD + 1)));
  }
  add(rows - 1);
  return picked.sort((a, b) => a - b);
};

const loaded = (rule, lists) => {
  const params = rule.params || {};
  const key = rule.kind === 'file' ? fileListKey(params) : params.sql;
  const list = (lists && lists[rule.kind]) || {};
  return Object.prototype.hasOwnProperty.call(list, key);
};

// What fills position p of a sample row, or null when it cannot be known now.
const makerOf = (table, r, p, ctx, report) => {
  if (r.role === 'increment') {
    return i => table.startAt + i;
  }
  if (r.role === 'foreign') {
    const k = r.foreign;
    const fit = makeKeyFit(r.column);
    const own = k.self ? ctx.positionOf(k.refFieldId) : -1;
    const parent = k.source === 'generated' && !k.self && !k.deferred
      ? (ctx.samples.get(k.refEntityId) || {})[k.refFieldId] : undefined;
    if (own < 0 && !(parent && parent.length > 0)) {
      return null;
    }
    return (i, named, row) => fit(own >= 0 ? row[own] : parent[i % parent.length]);
  }
  if (ctx.invalid.includes(r.rule)
    || ((r.rule.kind === 'file' || r.rule.kind === 'query') && !loaded(r.rule, ctx.lists))) {
    return null;
  }
  try {
    const make = makeValueGenerator(r.rule, r.column, {
      random: createRandom(ctx.seed).fork(`${table.entityId}/${r.column.id}`),
      rowRandom: createRandom(ctx.seed).fork(`${table.entityId}/#row`),
      dataSource: ctx.dataSource,
      field: r.field,
      lists: ctx.lists || {},
      now: ctx.now,
    });
    if (!(r.nullRate > 0)) {
      return (i, named) => make(i, named);
    }
    // NULLs at the rate of the column, so a formula reading it is tried with them
    const nulls = createRandom(ctx.seed).fork(`${table.entityId}/${r.column.id}/null`);
    return (i, named) => (nulls.next() * 100 < r.nullRate ? null : make(i, named));
  } catch (e) {
    report(p, e);
    return null;
  }
};

// table, roles, order, deps: as the generator sees them; rows: the most rows the table
// gets. ctx = { dataSource, seed, lists, now, invalid: [rule], samples: Map(entityId ->
// {fieldId: values}) }. Returns { problems, samples: {fieldId: values} }.
export const probeTable = (table, roles, order, deps, rows, ctx) => {
  const problems = [];
  const failed = [];
  const report = (p, e, row) => {
    if (failed.includes(p)) {
      return;
    }
    failed.push(p);
    const r = roles[p];
    const code = e.code || 'error';
    problems.push(r.role === 'foreign' ? {
      code: 'foreignKeyFit',
      fieldId: r.column.id,
      detail: {
        refEntityId: r.foreign.refEntityId,
        refFieldId: r.foreign.refFieldId,
        reason: e.message,
      },
    } : {
      code: 'badRule',
      fieldId: r.column.id,
      detail: [code],
      ...(row === undefined ? {} : { row }),
      message: e.message,
    });
  };
  const context = {
    ...ctx,
    positionOf: id => roles.findIndex(r => r.column.id === id),
  };
  const makers = roles.map((r, p) => makerOf(table, r, p, context, report));
  // a column is only tried when everything it reads was made
  const known = p => makers[p] !== null && !failed.includes(p);
  const samples = {};
  const named = {};
  sampleRows(rows).forEach((i) => {
    const row = new Array(roles.length).fill(null);
    const made = new Array(roles.length).fill(false);
    order.forEach((p) => {
      let value = null;
      if (known(p) && deps[p].every(d => d !== p && made[d])) {
        try {
          value = makers[p](i, named, row);
          made[p] = true;
        } catch (e) {
          report(p, e, i);
        }
      }
      row[p] = value;
      named[roles[p].column.defKey] = value;
    });
    roles.forEach((r, p) => {
      if (made[p]) {
        samples[r.column.id] = (samples[r.column.id] || []).concat([row[p]]);
      }
    });
  });
  return {
    problems,
    samples,
  };
};
