import React from 'react';
import { FormatMessage } from 'components';
import { SimpleGrid } from '../../../../components/gridview';

const t = (id, data) => FormatMessage.string({ id, data });
const label = (group, code) => FormatMessage.string({ id: `impact.${group}.${code}`, defaultMessage: code });

export default React.memo(({ prefix, items }) => {
  const objectName = i => `${i.objectDefKey}${i.objectDefName ? `[${i.objectDefName}]` : ''}`;
  const column = (key, sort, render = sort) => ({
    key, title: t(`impact.col.${key}`), sort, render,
  });
  const columns = [
    column('objectType', i => label('objectType', i.objectType)),
    column('object', objectName),
    column('parent', i => i.parentDefKey),
    column('reason', i => label('reason', i.reason),
      i => <span title={i.detail}>{label('reason', i.reason)}</span>),
    column('severity', i => t(`impact.severity.${i.severity}`),
      i => <span className={`${prefix}-impact-sev-${i.severity}`}>{t(`impact.severity.${i.severity}`)}</span>),
  ];
  const count = sev => items.filter(i => i.severity === sev).length;
  return <div className={`${prefix}-impact-result`}>
    <div className={`${prefix}-impact-summary`}>
      {t('impact.summary', { total: items.length, break: count('break'), change: count('change'), info: count('info') })}
    </div>
    <SimpleGrid
      prefix={prefix}
      gridId='impact.result'
      className={`${prefix}-impact-table`}
      rows={items}
      rowKey={i => `${items.indexOf(i)}`}
      columns={columns}
    />
  </div>;
});
