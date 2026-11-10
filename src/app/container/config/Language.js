import React, { useContext } from 'react';
import { Select, FormatMessage } from 'components';
import { langType, langAuto, getSystemLang } from '../../../lib/variable';
import { ConfigContent } from '../../../lib/context';
import {getPrefix} from '../../../lib/prefixUtil';

export default React.memo(({prefix, dataChange}) => {
  const { lang, langSetting } = useContext(ConfigContent);
  const Option = Select.Option;
  const onChange = (e) => {
    const value = e.target.value;
    dataChange && dataChange(value === langAuto ? getSystemLang() : value, 'lang');
    dataChange && dataChange(value, 'langSetting');
  };
  const currentPrefix = getPrefix(prefix);
  return <div className={`${currentPrefix}-setting-language`}>
    <div className={`${currentPrefix}-form-item`}>
      <span
        className={`${currentPrefix}-form-item-label`}
        title={FormatMessage.string({id: 'config.language.label'})}
      >
        <FormatMessage id='config.language.label'/>
      </span>
      <span className={`${currentPrefix}-form-item-component`}>
        <Select allowClear={false} notAllowEmpty defaultValue={langSetting || lang} onChange={onChange} >
          {[langAuto].concat(langType)
              .map(l => (<Option
                  key={l}
                  value={l}
              >
                {FormatMessage.string({id: `config.language.${l}`})}
              </Option>))}
        </Select>
      </span>
    </div>
  </div>
});
