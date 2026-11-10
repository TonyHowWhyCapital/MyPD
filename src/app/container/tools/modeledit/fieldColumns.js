import React from 'react';
import { FormatMessage, Select } from 'components';
import { NEW_DOMAIN } from '../../../../components/table/newDomain';
import { EXT_ATTRS } from '../../../../lib/model_edit_util';

const Option = Select.Option;
const STORE_KEY = 'mypd.modelEdit.fieldColumns';
// Always shown: they identify the row or act on it.
const FIXED = ['entity', 'defKey', 'op'];
const DEFAULT_HIDDEN = ['refDict', 'uiHint', 'hideInGraph'].concat(EXT_ATTRS);

export const loadHiddenColumns = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(saved) ? saved : DEFAULT_HIDDEN;
  } catch (e) {
    return DEFAULT_HIDDEN;
  }
};

export const saveHiddenColumns = (hidden) => {
  localStorage.setItem(STORE_KEY, JSON.stringify(hidden));
};

export const isFixedColumn = key => FIXED.includes(key);

const title = id => <span>{FormatMessage.string({ id })}</span>;
const options = (list, value, onChange, extra = []) => (
  // Select flattens only one level of children, so pass a single flat array of Options.
  <Select value={value || ''} onChange={e => onChange(e.target.value)}>
    {list.map(o => <Option key={o.id} value={o.id}>{o.label}</Option>).concat(extra)}
  </Select>
);

// Every attribute of a column, one grid column each. Widths are pixels: the
// grid scrolls sideways once the chosen columns no longer fit.
export const buildFieldColumns = ({
  textCell, checkCell, toLen, change, pickDomain, onDelete,
  domainOptions, dictOptions, uiHintOptions,
}) => {
  const text = (key, id, width, get = r => r[key]) => ({
    key,
    title: title(id),
    width,
    sort: get,
    render: r => textCell(get(r), v => change(r, { [key]: v })),
  });
  const check = (key, id, field) => ({
    key,
    title: title(id),
    width: 50,
    sort: r => !!r[field],
    render: r => checkCell(r[field], v => change(r, { [field]: v })),
  });
  const typed = (key, id, width, get, toValue) => ({
    key,
    title: title(id),
    width,
    sort: get,
    render: r => textCell(get(r), v => change(r, { [key]: toValue(v) }), !!r.domain),
  });
  return [
    {
      key: 'entity',
      title: title('modelEdit.col.table'),
      width: 150,
      sort: r => r.entityKey,
      render: r => <span title={r.entityKey}>{r.entityKey}</span>,
    },
    text('defKey', 'modelEdit.col.key', 130),
    text('defName', 'modelEdit.col.name', 130),
    {
      key: 'domain',
      title: title('modelEdit.col.domain'),
      width: 140,
      sort: r => (domainOptions.find(o => o.id === r.domain) || {}).label,
      render: r => options(domainOptions, r.domain, v => pickDomain(r, v),
        <Option key={NEW_DOMAIN} value={NEW_DOMAIN}>
          {FormatMessage.string({ id: 'modelEdit.newDomainOption' })}
        </Option>),
    },
    typed('type', 'modelEdit.col.type', 100, r => (r.domain ? r.resolvedType : r.type), v => v),
    typed('len', 'modelEdit.col.len', 60, r => r.len, toLen),
    typed('scale', 'modelEdit.col.scale', 60, r => r.scale, toLen),
    check('pk', 'modelEdit.col.pk', 'primaryKey'),
    check('nn', 'modelEdit.col.notNull', 'notNull'),
    check('ai', 'modelEdit.col.autoInc', 'autoIncrement'),
    text('defaultValue', 'tableHeaders.defaultValue', 110),
    text('comment', 'tableHeaders.remark', 180),
    {
      key: 'refDict',
      title: title('tableHeaders.refDict'),
      width: 150,
      sort: r => (dictOptions.find(o => o.id === r.refDict) || {}).label,
      render: r => options(dictOptions, r.refDict, v => change(r, { refDict: v })),
    },
    {
      key: 'uiHint',
      title: title('tableHeaders.uiHint'),
      width: 130,
      sort: r => (uiHintOptions.find(o => o.id === r.uiHint) || {}).label,
      render: r => options(uiHintOptions, r.uiHint, v => change(r, { uiHint: v })),
    },
    {
      key: 'hideInGraph',
      title: title('modelEdit.col.inGraph'),
      width: 70,
      sort: r => !r.hideInGraph,
      render: r => checkCell(!r.hideInGraph, v => change(r, { hideInGraph: !v })),
    },
    ...EXT_ATTRS.map(name => text(name, `config.column.${name}`, 130)),
    { key: 'op', title: title('modelEdit.col.op'), width: 60, render: r => onDelete(r) },
  ];
};
