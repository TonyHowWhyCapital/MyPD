/* eslint-disable no-bitwise */
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import { crc32 as referenceCrc } from '../src/lib/report/zip';
import {
  SHEET_ROWS, cellXml, columnLetters, createXlsxWriter, excelSerial, sheetName,
} from '../src/lib/testdata/xlsx';
import { crc32, createDeflatedPart, createZipWriter } from '../src/lib/testdata/zip_stream';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mypd-testdata-xlsx-'));
afterAll(() => fs.rmdirSync(root, { recursive: true }));
const tmp = name => path.join(root, name);

const hasUnzip = spawnSync('unzip', ['-v']).status === 0;
const unzipTest = (file) => {
  if (hasUnzip) {
    const check = spawnSync('unzip', ['-t', file]);
    expect(check.stdout.toString()).toContain('No errors detected');
    expect(check.status).toBe(0);
  }
};

// An unzip of our own, by the book (APPNOTE 4.3): the central directory is the truth, the
// local headers must agree with it, every entry is inflated and its checksum compared.
const readZip = (file) => {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBe(buf.length - 22); // no comment, nothing behind the end record
  let count = buf.readUInt16LE(eocd + 10);
  let size = buf.readUInt32LE(eocd + 12);
  let offset = buf.readUInt32LE(eocd + 16);
  let zip64 = false;
  if (buf.readUInt32LE(eocd - 20) === 0x07064b50) {
    zip64 = true;
    const record = Number(buf.readBigUInt64LE(eocd - 12));
    expect(buf.readUInt32LE(record)).toBe(0x06064b50);
    expect(record + 56).toBe(eocd - 20);
    count = Number(buf.readBigUInt64LE(record + 32));
    size = Number(buf.readBigUInt64LE(record + 40));
    offset = Number(buf.readBigUInt64LE(record + 48));
  }
  expect(offset + size).toBe(zip64 ? eocd - 76 : eocd);
  const entries = {};
  let end = 0;
  let pos = offset;
  for (let i = 0; i < count; i += 1) {
    expect(buf.readUInt32LE(pos)).toBe(0x02014b50);
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    let packed = buf.readUInt32LE(pos + 20);
    let plain = buf.readUInt32LE(pos + 24);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    let local = buf.readUInt32LE(pos + 42);
    const name = buf.slice(pos + 46, pos + 46 + nameLength).toString('utf8');
    if (extraLength) {
      let at = pos + 46 + nameLength;
      expect(buf.readUInt16LE(at)).toBe(1);
      expect(buf.readUInt16LE(at + 2)).toBe(extraLength - 4);
      at += 4;
      [plain, packed, local] = [plain, packed, local].map((value) => {
        if (value !== 0xFFFFFFFF) {
          return value;
        }
        at += 8;
        return Number(buf.readBigUInt64LE(at - 8));
      });
    }
    expect(flags).toBe(0x0800); // UTF-8 names, no data descriptor, not encrypted
    expect(local).toBe(end); // entries follow each other without a gap
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    expect(buf.readUInt16LE(local + 6)).toBe(flags);
    expect(buf.readUInt16LE(local + 8)).toBe(method);
    expect(buf.readUInt32LE(local + 14)).toBe(crc);
    const localExtra = buf.readUInt16LE(local + 28);
    if (!localExtra) {
      expect(buf.readUInt32LE(local + 18)).toBe(packed);
      expect(buf.readUInt32LE(local + 22)).toBe(plain);
    }
    expect(buf.slice(local + 30, local + 30 + nameLength).toString('utf8')).toBe(name);
    const start = local + 30 + nameLength + localExtra;
    const raw = buf.slice(start, start + packed);
    expect([0, 8]).toContain(method);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    expect(data.length).toBe(plain);
    expect(referenceCrc(data)).toBe(crc);
    entries[name] = data.toString('utf8');
    end = start + packed;
    pos += 46 + nameLength + extraLength;
  }
  expect(end).toBe(offset);
  return { entries, names: Object.keys(entries), zip64 };
};

