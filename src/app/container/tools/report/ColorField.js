import React, { useState } from 'react';
import { FormatMessage, Icon } from 'components';
import { getUiState, setUiState } from '../../../../lib/middle';

const text = id => FormatMessage.string({ id: `report.${id}` });
const PRESETS = [
  '#000000', '#444444', '#888888', '#c00000', '#e36c09', '#bf9000', '#38761d', '#0b5394', '#674ea7',
  '#ffffff', '#f2f2f2', '#d9d9d9', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#cfe2f3', '#d9d2e9',
];
const RECENT_KEY = 'reportRecentColors';
const RECENT_MAX = 9;

const readRecent = () => {
  const list = getUiState(RECENT_KEY, []);
  return Array.isArray(list) ? list.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, RECENT_MAX) : [];
};
const remember = colour => setUiState(
  RECENT_KEY, [colour, ...readRecent().filter(c => c !== colour)].slice(0, RECENT_MAX),
);

// A colour of the picked column: a chip showing it, and a palette of ready colours, the
// ones used lately and the system picker for anything else. `value` is '' for the default.
export default ({
  cls, value, fallback, onChange,
}) => {
  const [open, setOpen] = useState(false);
  const pick = (colour) => {
    remember(colour);
    onChange(colour);
  };
  const chips = (list, extra = '') => <div className={`${cls}-chips ${extra}`}>
    {list.map(c => <a
      key={c}
      title={c}
      className={c === value ? 'active' : ''}
      style={{ background: c }}
      onClick={() => pick(c)}
    />)}
  </div>;
  const recent = open ? readRecent() : [];
  return <div className={`${cls}-colour`}>
    <a className='chip' style={{ background: value || fallback }} onClick={() => setOpen(!open)}/>
    {value
      ? <a className='clear' title={text('propDefault')} onClick={() => onChange('')}><Icon type='fa-times'/></a>
      : <i>{text('propDefault')}</i>}
    <a className='more' onClick={() => setOpen(!open)}><Icon type={open ? 'fa-angle-up' : 'fa-angle-down'}/></a>
    {open && <div className={`${cls}-palette`}>
      {chips(PRESETS)}
      {recent.length > 0 && <React.Fragment>
        <span>{text('colorRecent')}</span>
        {chips(recent)}
      </React.Fragment>}
      <label>
        <input
          type='color'
          value={value || fallback}
          onChange={e => onChange(e.target.value)}
          onBlur={e => remember(e.target.value)}
        />
        {text('colorMore')}
      </label>
    </div>}
  </div>;
};
