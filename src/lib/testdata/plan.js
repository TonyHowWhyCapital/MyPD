// The plan of a test data run: which tables are filled, in which order (parents first),
// with how many rows, where the values of their foreign keys come from, what has to be
// loaded before the run, and everything that makes the run impossible.
import { getTestData, validateRule } from './model';
import { entityColumns } from './columns';
import { fkGroups, uniqueSets, ruleCapacity } from './plan_keys';
import { orderTables } from './plan_order';
import { columnRoles, columnOrder } from './plan_columns';

export const MAX_ROWS = 1000000;
export const DEFAULT_ROWS = 100;

const isCount = v => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const given = v => v !== undefined && v !== null && v !== '';
const pushOnce = (list, v) => (list.includes(v) ? list : list.push(v));

// The chosen tables, then the parents the user wants generated along with them.
const selectEntities = (entityIds, external, byId, problems) => {
  const ids = [];
  const queue = (entityIds || []).slice();
  while (queue.length > 0) {
    const id = queue.shift();
    const entity = byId.get(id);
    if (!entity && !ids.includes(id)) {
      problems.push({
        code: 'entityNotFound',
        entityId: id,
      });
    }
    if (entity && !ids.includes(id)) {
      ids.push(id);
      fkGroups(entity, byId).filter(g => external[g.refEntityId] === 'generate')
        .forEach(g => queue.push(g.refEntityId));
    }
  }
  return ids;
};

const draftOf = (dataSource, entity, settings, ids, external, byId) => {
  const setting = (settings.tables || {})[entity.id] || {};
  const mode = setting.autoIncrement === 'database' ? 'database' : 'generate';
  const columns = entityColumns(dataSource, entity)
    .filter(c => !(c.autoIncrement && mode === 'database'));
  const fieldOf = id => (entity.fields || []).find(f => f.id === id) || {};
  const groups = fkGroups(entity, byId).map((g) => {
    const pairs = g.pairs.filter(p => columns.some(c => c.id === p.fieldId));
    let source = 'missing';
    if (g.self || ids.includes(g.refEntityId)) {
      source = 'generated';
    } else if (external[g.refEntityId] === 'database') {
      source = 'database';
    }
    return {
      ...g,
      pairs,
      source,
      nullable: pairs.every(p => !fieldOf(p.fieldId).notNull && !fieldOf(p.fieldId).primaryKey),
    };
  }).filter(g => g.pairs.length > 0);
  return {
    entity,
    setting,
    mode,
    columns,
    groups,
  };
};

const flatKeys = groups => groups.reduce((list, g, at) => list.concat(g.pairs.map(p => ({
  fieldId: p.fieldId,
  refEntityId: g.refEntityId,
  refFieldId: p.refFieldId,
  source: g.source,
  group: at,
  ...(g.self ? { self: true } : {}),
  ...(g.deferred ? { deferred: true } : {}),
}))), []);

// rows: a fixed number, or null when every parent row gets its own number of children.
const rowCount = (draft, settings, sized, report) => {
  const { setting, groups } = draft;
  const per = setting.perParent;
  if (per && given(per.field)) {
    const group = groups.find(g => g.pairs.some(p => p.fieldId === per.field));
    const min = Number(per.min);
    const max = Number(per.max);
    if (!group || group.self || group.deferred || group.source === 'missing') {
      report('perParentNotForeignKey', per.field);
    } else if (!isCount(min) || !isCount(max) || min > max) {
      report('perParentRange', per.field, {
        min: per.min,
        max: per.max,
      });
    } else {
      const parent = group.source === 'generated' ? sized.get(group.refEntityId) : undefined;
      const known = parent && parent.maxRows !== null;
      return {
        rows: null,
        perParent: {
          field: per.field,
          min,
          max,
        },
        minRows: known ? parent.minRows * min : 0,
        maxRows: known ? parent.maxRows * max : null,
      };
    }
  }
  let rows = given(setting.rows) ? Number(setting.rows) : settings.defaultRows;
  rows = given(rows) ? Number(rows) : DEFAULT_ROWS;
  if (!isCount(rows)) {
    report('badRows', undefined, { rows: given(setting.rows) ? setting.rows : settings.defaultRows });
    rows = DEFAULT_ROWS;
  }
  return {
    rows,
    perParent: null,
    minRows: rows,
    maxRows: rows,
  };
};

const ruleProblems = (roles, report) => {
  const seen = [];
  roles.filter(r => r.role === 'rule' && r.source !== 'auto').forEach((r) => {
    const codes = typeof validateRule === 'function' ? (validateRule(r.rule) || []) : [];
    if (codes.length > 0 && !seen.includes(r.rule)) {
      seen.push(r.rule);
      report('badRule', r.column.id, codes);
    }
  });
};

const uniqueProblems = (dataSource, table, roles, count, sized, report) => {
  const capacity = (id) => {
    const r = roles.find(o => o.column.id === id);
    if (r.role === 'increment') {
      return Infinity;
    }
    if (r.role === 'foreign') {
      const parent = r.foreign.source === 'generated' && !r.foreign.self
        ? sized.get(r.foreign.refEntityId) : undefined;
      return parent && parent.maxRows !== null ? parent.maxRows : Infinity;
    }
    return ruleCapacity(r.rule, r.column, dataSource, r.field);
  };
  table.uniques.forEach((set) => {
    const total = set.reduce((n, id) => n * capacity(id), 1);
    if (total < count.minRows) {
      report('uniqueImpossible', set[0], {
        fields: set,
        capacity: total,
        rows: count.minRows,
      });
    }
  });
};

