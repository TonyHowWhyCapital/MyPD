import React, { useEffect, useMemo, useRef, useState } from 'react';
import FormatMessage from '../formatmessage';
import {
  loadGridView, saveGridView, moveColumn, orderColumns, sortRows, toggleSort,
} from '../../lib/grid_util';
import { getPrefix } from '../../lib/prefixUtil';
import { useColumnWidths } from './widths';
import './style/index.less';

export { useColumnWidths };

// View state for one grid: which columns show, in what order, and the current
// multi-column sort. Visibility and order are remembered per `gridId`.
export const useGridView = (gridId, { defaultHidden = [] } = {}) => {
  const [views, setViews] = useState({});
  const [sorts, setSorts] = useState([]);
  const frozen = useRef({ signature: '', keys: [] });
  const dragging = useRef('');
  const saved = useMemo(() => loadGridView(gridId, defaultHidden), [gridId]);
  const view = views[gridId] || saved;
  useEffect(() => {
    setSorts([]);
  }, [gridId]);
  const update = (next) => {
    saveGridView(gridId, next);
    setViews(all => ({ ...all, [gridId]: next }));
  };
  const arrange = keys => orderColumns(keys, view.order);
  // Sorted rows keep their position until the sort or `signature` changes, so
  // a row does not jump away while its sorted cell is being edited.
  const sortFrozen = (rows, getters, keyFn, signature = '') => {
    if (sorts.length === 0) {
      return rows;
    }
    const full = `${gridId}|${signature}|${JSON.stringify(sorts)}`;
    if (frozen.current.signature !== full) {
      frozen.current = { signature: full, keys: sortRows(rows, sorts, getters).map(keyFn) };
    }
    const position = new Map(frozen.current.keys.map((k, i) => [k, i]));
    const at = row => (position.has(keyFn(row)) ? position.get(keyFn(row)) : Infinity);
    return rows.map((row, index) => ({ row, index }))
      .sort((a, b) => (at(a.row) - at(b.row)) || (a.index - b.index))
      .map(item => item.row);
  };
  // Props that make a header cell a drag source and drop target. `allKeys` is
  // every column of the grid in its current order, hidden ones included.
  const dragProps = (key, allKeys) => ({
    draggable: true,
    onDragStart: (e) => {
      dragging.current = key;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
    },
    onDragOver: e => dragging.current && e.preventDefault(),
    onDrop: (e) => {
      e.preventDefault();
      const next = moveColumn(allKeys, dragging.current, key);
      dragging.current = '';
      if (next !== allKeys) {
        update({ ...view, order: next });
      }
    },
  });
  return {
    hidden: view.hidden,
    order: view.order,
    setOrder: order => update({ ...view, order }),
    sorts,
    setSorts,
    clearSort: () => setSorts(current => (current.length > 0 ? [] : current)),
    toggleSort: key => setSorts(toggleSort(sorts, key)),
    toggleHidden: key => update({
      ...view,
      hidden: view.hidden.includes(key)
        ? view.hidden.filter(k => k !== key) : view.hidden.concat(key),
    }),
    isCustom: view.order.length > 0 || view.hidden.length !== defaultHidden.length
      || view.hidden.some(k => !defaultHidden.includes(k)),
    reset: () => update({ hidden: defaultHidden, order: [] }),
    arrange,
    sortFrozen,
    dragProps,
  };
};

// Sort indicator for a header. Clicking cycles ascending, descending, off.
export const SortMark = React.memo(({ prefix, sorts, columnKey, onToggle }) => {
  const currentPrefix = getPrefix(prefix);
  const index = sorts.findIndex(s => s.key === columnKey);
  const active = index >= 0;
  return <span
    className={`${currentPrefix}-gridview-sort${active ? ' active' : ''}`}
    title={FormatMessage.string({ id: 'gridView.sortTip' })}
    onClick={(e) => {
      e.stopPropagation();
      onToggle(columnKey);
    }}
  >
    {active ? `${sorts[index].dir === 'asc' ? '▲' : '▼'}${sorts.length > 1 ? index + 1 : ''}` : '⇅'}
  </span>;
});

// Checkbox list choosing which columns show. columns: [{ key, title, fixed }].
export const ColumnChooser = React.memo(({ prefix, columns, hidden, onToggle }) => {
  const currentPrefix = getPrefix(prefix);
  return <div className={`${currentPrefix}-gridview-chooser`}>
    {columns.filter(c => !c.fixed).map(c => (
      <span key={c.key} onClick={() => onToggle(c.key)}>
        <input type='checkbox' readOnly checked={!hidden.includes(c.key)}/>
        {c.title}
      </span>))}
  </div>;
});

// A plain table with the shared view features. columns: [{ key, title, render,
// sort (value getter, omit for unsortable), fixed (always shown, not movable) }].
export const SimpleGrid = React.memo(({
  prefix, gridId, columns, rows, rowKey, className, rowProps,
}) => {
  const currentPrefix = getPrefix(prefix);
  const view = useGridView(gridId);
  const sizes = useColumnWidths(gridId);
  const [choosing, setChoosing] = useState(false);
  const allKeys = view.arrange(columns.map(c => c.key));
  const cols = allKeys.map(k => columns.find(c => c.key === k))
    .filter(c => c.fixed || !view.hidden.includes(c.key));
  const getters = columns.reduce((all, c) => ({ ...all, [c.key]: c.sort }), {});
  const link = (id, onClick) => <a onClick={onClick}>{FormatMessage.string({ id })}</a>;
  return <div className={`${currentPrefix}-gridview`}>
    <div className={`${currentPrefix}-gridview-bar`}>
      {link('gridView.columns', () => setChoosing(!choosing))}
      {view.sorts.length > 0 && link('gridView.clearSort', view.clearSort)}
      {link('gridView.fitAll', sizes.fitAll)}
      {view.isCustom && link('gridView.reset', view.reset)}
      {sizes.customized && link('gridView.resetWidths', sizes.reset)}
      <span>{FormatMessage.string({ id: 'gridView.dragTip' })}</span>
    </div>
    {choosing && <ColumnChooser
      prefix={prefix}
      columns={columns}
      hidden={view.hidden}
      onToggle={view.toggleHidden}
    />}
    <div className={`${currentPrefix}-gridview-scroll`}>
      <table
        ref={sizes.tableRef}
        className={`${className || ''}${sizes.customized ? ` ${currentPrefix}-gridview-sized` : ''}`}
        style={sizes.tableStyle(cols.map(c => c.key))}
      >
        <thead>
          <tr>{cols.map(c => (
            <th
              key={c.key}
              {...sizes.headerProps(c.key)}
              {...(c.fixed ? {} : view.dragProps(c.key, allKeys))}
              style={sizes.customized ? { width: sizes.widths[c.key] || 120 } : undefined}
            >
              {c.title}
              {c.sort && <SortMark
                prefix={prefix}
                sorts={view.sorts}
                columnKey={c.key}
                onToggle={view.toggleSort}
              />}
              {sizes.handle(c.key, prefix)}
            </th>))}
          </tr>
        </thead>
        <tbody>
          {view.sortFrozen(rows, getters, rowKey, `${rows.length}`).map((row, index) => (
            <tr key={rowKey(row, index)} {...(rowProps ? rowProps(row) : {})}>
              {cols.map(c => <td key={c.key}>{c.render(row)}</td>)}
            </tr>))}
        </tbody>
      </table>
    </div>
  </div>;
});
