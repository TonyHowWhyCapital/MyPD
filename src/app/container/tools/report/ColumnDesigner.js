import React, { useState } from 'react';
import { Button, Checkbox, FormatMessage, Icon } from 'components';
import {
  buildSection, labelOf, resolveColumns, toggleColumn, moveColumn, setColumnWidth, columnPercents,
  dragColumn, widthsOf, ALIGNS, alignOf, setColumnAlign, columnLabel, originalLabel,
} from '../../../../lib/report';
import { getPrefix } from '../../../../lib/prefixUtil';

const SAMPLE_ROWS = 12;
const text = id => FormatMessage.string({ id: `report.${id}` });
const without = (map, key) => {
  const { [key]: dropped, ...rest } = map || {};
  return rest;
};

// The table of one section, laid out as it will be exported. Headers are picked by a
// click, moved by dragging them and resized by dragging the border between two of them.
const Sheet = ({
  cls, table, selected, onSelect, onMove, onResize,
}) => {
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
        style={{ textAlign: table.aligns[i] }}
        onClick={() => onSelect(table.keys[i])}
      >{c}</td>)}</tr>)}
    </tbody>
  </table>;
};

const Properties = ({
  cls, def, section, lang, selected, patch,
}) => {
  const chosen = resolveColumns(def, section);
  const at = chosen.indexOf(selected);
  if (at < 0) {
    return <div className={`${cls}-empty`}>{text('designPick')}</div>;
  }
  const move = to => patch({ columns: moveColumn(def, section, selected, to) });
  const setLabel = (value) => {
    const rest = without(section.labels, selected);
    patch({ labels: value.trim() ? { ...rest, [selected]: value } : rest });
  };
  const reset = () => patch({
    labels: without(section.labels, selected),
    widths: without(section.widths, selected),
    aligns: without(section.aligns, selected),
  });
  const row = (id, body) => <div className={`${cls}-prop`}><span>{text(id)}</span>{body}</div>;
  return <React.Fragment>
    {row('propOriginal', <em>{labelOf(selected, lang)}</em>)}
    {row('propLabel', <input
      type='text'
      value={(section.labels || {})[selected] || ''}
      placeholder={labelOf(selected, lang)}
      onChange={e => setLabel(e.target.value)}
    />)}
    {row('propPosition', <React.Fragment>
      <input
        type='number'
        min={1}
        max={chosen.length}
        value={at + 1}
        onChange={e => Number(e.target.value) >= 1 && move(Number(e.target.value) - 1)}
      />
      <a className={at === 0 ? 'disabled' : ''} onClick={() => move(at - 1)}>‹</a>
      <a className={at === chosen.length - 1 ? 'disabled' : ''} onClick={() => move(at + 1)}>›</a>
      <i>/ {chosen.length}</i>
    </React.Fragment>)}
    {row('propWidth', <React.Fragment>
      <input
        type='number'
        min={1}
        max={100}
        value={(section.widths || {})[selected] || ''}
        placeholder={text('widthAuto')}
        onChange={e => patch({ widths: setColumnWidth(section, selected, e.target.value) })}
      /><i>%</i>
    </React.Fragment>)}
    {row('propAlign', ALIGNS.map(a => <a
      key={a}
      title={text(`align.${a}`)}
      className={alignOf(section, selected) === a ? 'active' : ''}
      onClick={() => patch({ aligns: setColumnAlign(section, selected, a) })}
    ><Icon type={`fa-align-${a}`}/></a>))}
    <Button onClick={reset}><FormatMessage id='report.propReset'/></Button>
  </React.Fragment>;
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
      columns: next.columns, widths: next.widths, aligns: next.aligns, labels: next.labels,
    });
  };
  const chosen = resolveColumns(def, sec);
  const table = buildSection(dataSource, sec, { lang, level: 1, flatOnly: true }).find(b => b.type === 'table')
    || buildSection({ entities: [{ fields: [] }] }, sec, { lang, level: 1, flatOnly: true }).find(b => b.type === 'table');
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
        <Properties cls={cls} def={def} section={sec} lang={lang} selected={selected} patch={patch}/>
      </div>
    </div>
  </div>;
};
