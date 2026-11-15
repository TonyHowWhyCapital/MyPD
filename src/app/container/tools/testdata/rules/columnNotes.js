// What the plan of a run would say about ONE column, for the window that sets the rule of
// that column: a foreign key or an auto increment column does not use its rule, a column
// of a key never gets NULL, a number that will not fit. The table is planned alone (with
// the tables it points at), with the column as it is on screen.
import { buildPlan } from '../../../../../lib/testdata/plan';
import { fkGroups } from '../../../../../lib/testdata/plan_keys';
import { columnLines } from '../generate/planView';
import { planProblemText, noticeText } from '../generate/problems';

// problems of the plan that are about the column itself and that nothing else in the
// window shows (a rule that does not fit the column shows in the samples)
const SHOWN = ['incrementOverflow', 'foreignKeyFit', 'uniqueImpossible', 'exprCycle',
  'selfReference'];

const nameOf = o => (o ? (o.defKey || o.defName || '') : '');

// -> null when the column cannot be planned, else
//    { dataSource, line (see columnLines), table, problems: [problem of the plan] }
export const columnFacts = (dataSource, entity, field, value) => {
  if (!dataSource || !entity || !field || !field.id) {
    return null;
  }
  const { testData, ...rest } = field;
  const shown = value ? { ...rest, testData: value } : rest;
  const fields = entity.fields || [];
  const table = {
    ...entity,
    fields: fields.some(f => f.id === field.id)
      ? fields.map(f => (f.id === field.id ? shown : f)) : fields.concat(shown),
  };
  const entities = dataSource.entities || [];
  const ds = {
    ...dataSource,
    entities: entities.some(e => e.id === entity.id)
      ? entities.map(e => (e.id === entity.id ? table : e)) : entities.concat(table),
  };
  const byId = new Map(ds.entities.map(e => [e.id, e]));
  const parents = fkGroups(table, byId).map(g => g.refEntityId)
    .filter((id, i, list) => id !== entity.id && list.indexOf(id) === i);
  try {
    const plan = buildPlan(ds, { entityIds: [entity.id].concat(parents) });
    const planned = plan.tables.find(t => t.entityId === entity.id);
    const line = planned && columnLines(ds, table, planned, plan.notices || [])
      .find(l => l.column.id === field.id);
    if (!line) {
      return null;
    }
    return {
      dataSource: ds,
      line,
      table: planned,
      problems: (plan.problems || []).filter(p => p.entityId === entity.id
        && p.fieldId === field.id && SHOWN.includes(p.code)),
    };
  } catch (e) {
    return null;
  }
};

// The facts as lines: [{level: 'bad' | 'info', text}]. `tr` gives `testDataRule.<id>`,
// `genTr` gives `testData.<id>` (the texts of the generate window, so both windows say
// the same thing in the same words).
export const columnNoteLines = (tr, genTr, facts) => {
  if (!facts) {
    return [];
  }
  const { line, dataSource, problems } = facts;
  const lines = [];
  if (line.role === 'foreign' && line.foreign) {
    const parent = (dataSource.entities || []).find(e => e.id === line.foreign.refEntityId);
    const column = ((parent && parent.fields) || []).find(f => f.id === line.foreign.refFieldId);
    lines.push({
      level: 'info',
      text: tr('picker.foreignNote', { target: `${nameOf(parent)}.${nameOf(column)}` }),
    });
  } else if (line.role === 'increment' || line.role === 'omitted') {
    lines.push({ level: 'info', text: tr('picker.incrementNote') });
  }
  problems.forEach(p => lines.push({
    level: 'bad',
    text: planProblemText(genTr, tr, p, dataSource),
  }));
  (line.notices || []).forEach(n => lines.push({ level: 'info', text: noticeText(genTr, n) }));
  return lines;
};

// true when the rule chosen for the column is not what fills it
export const ruleUnused = facts => !!facts && facts.line.role !== 'rule';
