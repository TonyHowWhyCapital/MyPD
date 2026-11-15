// Makes the rows of the planned tables, batch by batch. Nothing but the key columns that
// children point at is kept in memory.
import { createRandom } from './random';
import { makeValueGenerator } from './values';
import { getTestData, seedNow } from './model';
import { MAX_ROWS } from './plan';
import { columnRoles, columnOrder } from './plan_columns';
import { dialectOf } from './sql';
import { makeFit, makeKeyFit } from './fit';
import { setupUnique, driveRow, makeUnique } from './generate_strategy';
import {
  fail, listKeys, createSchedule, buildGroups, pickParent,
} from './generate_fk';

const pause = () => new Promise((resolve) => {
  if (typeof setImmediate === 'function') {
    setImmediate(resolve);
  } else {
    setTimeout(resolve, 0);
  }
});

const settingsOf = dataSource => (getTestData(dataSource) || {}).settings || {};

const seedOf = (dataSource, seed) => {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return seed;
  }
  const setting = settingsOf(dataSource).seed || {};
  if (setting.fixed === false) {
    return Date.now() % 2147483647;
  }
  const value = Number(setting.value);
  return Number.isFinite(value) ? value : 1;
};

// The numbers of an auto increment column: startAt, startAt + 1 ... They must all go into
// the column; a column that is too small stops the table before its first row.
const counterOf = (table, column, total) => {
  const fit = makeKeyFit(column);
  try {
    fit(table.startAt);
    fit(table.startAt + Math.max(0, total - 1));
  } catch (e) {
    throw fail('incrementOverflow',
      `${table.defKey}.${column.defKey}: ${table.startAt} + ${total} rows do not fit`, {
        entityId: table.entityId,
        fieldId: column.id,
        startAt: table.startAt,
        rows: total,
      });
  }
  if (column.kind === 'int' || column.kind === 'decimal') {
    return i => table.startAt + i;
  }
  const plain = makeFit(column);
  return i => plain(table.startAt + i);
};

// How each column of a row is filled: fill[position](rowIndex) -> value
const makeFillers = (state) => {
  const { table, roles, groups, env } = state;
  const rowRandom = env.stream(`${table.entityId}/#row`);
  return roles.map((r, position) => {
    if (r.role === 'increment') {
      return counterOf(table, r.column, state.fullTotal);
    }
    if (r.role === 'foreign') {
      const group = groups.find(g => g.positions.includes(position));
      const keys = group.keys[group.positions.indexOf(position)];
      const own = roles.findIndex(o => o.column.id === r.foreign.refFieldId);
      const fit = makeKeyFit(r.column);
      // a row of a table that points at itself may be its own parent
      return (i) => {
        if (group.current < 0) {
          return null;
        }
        return fit(group.self && group.current === i ? state.row[own] : keys.at(group.current));
      };
    }
    const label = `${table.entityId}/${r.column.id}`;
    let make;
    try {
      make = makeValueGenerator(r.rule, r.column, {
        random: env.stream(label),
        rowRandom,
        dataSource: env.dataSource,
        field: r.field,
        lists: env.lists,
        now: env.now,
      });
    } catch (e) {
      throw Object.assign(e, {
        entityId: table.entityId,
        fieldId: r.column.id,
      });
    }
    if (!(r.nullRate > 0)) {
      return i => make(i, state.named);
    }
    const nulls = env.stream(`${label}/null`);
    return i => (nulls.next() * 100 < r.nullRate ? null : make(i, state.named));
  });
};

const prepare = (env, table, limit) => {
  const entity = (env.dataSource.entities || []).find(e => e.id === table.entityId);
  const roles = columnRoles(env.dataSource, entity, table);
  const { order, deps, problems } = columnOrder(roles);
  const blocking = problems.find(p => p.code !== 'badRule');
  if (blocking) {
    throw fail(blocking.code, `${table.defKey}: ${blocking.code}`, {
      entityId: table.entityId,
      fieldId: blocking.fieldId,
      detail: blocking.detail,
    });
  }
  const position = id => roles.findIndex(r => r.column.id === id);
  // the columns children (or the table itself) point at
  const kept = {};
  const keep = [];
  const counter = { done: 0 };
  env.plan.tables.forEach(t => (t.foreignKeys || []).forEach((k) => {
    const at = position(k.refFieldId);
    if (k.source !== 'generated' || k.refEntityId !== table.entityId || at < 0
      || kept[k.refFieldId]) {
      return;
    }
    if (roles[at].role === 'increment') {
      kept[k.refFieldId] = {
        at: i => table.startAt + i,
        size: () => counter.done,
        distinct: true,
      };
    } else {
      const list = [];
      // a column that is unique on its own never gives two parents the same key
      kept[k.refFieldId] = listKeys(list, (table.uniques || [])
        .some(set => set.length === 1 && set[0] === k.refFieldId));
      keep.push([at, list]);
    }
  }));
  env.store.set(table.entityId, kept);
  const groups = buildGroups(table, roles, env);
  const leader = groups.find(g => g.perParent);
  let schedule = null;
  let total = table.rows || 0;
  if (leader) {
    schedule = createSchedule(leader.count(0), table.perParent.min, table.perParent.max,
      () => env.stream(`${table.entityId}/perParent`));
    ({ total } = schedule);
  }
  if (total > MAX_ROWS) {
    throw fail('tooManyRows', `${table.defKey}: ${total} rows, at most ${MAX_ROWS}`, {
      entityId: table.entityId,
      rows: total,
    });
  }
  const fullTotal = total;
  total = limit === undefined ? total : Math.min(total, limit);
  const state = {
    table,
    roles,
    groups,
    env,
    schedule,
    total,
    fullTotal,
    order,
    counter,
    row: null,
    named: {},
    cursor: -1,
  };
  state.fill = makeFillers(state);
  setupUnique(state, deps, fullTotal);
  state.keep = keep;
  return state;
};

