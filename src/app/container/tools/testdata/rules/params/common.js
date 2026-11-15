import React from 'react';
import { Input, Select } from 'components';

// One line of a form: a label, the control and an optional note under it.
export const Row = ({ base, label, hint, children, wide }) => (
  <div className={`${base}-form-row${wide ? ` ${base}-form-row-wide` : ''}`}>
    <span className={`${base}-form-label`}>{label}</span>
    <div className={`${base}-form-control`}>
      {children}
      {hint && <div className={`${base}-form-hint`}>{hint}</div>}
    </div>
  </div>
);

// what was typed, as a number when it is one: "12" -> 12, "1e" stays text and is reported
export const numberOrText = (text) => {
  const s = `${text === undefined || text === null ? '' : text}`.trim();
  if (s === '') {
    return '';
  }
  const n = Number(s);
  return Number.isFinite(n) && `${n}` === s ? n : s;
};

const shown = v => (v === undefined || v === null ? '' : `${v}`);

// a number typed freely (sign and decimals allowed); problems are reported by the rule check
export const NumberField = ({ value, onChange, placeholder, style }) => (
  <Input
    style={style}
    value={shown(value)}
    placeholder={placeholder}
    onChange={e => onChange(numberOrText(e.target.value))}
  />
);

export const TextField = ({ value, onChange, placeholder, style, maxLength }) => (
  <Input
    style={style}
    value={shown(value)}
    placeholder={placeholder}
    maxLength={maxLength}
    onChange={e => onChange(e.target.value)}
  />
);

// options: [{value, label}]; one of them is always chosen
export const Choice = ({ value, options, onChange, className }) => (
  <Select
    className={className}
    notAllowEmpty
    allowClear={false}
    value={value}
    onChange={e => onChange(e.target.value)}
  >
    {options.map(o => (
      <Select.Option key={`${o.value}`} value={o.value}>{o.label}</Select.Option>))}
  </Select>
);
