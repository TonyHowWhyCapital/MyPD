// Makes the rows of the planned tables, batch by batch. Nothing but the key columns that
// children point at is kept in memory.
import { createRandom } from './random';
import { makeValueGenerator } from './values';
import { getTestData } from './model';
import { MAX_ROWS } from './plan';
import { neverRepeats } from './plan_keys';
import { columnRoles, columnOrder } from './plan_columns';
import { createUniqueTracker } from './generate_unique';
import {
  fail, listKeys, createSchedule, buildGroups, pickParent,
} from './generate_fk';

// new random values are tried this often for a row that repeats a unique value, then the
// value is changed step by step this often before the run gives up
const RETRIES = 30;
const PROBES = 2000;

const pause = () => new Promise((resolve) => {
  if (typeof setImmediate === 'function') {
    setImmediate(resolve);
  } else {
    setTimeout(resolve, 0);
  }
});

const seedOf = (dataSource, seed) => {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return seed;
  }
  const setting = ((getTestData(dataSource) || {}).settings || {}).seed || {};
  if (setting.fixed === false) {
    return Date.now() % 2147483647;
  }
  const value = Number(setting.value);
  return Number.isFinite(value) ? value : 1;
};

// How each column of a row is filled: fill[position](rowIndex) -> value
const makeFillers = (state) => {
  const { table, roles, groups, env } = state;
  return roles.map((r, position) => {
    if (r.role === 'increment') {
      return i => table.startAt + i;
    }
    if (r.role === 'foreign') {
      const group = groups.find(g => g.positions.includes(position));
      const keys = group.keys[group.positions.indexOf(position)];
      const own = roles.findIndex(o => o.column.id === r.foreign.refFieldId);
      // a row of a table that points at itself may be its own parent
      return (i) => {
        if (group.current < 0) {
          return null;
        }
        return group.self && group.current === i ? state.row[own] : keys.at(group.current);
      };
    }
    const label = `${table.entityId}/${r.column.id}`;
    let make;
    try {
      make = makeValueGenerator(r.rule, r.column, {
        random: env.stream(label),
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

// For every unique group: the columns to make again when a row repeats one of its values
// (its own columns, the whole foreign key they belong to, and every formula reading them).
const makeRepairs = (state, sets, deps, order) => sets.map((set) => {
  const { roles, groups } = state;
  const picks = groups.filter(g => !g.perParent && !g.deferred
    && g.positions.some(p => set.includes(p)));
  const seeds = set.concat(...picks.map(g => g.positions))
    .filter(p => !groups.some(g => g.perParent && g.positions.includes(p)));
  const again = seeds.slice();
  let grown = true;
  while (grown) {
    grown = false;
    for (let i = 0; i < deps.length; i += 1) {
      if (!again.includes(i) && deps[i].some(d => again.includes(d))) {
        again.push(i);
        grown = true;
      }
    }
  }
  const free = set.find(p => roles[p].role === 'rule'
    && (roles[p].column.kind === 'string' || roles[p].column.kind === 'int'));
  return {
    set,
    picks,
    again: order.filter(p => again.includes(p)),
    after: order.filter(p => again.includes(p) && !seeds.includes(p)),
    free: free === undefined ? -1 : free,
  };
});

// Step by step change of a row that still repeats after all random tries: the next parent
// row for a foreign key, else a counter worked into a text or whole number column.
const probe = (state, repair, i, step) => {
  const { roles, row, named, fill } = state;
  const refill = positions => positions.forEach((p) => {
    row[p] = fill[p](i);
    named[roles[p].column.defKey] = row[p];
  });
  const group = repair.picks.filter(g => g.current >= 0 && g.count(i) > 1).pop();
  if (group) {
    group.current = (group.current + 1) % group.count(i);
    refill(repair.again);
    return true;
  }
  if (repair.free < 0) {
    return false;
  }
  const { column } = roles[repair.free];
  if (step === 1) {
    state.base = row[repair.free];
  }
  let value;
  if (column.kind === 'int') {
    value = (Number(state.base) || 0) + step;
    value = column.len !== null && `${value}`.length > column.len ? step : value;
  } else {
    const tail = `~${i.toString(36)}${step > 1 ? `.${step.toString(36)}` : ''}`;
    const text = `${state.base === null ? '' : state.base}`;
    value = column.len === null ? text + tail
      : (text.slice(0, Math.max(0, column.len - tail.length)) + tail).slice(-column.len);
  }
  row[repair.free] = value;
  named[column.defKey] = value;
  refill(repair.after);
  return true;
};

const makeUnique = (state, i) => {
  const { tracker, repairs, table, roles, groups } = state;
  let bad = tracker.violated(state.row);
  let tries = 0;
  while (bad) {
    tries += 1;
    const repair = repairs[bad[0]];
    let changed = tries <= RETRIES + PROBES;
    if (changed && tries <= RETRIES) {
      repair.picks.forEach(g => pickParent(table, g, i, null));
      repair.again.forEach((p) => {
        state.row[p] = state.fill[p](i);
        state.named[roles[p].column.defKey] = state.row[p];
      });
    } else if (changed) {
      changed = probe(state, repair, i, tries - RETRIES);
    }
    if (!changed) {
      const columns = repair.set.map(p => roles[p].column.defKey);
      throw fail('uniqueExhausted',
        `No more unique values for ${table.defKey} (${columns.join(', ')}) at row ${i + 1}`, {
          entityId: table.entityId,
          fieldId: roles[repair.set[0]].column.id,
          row: i,
        });
    }
    bad = tracker.violated(state.row);
  }
  tracker.accept();
  return groups;
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
      };
    } else {
      const list = [];
      kept[k.refFieldId] = listKeys(list);
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
  total = limit === undefined ? total : Math.min(total, limit);
  const state = {
    table, roles, groups, env, schedule, total, order, counter, row: null, named: {}, base: null,
  };
  state.fill = makeFillers(state);
  const sets = (table.uniques || []).map(set => set.map(position))
    .filter(set => !set.includes(-1) && !set.some(p => roles[p].role === 'rule'
      && !(roles[p].nullRate > 0) && neverRepeats(roles[p].rule, roles[p].column, total)));
  state.tracker = sets.length > 0 ? createUniqueTracker(sets, total) : null;
  state.repairs = makeRepairs(state, sets, deps, order);
  state.keep = keep;
  return state;
};

const makeRow = (state, i) => {
  const s = state;
  const {
    table, groups, order, fill, roles, named, keep,
  } = s;
  const row = new Array(roles.length);
  s.row = row;
  for (let g = 0; g < groups.length; g += 1) {
    pickParent(table, groups[g], i, s.schedule);
  }
  for (let k = 0; k < order.length; k += 1) {
    const p = order[k];
    const value = fill[p](i);
    row[p] = value;
    named[roles[p].column.defKey] = value;
  }
  if (s.tracker) {
    makeUnique(s, i);
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
    now: options.now || new Date(),
    lenient: !!options.lenient,
    store: new Map(),
    // every stream starts from the seed and its own label, so a table gives the same rows
    // whatever else is generated
    stream: label => createRandom(seed).fork(label),
  };
  return {
    seed,
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
