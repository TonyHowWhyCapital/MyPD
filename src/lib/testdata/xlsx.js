/* eslint-disable no-param-reassign */
// Test data as one Excel workbook: a sheet per table, the heading row bold and frozen
// like toXlsx in grid_export.js. A sheet is deflated into a temporary file while its rows
// arrive, so a table of a million rows never sits in memory. A table with more rows than
// a sheet holds goes on in a second sheet.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTableState } from './files';
import { plainNumber, numericText } from './sql_dialects';
import { createDeflatedPart, createZipWriter } from './zip_stream';

const READY = Promise.resolve();

export const SHEET_ROWS = 1048576; // rows of a sheet, the heading included
const CELL_CHARS = 32767; // longest text Excel takes in a cell

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006';
const TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

// characters XML 1.0 cannot hold, and halves of a surrogate pair
const NOT_XML = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]'
  + '|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?:^|[^\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]');
const NEEDS_ESCAPE = /[&<>"\r]/;
const escapeXml = (value) => {
  let text = value;
  if (NOT_XML.test(text)) {
    text = Array.from(text).filter((ch) => {
      const code = ch.codePointAt(0);
      return !(code < 9 || code === 11 || code === 12 || (code > 13 && code < 32)
        || (code >= 0xD800 && code <= 0xDFFF) || code === 0xFFFE || code === 0xFFFF);
    }).join('');
  }
  if (!NEEDS_ESCAPE.test(text)) {
    return text;
  }
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;'); // a bare CR would be turned into LF by the XML reader
};

export const columnLetters = (index) => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
};

// A sheet name Excel accepts: at most 31 characters, none of []:*?/\, no quote at either
// end, not the reserved "History", unique whatever the case. `used` holds lower case
// names; `part` > 1 marks the continuation of a table.
export const sheetName = (name, used, part) => {
  const suffix = part > 1 ? ` (${part})` : '';
  const clean = `${name === undefined || name === null ? '' : name}`
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F[\]:*?/\\]/g, ' ')
    .replace(/^[\s']+|[\s']+$/g, '');
  const fit = (text, tail) => {
    let out = '';
    Array.from(text).some((ch) => {
      if (out.length + ch.length + tail.length > 31) {
        return true;
      }
      out += ch;
      return false;
    });
    return `${out.replace(/[\s']+$/, '')}${tail}`;
  };
  let base = clean || 'Sheet';
  if (base.toLowerCase() === 'history') {
    base = `${base}_`;
  }
  let result = fit(base, suffix);
  for (let n = 2; used && used.has(result.toLowerCase()); n += 1) {
    result = fit(base, `${suffix}~${n}`);
  }
  if (used) {
    used.add(result.toLowerCase());
  }
  return result;
};

// ---------------------------------------------------------------- cells

// Styles of styles.xml: 1 heading, 2 date, 3 date and time, 4 time
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?)?$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;

const seconds = (h, m, s, fraction) => (Number(h) * 3600) + (Number(m) * 60) + Number(s)
  + Number(fraction || 0);

// Day number of Excel, or null when the text is no date Excel can count with (before
// 1900-03-01 its calendar is off by the leap day 1900 never had).
export const excelSerial = (text, kind) => {
  if (kind === 'time') {
    const t = TIME.exec(text);
    return t && Number(t[1]) < 24 ? seconds(t[1], t[2], t[3], t[4]) / 86400 : null;
  }
  const m = DATE.exec(text);
  if (!m) {
    return null;
  }
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1900) {
    return null; // also keeps Date.UTC from reading the years 0 to 99 as 1900 to 1999
  }
  const utc = Date.UTC(year, month - 1, day);
  const back = new Date(utc);
  if (year > 9999 || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day
    || utc < Date.UTC(1900, 2, 1)) {
    return null;
  }
  const days = (utc / 86400000) + 25569;
  return kind === 'date' || !m[4] ? days : days + (seconds(m[4], m[5], m[6], m[7]) / 86400);
};

const STYLE = { date: 2, datetime: 3, time: 4 };

