import React, { useMemo, useRef, useState } from 'react';
import FormatMessage from '../formatmessage';
import {
  loadGridWidths, saveGridWidths, clampWidth, fitWidth, MAX_FIT_WIDTH,
} from '../../lib/grid_util';
import { getPrefix } from '../../lib/prefixUtil';

// Width taken by header cells that are not resizable columns (row number, expand...).
export const REST = '_rest';
const KEY_ATTR = 'data-col-key';

const headerCells = table => (table ? [...table.querySelectorAll(`thead th[${KEY_ATTR}]`)] : []);

// Current px width of every column, read from the rendered header.
const measureHeader = (table) => {
  const ths = table ? [...table.querySelectorAll('thead th')] : [];
  return ths.reduce((all, th) => {
    const key = th.getAttribute(KEY_ATTR);
    const width = th.getBoundingClientRect().width;
    return key ? { ...all, [key]: Math.round(width) }
      : { ...all, [REST]: Math.round((all[REST] || 0) + width) };
  }, {});
};

let canvas;
const textWidth = (text, font) => {
  canvas = canvas || document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = font;
  return context.measureText(text).width;
};

const fontOf = el => window.getComputedStyle(el).font;

// elements that directly hold text, each measured with its own font
const textLeaves = (cell) => {
  return [cell, ...cell.querySelectorAll('*')].filter(el => el.offsetParent).map((el) => {
    const text = [...el.childNodes].filter(n => n.nodeType === 3)
      .map(n => n.textContent).join('').trim();
    return text ? { text, font: fontOf(el) } : null;
  }).filter(l => l);
};

// Width a body cell needs: the wider of its editor values and its own texts.
const cellWidth = (cell) => {
  const arrow = cell.querySelector('[class*="select"]') ? 20 : 0;
  const editors = [...cell.querySelectorAll('input, textarea')]
    .filter(i => !['checkbox', 'radio', 'hidden'].includes(i.type))
    .map(i => fitWidth([i.value], t => textWidth(t, fontOf(i)), 30 + arrow));
  // texts of one cell sit side by side
  const texts = textLeaves(cell).reduce((sum, l) => sum + textWidth(l.text, l.font), 0);
  return Math.max(clampWidth(texts + 26 + arrow, MAX_FIT_WIDTH), ...editors);
};

// A header shows its texts side by side, with the sort mark and any icons.
const headerWidth = (th) => {
  const texts = textLeaves(th).reduce((sum, l) => sum + textWidth(l.text, l.font), 0);
  return clampWidth(texts + (th.querySelectorAll('i').length * 22) + 30, MAX_FIT_WIDTH);
};

// Best width for each of the keys, from the header and the rows now rendered.
const fitColumns = (table, keys) => {
  const rows = [...table.querySelectorAll('tbody tr')];
  return headerCells(table).reduce((all, th) => {
    const key = th.getAttribute(KEY_ATTR);
    if (!keys.includes(key)) {
      return all;
    }
    const cells = rows.map(r => r.cells[th.cellIndex]).filter(c => c && c.colSpan === 1);
    return { ...all, [key]: Math.max(headerWidth(th), ...cells.map(cellWidth)) };
  }, {});
};

// Column widths of one grid: drag a header edge to resize, double-click it or use
// fitAll for the best width. Header cells must carry data-col-key, and the table
// must be laid out with `tableStyle` once the widths are customised.
export const useColumnWidths = (gridId, externalRef) => {
  const [all, setAll] = useState({});
  const ownRef = useRef(null);
  const tableRef = externalRef || ownRef;
  const saved = useMemo(() => loadGridWidths(gridId), [gridId]);
  const widths = all[gridId] || saved;
  const latest = useRef(widths);
  latest.current = widths;
  const show = next => setAll(a => ({ ...a, [gridId]: next }));
  const commit = (next) => {
    show(next);
    saveGridWidths(gridId, next);
  };
  // every column gets a px width the first time one is changed, so the others stay put
  const base = () => ({ ...measureHeader(tableRef.current), ...latest.current });
  const startResize = (key, e) => {
    e.preventDefault();
    e.stopPropagation();
    const from = base();
    const startX = e.clientX;
    let next = from;
    const move = (ev) => {
      next = { ...from, [key]: clampWidth((from[key] || 0) + ev.clientX - startX) };
      show(next);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      saveGridWidths(gridId, next);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  const fit = (keys) => {
    if (tableRef.current) {
      commit({ ...base(), ...fitColumns(tableRef.current, keys) });
    }
  };
  const fitAll = () => fit(headerCells(tableRef.current).map(th => th.getAttribute(KEY_ATTR)));
  const customized = Object.keys(widths).length > 0;
  return {
    tableRef,
    widths,
    customized,
    fitAll,
    reset: () => commit({}),
    // table style for the visible column keys; fallback is the width of an unsized column
    tableStyle: (keys, fallback = 120) => (customized ? {
      tableLayout: 'fixed',
      width: keys.reduce((sum, k) => sum + (widths[k] || fallback), widths[REST] || 0),
      minWidth: 0,
    } : {}),
    headerProps: key => ({ [KEY_ATTR]: key }),
    handle: (key, prefix) => <span
      className={`${getPrefix(prefix)}-gridview-resize`}
      title={FormatMessage.string({ id: 'gridView.resizeTip' })}
      draggable
      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onMouseDown={e => startResize(key, e)}
      onClick={e => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); fit([key]); }}
    />,
  };
};
