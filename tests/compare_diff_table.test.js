import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import DiffTable from '../src/components/compare/CompareDiffTable';

jest.mock('components', () => {
  /* eslint-disable global-require */
  const lookup = id => `${require('lodash').get(require('../src/lang').default.zhTW, id, `MISSING:${id}`)}`;
  const FormatMessage = ({ id }) => lookup(id);
  FormatMessage.string = ({ id }) => lookup(id);
  /* eslint-enable global-require */
  return { FormatMessage };
}, { virtual: true });

const rows = [
  { table: 'A', kind: 'tableAdd', target: '', attr: 'fieldCount', before: '', after: 'A (3)' },
  { table: 'B', kind: 'tableRemove', target: '', attr: 'defKey', before: 'B', after: '' },
  { table: 'C', kind: 'fieldModify', target: 'X', attr: 'notNull', before: '', after: '✓' },
  { table: 'C', kind: 'indexModify', target: 'IDX', attr: 'index', before: '(X)', after: 'UNIQUE (X)' },
];
const render = (mode, list = rows) => renderToStaticMarkup(React.createElement(DiffTable, { rows: list, mode }));

describe('CompareDiffTable', () => {
  test.each(['db', 'version', 'table'])('%s mode resolves every label', (mode) => {
    expect(render(mode)).not.toContain('MISSING');
    expect(render(mode, [])).not.toContain('MISSING');
  });

  test('database mode names the sides and marks extra tables as not generating DDL', () => {
    const html = render('db');
    expect(html).toContain('調整前（資料庫）');
    expect(html).toContain('資料庫多出的表');
    expect(html).toContain('不產生DDL');
  });

  test('version mode names the previous and this version and lists a removed table', () => {
    const html = render('version');
    expect(html).toContain('調整前（上一版本）');
    expect(html).toContain('調整後（本版本）');
    expect(html).toContain('刪除表');
    expect(html).toContain('不可為空');
    expect(render('version', [])).toContain('兩個版本沒有差異');
  });

  test('table mode uses the comparison table as before and the check table as after', () => {
    const html = render('table');
    expect(html.indexOf('比較表')).toBeLessThan(html.indexOf('檢查表'));
    expect(html).toContain('僅檢查表有');
    expect(html).toContain('僅比較表有');
  });
});
