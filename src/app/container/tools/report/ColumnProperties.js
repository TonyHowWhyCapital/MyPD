import React from 'react';
import { Button, FormatMessage, Icon } from 'components';
import {
  labelOf, resolveColumns, moveColumn, setColumnWidth, ALIGNS, alignOf, setColumnAlign,
  FONT_SIZES, lookOf, setColumnStyle, styleStore, alignStore,
} from '../../../../lib/report';

const text = id => FormatMessage.string({ id: `report.${id}` });
const without = (map, key) => {
  const { [key]: dropped, ...rest } = map || {};
  return rest;
};
const FLAGS = ['bold', 'italic', 'underline'];
const PARTS = ['cell', 'head'];
const FALLBACK = { cell: { color: '#222222', fill: '#ffffff' }, head: { color: '#222222', fill: '#f0f2f5' } };

// What can be changed on the picked column: its place and width, then the look of its
// cells and of its header on a tab each. The model summary shows its columns as rows, so
// only the name and the position apply there.
export default ({
  cls, def, section, lang, selected, part, onPart, patch,
}) => {
  const chosen = resolveColumns(def, section);
  const at = chosen.indexOf(selected);
  if (at < 0) {
    return <div className={`${cls}-empty`}>{text('designPick')}</div>;
  }
  const look = lookOf(section, selected, part);
  const move = to => patch({ columns: moveColumn(def, section, selected, to) });
  const setLabel = (value) => {
    const rest = without(section.labels, selected);
    patch({ labels: value.trim() ? { ...rest, [selected]: value } : rest });
  };
  const setLook = change => patch({ [styleStore(part)]: setColumnStyle(section, selected, change, part) });
  const reset = () => patch({
    labels: without(section.labels, selected),
    widths: without(section.widths, selected),
    aligns: without(section.aligns, selected),
    styles: without(section.styles, selected),
    headAligns: without(section.headAligns, selected),
    headStyles: without(section.headStyles, selected),
  });
  const row = (id, body) => <div className={`${cls}-prop`}><span>{text(id)}</span>{body}</div>;
  const colour = (id, name) => row(id, <React.Fragment>
    <input type='color' value={look[name] || FALLBACK[part][name]} onChange={e => setLook({ [name]: e.target.value })}/>
    {look[name]
      ? <a title={text('propDefault')} onClick={() => setLook({ [name]: '' })}><Icon type='fa-times'/></a>
      : <i>{text('propDefault')}</i>}
  </React.Fragment>);
  const name = row('propLabel', <input
    type='text'
    value={(section.labels || {})[selected] || ''}
    placeholder={labelOf(selected, lang)}
    onChange={e => setLabel(e.target.value)}
  />);
  return <React.Fragment>
    {row('propOriginal', <em>{labelOf(selected, lang)}</em>)}
    {def.summary && name}
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
    {!def.summary && <React.Fragment>
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
      <div className={`${cls}-tabs`}>
        {PARTS.map(p => <a key={p} className={p === part ? 'active' : ''} onClick={() => onPart(p)}>
          {text(`part.${p}`)}
        </a>)}
      </div>
      {part === 'head' && name}
      {row('propAlign', ALIGNS.map(a => <a
        key={a}
        title={text(`align.${a}`)}
        className={alignOf(section, selected, part) === a ? 'active' : ''}
        onClick={() => patch({ [alignStore(part)]: setColumnAlign(section, selected, a, part) })}
      ><Icon type={`fa-align-${a}`}/></a>))}
      {row('propSize', <React.Fragment>
        <select value={look.size || ''} onChange={e => setLook({ size: e.target.value })}>
          <option value=''>{text('propDefault')}</option>
          {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select><i>pt</i>
      </React.Fragment>)}
      {row('propFont', FLAGS.map(f => <a
        key={f}
        title={text(`font.${f}`)}
        className={look[f] ? 'active' : ''}
        onClick={() => setLook({ [f]: !look[f] })}
      ><Icon type={`fa-${f}`}/></a>))}
      {colour('propColor', 'color')}
      {colour('propFill', 'fill')}
    </React.Fragment>}
    <Button onClick={reset}><FormatMessage id='report.propReset'/></Button>
  </React.Fragment>;
};
