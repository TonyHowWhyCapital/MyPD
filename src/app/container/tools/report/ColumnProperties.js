import React from 'react';
import { FormatMessage, Icon } from 'components';
import {
  labelOf, resolveColumns, moveColumn, setColumnWidth, ALIGNS, alignOf, setColumnAlign,
  FONT_SIZES, lookOf, styleOf, setColumnStyle, styleStore, alignStore, columnLabel, spreadStyle,
} from '../../../../lib/report';
import ColorField from './ColorField';

const text = id => FormatMessage.string({ id: `report.${id}` });
const without = (map, key) => {
  const { [key]: dropped, ...rest } = map || {};
  return rest;
};
const FLAGS = ['bold', 'italic', 'underline'];
const PARTS = ['cell', 'head'];
const STORES = ['labels', 'widths', 'aligns', 'styles', 'headAligns', 'headStyles'];
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
    return <React.Fragment>
      <div className={`${cls}-panel-head`}><strong>{text('designProps')}</strong></div>
      <div className={`${cls}-empty`}>{text('designPick')}</div>
    </React.Fragment>;
  }
  const look = lookOf(section, selected, part);
  const move = to => patch({ columns: moveColumn(def, section, selected, to) });
  const setLabel = (value) => {
    const rest = without(section.labels, selected);
    patch({ labels: value.trim() ? { ...rest, [selected]: value } : rest });
  };
  const setLook = change => patch({ [styleStore(part)]: setColumnStyle(section, selected, change, part) });
  const custom = STORES.some(store => selected in (section[store] || {}));
  const reset = () => patch(STORES.reduce(
    (all, store) => ({ ...all, [store]: without(section[store], selected) }), {},
  ));
  const row = (id, body) => <div className={`${cls}-prop`}><span>{text(id)}</span>{body}</div>;
  const colour = (id, name) => row(id, <ColorField
    cls={cls}
    value={look[name] || ''}
    fallback={FALLBACK[part][name]}
    onChange={value => setLook({ [name]: value })}
  />);
  // Offered once this column has a look of its own, or another one has one to clear.
  const store = section[styleStore(part)] || {};
  const canSpread = chosen.length > 1
    && (Object.keys(styleOf(section, selected, part)).length > 0 || Object.keys(store).length > 0);
  const spread = () => patch({ [styleStore(part)]: spreadStyle(section, chosen, selected, part) });
  const name = row('propLabel', <input
    type='text'
    value={(section.labels || {})[selected] || ''}
    placeholder={labelOf(selected, lang)}
    onChange={e => setLabel(e.target.value)}
  />);
  const renamed = (section.labels || {})[selected];
  return <React.Fragment>
    <div className={`${cls}-panel-head`}>
      <strong>{text('designProps')}<b>{columnLabel(section, selected, lang)}</b></strong>
      <a className={custom ? '' : 'disabled'} onClick={reset}><Icon type='fa-undo'/>{text('propReset')}</a>
    </div>
    {renamed && row('propOriginal', <em>{labelOf(selected, lang)}</em>)}
    {def.summary && name}
    {row('propPosition', <React.Fragment>
      <input
        type='number'
        min={1}
        max={chosen.length}
        value={at + 1}
        onChange={e => Number(e.target.value) >= 1 && move(Number(e.target.value) - 1)}
      />
      <a className={at === 0 ? 'disabled' : ''} title={text('moveLeft')} onClick={() => move(at - 1)}>
        <Icon type='fa-angle-left'/>
      </a>
      <a className={at === chosen.length - 1 ? 'disabled' : ''} title={text('moveRight')} onClick={() => move(at + 1)}>
        <Icon type='fa-angle-right'/>
      </a>
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
        <span>{text('propApply')}</span>
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
      {row('propFont', <React.Fragment>
        <select title={text('propSize')} value={look.size || ''} onChange={e => setLook({ size: e.target.value })}>
          <option value=''>{text('propDefault')}</option>
          {FONT_SIZES.map(s => <option key={s} value={s}>{s} pt</option>)}
        </select>
        {FLAGS.map(f => <a
          key={f}
          title={text(`font.${f}`)}
          className={look[f] ? 'active' : ''}
          onClick={() => setLook({ [f]: !look[f] })}
        ><Icon type={`fa-${f}`}/></a>)}
      </React.Fragment>)}
      {colour('propColor', 'color')}
      {colour('propFill', 'fill')}
      <a className={`${cls}-spread ${canSpread ? '' : 'disabled'}`} onClick={spread}>
        <Icon type='fa-clone'/>{text('applyAll')}
      </a>
    </React.Fragment>}
  </React.Fragment>;
};
