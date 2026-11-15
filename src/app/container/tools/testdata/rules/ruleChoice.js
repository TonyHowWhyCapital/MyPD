// What a rule picker offers and what choosing does; shared by the picker and by the
// details window of a column.
import React from 'react';
import { MultipleSelect, Message } from 'components';
import { tr } from './i18n';
import { effectiveLabel } from './ruleText';
import {
  projectRules, effectiveRule, fieldValue, addProjectRules, findTwin, rulesFor,
} from './libraryOps';
import { getMachineRules } from './machine';
import { getProjectFile } from './projectFile';
import { openRuleEditor, openRuleLibrary } from './ruleModals';
import RuleLibrary from './RuleLibrary';

const { Option } = MultipleSelect;
const MACHINE = 'machine:';

const entityOf = (dataSource, field, entity) => entity
  || ((dataSource && dataSource.entities) || [])
    .find(e => (e.fields || []).some(f => field && f.id === field.id)) || null;

// the open list of a select closes on a click anywhere else
export const closeLists = () => document.body.click();

// `apply(value)` receives the new {rule, nullRate} | undefined.
export const ruleChoice = ({
  field, entity, value, dataSource, getDataSource, updateDataSource, apply,
}) => {
  const rules = projectRules(dataSource);
  const own = value && value.rule && rules.some(r => r.id === value.rule) ? value.rule : '';
  const rate = value ? value.nullRate : undefined;
  const canWrite = !!(getDataSource && updateDataSource);
  // the rules of this machine as they would be stored in this project
  const offered = () => rulesFor('project', getMachineRules(), getProjectFile());
  const machine = canWrite ? offered().filter(r => !findTwin(rules, r)) : [];
  const table = entityOf(dataSource, field, entity);
  const choose = (id) => {
    if (!id) {
      apply(fieldValue('', rate));
    } else if (`${id}`.startsWith(MACHINE)) {
      const rule = offered().find(r => r.id === id.slice(MACHINE.length));
      if (rule) {
        const current = getDataSource();
        const twin = findTwin(projectRules(current), rule);
        if (twin) {
          apply(fieldValue(twin.id, rate));
        } else {
          const { dataSource: next, added } = addProjectRules(current, [rule]);
          updateDataSource(next);
          apply(fieldValue(added[0].id, rate));
          Message.success({ title: tr('picker.copied', { name: rule.name }) });
        }
      }
    } else {
      apply(fieldValue(id, rate));
    }
  };
  // the list is drawn inside the select: a click on a link must not count as a click on
  // the select, which would open the list again
  const create = (e) => {
    e && e.stopPropagation();
    closeLists();
    openRuleEditor({
      getDataSource,
      updateDataSource,
      entity: table,
      field,
      onOk: rule => apply(fieldValue(rule.id, rate)),
    });
  };
  const manage = (e) => {
    e && e.stopPropagation();
    closeLists();
    openRuleLibrary(RuleLibrary, {
      getDataSource,
      updateDataSource,
      initialRuleId: own || undefined,
    });
  };
  // the first choice says what the column gets when it has no rule of its own
  const fallback = effectiveLabel(tr, effectiveRule(dataSource, field, fieldValue('', rate)));
  const options = [<Option key='__auto' value=''>{fallback}</Option>]
    .concat(rules.map(r => <Option key={r.id} value={r.id}>{r.name || tr(`kind.${r.kind}`)}</Option>))
    .concat(machine.map(r => (
      <Option key={`${MACHINE}${r.id}`} value={`${MACHINE}${r.id}`}>
        {tr('picker.machine', { name: r.name })}
      </Option>)));
  const footer = base => (canWrite ? <div className={`${base}-picker-links`}>
    <span onClick={create}>{tr('action.newRule')}</span>
    <span onClick={manage}>{tr('action.manage')}</span>
  </div> : null);
  return {
    own, rate, options, footer, choose, create, manage, canWrite, table,
  };
};
