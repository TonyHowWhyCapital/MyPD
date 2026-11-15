// Step 2: the tables of the run on the left; the columns of the chosen one with their
// rules, and a preview of its rows, on the right.
import React from 'react';
import { Icon } from 'components';
import { tr } from './i18n';
import { count } from './format';
import { plannedRows } from './planView';
import ColumnGrid from './ColumnGrid';
import Preview from './Preview';

const rowsText = (plan, table) => {
  const planned = plannedRows(plan, table);
  if (planned.kind === 'fixed') {
    return tr('rows.count', { rows: count(planned.min) });
  }
  if (planned.kind === 'range') {
    return tr('rows.estimate', {
      min: count(planned.min),
      max: count(planned.max),
    });
  }
  return tr('rows.byDatabase');
};

export default React.memo(({
  base, project, plan, active, focusField, problemsOf, seed, now, loader, connKey,
  errorText, loadErrorText, onActive, onTable,
}) => {
  const { view } = project;
  const table = plan.tables.find(t => t.entityId === active) || plan.tables[0];
  const entity = table && (view.entities || []).find(e => e.id === table.entityId);
  if (!table || !entity) {
    return <div className={`${base}-empty ${base}-empty-big`}>
      <Icon type='fa-table'/>
      <div>{tr('columns.noTables')}</div>
    </div>;
  }
  return <div className={`${base}-split`}>
    <div className={`${base}-tables`}>
      <div className={`${base}-tables-title`}>{tr('columns.tables')}</div>
      <div className={`${base}-tables-list`}>
        {plan.tables.map((t) => {
          const bad = problemsOf(t.entityId).length;
          return <div
            key={t.entityId}
            className={`${base}-tables-item${t.entityId === table.entityId
              ? ` ${base}-tables-item-active` : ''}`}
            title={`${t.defKey}${t.defName ? ` ${t.defName}` : ''}`}
            onClick={() => onActive(t.entityId)}
          >
            <div className={`${base}-tables-name`}>
              <span>{t.defKey}</span>
              {bad > 0 && <i className={`${base}-dot-bad`} title={tr('grid.problems', { count: bad })}/>}
            </div>
            <div className={`${base}-tables-sub`}>
              <span>{t.defName}</span>
              <span>{rowsText(plan, t)}</span>
            </div>
          </div>;
        })}
      </div>
    </div>
    <div className={`${base}-detail`}>
      <div className={`${base}-detail-head`}>
        <span className={`${base}-detail-title`}>{table.defKey}</span>
        {table.defName && <span className={`${base}-dim`}>{table.defName}</span>}
        <span className={`${base}-dim`}>{rowsText(plan, table)}</span>
        {project.unsaved.includes(table.entityId) && <span className={`${base}-note`}>
          <Icon type='fa-pencil'/>{tr('grid.unsavedHint')}
        </span>}
      </div>
      <ColumnGrid
        base={base}
        view={view}
        entity={entity}
        table={table}
        notices={plan.notices || []}
        problemsOf={problemsOf}
        focusField={focusField}
        get={project.get}
        updateNow={project.updateNow}
        setFieldValue={project.setFieldValue}
        onTable={onTable}
      />
      <Preview
        base={base}
        view={view}
        plan={plan}
        entityId={table.entityId}
        seed={seed}
        now={now}
        loader={loader}
        connKey={connKey}
        errorText={errorText}
        loadErrorText={loadErrorText}
      />
    </div>
  </div>;
});
