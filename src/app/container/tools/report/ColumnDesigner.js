import React, { useEffect, useRef, useState } from 'react';
import { Checkbox, FormatMessage, Icon } from 'components';
import {
  resolveColumns, toggleColumn, moveColumn, columnPercents, dragColumn, widthsOf,
  columnLabel, originalLabel, cssOf, emptyHistory, record, undo, redo,
} from '../../../../lib/report';
import { getPrefix } from '../../../../lib/prefixUtil';
import ColumnProperties from './ColumnProperties';
import { sampleTable } from './SectionPreview';
import './style/design.less';

const SAMPLE_ROWS = 12;
const text = id => FormatMessage.string({ id: `report.${id}` });

// The table of one section, laid out as it will be exported. Headers are picked by a
// click, moved by dragging them and resized by dragging the border between two of them.
const Sheet = ({
  cls, table, chosen, selected, onSelect, onMove, onResize,
}) => {
  if (!table.keys) {
    // The model summary: one row per column.
    return <table className='rows'>
      <thead><tr>{table.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
      <tbody>
        {table.rows.map((r, n) => <tr key={chosen[n]} onClick={() => onSelect(chosen[n])}>
          {r.map((c, i) => <td key={i} className={chosen[n] === selected ? 'picked' : ''}>{c}</td>)}
        </tr>)}
      </tbody>
    </table>;
  }
  const percents = columnPercents(table.widths, table.headers.length);
  const startResize = (e, index) => {
    e.preventDefault();
    e.stopPropagation();
    const cells = Array.from(e.currentTarget.closest('tr').children)
      .map(th => th.getBoundingClientRect().width);
    const total = cells.reduce((sum, w) => sum + w, 0);
    const start = cells.map(w => (w / total) * 100);
    const x = e.clientX;
    const move = ev => onResize(widthsOf(table.keys, dragColumn(start, index, ((ev.clientX - x) / total) * 100)));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  const picked = i => (table.keys[i] === selected ? 'picked' : '');
  return <table className={percents ? 'sized' : ''}>
    <colgroup>
      {table.headers.map((h, i) => <col key={i} style={{ width: percents ? `${percents[i]}%` : '' }}/>)}
    </colgroup>
    <thead>
      <tr>{table.headers.map((h, i) => <th
        key={table.keys[i]}
        className={picked(i)}
        style={{ textAlign: table.headAligns[i], ...cssOf(table.headStyles[i]) }}
        draggable
        onClick={() => onSelect(table.keys[i], 'head')}
        onDragStart={e => e.dataTransfer.setData('text/plain', table.keys[i])}
        onDragOver={e => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onMove(e.dataTransfer.getData('text/plain'), i); }}
      >
        {h}
        <small>{percents ? `${Math.round(percents[i])}%` : text('widthAuto')}</small>
        {i < table.headers.length - 1
          && <span className={`${cls}-handle`} draggable onDragStart={e => e.preventDefault()} onMouseDown={e => startResize(e, i)}/>}
      </th>)}</tr>
    </thead>
    <tbody>
      {table.rows.slice(0, SAMPLE_ROWS).map((r, n) => <tr key={n}>{r.map((c, i) => <td
        key={i}
        className={picked(i)}
        style={{ textAlign: table.aligns[i], ...cssOf(table.styles[i]) }}
        onClick={() => onSelect(table.keys[i], 'cell')}
      >{c}</td>)}</tr>)}
    </tbody>
  </table>;
};

// Lays out the columns of one section: the sheet on the left always shows the result,
// the right side offers the columns to show and the properties of the picked one.
export default ({
  prefix, section, def, dataSource, lang, onChange,
}) => {
  const cls = `${getPrefix(prefix)}-report-design`;
  const [sec, setSec] = useState(section);
  const [selected, setSelected] = useState(resolveColumns(def, section)[0]);
  const [part, setPart] = useState('cell');
  const [history, setHistory] = useState(emptyHistory);
  const apply = (next) => {
    setSec(next);
    // The caller patches the template it had when the designer opened, so send it all.
    onChange({
      columns: next.columns,
      widths: next.widths,
      aligns: next.aligns,
      labels: next.labels,
      styles: next.styles,
      headAligns: next.headAligns,
      headStyles: next.headStyles,
    });
  };
  const patch = (change) => {
    setHistory(record(history, sec, `${Object.keys(change).join()}:${selected}`, Date.now()));
    apply({ ...sec, ...change });
  };
  const step = (go) => {
    const back = go(history, sec);
    if (back) {
      setHistory(back.history);
      apply(back.state);
    }
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onKey = (e) => {
      const z = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z';
      const y = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y';
      if (z || y) {
        e.preventDefault();
        stepRef.current(z && !e.shiftKey ? undo : redo);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const chosen = resolveColumns(def, sec);
  const table = sampleTable(dataSource, sec, lang);
  const toggle = (key, checked) => {
    patch({ columns: toggleColumn(def, sec, key, checked) });
    checked && setSelected(key);
  };
  return <div className={cls}>
    <div className={`${cls}-main`}>
      <div className={`${cls}-tip`}>
        <span><Icon type='fa-mouse-pointer'/><FormatMessage id='report.designTip'/></span>
        {table.keys && <span><Icon type='fa-arrows'/><FormatMessage id='report.designTipMove'/></span>}
        {table.keys && <span><Icon type='fa-arrows-h'/><FormatMessage id='report.designTipSize'/></span>}
        <span className={`${cls}-steps`}>
          <a className={history.past.length ? '' : 'disabled'} title={`${text('undo')} (Ctrl+Z)`} onClick={() => step(undo)}>
            <Icon type='fa-undo'/>{text('undo')}
          </a>
          <a className={history.future.length ? '' : 'disabled'} title={`${text('redo')} (Ctrl+Shift+Z)`} onClick={() => step(redo)}>
            <Icon type='fa-repeat'/>{text('redo')}
          </a>
        </span>
      </div>
      <div className={`${cls}-paper`}>
        <Sheet
          cls={cls}
          table={table}
          chosen={chosen}
          selected={selected}
          onSelect={(key, to) => { setSelected(key); to && setPart(to); }}
          onMove={(key, to) => { patch({ columns: moveColumn(def, sec, key, to) }); setSelected(key); }}
          onResize={widths => patch({ widths })}
        />
        {table.rows.length === 0 && <div className={`${cls}-empty`}>{text('designNoData')}</div>}
      </div>
    </div>
    <div className={`${cls}-side`}>
      <div className={`${cls}-panel ${cls}-fields`}>
        <div className={`${cls}-panel-head`}>
          <strong><FormatMessage id='report.designColumns'/></strong>
          <i>{chosen.length} / {def.columns.length}</i>
        </div>
        <div className={`${cls}-grid`}>{def.columns.map(({ key }) => <div
          key={key}
          className={`${cls}-field ${key === selected && chosen.includes(key) ? 'picked' : ''}`}
        >
          <Checkbox checked={chosen.includes(key)} onChange={() => toggle(key, !chosen.includes(key))}/>
          <span
            title={originalLabel(sec, key, lang) && FormatMessage.string({ id: 'report.originalName', data: { name: originalLabel(sec, key, lang) } })}
            onClick={() => (chosen.includes(key) ? setSelected(key) : toggle(key, true))}
          >{columnLabel(sec, key, lang)}</span>
        </div>)}</div>
      </div>
      <div className={`${cls}-panel ${cls}-props`}>
        <ColumnProperties cls={cls} def={def} section={sec} lang={lang} selected={selected} part={part} onPart={setPart} patch={patch}/>
      </div>
    </div>
  </div>;
};
