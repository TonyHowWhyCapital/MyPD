// The tables of the run, parents first, each with its number of rows, how its auto
// increment column is numbered, how many columns carry a rule of their own and its problems.
import React from 'react';
import {
  Icon, NumberInput, Select, Tooltip,
} from 'components';
import { tr } from './i18n';
import { count } from './format';
import { MAX_ROWS, MAX_START, tableSetting } from './settings';
import {
  ownRuleCount, parentChoices, hasAutoIncrement, plannedRows,
} from './planView';

const { Option } = Select;

const Choice = ({
  value, options, onChange, className,
}) => (
  <Select
    className={className}
    notAllowEmpty
    allowClear={false}
    value={value}
    onChange={e => onChange(e.target.value)}
  >
    {options.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
  </Select>
);

const Rows = ({
  base, table, entity, setting, settings, plan, dataSource, onPatch,
}) => {
  const choices = parentChoices(dataSource, entity);
  const per = setting.perParent;
  const mode = per ? 'perParent' : 'fixed';
  const setMode = (next) => {
    if (next === 'fixed') {
      onPatch({ perParent: undefined });
    } else if (!per) {
      onPatch({
        perParent: {
          field: choices[0].fieldId,
          min: 1,
          max: 5,
        },
      });
    }
  };
  const setPer = patch => onPatch({ perParent: { ...per, ...patch } });
  const planned = plannedRows(plan, table);
  if (per && !choices.some(c => c.fieldId === per.field)) {
    // the foreign key the setting names is gone from the model
    return <div className={`${base}-rows`}>
      <span className={`${base}-bad`}>{tr('rows.stale')}</span>
      <a onClick={() => setMode('fixed')}>{tr('fix.fixedRows')}</a>
    </div>;
  }
  return <div className={`${base}-rows${mode === 'perParent' ? ` ${base}-rows-range` : ''}`}>
    {choices.length > 0 && <Choice
      className={`${base}-rows-mode`}
      value={mode}
      onChange={setMode}
      options={[
        { value: 'fixed', label: tr('rows.fixed') },
        { value: 'perParent', label: tr('rows.perParent') },
      ]}
    />}
    {mode === 'fixed' && <NumberInput
      value={setting.rows === undefined ? '' : setting.rows}
      placeholder={tr('rows.default', { rows: count(settings.defaultRows) })}
      min={1}
      max={MAX_ROWS}
      maxLength={7}
      onChange={e => onPatch({ rows: e.target.value === '' ? undefined : e.target.value })}
    />}
    {mode === 'perParent' && <span className={`${base}-rows-group`}>
      {choices.length > 1 ? <Choice
        className={`${base}-rows-parent`}
        value={per.field}
        onChange={field => setPer({ field })}
        options={choices.map(c => ({ value: c.fieldId, label: `${c.parent} (${c.column})` }))}
      /> : <span className={`${base}-rows-parent-name`} title={choices[0].parent}>
        {tr('rows.each', { parent: choices[0].parent })}
      </span>}
    </span>}
    {mode === 'perParent' && <span className={`${base}-rows-group`}>
      <NumberInput
        value={per.min === undefined ? '' : per.min}
        min={0}
        max={MAX_ROWS}
        maxLength={7}
        onChange={e => setPer({ min: e.target.value === '' ? undefined : e.target.value })}
      />
      <span className={`${base}-rows-dash`}>–</span>
      <NumberInput
        value={per.max === undefined ? '' : per.max}
        min={0}
        max={MAX_ROWS}
        maxLength={7}
        onChange={e => setPer({ max: e.target.value === '' ? undefined : e.target.value })}
      />
    </span>}
    {mode === 'perParent' && <span className={`${base}-dim ${base}-rows-total`}>
      {planned.kind === 'range' && tr('rows.estimate', {
        min: count(planned.min),
        max: count(planned.max),
      })}
      {planned.kind === 'unknown' && tr('rows.byDatabase')}
    </span>}
  </div>;
};

const Increment = ({
  base, entity, setting, onPatch,
}) => {
  if (!hasAutoIncrement(entity)) {
    return <span className={`${base}-dim`}>—</span>;
  }
  const mode = setting.autoIncrement === 'database' ? 'database' : 'generate';
  return <div className={`${base}-increment`}>
    <Choice
      value={mode}
      onChange={v => onPatch({ autoIncrement: v === 'database' ? 'database' : undefined })}
      options={[
        { value: 'generate', label: tr('increment.generate') },
        { value: 'database', label: tr('increment.database') },
      ]}
    />
    {mode === 'generate' && <span title={tr('increment.startAtHint')}>
      <NumberInput
        value={setting.startAt === undefined ? 1 : setting.startAt}
        min={0}
        max={MAX_START}
        maxLength={15}
        onChange={e => onPatch({ startAt: e.target.value === '' ? undefined : e.target.value })}
      />
    </span>}
  </div>;
};

export default React.memo(({
  base, dataSource, plan, settings, problemsOf, databaseParents, unsaved, active,
  onPatch, onOpen, onRemove, onParentAnswer,
}) => {
  const entityOf = id => (dataSource.entities || []).find(e => e.id === id);
  // the column is only there when a table of the run has an auto increment column
  const numbered = plan.tables.some(t => hasAutoIncrement(entityOf(t.entityId)));
  return <div className={`${base}-grid-wrap`}>
    <table className={`${base}-grid`}>
      <thead>
        <tr>
          <th className={`${base}-grid-name`}>{tr('grid.table')}</th>
          <th className={`${base}-grid-rows`}>{tr('grid.rows')}</th>
          {numbered && <th className={`${base}-grid-increment`}>
            <Tooltip title={tr('increment.hint')} force placement='top'>
              <span>{tr('grid.increment')} <Icon type='fa-question-circle-o'/></span>
            </Tooltip>
          </th>}
          <th className={`${base}-grid-rules`}>{tr('grid.rules')}</th>
          <th className={`${base}-grid-state`}>{tr('grid.state')}</th>
          <th className={`${base}-grid-act`}/>
        </tr>
      </thead>
      <tbody>
        {plan.tables.map((table) => {
          const entity = entityOf(table.entityId);
          if (!entity) {
            return null;
          }
          const setting = tableSetting(settings, table.entityId);
          const problems = problemsOf(table.entityId);
          const own = ownRuleCount(entity);
          return <tr
            key={table.entityId}
            className={active === table.entityId ? `${base}-grid-active` : ''}
          >
            <td className={`${base}-grid-name`}>
              <div title={`${table.defKey}${table.defName ? ` ${table.defName}` : ''}`}>
                <a onClick={() => onOpen(table.entityId)}>{table.defKey}</a>
                {table.defName && <span className={`${base}-dim`}>{table.defName}</span>}
              </div>
              {unsaved.includes(table.entityId)
                && <div className={`${base}-note`} title={tr('grid.unsavedHint')}>
                  <Icon type='fa-pencil'/>{tr('grid.unsaved')}
                </div>}
            </td>
            <td className={`${base}-grid-rows`}>
              <Rows
                base={base}
                table={table}
                entity={entity}
                setting={setting}
                settings={settings}
                plan={plan}
                dataSource={dataSource}
                onPatch={patch => onPatch(table.entityId, patch)}
              />
            </td>
            {numbered && <td className={`${base}-grid-increment`}>
              <Increment
                base={base}
                entity={entity}
                setting={setting}
                onPatch={patch => onPatch(table.entityId, patch)}
              />
            </td>}
            <td className={`${base}-grid-rules`}>
              <a
                onClick={() => onOpen(table.entityId)}
                title={tr('grid.rulesHint', {
                  own,
                  total: (entity.fields || []).length,
                })}
              >
                {own > 0 ? tr('grid.ownRules', { own }) : tr('grid.autoRules')}
              </a>
            </td>
            <td className={`${base}-grid-state`}>
              {problems.length > 0
                ? <span
                  className={`${base}-badge ${base}-badge-bad`}
                  title={problems.map(p => p.text).join('\n')}
                >
                  <Icon type='fa-exclamation-circle'/>{problems.length}
                </span>
                : <span className={`${base}-badge ${base}-badge-ok`} title={tr('grid.ready')}>
                  <Icon type='fa-check'/>
                </span>}
            </td>
            <td className={`${base}-grid-act`}>
              <span
                className={`${base}-icon-button`}
                title={tr('grid.remove')}
                onClick={() => onRemove(table.entityId)}
              >
                <Icon type='fa-times'/>
              </span>
            </td>
          </tr>;
        })}
        {databaseParents.map((id) => {
          const entity = entityOf(id);
          return entity ? <tr key={`db-${id}`} className={`${base}-grid-external`}>
            <td className={`${base}-grid-name`}>
              <div title={entity.defKey}>
                <span>{entity.defKey}</span>
                {entity.defName && <span className={`${base}-dim`}>{entity.defName}</span>}
              </div>
            </td>
            <td colSpan={numbered ? 2 : 1} title={tr('grid.fromDatabase')}>
              <Icon type='fa-database'/>{tr('grid.fromDatabase')}
            </td>
            <td colSpan={3} className={`${base}-grid-links`}>
              <a onClick={() => onParentAnswer(id, 'generate')}>{tr('fix.generateInstead')}</a>
            </td>
          </tr> : null;
        })}
      </tbody>
    </table>
  </div>;
});
