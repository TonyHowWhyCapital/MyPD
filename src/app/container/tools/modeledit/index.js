import React, { useMemo, useRef, useState } from 'react';
import { FormatMessage, Input, Select, Checkbox, Button, Message, Modal } from 'components';

import './style/index.less';
import { getPrefix } from '../../../../lib/prefixUtil';
import { NEW_DOMAIN, openNewDomain } from '../../../../components/table/newDomain';
import { useColumnWidths } from '../../../../components/gridview';
import {
  buildFieldColumns, isFixedColumn, loadHiddenColumns, saveHiddenColumns,
  loadColumnOrders, saveColumnOrders,
} from './fieldColumns';
import {
  getTableRows, getColumnRows, getDomainRows, getTypeOptions,
  updateTable, updateColumn, addColumn, removeTables, removeColumns,
  updateDomain, addDomain, removeDomains, toggleSort, sortRows, orderColumns, moveColumn,
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
const named = d => ({ id: d.id, label: d.defName || d.defKey });
const toLen = v => (v === '' ? '' : (parseInt(v, 10) || ''));

export default React.memo(({ dataSource, updateDataSource, prefix }) => {
  const currentPrefix = getPrefix(prefix);
  const [ds, setDs] = useState(dataSource);
  const [tab, setTab] = useState('entity');
  const [keyword, setKeyword] = useState('');
  const [pendingEntity, setPendingEntity] = useState('');
  const [sorts, setSorts] = useState([]);
  const [hidden, setHidden] = useState(loadHiddenColumns);
  const [choosing, setChoosing] = useState(false);
  const [orders, setOrders] = useState(loadColumnOrders);
  const sizes = useColumnWidths(`modelEdit.${tab}`);
  const dragRef = useRef({ key: '', keys: [] });
  const changeOrders = (next) => {
    setOrders(next);
    saveColumnOrders(next);
  };
  // Puts a tab's columns in the order the user dragged them into.
  const arrange = (cols) => {
    const keys = orderColumns(cols.map(c => c.key), orders[tab]);
    dragRef.current.keys = keys;
    return keys.map(k => cols.find(c => c.key === k));
  };
  const dropColumn = (target) => {
    const { key, keys } = dragRef.current;
    const next = moveColumn(keys, key, target);
    if (next !== keys) {
      changeOrders({ ...orders, [tab]: next });
    }
    dragRef.current.key = '';
  };
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
        <a onClick={sizes.fitAll}><FormatMessage id='gridView.fitAll'/></a>
        {sizes.customized && <a onClick={sizes.reset}><FormatMessage id='gridView.resetWidths'/></a>}
        {(orders[tab] || []).length > 0
          && <a onClick={() => changeOrders({ ...orders, [tab]: [] })}>
            <FormatMessage id='modelEdit.resetOrder'/>
          </a>}
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
      <table
        ref={sizes.tableRef}
        style={sizes.customized ? sizes.tableStyle(cols.map(c => c.key))
          : { minWidth: cols.reduce((sum, c) => sum + (typeof c.width === 'number' ? c.width : 0), 0) }}
      >
        <thead>
          <tr>{cols.map(c => (
            <th
              key={c.key}
              {...sizes.headerProps(c.key)}
              style={{ width: sizes.customized ? (sizes.widths[c.key] || 120) : c.width }}
              className={c.sort ? 'sortable' : ''}
              onClick={() => c.sort && setSorts(toggleSort(sorts, c.key))}
              draggable
              onDragStart={(e) => {
                dragRef.current.key = c.key;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', c.key);
              }}
              onDragOver={e => dragRef.current.key && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                dropColumn(c.key);
              }}
            >{c.title}{sortMark(c.key)}{sizes.handle(c.key, prefix)}</th>))}
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
    const cols = arrange([
      { key: 'defKey', sort: r => r.defKey, title: label('modelEdit.col.key'), width: '22%', render: r => textCell(r.defKey, v => persist(updateTable(ds, r.id, { defKey: v }))) },
      { key: 'defName', sort: r => r.defName, title: label('modelEdit.col.name'), width: '22%', render: r => textCell(r.defName, v => persist(updateTable(ds, r.id, { defName: v }))) },
      { key: 'comment', sort: r => r.comment, title: label('modelEdit.col.comment'), width: '34%', render: r => textCell(r.comment, v => persist(updateTable(ds, r.id, { comment: v }))) },
      { key: 'count', sort: r => r.fieldCount, title: label('modelEdit.col.fieldCount'), width: '10%', render: r => <span>{r.fieldCount}</span> },
      { key: 'op', title: label('modelEdit.col.op'), width: '12%', render: r => del(() => confirmRemove(FormatMessage.string({ id: 'modelEdit.deleteTable', data: { name: r.defKey } }), () => persist(removeTables(ds, [r.id])))) },
    ]);
    return <div className={`${currentPrefix}-modeledit`}>{header()}{grid(cols, rows, r => r.id)}</div>;
  }

  if (tab === 'field') {
    const rows = getColumnRows(ds).filter(r => match(r, ['entityKey', 'defKey', 'defName', 'resolvedType', 'comment', 'defaultValue']));
    const change = (r, patch) => persist(updateColumn(ds, r.entityId, r.id, patch));
    const pickDomain = (r, value) => {
      if (value !== NEW_DOMAIN) {
        change(r, { domain: value });
        return;
      }
      const field = (ds.entities || []).find(e => e.id === r.entityId)?.fields
        .find(f => f.id === r.id);
      let latest = ds;
      openNewDomain({
        field,
        getDataSource: () => latest,
        updateDataSource: (next) => {
          latest = next;
        },
        onCreated: domain => persist(updateColumn(latest, r.entityId, r.id, { domain: domain.id })),
      });
    };
    const allCols = buildFieldColumns({
      textCell,
      checkCell,
      toLen,
      change,
      pickDomain,
      onDelete: r => del(() => confirmRemove(`${r.defKey || ''}`, () => persist(removeColumns(ds,
        [{ entityId: r.entityId, fieldId: r.id }])))),
      domainOptions,
      dictOptions: (ds.dicts || []).map(named),
      uiHintOptions: (ds.profile?.uiHint || []).map(named),
    });
    const cols = arrange(allCols).filter(c => !hidden.includes(c.key));
    const toggleColumn = (key) => {
      const next = hidden.includes(key) ? hidden.filter(k => k !== key) : hidden.concat(key);
      setHidden(next);
      saveHiddenColumns(next);
    };
    const chooser = choosing ? (
      <div className={`${currentPrefix}-modeledit-chooser`}>
        {allCols.filter(c => !isFixedColumn(c.key)).map(c => (
          <span key={c.key} onClick={() => toggleColumn(c.key)}>
            <Checkbox checked={!hidden.includes(c.key)} onChange={() => {}}/>
            {c.title}
          </span>))}
      </div>
    ) : null;
    const selected = pendingEntity || entityOptions[0]?.id || '';
    const addBtn = entityOptions.length > 0 ? (
      <span className={`${currentPrefix}-modeledit-add`}>
        <Button onClick={() => setChoosing(!choosing)}><FormatMessage id='modelEdit.chooseColumns'/></Button>
        <Select value={selected} onChange={e => setPendingEntity(e.target.value)}>
          {entityOptions.map(o => <Option key={o.id} value={o.id}>{o.label}</Option>)}
        </Select>
        <Button onClick={() => {
          persist(addColumn(ds, selected).next);
          Message.success({ title: FormatMessage.string({ id: 'modelEdit.added' }) });
        }}><FormatMessage id='modelEdit.addColumn'/></Button>
      </span>
    ) : null;
    return <div className={`${currentPrefix}-modeledit`}>{header(addBtn)}{chooser}{grid(cols, rows, r => `${r.entityId}:${r.id}`)}</div>;
  }

  const rows = getDomainRows(ds).filter(r => match(r, ['defKey', 'defName', 'applyForName']));
  const change = (r, patch) => persist(updateDomain(ds, r.id, patch));
  const cols = arrange([
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
        confirmRemove(`${r.defKey || ''}`, () => persist(result.next));
      }),
    },
  ]);
  const addBtn = (
    <Button className={`${currentPrefix}-modeledit-add`} onClick={() => persist(addDomain(ds).next)}>
      <FormatMessage id='modelEdit.addDomain'/>
    </Button>
  );
  return <div className={`${currentPrefix}-modeledit`}>{header(addBtn)}{grid(cols, rows, r => r.id)}</div>;
});