const textCell = (ref, value, style) => {
  const text = value.length > CELL_CHARS ? value.slice(0, CELL_CHARS) : value;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${
    escapeXml(text)}</t></is></c>`;
};

// One cell; '' for NULL (the cell is left out).
export const cellXml = (ref, value, kind) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    const text = plainNumber(value);
    if (text === null) {
      return '';
    }
    // Excel keeps 15 digits: a longer whole number (an id, a BIGINT) stays text
    return Number.isInteger(value) && Math.abs(value) >= 1e15 ? textCell(ref, text, '')
      : `<c r="${ref}"><v>${text}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = typeof value === 'string' ? value : String(value);
  if (STYLE[kind]) {
    const serial = excelSerial(text, kind);
    if (serial !== null) {
      return `<c r="${ref}" s="${STYLE[kind]}"><v>${plainNumber(serial)}</v></c>`;
    }
  } else if (kind === 'int' || kind === 'decimal') {
    // Excel keeps 15 digits: a longer number stays text and loses nothing
    const number = numericText(text);
    if (number !== null && number.replace(/[-.]/g, '').length <= 15) {
      return `<c r="${ref}"><v>${number}</v></c>`;
    }
  }
  return textCell(ref, text, '');
};

const WIDTH = {
  int: 12, decimal: 14, date: 12, datetime: 20, time: 10, bool: 8, binary: 20,
};
const displayWidth = text => Array.from(`${text}`)
  .reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
const columnWidth = (column) => {
  const byKind = WIDTH[column.kind] || Math.min(40, Math.max(10, Number(column.len) || 20));
  return Math.min(60, Math.max(8, byKind, displayWidth(column.defKey || '') + 2));
};

// ---------------------------------------------------------------- parts of the package

const STYLES = `${XML}<styleSheet xmlns="${MAIN}">`
  + '<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>'
  + '<numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/>'
  + '<numFmt numFmtId="166" formatCode="hh:mm:ss"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '</cellXfs></styleSheet>';

const contentTypes = sheets => `${XML}<Types xmlns="${PACKAGE}/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + `<Override PartName="/xl/workbook.xml" ContentType="${TYPE}.sheet.main+xml"/>${
    sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${
      TYPE}.worksheet+xml"/>`).join('')
  }<Override PartName="/xl/styles.xml" ContentType="${TYPE}.styles+xml"/></Types>`;

const ROOT_RELS = `${XML}<Relationships xmlns="${PACKAGE}/relationships">`
  + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>`
  + '</Relationships>';

const workbook = sheets => `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${
  sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${
    i + 1}"/>`).join('')}</sheets></workbook>`;

const workbookRels = sheets => `${XML}<Relationships xmlns="${PACKAGE}/relationships">${
  sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${
    i + 1}.xml"/>`).join('')
}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/>`
  + '</Relationships>';

const sheetHead = (columns) => {
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${
    columnWidth(c)}" customWidth="1"/>`).join('');
  const heading = columns.map((c, i) => textCell(`${columnLetters(i)}1`, `${c.defKey || ''}`,
    ' s="1"')).join('');
  return `${XML}<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0">`
    + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    + `</sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>`
    + `<row r="1">${heading}</row>`;
};
const SHEET_TAIL = '</sheetData></worksheet>';

const removeDir = (dir) => {
  try {
    if (fs.rmSync) {
      fs.rmSync(dir, { recursive: true, force: true });
    } else {
      fs.rmdirSync(dir, { recursive: true });
    }
  } catch (e) {
    // the temporary files stay behind, nothing depends on them
  }
};

const guarded = (fn) => {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(e);
  }
};

// ---------------------------------------------------------------- writer

