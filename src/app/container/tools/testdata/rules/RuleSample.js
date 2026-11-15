// What a rule produces: about ten values made by the real generator for a column the
// user picks, a generic one or a real column of a table of the project.
import React, { useMemo, useState } from 'react';
import { Select } from 'components';
import { fieldColumn } from '../../../../../lib/testdata/columns';
import { validateRule } from '../../../../../lib/testdata/model';
import {
  sampleValues, genericColumn, valueText, GENERIC_COLUMNS, SAMPLE_COUNT, SAMPLE_SEED,
} from './sample';
import { problemText } from './ruleText';

const { Option } = Select;
const GENERIC_KINDS = Object.keys(GENERIC_COLUMNS);

const typeText = (column) => {
  const size = [column.len, column.scale].filter(v => v !== null && v !== undefined && v !== '');
  return `${column.type || column.kind}${size.length > 0 ? `(${size.join(',')})` : ''}`;
};

// target = {entityId: '' for a generic column, fieldId, generic: kind}
export const targetOf = (dataSource, target) => {
  const entity = target.entityId
    ? ((dataSource && dataSource.entities) || []).find(e => e.id === target.entityId) : null;
  const field = entity
    ? (entity.fields || []).find(f => f.id === target.fieldId) || null : null;
  return {
    entity,
    field,
    column: field ? fieldColumn(dataSource, field) : genericColumn(target.generic),
  };
};

export default React.memo(({
  base, tr, rule, dataSource, target, onTargetChange, lists, nullRate, fixed, listError,
}) => {
  const [seed, setSeed] = useState(SAMPLE_SEED);
  // `fixed` = {entity, field}: the column is given and cannot be changed here
  const { entity, field, column } = fixed ? {
    entity: fixed.entity || null,
    field: fixed.field,
    column: fieldColumn(dataSource, fixed.field),
  } : targetOf(dataSource, target);
  const result = useMemo(() => {
    if (!rule || rule.kind === 'query') {
      return { values: [], error: null };
    }
    return sampleValues({
      rule, column, field, entity, dataSource, lists, seed, nullRate,
    });
  }, [JSON.stringify(rule && [rule.kind, rule.params]), JSON.stringify(column), field, entity,
    dataSource, lists, seed, nullRate]);
  // what is wrong with the rule itself is told beside the form, not here again
  const invalid = !!rule && validateRule({ kind: rule.kind, params: rule.params }).length > 0;
  // The list of a file that is not there: `listError` says why the file could not be
  // read; without it the form beside the samples says so already.
  let errorLine = '';
  if (result.error && result.error.code === 'file.missing') {
    errorLine = listError ? problemText(tr, listError.code) : '';
  } else if (result.error) {
    errorLine = problemText(tr, result.error.code, result.error);
  }
  const entities = (dataSource && dataSource.entities) || [];
  const setEntity = (entityId) => {
    const next = entities.find(e => e.id === entityId);
    onTargetChange({
      ...target,
      entityId,
      fieldId: next && next.fields && next.fields[0] ? next.fields[0].id : '',
    });
  };
  return <div className={`${base}-sample`}>
    <div className={`${base}-sample-title`}>
      <span>{tr('sample.title')}</span>
      {rule && rule.kind !== 'query' && !result.error && <a
        onClick={() => setSeed(seed + 1)}
      >{tr('sample.refresh')}</a>}
    </div>
    {!fixed && <div className={`${base}-sample-target`}>
      <span>{tr('sample.table')}</span>
      <Select
        notAllowEmpty
        allowClear={false}
        value={target.entityId || ''}
        onChange={e => setEntity(e.target.value)}
      >
        {[<Option key='__generic' value=''>{tr('sample.genericTable')}</Option>]
          .concat(entities.map(e => (
            <Option key={e.id} value={e.id}>
              {`${e.defKey}${e.defName ? `[${e.defName}]` : ''}`}
            </Option>)))}
      </Select>
      <span>{tr('sample.field')}</span>
      {entity ? <Select
        notAllowEmpty
        allowClear={false}
        value={target.fieldId || ''}
        onChange={e => onTargetChange({ ...target, fieldId: e.target.value })}
      >
        {(entity.fields || []).map(f => (
          <Option key={f.id} value={f.id}>
            {`${f.defKey}${f.defName ? `[${f.defName}]` : ''}`}
          </Option>))}
      </Select> : <Select
        notAllowEmpty
        allowClear={false}
        value={target.generic || 'string'}
        onChange={e => onTargetChange({ ...target, generic: e.target.value })}
      >
        {GENERIC_KINDS.map(k => (
          <Option key={k} value={k}>{tr(`sample.generic.${k}`)}</Option>))}
      </Select>}
    </div>}
    <div className={`${base}-sample-type`}>
      {field ? `${field.defKey}  ${typeText(column)}` : typeText(column)}
    </div>
    {rule && rule.kind === 'query' && <div className={`${base}-sample-note`}>
      {tr('sample.queryNote')}
    </div>}
    {result.error && invalid
      && <div className={`${base}-sample-note`}>{tr('sample.fixFirst')}</div>}
    {result.error && !invalid && errorLine && <div className={`${base}-sample-error`}>
      {errorLine}
    </div>}
    {result.values.length > 0 && <ol className={`${base}-sample-values`}>
      {result.values.map((v, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <li key={i} className={v === null ? `${base}-sample-null` : ''} title={valueText(v)}>
          {valueText(v)}
        </li>))}
    </ol>}
    {result.values.length > 0 && <div className={`${base}-sample-hint`}>
      {tr('sample.hint', { count: SAMPLE_COUNT })}
    </div>}
  </div>;
});
