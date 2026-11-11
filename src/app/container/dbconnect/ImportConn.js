import React, {useState} from 'react';
import {Button, Radio, FormatMessage} from 'components';
import {
  openFileOrDirPath, readNormalFile, readDbxConnections, getDbxDefaultFile,
} from '../../../lib/middle';
import {parseNavicat, parseDbxRows, parseDbxJson, resolveType} from '../../../lib/dbconn_import';
import {getPrefix} from '../../../lib/prefixUtil';
import {SimpleGrid} from '../../../components/gridview';

const text = key => FormatMessage.string({id: `dbConnImport.${key}`});

const sources = {
  navicat: {
    filters: [{name: 'Navicat', extensions: ['ncx']}],
    read: file => readNormalFile(file).then(data => parseNavicat(data.toString())),
  },
  dbx: {
    filters: [{name: 'DBX', extensions: ['json', 'db']}],
    defaultPath: () => getDbxDefaultFile(),
    // a .json file is DBX's own unencrypted export, anything else is its data file
    read: file => (/\.json$/i.test(file)
      ? readNormalFile(file).then(data => parseDbxJson(data.toString()))
      : readDbxConnections(file).then(parseDbxRows)),
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
        update({source, file, conns, checked: [], error: ''});
      }).catch((err) => {
        update({source, file, conns: [], checked: [], error: err.message || `${err}`});
      }));
  };
  // only one connection is imported at a time
  const choose = (c) => {
    resolveType(c, dataSource) && update({...state, checked: [c.id]});
  };
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
    {state.source === 'dbx' && state.conns.length > 0 && !state.conns.some(c => c.password)
      && <div className={`${currentPrefix}-dbconnect-import-tip`}>
        <FormatMessage id='dbConnImport.dbxPassword'/>
      </div>}
    <SimpleGrid
      prefix={prefix}
      gridId='dbConnImport.list'
      className={`${currentPrefix}-dbconnect-import-list`}
      rows={state.conns}
      rowKey={c => c.id}
      rowProps={c => ({
        style: resolveType(c, dataSource) ? { cursor: 'pointer' } : { opacity: 0.48 },
        onClick: () => choose(c),
      })}
      columns={[
        {
          key: 'check',
          fixed: true,
          title: '',
          render: c => <Radio checked={state.checked.includes(c.id)} onChange={() => choose(c)}/>,
        },
        { key: 'name', title: text('name'), sort: c => c.name, render: c => c.name },
        {
          key: 'type',
          title: text('type'),
          sort: c => c.sourceType,
          render: c => <span>
            {c.sourceType}
            {!resolveType(c, dataSource)
              && <span>{FormatMessage.string({id: 'dbConnImport.unsupported'})}</span>}
          </span>,
        },
        {
          key: 'host',
          title: text('host'),
          sort: c => c.host,
          render: c => `${c.host || ''}${c.port ? `:${c.port}` : ''}`,
        },
        { key: 'database', title: text('database'), sort: c => c.database, render: c => c.database },
        { key: 'username', title: text('username'), sort: c => c.username, render: c => c.username },
      ]}
    />
    {state.conns.length === 0 && !state.error
      && <div className={`${currentPrefix}-dbconnect-import-tip`}>
        <FormatMessage id='dbConnImport.empty'/>
      </div>}
  </div>;
});
