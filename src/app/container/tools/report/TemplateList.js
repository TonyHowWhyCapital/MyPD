import React from 'react';
import { FormatMessage, Button, Icon } from 'components';
import { getPrefix } from '../../../../lib/prefixUtil';

export default React.memo(({
  prefix, templates, selectedId, usingDefaults, onSelect, onAdd, onCopy, onDelete,
}) => {
  const currentPrefix = getPrefix(prefix);
  return <div className={`${currentPrefix}-report-list`}>
    <div className={`${currentPrefix}-report-title`}><FormatMessage id='report.templates'/></div>
    <div className={`${currentPrefix}-report-list-actions`}>
      <Button onClick={() => onAdd('document')}><FormatMessage id='report.addDocument'/></Button>
      <Button onClick={() => onAdd('list')}><FormatMessage id='report.addList'/></Button>
    </div>
    {usingDefaults && <div className={`${currentPrefix}-report-hint`}><FormatMessage id='report.defaultsHint'/></div>}
    <div className={`${currentPrefix}-report-list-items`}>
      {templates.map(t => <div
        key={t.id}
        className={`${currentPrefix}-report-list-item ${t.id === selectedId ? `${currentPrefix}-report-list-item-selected` : ''}`}
        onClick={() => onSelect(t.id)}
      >
        <span title={t.defName}>
          <Icon type={t.kind === 'list' ? 'fa-list' : 'fa-file-text-o'}/>
          <span className={`${currentPrefix}-report-list-item-name`}>{t.defName}</span>
        </span>
        <span>
          <a
            title={FormatMessage.string({ id: 'report.copy' })}
            onClick={(e) => { e.stopPropagation(); onCopy(t); }}
          ><Icon type='fa-copy'/></a>
          <a
            className='danger'
            title={FormatMessage.string({ id: 'report.delete' })}
            onClick={(e) => { e.stopPropagation(); onDelete(t); }}
          ><Icon type='fa-trash-o'/></a>
        </span>
      </div>)}
    </div>
  </div>;
});
