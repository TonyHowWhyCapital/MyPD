import {
  buildReport, renderReport, getDefaultReportTemplates, layoutOf, setLayout, setCoverItem, resetCoverPlaces,
  textBox, logoBox,
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
    expect(doc.cover).toMatchObject({
      title: 'Shop', subtitle: 'Data dictionary', logo: null, background: null, rows: [['Author', 'Tony'], ['Date', '2026-11-16']],
    });
    expect(doc.cover.texts.map(t => t.key)).toEqual(['title', 'subtitle', 'author', 'date']);
    expect(build(documentTpl, { cover: false }).cover).toBeNull();
    const html = renderReport(doc, 'html').data;
    expect(html).toContain('<section class="cover">');
    expect(html).toContain('Data dictionary');
    expect(html).not.toContain('class="title"');
    expect(html).toContain('@page:first{margin:0}');
    expect(renderReport(build(documentTpl, { cover: false }), 'html').data).not.toContain('@page:first');
    const md = renderReport(doc, 'markdown').data;
    expect(md).toContain('- Author：Tony');
    expect(md.startsWith('# Shop\n')).toBe(true);
  });
});

describe('cover title and placement', () => {
  test('the cover shows the model name, not the template name, unless a title is typed', () => {
    const doc = build(documentTpl);
    expect(doc.cover.title).toBe('Shop');
    expect(doc.cover.title).not.toContain(documentTpl.defName);
    const typed = build(documentTpl, { coverTitle: ' Order system ' });
    expect(typed.cover.title).toBe('Order system');
    expect(typed.title).toBe('Order system');
    const two = buildReport(documentTpl, [model, { ...model, name: 'Hub' }], { now: NOW, lang: 'en' });
    expect(two.cover.title).toBe('Shop、Hub');
  });

  test('only changed places, sizes and looks are stored, and invalid ones fall back', () => {
    const items = layoutOf(documentTpl).coverItems;
    expect(items.title).toEqual({
      x: 50, y: 36, size: 32, hidden: false, bold: true, color: '',
    });
    const moved = setLayout(documentTpl, { coverItems: setCoverItem(items, 'author', { x: 20.04, y: 120, size: 18 }) });
    expect(moved.layout).toEqual({ coverItems: { author: { x: 20, y: 97, size: 18 } } });
    expect(layoutOf(moved).coverItems.author).toMatchObject({ x: 20, y: 97, size: 18 });
    expect(setLayout(moved, { coverItems: resetCoverPlaces(layoutOf(moved).coverItems) }).layout)
      .toEqual({ coverItems: { author: { size: 18 } } });
    const reset = setLayout(moved, { coverItems: setCoverItem(layoutOf(moved).coverItems, 'author', { x: 50, y: 70, size: 13 }) });
    expect(reset).not.toHaveProperty('layout');
    expect(layoutOf({ kind: 'document', layout: { coverItems: { title: { x: 'a', size: 7, color: 'red', bold: 1 } } } }).coverItems.title)
      .toEqual(items.title);
  });

  test('a hidden part is left off every format', () => {
    const items = layoutOf(documentTpl).coverItems;
    const doc = build(documentTpl, { author: 'Tony', coverItems: setCoverItem(items, 'date', { hidden: true }) });
    expect(doc.cover.texts.map(t => t.key)).toEqual(['title', 'author']);
    expect(doc.cover.rows).toEqual([['Author', 'Tony']]);
    expect(buildDocumentXml(doc)).not.toContain('2026-11-16');
  });

  test('a text is centred on its place and may run to the nearer page edge', () => {
    expect(textBox({ x: 50, y: 10 }, 1000, 2000)).toEqual({ left: 0, width: 1000, top: 200 });
    expect(textBox({ x: 20, y: 0 }, 1000, 2000)).toEqual({ left: 0, width: 400, top: 0 });
    expect(textBox({ x: 90, y: 50 }, 1000, 2000)).toEqual({ left: 800, width: 200, top: 1000 });
    expect(logoBox({ x: 50, y: 10, size: 30 }, 1000, 2000)).toEqual({ left: 350, width: 300, top: 200 });
  });

  test('docx puts each part in a frame at its place, with its size, weight and colour', () => {
    const items = layoutOf(documentTpl).coverItems;
    const doc = build(documentTpl, {
      subtitle: 'Dictionary',
      coverItems: setCoverItem(setCoverItem(items, 'subtitle', { x: 25, y: 50, size: 20, color: '#c00000' }), 'title', { bold: false }),
    });
    const xml = buildDocumentXml(doc);
    // A4 portrait is 11906 by 16838 twentieths of a point.
    expect(xml).toContain('<w:framePr w:w="5953" w:wrap="around" w:hAnchor="page" w:vAnchor="page" w:x="0" w:y="8419"/>');
    expect(xml).toMatch(/<w:color w:val="C00000"\/><w:sz w:val="40"\/><\/w:rPr><w:t xml:space="preserve">Dictionary/);
    expect(xml).toMatch(/<w:rPr><w:sz w:val="64"\/><\/w:rPr><w:t xml:space="preserve">Shop</);
  });

  test('html places each part in percent of the page', () => {
    const items = layoutOf(documentTpl).coverItems;
    const html = renderReport(build(documentTpl, { coverItems: setCoverItem(items, 'title', { x: 30, y: 20, size: 40 }) }), 'html').data;
    expect(html).toContain('<div data-part="title" style="left:0%;width:60%;top:20%;font-size:40pt;font-weight:bold;color:#222222">Shop</div>');
    expect(renderReport(build(documentTpl, { landscape: true }), 'html').data).toContain('<section class="cover landscape">');
  });
});

describe('report layout in docx', () => {
  test('the cover is a section of its own and the pages after it count from 1', () => {
    const xml = buildDocumentXml(build(documentTpl));
    expect(xml.match(/<w:sectPr>/g)).toHaveLength(2);
    const [cover, rest] = xml.split('</w:sectPr></w:pPr></w:p>');
    expect(cover).toContain('w:hAnchor="page" w:vAnchor="page"');
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

  test('docx packs the pictures and places the logo at its place and the background behind the text', () => {
    const doc = build(documentTpl, { logo: png, background: jpg });
    const xml = buildDocumentXml(doc);
    // 30% of the page width, centred, 12% down; 400 by 100 pixels keeps its proportion.
    expect(xml).toContain('<wp:positionH relativeFrom="page"><wp:posOffset>2646045</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>1283335</wp:posOffset></wp:positionV><wp:extent cx="2268220" cy="567055"/>');
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
    expect(html).toContain(`<img alt="" src="${png.data}" style="left:35%;top:12%;width:30%">`);
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
