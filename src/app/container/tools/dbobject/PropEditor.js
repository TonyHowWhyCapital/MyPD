import React from 'react';
import {
  FormatMessage, Input, Select, MultipleSelect, Checkbox, Text, Icon,
} from 'components';

const Option = Select.Option;

const label = key => FormatMessage.string({id: `dbObject.prop.${key}`});

// One editor per registry `editor` kind, so the form needs no per-type branches.
const PropEditor = React.memo(({field, value, onChange, entity, prefix}) => {
  const {editor, options = [], itemFields = []} = field;
  const optionNodes = options.map(o => <Option key={o} value={o}>{o}</Option>);
  switch (editor) {
    case 'select':
      return <Select
        notAllowEmpty
        allowClear={false}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {optionNodes}
      </Select>;
    case 'multiSelect':
      return <MultipleSelect checkValue={value || []} onChange={onChange}>
        {optionNodes}
      </MultipleSelect>;
    case 'fields':
      return <MultipleSelect checkValue={value || []} onChange={onChange}>
        {(entity?.fields || []).map(f => <Option key={f.id} value={f.id}>{f.defKey}</Option>)}
      </MultipleSelect>;
    case 'checkbox':
      return <Checkbox checked={!!value} onChange={e => onChange(e.target.checked)}/>;
    case 'text':
      return <Text value={value || ''} onChange={e => onChange(e.target.value)}/>;
    case 'list': {
      const rows = value || [];
      const newRow = itemFields.reduce((a, f) => ({...a, [f.key]: f.options?.[0] || ''}), {});
      const setRow = (index, key, v) => {
        onChange(rows.map((r, i) => (i === index ? {...r, [key]: v} : r)));
      };
      return <div className={`${prefix}-dbobject-list`}>
        {rows.map((row, index) => <div key={index} className={`${prefix}-dbobject-list-row`}>
          {itemFields.map(f => <span key={f.key} title={label(f.key)}>
            <PropEditor
              prefix={prefix}
              field={f}
              value={row[f.key]}
              onChange={v => setRow(index, f.key, v)}
            />
          </span>)}
          <span onClick={() => onChange(rows.filter((r, i) => i !== index))}><Icon type='fa-times'/></span>
        </div>)}
        <a onClick={() => onChange(rows.concat(newRow))}>
          <FormatMessage id='dbObject.addRow'/>
        </a>
      </div>;
    }
    default:
      return <Input
        type={editor === 'number' ? 'number' : 'text'}
        value={value === undefined || value === null ? '' : `${value}`}
        onChange={e => onChange(e.target.value)}
      />;
  }
});

export default PropEditor;
