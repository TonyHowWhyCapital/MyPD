import React from 'react';
import {FormatMessage} from 'components';
import {getPrefix} from '../../lib/prefixUtil';
import {KIND_LANG_KEY, ATTR_LANG_KEY} from '../../lib/compare_diff_rows';

const lang = id => `components.compare.${id}`;

// before/after 指哪一侧依比较的场景而定
const MODES = {
  db: {
    before: lang('diffBefore'),
    after: lang('diffAfter'),
    none: lang('diffNone'),
    kinds: {tableRemove: lang('diffKind_tableExtra')},
    notes: {tableRemove: lang('diffExtraNote')},
  },
  version: {
    before: lang('diffBeforeVersion'),
    after: lang('diffAfterVersion'),
    none: lang('diffNoneVersion'),
  },
  table: {
    before: lang('diffBeforeTable'),
    after: lang('diffAfterTable'),
    none: lang('diffNoneTable'),
    kinds: {tableAdd: lang('diffKind_onlyCheck'), tableRemove: lang('diffKind_onlyDiff')},
  },
};

const Value = ({value, className}) => (
  <td className={className}>{value === '' ? '—' : value}</td>
);

export default React.memo(({prefix, rows, mode = 'db'}) => {
  const currentPrefix = getPrefix(prefix);
  const base = `${currentPrefix}-compare-diff`;
  const config = MODES[mode];
  if (!rows.length) {
    return <div className={`${base} ${base}-empty`}>
      <FormatMessage id={config.none}/>
    </div>;
  }
  const attrCell = (r) => {
    const note = config.notes?.[r.kind];
    if (note) {
      return <FormatMessage id={note}/>;
    }
    return ATTR_LANG_KEY[r.attr] ? <FormatMessage id={ATTR_LANG_KEY[r.attr]}/> : r.attr;
  };
  return <div className={base}>
    <table>
      <thead>
        <tr>
          <th><FormatMessage id='components.compare.diffTableCol'/></th>
          <th><FormatMessage id='components.compare.diffKind'/></th>
          <th><FormatMessage id='components.compare.diffTarget'/></th>
          <th><FormatMessage id='components.compare.diffAttr'/></th>
          <th><FormatMessage id={config.before}/></th>
          <th><FormatMessage id={config.after}/></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.table}</td>
            <td><FormatMessage id={config.kinds?.[r.kind] || KIND_LANG_KEY[r.kind]}/></td>
            <td>{r.target || '—'}</td>
            <td>{attrCell(r)}</td>
            <Value value={r.before} className={`${base}-before`}/>
            <Value value={r.after} className={`${base}-after`}/>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
});
