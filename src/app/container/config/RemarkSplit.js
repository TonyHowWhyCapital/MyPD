import React, {useState} from 'react';
import { Input, Checkbox, FormatMessage } from 'components';
import {getPrefix} from '../../../lib/prefixUtil';
import {remarkSetting} from '../../../lib/remark';

export default React.memo(({ prefix, dataSource, dataChange }) => {
  const setting = remarkSetting(dataSource);
  const [split, setSplit] = useState(setting.split);
  const onSplit = (e) => {
    setSplit(e.target.checked);
    dataChange && dataChange(e.target.checked, 'profile.sql.remarkSplit');
  };
  const onSeparator = (e) => {
    dataChange && dataChange(e.target.value, 'profile.sql.remarkSeparator');
  };
  const currentPrefix = getPrefix(prefix);
  return <div className={`${currentPrefix}-setting-remark-split`}>
    <div className={`${currentPrefix}-form-item`}>
      <span
        className={`${currentPrefix}-form-item-label`}
        title={FormatMessage.string({id: 'config.remarkSplitLabel'})}
      >
        <FormatMessage id='config.remarkSplitLabel'/>
      </span>
      <span className={`${currentPrefix}-form-item-component`}>
        <Checkbox checked={split} onChange={onSplit}>
          <FormatMessage id='config.remarkSplitTip'/>
        </Checkbox>
      </span>
    </div>
    <div className={`${currentPrefix}-form-item`}>
      <span
        className={`${currentPrefix}-form-item-label`}
        title={FormatMessage.string({id: 'config.remarkSeparatorLabel'})}
      >
        <FormatMessage id='config.remarkSeparatorLabel'/>
      </span>
      <span className={`${currentPrefix}-form-item-component`}>
        <Input
          keepSpaces
          onChange={onSeparator}
          defaultValue={setting.separator}
          placeholder={FormatMessage.string({id: 'config.remarkSeparatorTip'})}
        />
      </span>
    </div>
  </div>;
});
