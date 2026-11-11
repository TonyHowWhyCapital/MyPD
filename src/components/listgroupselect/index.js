import React, {useState, useMemo, forwardRef, useImperativeHandle, useRef, useEffect} from 'react';
import _ from 'lodash/object';

import './style/index.less';
import {getPrefix} from '../../lib/prefixUtil';
import Left from './Left';
import Right from './Right';
import {unRepeated} from '../../lib/array_util';

export default React.memo(forwardRef(({allowClear = false, notAllowEmpty = true,
                                        data, groups, prefix, formatResult, arrayData, repeatTitle,
                                        defaultSelected = [], originGroups = [],
                                        allowAddGroup}, ref) => {
  const tempSelected = unRepeated(defaultSelected);
  const searchDataRef = useRef([]);
  const currentPrefix = getPrefix(prefix);
  const currentGroup = useMemo(() => {
    return groups
        .concat(data
            .filter(d => groups.findIndex(g => g.id === d.id) < 0)
            .map(g => ({...g, fields: []})));
  },[groups]);
  // groups created here; they reach the project through getData (marked isNew)
  const [addedGroups, setAddedGroups] = useState([]);
  const allGroups = useMemo(() => currentGroup.concat(addedGroups), [currentGroup, addedGroups]);
  const allGroupsRef = useRef(allGroups);
  allGroupsRef.current = allGroups;
  const currentData = arrayData || groups.reduce((a, b) => a.concat(b.fields), [groups]);
  const findPreGroup = (p) => {
    const id = currentData.find(c => c.defKey === p.defKey)?.id;
    if(id) {
      return originGroups.find(g => (g.fields || g.refEntities || [])
          .includes(id))?.id || '';
    }
    return '';
  };
  const newData = useMemo(() => data.reduce((a, b) => {
    const aKeys = a.map(f => f.id);
    return a.concat(b.fields
        .filter(f => !aKeys.includes(f.id)).map(f => ({...f, group: b.id || findPreGroup(f)})));
  }, []), [data]);
  const newDataKeys = useMemo(() => newData.map(n => n.id), [newData]);
  const newDataDefKeys = useMemo(() => newData.map(n => n.defKey), [newData]);
  const repeatData = useMemo(() => currentData.map(f => f.defKey)
      .filter(f => newDataDefKeys.includes(f)), [data, groups]);
  const [checked, setChecked] = useState([...tempSelected]);
  const [type, setType] = useState('normal');
  const getType = (d) => {
    if(d.every(s => checked.includes(s.id))) {
      return 'all';
    } else if(d.some(s => checked.includes(s.id))) {
      return 'ind';
    } else {
      return 'normal';
    }
  };
  useEffect(() => {
    setType(getType(searchDataRef.current));
  }, [checked]);
  useEffect(() => {
    setChecked([...tempSelected]);
  }, [newDataKeys]);
  const checkedRef = useRef(null);
  checkedRef.current = checked;
  // groups chosen on the right; kept apart so a re-render does not drop them
  const chosenGroupRef = useRef({});
  const withChosenGroup = () => newData.map(f => (f.id in chosenGroupRef.current
    ? {...f, group: chosenGroupRef.current[f.id]} : f));
  const importDataRef = useRef(null);
  importDataRef.current = withChosenGroup();
  useImperativeHandle(ref, () => {
    return {
      getData: () => {
        const current = importDataRef.current.filter(f => checkedRef.current.includes(f.id));
        return allGroupsRef.current.map((g) => {
          const currentFields = current
              .filter(c => c.group === g.id)
              .map(c => _.omit(c, ['group']));
          return {
            ...g,
            fields: g.fields
                .filter(f => currentFields.findIndex(c => c.id === f.id) < 0)
                .concat(currentFields),
          };
        });
      },
    };
  }, []);
  const _iconClick = (t) => {
    if (t === 'all') {
      setChecked((pre) => {
        return [...new Set([...tempSelected || []]
            .concat(pre.filter(p => searchDataRef.current.findIndex(d => d.id === p) < 0)))];
      });
    } else {
      setChecked((pre) => {
        return [...new Set(pre.concat(searchDataRef.current.map(d => d.id)))];
      });
    }
  };
  const _onGroupChange = (e, id) => {
    [].concat(id).forEach((i) => {
      chosenGroupRef.current[i] = e.target.value;
    });
    importDataRef.current = withChosenGroup();
  };
  const onRemove = (keys) => {
    setChecked((pre) => {
      return pre.filter(p => !keys.includes(p));
    });
  };
  const _checkBoxChange = (e, id) => {
    setChecked((pre) => {
      if (!e.target.checked) {
        return pre.filter(p => p !== id);
      }
      return pre.concat(id);
    });
  };
  const onSearch = (searchData) => {
    setType(getType(searchData));
    searchDataRef.current = searchData;
  };
  const checkNewData = useMemo(() => newData.filter(d => checked.includes(d.id)),
      [checked, newData]);
  return <div className={`${currentPrefix}-listselect`}>
    <div className={`${currentPrefix}-listselect-opt`}>
      <span>{formatResult && formatResult(newData, repeatData)}</span>
    </div>
    <div className={`${currentPrefix}-listselect-container`}>
      <Left
        header={<span className={`${currentPrefix}-listselect-opt-${type}`} onClick={() => _iconClick(type)}>
          {}
        </span>}
        repeatTitle={repeatTitle}
        defaultSelected={tempSelected}
        prefix={currentPrefix}
        checked={checked}
        newData={newData}
        checkBoxChange={_checkBoxChange}
        repeatData={repeatData}
        onSearch={onSearch}
      />
      <Right
        defaultSelected={tempSelected}
        currentGroup={allGroups}
        onAddGroup={allowAddGroup ? g => setAddedGroups(pre => pre.concat(g)) : undefined}
        newData={checkNewData}
        prefix={currentPrefix}
        onGroupChange={_onGroupChange}
        onRemove={onRemove}
        allowClear={allowClear}
        notAllowEmpty={notAllowEmpty}
      />
    </div>
  </div>;
}));
