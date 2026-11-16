import {
  buildReport, renderReport, getDefaultReportTemplates, layoutOf, setLayout,
} from '../src/lib/report';
import { buildDocumentXml, buildFooterXml, buildHeaderXml } from '../src/lib/report/docx';
import { bytesOf, fitInto, cropToFill } from '../src/lib/report/image';

const NOW = '2026-11-16T08:00:00';
const model = {
  name: 'Shop',
  entities: [{ id: 'e1', defKey: 'orders', defName: 'Orders', fields: [{ id: 'f1', defKey: 'id', defName: 'Id' }] }],
};
const [documentTpl, listTpl] = getDefaultReportTemplates('en');
const build = (tpl, change) => buildReport(change ? setLayout(tpl, change) : tpl, [model], { now: NOW, lang: 'en' });
const fileNames = (bytes) => {
  const text = Buffer.from(bytes).toString('latin1');
  return ['word/header.xml', 'word/footer.xml'].filter(n => text.includes(n));
};

describe('report layout', () => {
  test('a document starts out with cover, header, page numbers and numbered chapters, a list with none', () => {
    expect(layoutOf(documentTpl)).toMatchObject({
      cover: true, header: true, tocPages: true, numbering: true, landscape: false, pageNumber: 'pageOfTotal',
    });
    expect(layoutOf(listTpl)).toMatchObject({ cover: false, header: false, pageNumber: 'none' });
  });

  test('the template stores only what differs from the defaults, and ignores invalid values', () => {
    expect(setLayout(documentTpl, { cover: true })).not.toHaveProperty('layout');
    const changed = setLayout(documentTpl, { cover: false, author: 'Tony' });
    expect(changed.layout).toEqual({ cover: false, author: 'Tony' });
    expect(setLayout(changed, { cover: true, author: '' })).not.toHaveProperty('layout');
    expect(layoutOf({ kind: 'document', layout: { pageNumber: 'roman', cover: 'yes' } }))
      .toMatchObject({ pageNumber: 'pageOfTotal', cover: true });
  });

  test('chapters are numbered by level, and the numbers can be switched off', () => {
    const texts = doc => doc.blocks.filter(b => b.type === 'heading').map(b => `${b.level}:${b.text}`);
    const numbered = texts(build(documentTpl));
    expect(numbered[0]).toMatch(/^1:1 /);
    expect(numbered).toEqual(expect.arrayContaining([expect.stringMatching(/^2:\d+\.1 /)]));
    texts(build(documentTpl, { numbering: false })).forEach(t => expect(t).not.toMatch(/^\d:\d+(\.\d+)* /));
  });

  test('the cover carries the title, the subtitle and the filled-in details', () => {
    const doc = build(documentTpl, { subtitle: 'Data dictionary', author: 'Tony', version: ' ' });
    expect(doc.cover).toEqual({
      subtitle: 'Data dictionary', logo: null, background: null, rows: [['Author', 'Tony'], ['Date', '2026-11-16']],
    });
    expect(build(documentTpl, { cover: false }).cover).toBeNull();
    const html = renderReport(doc, 'html').data;
    expect(html).toContain('<section class="cover">');
    expect(html).toContain('Data dictionary');
    expect(html).not.toContain('class="title"');
    expect(renderReport(doc, 'markdown').data).toContain('- Author：Tony');
  });
});

describe('report layout in docx', () => {
  test('the cover is a section of its own and the pages after it count from 1', () => {
    const xml = buildDocumentXml(build(documentTpl));
    expect(xml.match(/<w:sectPr>/g)).toHaveLength(2);
    const [cover, rest] = xml.split('</w:sectPr></w:pPr></w:p>');
    expect(cover).toContain('<w:vAlign w:val="center"/>');
    expect(cover).not.toContain('Reference');
    expect(rest).toContain('<w:headerReference w:type="default" r:id="header"/>');
    expect(rest).toContain('<w:footerReference w:type="default" r:id="footer"/>');
    expect(rest).toContain('<w:pgNumType w:start="1"/>');
    expect(xml).not.toContain('w:val="Title"');
  });

  test('without a cover the title stays on the first page and all pages are counted', () => {
    const doc = build(documentTpl, { cover: false });
    const xml = buildDocumentXml(doc);
    expect(xml.match(/<w:sectPr>/g)).toHaveLength(1);
    expect(xml).toContain('w:val="Title"');
    expect(buildFooterXml(doc)).toContain(' NUMPAGES ');
  });

  test('the page number follows the chosen form', () => {
    const footer = change => buildFooterXml(build(documentTpl, change));
    expect(footer()).toMatch(/Page <.* PAGE .* of <.* SECTIONPAGES /);
    expect(footer({ pageNumber: 'page' })).not.toContain('SECTIONPAGES');
    expect(footer({ pageNumber: 'slash' })).toContain(' / ');
  });

  test('header and footer parts are only packed when they are switched on', () => {
    expect(fileNames(renderReport(build(documentTpl), 'docx').data)).toEqual(['word/header.xml', 'word/footer.xml']);
    expect(fileNames(renderReport(build(documentTpl, { header: false, pageNumber: 'none' }), 'docx').data)).toEqual([]);
    expect(fileNames(renderReport(build(listTpl), 'docx').data)).toEqual([]);
  });

  test('the header shows the report title and the organization', () => {
    const xml = buildHeaderXml(build(documentTpl, { organization: 'ACME & Co' }));
    expect(xml).toContain('Shop Full model document');
    expect(xml).toContain('ACME &amp; Co');
  });

  test('the table of contents is a field Word fills with page numbers, or plain lines', () => {
    const withPages = buildDocumentXml(build(documentTpl));
    expect(withPages).toContain(' TOC \\o "1-5" \\h \\z \\u ');
    expect(withPages).toContain('w:dirty="true"');
    expect(withPages).toContain('w:val="TOC1"');
    expect(withPages.match(/fldCharType="begin"/g)).toHaveLength(withPages.match(/fldCharType="end"/g).length);
    const plain = buildDocumentXml(build(documentTpl, { tocPages: false }));
    expect(plain).not.toContain('fldChar');
  });

  test('landscape turns the page and tells the browser', () => {
    const doc = build(documentTpl, { landscape: true });
    expect(buildDocumentXml(doc)).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>');
    expect(renderReport(doc, 'html').data).toContain('@page{size:A4 landscape}');
  });
});

