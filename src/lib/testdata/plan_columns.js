// How each column of a planned table gets its value, and in which order the columns of a
// row are filled. Shared by the planner (to report problems) and the generator.
import { exprColumns } from './values';
import { resolveRule } from './columns';
import { orderColumns } from './plan_order';

// role 'increment': numbers counted up by the generator; 'foreign': copied from a parent
// row; 'rule': made by the rule of the column. The null rate is 0 for columns that take
// part in a unique group (databases disagree on NULLs in unique indexes).
export const columnRoles = (dataSource, entity, table) => {
  const fields = (entity && entity.fields) || [];
  const keyed = (table.uniques || []).reduce((a, b) => a.concat(b), []);
  return table.columns.map((column) => {
    const field = fields.find(f => f.id === column.id) || {};
    const resolved = resolveRule(dataSource, entity, field);
    const foreign = (table.foreignKeys || []).find(k => k.fieldId === column.id);
    let role = 'rule';
    if (foreign) {
      role = 'foreign';
    } else if (column.autoIncrement) {
      role = 'increment';
    }
    return {
      column,
      field,
      role,
      foreign,
      rule: resolved.rule,
      source: resolved.source,
      nullRate: keyed.includes(column.id) ? 0 : resolved.nullRate,
    };
  });
};

const indexOfKey = (roles, key) => {
  const exact = roles.findIndex(r => r.column.defKey === key);
  return exact >= 0 ? exact
    : roles.findIndex(r => `${r.column.defKey}`.toLowerCase() === `${key}`.toLowerCase());
};

// deps[i] = columns that must be filled before column i: the ones its formula reads, and
// for a reference to the table itself the columns it copies.
export const columnDeps = (roles) => {
  const problems = [];
  const deps = roles.map((r) => {
    if (r.role === 'foreign') {
      const at = r.foreign.self ? roles.findIndex(o => o.column.id === r.foreign.refFieldId) : -1;
      return at >= 0 ? [at] : [];
    }
    if (r.role !== 'rule' || r.rule.kind !== 'expr') {
      return [];
    }
    let keys = [];
    try {
      keys = exprColumns((r.rule.params || {}).expr) || [];
    } catch (e) {
      problems.push({
        code: 'badRule',
        fieldId: r.column.id,
        detail: [e.code || e.message],
      });
    }
    return keys.map((key) => {
      const at = indexOfKey(roles, key);
      if (at < 0) {
        problems.push({
          code: 'exprUnknownColumn',
          fieldId: r.column.id,
          detail: key,
        });
      }
      return at;
    }).filter(at => at >= 0);
  });
  return {
    deps,
    problems,
  };
};

export const columnOrder = (roles) => {
  const { deps, problems } = columnDeps(roles);
  const { order, cycle } = orderColumns(roles.length, deps);
  // a column that reads itself
  deps.forEach((list, i) => {
    if (list.includes(i)) {
      problems.push({
        code: roles[i].role === 'rule' ? 'exprCycle' : 'selfReference',
        fieldId: roles[i].column.id,
        detail: [roles[i].column.defKey],
      });
    }
  });
  if (cycle) {
    const formula = cycle.some(i => roles[i].role === 'rule');
    problems.push({
      code: formula ? 'exprCycle' : 'selfReference',
      fieldId: roles[cycle[0]].column.id,
      detail: cycle.map(i => roles[i].column.defKey),
    });
  }
  return {
    order,
    deps,
    problems,
  };
};
