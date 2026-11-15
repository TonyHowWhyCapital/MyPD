// What the window shows about tables and columns, worked out from the project, the open
// editor tabs and the plan. Pure.
import { columnRoles } from '../../../../../lib/testdata/plan_columns';
import { fkGroups } from '../../../../../lib/testdata/plan_keys';
import { entityColumns } from '../../../../../lib/testdata/columns';
import { setFieldRule } from '../../../../../lib/testdata/model';

const sameValue = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

// tabs of tables being edited: [{tabKey, entityId, data, dirty}]
export const entityTabs = tabs => Object.keys(tabs || {})
  .map(tabKey => ({ tabKey, tab: tabs[tabKey] }))
  .filter(({ tab }) => tab && tab.type === 'entity' && tab.data)
  .map(({ tabKey, tab }) => ({
    tabKey,
    entityId: tab.key || tab.data.id,
    data: tab.data,
    dirty: !tab.isInit,
  }));

// ids of the tables with changes that are not saved into the project yet
export const dirtyEntityIds = tabs => entityTabs(tabs).filter(t => t.dirty).map(t => t.entityId);

// The project with the test data setting of every column as its editor tab shows it. A
// table edited in a tab keeps the structure the project has (what the DDL export and the
// database know); only the rule and the null rate of its columns follow the tab, because
// the tab is where they were set last.
export const withTabRules = (dataSource, tabs) => {
  const open = entityTabs(tabs).filter(t => t.dirty);
  if (open.length === 0) {
    return dataSource;
  }
  let changed = false;
  const entities = (dataSource.entities || []).map((entity) => {
    const tab = open.find(t => t.entityId === entity.id);
    if (!tab) {
      return entity;
    }
    let touched = false;
    const fields = (entity.fields || []).map((field) => {
      const shown = (tab.data.fields || []).find(f => f.id === field.id);
      if (!shown || sameValue(shown.testData, field.testData)) {
        return field;
      }
      touched = true;
      const { testData, ...rest } = field;
      return shown.testData ? { ...rest, testData: shown.testData } : rest;
    });
    changed = changed || touched;
    return touched ? { ...entity, fields } : entity;
  });
  return changed ? { ...dataSource, entities } : dataSource;
};

// the data of a tab with the setting of one column changed; null when the tab has no such
// column (removed in the tab) or nothing changes
export const patchTabData = (data, fieldId, value) => {
  const fields = data.fields || [];
  const at = fields.findIndex(f => f.id === fieldId);
  if (at < 0 || sameValue(fields[at].testData, value)) {
    return null;
  }
  const { testData, ...rest } = fields[at];
  const next = fields.slice();
  next[at] = value ? { ...rest, testData: value } : rest;
  return { ...data, fields: next };
};

// the project with the setting of one column changed
export const applyFieldValue = (dataSource, entityId, fieldId, value) => setFieldRule(dataSource,
  entityId, fieldId, value || null);

// number of columns that carry a rule or a null rate of their own
export const ownRuleCount = entity => ((entity && entity.fields) || [])
  .filter(f => f.testData && (f.testData.rule || f.testData.nullRate !== undefined)).length;

// foreign keys a table can be sized by: [{fieldId, column, parentId, parent}]
export const parentChoices = (dataSource, entity) => {
  const byId = new Map(((dataSource && dataSource.entities) || []).map(e => [e.id, e]));
  return fkGroups(entity, byId).filter(g => !g.self).map((g) => {
    const field = (entity.fields || []).find(f => f.id === g.pairs[0].fieldId) || {};
    const parent = byId.get(g.refEntityId) || {};
    return {
      fieldId: g.pairs[0].fieldId,
      column: g.pairs.map(p => ((entity.fields || []).find(f => f.id === p.fieldId) || {}).defKey)
        .filter(Boolean).join(', ') || field.defKey || '',
      parentId: g.refEntityId,
      parent: parent.defKey || '',
    };
  });
};

export const hasAutoIncrement = entity => ((entity && entity.fields) || [])
  .some(f => f && f.defKey && f.autoIncrement);

