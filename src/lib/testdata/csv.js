// Test data as CSV: one file per table in a directory. UTF-8 with byte order mark, CRLF,
// RFC 4180 quoting, like toCsv in grid_export.js. The first line holds the column names.
// NULL is an empty field, an empty string is written as "" so the two stay apart
// (PostgreSQL COPY and most loaders read it that way). Booleans are 1 and 0.
import fs from 'fs';
import path from 'path';
import {
  createSink, createTableState, safeFileName, removeQuietly,
} from './files';
import { plainNumber } from './sql_dialects';

const BOM = String.fromCharCode(0xFEFF);
const READY = Promise.resolve();

const quote = text => `"${text.replace(/"/g, '""')}"`;

// A text that starts with one of these is read as a formula by Excel and LibreOffice.
const FORMULA_START = /^[=+\-@\t\r]/;

// options.guardFormulas: put an apostrophe in front of a text a spreadsheet would run as a
// formula (numbers are not touched). Off by default: the file is data, and a loader would
// store the apostrophe. (An object, so that `values.map(csvField)` cannot switch it on.)
export const csvField = (value, options) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return plainNumber(value) || '';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  let text = typeof value === 'string' ? value : String(value);
  if (text === '') {
    return '""';
  }
  if (options && options.guardFormulas === true && FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  // a leading or trailing blank is quoted too, some readers trim it otherwise
  return /[",\r\n]|^\s|\s$/.test(text) ? quote(text) : text;
};

export const csvLine = (values, options) => `${
  values.map(v => csvField(v, options)).join(',')}\r\n`;

const guarded = (fn) => {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(e);
  }
};

// createCsvWriter(dir, { guardFormulas = false })
//   -> { beginTable, rows, endTable, close, abort }
// close() -> { dir, files: [{table, file, path, rows}], rows }
export const createCsvWriter = (dir, options = {}) => {
  const guard = { guardFormulas: !!(options && options.guardFormulas) };
  fs.mkdirSync(dir, { recursive: true });
  const state = createTableState();
  const used = new Set();
  const files = [];
  let aborted = null;

  const endTable = () => guarded(() => {
    const cur = state.current();
    state.end({
      table: cur.table.defKey,
      file: cur.file,
      path: path.join(dir, cur.file),
      rows: cur.rows,
    });
    return cur.sink.end();
  });

  return {
    beginTable: table => guarded(() => {
      const cur = state.begin(table, { width: table.columns.length });
      cur.file = `${safeFileName(table.defKey, used)}.csv`;
      files.push(path.join(dir, cur.file));
      cur.sink = createSink(path.join(dir, cur.file));
      // a column name is never NULL: an empty one is written as ""
      return cur.sink.write(BOM + csvLine(table.columns.map(c => `${c.defKey || ''}`)));
    }),
    rows: rows => guarded(() => {
      const cur = state.current();
      const { width } = cur;
      let out = '';
      for (let r = 0; r < rows.length; r += 1) {
        const row = rows[r] || [];
        let line = '';
        for (let c = 0; c < width; c += 1) {
          line += c ? `,${csvField(row[c], guard)}` : csvField(row[c], guard);
        }
        out += `${line}\r\n`;
      }
      cur.rows += rows.length;
      return cur.sink.write(out);
    }),
    endTable,
    close: () => guarded(() => (state.isOpen() ? endTable() : READY)).then(() => {
      state.close();
      return {
        dir,
        files: state.done,
        rows: state.done.reduce((sum, t) => sum + t.rows, 0),
      };
    }),
    // stops at once and removes the files written so far; the folder stays
    abort: () => {
      if (!aborted) {
        const open = state.abort();
        aborted = (open && open.sink ? open.sink.destroy() : READY)
          .then(() => files.forEach(removeQuietly));
      }
      return aborted;
    },
  };
};
