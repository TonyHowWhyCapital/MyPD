// Foreign keys while generating: which parent row a child row points at.

export const fail = (code, message, extra) => {
  const error = new Error(message);
  error.code = code;
  return Object.assign(error, extra || {});
};

// Key values of a parent: `at(i)` is the value of row i, `size()` the number of rows.
export const listKeys = list => ({
  at: i => list[i],
  size: () => list.length,
});

// Every parent row gets between min and max children; the children of one parent follow
// each other. `total` is known up front (the numbers are drawn twice from the same stream).
export const createSchedule = (parents, min, max, makeRandom) => {
  const count = makeRandom();
  let total = 0;
  for (let p = 0; p < parents; p += 1) {
    total += min === max ? min : count.int(min, max);
  }
  const random = makeRandom();
  let parent = -1;
  let left = 0;
  return {
    total,
    // must be called once per row, in row order
    next: () => {
      while (left === 0 && parent < parents) {
        parent += 1;
        left = min === max ? min : random.int(min, max);
      }
      left -= 1;
      return parent;
    },
  };
};

const keysOf = (table, group, env) => {
  const { store, parentKeys, lenient } = env;
  const missing = (code) => {
    if (lenient) {
      return group.pairs.map(() => listKeys([]));
    }
    throw fail(code, `No key values of the parent table for ${table.defKey}`, {
      entityId: table.entityId,
      fieldId: group.pairs[0].fieldId,
      refEntityId: group.refEntityId,
    });
  };
  if (group.source === 'generated') {
    const kept = store.get(group.refEntityId);
    const keys = group.pairs.map(p => kept && kept[p.refFieldId]);
    return keys.every(k => k) ? keys : missing('parentNotGenerated');
  }
  if (group.source === 'database') {
    const loaded = (parentKeys || {})[group.refEntityId] || {};
    const keys = group.pairs.map(p => loaded[p.refFieldId]);
    return keys.every(k => Array.isArray(k)) ? keys.map(listKeys) : missing('parentKeysMissing');
  }
  return missing('missingParent');
};

// The foreign keys of a planned table, one entry per (composite) key:
// positions = where its columns sit in a row, keys = the parent's values per column,
// current = the parent row chosen for the row being made (-1 = NULL).
export const buildGroups = (table, roles, env) => {
  const groups = [];
  roles.forEach((r, position) => {
    if (r.role !== 'foreign') {
      return;
    }
    const k = r.foreign;
    let group = groups.find(g => g.id === k.group);
    if (!group) {
      group = {
        id: k.group,
        refEntityId: k.refEntityId,
        source: k.source,
        self: !!k.self,
        deferred: !!k.deferred,
        nullable: true,
        nullRate: r.nullRate,
        pairs: [],
        positions: [],
        current: -1,
      };
      groups.push(group);
    }
    group.pairs.push(k);
    group.positions.push(position);
    group.nullable = group.nullable && !r.column.notNull && !r.column.primaryKey;
  });
  groups.forEach((g) => {
    if (g.deferred && !g.nullable && !env.lenient) {
      throw fail('cycle', `${table.defKey} is part of a cycle of mandatory references`, {
        entityId: table.entityId,
        fieldId: g.pairs[0].fieldId,
        refEntityId: g.refEntityId,
      });
    }
    const perParent = !!table.perParent && g.pairs.some(p => p.fieldId === table.perParent.field);
    const keys = g.deferred ? g.pairs.map(() => listKeys([])) : keysOf(table, g, env);
    const label = `${table.entityId}/${g.pairs[0].fieldId}`;
    Object.assign(g, {
      perParent,
      keys,
      lenient: !!env.lenient,
      random: env.stream(`${label}/parent`),
      nullRandom: g.nullable && g.nullRate > 0 && !perParent ? env.stream(`${label}/null`) : null,
    });
    // rows of the parent that can be chosen for row i
    g.count = (i) => {
      if (g.self) {
        return i + (g.nullable ? 0 : 1);
      }
      return g.keys.reduce((n, k) => Math.min(n, k.size()), Infinity);
    };
  });
  return groups;
};

export const pickParent = (table, group, i, schedule) => {
  const g = group;
  if (g.deferred) {
    g.current = -1;
  } else if (g.perParent) {
    g.current = schedule.next();
  } else if (g.nullRandom && g.nullRandom.next() * 100 < g.nullRate) {
    g.current = -1;
  } else {
    const n = g.count(i);
    if (n === 0 && !g.nullable && !g.lenient) {
      throw fail('noParentRows', `The parent table of ${table.defKey} has no rows`, {
        entityId: table.entityId,
        fieldId: g.pairs[0].fieldId,
        refEntityId: g.refEntityId,
      });
    }
    g.current = n === 0 ? -1 : g.random.int(0, n - 1);
  }
};
