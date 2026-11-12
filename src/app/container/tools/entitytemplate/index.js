import React, { useState } from 'react';
import _ from 'lodash';
import { FormatMessage, Input, Select, Checkbox, Button, Message, Modal } from 'components';

import './style/index.less';
import {getPrefix} from '../../../../lib/prefixUtil';
import {
  getEntityTemplates, getEmptyEntityTemplate, saveEntityTemplate, removeEntityTemplate,
  createTemplateFromEntity, getLinkedEntities, syncLinkedEntities,
} from '../../../../lib/entity_template_util';
import {useLeaveGuard, confirmThen} from '../../../../lib/leave_guard';

const emptyField = () => ({
  id: Math.uuid(),
  defKey: '',
  defName: '',
  domain: '',
  type: '',
  len: '',
  scale: '',
  primaryKey: false,
  notNull: false,
});

export default React.memo(({dataSource, updateDataSource, prefix, onCloseGuard}) => {
  const currentPrefix = getPrefix(prefix);
  const [ds, setDs] = useState(dataSource);
  const [current, setCurrent] = useState(null);
  const [fromEntity, setFromEntity] = useState('');
  const templates = getEntityTemplates(ds);
  const domains = ds?.domains || [];
  const persist = (next) => {
    setDs(next);
    updateDataSource && updateDataSource(next);
  };
  const showError = (err) => {
    const codes = err.codes || [];
    Modal.error({
      title: FormatMessage.string({id: 'optFail'}),
      message: codes.length > 0
        ? codes.map(c => FormatMessage.string({id: `entityTemplate.error.${c}`})).join('; ')
        : err.message,
    });
  };
  const run = (fn) => {
    try {
      fn();
    } catch (err) {
      showError(err);
    }
  };
  // A template not yet in the list, or one that differs from its saved copy, is unsaved.
  const dirty = !!current && !_.isEqual(current, templates.find(t => t.id === current.id));
  const leave = useLeaveGuard(dirty, current?.defKey || current?.defName, onCloseGuard);
  const onAdd = () => leave(() => {
    setCurrent(getEmptyEntityTemplate());
  });
  const onFromEntity = () => {
    const entity = (ds?.entities || []).find(e => e.id === fromEntity);
    if (!entity) {
      Message.warring({title: FormatMessage.string({id: 'entityTemplate.needEntity'})});
      return;
    }
    leave(() => setCurrent(createTemplateFromEntity(entity, {
      defKey: `${entity.defKey}_tpl`,
      defName: entity.defName,
    })));
  };
  const onSave = () => run(() => {
    persist(saveEntityTemplate(ds, current));
    Message.success({title: FormatMessage.string({id: 'entityTemplate.saved'})});
  });
  const onRemove = (id) => {
    const template = templates.find(t => t.id === id) || {};
    confirmThen('delete', template.defKey || template.defName, () => run(() => {
      persist(removeEntityTemplate(ds, id));
      if (current?.id === id) setCurrent(null);
    }));
  };
  // Syncing rewrites the columns of every linked table, so it says how many first.
  const onSync = () => {
    const count = getLinkedEntities(ds, current.id).length;
    confirmThen('overwrite', FormatMessage.string({id: 'entityTemplate.syncConfirm', data: {count}}), () => run(() => {
      persist(syncLinkedEntities(ds, current.id));
      Message.success({title: FormatMessage.string({id: 'entityTemplate.synced', data: {count}})});
    }));
  };
  const setProp = (name, value) => setCurrent(pre => ({...pre, [name]: value}));
  const setFieldProp = (id, name, value) => setCurrent(pre => ({
    ...pre,
    fields: pre.fields.map(f => (f.id === id ? {...f, [name]: value} : f)),
  }));
  const onDomainChange = (id, domainId) => {
    const domain = domains.find(d => d.id === domainId);
    setCurrent(pre => ({
      ...pre,
      fields: pre.fields.map(f => (f.id === id ? {
        ...f,
        domain: domainId,
        ...(domain ? {baseType: domain.applyFor, len: domain.len, scale: domain.scale} : {}),
      } : f)),
    }));
  };
  const textCell = (f, name) => (
    <input
      className={`${currentPrefix}-entity-template-cell`}
      value={f[name] === undefined ? '' : f[name]}
      onChange={e => setFieldProp(f.id, name, e.target.value)}
    />
  );
  const itemClass = (id) => {
    const base = `${currentPrefix}-entity-template-list-item`;
    return current?.id === id ? `${base} ${base}-active` : base;
  };
  const addField = () => setCurrent(pre => ({...pre, fields: pre.fields.concat(emptyField())}));
  const removeField = id => setCurrent(pre => ({
    ...pre,
    fields: pre.fields.filter(x => x.id !== id),
  }));
  const linked = current ? getLinkedEntities(ds, current.id) : [];
  const cols = ['defKey', 'defName', 'domain', 'type', 'len', 'scale', 'primaryKey', 'notNull'];
  return <div className={`${currentPrefix}-entity-template`}>
    <div className={`${currentPrefix}-entity-template-list`}>
      <div className={`${currentPrefix}-entity-template-toolbar`}>
        <Button type='primary' onClick={onAdd}><FormatMessage id='entityTemplate.add'/></Button>
      </div>
      <div className={`${currentPrefix}-entity-template-toolbar`}>
        <Select value={fromEntity} onChange={e => setFromEntity(e.target.value)}>
          {(ds?.entities || []).map(e => (
            <Select.Option key={e.id} value={e.id}>{`${e.defKey}(${e.defName || e.defKey})`}</Select.Option>))}
        </Select>
        <Button onClick={onFromEntity}><FormatMessage id='entityTemplate.fromEntity'/></Button>
      </div>
      {templates.length === 0 && <div><FormatMessage id='entityTemplate.empty'/></div>}
      {templates.map(t => (
        <div
          key={t.id}
          className={itemClass(t.id)}
          onClick={() => current?.id !== t.id && leave(() => setCurrent(t))}
        >
          <span>{`${t.defKey}(${t.defName || t.defKey})`}</span>
          <a onClick={(e) => {
            e.stopPropagation();
            onRemove(t.id);
          }}>
            <FormatMessage id='entityTemplate.remove'/>
          </a>
        </div>
      ))}
    </div>
    {current && <div className={`${currentPrefix}-entity-template-editor`}>
      <div className={`${currentPrefix}-entity-template-row`}>
        <span><FormatMessage id='entityTemplate.defKey'/></span>
        <Input value={current.defKey} onChange={e => setProp('defKey', e.target.value)}/>
        <span><FormatMessage id='entityTemplate.defName'/></span>
        <Input value={current.defName || ''} onChange={e => setProp('defName', e.target.value)}/>
        <span><FormatMessage id='entityTemplate.comment'/></span>
        <Input value={current.comment || ''} onChange={e => setProp('comment', e.target.value)}/>
      </div>
      <table className={`${currentPrefix}-entity-template-grid`}>
        <thead>
          <tr>
            {cols.map(c => <th key={c}><FormatMessage id={`entityTemplate.${c}`}/></th>)}
            <th/>
          </tr>
        </thead>
        <tbody>
          {current.fields.map(f => (
            <tr key={f.id}>
              <td>{textCell(f, 'defKey')}</td>
              <td>{textCell(f, 'defName')}</td>
              <td>
                <Select value={f.domain || ''} onChange={e => onDomainChange(f.id, e.target.value)}>
                  {domains.map(d => (
                    <Select.Option key={d.id} value={d.id}>{`${d.defKey}(${d.defName || d.defKey})`}</Select.Option>))}
                </Select>
              </td>
              <td>{textCell(f, 'type')}</td>
              <td>{textCell(f, 'len')}</td>
              <td>{textCell(f, 'scale')}</td>
              <td><Checkbox checked={!!f.primaryKey} onChange={e => setFieldProp(f.id, 'primaryKey', e.target.checked)}/></td>
              <td><Checkbox checked={!!f.notNull} onChange={e => setFieldProp(f.id, 'notNull', e.target.checked)}/></td>
              <td>
                <a onClick={() => removeField(f.id)}>
                  <FormatMessage id='entityTemplate.removeField'/>
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={`${currentPrefix}-entity-template-toolbar`}>
        <Button onClick={addField}>
          <FormatMessage id='entityTemplate.addField'/>
        </Button>
        <Button type='primary' onClick={onSave}><FormatMessage id='entityTemplate.save'/></Button>
      </div>
      <div className={`${currentPrefix}-entity-template-linked`}>
        <div><FormatMessage id='entityTemplate.linked'/></div>
        {linked.length === 0
          ? <div><FormatMessage id='entityTemplate.noLinked'/></div>
          : linked.map(e => <div key={e.id}>{`${e.defKey}(${e.defName || e.defKey})`}</div>)}
        <Button disable={linked.length === 0} onClick={onSync}>
          <FormatMessage id='entityTemplate.sync'/>
        </Button>
      </div>
    </div>}
  </div>;
});
