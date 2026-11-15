// Parameters of the rule kinds that are a handful of fields.
import React from 'react';
import {
  Row, NumberField, TextField, Choice,
} from './common';

const CHARSETS = ['alnum', 'alpha', 'digit', 'zh', 'hex'];
const DATE_QUICK = [
  ['now-365d', 'now'], ['now-30d', 'now'], ['now', 'now+30d'], ['2024-01-01', '2024-12-31'],
];

export const AutoParams = () => null;

export const SequenceParams = ({ base, tr, params, set }) => (
  <React.Fragment>
    <Row base={base} label={tr('param.start')}>
      <div className={`${base}-form-pair`}>
        <NumberField value={params.start} onChange={v => set('start', v)}/>
        <span>{tr('param.step')}</span>
        <NumberField value={params.step} onChange={v => set('step', v)}/>
      </div>
    </Row>
    <Row base={base} label={tr('param.prefix')}>
      <div className={`${base}-form-pair`}>
        <TextField value={params.prefix} onChange={v => set('prefix', v)}/>
        <span>{tr('param.suffix')}</span>
        <TextField value={params.suffix} onChange={v => set('suffix', v)}/>
      </div>
    </Row>
    <Row base={base} label={tr('param.pad')} hint={tr('hint.sequence')}>
      <NumberField
        style={{ width: 120 }}
        value={params.pad}
        onChange={v => set('pad', v)}
      />
    </Row>
  </React.Fragment>
);

export const NumberParams = ({ base, tr, params, set }) => (
  <React.Fragment>
    <Row base={base} label={tr('param.min')}>
      <div className={`${base}-form-pair`}>
        <NumberField value={params.min} onChange={v => set('min', v)}/>
        <span>{tr('param.max')}</span>
        <NumberField value={params.max} onChange={v => set('max', v)}/>
      </div>
    </Row>
    <Row base={base} label={tr('param.decimals')} hint={tr('hint.number')}>
      <NumberField
        style={{ width: 120 }}
        value={params.decimals}
        onChange={v => set('decimals', v)}
      />
    </Row>
  </React.Fragment>
);

export const DateParams = ({
  base, tr, params, set, setParams,
}) => (
  <React.Fragment>
    <Row base={base} label={tr('param.from')}>
      <div className={`${base}-form-pair`}>
        <TextField value={params.from} placeholder='now-365d' onChange={v => set('from', v)}/>
        <span>{tr('param.to')}</span>
        <TextField value={params.to} placeholder='now' onChange={v => set('to', v)}/>
      </div>
    </Row>
    <Row base={base} label={tr('hint.dateQuick')} hint={tr('hint.date')}>
      <div className={`${base}-chips`}>
        {DATE_QUICK.map(([from, to]) => (
          <span
            key={`${from}${to}`}
            className={`${base}-chip${params.from === from && params.to === to
              ? ` ${base}-chip-list-item-active` : ''}`}
            onClick={() => setParams({ ...params, from, to })}
          >{`${from} ~ ${to}`}
          </span>))}
      </div>
    </Row>
  </React.Fragment>
);

export const TextParams = ({ base, tr, params, set }) => (
  <React.Fragment>
    <Row base={base} label={tr('param.minLength')}>
      <div className={`${base}-form-pair`}>
        <NumberField value={params.min} onChange={v => set('min', v)}/>
        <span>{tr('param.maxLength')}</span>
        <NumberField value={params.max} onChange={v => set('max', v)}/>
      </div>
    </Row>
    <Row base={base} label={tr('param.charset')} hint={tr('hint.text')}>
      <Choice
        value={params.charset || 'alnum'}
        options={CHARSETS.map(c => ({ value: c, label: tr(`charset.${c}`) }))}
        onChange={v => set('charset', v)}
      />
    </Row>
  </React.Fragment>
);

export const PatternParams = ({ base, tr, params, set }) => (
  <Row
    base={base}
    label={tr('param.mask')}
    hint={<span>{tr('hint.pattern')}<br/>{tr('hint.patternExample')}</span>}
  >
    <TextField value={params.mask} placeholder='A-####' onChange={v => set('mask', v)}/>
  </Row>
);

export const DictParams = ({
  base, tr, params, setParams, dataSource,
}) => {
  const dicts = (dataSource && dataSource.dicts) || [];
  const options = [{ value: '', label: tr('hint.dictOfColumn') }]
    .concat(dicts.map(d => ({ value: d.id, label: `${d.defKey}(${d.defName || d.defKey})` })));
  const change = (id) => {
    const { dict, ...rest } = params;
    setParams(id ? { ...rest, dict: id } : rest);
  };
  return <React.Fragment>
    <Row base={base} label={tr('param.dict')} hint={tr('hint.dict')}>
      <Choice value={params.dict || ''} options={options} onChange={change}/>
    </Row>
    <Row base={base} label={tr('param.dictUse')}>
      <Choice
        value={params.use === 'name' ? 'name' : 'key'}
        options={['key', 'name'].map(u => ({ value: u, label: tr(`dictUse.${u}`) }))}
        onChange={v => setParams({ ...params, use: v })}
      />
    </Row>
  </React.Fragment>;
};

export const ConstantParams = ({ base, tr, params, set }) => (
  <Row base={base} label={tr('param.value')} hint={tr('hint.constant')}>
    <TextField value={params.value} onChange={v => set('value', v)}/>
  </Row>
);
