import React, { useMemo, useState } from 'react';
import moment from 'moment';
import { Icon, FormatMessage } from 'components';
import { fileStat, showFileInFolder } from '../../lib/middle';
import './style/list.less';

const text = id => FormatMessage.string({ id: `home.${id}` });
const time = t => (t ? moment(t).format('YYYY-MM-DD HH:mm:ss') : '-');
const size = (bytes) => {
  if (!(bytes >= 0)) return '-';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const SORTS = {
  name: p => `${p.name || ''}`.toLowerCase(),
  modified: p => (p.stat ? p.stat.modifiedTime : 0),
};

// The recent projects as rows: what each is about, when its file last changed and where
// it lives. The cards show little of that.
export default ({
  cls, projects, onOpen, onInfo, onEdit, onReadOnly, onForget, onDelete,
}) => {
  // Empty key keeps the order of the history, most recently opened first.
  const [sort, setSort] = useState({ key: '', desc: false });
  const rows = useMemo(() => {
    const list = projects.map(p => ({ ...p, stat: fileStat(p.path) }));
    if (!sort.key) return list;
    const by = SORTS[sort.key];
    const sorted = list.slice().sort((a, b) => (by(a) > by(b) ? 1 : (by(a) < by(b) ? -1 : 0)));
    return sort.desc ? sorted.reverse() : sorted;
  }, [projects, sort]);
  const head = (key, label, sortable) => {
    const mine = sort.key === key;
    const next = () => {
      // A third click goes back to the history order.
      if (mine && sort.desc === (key === 'name')) setSort({ key: '', desc: false });
      else setSort({ key, desc: mine ? !sort.desc : key !== 'name' });
    };
    return <th className={sortable ? 'sortable' : ''} onClick={sortable ? next : undefined}>
      {label}
      {sortable && <Icon type={mine ? (sort.desc ? 'fa-sort-desc' : 'fa-sort-asc') : 'fa-sort'}/>}
    </th>;
  };
  const act = (icon, id, fn, p, extra = '') => <a
    className={extra}
    title={text(id)}
    onClick={(e) => { e.stopPropagation(); fn(p); }}
  ><Icon type={icon}/></a>;
  if (rows.length === 0) {
    return <div className={`${cls}-empty`}>{text('listEmpty')}</div>;
  }
  return <table className={cls}>
    <thead>
      <tr>
        {head('name', text('colName'), true)}
        {head('describe', text('colDescribe'))}
        {head('modified', text('colModified'), true)}
        {head('size', text('colSize'))}
        {head('path', text('colPath'))}
        {head('actions', text('colActions'))}
      </tr>
    </thead>
    <tbody>
      {rows.map(p => <tr
        key={p.path}
        className={p.stat ? '' : 'missing'}
        title={p.stat ? text('openProject') : text('fileMissing')}
        onDoubleClick={() => onOpen(p)}
      >
        <td className='name' onClick={() => onOpen(p)}>
          {p.avatar ? <img src={p.avatar} alt=''/> : <Icon type='fa-file-o'/>}
          <span>{p.name}</span>
        </td>
        <td className='describe' title={p.describe}>{p.describe}</td>
        <td className='time'>{p.stat ? time(p.stat.modifiedTime) : <em>{text('fileMissing')}</em>}</td>
        <td className='size'>{p.stat ? size(p.stat.size) : '-'}</td>
        <td className='path' title={p.path}>
          <span>{p.path}</span>
        </td>
        <td className='actions'>
          {p.stat && act('fa-folder-open-o', 'showInFolder', q => showFileInFolder(q.path), p)}
          {act('fa-info-circle', 'proInfo', onInfo, p)}
          {act('fa-pencil', 'editProject', onEdit, p)}
          {act('fa-eye', 'openReading', onReadOnly, p)}
          {act('fa-times', 'removeHistory', onForget, p)}
          {act('fa-trash-o', 'removeProject', onDelete, p, 'danger')}
        </td>
      </tr>)}
    </tbody>
  </table>;
};