// rows the table gets: {text: 'fixed'|'range'|'unknown', min, max}
export const plannedRows = (plan, table) => {
  if (!table.perParent) {
    return {
      kind: 'fixed',
      min: table.rows,
      max: table.rows,
    };
  }
  const key = (table.foreignKeys || []).find(k => k.fieldId === table.perParent.field);
  const parent = key && plan.tables.find(t => t.entityId === key.refEntityId);
  if (!parent || key.source !== 'generated' || parent.rows === null || parent.rows === undefined) {
    return {
      kind: 'unknown',
      min: null,
      max: table.maxRows === undefined ? null : table.maxRows,
    };
  }
  return {
    kind: 'range',
    min: parent.rows * table.perParent.min,
    max: parent.rows * table.perParent.max,
  };
};

// rows of the whole run: {min, max, open}; `open` when a table depends on the database
export const totalRows = plan => plan.tables.reduce((sum, table) => {
  const planned = plannedRows(plan, table);
  return {
    min: sum.min + (planned.min || 0),
    max: sum.max + (planned.max || 0),
    open: sum.open || planned.kind === 'unknown',
  };
}, {
  min: 0,
  max: 0,
  open: false,
});

// One line per column of a table of the plan, in the order of the model:
// { column, field, role: 'rule'|'foreign'|'increment'|'omitted'|'skipped', foreign, unique,
//   nullable, nullRate, source, rule, notes: [code], notices: [notice of the plan] }
// role 'omitted': an auto increment column left to the database; 'skipped': a column the
// database fills itself (row version). notes: 'deferred' (stays NULL to break a cycle),
// 'binaryNull' / 'binaryHex' (binary columns are not generated)
export const columnLines = (dataSource, entity, table, notices = []) => {
  const roles = columnRoles(dataSource, entity, table);
  const keyed = (table.uniques || []).reduce((all, set) => all.concat(set), []);
  return entityColumns(dataSource, entity).map((column) => {
    const field = (entity.fields || []).find(f => f.id === column.id) || {};
    const role = roles.find(r => r.column.id === column.id);
    const nullable = !column.notNull && !column.primaryKey && !column.autoIncrement;
    const mine = notices.filter(n => n.entityId === table.entityId && n.fieldId === column.id);
    const notes = [];
    if (!role) {
      return {
        column,
        field,
        role: column.autoIncrement && table.autoIncrement === 'database' ? 'omitted' : 'skipped',
        nullable: false,
        nullRate: 0,
        unique: false,
        notes,
        notices: mine,
      };
    }
    if (role.role === 'foreign' && role.foreign.deferred) {
      notes.push('deferred');
    }
    if (role.role === 'rule' && column.kind === 'binary' && role.source === 'auto') {
      notes.push(nullable ? 'binaryNull' : 'binaryHex');
    }
    return {
      column,
      field,
      role: role.role,
      foreign: role.foreign,
      rule: role.rule,
      source: role.source,
      nullable,
      nullRate: role.nullRate,
      unique: keyed.includes(column.id),
      notes,
      notices: mine,
    };
  });
};

// tables of the model grouped the way the navigation shows them:
// [{id, name, entities: [entity]}], the tables outside every group last
export const groupedEntities = (dataSource, ungroupedName) => {
  const entities = (dataSource && dataSource.entities) || [];
  const groups = ((dataSource && dataSource.viewGroups) || []).map(g => ({
    id: g.id,
    name: g.defName || g.defKey || '',
    entities: entities.filter(e => (g.refEntities || []).includes(e.id)),
  })).filter(g => g.entities.length > 0);
  const grouped = new Set(groups.reduce((all, g) => all.concat(g.entities.map(e => e.id)), []));
  const rest = entities.filter(e => !grouped.has(e.id));
  return rest.length > 0 ? groups.concat({
    id: '__ungroup',
    name: ungroupedName,
    entities: rest,
  }) : groups;
};

export const matchesKeyword = (entity, keyword) => {
  const text = `${keyword || ''}`.trim().toLowerCase();
  return !text || `${entity.defKey || ''}`.toLowerCase().includes(text)
    || `${entity.defName || ''}`.toLowerCase().includes(text);
};
