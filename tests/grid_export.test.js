import { cellText, gridMatrix, toCsv, toXlsx } from '../src/lib/grid_export';

const headers = [{ key: 'defKey', title: '程式碼' }, { key: 'domain', title: '資料域' },
  { key: 'primaryKey', title: '主鍵' }, { key: 'len', title: '長度' }];
const lookups = { domain: [{ id: 'd1', defKey: 'Code', defName: '代碼' }] };
const rows = [
  { defKey: 'A,"b"', domain: 'd1', primaryKey: true, len: 50 },
  { defKey: '001', domain: 'gone', len: '' },
];

test('a cell shows the name it points to, a tick as Y or N, nothing as empty', () => {
  expect(cellText('domain', rows[0], lookups)).toBe('代碼');
  expect(cellText('domain', rows[1], lookups)).toBe('');
  expect(cellText('primaryKey', rows[1], lookups, ['primaryKey'])).toBe('N');
  expect(cellText('extProps', { extProps: { a: 1 } })).toBe('{"a":1}');
});

test('the sheet starts with the headings and keeps the order of the rows', () => {
  expect(gridMatrix(headers, rows, lookups, ['primaryKey'])).toEqual([
    ['程式碼', '資料域', '主鍵', '長度'],
    ['A,"b"', '代碼', 'Y', 50],
    ['001', '', 'N', ''],
  ]);
});

test('csv quotes commas and quotes and starts with the UTF-8 mark', () => {
  const csv = toCsv(gridMatrix(headers, rows, lookups, ['primaryKey']));
  expect(csv.charCodeAt(0)).toBe(0xFEFF);
  expect(csv.split('\r\n')[1]).toBe('"A,""b""",代碼,Y,50');
  expect(csv.split('\r\n')[2]).toBe('001,,N,');
});

test('xlsx is a zip that holds the sheet, numbers as numbers and codes as text', () => {
  const bytes = toXlsx([['a&b', 'n'], ['001', 7]], 'T/1');
  const text = Buffer.from(bytes).toString('utf8');
  expect(bytes[0]).toBe(0x50);
  expect(bytes[1]).toBe(0x4B);
  expect(text).toContain('<t xml:space="preserve">a&amp;b</t>');
  expect(text).toContain('<t xml:space="preserve">001</t>');
  expect(text).toContain('<c r="B2"><v>7</v></c>');
  expect(text).toContain('sheet name="T 1"');
});
