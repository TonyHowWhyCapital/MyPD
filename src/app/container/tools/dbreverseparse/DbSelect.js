import React, {useEffect, useRef, useState} from 'react';

import { Select, FormatMessage } from 'components';
import {getPrefix} from '../../../../lib/prefixUtil';
import {listDatabases} from '../../../../lib/middle';
import {
  canChooseDatabase, databaseOfUrl, withDatabase, userDatabases,
} from '../../../../lib/db_database';

// connection properties pointing at the database chosen for this run
export const connProperties = (conn, database) => {
  const properties = conn?.properties || {};
  return database ? {...properties, url: withDatabase(properties.url, database)} : properties;
};

export default React.memo(({prefix, dataSource, config, dbChange}) => {
  const Option = Select.Option;
  const dbConn = dataSource?.dbConn || [];
  const defaultConn = dataSource?.profile?.default?.dbConn || dbConn[0].defKey;
  const currentPrefix = getPrefix(prefix);
  const [connKey, setConnKey] = useState(defaultConn);
  const [databases, setDatabases] = useState({status: '', names: [], error: ''});
  const [database, setDatabase] = useState('');
  const requestRef = useRef(0);
  const url = dbConn.find(d => d.defKey === connKey)?.properties?.url || '';
  const chooseDatabase = (value) => {
    setDatabase(value);
    dbChange({target: {value}}, 'database');
  };
  const load = () => {
    const properties = dbConn.find(d => d.defKey === connKey)?.properties;
    if (!properties || !canChooseDatabase(properties.url)) {
      return;
    }
    requestRef.current += 1;
    const request = requestRef.current;
    setDatabases({status: 'loading', names: [], error: ''});
    listDatabases(dataSource, config, properties).then((names) => {
      request === requestRef.current
        && setDatabases({status: 'ok', names: userDatabases(properties.url, names), error: ''});
    }).catch((err) => {
      request === requestRef.current
        && setDatabases({status: 'failed', names: [], error: err.message || `${err}`});
    });
  };
  useEffect(() => {
    chooseDatabase(databaseOfUrl(url));
    load();
  }, [connKey]);
  const connChange = (e) => {
    dbChange(e, 'defKey');
    setConnKey(e.target.value);
  };
  const itemClass = `${currentPrefix}-dbreverseparse-db-select-item`;
  // the database of the url stays selectable even while the list is unavailable
  const options = databases.names.concat(
    database && !databases.names.includes(database) ? database : []);
  return <div className={`${currentPrefix}-dbreverseparse-db-select`}>
    <div className={itemClass}>
      <span
        className={`${itemClass}-label`}
        title={FormatMessage.string({id: 'dbReverseParse.dbSelect'})}
      >
        <FormatMessage id='dbReverseParse.dbSelect'/>
      </span>
      <span className={`${itemClass}-component`}>
        <Select defaultValue={defaultConn} notAllowEmpty allowClear={false} onChange={connChange}>
          {dbConn.map(d => (<Option key={d.defKey} value={d.defKey}>{d.defName}</Option>))}
        </Select>
      </span>
    </div>
    {canChooseDatabase(url) && <div className={itemClass}>
      <span className={`${itemClass}-label`} title={FormatMessage.string({id: 'dbDatabase.label'})}>
        <FormatMessage id='dbDatabase.label'/>
      </span>
      <span className={`${itemClass}-component`}>
        <Select value={database} allowClear={false} onChange={e => chooseDatabase(e.target.value)}>
          {options.map(n => (<Option key={n} value={n}>{n}</Option>))}
        </Select>
        <div className={`${itemClass}-tip`}>
          {databases.status === 'loading' && <FormatMessage id='dbDatabase.loading'/>}
          {databases.status === 'failed' && <span className={`${itemClass}-error`} title={databases.error}>
            <FormatMessage id='dbDatabase.failed'/>{databases.error}
          </span>}
          {databases.status === 'ok' && !database && <FormatMessage id='dbDatabase.none'/>}
          {databases.status !== 'loading' && <a onClick={load}><FormatMessage id='dbDatabase.reload'/></a>}
        </div>
      </span>
    </div>}
    <div className={itemClass}>
      <span
        className={`${itemClass}-label`}
        title={FormatMessage.string({id: 'dbReverseParse.nameFormat'})}
      >
        <FormatMessage id='dbReverseParse.nameFormat'/>
      </span>
      <span className={`${itemClass}-component`}>
        <Select
          defaultValue='DEFAULT'
          notAllowEmpty
          allowClear={false}
          onChange={e => dbChange(e, 'flag')}
        >
          <Option value='UPPERCASE' key='UPPERCASE'>
            <FormatMessage id='dbReverseParse.nameFormatType.UPPERCASE'/>
          </Option>
          <Option value='LOWCASE' key='LOWCASE'>
            <FormatMessage id='dbReverseParse.nameFormatType.LOWCASE'/>
          </Option>
          <Option value='DEFAULT' key='DEFAULT'>
            <FormatMessage id='dbReverseParse.nameFormatType.DEFAULT'/>
          </Option>
        </Select>
      </span>
    </div>
  </div>;
});
