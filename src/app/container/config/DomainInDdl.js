import React, {useState} from 'react';
import { Checkbox, FormatMessage } from 'components';
import {getPrefix} from '../../../lib/prefixUtil';
import {domainInDdl} from '../../../lib/column_domain';

export default React.memo(({ prefix, dataSource, dataChange }) => {
  const [checked, setChecked] = useState(domainInDdl(dataSource));
  const onChange = (e) => {
    setChecked(e.target.checked);
    dataChange && dataChange(e.target.checked, 'profile.sql.domainInDdl');
  };
  const currentPrefix = getPrefix(prefix);
  return <div className={`${currentPrefix}-setting-domain-ddl`}>
    <div className={`${currentPrefix}-form-item`}>
      <span
        className={`${currentPrefix}-form-item-label`}
        title={FormatMessage.string({id: 'config.domainInDdlLabel'})}
      >
        <FormatMessage id='config.domainInDdlLabel'/>
      </span>
      <span className={`${currentPrefix}-form-item-component`}>
        <Checkbox checked={checked} onChange={onChange}>
          <FormatMessage id='config.domainInDdlTip'/>
        </Checkbox>
      </span>
    </div>
  </div>;
});
