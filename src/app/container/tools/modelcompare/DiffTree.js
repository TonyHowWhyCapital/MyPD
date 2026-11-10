import React from 'react';
import {Checkbox, FormatMessage} from 'components';
import {getPrefix} from '../../../../lib/prefixUtil';

const describe = (part, v) => {
  if (!v) return '';
  if (part === 'field') {
    const size = v.len !== '' && v.len !== undefined ? `(${v.len}${v.scale ? `,${v.scale}` : ''})` : '';
    return `${v.type}${size} ${v.defName}`.trim();
  }
  if (part === 'index') return `${v.unique ? 'UNIQUE ' : ''}(${(v.fields || []).join(', ')})`;
  return [v.defName, v.comment].filter(Boolean).join(' / ');
};

const opText = opt => FormatMessage.string({id: `modelCompare.op${opt[0].toUpperCase()}${opt.slice(1)}`});

// Leaf keys are the object key for add/delete items and the child keys for update items.
export const leafKeys = item => (item.opt === 'update' && item.children.length > 0
  ? item.children.map(c => c.key) : [item.key]);

export default React.memo(({prefix, items, selected, onToggle}) => {
  const currentPrefix = getPrefix(prefix);
  const state = (keys) => {
    const n = keys.filter(k => selected.has(k)).length;
    return {checked: n === keys.length && n > 0, indeterminate: n > 0 && n < keys.length};
  };
  const row = (key, level, opt, label, before, after, keys) => (
    <tr key={key} className={`${currentPrefix}-modelcompare-row-${opt}`}>
      <td style={{paddingLeft: 8 + level * 24}}>
        <Checkbox {...state(keys)} onChange={e => onToggle(keys, e.target.checked)}>
          <span className={`${currentPrefix}-modelcompare-op`}>{opText(opt)}</span>
          {label}
        </Checkbox>
      </td>
      <td>{before}</td>
      <td>{after}</td>
    </tr>
  );
  return (
    <table className={`${currentPrefix}-modelcompare-table`}>
      <thead>
        <tr>
          <th/>
          <th><FormatMessage id='modelCompare.before'/></th>
          <th><FormatMessage id='modelCompare.after'/></th>
        </tr>
      </thead>
      <tbody>
        {items.reduce((rows, item) => rows.concat(
          row(item.key, 0, item.opt,
            `${FormatMessage.string({id: `modelCompare.object${item.objectType === 'entity' ? 'Entity' : 'DbObject'}`})} ${item.defKey}${item.defName ? ` [${item.defName}]` : ''}`,
            '', '', leafKeys(item)),
          item.opt === 'update' ? item.children.map(c => row(c.key, 1, c.opt,
            `${FormatMessage.string({id: `modelCompare.part${c.part[0].toUpperCase()}${c.part.slice(1)}`})} ${c.part === 'base' ? '' : c.defKey}`,
            describe(c.part, c.before), describe(c.part, c.after), [c.key])) : []), [])}
      </tbody>
    </table>
  );
});
