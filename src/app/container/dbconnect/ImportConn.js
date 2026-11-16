import React, {useState} from 'react';
import {Button, Radio, FormatMessage} from 'components';
import {
  openFileOrDirPath, readNormalFile, readDbxConnections, getDbxDefaultFile,
  getDBeaverDefaultFile, dirname,
} from '../../../lib/middle';
import {
  parseNavicat, parseDbxRows, parseJsonConnections, decodeDBeaverCredentials, resolveType,
} from '../../../lib/dbconn_import';
import {getPrefix} from '../../../lib/prefixUtil';
import {SimpleGrid} from '../../../components/gridview';

const text = key => FormatMessage.string({id: `dbConnImport.${key}`});

// DBX's export and DBeaver's data-sources.json are both .json files, so either may be picked
// with the button of the other tool; DBeaver's users and passwords are in a second file
// beside it, which may be missing. -> {source, conns}
const readJson = file => readNormalFile(file).then(data => readNormalFile(`${dirname(file)}/credentials-config.json`)
  .then(decodeDBeaverCredentials, () => ({}))
  .then(credentials => parseJsonConnections(data.toString(), credentials)));

// read: (file) => Promise of {source, conns}
const sources = {
  navicat: {
    filters: [{name: 'Navicat', extensions: ['ncx']}],
    read: file => readNormalFile(file)
      .then(data => ({source: 'navicat', conns: parseNavicat(data.toString())})),
  },
  dbx: {
    filters: [{name: 'DBX', extensions: ['json', 'db']}],
    defaultPath: () => getDbxDefaultFile(),
    // anything but a .json file is DBX's data file
    read: file => (/\.json$/i.test(file) ? readJson(file)
      : readDbxConnections(file).then(rows => ({source: 'dbx', conns: parseDbxRows(rows)}))),
  },
  dbeaver: {
    filters: [{name: 'DBeaver', extensions: ['json']}],
    defaultPath: () => getDBeaverDefaultFile(),
    read: readJson,
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
      .then(file => read(file).then((found) => {
        update({source: found.source, file, conns: found.conns, checked: [], error: ''});
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
      <Button onClick={() => pick('dbeaver')}><FormatMessage id='dbConnImport.dbeaver'/></Button>
      <span className={`${currentPrefix}-dbconnect-import-file`} title={state.file}>
        {state.file || FormatMessage.string({id: 'dbConnImport.noFile'})}
      </span>
    </div>
    {state.error && <div className={`${currentPrefix}-dbconnect-import-error`}>
      <FormatMessage id='dbConnImport.readError'/>{state.error}
    </div>}
    {['dbx', 'dbeaver'].includes(state.source) && state.conns.length > 0
      && !state.conns.some(c => c.password)
      && <div className={`${currentPrefix}-dbconnect-import-tip`}>
        <FormatMessage id={`dbConnImport.${state.source}Password`}/>
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
