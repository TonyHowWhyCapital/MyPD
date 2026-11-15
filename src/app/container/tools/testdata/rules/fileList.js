// The list a `file` rule draws from: one column of a text or CSV file.
import fs from 'fs';

export const MAX_LIST_BYTES = 20 * 1024 * 1024;
export const MAX_LIST_VALUES = 1000000;

const listError = (code, detail) => {
  const error = new Error(detail === undefined ? code : `${code}: ${detail}`);
  error.code = code;
  if (detail !== undefined) {
    error.detail = detail;
  }
  return error;
};

// a comma, unless the first line has tabs and no comma
const delimiterOf = (text) => {
  const end = text.search(/[\r\n]/);
  const first = end < 0 ? text : text.slice(0, end);
  return first.indexOf('\t') >= 0 && first.indexOf(',') < 0 ? '\t' : ',';
};

// rows of fields, quoting as in RFC 4180 (a doubled quote inside quotes is one quote)
export const parseRows = (source, limit = Infinity) => {
  const text = `${source || ''}`.replace(/^\uFEFF/, '');
  const delimiter = delimiterOf(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let started = false;
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
    }
    row = [];
    field = '';
    started = false;
  };
  for (let i = 0; i < text.length && rows.length < limit; i += 1) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && !started) {
      quoted = true;
      started = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      started = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') {
        i += 1;
      }
      endRow();
    } else {
      field += ch;
      started = true;
    }
  }
  if (rows.length < limit && (field !== '' || row.length > 0)) {
    endRow();
  }
  return rows;
};

// params = {column = 0, header = false} -> the values of that column, blanks left out
export const parseListText = (text, params = {}, limit = MAX_LIST_VALUES) => {
  const column = Number.isInteger(Number(params.column)) && Number(params.column) >= 0
    ? Number(params.column) : 0;
  const rows = parseRows(text, limit + 1 + (params.header ? 1 : 0));
  return (params.header ? rows.slice(1) : rows)
    .map(r => (r[column] === undefined ? '' : `${r[column]}`.trim()))
    .filter(v => v !== '')
    .slice(0, limit);
};

// headings of the file (or "1", "2", … when it has none), for choosing the column
export const listColumns = (text, header) => {
  const first = parseRows(text, 1)[0] || [];
  return first.map((name, index) => (header && `${name}`.trim() ? `${name}`.trim() : `${index + 1}`));
};

// the text of the file (UTF-8); only the first `maxBytes` when the file is larger and
// `partial` is allowed, otherwise a file over the limit is refused
export const readListText = (filePath, { maxBytes = MAX_LIST_BYTES, partial = false } = {}) => (
  new Promise((resolve, reject) => {
    fs.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        reject(listError('file.read', filePath));
        return;
      }
      if (stat.size > maxBytes && !partial) {
        reject(listError('file.tooLarge', filePath));
        return;
      }
      const stream = fs.createReadStream(filePath, {
        start: 0,
        end: Math.max(0, Math.min(stat.size, maxBytes) - 1),
      });
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('error', () => reject(listError('file.read', filePath)));
      stream.on('end', () => {
        let text = Buffer.concat(chunks).toString('utf8');
        if (stat.size > maxBytes) {
          // the last line of a cut file may be half a line
          text = text.slice(0, Math.max(text.lastIndexOf('\n'), 0));
        }
        resolve(text);
      });
    });
  }));

// the whole list of a `file` rule, as `ctx.lists.file[path]` of the generator wants it
export const readListFile = (filePath, params, options) => readListText(filePath, options)
  .then((text) => {
    const values = parseListText(text, params);
    if (values.length === 0) {
      throw listError('file.empty', filePath);
    }
    return values;
  });
