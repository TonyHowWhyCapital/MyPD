// The tables of the project, grouped as in the navigation, to tick for the run.
import React, { useMemo, useState } from 'react';
import { Checkbox, Icon, SearchInput } from 'components';
import { tr } from './i18n';
import { groupedEntities, matchesKeyword } from './planView';

export default React.memo(({
  base, dataSource, selected, width, onChange,
}) => {
  const [keyword, setKeyword] = useState('');
  const [closed, setClosed] = useState([]);
  const groups = useMemo(() => groupedEntities(dataSource, tr('picker.ungrouped')),
    [dataSource.entities, dataSource.viewGroups]);
  // a table of several groups is listed in each of them and ticked in all at once
  const shown = groups.map(g => ({
    ...g,
    entities: g.entities.filter(e => matchesKeyword(e, keyword)),
  })).filter(g => g.entities.length > 0);
  const visibleIds = shown.reduce((all, g) => all.concat(g.entities.map(e => e.id)), [])
    .filter((id, i, list) => list.indexOf(id) === i);
  const total = (dataSource.entities || []).length;
  const stateOf = (ids) => {
    const n = ids.filter(id => selected.includes(id)).length;
    return {
      checked: n > 0,
      indeterminate: n > 0 && n < ids.length,
      all: ids.length > 0 && n === ids.length,
    };
  };
  const setMany = (ids, on) => onChange(on
    ? selected.concat(ids.filter(id => !selected.includes(id)))
    : selected.filter(id => !ids.includes(id)));
  const toggleGroup = id => setClosed(list => (list.includes(id)
    ? list.filter(g => g !== id) : list.concat(id)));
  const all = stateOf(visibleIds);
  return <div className={`${base}-picker`} style={width ? { width } : undefined}>
    <div className={`${base}-picker-search`}>
      <SearchInput
        placeholder={tr('picker.search')}
        onChange={e => setKeyword(e.target.value)}
      />
    </div>
    <div className={`${base}-picker-all`}>
      <Checkbox
        checked={all.checked}
        indeterminate={all.indeterminate}
        disable={visibleIds.length === 0}
        onChange={() => setMany(visibleIds, !all.all)}
      />
      <span
        className={`${base}-picker-all-label`}
        onClick={() => visibleIds.length > 0 && setMany(visibleIds, !all.all)}
      >
        {keyword ? tr('picker.allFound') : tr('picker.all')}
      </span>
      <span className={`${base}-picker-count`}>
        {tr('picker.count', {
          selected: selected.length,
          total,
        })}
      </span>
    </div>
    <div className={`${base}-picker-list`}>
      {total === 0 && <div className={`${base}-empty`}>{tr('picker.noTables')}</div>}
      {total > 0 && shown.length === 0
        && <div className={`${base}-empty`}>{tr('picker.noMatch')}</div>}
      {shown.map((g) => {
        const ids = g.entities.map(e => e.id);
        const state = stateOf(ids);
        const open = !!keyword || !closed.includes(g.id);
        return <div key={g.id} className={`${base}-picker-group`}>
          <div className={`${base}-picker-group-head`} onClick={() => toggleGroup(g.id)}>
            <Icon type={open ? 'fa-caret-down' : 'fa-caret-right'}/>
            <Checkbox
              checked={state.checked}
              indeterminate={state.indeterminate}
              onChange={() => setMany(ids, !state.all)}
            />
            <span className={`${base}-picker-group-name`} title={g.name}>{g.name}</span>
            <span className={`${base}-picker-count`}>
              {`${ids.filter(id => selected.includes(id)).length}/${ids.length}`}
            </span>
          </div>
          {open && g.entities.map(e => (
            <div
              key={e.id}
              className={`${base}-picker-item${selected.includes(e.id)
                ? ` ${base}-picker-item-on` : ''}`}
              title={`${e.defKey}${e.defName ? ` ${e.defName}` : ''}`}
              onClick={() => setMany([e.id], !selected.includes(e.id))}
            >
              <Checkbox
                checked={selected.includes(e.id)}
                onChange={() => setMany([e.id], !selected.includes(e.id))}
              />
              <span className={`${base}-picker-item-key`}>{e.defKey}</span>
              {e.defName && <span className={`${base}-picker-item-name`}>{e.defName}</span>}
            </div>))}
        </div>;
      })}
    </div>
  </div>;
});
