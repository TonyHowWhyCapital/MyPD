// The form of one rule: name, kind, the parameters of that kind, null rate, uniqueness
// and a note, with the problems of the draft and sample values beside it.
//
// Props
//   rule        the draft ({id, name, kind, params, nullRate?, unique?, note?})
//   onChange    (rule) => void, called with the changed draft; nothing is stored here
//   dataSource  the project (dictionaries, tables for the preview and for formulas)
//   rules       the other rules of the library the draft belongs to (names must differ)
//   entity      optional: the table the rule is being edited for (preview, formula columns)
//   field       optional: the column the rule is being edited for
//   showAll     report every problem at once (after a failed save); otherwise an empty
//               name is not reported before the user has typed anything
//   extra       optional node shown under the form (e.g. where the rule is used)
import React, { useEffect, useMemo, useState } from 'react';
import {
  Input, Select, Checkbox, Icon,
} from 'components';
import { getPrefix } from '../../../../../lib/prefixUtil';
import { RULE_KINDS, newRule, numberOf } from '../../../../../lib/testdata/model';
import { tr } from './i18n';
import { problemText, KIND_ICONS } from './ruleText';
import { libraryProblems } from './libraryOps';
import { defaultGenericKind } from './sample';
import useFileList from './useFileList';
import PARAMS from './params';
import { Row, NumberField } from './params/common';
import RuleSample, { targetOf } from './RuleSample';
import '../style/index.less';

const { Option } = Select;

export default React.memo(({
  prefix, rule, onChange, dataSource, rules = [], entity, field, showAll, extra,
}) => {
  const base = `${getPrefix(prefix)}-testdata`;
  const [touched, setTouched] = useState(false);
  // the column the samples are made for; until the user picks one it is the generic
  // column that suits the rule best
  const [chosen, setTarget] = useState(() => ({
    entityId: entity && field ? entity.id : '',
    fieldId: field ? field.id : '',
    generic: '',
  }));
  useEffect(() => {
    setTouched(false);
  }, [rule && rule.id]);
  const target = chosen.generic ? chosen : { ...chosen, generic: defaultGenericKind(rule) };
  const fileState = useFileList(rule);
  const lists = useMemo(() => (fileState.path && fileState.values && fileState.values.length > 0
    ? { file: { [fileState.path]: fileState.values } } : {}), [fileState]);
  if (!rule) {
    return null;
  }
  const change = (next) => {
    setTouched(true);
    onChange && onChange(next);
  };
  const set = (key, value) => change({ ...rule, [key]: value });
  const params = rule.params || {};
  const setParams = next => change({ ...rule, params: next });
  const setParam = (key, value) => setParams({ ...params, [key]: value });
  const setKind = (kind) => {
    if (kind && kind !== rule.kind) {
      change({ ...rule, kind, params: newRule(kind).params });
      setTarget(t => ({ ...t, generic: '' }));
    }
  };
  const setFlag = (key, on) => {
    const { [key]: removed, ...rest } = rule;
    change(on ? { ...rest, [key]: true } : rest);
  };
  const setRate = (value) => {
    const { nullRate, ...rest } = rule;
    change(value === '' || value === 0 ? rest : { ...rest, nullRate: value });
  };
  const problems = libraryProblems(rule, rules)
    .filter(code => showAll || touched || code !== 'rule.name.empty')
    // a formula shows what is wrong with it under its own box
    .filter(code => rule.kind !== 'expr' || !code.startsWith('expr.') || code === 'expr.empty');
  const Params = PARAMS[rule.kind] || PARAMS.auto;
  const picked = targetOf(dataSource, target);
  return <div className={`${base}-editor`}>
    <div className={`${base}-form`}>
      <Row base={base} label={tr('editor.name')}>
        <Input
          maxLength={200}
          placeholder={tr('editor.namePlaceholder')}
          value={rule.name || ''}
          onChange={e => set('name', e.target.value)}
        />
      </Row>
      <Row base={base} label={tr('editor.kind')} hint={tr(`kindHint.${rule.kind}`)}>
        <Select
          notAllowEmpty
          allowClear={false}
          value={rule.kind}
          onChange={e => setKind(e.target.value)}
        >
          {RULE_KINDS.map(k => <Option key={k} value={k}>{tr(`kind.${k}`)}</Option>)}
        </Select>
      </Row>
      <Params
        base={base}
        tr={tr}
        params={params}
        set={setParam}
        setParams={setParams}
        dataSource={dataSource}
        entity={picked.entity || entity}
        field={picked.field || field}
        fileState={fileState}
      />
      <div className={`${base}-form-line`}/>
      <Row base={base} label={tr('editor.nullRate')} hint={tr('editor.nullRateHint')}>
        <div className={`${base}-form-pair ${base}-form-pair-start`}>
          <NumberField
            style={{ width: 90 }}
            value={numberOf(rule.nullRate) === undefined ? 0 : rule.nullRate}
            onChange={setRate}
          />
          <span>%</span>
          <Checkbox
            checked={!!rule.unique}
            onChange={e => setFlag('unique', e.target.checked)}
          >
            <span title={tr('editor.uniqueHint')}>{tr('editor.unique')}</span>
          </Checkbox>
        </div>
      </Row>
      <Row base={base} label={tr('editor.note')}>
        <Input
          value={rule.note || ''}
          onChange={e => set('note', e.target.value)}
        />
      </Row>
      {problems.length > 0 && <div className={`${base}-problems`}>
        <div className={`${base}-problems-title`}>
          <Icon type='fa-exclamation-circle'/>{tr('editor.problems')}
        </div>
        {problems.map(code => <div key={code}>{problemText(tr, code)}</div>)}
      </div>}
      {extra}
    </div>
    <RuleSample
      base={base}
      tr={tr}
      rule={rule}
      dataSource={dataSource}
      target={target}
      onTargetChange={setTarget}
      lists={lists}
      nullRate={rule.nullRate}
    />
  </div>;
});

export { KIND_ICONS };
