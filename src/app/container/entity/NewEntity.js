import React, { useState, useRef, useEffect } from 'react';
import _ from 'lodash/object';

import {
  Input,
  MultipleSelect,
  FormatMessage,
  Select,
  openModal,
  Button,
  Checkbox,
} from 'components';
import {getPrefix} from '../../../lib/prefixUtil';
import {getEntityTemplates, instantiateTemplateFields} from '../../../lib/entity_template_util';

export default React.memo(({prefix, dataSource, dataChange, isNewView,
                             BaseExtraCom, disableExtend = false, data}) => {
  const entityInitFields = _.get(dataSource, 'profile.default.entityInitFields', [])
    .map(f => ({...f, id: Math.uuid()}));
  const Option = MultipleSelect.Option;
  const currentPrefix = getPrefix(prefix);
  const [type, setType] = useState('1');
  const [extendFields, setExtendFields] = useState([]);
  const currentParent = useRef(null);
  const templates = isNewView || disableExtend ? [] : getEntityTemplates(dataSource);
  const [templateId, setTemplateId] = useState('');
  const [keepLink, setKeepLink] = useState(false);
  const onParentEntityChange = (e) => {
    currentParent.current = e.target.value;
    const entityData = (dataSource?.entities || [])
        .filter(entity => entity.id === e.target.value)[0];
    const defaultFields = (entityData?.fields || []).filter(f => f.primaryKey);
    setExtendFields(defaultFields);
  };
  const onChange = (e) => {
    setType(e.target.value);
    setExtendFields([]);
  };
  useEffect(() => {
    if (type === '3') {
      const template = templates.find(t => t.id === templateId);
      dataChange(template ? instantiateTemplateFields(template, {keepLink}) : [], 'fields', '');
      dataChange(template && keepLink ? template.id : undefined, 'templateRef');
      return;
    }
    if (!isNewView && !disableExtend) dataChange(undefined, 'templateRef');
    if (type === '1') {
      dataChange(entityInitFields, 'fields', '');
    } else {
      dataChange(extendFields.map(f => ({...f, id: Math.uuid()})), 'fields', currentParent.current);
    }
  }, [type, extendFields, templateId, keepLink]);
  const pickerFields = () => {
    const entity = (dataSource?.entities || []).filter(e => e.id === currentParent.current)[0];
    let modal = null;
    let checkedFields = [...extendFields];
    const checkChange = (e, f) => {
      if (e.target.checked &&
          !checkedFields.findIndex(field => f.id === field.id) >= 0) {
        checkedFields.push(f);
      } else if (!e.target.checked &&
          checkedFields.findIndex(field => f.id === field.id) >= 0) {
        checkedFields = checkedFields.filter(field => field.id !== f.id);
      }
    };
    const onOK = () => {
      setExtendFields(checkedFields);
      dataChange(checkedFields, 'fields');
      modal.close();
    };
    const onCancel = () => {
      modal.close();
    };
    modal = openModal(<div className={`${currentPrefix}-entity-fields-right-import`}>{
      entity?.fields?.map(f => (
        <div
          key={f.id}
              >
          <Checkbox
            defaultChecked={extendFields.findIndex(field => f.id === field.id) >= 0}
            onChange={e => checkChange(e, f)}
          />
          {`${f.defKey}[${f.defName}]`}
        </div>
          ))
    }</div>, {
      title: FormatMessage.string({id: 'tableBase.selectFields'}),
      buttons: [
        <Button key='onOK' onClick={onOK} type='primary'>
          <FormatMessage id='button.ok'/>
        </Button>,
        <Button key='onCancel' onClick={onCancel}>
          <FormatMessage id='button.cancel'/>
        </Button>,
      ],
    });
  };
  return <div className={`${currentPrefix}-new-entity`}>
    <div className={`${currentPrefix}-form`}>
      <div className={`${currentPrefix}-form-item`}>
        <span
          className={`${currentPrefix}-form-item-label`}
          title={FormatMessage.string({id: `${!isNewView ? 'tableBase' : 'viewBase'}.defKey`})}
        >
          <span className={`${currentPrefix}-form-item-label-require`}>{}</span>
          <span>
            <FormatMessage id={`${!isNewView ? 'tableBase' : 'viewBase'}.defKey`}/>
          </span>
        </span>
        <span className={`${currentPrefix}-form-item-component`}>
          <Input
            toggleCase
            maxLength={64}
            placeholder={FormatMessage.string({id: `${!isNewView ? 'tableBase.tableName' : 'viewBase.viewName'}`})}
            onChange={e => dataChange(e.target.value, 'defKey')}
          />
        </span>
      </div>
      <div className={`${currentPrefix}-form-item`}>
        <span
          className={`${currentPrefix}-form-item-label`}
          title={FormatMessage.string({id: `${!isNewView ? 'tableBase' : 'viewBase'}.defName`})}
        >
          <FormatMessage id={`${!isNewView ? 'tableBase' : 'viewBase'}.defName`}/>
        </span>
        <span className={`${currentPrefix}-form-item-component`}>
          <Input
            maxLength={32}
            placeholder={FormatMessage.string({id: `${!isNewView ? 'tableBase.tableTitle' : 'viewBase.viewTitle'}`})}
            onChange={e => dataChange(e.target.value, 'defName')}/>
        </span>
      </div>
      {
        !disableExtend && <div className={`${currentPrefix}-form-item`}>
          <span
            className={`${currentPrefix}-form-item-label`}
            title={FormatMessage.string({id: 'tableBase.type'})}
        >
            <FormatMessage id='tableBase.type'/>
          </span>
          <span className={`${currentPrefix}-form-item-component`}>
            <Select defaultValue="1" onChange={onChange} notAllowEmpty>
              {
                // Select 的子节点必须全部是 Option，不能出现 false
                [['1', 'tableBase.empty'], ['2', 'tableBase.extend']]
                  .concat(templates.length > 0 ? [['3', 'entityTemplate.fromTemplate']] : [])
                  .map(([value, id]) => (
                    <Select.Option value={value} key={value}>
                      {FormatMessage.string({id})}
                    </Select.Option>))
              }
            </Select>
          </span>
        </div>
      }
      {
        type === '2' && <>
          <div className={`${currentPrefix}-form-item`}>
            <span
              className={`${currentPrefix}-form-item-label`}
              title={FormatMessage.string({id: 'tableBase.parent'})}
        >
              <FormatMessage id='tableBase.parent'/>
            </span>
            <span className={`${currentPrefix}-form-item-component`}>
              <Select onChange={onParentEntityChange}>
                {
              (dataSource?.entities || []).map((e) => {
                return <Select.Option
                  value={e.id}
                  key={e.id}>
                  {`${e.defKey}(${e.defName})`}
                </Select.Option>;
              })
            }
              </Select>
            </span>
          </div>
          <div className={`${currentPrefix}-form-item`}>
            <span
              className={`${currentPrefix}-form-item-label`}
              title={FormatMessage.string({id: 'tableBase.parentFields'})}
        >
              <FormatMessage id='tableBase.parentFields'/>
            </span>
            <span className={`${currentPrefix}-form-item-component`}>
              <a onClick={pickerFields}>
                <FormatMessage id='tableBase.parentFieldsCount' data={{count: extendFields.length}}/>
              </a>
            </span>
          </div>
        </>
      }
      {
        type === '3' && <>
          <div className={`${currentPrefix}-form-item`}>
            <span className={`${currentPrefix}-form-item-label`}>
              <FormatMessage id='entityTemplate.template'/>
            </span>
            <span className={`${currentPrefix}-form-item-component`}>
              <Select value={templateId} onChange={e => setTemplateId(e.target.value)}>
                {templates.map(t => (
                  <Select.Option value={t.id} key={t.id}>{`${t.defKey}(${t.defName || t.defKey})`}</Select.Option>
                ))}
              </Select>
            </span>
          </div>
          <div className={`${currentPrefix}-form-item`}>
            <span className={`${currentPrefix}-form-item-label`}/>
            <span className={`${currentPrefix}-form-item-component`}>
              <Checkbox checked={keepLink} onChange={e => setKeepLink(e.target.checked)}>
                <FormatMessage id='entityTemplate.keepLink'/>
              </Checkbox>
            </span>
          </div>
        </>
      }
      <div className={`${currentPrefix}-form-item`}>
        <span
          className={`${currentPrefix}-form-item-label`}
          title={FormatMessage.string({id: 'tableBase.group'})}
        >
          <FormatMessage id='tableBase.group'/>
        </span>
        <span className={`${currentPrefix}-form-item-component`}>
          <MultipleSelect
            onChange={keys => dataChange(keys, 'group')}
            defaultCheckValues={data?.group}
          >
            {
              dataSource?.viewGroups?.map(v => (
                <Option key={v.id} value={v.id}>{`${v.defKey}(${v.defName || v.defKey})`}</Option>))
            }
          </MultipleSelect>
        </span>
      </div>
      {BaseExtraCom && <BaseExtraCom
        prefix={currentPrefix}
        dataSource={dataSource}
        onChange={value => dataChange(value, 'refEntities')}
      />}
    </div>
  </div>;
});
