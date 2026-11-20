import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { getDefaultReportTemplates, setLayout, layoutOf, setCoverItem } from '../src/lib/report';
import CoverDesigner from '../src/app/container/tools/report/CoverDesigner';
import CoverPage from '../src/app/container/tools/report/CoverPage';

jest.mock('components', () => {
  /* eslint-disable global-require */
  const R = require('react');
  const lookup = (id, data) => `${require('lodash').get(require('../src/lang').default.zhTW, id, `MISSING:${id}`)}`
    .replace(/\{(\w+)\}/g, (all, k) => (data && data[k] !== undefined ? data[k] : all));
  /* eslint-enable global-require */
  const FormatMessage = ({ id, data }) => lookup(id, data);
  FormatMessage.string = ({ id, data }) => lookup(id, data);
  const tag = name => ({ children, ...props }) => R.createElement(name, {
    value: props.value, placeholder: props.placeholder, 'data-checked': props.checked,
  }, children);
  const Select = tag('select');
  Select.Option = ({ value, children }) => R.createElement('option', { value }, children);
  return {
    FormatMessage,
    Button: tag('button'),
    Checkbox: tag('label'),
    Input: tag('input'),
    NumberInput: tag('input'),
    Icon: () => null,
    Select,
  };
}, { virtual: true });
jest.mock('../src/app/container/tools/report/style/cover.less', () => ({}));
jest.mock('../src/lib/middle', () => ({ getUiState: (k, d) => d, setUiState: () => {} }));

const [tpl] = getDefaultReportTemplates('zhTW');
const design = template => renderToStaticMarkup(React.createElement(CoverDesigner, {
  prefix: 'chiner', template, modelName: '訂單系統', lang: 'zhTW', onChange: () => {},
}));

describe('cover designer', () => {
  test('every label resolves and the model name stands in for an empty title', () => {
    const html = design(tpl);
    expect(html).not.toContain('MISSING');
    ['標題', '副標題', '單位', '作者', '版本', '日期', 'Logo', '水平 %', '垂直 %'].forEach(t => expect(html).toContain(t));
    expect(html).toContain('placeholder="訂單系統"');
    // The page shows the model name as the title, and empty parts by their name.
    expect(html).toContain('>訂單系統</div>');
    expect(html).toContain('（副標題）');
    expect(html).not.toContain('完整模型');
  });

  test('a moved, resized and hidden part shows that way on the page', () => {
    let items = layoutOf(tpl).coverItems;
    items = setCoverItem(items, 'title', { x: 30, y: 20, size: 40 });
    items = setCoverItem(items, 'author', { hidden: true });
    const html = design(setLayout(tpl, { coverTitle: '封面', author: 'Tony', coverItems: items }));
    expect(html).toMatch(/style="left:0%;width:60%;top:20%;font-size:40pt;font-weight:bold;color:#222222"[^>]*>封面</);
    expect(html).not.toContain('作者：Tony');
  });

  test('the page is an A4 sheet scaled to the width asked for', () => {
    const page = renderToStaticMarkup(React.createElement(CoverPage, {
      cls: 'c', cover: { texts: [], logo: null, background: null }, width: 397,
    }));
    expect(page).toContain('width:397px');
    expect(page).toMatch(/height:561\.\d+px/);
    expect(page).toContain('width:210mm;height:297mm');
  });
});
