import React from 'react';
import { FormatMessage } from 'components';

const t = (id, data) => FormatMessage.string({ id, data });
const cols = ['objectType', 'object', 'parent', 'reason', 'severity'];
const label = (group, code) => FormatMessage.string({ id: `impact.${group}.${code}`, defaultMessage: code });

export default React.memo(({ prefix, items }) => {
  const count = sev => items.filter(i => i.severity === sev).length;
  return <div className={`${prefix}-impact-result`}>
    <div className={`${prefix}-impact-summary`}>
      {t('impact.summary', { total: items.length, break: count('break'), change: count('change'), info: count('info') })}
    </div>
    <table className={`${prefix}-impact-table`}>
      <thead>
        <tr>{cols.map(c => <th key={c}>{t(`impact.col.${c}`)}</th>)}</tr>
      </thead>
      <tbody>
        {items.map((i, idx) => <tr key={`${i.objectId}_${i.reason}_${idx}`}>
          <td>{label('objectType', i.objectType)}</td>
          <td>{`${i.objectDefKey}${i.objectDefName ? `[${i.objectDefName}]` : ''}`}</td>
          <td>{i.parentDefKey}</td>
          <td title={i.detail}>{label('reason', i.reason)}</td>
          <td className={`${prefix}-impact-sev-${i.severity}`}>{t(`impact.severity.${i.severity}`)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>;
});
