import React, {useState} from 'react';
import {Button, Checkbox, FormatMessage} from 'components';
import {
  openFileOrDirPath, readNormalFile, readDbxConnections, getDbxDefaultFile,
} from '../../../lib/middle';
import {parseNavicat, parseDbxRows, resolveType} from '../../../lib/dbconn_import';
import {getPrefix} from '../../../lib/prefixUtil';

const sources = {
  navicat: {
    filters: [{name: 'Navicat', extensions: ['ncx']}],
    read: file => readNormalFile(file).then(data => parseNavicat(data.toString())),
  },
  dbx: {
    filters: [{name: 'DBX', extensions: ['db']}],
    defaultPath: () => getDbxDefaultFile(),
    read: file => readDbxConnections(file).then(parseDbxRows),
  },
};

export default React.memo(({prefix, dataSource, onChange}) => {
  const currentPrefix = getPrefix(prefix);
  const [state, setState] = useState({source: '', file: '', conns: [], checked: [], error: ''});
  const update = (next) => {
    setState(next);
    onChange(next.conns.filter(c => next.checked.includes(c.id)));
  };
  const pick = (source) => {
    const {filters, defaultPath, read} = sources[source];
    openFileOrDirPath(filters, ['openFile'], defaultPath ? {defaultPath: defaultPath()} : {})
      .then(file => read(file).then((conns) => {
        const checked = conns.filter(c => resolveType(c, dataSource)).map(c => c.id);
        update({source, file, conns, checked, error: ''});
      }).catch((err) => {
        update({source, file, conns: [], checked: [], error: err.message || `${err}`});
      }));
  };
  const toggle = (id, checked) => {
    update({
      ...state,
      checked: checked ? state.checked.concat(id) : state.checked.filter(c => c !== id),
    });
  };
  const selectable = state.conns.filter(c => resolveType(c, dataSource));
  const allChecked = selectable.length > 0 && selectable.every(c => state.checked.includes(c.id));
  return <div className={`${currentPrefix}-dbconnect-import`}>
    <div className={`${currentPrefix}-dbconnect-import-source`}>
      <Button onClick={() => pick('navicat')}><FormatMessage id='dbConnImport.navicat'/></Button>
      <Button onClick={() => pick('dbx')}><FormatMessage id='dbConnImport.dbx'/></Button>
      <span className={`${currentPrefix}-dbconnect-import-file`} title={state.file}>
        {state.file || FormatMessage.string({id: 'dbConnImport.noFile'})}
      </span>
    </div>
    {state.error && <div className={`${currentPrefix}-dbconnect-import-error`}>
      <FormatMessage id='dbConnImport.readError'/>{state.error}
    </div>}
    {state.source === 'dbx' && state.conns.length > 0
      && <div className={`${currentPrefix}-dbconnect-import-tip`}>
        <FormatMessage id='dbConnImport.dbxPassword'/>
      </div>}
    <table className={`${currentPrefix}-dbconnect-import-list`}>
      <thead>
        <tr>
          <th>
            <Checkbox
              checked={allChecked}
              disable={selectable.length === 0}
              onChange={e => update({
                ...state,
                checked: e.target.checked ? selectable.map(c => c.id) : [],
              })}
            />
          </th>
          <th><FormatMessage id='dbConnImport.name'/></th>
          <th><FormatMessage id='dbConnImport.type'/></th>
          <th><FormatMessage id='dbConnImport.host'/></th>
          <th><FormatMessage id='dbConnImport.database'/></th>
          <th><FormatMessage id='dbConnImport.username'/></th>
        </tr>
      </thead>
      <tbody>
        {state.conns.map((c) => {
          const supported = !!resolveType(c, dataSource);
          return <tr key={c.id} style={{opacity: supported ? 1 : 0.48}}>
            <td>
              <Checkbox
                checked={state.checked.includes(c.id)}
                disable={!supported}
                onChange={e => toggle(c.id, e.target.checked)}
              />
            </td>
            <td>{c.name}</td>
            <td>
              {c.sourceType}
              {!supported && <span>{FormatMessage.string({id: 'dbConnImport.unsupported'})}</span>}
            </td>
            <td>{c.host}{c.port ? `:${c.port}` : ''}</td>
            <td>{c.database}</td>
            <td>{c.username}</td>
          </tr>;
        })}
      </tbody>
    </table>
    {state.conns.length === 0 && !state.error
      && <div className={`${currentPrefix}-dbconnect-import-tip`}>
        <FormatMessage id='dbConnImport.empty'/>
      </div>}
  </div>;
});
