// The problems of the plan as lines of the window: a message and the actions offered.
import { planProblemText, isBlocking, fixesOf } from './problems';

const nameOf = o => (o ? (o.defKey || o.defName || '') : '');

// ctx = { plan, view, tr, ruleTr, hasConn, external, actions }
// actions = { answerParent(id, answer), unselect(id), patchTable(id, patch),
//             gotoTable(id), gotoColumn(id, fieldId), connSettings() }
// -> [{ id, text, blocking, entityId, fieldId, fixes: [{key, label, run, disabled, hint}] }]
export const problemItems = ({
  plan, view, tr, ruleTr, hasConn, external, actions,
}) => {
  const entityOf = id => ((view && view.entities) || []).find(e => e.id === id);
  const items = [];
  const fix = (key, problem) => {
    const detail = (problem.detail && typeof problem.detail === 'object') ? problem.detail : {};
    const parentId = detail.refEntityId || problem.refEntityId;
    const parent = nameOf(entityOf(parentId));
    switch (key) {
      case 'generateParent': return {
        key,
        label: tr('fix.generateParent', { parent }),
        run: () => actions.answerParent(parentId, 'generate'),
      };
      case 'readParent': return {
        key,
        label: tr('fix.readParent'),
        disabled: !hasConn,
        hint: hasConn ? tr('fix.readParentHint') : tr('fix.needConnection'),
        run: () => actions.answerParent(parentId, 'database'),
      };
      case 'programIncrement': return {
        key,
        label: tr('fix.programIncrement', { parent }),
        run: () => actions.patchTable(parentId, { autoIncrement: undefined }),
      };
      case 'fixedRows': return {
        key,
        label: tr('fix.fixedRows'),
        run: () => actions.patchTable(problem.entityId, { perParent: undefined }),
      };
      case 'defaultRows': return {
        key,
        label: tr('fix.defaultRows'),
        run: () => actions.patchTable(problem.entityId, { rows: undefined }),
      };
      case 'unselect': return {
        key,
        label: tr('fix.unselect'),
        run: () => actions.unselect(problem.entityId),
      };
      case 'connection': return {
        key,
        label: tr('output.connSettings'),
        run: () => actions.connSettings(),
      };
      case 'column': return problem.fieldId ? {
        key,
        label: tr('fix.showColumn'),
        run: () => actions.gotoColumn(problem.entityId, problem.fieldId),
      } : null;
      default: return problem.entityId ? {
        key: 'table',
        label: tr('fix.showTable'),
        run: () => actions.gotoTable(problem.entityId),
      } : null;
    }
  };
  const add = (id, problem, text) => items.push({
    id,
    text,
    blocking: isBlocking(problem),
    entityId: problem.entityId,
    fieldId: problem.fieldId,
    fixes: fixesOf(problem).map(key => fix(key, problem)).filter(Boolean),
  });
  // one line per parent that is not selected, however many columns point at it
  const parents = [];
  (plan.missingParents || []).forEach((m) => {
    let parent = parents.find(p => p.refEntityId === m.refEntityId);
    if (!parent) {
      parent = {
        code: 'missingParent',
        refEntityId: m.refEntityId,
        entityId: m.entityId,
        fieldId: m.fieldId,
        children: [],
      };
      parents.push(parent);
    }
    const child = nameOf(entityOf(m.entityId));
    if (child && !parent.children.includes(child)) {
      parent.children.push(child);
    }
  });
  parents.forEach(p => add(`missing-${p.refEntityId}`, p, tr('problem.missingParent', {
    parent: nameOf(entityOf(p.refEntityId)),
    children: p.children.slice(0, 3).join(', ') + (p.children.length > 3 ? '…' : ''),
  })));
  (plan.problems || []).forEach((problem, i) => add(
    `${problem.code}-${problem.entityId || ''}-${problem.fieldId || ''}-${i}`,
    problem, planProblemText(tr, ruleTr, problem, view),
  ));
  if (!hasConn) {
    Object.keys(external || {}).filter(id => external[id] === 'database'
      && (plan.needs.parentKeys || []).some(k => k.entityId === id)).forEach((id) => {
      add(`conn-${id}`, {
        code: 'needsConnection',
        refEntityId: id,
      }, tr('problem.needsConnection', { parent: nameOf(entityOf(id)) }));
    });
    if ((plan.needs.queries || []).length > 0) {
      items.push({
        id: 'conn-query',
        text: tr('problem.queryNeedsConnection'),
        blocking: true,
        fixes: [fix('connection', {})],
      });
    }
  }
  return items;
};

export default problemItems;
