import React, { useState } from 'react';
import { Checkbox, FormatMessage } from 'components';
import {
  resolveColumns, toggleColumn, moveColumn, columnPercents, dragColumn, widthsOf,
  columnLabel, originalLabel, cssOf,
} from '../../../../lib/report';
import { getPrefix } from '../../../../lib/prefixUtil';
import ColumnProperties from './ColumnProperties';
import { sampleTable } from './SectionPreview';

const SAMPLE_ROWS = 12;
const text = id => FormatMessage.string({ id: `report.${id}` });

// The table of one section, laid out as it will be exported. Headers are picked by a
// click, moved by dragging them and resized by dragging the border between two of them.
const Sheet = ({
  cls, table, chosen, selected, onSelect, onMove, onResize,
}) => {
  if (!table.keys) {
    // The model summary: one row per column.
    return <table>
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
        draggable
        onClick={() => onSelect(table.keys[i])}
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
        onClick={() => onSelect(table.keys[i])}
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
  const patch = (change) => {
    const next = { ...sec, ...change };
    setSec(next);
    // The caller patches the template it had when the designer opened, so send it all.
    onChange({
      columns: next.columns,
      widths: next.widths,
      aligns: next.aligns,
      labels: next.labels,
      styles: next.styles,
    });
  };
  const chosen = resolveColumns(def, sec);
  const table = sampleTable(dataSource, sec, lang);
  const toggle = (key, checked) => {
    patch({ columns: toggleColumn(def, sec, key, checked) });
    checked && setSelected(key);
  };
  return <div className={cls}>
    <div className={`${cls}-main`}>
      <div className={`${cls}-tip`}><FormatMessage id='report.designTip'/></div>
      <div className={`${cls}-paper`}>
        <Sheet
          cls={cls}
          table={table}
          chosen={chosen}
          selected={selected}
          onSelect={setSelected}
          onMove={(key, to) => { patch({ columns: moveColumn(def, sec, key, to) }); setSelected(key); }}
          onResize={widths => patch({ widths })}
        />
        {table.rows.length === 0 && <div className={`${cls}-empty`}>{text('designNoData')}</div>}
      </div>
    </div>
    <div className={`${cls}-side`}>
      <div className={`${cls}-panel ${cls}-fields`}>
        <strong><FormatMessage id='report.designColumns'/></strong>
        {def.columns.map(({ key }) => <div
          key={key}
          className={`${cls}-field ${key === selected && chosen.includes(key) ? 'picked' : ''}`}
        >
          <Checkbox checked={chosen.includes(key)} onChange={() => toggle(key, !chosen.includes(key))}/>
          <span
            title={originalLabel(sec, key, lang) && FormatMessage.string({ id: 'report.originalName', data: { name: originalLabel(sec, key, lang) } })}
            onClick={() => (chosen.includes(key) ? setSelected(key) : toggle(key, true))}
          >{columnLabel(sec, key, lang)}</span>
        </div>)}
      </div>
      <div className={`${cls}-panel`}>
        <strong><FormatMessage id='report.designProps'/></strong>
        <ColumnProperties cls={cls} def={def} section={sec} lang={lang} selected={selected} patch={patch}/>
      </div>
    </div>
  </div>;
};
