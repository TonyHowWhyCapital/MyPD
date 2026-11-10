import React, { useMemo, useRef, useState } from 'react';
import { FormatMessage, Input, Select, Checkbox, Button, Message, Modal } from 'components';

import './style/index.less';
import { getPrefix } from '../../../../lib/prefixUtil';
import {
  getTableRows, getColumnRows, getDomainRows, getTypeOptions,
  updateTable, updateColumn, addColumn, removeTables, removeColumns,
  updateDomain, addDomain, removeDomains, toggleSort, sortRows,
} from '../../../../lib/model_edit_util';

const Option = Select.Option;
const TABS = ['entity', 'field', 'domain'];

const textCell = (value, onChange, disabled) => (
  <Input
    value={value === undefined || value === null ? '' : `${value}`}
    disable={disabled}
    onChange={e => onChange(e.target.value)}
  />
);
const checkCell = (value, onChange) => (
  <Checkbox checked={!!value} onChange={e => onChange(e.target.checked)}/>
);
const toLen = v => (v === '' ? '' : (parseInt(v, 10) || ''));

export default React.memo(({ dataSource, updateDataSource, prefix }) => {
  const currentPrefix = getPrefix(prefix);
  const [ds, setDs] = useState(dataSource);
  const [tab, setTab] = useState('entity');
  const [keyword, setKeyword] = useState('');
  const [pendingEntity, setPendingEntity] = useState('');
  const [sorts, setSorts] = useState([]);
  // Row order is frozen until the sort or filter changes, so a row does not
  // jump away while its sorted cell is being edited.
  const orderRef = useRef({ signature: '', keys: [] });
  const persist = (next) => {
    setDs(next);
    updateDataSource && updateDataSource(next);
  };
  const typeOptions = useMemo(() => getTypeOptions(ds), [ds]);
  const domainOptions = (ds.domains || [])
    .map(d => ({ id: d.id, label: `${d.defKey}${d.defName ? `(${d.defName})` : ''}` }));
  const entityOptions = (ds.entities || [])
    .map(e => ({ id: e.id, label: `${e.defKey}${e.defName ? `(${e.defName})` : ''}` }));

  const match = (row, keys) => {
    const text = keyword.trim().toLowerCase();
    return !text || keys.some(k => `${row[k] || ''}`.toLowerCase().includes(text));
  };
  const label = id => <span>{FormatMessage.string({ id })}</span>;
  const del = onClick => <a onClick={onClick}><FormatMessage id='modelEdit.delete'/></a>;
  const confirmRemove = (message, onOk) => Modal.confirm({
    title: FormatMessage.string({ id: 'modelEdit.confirmDelete' }), message, onOk,
  });

  const header = extra => (
    <div className={`${currentPrefix}-modeledit-head`}>
      <span className={`${currentPrefix}-modeledit-seg`}>
        {TABS.map(t => (
          <span
            key={t}
            className={`${currentPrefix}-modeledit-seg-item${tab === t ? ' active' : ''}`}
            onClick={() => { setTab(t); setKeyword(''); setSorts([]); }}
          >
            <FormatMessage id={`modelEdit.tab.${t}`}/>
          </span>))}
      </span>
      <Input
        placeholder={FormatMessage.string({ id: 'modelEdit.search' })}
        value={keyword}
        onChange={e => setKeyword(e.target.value)}
        className={`${currentPrefix}-modeledit-search`}
      />
      <span className={`${currentPrefix}-modeledit-hint`}>
        <FormatMessage id='modelEdit.sortHint'/>
        {sorts.length > 0 && <a onClick={() => setSorts([])}><FormatMessage id='modelEdit.clearSort'/></a>}
      </span>
      {extra}
    </div>
  );

  const sortMark = (key) => {
    const index = sorts.findIndex(s => s.key === key);
    if (index < 0) {
      return null;
    }
    return <span className={`${currentPrefix}-modeledit-sort`}>
      {sorts[index].dir === 'asc' ? '▲' : '▼'}{sorts.length > 1 ? index + 1 : ''}
    </span>;
  };
  const ordered = (cols, rows, keyFn) => {
    if (sorts.length === 0) {
      return rows;
    }
    const signature = `${tab}|${keyword}|${JSON.stringify(sorts)}`;
    if (orderRef.current.signature !== signature) {
      const getters = cols.reduce((all, c) => ({ ...all, [c.key]: c.sort }), {});
      orderRef.current = { signature, keys: sortRows(rows, sorts, getters).map(keyFn) };
    }
    const position = new Map(orderRef.current.keys.map((k, i) => [k, i]));
    const at = row => (position.has(keyFn(row)) ? position.get(keyFn(row)) : Infinity);
    return rows.map((row, index) => ({ row, index }))
      .sort((a, b) => (at(a.row) - at(b.row)) || (a.index - b.index))
      .map(item => item.row);
  };
  const grid = (cols, rows, keyFn) => (
    <div className={`${currentPrefix}-modeledit-grid`}>
      <table>
        <thead>
          <tr>{cols.map(c => (
            <th
              key={c.key}
              style={{ width: c.width }}
              className={c.sort ? 'sortable' : ''}
              onClick={() => c.sort && setSorts(toggleSort(sorts, c.key))}
            >{c.title}{sortMark(c.key)}</th>))}
          </tr>
        </thead>
        <tbody>
          {ordered(cols, rows, keyFn).map(row => (
            <tr key={keyFn(row)}>{cols.map(c => <td key={c.key}>{c.render(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className={`${currentPrefix}-modeledit-empty`}>
        <FormatMessage id='modelEdit.empty'/>
      </div>}
    </div>
  );

  if (tab === 'entity') {
    const rows = getTableRows(ds).filter(r => match(r, ['defKey', 'defName', 'comment']));
    const cols = [
      { key: 'defKey', sort: r => r.defKey, title: label('modelEdit.col.key'), width: '22%', render: r => textCell(r.defKey, v => persist(updateTable(ds, r.id, { defKey: v }))) },
      { key: 'defName', sort: r => r.defName, title: label('modelEdit.col.name'), width: '22%', render: r => textCell(r.defName, v => persist(updateTable(ds, r.id, { defName: v }))) },
      { key: 'comment', sort: r => r.comment, title: label('modelEdit.col.comment'), width: '34%', render: r => textCell(r.comment, v => persist(updateTable(ds, r.id, { comment: v }))) },
      { key: 'count', sort: r => r.fieldCount, title: label('modelEdit.col.fieldCount'), width: '10%', render: r => <span>{r.fieldCount}</span> },
      { key: 'op', title: label('modelEdit.col.op'), width: '12%', render: r => del(() => confirmRemove(FormatMessage.string({ id: 'modelEdit.deleteTable', data: { name: r.defKey } }), () => persist(removeTables(ds, [r.id])))) },
    ];
    return <div className={`${currentPrefix}-modeledit`}>{header()}{grid(cols, rows, r => r.id)}</div>;
  }

  if (tab === 'field') {
    const rows = getColumnRows(ds).filter(r => match(r, ['entityKey', 'defKey', 'defName', 'resolvedType', 'comment']));
    const change = (r, patch) => persist(updateColumn(ds, r.entityId, r.id, patch));
    const cols = [
      { key: 'entity', sort: r => r.entityKey, title: label('modelEdit.col.table'), width: '13%', render: r => <span title={r.entityKey}>{r.entityKey}</span> },
      { key: 'defKey', sort: r => r.defKey, title: label('modelEdit.col.key'), width: '12%', render: r => textCell(r.defKey, v => change(r, { defKey: v })) },
      { key: 'defName', sort: r => r.defName, title: label('modelEdit.col.name'), width: '12%', render: r => textCell(r.defName, v => change(r, { defName: v })) },
      {
        key: 'domain',
        sort: r => (domainOptions.find(o => o.id === r.domain) || {}).label,
        title: label('modelEdit.col.domain'),
        width: '13%',
        render: r => (
          // Select flattens only one level of children, so pass a single flat array of Options.
          <Select value={r.domain || ''} onChange={e => change(r, { domain: e.target.value })}>
            {[<Option key='' value=''>{FormatMessage.string({ id: 'modelEdit.noDomain' })}</Option>]
              .concat(domainOptions.map(o => <Option key={o.id} value={o.id}>{o.label}</Option>))}
          </Select>),
      },
      { key: 'type', sort: r => (r.domain ? r.resolvedType : r.type), title: label('modelEdit.col.type'), width: '11%', render: r => textCell(r.domain ? r.resolvedType : r.type, v => change(r, { type: v }), !!r.domain) },
      { key: 'len', sort: r => r.len, title: label('modelEdit.col.len'), width: '7%', render: r => textCell(r.len, v => change(r, { len: toLen(v) }), !!r.domain) },
      { key: 'scale', sort: r => r.scale, title: label('modelEdit.col.scale'), width: '7%', render: r => textCell(r.scale, v => change(r, { scale: toLen(v) }), !!r.domain) },
      { key: 'pk', sort: r => !!r.primaryKey, title: label('modelEdit.col.pk'), width: '5%', render: r => checkCell(r.primaryKey, v => change(r, { primaryKey: v })) },
      { key: 'nn', sort: r => !!r.notNull, title: label('modelEdit.col.notNull'), width: '5%', render: r => checkCell(r.notNull, v => change(r, { notNull: v })) },
      { key: 'ai', sort: r => !!r.autoIncrement, title: label('modelEdit.col.autoInc'), width: '5%', render: r => checkCell(r.autoIncrement, v => change(r, { autoIncrement: v })) },
      { key: 'op', title: label('modelEdit.col.op'), width: '8%', render: r => del(() => persist(removeColumns(ds, [{ entityId: r.entityId, fieldId: r.id }]))) },
    ];
    const selected = pendingEntity || entityOptions[0]?.id || '';
    const addBtn = entityOptions.length > 0 ? (
      <span className={`${currentPrefix}-modeledit-add`}>
        <Select value={selected} onChange={e => setPendingEntity(e.target.value)}>
          {entityOptions.map(o => <Option key={o.id} value={o.id}>{o.label}</Option>)}
        </Select>
        <Button onClick={() => {
          persist(addColumn(ds, selected).next);
          Message.success({ title: FormatMessage.string({ id: 'modelEdit.added' }) });
        }}><FormatMessage id='modelEdit.addColumn'/></Button>
      </span>
    ) : null;
    return <div className={`${currentPrefix}-modeledit`}>{header(addBtn)}{grid(cols, rows, r => `${r.entityId}:${r.id}`)}</div>;
  }

  const rows = getDomainRows(ds).filter(r => match(r, ['defKey', 'defName', 'applyForName']));
  const change = (r, patch) => persist(updateDomain(ds, r.id, patch));
  const cols = [
    { key: 'defKey', sort: r => r.defKey, title: label('modelEdit.col.key'), width: '20%', render: r => textCell(r.defKey, v => change(r, { defKey: v })) },
    { key: 'defName', sort: r => r.defName, title: label('modelEdit.col.name'), width: '20%', render: r => textCell(r.defName, v => change(r, { defName: v })) },
    {
      key: 'applyFor',
      sort: r => (typeOptions.find(o => o.id === r.applyFor) || {}).label,
      title: label('modelEdit.col.type'),
      width: '26%',
      render: r => (
        <Select value={r.applyFor || ''} onChange={e => change(r, { applyFor: e.target.value })}>
          {typeOptions.map(o => <Option key={o.id} value={o.id}>{o.label}</Option>)}
        </Select>),
    },
    { key: 'len', sort: r => r.len, title: label('modelEdit.col.len'), width: '12%', render: r => textCell(r.len, v => change(r, { len: toLen(v) })) },
    { key: 'scale', sort: r => r.scale, title: label('modelEdit.col.scale'), width: '12%', render: r => textCell(r.scale, v => change(r, { scale: toLen(v) })) },
    {
      key: 'op',
      title: label('modelEdit.col.op'),
      width: '10%',
      render: r => del(() => {
        const result = removeDomains(ds, [r.id]);
        if (result.blocked.length > 0) {
          Modal.error({
            title: FormatMessage.string({ id: 'optFail' }),
            message: FormatMessage.string({ id: 'modelEdit.domainInUse' }),
          });
          return;
        }
        persist(result.next);
      }),
    },
  ];
  const addBtn = (
    <Button className={`${currentPrefix}-modeledit-add`} onClick={() => persist(addDomain(ds).next)}>
      <FormatMessage id='modelEdit.addDomain'/>
    </Button>
  );
  return <div className={`${currentPrefix}-modeledit`}>{header(addBtn)}{grid(cols, rows, r => r.id)}</div>;
});
