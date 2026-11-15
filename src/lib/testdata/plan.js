// The plan of a test data run: which tables are filled, in which order (parents first),
// with how many rows, where the values of their foreign keys come from, what has to be
// loaded before the run, and everything that makes the run impossible.
import { getTestData, validateRule, seedNow } from './model';
import { entityColumns } from './columns';
import { fkGroups, uniqueSets, ruleCapacity } from './plan_keys';
import { orderTables } from './plan_order';
import { columnRoles, columnOrder } from './plan_columns';
import { probeTable } from './plan_probe';
import { makeKeyFit } from './fit';

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
  const all = entityColumns(dataSource, entity);
  // SQL Server fills timestamp / rowversion columns itself and refuses a value for them.
  // (Computed columns cannot be inserted either, but the model does not say which they are.)
  const skipped = all.filter(c => c.subtype === 'rowversion');
  const columns = all.filter(c => !(c.autoIncrement && mode === 'database')
    && !skipped.includes(c));
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
    skipped,
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

// reports the rules that do not validate and returns them
const ruleProblems = (roles, now, report) => {
  const seen = [];
  roles.filter(r => r.role === 'rule' && r.source !== 'auto').forEach((r) => {
    const codes = typeof validateRule === 'function' ? (validateRule(r.rule, { now }) || []) : [];
    if (codes.length > 0 && !seen.includes(r.rule)) {
      seen.push(r.rule);
      report('badRule', r.column.id, codes);
    }
  });
  return seen;
};

// The numbers of an auto increment column must all go into the column.
const incrementProblems = (table, roles, count, report) => {
  roles.filter(r => r.role === 'increment').forEach((r) => {
    const fit = makeKeyFit(r.column);
    const last = table.startAt + Math.max(0, (count.maxRows === null ? 1 : count.maxRows) - 1);
    try {
      fit(table.startAt);
      fit(last);
    } catch (e) {
      report('incrementOverflow', r.column.id, {
        startAt: table.startAt,
        rows: count.maxRows,
        last,
      });
    }
  });
};

// A unique group cannot hold more rows than its columns have combinations of values. The
// columns of one foreign key count once (they are copied from one parent row).
const uniqueProblems = (table, roles, count, sized, ctx, report) => {
  const perParent = table.perParent ? table.perParent.field : null;
  table.uniques.forEach((set) => {
    const keys = [];
    let total = 1;
    let others = 1; // combinations besides the key the rows are counted per
    let counted = false;
    set.forEach((id) => {
      const r = roles.find(o => o.column.id === id);
      let capacity = Infinity;
      if (r.role === 'foreign') {
        if (keys.includes(r.foreign.group)) {
          return;
        }
        keys.push(r.foreign.group);
        const parent = r.foreign.source === 'generated' && !r.foreign.self
          ? sized.get(r.foreign.refEntityId) : undefined;
        capacity = parent && parent.maxRows !== null ? parent.maxRows : Infinity;
        if ((table.foreignKeys || []).some(k => k.group === r.foreign.group
          && k.fieldId === perParent)) {
          counted = true;
          total *= capacity;
          return;
        }
      } else if (r.role === 'rule') {
        capacity = ruleCapacity(r.rule, r.column, ctx.dataSource, r.field, ctx);
      }
      total *= capacity;
      others *= capacity;
    });
    if (total < count.minRows) {
      report('uniqueImpossible', set[0], {
        fields: set,
        capacity: total,
        rows: count.minRows,
      });
    } else if (counted && others < table.perParent.max) {
      // every parent row gets up to `max` children, which must differ in the other columns
      report('uniqueImpossible', set[0], {
        fields: set,
        capacity: others,
        rows: table.perParent.max,
        perParent: true,
      });
    }
  });
};

const tableOf = (dataSource, draft, settings, sized, drafts, problems, ctx) => {
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
  const invalid = ruleProblems(roles, ctx.now, report);
  const ordered = columnOrder(roles);
  ordered.problems.forEach(p => report(p.code, p.fieldId, p.detail));
  incrementProblems(table, roles, count, report);
  if (!ordered.problems.some(p => p.code === 'exprCycle' || p.code === 'selfReference')) {
    const tried = probeTable(table, roles, ordered.order, ordered.deps,
      count.maxRows === null ? DEFAULT_ROWS : count.maxRows, {
        ...ctx,
        invalid,
      });
    // a formula that names an unknown column is reported as that already
    tried.problems.filter(p => !ordered.problems.some(o => o.fieldId === p.fieldId))
      .forEach(p => problems.push({
        entityId: entity.id,
        ...p,
      }));
    ctx.samples.set(entity.id, tried.samples);
  }
  uniqueProblems(table, roles, count, sized, ctx, report);
  sized.set(entity.id, count);
  return {
    table,
    roles,
  };
};

// What the user should know although it does not stop the run.
const noticesOf = (draft, roles) => draft.skipped.map(c => ({
  code: 'columnSkipped',
  entityId: draft.entity.id,
  fieldId: c.id,
  detail: c.subtype,
})).concat(roles.filter(r => r.nullRateIgnored !== undefined).map(r => ({
  // a column of a key or unique index is never NULL: databases disagree on NULLs there
  code: 'nullRateIgnored',
  entityId: draft.entity.id,
  fieldId: r.column.id,
  detail: { nullRate: r.nullRateIgnored },
})));

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

// options.lists ({file, query}) and options.now (Date) let the rules be tried with what the
// run will use; without them file and query rules are tried when the run starts.
export const buildPlan = (dataSource, {
  entityIds = [], external = {}, lists, now,
} = {}) => {
  const td = getTestData(dataSource) || {};
  const settings = td.settings || {};
  const seed = settings.seed || {};
  const ctx = {
    dataSource,
    lists,
    now: now instanceof Date ? now : seedNow(settings, new Date()),
    seed: seed.fixed !== false && Number.isFinite(Number(seed.value)) ? Number(seed.value) : 1,
    samples: new Map(),
  };
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
  const built = ordered.map(d => tableOf(dataSource, d, settings, sized, drafts, problems, ctx));
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
    notices: ordered.reduce((list, d, i) => list.concat(noticesOf(d, built[i].roles)), []),
  };
};
