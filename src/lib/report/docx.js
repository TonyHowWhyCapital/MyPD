import { zipStore } from './zip';
import { labelOf } from './labels';

// Strip characters XML 1.0 forbids, then escape the markup characters.
const esc = v => String(v)
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const runs = (text, rPr = '') => String(text).split(/\r?\n/).map((line, i) =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');

const para = (text, { style, bold, indent } = {}) => {
  const pPr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${indent ? `<w:ind w:left="${indent}"/>` : ''}`;
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs(text, bold ? '<w:b/>' : '')}</w:p>`;
};

const BORDER = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('');

const table = (headers, rows) => {
  const width = Math.floor(9000 / Math.max(headers.length, 1));
  const cell = (text, head) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="E7EAF0"/>' : ''}</w:tcPr>${para(text, { bold: head })}</w:tc>`;
  const grid = headers.map(() => `<w:gridCol w:w="${width}"/>`).join('');
  const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map(h => cell(h, true)).join('')}</w:tr>`;
  const body = rows.map(r => `<w:tr>${r.map(c => cell(c, false)).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${BORDER}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${head}${body}</w:tbl><w:p/>`;
};

const heading = level => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${36 - level * 4}"/></w:rPr></w:style>`;

const STYLES = `${XML}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>${[1, 2, 3, 4, 5].map(heading).join('')}</w:styles>`;

const CONTENT_TYPES = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const ROOT_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

export const buildDocumentXml = (doc) => {
  const lang = doc.lang || 'zh';
  const headings = doc.blocks.filter(b => b.type === 'heading');
  const body = [
    para(doc.title, { style: 'Title' }),
    para(`${labelOf('generatedTime', lang)}: ${doc.generatedTime}`),
  ];
  doc.blocks.forEach((b) => {
    if (b.type === 'heading') body.push(para(b.text, { style: `Heading${Math.min(b.level + 1, 5)}` }));
    else if (b.type === 'paragraph') body.push(para(b.text));
    else if (b.type === 'toc') {
      body.push(para(labelOf('contents', lang), { bold: true }));
      headings.forEach(h => body.push(para(h.text, { indent: 360 * (h.level - 1) })));
    } else if (b.type === 'table' && b.headers.length) body.push(table(b.headers, b.rows));
  });
  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
  return `${XML}<w:document ${NS}><w:body>${body.join('')}${sect}</w:body></w:document>`;
};

export const renderDocx = (doc) => zipStore([
  { name: '[Content_Types].xml', data: CONTENT_TYPES },
  { name: '_rels/.rels', data: ROOT_RELS },
  { name: 'word/document.xml', data: buildDocumentXml(doc) },
  { name: 'word/styles.xml', data: STYLES },
  { name: 'word/_rels/document.xml.rels', data: DOC_RELS },
]);
