// The columns of one table of the run: type, key marks, the rule in force (changed here
// with the same picker as in the table editor), the null rate and what the plan says.
import React, { useEffect, useRef } from 'react';
import { Icon, NumberInput } from 'components';
import RulePicker from '../rules/RulePicker';
import { fieldValue } from '../rules/libraryOps';
import { tr } from './i18n';
import { typeText, count } from './format';
import { columnLines } from './planView';
import { noticeText } from './problems';

const Marks = ({ base, line }) => {
  const { column } = line;
  const marks = [];
  if (column.primaryKey) {
    marks.push(['pk', 'PK', tr('mark.pk')]);
  }
  if (line.role === 'foreign') {
    marks.push(['fk', 'FK', tr('mark.fk')]);
  }
  if (line.unique && !column.primaryKey) {
    marks.push(['uq', 'UQ', tr('mark.unique')]);
  }
  if (column.autoIncrement) {
    marks.push(['ai', 'AI', tr('mark.increment')]);
  }
  if (column.notNull && !column.primaryKey) {
    marks.push(['nn', 'NN', tr('mark.notNull')]);
  }
  return <span className={`${base}-marks`}>
    {marks.map(m => <i key={m[0]} className={`${base}-mark ${base}-mark-${m[0]}`} title={m[2]}>{m[1]}</i>)}
  </span>;
};

export default React.memo(({
  base, view, entity, table, notices, problemsOf, focusField, get, updateNow, setFieldValue,
  onTable,
}) => {
  const lines = columnLines(view, entity, table, notices);
  const focusRef = useRef(null);
  useEffect(() => {
    if (focusField && focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'center' });
    }
  }, [focusField, table.entityId]);
  const parentName = (id) => {
    const parent = (view.entities || []).find(e => e.id === id) || {};
    return parent.defKey || '';
  };
  const parentColumn = (key) => {
    const parent = (view.entities || []).find(e => e.id === key.refEntityId) || {};
    return ((parent.fields || []).find(f => f.id === key.refFieldId) || {}).defKey || '';
  };
  const ruleCell = (line) => {
    const { field, foreign } = line;
    if (line.role === 'omitted') {
      return <span className={`${base}-dim`}>
        <Icon type='fa-database'/>{tr('column.byDatabase')}
        <a onClick={() => onTable(table.entityId)}>{tr('column.change')}</a>
      </span>;
    }
    if (line.role === 'skipped') {
      return <span className={`${base}-dim`}>
        <Icon type='fa-database'/>{tr('column.bySkipped')}
      </span>;
    }
    if (line.role === 'increment') {
      return <span className={`${base}-fixed`}>
        <Icon type='fa-sort-numeric-asc'/>
        {tr('column.counted', { start: count(table.startAt) })}
        <a onClick={() => onTable(table.entityId)}>{tr('column.change')}</a>
      </span>;
    }
    if (line.role === 'foreign') {
      const target = `${parentName(foreign.refEntityId)}.${parentColumn(foreign)}`;
      let text = tr('column.fkGenerated', { target });
      if (foreign.self) {
        text = tr('column.fkSelf', { target });
      } else if (foreign.source === 'database') {
        text = tr('column.fkDatabase', { target });
      } else if (foreign.source === 'missing') {
        text = tr('column.fkMissing', { target });
      }
      return <span className={`${base}-fixed`} title={text}>
        <Icon type='fa-link'/>{text}
      </span>;
    }
    return <RulePicker
      compact
      field={field}
      entity={entity}
      value={field.testData}
      dataSource={view}
      getDataSource={get}
      updateDataSource={updateNow}
      onChange={value => setFieldValue(entity.id, field.id, value)}
    />;
  };
  const rateCell = (line) => {
    const { field } = line;
    const own = field.testData || {};
    // a foreign key that may be empty takes a null rate as well
    if (!line.nullable || line.role === 'omitted' || line.role === 'skipped'
      || line.role === 'increment') {
      return <span className={`${base}-dim`} title={tr('column.neverNull')}>—</span>;
    }
    const inherited = line.rule && line.role === 'rule' ? Number(line.rule.nullRate) || 0 : 0;
    return <span className={`${base}-rate`}>
      <NumberInput
        value={own.nullRate === undefined ? '' : own.nullRate}
        placeholder={`${inherited}`}
        min={0}
        max={100}
        maxLength={3}
        onChange={e => setFieldValue(entity.id, field.id,
          fieldValue(own.rule, e.target.value === '' ? undefined : e.target.value))}
      />
      <span>%</span>
    </span>;
  };
  return <div className={`${base}-columns-wrap`}>
    <table className={`${base}-grid ${base}-columns`}>
      <thead>
        <tr>
          <th className={`${base}-columns-name`}>{tr('column.name')}</th>
          <th className={`${base}-columns-type`}>{tr('column.type')}</th>
          <th className={`${base}-columns-marks`}>{tr('column.marks')}</th>
          <th className={`${base}-columns-rule`}>{tr('column.rule')}</th>
          <th className={`${base}-columns-rate`} title={tr('column.nullRateHint')}>
            {tr('column.nullRate')}
          </th>
          <th className={`${base}-columns-notes`}>{tr('column.notes')}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const { column } = line;
          const problems = problemsOf(table.entityId, column.id);
          const focused = focusField === column.id;
          return <tr
            key={column.id}
            ref={focused ? focusRef : null}
            className={`${focused ? `${base}-grid-active` : ''}${line.role === 'omitted'
              || line.role === 'skipped' ? ` ${base}-columns-off` : ''}`}
          >
            <td className={`${base}-columns-name`}>
              <div title={`${column.defKey}${column.defName ? ` ${column.defName}` : ''}`}>
                <span>{column.defKey}</span>
                {column.defName && column.defName !== column.defKey
                  && <span className={`${base}-dim`}>{column.defName}</span>}
              </div>
            </td>
            <td className={`${base}-columns-type`} title={typeText(column)}>
              {typeText(column)}
            </td>
            <td className={`${base}-columns-marks`}><Marks base={base} line={line}/></td>
            <td className={`${base}-columns-rule`}>{ruleCell(line)}</td>
            <td className={`${base}-columns-rate`}>{rateCell(line)}</td>
            <td className={`${base}-columns-notes`}>
              {problems.map(p => (
                <div key={p.id} className={`${base}-bad`} title={p.text}>
                  <Icon type='fa-exclamation-circle'/>{p.text}
                </div>))}
              {line.notices.map(n => (
                <div key={n.code} className={`${base}-dim`} title={noticeText(tr, n)}>
                  {noticeText(tr, n)}
                </div>))}
              {line.notes.map(n => (
                <div key={n} className={`${base}-dim`} title={tr(`note.${n}`)}>
                  {tr(`note.${n}`)}
                </div>))}
            </td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
});
