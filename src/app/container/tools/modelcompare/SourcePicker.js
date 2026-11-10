import React from 'react';
import {Button, FormatMessage, Select} from 'components';
import {getPrefix} from '../../../../lib/prefixUtil';

const Option = Select.Option;

export default React.memo(({prefix, label, value, dbConn, onChange, onPickFile}) => {
  const currentPrefix = getPrefix(prefix);
  const set = patch => onChange({...value, ...patch});
  return (
    <div className={`${currentPrefix}-modelcompare-picker`}>
      <span className={`${currentPrefix}-modelcompare-label`}>{label}</span>
      <Select
        notAllowEmpty
        value={value.kind}
        onChange={e => set({kind: e.target.value})}
      >
        <Option value='current'><FormatMessage id='modelCompare.sourceCurrent'/></Option>
        <Option value='file'><FormatMessage id='modelCompare.sourceFile'/></Option>
        <Option value='db'><FormatMessage id='modelCompare.sourceDb'/></Option>
      </Select>
      {value.kind === 'file' && <span>
        <Button onClick={onPickFile}><FormatMessage id='modelCompare.chooseFile'/></Button>
        <span className={`${currentPrefix}-modelcompare-file`}>
          {value.filePath || FormatMessage.string({id: 'modelCompare.noFile'})}
        </span>
      </span>}
      {value.kind === 'db' && <Select
        value={value.dbKey || ''}
        onChange={e => set({dbKey: e.target.value})}
      >
        {dbConn.map(d => <Option key={d.defKey} value={d.defKey}>{d.defKey}</Option>)}
      </Select>}
    </div>
  );
});
