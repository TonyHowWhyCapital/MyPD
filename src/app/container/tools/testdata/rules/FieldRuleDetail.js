// The test data settings of one column: its rule, the null rate of this column and
// sample values made for exactly this column. Opened from a rule picker.
import React, {
  forwardRef, useImperativeHandle, useState,
} from 'react';
import { MultipleSelect } from 'components';
import { getPrefix } from '../../../../../lib/prefixUtil';
import { tr } from './i18n';
import { ruleSummary, sourceLabel } from './ruleText';
import { effectiveRule, fieldValue, projectRules } from './libraryOps';
import { openRuleEditor } from './ruleModals';
import { ruleChoice } from './ruleChoice';
import useFileList from './useFileList';
import RuleSample from './RuleSample';
import { Row, NumberField } from './params/common';

export default forwardRef(({
  prefix, field, entity, value, dataSource, getDataSource, updateDataSource,
}, ref) => {
  const base = `${getPrefix(prefix)}-testdata`;
  const [current, setCurrent] = useState(value);
  // the project changes under this window when a rule is created, copied in or edited
  const [, refresh] = useState(0);
  const ds = (getDataSource && getDataSource()) || dataSource;
  useImperativeHandle(ref, () => ({
    value: () => current,
  }), [current]);
  const apply = (next) => {
    setCurrent(next);
    refresh(n => n + 1);
  };
  const choice = ruleChoice({
    field, entity, value: current, dataSource: ds, getDataSource, updateDataSource, apply,
  });
  const resolved = effectiveRule(ds, field, current);
  const source = choice.own ? 'field' : resolved.source;
  const fileState = useFileList(resolved.rule);
  const lists = fileState.path && (fileState.values || []).length > 0
    ? { file: { [fileState.path]: fileState.values } } : undefined;
  const nullable = !field.notNull && !field.primaryKey && !field.autoIncrement;
  const ruleRate = Number(resolved.rule.nullRate) || 0;
  const setRate = rate => setCurrent(fieldValue(choice.own,
    typeof rate === 'number' ? rate : undefined));
  const editable = choice.canWrite && source !== 'auto'
    && projectRules(ds).some(r => r.id === resolved.rule.id);
  const edit = () => openRuleEditor({
    rule: resolved.rule,
    getDataSource,
    updateDataSource,
    entity,
    field,
    onOk: () => refresh(n => n + 1),
  });
  let note = '';
  if (source === 'domain') {
    const domain = ((ds && ds.domains) || []).find(d => d.id === field.domain);
    note = tr('picker.domainHint', { domain: domain ? (domain.defName || domain.defKey) : '' });
  } else if (source === 'auto') {
    note = tr('picker.autoHint');
  }
  return <div className={`${base}-detail`}>
    <div className={`${base}-form`}>
      <Row base={base} label={tr('picker.column')}>
        <div className={`${base}-detail-column`}>
          {`${entity && entity.defKey ? `${entity.defKey}.` : ''}${field.defKey || ''}`}
          {field.defName && <span>{field.defName}</span>}
        </div>
      </Row>
      <Row base={base} label={tr('picker.rule')} hint={note}>
        <MultipleSelect
          simple
          allowClear={false}
          checkValue={[choice.own]}
          onChange={values => choice.choose(values[0] || '')}
          dropdownRender={menus => <div>{menus}{choice.footer(base)}</div>}
        >
          {choice.options}
        </MultipleSelect>
      </Row>
      <Row base={base} label={tr('picker.effective')}>
        <div className={`${base}-detail-effective`}>
          <span className={`${base}-tag`}>{sourceLabel(tr, source)}</span>
          <span>{ruleSummary(tr, resolved.rule, { dicts: ds.dicts })}</span>
          {editable && <a onClick={edit}>{tr('action.edit')}</a>}
        </div>
      </Row>
      <Row
        base={base}
        label={tr('picker.nullRate')}
        hint={nullable ? tr('picker.nullRateHint') : tr('picker.nullRateOff')}
      >
        {nullable && <div className={`${base}-form-pair ${base}-form-pair-start`}>
          <NumberField
            style={{ width: 90 }}
            value={current && current.nullRate !== undefined ? current.nullRate : ''}
            placeholder={`${ruleRate}`}
            onChange={setRate}
          />
          <span>%</span>
          {(!current || current.nullRate === undefined) && <span className={`${base}-dim`}>
            {tr('picker.nullRateInherit', { rate: ruleRate })}
          </span>}
        </div>}
      </Row>
    </div>
    <RuleSample
      base={base}
      tr={tr}
      rule={resolved.rule}
      dataSource={ds}
      fixed={{ entity, field }}
      target={{}}
      lists={lists}
      nullRate={resolved.nullRate}
    />
  </div>;
});
