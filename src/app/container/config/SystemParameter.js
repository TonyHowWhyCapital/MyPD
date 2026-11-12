import React from 'react';
import {getPrefix} from '../../../lib/prefixUtil';
import JavaHome from './JavaHome';
import SqlDelimiter from './SqlDelimiter';
import RemarkSplit from './RemarkSplit';
import DomainInDdl from './DomainInDdl';
// import DocTemplate from './DocTemplate';
import Language from './Language';
// import Model from './Model';
import AutoSave from './AutoSave';
// import AutoBackup from './AutoBackup';
import Jvm from './JVM';
import RelationType from './RelationType';
import { platform } from '../../../lib/middle';

export default React.memo(({prefix, ...restProps}) => {
  const currentPrefix = getPrefix(prefix);
  return <div className={`${currentPrefix}-setting-system-parameter`}>
    {platform === 'json' && <>
      <JavaHome {...restProps}/>
      <Jvm {...restProps}/>
    </>}
    <AutoSave {...restProps}/>
    {/*<AutoBackup {...restProps}/>*/}
    <SqlDelimiter {...restProps}/>
    <RemarkSplit {...restProps}/>
    <DomainInDdl {...restProps}/>
    {/*<DocTemplate {...restProps}/>*/}
    <Language {...restProps}/>
    {/*<Model {...restProps}/>*/}
    <RelationType {...restProps}/>
  </div>;
});
