import React, { useRef } from 'react';
import { Checkbox, FormatMessage, Icon } from 'components';
import {
  labelOf, resolveColumns, toggleColumn, moveColumn, setColumnWidth, alignOf, setColumnAlign, nextAlign,
} from '../../../../lib/report';

// Chosen columns come first, in report order. They can be dragged or nudged with the arrows.
export default React.memo(({
  currentPrefix, def, section, lang, onChange, onWidths, onAligns,
}) => {
  const dragging = useRef('');
  const chosen = resolveColumns(def, section);
  const rest = def.columns.map(c => c.key).filter(k => !chosen.includes(k));
  const move = (key, to) => onChange(moveColumn(def, section, key, to));
  const onDrop = (e, index) => {
    e.preventDefault();
    dragging.current && move(dragging.current, index);
    dragging.current = '';
  };
  return <span className={`${currentPrefix}-report-columns`}>
    {chosen.map((key, index) => <span
      key={key}
      className={`${currentPrefix}-report-column ${currentPrefix}-report-column-chosen`}
      draggable
      onDragStart={() => { dragging.current = key; }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => onDrop(e, index)}
      title={FormatMessage.string({id: 'report.columnOrderTip'})}
    >
      <em>{index + 1}</em>
      <Checkbox checked onChange={() => onChange(toggleColumn(def, section, key, false))}>
        {labelOf(key, lang)}
      </Checkbox>
      <input
        type='number'
        min={1}
        max={100}
        value={(section.widths || {})[key] || ''}
        placeholder={FormatMessage.string({id: 'report.widthAuto'})}
        title={FormatMessage.string({id: 'report.widthTip'})}
        draggable
        onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onChange={e => onWidths(setColumnWidth(section, key, e.target.value))}
      /><i>%</i>
      <a
        title={FormatMessage.string({id: 'report.alignTip'})}
        onClick={() => onAligns(setColumnAlign(section, key, nextAlign(alignOf(section, key))))}
      ><Icon type={`fa-align-${alignOf(section, key)}`}/></a>
      <a className={index === 0 ? 'disabled' : ''} onClick={() => move(key, index - 1)}>‹</a>
      <a
        className={index === chosen.length - 1 ? 'disabled' : ''}
        onClick={() => move(key, index + 1)}
      >›</a>
    </span>)}
    {rest.map(key => <span key={key} className={`${currentPrefix}-report-column`}>
      <Checkbox checked={false} onChange={() => onChange(toggleColumn(def, section, key, true))}>
        {labelOf(key, lang)}
      </Checkbox>
    </span>)}
  </span>;
});
