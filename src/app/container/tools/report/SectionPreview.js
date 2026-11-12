import React, { useMemo } from 'react';
import { FormatMessage, Icon } from 'components';
import { buildSection, columnPercents, cssOf } from '../../../../lib/report';

const ROWS = 2;
const EMPTY = { entities: [{ fields: [] }] };
const ctx = lang => ({ lang, level: 1, flatOnly: true });

export const sampleTable = (dataSource, section, lang) => buildSection(dataSource, section, ctx(lang))
  .find(b => b.type === 'table') || buildSection(EMPTY, section, ctx(lang)).find(b => b.type === 'table');

// The section's table as the report will show it, with a couple of rows of the current
// model. Read only, a click opens the layout designer.
export default React.memo(({
  cls, section, dataSource, lang, onClick,
}) => {
  const table = useMemo(() => sampleTable(dataSource, section, lang), [section, dataSource, lang]);
  const percents = columnPercents(table.widths, table.headers.length);
  const aligns = table.aligns || [];
  const styles = table.styles || [];
  const renamed = table.renamed || [];
  // The summary lists its columns as rows, so all of them are shown.
  const rows = table.keys ? table.rows.slice(0, ROWS) : table.rows;
  return <div className={cls} onClick={onClick}>
    <span className={`${cls}-go`}><Icon type='fa-pencil'/><FormatMessage id='report.clickToDesign'/></span>
    <table className={percents ? 'sized' : ''}>
      {percents && <colgroup>{percents.map((p, i) => <col key={i} style={{ width: `${p}%` }}/>)}</colgroup>}
      <thead>
        <tr>{table.headers.map((h, i) => <th
          key={i}
          style={table.keys ? { textAlign: table.headAligns[i], ...cssOf(table.headStyles[i]) } : undefined}
        >
          <span
            className={renamed[i] ? 'renamed' : ''}
            title={renamed[i] ? FormatMessage.string({ id: 'report.originalName', data: { name: renamed[i] } }) : undefined}
          >{h}</span>
        </th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, n) => <tr key={n}>{r.map((c, i) => <td
          key={i}
          style={{ textAlign: aligns[i] || 'left', ...cssOf(styles[i]) }}
        >{c}</td>)}</tr>)}
      </tbody>
    </table>
  </div>;
});
