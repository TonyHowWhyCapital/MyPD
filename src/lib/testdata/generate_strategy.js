// How the unique groups of a table (keys, unique indexes, rules marked unique) are kept
// unique while its rows are made.
//
// EXACT: where the values a group can take are known and numbered (a column with a value
// space, the rows of a parent table), row i takes combination number permute(i): no value
// comes twice, nothing is remembered, and a table with exactly as many rows as there are
// combinations gets every one of them. One column (or a few) with enough values carries
// the whole group; the other columns of the group stay random. For a table that gets its
// rows per parent row, the children of one parent follow each other, so the group is
// unique when the values of consecutive rows differ.
//
// TRACKED: groups with a column whose values cannot be numbered (formulas, builtins such
// as e-mail addresses, lists not loaded when the plan was made, references to the table
// itself, columns another group already draws without repeating) are checked against the
// rows made so far: new random values are tried, then every combination of the columns
// that have few values. Values are never changed into something the rule does not give:
// when nothing is left the run stops with `uniqueExhausted`.
import { createPermutation } from './permute';
import { createUniqueTracker, createHashSet, uniqueKey } from './generate_unique';
import { ruleSpace } from './value_space';
import { neverRepeats } from './plan_keys';
import { fail, pickParent } from './generate_fk';

// new random values are tried this often for a row that repeats a unique value, then at
// most this many combinations of the listed values are walked through
const RETRIES = 30;
const PROBES = 4096;

const exhausted = (state, set, i) => {
  const { table, roles } = state;
  const columns = set.map(p => roles[p].column.defKey);
  return fail('uniqueExhausted',
    `No more unique values for ${table.defKey} (${columns.join(', ')}) at row ${i + 1}`, {
      entityId: table.entityId,
      fieldId: roles[set[0]].column.id,
      row: i,
    });
};

// true when no two parent rows have the same values in the key columns `at`
const distinctKeys = (group, at) => {
  const lists = at.map(k => group.keys[k]);
  if (lists.some(l => l.distinct)) {
    return true;
  }
  const count = group.count(0);
  const seen = createHashSet(count);
  for (let j = 0; j < count; j += 1) {
    const text = lists.map(l => uniqueKey(l.at(j))).join('\u0001');
    if (seen.has(text)) {
      return false;
    }
    seen.add(text);
  }
  return true;
};

// The members of a unique group: columns and foreign keys that can be numbered (`digits`),
// the key the rows are counted per (`window`), and whether anything else is in it.
const membersOf = (state, set, spaceAt, owned) => {
  const { roles, groups } = state;
  const found = {
    digits: [],
    window: null,
    opaque: false,
  };
  set.filter(p => roles[p].role === 'rule').forEach((p) => {
    const space = owned.includes(p) ? null : spaceAt(p);
    if (space) {
      found.digits.push({
        position: p,
        space,
        size: space.size,
      });
    } else {
      found.opaque = true;
    }
  });
  groups.filter(g => g.positions.some(p => set.includes(p))).forEach((g) => {
    const at = g.positions.map((p, k) => (set.includes(p) ? k : -1)).filter(k => k >= 0);
    const usable = !g.self && !g.deferred && !owned.includes(g) && g.count(0) >= 1
      && distinctKeys(g, at);
    if (!usable) {
      found.opaque = true;
    } else if (g.perParent) {
      found.window = g;
    } else {
      found.digits.push({
        group: g,
        size: g.count(0),
      });
    }
  });
  // columns first, the ones with most values first: a foreign key stays random when the
  // columns can carry the group
  found.digits.sort((a, b) => (!!a.group - !!b.group) || (b.size - a.size));
  return found;
};

const driverOf = (state, set, members, need) => {
  const chosen = [];
  let size = 1;
  members.digits.some((d) => {
    chosen.push(d);
    size *= d.size;
    return size >= need;
  });
  const { table, roles, env } = state;
  // per parent row only its own children have to differ
  const must = members.window && table.perParent ? Math.min(need, table.perParent.max) : need;
  if (size < must && members.opaque) {
    return null; // the rest of the group has to make up for it: tracked
  }
  const label = `${table.entityId}/${set.map(p => roles[p].column.id).join('+')}/unique`;
  const single = chosen.length === 1 && !chosen[0].group ? chosen[0] : null;
  return {
    set,
    size,
    window: !!members.window,
    digits: chosen.map(d => (d.group ? d : {
      ...d,
      random: env.stream(`${table.entityId}/${roles[d.position].column.id}/case`),
    })),
    permute: single && single.space.ordered ? index => index
      : createPermutation(size, env.stream(label)),
  };
};