// what went wrong, where: the table, the column being filled and the row (0-based)
const located = (e, state, i) => {
  const column = state.cursor >= 0 ? state.roles[state.cursor].column : null;
  return Object.assign(e, {
    entityId: e.entityId || state.table.entityId,
    ...(e.fieldId === undefined && column ? { fieldId: column.id } : {}),
    ...(e.row === undefined ? { row: i } : {}),
  });
};

const makeRow = (state, i) => {
  const s = state;
  const {
    table, groups, order, fill, roles, named, keep,
  } = s;
  const row = new Array(roles.length);
  s.row = row;
  s.cursor = -1;
  let at = -1; // the column being filled, for the error
  try {
    for (let g = 0; g < groups.length; g += 1) {
      pickParent(table, groups[g], i, s.schedule);
    }
    if (s.drivers.length > 0) {
      driveRow(s, i);
    }
    for (at = 0; at < order.length; at += 1) {
      const p = order[at];
      const value = fill[p](i);
      row[p] = value;
      named[roles[p].column.defKey] = value;
    }
    if (s.tracker) {
      makeUnique(s, i);
    }
  } catch (e) {
    if (at >= 0 && at < order.length) {
      s.cursor = order[at];
    }
    throw located(e, s, i);
  }
  for (let k = 0; k < keep.length; k += 1) {
    keep[k][1].push(row[keep[k][0]]);
  }
  s.counter.done = i + 1;
  return row;
};

const runTable = async (env, entityId, options) => {
  const {
    batchSize = 1000, onBatch, shouldStop, limit,
  } = options || {};
  const table = env.plan.tables.find(t => t.entityId === entityId);
  if (!table) {
    throw fail('tableNotPlanned', `Table ${entityId} is not part of the plan`, { entityId });
  }
  const state = prepare(env, table, limit);
  const size = Math.max(1, Math.floor(Number(batchSize)) || 1000);
  const { total } = state;
  let done = 0;
  while (done < total) {
    if (shouldStop && shouldStop()) {
      return {
        rows: done,
        stopped: true,
      };
    }
    const end = Math.min(total, done + size);
    const batch = new Array(end - done);
    try {
      for (let i = done; i < end; i += 1) {
        batch[i - done] = makeRow(state, i);
      }
    } catch (e) {
      throw e.entityId ? e : Object.assign(e, { entityId });
    }
    done = end;
    if (onBatch) {
      // a writer may answer with a promise that settles once it has taken the rows
      // eslint-disable-next-line no-await-in-loop
      await onBatch(batch, done, total);
    }
    // eslint-disable-next-line no-await-in-loop
    await pause();
  }
  return {
    rows: done,
    stopped: false,
  };
};

export const createGenerator = (dataSource, plan, options = {}) => {
  const seed = seedOf(dataSource, options.seed);
  const env = {
    dataSource,
    plan,
    seed,
    lists: {
      file: {},
      query: {},
      ...(options.lists || {}),
    },
    parentKeys: options.parentKeys || {},
    // a fixed seed fixes the clock too, see seedNow in model.js
    now: options.now instanceof Date ? options.now
      : seedNow(settingsOf(dataSource), new Date()),
    dialect: dialectOf(dataSource),
    lenient: !!options.lenient,
    store: new Map(),
    // every stream starts from the seed and its own label, so a table gives the same rows
    // whatever else is generated
    stream: label => createRandom(seed).fork(label),
  };
  return {
    seed,
    now: env.now,
    table: (entityId, opts) => runTable(env, entityId, opts),
  };
};

// The first n rows of a table. Its parents are generated first, cut down to a few rows
// (opts.parentRows, 100 by default), so foreign key values look right but are not the ones
// of a full run. Parent keys that were not loaded from the database show as NULL.
export const previewTable = async (dataSource, plan, entityId, n, opts = {}) => {
  const table = plan.tables.find(t => t.entityId === entityId);
  if (!table) {
    throw fail('tableNotPlanned', `Table ${entityId} is not part of the plan`, { entityId });
  }
  const generator = createGenerator(dataSource, plan, {
    ...opts,
    lenient: true,
  });
  const wanted = [];
  const visit = (t) => {
    (t.foreignKeys || []).filter(k => k.source === 'generated' && !k.self && !k.deferred)
      .forEach((k) => {
        const parent = plan.tables.find(p => p.entityId === k.refEntityId);
        if (parent && !wanted.includes(parent.entityId)) {
          wanted.push(parent.entityId);
          visit(parent);
        }
      });
  };
  visit(table);
  const parents = plan.tables.filter(t => wanted.includes(t.entityId) && t !== table);
  for (let i = 0; i < parents.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await generator.table(parents[i].entityId, { limit: opts.parentRows || 100 });
  }
  const rows = [];
  await generator.table(entityId, {
    limit: n,
    onBatch: batch => batch.forEach(r => rows.push(r)),
  });
  return {
    columns: table.columns,
    rows,
  };
};
