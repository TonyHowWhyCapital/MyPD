import React, {useState, useMemo} from 'react';
import {FormatMessage, Input, Select, Button, CodeEditor, Message} from 'components';

import PropEditor from './PropEditor';
import './style/index.less';
import {getPrefix} from '../../../../lib/prefixUtil';
import {
  dbObjectTypes, getDbObjectTypeList, getEmptyDbObject, addDbObject,
  updateDbObject, removeDbObject, getDbObjectDDL,
} from '../../../../lib/dbobject_util';

const Option = Select.Option;

export default React.memo(({
  prefix, dataSource: initDataSource, getDataSource, updateDataSource,
}) => {
  const currentPrefix = getPrefix(prefix);
  const [dataSource, setDataSource] = useState(
    () => (getDataSource ? getDataSource() : initDataSource),
  );
  const [filter, setFilter] = useState('all');
  const [draft, setDraft] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const supports = dataSource.profile?.dataTypeSupports || [];
  const [dbId, setDbId] = useState(dataSource.profile?.default?.db || supports[0]?.id);
  const objects = dataSource.dbObjects || [];
  const types = getDbObjectTypeList();
  const shown = objects.filter(o => filter === 'all' || o.type === filter);
  const entities = (dataSource.entities || []).concat(dataSource.views || []);
  const def = draft && dbObjectTypes[draft.type];
  const entity = draft && entities.find(e => e.id === draft.refEntity);
  const preview = useMemo(() => {
    if (!draft) {
      return '';
    }
    try {
      return getDbObjectDDL(draft, dataSource, dbId);
    } catch (e) {
      return `-- ${e.message}`;
    }
  }, [draft, dataSource, dbId]);

  const select = (obj) => {
    setDraft(obj);
    setIsNew(false);
  };
  const add = () => {
    setDraft(getEmptyDbObject(filter === 'all' ? types[0] : filter));
    setIsNew(true);
  };
  const setField = (key, value) => setDraft(pre => ({...pre, [key]: value}));
  const setProp = (key, value) => setDraft(pre => ({...pre, props: {...pre.props, [key]: value}}));
  const changeType = type => setDraft(pre => ({...pre, type, props: getEmptyDbObject(type).props}));
  const apply = (next) => {
    updateDataSource && updateDataSource(next);
    setDataSource(next);
  };
  const save = () => {
    try {
      apply(isNew ? addDbObject(dataSource, draft) : updateDbObject(dataSource, draft));
      setIsNew(false);
      Message.success({title: FormatMessage.string({id: 'dbObject.saved'})});
    } catch (e) {
      const codes = e.codes || [];
      Message.error({
        title: codes.length
          ? codes.map(c => FormatMessage.string({id: `dbObject.errors.${c}`})).join('; ')
          : e.message,
      });
    }
  };
  const remove = () => {
    if (!isNew) {
      apply(removeDbObject(dataSource, draft.id));
    }
    setDraft(null);
    setIsNew(false);
  };
  const formItem = (name, node) => <div className={`${currentPrefix}-form-item`} key={name}>
    <span className={`${currentPrefix}-form-item-label`}><FormatMessage id={name}/></span>
    <span className={`${currentPrefix}-form-item-component`}>{node}</span>
  </div>;

  return <div className={`${currentPrefix}-dbobject`}>
    <div className={`${currentPrefix}-dbobject-types`}>
      {['all'].concat(types).map(t => <div
        key={t}
        className={filter === t ? `${currentPrefix}-dbobject-types-selected` : ''}
        onClick={() => setFilter(t)}
      >
        <span><FormatMessage id={t === 'all' ? 'dbObject.all' : `dbObject.types.${t}`}/></span>
        <span>{t === 'all' ? objects.length : objects.filter(o => o.type === t).length}</span>
      </div>)}
    </div>
    <div className={`${currentPrefix}-dbobject-objects`}>
      <div className={`${currentPrefix}-dbobject-objects-head`}>
        <Button type='primary' onClick={add}><FormatMessage id='dbObject.add'/></Button>
      </div>
      {shown.length === 0 && <div><FormatMessage id='dbObject.empty'/></div>}
      {shown.map(o => <div
        key={o.id}
        className={!isNew && draft?.id === o.id ? `${currentPrefix}-dbobject-objects-selected` : ''}
        onClick={() => select(o)}
      >
        <span>{o.defKey}</span>
        <span><FormatMessage id={`dbObject.types.${o.type}`}/></span>
      </div>)}
    </div>
    <div className={`${currentPrefix}-dbobject-main`}>
      {draft ? <>
        <div className={`${currentPrefix}-dbobject-form`}>
          {isNew && formItem('dbObject.prop.type', <Select
            notAllowEmpty
            allowClear={false}
            value={draft.type}
            onChange={e => changeType(e.target.value)}
          >
            {types.map(t => <Option key={t} value={t}>{FormatMessage.string({id: `dbObject.types.${t}`})}</Option>)}
          </Select>)}
          {formItem('dbObject.defKey', <Input value={draft.defKey} onChange={e => setField('defKey', e.target.value)}/>)}
          {formItem('dbObject.defName', <Input value={draft.defName} onChange={e => setField('defName', e.target.value)}/>)}
          {formItem('dbObject.comment', <Input value={draft.comment} onChange={e => setField('comment', e.target.value)}/>)}
          {formItem('dbObject.refEntity', <Select
            allowClear
            value={draft.refEntity}
            onChange={e => setField('refEntity', e.target.value)}
          >
            {entities.map(e => <Option key={e.id} value={e.id}>{`${e.defKey}-${e.defName || ''}`}</Option>)}
          </Select>)}
          {def.propFields.map(f => formItem(`dbObject.prop.${f.key}`, <PropEditor
            prefix={currentPrefix}
            field={f}
            entity={entity}
            value={draft.props[f.key]}
            onChange={v => setProp(f.key, v)}
          />))}
          {def.hasBody && formItem('dbObject.body', <CodeEditor
            mode='sql'
            width='auto'
            height='140px'
            value={draft.body}
            onChange={e => setField('body', e.target.value)}
          />)}
          {formItem('dbObject.customDDL', <CodeEditor
            mode='sql'
            width='auto'
            height='100px'
            value={draft.customDDL}
            onChange={e => setField('customDDL', e.target.value)}
          />)}
          <div className={`${currentPrefix}-dbobject-form-actions`}>
            <Button type='primary' onClick={save}><FormatMessage id='dbObject.save'/></Button>
            <Button onClick={remove}><FormatMessage id='dbObject.delete'/></Button>
          </div>
        </div>
        <div className={`${currentPrefix}-dbobject-preview`}>
          {formItem('dbObject.database', <Select
            notAllowEmpty
            allowClear={false}
            value={dbId}
            onChange={e => setDbId(e.target.value)}
          >
            {supports.map(s => <Option key={s.id} value={s.id}>{s.defKey}</Option>)}
          </Select>)}
          <CodeEditor mode='sql' readOnly width='auto' height='calc(80vh - 90px)' value={preview}/>
        </div>
      </> : <div className={`${currentPrefix}-dbobject-form`}><FormatMessage id='dbObject.selectOne'/></div>}
    </div>
  </div>;
});
