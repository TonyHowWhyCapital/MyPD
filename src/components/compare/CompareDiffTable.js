import React from 'react';
import {FormatMessage} from 'components';
import {getPrefix} from '../../lib/prefixUtil';
import {KIND_LANG_KEY, ATTR_LANG_KEY} from '../../lib/compare_diff_rows';

const Value = ({value, className}) => (
  <td className={className}>{value === '' ? '—' : value}</td>
);

export default React.memo(({prefix, rows}) => {
  const currentPrefix = getPrefix(prefix);
  const base = `${currentPrefix}-compare-diff`;
  if (!rows.length) {
    return <div className={`${base} ${base}-empty`}>
      <FormatMessage id='components.compare.diffNone'/>
    </div>;
  }
  return <div className={base}>
    <table>
      <thead>
        <tr>
          <th><FormatMessage id='components.compare.diffTableCol'/></th>
          <th><FormatMessage id='components.compare.diffKind'/></th>
          <th><FormatMessage id='components.compare.diffTarget'/></th>
          <th><FormatMessage id='components.compare.diffAttr'/></th>
          <th><FormatMessage id='components.compare.diffBefore'/></th>
          <th><FormatMessage id='components.compare.diffAfter'/></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.table}</td>
            <td><FormatMessage id={KIND_LANG_KEY[r.kind]}/></td>
            <td>{r.target || '—'}</td>
            <td>{r.kind === 'tableExtra'
              ? <FormatMessage id='components.compare.diffExtraNote'/>
              : <FormatMessage id={ATTR_LANG_KEY[r.attr]}/>}</td>
            <Value value={r.before} className={`${base}-before`}/>
            <Value value={r.after} className={`${base}-after`}/>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
});