const tableOf = (dataSource, draft, settings, sized, drafts, problems) => {
  const { entity, setting, mode, columns, groups } = draft;
  const report = (code, fieldId, detail) => problems.push({
    code,
    entityId: entity.id,
    ...(fieldId === undefined ? {} : { fieldId }),
    ...(detail === undefined ? {} : { detail }),
  });
  const count = rowCount(draft, settings, sized, report);
  if (count.maxRows !== null && count.maxRows > MAX_ROWS) {
    report('tooManyRows', undefined, {
      rows: count.maxRows,
      max: MAX_ROWS,
    });
  }
  const table = {
    entityId: entity.id,
    defKey: entity.defKey,
    defName: entity.defName || '',
    columns,
    rows: count.rows,
    perParent: count.perParent,
    autoIncrement: mode,
    startAt: Number.isInteger(Number(setting.startAt)) && given(setting.startAt)
      ? Number(setting.startAt) : 1,
    foreignKeys: flatKeys(groups),
    uniques: [],
    maxRows: count.maxRows,
  };
  if (columns.length === 0) {
    report('noColumns');
  }
  const plain = columnRoles(dataSource, entity, table);
  const ruleOf = id => plain.filter(r => r.role === 'rule' && r.column.id === id).map(r => r.rule)[0];
  const counted = plain.filter(r => r.role === 'increment').map(r => r.column.id);
  // a column that counts up makes every group it belongs to unique
  table.uniques = uniqueSets(entity, columns, ruleOf)
    .filter(set => !set.some(id => counted.includes(id)));
  const roles = columnRoles(dataSource, entity, table);
  groups.filter(g => g.source === 'generated').forEach((g) => {
    const parent = drafts.find(d => d.entity.id === g.refEntityId);
    g.pairs.forEach((p) => {
      const key = (parent.entity.fields || []).find(f => f.id === p.refFieldId) || {};
      if (key.autoIncrement && parent.mode === 'database') {
        // the numbers are given by the database, so the children cannot know them
        report('autoIncrementParentKey', p.fieldId, {
          refEntityId: g.refEntityId,
          refFieldId: p.refFieldId,
        });
      }
    });
  });
  ruleProblems(roles, report);
  columnOrder(roles).problems.forEach(p => report(p.code, p.fieldId, p.detail));
  uniqueProblems(dataSource, table, roles, count, sized, report);
  sized.set(entity.id, count);
  return {
    table,
    roles,
  };
};

const collectNeeds = (drafts, built, missingParents, needs) => {
  drafts.forEach((d) => {
    d.groups.forEach(g => g.pairs.forEach((p) => {
      if (g.source === 'missing') {
        missingParents.push({
          entityId: d.entity.id,
          fieldId: p.fieldId,
          refEntityId: g.refEntityId,
        });
      } else if (g.source === 'database' && !needs.parentKeys
        .some(k => k.entityId === g.refEntityId && k.fieldId === p.refFieldId)) {
        needs.parentKeys.push({
          entityId: g.refEntityId,
          fieldId: p.refFieldId,
        });
      }
    }));
  });
  built.forEach(({ roles }) => roles.filter(r => r.role === 'rule').forEach((r) => {
    const params = r.rule.params || {};
    if (r.rule.kind === 'file' && given(params.path)) {
      pushOnce(needs.files, params.path);
    } else if (r.rule.kind === 'query' && given(params.sql)) {
      pushOnce(needs.queries, params.sql);
    }
  }));
};

export const buildPlan = (dataSource, { entityIds = [], external = {} } = {}) => {
  const td = getTestData(dataSource) || {};
  const settings = td.settings || {};
  const answers = external || {};
  const byId = new Map(((dataSource && dataSource.entities) || []).map(e => [e.id, e]));
  const problems = [];
  const ids = selectEntities(entityIds, answers, byId, problems);
  const drafts = ids.map(id => draftOf(dataSource, byId.get(id), settings, ids, answers, byId));
  const edges = [];
  drafts.forEach((d, child) => d.groups.filter(g => g.source === 'generated' && !g.self)
    .forEach(group => edges.push({
      child,
      parent: ids.indexOf(group.refEntityId),
      nullable: group.nullable,
      group,
    })));
  const { order, cut, stuck } = orderTables(drafts.length, edges);
  // a cycle: these keys stay NULL, which is only possible when their columns allow it
  cut.forEach((e) => {
    e.group.deferred = true;
  });
  stuck.forEach(e => problems.push({
    code: 'cycle',
    entityId: drafts[e.child].entity.id,
    fieldId: e.group.pairs[0].fieldId,
    detail: { refEntityId: e.group.refEntityId },
  }));
  const sized = new Map();
  const ordered = order.map(i => drafts[i]);
  const built = ordered.map(d => tableOf(dataSource, d, settings, sized, drafts, problems));
  const missingParents = [];
  const needs = {
    files: [],
    queries: [],
    parentKeys: [],
  };
  collectNeeds(ordered, built, missingParents, needs);
  return {
    tables: built.map(b => b.table),
    missingParents,
    needs,
    problems,
  };
};