describe('cover pictures', () => {
  const raw = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 7]);
  const png = { data: `data:image/png;base64,${raw.toString('base64')}`, width: 400, height: 100 };
  const jpg = { data: `data:image/jpeg;base64,${raw.toString('base64')}`, width: 1000, height: 1000 };

  test('only a png or jpeg with a size is kept', () => {
    expect(layoutOf(setLayout(documentTpl, { logo: png })).logo).toEqual(png);
    expect(layoutOf({ kind: 'document', layout: { logo: { ...png, data: 'data:image/svg+xml;base64,AAAA' } } }).logo).toBeNull();
    expect(layoutOf({ kind: 'document', layout: { logo: { data: png.data } } }).logo).toBeNull();
    expect(setLayout(setLayout(documentTpl, { logo: png }), { logo: null })).not.toHaveProperty('layout');
  });

  test('the bytes come back out of the data URL as they went in', () => {
    expect(Array.from(bytesOf(png))).toEqual(Array.from(raw));
  });

  test('a logo is fitted into its box, a background is cropped to fill the page', () => {
    expect(fitInto(png, 200, 200)).toEqual({ width: 200, height: 50 });
    expect(cropToFill(jpg, 100, 200)).toEqual({ x: 0.25, y: 0 });
    expect(cropToFill(png, 100, 100)).toEqual({ x: 0.375, y: 0 });
    expect(cropToFill({ width: 100, height: 400 }, 100, 200)).toEqual({ x: 0, y: 0.25 });
  });

  test('docx packs the pictures and places the logo in line and the background behind the text', () => {
    const doc = build(documentTpl, { logo: png, background: jpg });
    const xml = buildDocumentXml(doc);
    expect(xml).toContain('<wp:inline');
    expect(xml).toContain('r:embed="logo"');
    expect(xml).toContain('behindDoc="1"');
    expect(xml).toContain('r:embed="background"');
    expect(xml.indexOf('r:embed="background"')).toBeLessThan(xml.indexOf('</w:sectPr>'));
    const packed = Buffer.from(renderReport(doc, 'docx').data).toString('latin1');
    ['word/media/logo.png', 'word/media/background.jpeg', 'Extension="png"', 'Extension="jpeg"', 'Target="media/logo.png"']
      .forEach(part => expect(packed).toContain(part));
  });

  test('without a cover no picture is packed, and html shows both on the cover', () => {
    const packed = Buffer.from(renderReport(build(documentTpl, { logo: png, cover: false }), 'docx').data).toString('latin1');
    expect(packed).not.toContain('word/media');
    const html = renderReport(build(documentTpl, { logo: png, background: jpg }), 'html').data;
    expect(html).toContain(`<img alt="" src="${png.data}">`);
    expect(html).toContain(`background-image:url(${jpg.data})`);
  });
});

describe('the contents lead to the chapters', () => {
  const doc = build(documentTpl);
  const count = doc.blocks.filter(b => b.type === 'heading').length;

  test('docx bookmarks every heading and links every entry to it, with or without page numbers', () => {
    [buildDocumentXml(doc), buildDocumentXml(build(documentTpl, { tocPages: false }))].forEach((xml) => {
      const marks = xml.match(/<w:bookmarkStart w:id="\d+" w:name="(_Toc\d{6})"\/>/g).map(m => /_Toc\d{6}/.exec(m)[0]);
      const links = xml.match(/<w:hyperlink w:anchor="(_Toc\d{6})"/g).map(m => /_Toc\d{6}/.exec(m)[0]);
      expect(marks).toHaveLength(count);
      expect(new Set(marks).size).toBe(count);
      expect(links).toEqual(marks);
      expect(xml.match(/<w:bookmarkEnd /g)).toHaveLength(count);
    });
  });

  test('markdown and html link each entry to an anchor that exists', () => {
    const md = renderReport(doc, 'markdown').data;
    const html = renderReport(doc, 'html').data;
    for (let i = 1; i <= count; i += 1) {
      expect(md).toContain(`<a id="h-${i}"></a>`);
      expect(md).toContain(`](#h-${i})`);
      expect(html).toContain(`id="h-${i}"`);
      expect(html).toContain(`href="#h-${i}"`);
    }
  });

  test('a report without contents gets no anchors in markdown', () => {
    const plain = { ...documentTpl, sections: documentTpl.sections.filter(s => s.type !== 'toc') };
    expect(renderReport(build(plain), 'markdown').data).not.toContain('<a id=');
  });
});
