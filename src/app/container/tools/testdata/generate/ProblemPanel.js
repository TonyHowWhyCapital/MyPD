// What keeps the run from starting, each line with what can be done about it.
import React, { useState } from 'react';
import { Icon } from 'components';
import { tr } from './i18n';

const SHOWN = 3;

// items: [{ id, text, blocking, fixes: [{key, label, run, disabled, hint}] }]
export default React.memo(({ base, items }) => {
  const [all, setAll] = useState(false);
  if (items.length === 0) {
    return null;
  }
  const blocking = items.filter(i => i.blocking).length;
  const shown = all ? items : items.slice(0, SHOWN);
  return <div className={`${base}-problems${blocking === 0 ? ` ${base}-problems-mild` : ''}`}>
    <div className={`${base}-problems-head`}>
      <Icon type='fa-exclamation-triangle'/>
      <span>
        {blocking > 0 ? tr('problems.title', { count: blocking })
          : tr('problems.notices', { count: items.length })}
      </span>
      {items.length > SHOWN && <a onClick={() => setAll(!all)}>
        {all ? tr('problems.less') : tr('problems.more', { count: items.length - SHOWN })}
      </a>}
    </div>
    <div className={`${base}-problems-list`}>
      {shown.map(item => (
        <div key={item.id} className={`${base}-problems-item`}>
          <span className={`${base}-problems-text`} title={item.text}>{item.text}</span>
          <span className={`${base}-problems-fixes`}>
            {item.fixes.map(fix => (
              <a
                key={fix.key}
                className={fix.disabled ? `${base}-link-off` : ''}
                title={fix.hint || ''}
                onClick={() => !fix.disabled && fix.run()}
              >
                {fix.label}
              </a>))}
          </span>
        </div>))}
    </div>
  </div>;
});
