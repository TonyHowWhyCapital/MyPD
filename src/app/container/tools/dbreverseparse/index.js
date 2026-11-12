import React, {useState, useMemo, useRef} from 'react';
import {Step, Button, FormatMessage, openModal, Message} from 'components';
import {pickNewGroups} from '../../../../components/listgroupselect/newGroup';

import DbSelect, {connProperties} from './DbSelect';
import ParseDb from './ParseDb';
import DealData from './DealData';
import DealProgress from './DealProgress';
import './style/index.less';
import {getPrefix} from '../../../../lib/prefixUtil';
import {listColumnDomains} from '../../../../lib/middle';
import {canCarryDomains, applyColumnDomains} from '../../../../lib/column_domain';

export default React.memo(({prefix, dataSource, dataChange, config, onClose, onOk}) => {
  const dealDataRef = useRef(null);
  const [currentKey, updateCurrentKey] = useState(1);
  const parseDbRef = useRef(null);
  const dbConn = dataSource?.dbConn || [];
  const defaultConn = dataSource?.profile?.default?.dbConn || dbConn[0].defKey;
  const dbData = useMemo(() => ({
    defKey: defaultConn,
    flag: 'DEFAULT',
  }), []);
  const parseData = useMemo(() => ({}), []);
  const next = () => {
    updateCurrentKey(currentKey + 1);
    if (parseDbRef.current) {
      parseDbRef.current.parser();
    }
  };
  const dbChange = (e, name) => {
    dbData[name] = e.target.value;
    if (name === 'defKey') {
      dbData.database = '';
    }
  };
  const getDbData = () => {
    return dbData;
  };
  const getData = () => {
    return parseData;
  };
  const parseError = () => {
    updateCurrentKey(1);
  };
  const parseFinish = (data) => {
    parseData.data = data;
    updateCurrentKey(3);
    dealDataRef.current?.refresh();
  };
  const pre = () => {
    updateCurrentKey(1);
  };
  const onOK = async () => {
    let modal;
    const onCloseModal = () => {
      modal && modal.close();
      //onClose && onClose();
    };
    const currentConn = dbConn.filter(d => d.defKey === dbData.defKey)[0];
    const groups = dealDataRef.current.getData();
    const selectedTable = groups
        .reduce((a, b) => a.concat(b.fields.map(f => ({...f, group: b.id}))), []);
    const properties = connProperties(currentConn, dbData.database);
    // 数据库中记录的字段数据域只读取一次，读取失败不影响逆向
    let domainRows;
    const withDomains = (data) => {
      if (!canCarryDomains(properties.url)) {
        return Promise.resolve(data);
      }
      domainRows = domainRows
        || listColumnDomains(dataSource, config, properties).catch(() => {
        Message.warring({title: FormatMessage.string({id: 'pdm.domainReadFail'})});
        return [];
      });
      return domainRows.then(rows => applyColumnDomains(data, rows));
    };
    modal = openModal(<DealProgress
      dbData={dbData}
      currentDb={{...currentConn, properties}}
      dataSource={dataSource}
      config={config}
      selectedTable={selectedTable}
      onOk={data => withDomains(data)
        .then(d => onOk(d, dbData.defKey, pickNewGroups(groups)))}
      onClose={onCloseModal}
    />,  {
      header: <div />,
      closeable: false,
      bodyStyle: { width: '85%' },
      title: FormatMessage.string({id: 'toolbar.exportWord'}),
    });
  };
  const currentPrefix = getPrefix(prefix);
  return <div className={`${currentPrefix}-dbreverseparse-db`}>
    <Step
      currentKey={currentKey}
      options={[
        {
          title: FormatMessage.string({id: 'dbReverseParse.dbSelectTitle'}),
          content: <DbSelect
            prefix={prefix}
            dataSource={dataSource}
            config={config}
            dbChange={dbChange}
          />,
          key: 1,
        },
        {
          title: FormatMessage.string({id: 'dbReverseParse.parseDbTitle'}),
          content: <ParseDb
            config={config}
            ref={parseDbRef}
            parseError={parseError}
            getDbData={getDbData}
            prefix={prefix}
            dataSource={dataSource}
            parseFinish={parseFinish}
          />,
          key: 2,
        },
        {title: FormatMessage.string({id: 'dbReverseParse.selectEntity'}),
          content: <DealData
            ref={dealDataRef}
            dataChange={dataChange}
            getData={getData}
            prefix={prefix}
            dataSource={dataSource}
          />,
          key: 3,
        },
        ]}
    />
    <div className={`${currentPrefix}-dbreverseparse-db-opt`}>
      <Button key='onClose' onClick={onClose}>
        <FormatMessage id='button.close'/>
      </Button>
      <Button onClick={next} style={{display: currentKey === 1 ? '' : 'none'}}>
        <FormatMessage id='dbReverseParse.next'/>
      </Button>
      <Button onClick={pre} style={{display: currentKey === 3 ? '' : 'none'}}>
        <FormatMessage id='dbReverseParse.pre'/>
      </Button>
      <Button type='primary' onClick={onOK} style={{display: currentKey === 3 ? '' : 'none'}}>
        <FormatMessage id='button.ok'/>
      </Button>
    </div>
  </div>;
});