// For every tracked group: the columns to make again when a row repeats one of its values
// (its own columns, the whole foreign key they belong to, and every formula reading them),
// and the columns with few values whose combinations are walked through.
const repairOf = (state, set, deps, spaceAt, owned) => {
  const { roles, groups, order } = state;
  const picks = groups.filter(g => !g.perParent && !g.deferred && !owned.includes(g)
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
  const listed = set.filter(p => roles[p].role === 'rule' && !owned.includes(p) && spaceAt(p))
    .map(p => ({
      position: p,
      space: spaceAt(p),
      size: spaceAt(p).size,
      random: state.env.stream(`${state.table.entityId}/${roles[p].column.id}/case`),
    }));
  return {
    set,
    picks,
    listed,
    again: order.filter(p => again.includes(p)),
  };
};

// Decides for every unique group of the table how it is kept unique.
// fullTotal: the rows of the whole table (a preview makes fewer but must show the same).
export const setupUnique = (state, deps, fullTotal) => {
  const s = state;
  const { table, roles, env } = s;
  const position = id => roles.findIndex(r => r.column.id === id);
  const sets = (table.uniques || []).map(set => set.map(position))
    .filter(set => !set.includes(-1) && !set.some(p => roles[p].role === 'increment'
      || (roles[p].role === 'rule' && neverRepeats(roles[p].rule, roles[p].column, fullTotal))));
  const spaces = {};
  const spaceAt = (p) => {
    if (!Object.prototype.hasOwnProperty.call(spaces, p)) {
      const r = roles[p];
      spaces[p] = r.role === 'rule' ? ruleSpace(r.rule, r.column, {
        dataSource: env.dataSource,
        field: r.field,
        lists: env.lists,
        now: env.now,
      }) : null;
    }
    return spaces[p];
  };
  const owned = [];
  const tracked = [];
  s.drivers = [];
  s.forced = new Array(roles.length);
  sets.forEach((set) => {
    const members = membersOf(s, set, spaceAt, owned);
    const driver = members.digits.length > 0 || (members.window && !members.opaque)
      ? driverOf(s, set, members, fullTotal) : null;
    if (!driver) {
      tracked.push(set);
      return;
    }
    s.drivers.push(driver);
    driver.digits.forEach((d) => {
      owned.push(d.group || d.position);
      if (d.group) {
        d.group.driven = true;
      } else {
        s.fill[d.position] = () => s.forced[d.position];
      }
    });
  });
  s.tracker = tracked.length > 0 ? createUniqueTracker(tracked, s.total, {
    nullsDiffer: env.dialect !== 'mssql',
  }) : null;
  s.repairs = tracked.map(set => repairOf(s, set, deps, spaceAt, owned));
};

// The values of row i for the groups that are drawn without repeating. Call after the
// parents of the row were picked and before its columns are filled.
export const driveRow = (state, i) => {
  const { drivers, forced, schedule } = state;
  for (let k = 0; k < drivers.length; k += 1) {
    const driver = drivers[k];
    const { digits, size } = driver;
    if ((driver.window ? schedule.ordinal() : i) >= size) {
      throw exhausted(state, driver.set, i);
    }
    let index = driver.permute(driver.window ? i % size : i);
    for (let d = 0; d < digits.length; d += 1) {
      const digit = digits[d];
      const n = digits.length === 1 ? index : index % digit.size;
      index = Math.floor(index / digit.size);
      if (digit.group) {
        digit.group.current = n;
      } else {
        forced[digit.position] = digit.space.at(n, digit.random);
      }
    }
  }
};

const refill = (state, positions, i, given) => {
  const s = state;
  const { roles, row, named, fill } = s;
  for (let k = 0; k < positions.length; k += 1) {
    const p = positions[k];
    s.cursor = p;
    row[p] = given && given[p] !== undefined ? given[p] : fill[p](i);
    named[roles[p].column.defKey] = row[p];
  }
};

// Step `step` (1, 2 ...) through the combinations of the listed values and the parent rows
// of a group that still repeats; false when all of them were tried.
const probe = (state, repair, i, step) => {
  const groups = repair.picks.filter(g => g.current >= 0 && g.count(i) > 1);
  const digits = repair.listed.concat(groups.map(g => ({
    group: g,
    size: g.count(i),
  })));
  const total = digits.reduce((n, d) => Math.min(n * d.size, PROBES + 1), 1);
  if (digits.length === 0 || step > Math.min(total, PROBES)) {
    return false;
  }
  if (step === 1) {
    repair.offset = digits.map(d => (d.group ? d.group.current : 0));
  }
  let index = step;
  const given = [];
  digits.forEach((d, k) => {
    const n = ((index % d.size) + repair.offset[k]) % d.size;
    index = Math.floor(index / d.size);
    if (d.group) {
      d.group.current = n;
    } else {
      given[d.position] = d.space.at(n, d.random);
    }
  });
  refill(state, repair.again, i, given);
  return true;
};

// Makes the row differ from every earlier row in the tracked groups.
export const makeUnique = (state, i) => {
  const { tracker, repairs, table } = state;
  let bad = tracker.violated(state.row);
  let tries = 0;
  while (bad) {
    tries += 1;
    const repair = repairs[bad[0]];
    let changed = true;
    if (tries <= RETRIES) {
      repair.picks.forEach(g => pickParent(table, g, i, null));
      refill(state, repair.again, i);
    } else {
      changed = probe(state, repair, i, tries - RETRIES);
    }
    if (!changed) {
      throw exhausted(state, repair.set, i);
    }
    bad = tracker.violated(state.row);
  }
  tracker.accept();
};
