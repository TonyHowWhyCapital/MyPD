import React, { useState } from 'react';
import {
  Input, MultipleSelect, Select, Button, Icon, FormatMessage,
} from 'components';
import { getPrefix } from '../../../lib/prefixUtil';
import './style/keys.less';

const Option = Select.Option;
const text = id => FormatMessage.string({ id: `tableKeys.${id}` });

// The keys of a table: its primary key, whose columns are the ones ticked as primary in
// the column list, and any other set of columns that must be unique.
export default React.memo(({ prefix, data, dataChange }) => {
  const cls = `${getPrefix(prefix)}-entity-keys`;
  const fields = data?.fields || [];
  const [keys, setKeys] = useState(data?.keys || []);
  const update = (next) => {
    setKeys(next);
    dataChange && dataChange(next, 'keys');
  };
  const patch = (id, change) => update(keys.map(k => (k.id === id ? { ...k, ...change } : k)));
  const add = () => {
    const name = `AK_${data?.defKey || ''}_${keys.filter(k => !k.primary).length + 1}`;
    update(keys.concat({
      id: Math.uuid(), defKey: name, defName: name, constraintName: '', primary: false, fields: [],
    }));
  };
  const primaryColumns = fields.filter(f => f.primaryKey).map(f => f.defKey).join(', ');
  return <div className={cls}>
    <div className={`${cls}-bar`}>
      <Button onClick={add}><Icon type='fa-plus'/>{text('add')}</Button>
      <span>{text('hint')}</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>{text('kind')}</th>
          <th>{text('defName')}</th>
          <th>{text('defKey')}</th>
          <th>{text('constraintName')}</th>
          <th>{text('columns')}</th>
          <th>{}</th>
        </tr>
      </thead>
      <tbody>
        {keys.map(k => <tr key={k.id}>
          <td>{text(k.primary ? 'primary' : 'alternate')}</td>
          <td><Input defaultValue={k.defName || ''} onChange={e => patch(k.id, { defName: e.target.value })}/></td>
          <td><Input defaultValue={k.defKey || ''} onChange={e => patch(k.id, { defKey: e.target.value })}/></td>
          <td><Input defaultValue={k.constraintName || ''} onChange={e => patch(k.id, { constraintName: e.target.value })}/></td>
          <td>{k.primary
            ? <span className={`${cls}-fixed`} title={text('primaryHint')}>{primaryColumns}</span>
            : <MultipleSelect
                checkValue={(k.fields || []).filter(id => fields.some(f => f.id === id))}
                onChange={value => patch(k.id, { fields: value })}
            >
              {fields.map(f => <Option key={f.id} value={f.id}>{f.defKey}</Option>)}
            </MultipleSelect>}
          </td>
          <td>{!k.primary && <a title={text('remove')} onClick={() => update(keys.filter(o => o.id !== k.id))}>
            <Icon type='fa-trash-o'/>
          </a>}</td>
        </tr>)}
        {keys.length === 0 && <tr><td colSpan={6} className={`${cls}-empty`}>{text('empty')}</td></tr>}
      </tbody>
    </table>
  </div>;
});
