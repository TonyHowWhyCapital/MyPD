import { zipStore } from './report/zip';

// Rows of a grid as a sheet: `matrix` is an array of rows, the first one the headings.
// A cell is a string or a number; a number stays a number in Excel, a code such as
// "001" is a string and keeps its zeros.

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const esc = v => String(v)
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// What a cell of the grid shows, as text. `lookups` maps a column to the list its value
// points into (domains, dictionaries), `checks` names the columns drawn as a tick.
export const cellText = (column, row, lookups = {}, checks = []) => {
  const value = row[column];
  if (lookups[column]) {
    const item = lookups[column].find(o => o.id === value);
    return item ? (item.defName || item.defKey || '') : '';
  }
  if (checks.includes(column) || typeof value === 'boolean') {
    return value ? 'Y' : 'N';
  }
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'object' ? JSON.stringify(value) : value;
};

export const gridMatrix = (headers, rows, lookups, checks) => [
  headers.map(h => h.title),
  ...rows.map(r => headers.map(h => cellText(h.key, r, lookups, checks))),
];

// The mark at the start makes Excel read the file as UTF-8.
export const toCsv = matrix => `﻿${matrix.map(row => row.map((cell) => {
  const text = String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}).join(',')).join('\r\n')}\r\n`;

const columnName = (index) => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
};

const sheetXml = (matrix) => {
  const rows = matrix.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
    const ref = `${columnName(c)}${r + 1}`;
    if (typeof cell === 'number' && Number.isFinite(cell)) {
      return `<c r="${ref}"><v>${cell}</v></c>`;
    }
    const style = r === 0 ? ' s="1"' : '';
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(cell)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const widths = (matrix[0] || []).map((_, c) => {
    const longest = Math.max(...matrix.map(row => [...String(row[c])]
      .reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)));
    return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(8, longest + 2))}" customWidth="1"/>`;
  }).join('');
  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<cols>${widths}</cols><sheetData>${rows}</sheetData></worksheet>`;
};

const CONTENT_TYPES = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
  + '</Types>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const ROOT_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const BOOK_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>`
  + `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`;
const STYLES = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
  + '</styleSheet>';

const sheetName = name => (String(name || '').replace(/[\\/?*[\]:]/g, ' ').trim() || 'Sheet1').slice(0, 31);

export const toXlsx = (matrix, name) => zipStore([
  { name: '[Content_Types].xml', data: CONTENT_TYPES },
  { name: '_rels/.rels', data: ROOT_RELS },
  { name: 'xl/workbook.xml', data: `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="${esc(sheetName(name)).replace(/"/g, '&quot;')}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
  { name: 'xl/_rels/workbook.xml.rels', data: BOOK_RELS },
  { name: 'xl/styles.xml', data: STYLES },
  { name: 'xl/worksheets/sheet1.xml', data: sheetXml(matrix) },
]);
