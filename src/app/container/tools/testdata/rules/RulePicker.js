// RulePicker: shows the rule in force for a column and lets the user change it.
//
// The choices are: automatic (what the domain or the data type gives), a rule of the
// project, a rule of this machine (copied into the project when chosen), a new rule
// (opens the rule editor) and the rule library. The button beside the list opens the
// details of the column: rule, null rate of this column and sample values.
//
// Props
//   field             the column: needs id, domain, notNull, primaryKey, autoIncrement and
//                     what `fieldColumn` reads (type, len, scale, baseType, refDict, defKey)
//   value             what the column stores: {rule?: ruleId, nullRate?: 0..100} or undefined
//   onChange          (value | undefined) => void; undefined means nothing is stored
//                     (remove `field.testData`). The picker never writes the column itself.
//   dataSource        the project, read for the rules, the domain rules and the dictionaries
//   getDataSource     () => the latest project; needed together with updateDataSource
//   updateDataSource  (dataSource) => void, the normal update path of the app. Called when
//                     the picker changes the rule library of the project (a machine rule
//                     copied in, a rule created or edited). Without it the picker only
//                     offers the rules already in the project.
//   entity            optional: the table of the column (formula columns, preview). Looked
//                     up in dataSource by the id of the column when missing.
//   compact           true inside a grid cell: no source label, the list fills the cell
//   disable           read only
import React from 'react';
import {
  MultipleSelect, Icon, Button, openModal, FormatMessage,
} from 'components';
import { getPrefix } from '../../../../../lib/prefixUtil';
import { tr } from './i18n';
import { sourceLabel } from './ruleText';
import { effectiveRule } from './libraryOps';
import { ruleChoice, closeLists } from './ruleChoice';
import FieldRuleDetail from './FieldRuleDetail';
import '../style/index.less';

const RulePicker = React.memo(({
  prefix, field, entity, value, onChange, dataSource, getDataSource, updateDataSource,
  compact, disable,
}) => {
  const base = `${getPrefix(prefix)}-testdata`;
  const ds = dataSource || (getDataSource && getDataSource()) || {};
  const choice = ruleChoice({
    field, entity, value, dataSource: ds, getDataSource, updateDataSource, apply: onChange,
  });
  const resolved = effectiveRule(ds, field, value);
  const openDetail = (e) => {
    e.stopPropagation();
    closeLists();
    const ref = React.createRef();
    let modal;
    const ok = () => {
      onChange && onChange(ref.current.value());
      modal.close();
    };
    modal = openModal(<FieldRuleDetail
      ref={ref}
      prefix={prefix}
      field={field}
      entity={choice.table}
      value={value}
      dataSource={ds}
      getDataSource={getDataSource}
      updateDataSource={updateDataSource}
    />, {
      title: tr('picker.title'),
      bodyStyle: { width: 720 },
      buttons: disable ? [
        <Button key='close' onClick={() => modal.close()}><FormatMessage id='button.close'/></Button>,
      ] : [
        <Button type='primary' key='ok' onClick={ok}><FormatMessage id='button.ok'/></Button>,
        <Button key='cancel' onClick={() => modal.close()}>
          <FormatMessage id='button.cancel'/>
        </Button>],
    });
  };
  const state = choice.own ? 'own' : resolved.source;
  return <div className={`${base}-picker ${base}-picker-${state}${compact
    ? ` ${base}-picker-compact` : ''}`}>
    <MultipleSelect
      simple
      allowClear={false}
      disable={disable}
      checkValue={[choice.own]}
      onChange={values => choice.choose(values[0] || '')}
      dropdownRender={menus => <div>{menus}{choice.footer(base)}</div>}
    >
      {choice.options}
    </MultipleSelect>
    {!compact && <span className={`${base}-picker-source`}>
      {sourceLabel(tr, choice.own ? 'field' : resolved.source)}
    </span>}
    <span className={`${base}-picker-more`} title={tr('picker.more')} onClick={openDetail}>
      <Icon type='fa-ellipsis-h'/>
      {value && value.nullRate !== undefined && <i className={`${base}-picker-dot`}/>}
    </span>
  </div>;
});

export default RulePicker;