const unescapeXml = text => text.replace(/&#13;/g, '\r').replace(/&quot;/g, '"')
  .replace(/&gt;/g, '>').replace(/&lt;/g, '<')
  .replace(/&amp;/g, '&');

// rows of a sheet: [{r, cells: {A: {v, t, s}}}]
const parseSheet = (xml) => {
  const data = /<sheetData>([^]*)<\/sheetData>/.exec(xml)[1];
  const rows = [];
  const rowPattern = /<row r="(\d+)">([^]*?)<\/row>/g;
  let consumed = 0;
  for (let m = rowPattern.exec(data); m; m = rowPattern.exec(data)) {
    consumed += m[0].length;
    const cells = {};
    const cellPattern = /<c r="([A-Z]+)(\d+)"(?: s="(\d+)")?(?: t="(\w+)")?>(?:<v>([^<]*)<\/v>|<is><t xml:space="preserve">([^<]*)<\/t><\/is>)<\/c>/g;
    let used = 0;
    for (let c = cellPattern.exec(m[2]); c; c = cellPattern.exec(m[2])) {
      used += c[0].length;
      expect(c[2]).toBe(m[1]);
      cells[c[1]] = {
        v: c[5] !== undefined ? c[5] : unescapeXml(c[6]),
        t: c[4] || 'n',
        s: c[3] || '0',
      };
    }
    expect(used).toBe(m[2].length); // nothing in the row but cells
    rows.push({ r: Number(m[1]), cells });
  }
  expect(consumed).toBe(data.length);
  return rows;
};

const sheetNames = entries => (entries['xl/workbook.xml'].match(/<sheet name="[^"]*"/g) || [])
  .map(s => unescapeXml(s.slice(13, -1)));

const feed = (writer, tables, size = 1000) => tables.reduce((work, [table, rows]) => {
  let next = work.then(() => writer.beginTable(table));
  for (let i = 0; i < rows.length; i += size) {
    next = next.then(() => writer.rows(rows.slice(i, i + size)));
  }
  return next.then(() => writer.endTable());
}, Promise.resolve()).then(() => writer.close());

const table = {
  defKey: 'Orders',
  columns: [
    { defKey: 'Id', kind: 'int' },
    { defKey: '名稱 <b>&"', kind: 'string', len: 50 },
    { defKey: 'Amount', kind: 'decimal' },
    { defKey: 'Day', kind: 'date' },
    { defKey: 'At', kind: 'datetime' },
    { defKey: 'Clock', kind: 'time' },
    { defKey: 'Flag', kind: 'bool' },
  ],
};
const rows = [
  [1, "O'Brien & <Sons> \"x\"", 12.5, '2024-01-31', '2024-01-31 12:00:00', '06:00:00', true],
  [2, null, -0.001, null, null, null, false],
  [3, `臺北 😀\r\nline${String.fromCharCode(1)}`, 1e21, '1899-12-31', 'not a date', '25:00:00', null],
  [4, '001', '12345678901234567890', '2024-02-30', '2024-01-31', '00:00:01', true],
];

describe('workbook', () => {
  test('is a ZIP every reader accepts, with the parts Excel needs', () => {
    const file = tmp('small.xlsx');
    return feed(createXlsxWriter(file, { tempDir: root }), [[table, rows]]).then((result) => {
      expect(result).toEqual({
        file,
        bytes: fs.statSync(file).size,
        rows: 4,
        sheets: [{ name: 'Orders', table: 'Orders', rows: 4 }],
      });
      unzipTest(file);
      const { entries, names, zip64 } = readZip(file);
      expect(zip64).toBe(false);
      expect(names).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
      names.forEach(name => expect(entries[name].startsWith('<?xml version="1.0"')).toBe(true));
      expect(entries['[Content_Types].xml']).toContain('PartName="/xl/worksheets/sheet1.xml"');
      expect(entries['xl/_rels/workbook.xml.rels'])
        .toContain('Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
          + 'relationships/worksheet" Target="worksheets/sheet1.xml"');
      expect(sheetNames(entries)).toEqual(['Orders']);
      // the temporary files are gone
      expect(fs.readdirSync(root).filter(n => n.startsWith('mypd-xlsx-'))).toEqual([]);
    });
  });

  test('heading bold and frozen, values typed by the kind of their column', () => {
    const { entries } = readZip(tmp('small.xlsx'));
    const xml = entries['xl/worksheets/sheet1.xml'];
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain('<col min="2" max="2" width="40" customWidth="1"/>');
    expect(entries['xl/styles.xml']).toContain('<font><b/>');
    const sheet = parseSheet(xml);
    expect(sheet.map(r => r.r)).toEqual([1, 2, 3, 4, 5]);
    expect(Object.keys(sheet[0].cells)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    Object.keys(sheet[0].cells).forEach(k => expect([sheet[0].cells[k].t, sheet[0].cells[k].s])
      .toEqual(['inlineStr', '1']));
    expect(sheet[0].cells.B.v).toBe('名稱 <b>&"');
    expect(sheet[1].cells).toEqual({
      A: { v: '1', t: 'n', s: '0' },
      B: { v: "O'Brien & <Sons> \"x\"", t: 'inlineStr', s: '0' },
      C: { v: '12.5', t: 'n', s: '0' },
      D: { v: '45322', t: 'n', s: '2' },
      E: { v: '45322.5', t: 'n', s: '3' },
      F: { v: '0.25', t: 'n', s: '4' },
      G: { v: '1', t: 'b', s: '0' },
    });
    // NULL leaves the cell out
    expect(sheet[2].cells).toEqual({
      A: { v: '2', t: 'n', s: '0' }, C: { v: '-0.001', t: 'n', s: '0' }, G: { v: '0', t: 'b', s: '0' },
    });
    // the control character is dropped, CR and LF survive; what is no date stays text
    expect(sheet[3].cells.B.v).toBe('臺北 😀\r\nline');
    expect(sheet[3].cells.C.v).toBe('1000000000000000000000');
    expect(sheet[3].cells.D).toEqual({ v: '1899-12-31', t: 'inlineStr', s: '0' });
    expect(sheet[3].cells.E).toEqual({ v: 'not a date', t: 'inlineStr', s: '0' });
    expect(sheet[3].cells.F).toEqual({ v: '25:00:00', t: 'inlineStr', s: '0' });
    // a code keeps its zeros, a number too long for Excel stays text
    expect(sheet[4].cells.B).toEqual({ v: '001', t: 'inlineStr', s: '0' });
    expect(sheet[4].cells.C).toEqual({ v: '12345678901234567890', t: 'inlineStr', s: '0' });
    expect(sheet[4].cells.D).toEqual({ v: '2024-02-30', t: 'inlineStr', s: '0' });
    expect(sheet[4].cells.E).toEqual({ v: '45322', t: 'n', s: '3' });
    expect(Number(sheet[4].cells.F.v)).toBeCloseTo(1 / 86400, 12);
    expect(sheet[4].cells.F.v).not.toMatch(/e/i);
  });

  test('a table with more rows than a sheet holds goes on in the next sheet', () => {
    const file = tmp('rollover.xlsx');
    const small = { defKey: 'T', columns: [{ defKey: 'A', kind: 'int' }, { defKey: 'B', kind: 'string' }] };
    const data = Array.from({ length: 8 }, (v, i) => [i + 1, `r${i + 1}`]);
    const other = { defKey: 't', columns: [{ defKey: 'X', kind: 'int' }] };
    return feed(createXlsxWriter(file, { maxRows: 4, tempDir: root }),
      [[small, data], [other, [[1]]], [{ ...small, defKey: 'Empty' }, []]], 5).then((result) => {
      expect(result.sheets).toEqual([
        { name: 'T', table: 'T', rows: 3 },
        { name: 'T (2)', table: 'T', rows: 3 },
        { name: 'T (3)', table: 'T', rows: 2 },
        { name: 't~2', table: 't', rows: 1 },
        { name: 'Empty', table: 'Empty', rows: 0 },
      ]);
      expect(result.rows).toBe(9);
      unzipTest(file);
      const { entries, names } = readZip(file);
      expect(names.filter(n => n.startsWith('xl/worksheets/'))).toHaveLength(5);
      expect(sheetNames(entries)).toEqual(['T', 'T (2)', 'T (3)', 't~2', 'Empty']);
      const values = n => parseSheet(entries[`xl/worksheets/sheet${n}.xml`])
        .map(r => [r.r, r.cells.A.v, (r.cells.B || {}).v]);
      expect(values(1)).toEqual([[1, 'A', 'B'], [2, '1', 'r1'], [3, '2', 'r2'], [4, '3', 'r3']]);
      expect(values(2)).toEqual([[1, 'A', 'B'], [2, '4', 'r4'], [3, '5', 'r5'], [4, '6', 'r6']]);
      expect(values(3)).toEqual([[1, 'A', 'B'], [2, '7', 'r7'], [3, '8', 'r8']]);
      expect(values(4)).toEqual([[1, 'X', undefined], [2, '1', undefined]]);
      expect(values(5)).toEqual([[1, 'A', 'B']]);
    });
  });

  test('a real sheet takes 1,048,575 rows below its heading', () => {
    expect(SHEET_ROWS).toBe(1048576);
  });

  test('the same data gives the same bytes, and no table still gives a workbook', () => {
    const write = name => feed(createXlsxWriter(tmp(name), { tempDir: root }), [[table, rows]])
      .then(() => fs.readFileSync(tmp(name)));
    return Promise.all([write('same-a.xlsx'), write('same-b.xlsx')]).then(([a, b]) => {
      expect(a.equals(b)).toBe(true);
      return createXlsxWriter(tmp('empty.xlsx'), { tempDir: root }).close();
    }).then((result) => {
      expect(result.sheets).toEqual([{ name: 'Sheet1', table: null, rows: 0 }]);
      unzipTest(tmp('empty.xlsx'));
      const { entries } = readZip(tmp('empty.xlsx'));
      expect(sheetNames(entries)).toEqual(['Sheet1']);
      expect(parseSheet(entries['xl/worksheets/sheet1.xml'])).toEqual([{ r: 1, cells: {} }]);
    });
  });

  test('calls that are not awaited still arrive in order', () => {
    const file = tmp('unawaited.xlsx');
    const writer = createXlsxWriter(file, { maxRows: 3, tempDir: root });
    const small = { defKey: 'T', columns: [{ defKey: 'A', kind: 'int' }] };
    writer.beginTable(small);
    for (let i = 0; i < 5; i += 1) {
      writer.rows([[i]]);
    }
    writer.endTable();
    return writer.close().then((result) => {
      expect(result.sheets.map(s => s.rows)).toEqual([2, 2, 1]);
      const { entries } = readZip(file);
      expect([1, 2, 3].map(n => parseSheet(entries[`xl/worksheets/sheet${n}.xml`]).slice(1)
        .map(r => r.cells.A.v))).toEqual([['0', '1'], ['2', '3'], ['4']]);
    });
  });

  test('misuse and a file that cannot be written are reported', () => {
    const code = promise => promise.then(() => 'no error', e => e.code);
    const writer = createXlsxWriter(tmp('misuse.xlsx'), { tempDir: root });
    return code(writer.rows([[1]])).then((c) => {
      expect(c).toBe('testdata.writer.noTable');
      return code(writer.close()); // a failed writer stays failed, close() tidies up
    }).then((c) => {
      expect(c).toBe('testdata.writer.noTable');
      return code(feed(createXlsxWriter(path.join(root, 'none', 'x.xlsx'), { tempDir: root }),
        [[table, rows]]));
    }).then((c) => {
      expect(c).toBe('ENOENT');
      expect(fs.readdirSync(root).filter(n => n.startsWith('mypd-xlsx-'))).toEqual([]);
    });
  });
});

describe('cells and names', () => {
  test('column letters', () => {
    expect([0, 25, 26, 27, 701, 702, 16383].map(columnLetters))
      .toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA', 'XFD']);
  });

  test('day numbers of Excel', () => {
    expect(excelSerial('1900-03-01', 'date')).toBe(61);
    expect(excelSerial('2024-01-31', 'date')).toBe(45322);
    expect(excelSerial('2024-01-31 18:00:00', 'datetime')).toBe(45322.75);
    expect(excelSerial('2024-01-31 18:00:00', 'date')).toBe(45322);
    expect(excelSerial('9999-12-31', 'date')).toBe(2958465);
    expect(excelSerial('12:00:00', 'time')).toBe(0.5);
    expect(excelSerial('1900-02-28', 'date')).toBe(null); // Excel counts a 29th there
    expect(excelSerial('2023-02-29', 'date')).toBe(null);
    expect(excelSerial('2024-13-01', 'date')).toBe(null);
    expect(excelSerial('24:00:00', 'time')).toBe(null);
    expect(excelSerial('', 'date')).toBe(null);
  });

  test('a cell', () => {
    expect(cellXml('A2', null, 'int')).toBe('');
    expect(cellXml('A2', NaN, 'decimal')).toBe('');
    expect(cellXml('A2', 5, 'int')).toBe('<c r="A2"><v>5</v></c>');
    expect(cellXml('A2', '5', 'int')).toBe('<c r="A2"><v>5</v></c>');
    expect(cellXml('A2', '5', 'string'))
      .toBe('<c r="A2" t="inlineStr"><is><t xml:space="preserve">5</t></is></c>');
    expect(cellXml('B3', 'a<b', 'string'))
      .toBe('<c r="B3" t="inlineStr"><is><t xml:space="preserve">a&lt;b</t></is></c>');
    // Excel refuses a longer text
    expect(cellXml('A2', 'x'.repeat(40000), 'string').length - cellXml('A2', '', 'string').length)
      .toBe(32767);
    // half a surrogate pair would make the XML unreadable
    expect(cellXml('A2', `a${'😀'.slice(0, 1)}b`, 'string')).toContain('>ab<');
    expect(cellXml('A2', `a${'😀'.slice(1)}b`, 'string')).toContain('>ab<');
    expect(cellXml('A2', 'a😀b', 'string')).toContain('>a😀b<');
  });

  test('sheet names follow the rules of Excel', () => {
    expect(sheetName('Orders')).toBe('Orders');
    expect(sheetName('a[b]c:d*e?f/g\\h')).toBe('a b c d e f g h');
    expect(sheetName("'quoted'")).toBe('quoted');
    expect(sheetName('')).toBe('Sheet');
    expect(sheetName(null)).toBe('Sheet');
    expect(sheetName('[]')).toBe('Sheet');
    expect(sheetName('History')).toBe('History_');
    expect(sheetName('x'.repeat(40))).toBe('x'.repeat(31));
    expect(sheetName('x'.repeat(40), null, 2)).toBe(`${'x'.repeat(27)} (2)`);
    expect(sheetName('表'.repeat(40))).toHaveLength(31);
    // an emoji counts two and is not cut in half
    expect(sheetName(`${'x'.repeat(30)}😀`)).toBe('x'.repeat(30));
    const used = new Set();
    const names = ['Orders', 'ORDERS', 'orders', 'x'.repeat(31), 'x'.repeat(32), 'Orders~2']
      .map(n => sheetName(n, used));
    expect(names).toEqual(['Orders', 'ORDERS~2', 'orders~3', 'x'.repeat(31), `${'x'.repeat(29)}~2`,
      'Orders~2~2']);
    names.forEach(n => expect(n.length).toBeLessThanOrEqual(31));
    expect(new Set(names.map(n => n.toLowerCase())).size).toBe(names.length);
  });
});

describe('ZIP stream', () => {
  test('the checksum is the one of the existing ZIP writer', () => {
    const bytes = Buffer.from('The quick brown fox 臺北 😀'.repeat(1000), 'utf8');
    expect(crc32(bytes)).toBe(referenceCrc(bytes));
    expect(crc32(Buffer.from('123456789'))).toBe(0xCBF43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  test('stored, deflated and streamed entries, with a time stamp when asked', () => {
    const file = tmp('plain.zip');
    const part = createDeflatedPart(tmp('part.bin'));
    const zip = createZipWriter(file, { date: new Date(2024, 0, 31, 10, 20, 30) });
    const text = '中文 line\n'.repeat(50000);
    return part.write(text.slice(0, 1000)).then(() => part.write(text.slice(1000)))
      .then(() => part.end())
      .then(info => zip.addData('tiny.txt', 'x')
        .then(() => zip.addData('目錄/big.txt', 'abc'.repeat(10000)))
        .then(() => zip.addPart('streamed.txt', info)))
      .then(() => zip.close())
      .then((bytes) => {
        expect(bytes).toBe(fs.statSync(file).size);
        unzipTest(file);
        const { entries, names, zip64 } = readZip(file);
        expect(zip64).toBe(false);
        expect(names).toEqual(['tiny.txt', '目錄/big.txt', 'streamed.txt']);
        expect(entries['tiny.txt']).toBe('x');
        expect(entries['目錄/big.txt']).toBe('abc'.repeat(10000));
        expect(entries['streamed.txt']).toBe(text);
        const buf = fs.readFileSync(file);
        expect(buf.readUInt16LE(8)).toBe(0); // one byte is stored, not deflated
        expect(buf.readUInt16LE(10)).toBe((10 << 11) | (20 << 5) | 15);
        expect(buf.readUInt16LE(12)).toBe((44 << 9) | (1 << 5) | 31);
      });
  });

  test('ZIP64 records are right when an archive needs them', () => {
    const file = tmp('zip64.zip');
    const zip = createZipWriter(file, { forceZip64: true });
    return zip.addData('a.txt', 'hello '.repeat(100))
      .then(() => zip.addData('b.txt', 'b'))
      .then(() => zip.close())
      .then(() => {
        unzipTest(file);
        const { entries, zip64 } = readZip(file);
        expect(zip64).toBe(true);
        expect(entries).toEqual({ 'a.txt': 'hello '.repeat(100), 'b.txt': 'b' });
      });
  });
});
