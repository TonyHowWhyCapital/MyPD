import React, { useState } from 'react';
import {
  FormatMessage, Select, Input, Button, Message,
} from 'components';

import './style/index.less';
import { getPrefix } from '../../../../lib/prefixUtil';
import {
  analyzeImpact, createImpactModel, saveImpactModel, removeImpactModel,
  getImpactModels, ACTION_TYPES,
} from '../../../../lib/impact_util';
import ImpactTable from './ImpactTable';
import {confirmThen} from '../../../../lib/leave_guard';

const Option = Select.Option;
const t = id => FormatMessage.string({ id });

export default React.memo(({ prefix, dataSource, updateDataSource }) => {
  const currentPrefix = getPrefix(prefix);
  const [ds, setDs] = useState(dataSource);
  const [form, setForm] = useState({
    type: 'deleteEntity', entityId: '', fieldId: '', newType: '', len: '', scale: '',
  });
  const [result, setResult] = useState(null);
  const [name, setName] = useState('');
  const [reviewing, setReviewing] = useState(null);
  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v, ...(k === 'entityId' ? { fieldId: '' } : {}) }));
    setResult(null);
  };
  const entity = (ds.entities || []).find(e => e.id === form.entityId);
  const needField = form.type !== 'deleteEntity';
  const buildAction = () => ({
    type: form.type,
    entityId: form.entityId,
    fieldId: needField ? form.fieldId : undefined,
    after: form.type === 'changeFieldType' ? { type: form.newType, len: form.len, scale: form.scale } : undefined,
  });
  const run = (fn) => {
    try {
      return fn();
    } catch (e) {
      Message.error({ title: e.message });
      return null;
    }
  };
  const preview = () => {
    const r = run(() => analyzeImpact(ds, buildAction()));
    if (r) {
      setReviewing(null);
      setResult(r);
    }
  };
  const save = () => {
    const m = run(() => createImpactModel(ds, buildAction(), { defName: name }));
    if (m) {
      const next = saveImpactModel(ds, m);
      setDs(next);
      updateDataSource && updateDataSource(next);
      setName('');
      Message.success({ title: t('impact.saved') });
    }
  };
  const drop = (id) => {
    const next = removeImpactModel(ds, id);
    setDs(next);
    updateDataSource && updateDataSource(next);
    if (reviewing && reviewing.id === id) {
      setReviewing(null);
    }
  };
  const remove = (id) => {
    const model = getImpactModels(ds).find(m => m.id === id) || {};
    confirmThen('delete', model.defName || '', () => drop(id));
  };

  const models = getImpactModels(ds);
  const shown = reviewing ? { items: reviewing.items, action: reviewing.action } : result;
  return <div className={`${currentPrefix}-impact`}>
    <div className={`${currentPrefix}-impact-list`}>
      <div className={`${currentPrefix}-impact-title`}>{t('impact.savedList')}</div>
      {models.length === 0 && <div className={`${currentPrefix}-impact-empty`}>{t('impact.empty')}</div>}
      {models.map(m => <div
        key={m.id}
        className={`${currentPrefix}-impact-list-item ${reviewing?.id === m.id ? `${currentPrefix}-impact-list-item-active` : ''}`}
        onClick={() => { setResult(null); setReviewing(m); }}
      >
        <span>{m.defName}<span className={`${currentPrefix}-impact-time`}>{m.createdTime}</span></span>
        <a onClick={(e) => { e.stopPropagation(); remove(m.id); }}>{t('impact.remove')}</a>
      </div>)}
    </div>
    <div className={`${currentPrefix}-impact-main`}>
      <div className={`${currentPrefix}-impact-title`}>{t('impact.newAnalysis')}</div>
      <div className={`${currentPrefix}-impact-form`}>
        <span>{t('impact.actionType')}</span>
        <Select notAllowEmpty value={form.type} onChange={e => set('type', e.target.value)}>
          {ACTION_TYPES.map(a => <Option key={a} value={a}>{t(`impact.action.${a}`)}</Option>)}
        </Select>
        <span>{t('impact.entity')}</span>
        <Select value={form.entityId} onChange={e => set('entityId', e.target.value)}>
          {(ds.entities || []).map(e => <Option key={e.id} value={e.id}>{`${e.defKey}${e.defName ? `[${e.defName}]` : ''}`}</Option>)}
        </Select>
        {needField && <span>{t('impact.field')}</span>}
        {needField && <Select value={form.fieldId} onChange={e => set('fieldId', e.target.value)}>
          {(entity?.fields || []).map(f => <Option key={f.id} value={f.id}>{`${f.defKey}${f.defName ? `[${f.defName}]` : ''}`}</Option>)}
        </Select>}
        {form.type === 'changeFieldType' && <span>{t('impact.newType')}</span>}
        {form.type === 'changeFieldType' && <span className={`${currentPrefix}-impact-type`}>
          <Input value={form.newType} onChange={e => set('newType', e.target.value)}/>
          <Input placeholder={t('impact.newLen')} value={form.len} onChange={e => set('len', e.target.value)}/>
          <Input placeholder={t('impact.newScale')} value={form.scale} onChange={e => set('scale', e.target.value)}/>
        </span>}
      </div>
      <div className={`${currentPrefix}-impact-actions`}>
        <Button type='primary' onClick={preview}>{t('impact.preview')}</Button>
      </div>
      {shown && <ImpactTable prefix={currentPrefix} items={shown.items}/>}
      {result && <div className={`${currentPrefix}-impact-actions`}>
        <Input placeholder={t('impact.name')} value={name} onChange={e => setName(e.target.value)}/>
        <Button type='primary' onClick={save}>{t('impact.save')}</Button>
      </div>}
    </div>
  </div>;
});
