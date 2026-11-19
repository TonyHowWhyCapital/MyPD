import React, { useEffect, useState } from 'react';
import {FormatMessage} from 'components';
import _ from 'lodash';
import {readJsonPromise} from '../../../../lib/middle';
import {getPrefix} from '../../../../lib/prefixUtil';
import {postWorkerFuc} from '../../../../lib/event_tool';
import {diffRows} from '../../../../lib/compare_diff_rows';
import DiffTable from '../../../../components/compare/CompareDiffTable';

export default React.memo(({files, prefix, dataSource, config, openLoading, closeLoading}) => {
    const [data, setData] = useState('');
    const [rows, setRows] = useState([]);
    useEffect(() => {
        openLoading(FormatMessage.string({id: 'versionData.check'}));
        Promise.all(files
            .filter(f => !!f)
            .map(f => readJsonPromise(f.path))).then((result) => {
                const pre = result[1] ? result[0] : {entities: [], views: []};
                const curr = result[1] || result[0];
            const currentDb = _.get(dataSource, 'profile.default.db',
                _.get(dataSource, 'profile.dataTypeSupports[0].id'));
            postWorkerFuc('dataSourceVersion.packageChanges', true,
                [curr, pre, currentDb]).then((c) => {
                setRows(diffRows(c));
                if(c.length === 0) {
                    setData('');
                    closeLoading();
                } else {
                    postWorkerFuc('dataSourceVersion.getMessageByChanges', true,
                        [c, dataSource, config.lang]).then((m) => {
                        setData(m);
                    }).finally(() => {
                        closeLoading();
                    });
                }
            }).catch(() => {
                closeLoading();
            });
        });
    }, []);
    const currentPrefix = getPrefix(prefix);
    if (!data) {
      return <pre className={`${currentPrefix}-history-log`}>
        <div style={{textAlign: 'center'}}>{FormatMessage.string({id: 'operationsHistory.emptyLog'})}</div>
      </pre>;
    }
    return <div className={`${currentPrefix}-history-log-body`}>
      <div className={`${currentPrefix}-history-log-diff`}>
        <DiffTable prefix={prefix} rows={rows} mode='version'/>
      </div>
      <pre className={`${currentPrefix}-history-log`}>{data}</pre>
    </div>;
});