// createXlsxWriter(filePath, options) -> { beginTable, rows, endTable, close }
// options = { maxRows (rows of a sheet with its heading, for the tests), level (deflate,
//   default 1), tempDir (default the temporary directory of the system), date }
// close() -> { file, bytes, sheets: [{name, table, rows}], rows }
export const createXlsxWriter = (filePath, options = {}) => {
  const perSheet = Math.max(2, Math.min(options.maxRows || SHEET_ROWS, SHEET_ROWS)) - 1;
  const tempDir = fs.mkdtempSync(path.join(options.tempDir || os.tmpdir(), 'mypd-xlsx-'));
  const state = createTableState();
  const names = new Set();
  const sheets = []; // {name, table, rows, part: {path, crc, size, compressedSize}}
  let chain = READY; // the calls work one after the other, whether awaited or not
  let openPart = null;

  const openSheet = (cur) => {
    cur.sheetNo += 1;
    cur.sheet = {
      name: sheetName(cur.table.defKey, names, cur.sheetNo),
      table: cur.table.defKey,
      rows: 0,
    };
    cur.part = createDeflatedPart(path.join(tempDir, `sheet${sheets.length + 1}.bin`),
      options.level === undefined ? 1 : options.level);
    sheets.push(cur.sheet);
    openPart = cur.part;
    return cur.part.write(sheetHead(cur.table.columns));
  };

  const closeSheet = cur => cur.part.write(SHEET_TAIL).then(() => cur.part.end())
    .then((info) => {
      cur.sheet.part = info;
      cur.part = null;
      openPart = null;
    });

  const rowsXml = (cur, rows, from, to) => {
    const { letters, kinds } = cur;
    const width = letters.length;
    let out = '';
    for (let r = from; r < to; r += 1) {
      const row = rows[r] || [];
      const n = cur.sheet.rows + (r - from) + 2;
      let cells = '';
      for (let c = 0; c < width; c += 1) {
        cells += cellXml(letters[c] + n, row[c], kinds[c]);
      }
      out += `<row r="${n}">${cells}</row>`;
    }
    return out;
  };

  // the rows that still fit the sheet, the rest after a new sheet was opened
  const writeRows = (cur, rows, from) => {
    if (from >= rows.length) {
      return READY;
    }
    if (cur.sheet.rows >= perSheet) {
      return closeSheet(cur).then(() => openSheet(cur)).then(() => writeRows(cur, rows, from));
    }
    const to = Math.min(rows.length, from + (perSheet - cur.sheet.rows));
    const xml = rowsXml(cur, rows, from, to);
    cur.sheet.rows += to - from;
    cur.rows += to - from;
    return cur.part.write(xml).then(() => writeRows(cur, rows, to));
  };

  const queue = (fn) => {
    chain = chain.then(() => guarded(fn));
    return chain;
  };

  const endTable = () => queue(() => {
    const cur = state.current();
    state.end({ name: cur.table.defKey, rows: cur.rows });
    return closeSheet(cur);
  });

  const pack = () => {
    const list = sheets.length ? sheets : [{ name: 'Sheet1', table: null, rows: 0 }];
    const zip = createZipWriter(filePath, { date: options.date });
    let work = zip.addData('[Content_Types].xml', contentTypes(list))
      .then(() => zip.addData('_rels/.rels', ROOT_RELS))
      .then(() => zip.addData('xl/workbook.xml', workbook(list)))
      .then(() => zip.addData('xl/_rels/workbook.xml.rels', workbookRels(list)))
      .then(() => zip.addData('xl/styles.xml', STYLES));
    list.forEach((sheet, i) => {
      const name = `xl/worksheets/sheet${i + 1}.xml`;
      work = work.then(() => (sheet.part ? zip.addPart(name, sheet.part)
        : zip.addData(name, sheetHead([]) + SHEET_TAIL)));
    });
    return work.then(() => zip.close()).then(bytes => ({
      file: filePath,
      bytes,
      sheets: list.map(s => ({ name: s.name, table: s.table, rows: s.rows })),
      rows: list.reduce((sum, s) => sum + s.rows, 0),
    }), (e) => {
      zip.destroy();
      throw e;
    });
  };

  return {
    beginTable: table => queue(() => {
      const cur = state.begin(table, { sheetNo: 0 });
      cur.letters = table.columns.map((c, i) => columnLetters(i));
      cur.kinds = table.columns.map(c => c.kind);
      return openSheet(cur);
    }),
    rows: rows => queue(() => writeRows(state.current(), rows, 0)),
    endTable,
    close: () => {
      if (state.isOpen()) {
        endTable();
      }
      const result = queue(() => {
        state.close();
        return pack();
      });
      const clean = () => {
        if (openPart) {
          openPart.destroy();
        }
        removeDir(tempDir);
      };
      result.then(clean, clean);
      return result;
    },
  };
};
