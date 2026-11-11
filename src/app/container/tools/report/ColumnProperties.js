import React from 'react';
import { Button, FormatMessage, Icon } from 'components';
import {
  labelOf, resolveColumns, moveColumn, setColumnWidth, ALIGNS, alignOf, setColumnAlign,
  FONT_SIZES, styleOf, setColumnStyle,
} from '../../../../lib/report';

const text = id => FormatMessage.string({ id: `report.${id}` });
const without = (map, key) => {
  const { [key]: dropped, ...rest } = map || {};
  return rest;
};
const FLAGS = ['bold', 'italic', 'underline'];

// What can be changed on the picked column. `plain` sections (the model summary) show
// their columns as rows, so only the name and the position apply.
export default ({
  cls, def, section, lang, selected, patch,
}) => {
  const chosen = resolveColumns(def, section);
  const at = chosen.indexOf(selected);
  if (at < 0) {
    return <div className={`${cls}-empty`}>{text('designPick')}</div>;
  }
  const look = styleOf(section, selected);
  const move = to => patch({ columns: moveColumn(def, section, selected, to) });
  const setLabel = (value) => {
    const rest = without(section.labels, selected);
    patch({ labels: value.trim() ? { ...rest, [selected]: value } : rest });
  };
  const setLook = change => patch({ styles: setColumnStyle(section, selected, change) });
  const reset = () => patch({
    labels: without(section.labels, selected),
    widths: without(section.widths, selected),
    aligns: without(section.aligns, selected),
    styles: without(section.styles, selected),
  });
  const row = (id, body) => <div className={`${cls}-prop`}><span>{text(id)}</span>{body}</div>;
  const colour = (id, name, fallback) => row(id, <React.Fragment>
    <input type='color' value={look[name] || fallback} onChange={e => setLook({ [name]: e.target.value })}/>
    {look[name]
      ? <a title={text('propDefault')} onClick={() => setLook({ [name]: '' })}><Icon type='fa-times'/></a>
      : <i>{text('propDefault')}</i>}
  </React.Fragment>);
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
      {row('propAlign', ALIGNS.map(a => <a
        key={a}
        title={text(`align.${a}`)}
        className={alignOf(section, selected) === a ? 'active' : ''}
        onClick={() => patch({ aligns: setColumnAlign(section, selected, a) })}
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
      {colour('propColor', 'color', '#222222')}
      {colour('propFill', 'fill', '#ffffff')}
    </React.Fragment>}
    <Button onClick={reset}><FormatMessage id='report.propReset'/></Button>
  </React.Fragment>;
};
