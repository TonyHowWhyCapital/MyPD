import { zipStore } from './zip';
import { labelOf } from './labels';
import { columnPercents } from './sections';
import { pageNumberParts } from './layout';
import { IMAGE_FIELDS, bytesOf, extensionOf } from './image';
import { DRAWING_NS, mediaName, logoRun, backgroundRun } from './docx_image';

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

const para = (text, {
  style, bold, indent, align, run, bookmark,
} = {}) => {
  const jc = align && align !== 'left' ? `<w:jc w:val="${align}"/>` : '';
  const pPr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${indent ? `<w:ind w:left="${indent}"/>` : ''}${jc}`;
  const content = runs(text, run || (bold ? '<w:b/>' : ''));
  const marked = bookmark ? `<w:bookmarkStart w:id="${bookmark.id}" w:name="${bookmark.name}"/>${content}<w:bookmarkEnd w:id="${bookmark.id}"/>` : content;
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${marked}</w:p>`;
};

const BORDER = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('');

const PAGE = { long: 16838, short: 11906, margin: 1134 };
const TABLE_WIDTH = { false: 9000, true: 14000 };
const contentWidth = landscape => (landscape ? PAGE.long : PAGE.short) - PAGE.margin * 2;
const hex = c => c.slice(1).toUpperCase();
// Run properties in the order the schema lists them.
const runOf = s => (s ? `${s.bold ? '<w:b/>' : ''}${s.italic ? '<w:i/>' : ''}${s.color ? `<w:color w:val="${hex(s.color)}"/>` : ''}${s.size ? `<w:sz w:val="${s.size * 2}"/>` : ''}${s.underline ? '<w:u w:val="single"/>' : ''}` : '');

