// The steps of a tool window as one bar: a number and a title each, the current one
// highlighted, the ones before it marked as done.
//
// Props
//   steps     [{key, title}]
//   current   key of the step shown
//   onChange  (key) => void; without it the steps only show where things stand
import React from 'react';

import './style/index.less';
import {getPrefix} from '../../lib/prefixUtil';

export default React.memo(({prefix, steps, current, onChange}) => {
  const base = `${getPrefix(prefix)}-stepbar`;
  const at = steps.findIndex(s => s.key === current);
  const classOf = (s, i) => [
    `${base}-item`,
    s.key === current ? `${base}-item-active` : '',
    i < at ? `${base}-item-done` : '',
    onChange ? '' : `${base}-item-fixed`,
  ].filter(Boolean).join(' ');
  return <div className={base}>
    {steps.map((s, i) => (
      <div key={s.key} className={classOf(s, i)} onClick={() => onChange && onChange(s.key)}>
        <i>{i + 1}</i>
        <span>{s.title}</span>
      </div>))}
  </div>;
});
