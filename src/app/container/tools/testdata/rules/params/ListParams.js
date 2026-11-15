// The values of a `list` rule: a small grid of value and weight. Several lines pasted
// into a value are taken as several values.
import React from 'react';
import { Icon } from 'components';
import { Row, Choice, numberOrText } from './common';

const SHOWN = 200;
const MAX_ITEMS = 10000;

const normal = items => (Array.isArray(items) ? items : [])
  .map(item => (item !== null && typeof item === 'object' ? item : { value: item }));

// "value<Tab>weight" or "value,weight" per line; a line without a weight counts as 1
export const parseListLines = text => `${text || ''}`.split(/\r?\n/)
  .map(line => line.replace(/\s+$/, ''))
  .filter(line => line.trim() !== '')
  .map((line) => {
    const tab = line.indexOf('\t');
    let value = line;
    let weight = 1;
    if (tab >= 0) {
      value = line.slice(0, tab);
      weight = numberOrText(line.slice(tab + 1).split('\t')[0]);
    } else {
      const found = /^(.*),\s*(\d+(?:\.\d+)?)$/.exec(line);
      if (found) {
        value = found[1];
        weight = Number(found[2]);
      }
    }
    return { value: value.trim(), weight: weight === '' ? 1 : weight };
  });

export default ({
  base, tr, params, setParams,
}) => {
  const items = normal(params.items);
  const setItems = next => setParams({ ...params, items: next.slice(0, MAX_ITEMS) });
  const change = (index, key, value) => setItems(items.map((item, i) => (i === index
    ? { ...item, [key]: value } : item)));
  const onPaste = (e, index) => {
    const text = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (!/[\r\n\t]/.test(text)) {
      return; // a plain word goes into the box as usual
    }
    e.preventDefault();
    const pasted = parseListLines(text);
    const current = items[index];
    const keep = current && `${current.value === undefined ? '' : current.value}` !== '';
    setItems(items.slice(0, keep ? index + 1 : index).concat(pasted, items.slice(index + 1)));
  };
  const onKeyDown = (e, index) => {
    if (e.key === 'Enter' && index === items.length - 1) {
      setItems(items.concat({ value: '', weight: 1 }));
    }
  };
  return <React.Fragment>
    <Row base={base} label={tr('param.items')} hint={tr('hint.list')} wide>
      <div className={`${base}-items`}>
        <table>
          <thead>
            <tr>
              <th>{tr('param.itemValue')}</th>
              <th>{tr('param.itemWeight')}</th>
              <th/>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, SHOWN).map((item, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={index}>
                <td>
                  <input
                    value={item.value === undefined || item.value === null ? '' : `${item.value}`}
                    placeholder={index === 0 ? tr('hint.listPaste') : ''}
                    onChange={e => change(index, 'value', e.target.value)}
                    onPaste={e => onPaste(e, index)}
                    onKeyDown={e => onKeyDown(e, index)}
                  />
                </td>
                <td>
                  <input
                    value={item.weight === undefined || item.weight === null ? '' : `${item.weight}`}
                    placeholder='1'
                    onChange={e => change(index, 'weight', numberOrText(e.target.value))}
                  />
                </td>
                <td>
                  <Icon
                    type='fa-times'
                    title={tr('action.removeItem')}
                    onClick={() => setItems(items.filter((it, i) => i !== index))}
                  />
                </td>
              </tr>))}
          </tbody>
        </table>
        {items.length > SHOWN && <div className={`${base}-form-hint`}>
          {tr('summary.listMore', { values: '', count: items.length })}
        </div>}
        <div className={`${base}-items-opt`}>
          <a onClick={() => setItems(items.concat({ value: '', weight: 1 }))}>
            <Icon type='fa-plus'/>{tr('action.addItem')}
          </a>
          {items.length > 0 && <a onClick={() => setItems([])}>{tr('action.clearItems')}</a>}
        </div>
      </div>
    </Row>
    <Row base={base} label={tr('param.order')}>
      <Choice
        value={params.order === 'cycle' ? 'cycle' : 'random'}
        options={['random', 'cycle'].map(o => ({ value: o, label: tr(`order.${o}`) }))}
        onChange={v => setParams({ ...params, order: v })}
      />
    </Row>
  </React.Fragment>;
};