const table = (headers, rows, {
  widths, aligns, styles, headAligns, headStyles,
}, tableWidth) => {
  const percents = columnPercents(widths, headers.length);
  const even = Math.floor(tableWidth / Math.max(headers.length, 1));
  const widthOf = i => (percents ? Math.round(tableWidth * percents[i] / 100) : even);
  const lookOf = (head, i) => ((head ? headStyles : styles) || [])[i] || (head ? { bold: true } : null);
  const fillOf = (head, i) => (lookOf(head, i) && lookOf(head, i).fill ? hex(lookOf(head, i).fill) : head && 'E7EAF0');
  const alignOf = (head, i) => (head ? (headAligns || [])[i] || 'center' : (aligns || [])[i]);
  const shade = fill => (fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '');
  const cell = (text, head, i) => `<w:tc><w:tcPr><w:tcW w:w="${widthOf(i)}" w:type="dxa"/>${shade(fillOf(head, i))}</w:tcPr>${para(text, { align: alignOf(head, i), run: runOf(lookOf(head, i)) })}</w:tc>`;
  const grid = headers.map((h, i) => `<w:gridCol w:w="${widthOf(i)}"/>`).join('');
  const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((h, i) => cell(h, true, i)).join('')}</w:tr>`;
  const body = rows.map(r => `<w:tr>${r.map((c, i) => cell(c, false, i)).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${BORDER}</w:tblBorders>${percents ? '<w:tblLayout w:type="fixed"/>' : ''}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${head}${body}</w:tbl><w:p/>`;
};

const heading = level => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.max(32 - level * 4, 16)}"/></w:rPr></w:style>`;
// Word lays the table of contents out with these when it fills in the page numbers.
const tocStyle = width => level => `<w:style w:type="paragraph" w:styleId="TOC${level}"><w:name w:val="toc ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${width}"/></w:tabs><w:spacing w:after="60"/><w:ind w:left="${360 * (level - 1)}"/></w:pPr></w:style>`;
const LEVELS = [1, 2, 3, 4, 5];

const stylesXml = width => `${XML}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>${LEVELS.map(heading).join('')}${LEVELS.map(tocStyle(width)).join('')}</w:styles>`;

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const ROOT_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`;
const contentTypes = (parts, images) => `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${[...new Set(images.map(([, image]) => extensionOf(image)))].map(e => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${WML}.styles+xml"/>${parts.map(p => `<Override PartName="/word/${p}.xml" ContentType="${WML}.${p}+xml"/>`).join('')}</Types>`;
const docRels = (parts, images) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>${parts.map(p => `<Relationship Id="${p}" Type="${REL}/${p}" Target="${p}.xml"/>`).join('')}${images.map(([name, image]) => `<Relationship Id="${name}" Type="${REL}/image" Target="${mediaName(name, image)}"/>`).join('')}</Relationships>`;

const SMALL = '<w:color w:val="666666"/><w:sz w:val="18"/>';
// Word works a field out itself when it lays the page out, `shown` is what other readers see.
const fieldRun = (inner, rPr) => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${inner}</w:r>`;
const fieldEnd = rPr => fieldRun('<w:fldChar w:fldCharType="end"/>', rPr);
const fieldStart = (code, rPr = '', dirty = false) => [
  `<w:fldChar w:fldCharType="begin"${dirty ? ' w:dirty="true"' : ''}/>`,
  `<w:instrText xml:space="preserve"> ${code} </w:instrText>`,
  '<w:fldChar w:fldCharType="separate"/>',
].map(inner => fieldRun(inner, rPr)).join('');
const field = (code, shown, rPr) => `${fieldStart(code, rPr)}${shown}${fieldEnd(rPr)}`;

const layoutOfDoc = doc => doc.layout || {};
const imagesOf = doc => IMAGE_FIELDS.filter(f => doc.cover && doc.cover[f]).map(f => [f, doc.cover[f]]);
const partsOf = (doc) => {
  const layout = layoutOfDoc(doc);
  return [layout.header && 'header', pageNumberParts(layout.pageNumber, doc.lang).length && 'footer'].filter(Boolean);
};

export const buildHeaderXml = (doc) => {
  const width = contentWidth(layoutOfDoc(doc).landscape);
  const right = layoutOfDoc(doc).organization || doc.generatedTime.slice(0, 10);
  return `${XML}<w:hdr ${NS}><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="999999"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${width}"/></w:tabs></w:pPr>${runs(doc.title, SMALL)}<w:r><w:tab/></w:r>${runs(right, SMALL)}</w:p></w:hdr>`;
};

export const buildFooterXml = (doc) => {
  // With a cover the pages are counted from the page after it, and so is their total.
  const total = doc.cover ? 'SECTIONPAGES' : 'NUMPAGES';
  const body = pageNumberParts(layoutOfDoc(doc).pageNumber, doc.lang).map((part) => {
    if (part === '{page}') return field('PAGE', runs('1', SMALL), SMALL);
    if (part === '{total}') return field(total, runs('1', SMALL), SMALL);
    return runs(part, SMALL);
  }).join('');
  return `${XML}<w:ftr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${body}</w:p></w:ftr>`;
};

const centred = (text, rPr, { before = 0, after = 0, rule } = {}) => `<w:p><w:pPr>${rule ? '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="12" w:color="444444"/></w:pBdr>' : ''}<w:spacing w:before="${before}" w:after="${after}"/><w:jc w:val="center"/></w:pPr>${runs(text, rPr)}</w:p>`;

const pageSize = landscape => `<w:pgSz w:w="${landscape ? PAGE.long : PAGE.short}" w:h="${landscape ? PAGE.short : PAGE.long}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="567" w:footer="567" w:gutter="0"/>`;

// The cover is a section of its own: centred on the page, no header, no page number.
const coverXml = (doc) => {
  const {
    subtitle, rows, logo, background,
  } = doc.cover;
  const landscape = layoutOfDoc(doc).landscape;
  const page = landscape ? [PAGE.long, PAGE.short] : [PAGE.short, PAGE.long];
  const pictures = `${background ? backgroundRun(background, ...page) : ''}${logo ? logoRun(logo) : ''}`;
  return [
    pictures ? `<w:p><w:pPr><w:spacing w:after="${logo ? 480 : 0}"/><w:jc w:val="center"/></w:pPr>${pictures}</w:p>` : '',
    centred(doc.title, '<w:b/><w:sz w:val="64"/>', { after: 240, rule: true }),
    subtitle ? centred(subtitle, '<w:color w:val="555555"/><w:sz w:val="36"/>', { after: 240 }) : '',
    ...rows.map(([label, value], i) => centred(`${label}：${value}`, '<w:sz w:val="26"/>', { before: i ? 0 : 2400, after: 120 })),
    `<w:p><w:pPr><w:sectPr>${pageSize(landscape)}<w:vAlign w:val="center"/></w:sectPr></w:pPr></w:p>`,
  ].join('');
};

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

// Every heading carries a bookmark, so an entry of the contents leads to its chapter
// whether or not Word has rebuilt the table.
const bookmarkOf = index => ({ id: index + 1, name: `_Toc${String(index + 1).padStart(6, '0')}` });

// The entry holds no page number of its own: with one, Word left the numbers empty
// instead of rebuilding the table.
const tocEntry = (heading, index, withPage) => {
  const { name } = bookmarkOf(index);
  const level = Math.min(heading.level, 5);
  const pPr = withPage ? `<w:pStyle w:val="TOC${level}"/>` : `<w:ind w:left="${360 * (heading.level - 1)}"/>`;
  return `<w:p><w:pPr>${pPr}</w:pPr><w:hyperlink w:anchor="${name}" w:history="1">${runs(heading.text)}</w:hyperlink></w:p>`;
};

const tocXml = (doc, headings) => {
  const lang = doc.lang || 'zh';
  const withPages = !!layoutOfDoc(doc).tocPages;
  const entries = headings.map((h, i) => tocEntry(h, i, withPages));
  if (!withPages) return [para(labelOf('contents', lang), { bold: true }), ...entries];
  // Word fills the page numbers in when it rebuilds the field on opening the file.
  return [
    para(labelOf('contents', lang), { run: '<w:b/><w:sz w:val="28"/>' }),
    `<w:p>${fieldStart('TOC \\o "1-5" \\h \\z \\u', '', true)}</w:p>`,
    ...entries,
    `<w:p>${fieldEnd()}</w:p>`,
  ];
};

export const buildDocumentXml = (doc) => {
  const lang = doc.lang || 'zh';
  const layout = layoutOfDoc(doc);
  const headings = doc.blocks.filter(b => b.type === 'heading');
  const tableWidth = TABLE_WIDTH[!!layout.landscape];
  const body = doc.cover ? [coverXml(doc)] : [
    para(doc.title, { style: 'Title' }),
    para(`${labelOf('generatedTime', lang)}: ${doc.generatedTime}`),
  ];
  let chapter = 0;
  doc.blocks.forEach((b) => {
    if (b.type === 'heading') {
      body.push(para(b.text, { style: `Heading${Math.min(b.level, 5)}`, bookmark: bookmarkOf(chapter) }));
      chapter += 1;
    }
    else if (b.type === 'paragraph') body.push(para(b.text));
    else if (b.type === 'toc') body.push(...tocXml(doc, headings), doc.cover ? PAGE_BREAK : '');
    else if (b.type === 'table' && b.headers.length) body.push(table(b.headers, b.rows, b, tableWidth));
  });
  const refs = partsOf(doc).map(p => `<w:${p}Reference w:type="default" r:id="${p}"/>`).join('');
  const sect = `<w:sectPr>${refs}${pageSize(layout.landscape)}${doc.cover ? '<w:pgNumType w:start="1"/>' : ''}</w:sectPr>`;
  return `${XML}<w:document ${NS} xmlns:r="${REL}" ${DRAWING_NS}><w:body>${body.join('')}${sect}</w:body></w:document>`;
};

export const renderDocx = (doc) => {
  const parts = partsOf(doc);
  const images = imagesOf(doc);
  const build = { header: buildHeaderXml, footer: buildFooterXml };
  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes(parts, images) },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/document.xml', data: buildDocumentXml(doc) },
    { name: 'word/styles.xml', data: stylesXml(contentWidth(layoutOfDoc(doc).landscape)) },
    { name: 'word/_rels/document.xml.rels', data: docRels(parts, images) },
    ...parts.map(p => ({ name: `word/${p}.xml`, data: build[p](doc) })),
    ...images.map(([name, image]) => ({ name: `word/${mediaName(name, image)}`, data: bytesOf(image) })),
  ]);
};
