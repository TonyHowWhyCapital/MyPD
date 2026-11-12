import demo from '../src/lib/template/教学管理系统.pdma.json';
import {
  sectionTypes, getDefaultReportTemplates, getEmptyReportTemplate, validateReportTemplate,
  saveReportTemplate, removeReportTemplate, getReportTemplates, buildReport, renderReport,
  renderMarkdown, renderHtml, renderDocx, renderCsv,
} from '../src/lib/report';
import { crc32 } from '../src/lib/report/zip';

const clone = o => JSON.parse(JSON.stringify(o));
const NOW = new Date(2024, 0, 2, 3, 4, 5);
const tables = doc => doc.blocks.filter(b => b.type === 'table');
const headings = doc => doc.blocks.filter(b => b.type === 'heading');

const rich = () => {
  const ds = clone(demo);
  const [a, b] = ds.entities;
  ds.name = 'RichModel';
  a.correlations = [{ myField: a.fields[0].id, refEntity: b.id, refField: b.fields[0].id, myRows: '1', refRows: 'n', innerType: 'fk' }];
  a.indexes = [{ id: 'i1', defKey: 'IDX_A', unique: true, comment: '', fields: [{ id: 'x', fieldDefKey: a.fields[0].id, ascOrDesc: 'D' }] }];
  ds.dbObjects = [{ type: 'trigger', defKey: 'TRG_1', defName: 'trg', comment: 'c', refEntity: a.id, props: { timing: 'AFTER' } }];
  ds.impactAnalyses = [{
    defName: 'drop field', createdTime: '2024-01-01',
    action: { type: 'dropField', entityDefKey: a.defKey, fieldDefKey: a.fields[0].defKey },
    items: [{ objectType: 'view', objectDefKey: 'V1', parentDefKey: '', reason: 'uses', severity: 'high', detail: 'd' }],
  }];
  return ds;
};

const sectionOf = (type, extra) => ({ id: type, type, title: '', columns: [], options: {}, ...extra });

describe('section registry', () => {
  const ds = rich();
  const required = ['text', 'toc', 'modelSummary', 'entityList', 'entityDetail', 'fieldList', 'indexList', 'viewList',
    'dictList', 'domainList', 'relationList', 'dbObjectList', 'impactAnalysisList'];
  test('declares every required type', () => {
    expect(Object.keys(sectionTypes).sort()).toEqual(required.slice().sort());
  });
  test.each(required)('%s yields blocks', (type) => {
    const doc = buildReport({ defName: 't', kind: 'document', sections: [sectionOf(type, { options: { text: 'hello' } })] }, [ds], { now: NOW });
    expect(doc.blocks.length).toBeGreaterThan(0);
  });
  test('table-bearing types produce rows from the sample project and optional arrays', () => {
    const rows = type => tables(buildReport({ defName: 't', kind: 'list', sections: [sectionOf(type)] }, [ds]))[0].rows;
    expect(rows('entityList')).toHaveLength(ds.entities.length);
    expect(rows('fieldList').length).toBe(ds.entities.reduce((s, e) => s + e.fields.length, 0));
    expect(rows('indexList')[0]).toContain('IDX_A');
    expect(rows('relationList')).toHaveLength(1);
    expect(rows('dbObjectList')[0]).toContain('trigger');
    expect(rows('impactAnalysisList')[0]).toContain('high');
    expect(rows('viewList')).toHaveLength(ds.views.length);
    expect(rows('dictList').length).toBeGreaterThan(0);
  });
  test('entityDetail makes a heading and column table per entity with resolved types', () => {
    const doc = buildReport({ defName: 't', kind: 'document', sections: [sectionOf('entityDetail', { columns: ['defKey', 'type', 'len'] })] }, [ds]);
    expect(tables(doc)).toHaveLength(ds.entities.length);
    expect(tables(doc)[0].headers).toHaveLength(3);
    const typed = tables(doc)[0].rows.map(r => r[1]);
    expect(typed.every(t => t !== '')).toBe(true);
  });
});

describe('default templates', () => {
  const templates = getDefaultReportTemplates('en');
  test('have one document and at least two list templates that validate', () => {
    expect(templates.filter(t => t.kind === 'document')).toHaveLength(1);
    expect(templates.filter(t => t.kind === 'list').length).toBeGreaterThanOrEqual(2);
    templates.forEach(t => expect(validateReportTemplate(t)).toEqual([]));
  });
  test('build on the sample project in every format', () => {
    templates.forEach((t) => {
      const doc = buildReport(t, [demo], { now: NOW, lang: 'en' });
      expect(tables(doc).length).toBeGreaterThan(0);
      ['markdown', 'html', 'docx', 'csv'].forEach(f => expect(renderReport(doc, f).data.length).toBeGreaterThan(0));
    });
  });
});

describe('multi-model', () => {
  const a = clone(demo); a.name = 'A';
  const b = clone(demo); b.name = 'B';
  test('document report nests sections under a level-1 heading per model', () => {
    const tpl = getDefaultReportTemplates().find(t => t.kind === 'document');
    const doc = buildReport(tpl, [a, b], { now: NOW });
    const h = headings(doc);
    expect(h.filter(x => x.level === 1).map(x => x.text)).toEqual(['A', 'B']);
    expect(h.filter(x => x.level === 2).length).toBeGreaterThan(2);
    expect(doc.blocks.filter(x => x.type === 'toc')).toHaveLength(1);
  });
  test('list report gets a leading model column and concatenated rows', () => {
    const tpl = getDefaultReportTemplates().find(t => t.defKey === 'defaultEntityList');
    const single = tables(buildReport(tpl, [a]))[0];
    const doc = buildReport(tpl, [a, b]);
    const t = tables(doc)[0];
    expect(t.headers[0]).toBe('模型');
    expect(t.rows).toHaveLength(single.rows.length * 2);
    expect(t.rows[0][0]).toBe('A');
    expect(t.rows[t.rows.length - 1][0]).toBe('B');
    expect(single.headers).toHaveLength(t.headers.length - 1);
  });
});

describe('renderers', () => {
  const doc = {
    title: 'T <&>', generatedTime: 'now', lang: 'en',
    blocks: [
      { type: 'toc' },
      { type: 'heading', level: 1, text: 'H<1>' },
      { type: 'paragraph', text: 'a & b' },
      { type: 'table', headers: ['k|1', 'v'], rows: [['x|y', 'l1\nl2'], ['"q",', '<b>']] },
    ],
  };
  test('markdown escapes pipes and newlines in cells', () => {
    const md = renderMarkdown(doc);
    expect(md).toContain('| x\\|y | l1<br>l2 |');
    expect(md).toContain('| k\\|1 | v |');
    expect(md).toContain('## H<1>');
  });
  test('html escapes content and links the toc to heading ids', () => {
    const html = renderHtml(doc);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('T &lt;&amp;&gt;');
    expect(html).toContain('<td>&lt;b&gt;</td>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('href="#h-1"');
    expect(html).toContain('id="h-1"');
  });
  test('csv quotes special cells', () => {
    expect(renderCsv(doc)).toBe('k|1,v\r\nx|y,"l1\nl2"\r\n"""q"",",<b>');
  });
  test('renderReport reports extension and mime and rejects unknown formats', () => {
    expect(renderReport(doc, 'markdown')).toMatchObject({ extension: 'md' });
    expect(renderReport(doc, 'docx')).toMatchObject({ extension: 'docx' });
    expect(() => renderReport(doc, 'pdf')).toThrow();
  });
});

describe('docx', () => {
  const doc = {
    title: '标题 & <T>', generatedTime: 'now', lang: 'zh',
    blocks: [
      { type: 'toc' },
      { type: 'heading', level: 1, text: '章节' },
      { type: 'paragraph', text: 'para\u0001 ok' },
      { type: 'table', headers: ['a', 'b'], rows: [['1', 'x<y'], ['2', '3']] },
      { type: 'heading', level: 2, text: '子章节' },
      { type: 'table', headers: ['c'], rows: [['z']] },
    ],
  };
  const bytes = renderDocx(doc);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new (require('util').TextDecoder)();

  const readZip = () => {
    const eocd = bytes.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    expect(view.getUint32(eocd + 12, true)).toBe(eocd - p);
    const files = {};
    for (let i = 0; i < count; i += 1) {
      expect(view.getUint32(p, true)).toBe(0x02014b50);
      const crc = view.getUint32(p + 16, true);
      const size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const local = view.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      expect(view.getUint16(local + 8, true)).toBe(0);
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      files[name] = { crc, data: bytes.subarray(start, start + size) };
      expect(view.getUint32(local + 14, true)).toBe(crc);
      p += 46 + nameLen;
    }
    return files;
  };

  test('is a valid store-only ZIP with the OOXML parts', () => {
    expect(bytes).toBeInstanceOf(Uint8Array);
    const files = readZip();
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']));
    Object.values(files).forEach(f => expect(crc32(f.data)).toBe(f.crc));
  });
  test('crc32 matches the standard check value', () => {
    expect(crc32(Uint8Array.from(Buffer.from('123456789')))).toBe(0xCBF43926);
  });
  test('document.xml carries escaped text, styles and balanced tables', () => {
    const xml = dec.decode(readZip()['word/document.xml'].data);
    expect(xml).toContain('标题 &amp; &lt;T&gt;');
    expect(xml).toContain('x&lt;y');
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain('w:val="Title"');
    expect(xml).not.toContain('\u0001');
    expect(xml.match(/<w:tbl>/g)).toHaveLength(2);
    expect(xml.match(/<\/w:tbl>/g)).toHaveLength(2);
    ['w:p', 'w:tc', 'w:r'].forEach((tag) => {
      const open = (xml.match(new RegExp(`<${tag}>|<${tag} `, 'g')) || []).length;
      const close = (xml.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      expect(open).toBe(close);
    });
    expect(xml.match(/<w:tc>/g)).toHaveLength(2 * 3 + 1 * 2);
  });
});

describe('template storage and validation', () => {
  test('legacy project without reportTemplates falls back to defaults', () => {
    const legacy = clone(demo);
    delete legacy.profile.reportTemplates;
    expect(getReportTemplates(legacy).map(t => t.id)).toEqual(getDefaultReportTemplates().map(t => t.id));
    expect(buildReport(getReportTemplates(legacy)[0], [legacy]).blocks.length).toBeGreaterThan(0);
  });
  test('add, edit, delete without mutating the input', () => {
    const tpl = getEmptyReportTemplate('document');
    const added = saveReportTemplate(demo, tpl);
    expect(demo.profile.reportTemplates).toBeUndefined();
    expect(getReportTemplates(added).some(t => t.id === tpl.id)).toBe(true);
    expect(getReportTemplates(added).length).toBe(getDefaultReportTemplates().length + 1);
    const edited = saveReportTemplate(added, { ...tpl, defName: 'Renamed' });
    expect(getReportTemplates(edited).filter(t => t.id === tpl.id)).toHaveLength(1);
    expect(getReportTemplates(edited).find(t => t.id === tpl.id).defName).toBe('Renamed');
    const removed = removeReportTemplate(edited, tpl.id);
    expect(getReportTemplates(removed).some(t => t.id === tpl.id)).toBe(false);
    expect(getReportTemplates(removeReportTemplate(demo, 'default-document')).some(t => t.id === 'default-document')).toBe(false);
  });
  test('empty templates validate for both kinds', () => {
    expect(validateReportTemplate(getEmptyReportTemplate('document'))).toEqual([]);
    expect(validateReportTemplate(getEmptyReportTemplate('list'))).toEqual([]);
  });
  test('validation reports error codes', () => {
    const base = getEmptyReportTemplate('list');
    expect(validateReportTemplate({ ...base, defName: ' ' })).toContain('name.required');
    expect(validateReportTemplate({ ...base, kind: 'x' })).toContain('kind.invalid');
    expect(validateReportTemplate({ ...base, sections: [] })).toContain('sections.empty');
    expect(validateReportTemplate({ ...base, sections: [sectionOf('nope')] })).toContain('section.type.unknown');
    expect(validateReportTemplate({ ...base, sections: [sectionOf('entityList', { columns: ['bogus'] })] })).toContain('section.column.unknown');
    expect(validateReportTemplate({ ...base, sections: [sectionOf('entityList'), sectionOf('fieldList')] })).toContain('list.needOneSection');
    expect(validateReportTemplate({ ...base, sections: [sectionOf('entityDetail')] })).toContain('list.sectionNotTable');
    expect(validateReportTemplate(null)).toEqual(['template.invalid']);
  });
  test('legacy project without dbObjects or impactAnalyses builds empty tables', () => {
    const doc = buildReport({ defName: 't', kind: 'document', sections: [sectionOf('dbObjectList'), sectionOf('impactAnalysisList')] }, [demo]);
    expect(tables(doc).map(t => t.rows.length)).toEqual([0, 0]);
  });
});

describe('report column order and running number', () => {
  const { sectionTypes, toggleColumn, moveColumn } = require('../src/lib/report');
  const ds = {
    name: 'm',
    entities: [
      { id: 'a', defKey: 'A', fields: [{ id: '1', defKey: 'x' }, { id: '2', defKey: 'y' }] },
      { id: 'b', defKey: 'B', fields: [{ id: '3', defKey: 'z' }] },
    ],
  };
  const tables = doc => doc.blocks.filter(b => b.type === 'table');

  test('columns come out in the stored order', () => {
    const doc = buildReport({ defName: 't', kind: 'list', sections: [sectionOf('entityList', { columns: ['comment', 'defKey'] })] }, [ds], { lang: 'en' });
    expect(tables(doc)[0].headers).toEqual(['Comment', 'Code']);
  });

  test('the running number restarts for every table', () => {
    const doc = buildReport({ defName: 't', kind: 'document', sections: [sectionOf('entityDetail', { columns: ['seq', 'defKey'] })] }, [ds], { lang: 'en' });
    expect(tables(doc).map(t => t.rows)).toEqual([[['1', 'x'], ['2', 'y']], [['1', 'z']]]);
    expect(tables(doc)[0].headers).toEqual(['No.', 'Code']);
  });

  test('a list over several models numbers the merged table continuously', () => {
    const doc = buildReport({ defName: 't', kind: 'list', sections: [sectionOf('entityList', { columns: ['seq', 'defKey'] })] }, [ds, ds], { lang: 'en' });
    expect(tables(doc)[0].rows.map(r => r[1])).toEqual(['1', '2', '3', '4']);
  });

  test('existing templates do not gain the number column', () => {
    const doc = buildReport({ defName: 't', kind: 'list', sections: [sectionOf('entityList')] }, [ds], { lang: 'en' });
    expect(tables(doc)[0].headers).not.toContain('No.');
  });

  test('checking appends, the number goes first, moving reorders', () => {
    const def = sectionTypes.entityList;
    const section = { columns: ['defKey', 'defName'] };
    expect(toggleColumn(def, section, 'comment', true)).toEqual(['defKey', 'defName', 'comment']);
    expect(toggleColumn(def, section, 'seq', true)).toEqual(['seq', 'defKey', 'defName']);
    expect(toggleColumn(def, section, 'defKey', false)).toEqual(['defName']);
    expect(moveColumn(def, section, 'defName', 0)).toEqual(['defName', 'defKey']);
    expect(moveColumn(def, { columns: [] }, 'comment', 0)).toEqual(['comment', 'defKey', 'defName']);
  });
});

describe('report column widths', () => {
  const { columnPercents, setColumnWidth, renderHtml: html } = require('../src/lib/report');
  const { buildDocumentXml } = require('../src/lib/report/docx');
  const ds = { name: 'm', entities: [{ id: 'a', defKey: 'A', defName: 'n', fields: [{ id: '1', defKey: 'x' }] }] };
  const template = widths => ({
    defName: 't', kind: 'list', sections: [sectionOf('entityList', { columns: ['seq', 'defKey', 'defName'], widths })],
  });

  test('unset columns share what the set ones leave', () => {
    expect(columnPercents([10, null, null], 3)).toEqual([10, 45, 45]);
    expect(columnPercents([null, null], 2)).toBeNull();
    expect(columnPercents(undefined, 2)).toBeNull();
  });

  test('widths that overflow are scaled to fit the table', () => {
    expect(columnPercents([80, 80], 2)).toEqual([50, 50]);
    expect(columnPercents([20, 20], 2)).toEqual([50, 50]);
    const squeezed = columnPercents([100, null], 2);
    expect(squeezed[0] + squeezed[1]).toBeCloseTo(100);
    expect(squeezed[1]).toBeGreaterThanOrEqual(3);
  });

  test('a width is kept only when it is a whole percent from 1 to 100', () => {
    expect(setColumnWidth({ widths: { a: 5 } }, 'b', '30')).toEqual({ a: 5, b: 30 });
    expect(setColumnWidth({ widths: { a: 5 } }, 'a', '')).toEqual({});
    expect(setColumnWidth({}, 'a', '250')).toEqual({});
  });

  test('html and docx lay the table out by the template widths, in column order', () => {
    const doc = buildReport(template({ seq: 10, defName: 60 }), [ds], { lang: 'en' });
    expect(doc.blocks[0].widths).toEqual([10, null, 60]);
    expect(html(doc)).toContain('<col style="width:10%"><col style="width:30%"><col style="width:60%">');
    const xml = buildDocumentXml(doc);
    expect(xml).toContain('<w:gridCol w:w="900"/><w:gridCol w:w="2700"/><w:gridCol w:w="5400"/>');
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>');
  });

  test('a template without widths renders as before', () => {
    const doc = buildReport(template(undefined), [ds], { lang: 'en' });
    expect(html(doc)).not.toContain('<colgroup>');
    expect(buildDocumentXml(doc)).toContain('<w:gridCol w:w="3000"/>');
    expect(buildDocumentXml(doc)).not.toContain('tblLayout');
  });

  test('the model column added for several models stays automatic', () => {
    const doc = buildReport(template({ seq: 10 }), [ds, ds], { lang: 'en' });
    expect(doc.blocks[0].widths).toEqual([null, 10, null, null]);
  });
});

describe('report column widths from the preview', () => {
  const {
    dragColumn, widthsOf, applyWidths, clearWidths, hasWidths, columnPercents,
  } = require('../src/lib/report');
  const tpl = () => getDefaultReportTemplates('zh')[0];
  test('table blocks name their section and columns', () => {
    const doc = buildReport(tpl(), [demo], { lang: 'zh' });
    const tables = doc.blocks.filter(b => b.type === 'table');
    const detail = tables.filter(t => t.sectionId === 'default-document-entityDetail');
    expect(detail.length).toBeGreaterThan(1);
    detail.forEach(t => expect(t.keys.length).toBe(t.headers.length));
    // The summary is a fixed two column table and cannot be resized.
    expect(tables[0].sectionId).toBeUndefined();
  });
  test('multi model list leaves the model column without a key', () => {
    const doc = buildReport(getDefaultReportTemplates('zh')[1], [demo, demo], { lang: 'zh' });
    expect(doc.blocks[0].keys[0]).toBeNull();
    expect(doc.blocks[0].keys.length).toBe(doc.blocks[0].headers.length);
  });
  test('dragging a border moves width between two neighbours', () => {
    expect(dragColumn([25, 25, 50], 0, 10)).toEqual([35, 15, 50]);
    expect(dragColumn([25, 25, 50], 0, 40)).toEqual([47, 3, 50]);
    expect(dragColumn([25, 25, 50], 1, -40)).toEqual([25, 3, 72]);
    expect(dragColumn([25, 25, 50], 2, 10)).toEqual([25, 25, 50]);
    // A column already below the minimum is not forced wider.
    expect(dragColumn([2, 48, 50], 0, -5)).toEqual([2, 48, 50]);
  });
  test('stored widths are whole and add up to 100', () => {
    const widths = widthsOf(['a', 'b', 'c'], [33.333, 33.333, 33.334]);
    expect(Object.values(widths).reduce((s, n) => s + n, 0)).toBe(100);
    expect(Object.values(widths).every(Number.isInteger)).toBe(true);
    expect(widthsOf([null, 'a', 'b'], [20, 30, 50])).toEqual({ a: 30, b: 50 });
  });
  test('the dragged layout comes back from the template', () => {
    const next = applyWidths(tpl(), 'default-document-entityDetail',
      widthsOf(['defKey', 'defName', 'type', 'len', 'scale', 'primaryKey', 'notNull', 'comment'],
        [30, 20, 10, 5, 5, 5, 5, 20]));
    expect(hasWidths(next)).toBe(true);
    const table = buildReport(next, [demo], { lang: 'zh' }).blocks
      .find(b => b.sectionId === 'default-document-entityDetail');
    expect(columnPercents(table.widths, table.headers.length)).toEqual([30, 20, 10, 5, 5, 5, 5, 20]);
    expect(hasWidths(clearWidths(next))).toBe(false);
  });
});

describe('report column alignment', () => {
  const { setColumnAlign, alignOf, nextAlign, renderHtml: html, renderMarkdown: md } = require('../src/lib/report');
  const { buildDocumentXml } = require('../src/lib/report/docx');
  const ds = { name: 'm', entities: [{ id: 'a', defKey: 'A', defName: 'n', fields: [{ id: '1', defKey: 'x', primaryKey: true, len: 9 }] }] };
  const template = aligns => ({
    defName: 't', kind: 'list',
    sections: [sectionOf('fieldList', { columns: ['seq', 'defKey', 'len', 'primaryKey'], aligns })],
  });
  test('text is left, numbers right, flags and the running number centred', () => {
    expect(buildReport(template(), [ds], { lang: 'en' }).blocks[0].aligns)
      .toEqual(['center', 'left', 'right', 'center']);
  });
  test('a column can be set, and a default choice is not stored', () => {
    expect(setColumnAlign({}, 'defKey', 'right')).toEqual({ defKey: 'right' });
    expect(setColumnAlign({ aligns: { defKey: 'right' } }, 'defKey', 'left')).toEqual({});
    expect(setColumnAlign({}, 'defKey', 'justify')).toEqual({});
    expect(alignOf({ aligns: { len: 'left' } }, 'len')).toBe('left');
    expect(['left', 'center', 'right'].map(nextAlign)).toEqual(['center', 'right', 'left']);
    expect(buildReport(template({ defKey: 'right' }), [ds], { lang: 'en' }).blocks[0].aligns[1]).toBe('right');
  });
  test('every format follows it, with centred headers', () => {
    const doc = buildReport(template(), [ds], { lang: 'en' });
    expect(html(doc)).toContain('<tr><td class="center">1</td><td>x</td><td class="right">9</td><td class="center">Y</td></tr>');
    expect(html(doc)).toContain('th{background:#f0f2f5;text-align:center}');
    expect(md(doc)).toContain('| :---: | --- | ---: | :---: |');
    const xml = buildDocumentXml(doc);
    expect(xml.match(/<w:jc w:val="center"\/>/g).length).toBe(6);
    expect(xml.match(/<w:jc w:val="right"\/>/g).length).toBe(1);
  });
  test('the model column of a multi model list is left', () => {
    expect(buildReport(template(), [ds, ds], { lang: 'en' }).blocks[0].aligns[0]).toBe('left');
  });
});

describe('report column names', () => {
  const { setColumnLabel, columnLabel, originalLabel, labelOf } = require('../src/lib/report');
  const ds = { name: 'm', entities: [{ id: 'a', defKey: 'A', defName: 'n', fields: [{ id: '1', defKey: 'x' }] }] };
  const template = (type, labels) => ({
    defName: 't', kind: 'document', sections: [sectionOf(type, { columns: ['defKey', 'defName'], labels })],
  });
  const tableOf = doc => doc.blocks.find(b => b.type === 'table');
  test('a renamed column shows its own header and remembers the original', () => {
    const table = tableOf(buildReport(template('entityDetail', { defKey: 'Column code' }), [ds], { lang: 'en' }));
    expect(table.headers[0]).toBe('Column code');
    expect(table.renamed[0]).toBe(labelOf('defKey', 'en'));
    expect(table.renamed[1]).toBe('');
    expect(table.headers[1]).toBe(labelOf('defName', 'en'));
  });
  test('flat lists and several models follow it too', () => {
    const list = { ...template('entityList', { defName: 'Title' }), kind: 'list' };
    const table = tableOf(buildReport(list, [ds, ds], { lang: 'en' }));
    expect(table.headers).toEqual([labelOf('model', 'en'), labelOf('defKey', 'en'), 'Title']);
    expect(table.renamed).toEqual(['', '', labelOf('defName', 'en')]);
  });
  test('clearing the text or typing the original restores it', () => {
    expect(setColumnLabel({}, 'defKey', '  Key code  ', 'en')).toEqual({ defKey: 'Key code' });
    expect(setColumnLabel({ labels: { defKey: 'Code' } }, 'defKey', ' ', 'en')).toEqual({});
    expect(setColumnLabel({ labels: { defKey: 'Code' } }, 'defKey', labelOf('defKey', 'en'), 'en')).toEqual({});
    expect(columnLabel({ labels: { defKey: '' } }, 'defKey', 'en')).toBe(labelOf('defKey', 'en'));
    expect(originalLabel({}, 'defKey', 'en')).toBe('');
  });
});

describe('report column style', () => {
  const { setColumnStyle, styleOf, cssOf, renderHtml: html } = require('../src/lib/report');
  const { buildDocumentXml } = require('../src/lib/report/docx');
  const ds = { name: 'm', entities: [{ id: 'a', defKey: 'A', defName: 'n', fields: [{ id: '1', defKey: 'x' }] }] };
  const template = styles => ({
    defName: 't', kind: 'list', sections: [sectionOf('entityList', { columns: ['defKey', 'defName'], styles })],
  });
  const look = { size: 12, bold: true, italic: true, underline: true, color: '#FF0000', fill: '#ffffcc' };
  test('only valid, set values are kept', () => {
    expect(setColumnStyle({}, 'defKey', look)).toEqual({ defKey: { ...look, color: '#ff0000' } });
    expect(setColumnStyle({ styles: { defKey: { bold: true } } }, 'defKey', { bold: false })).toEqual({});
    expect(setColumnStyle({}, 'defKey', { size: 13, color: 'red', fill: '#12' })).toEqual({});
    expect(styleOf({ styles: { defKey: { bold: true, size: '' } } }, 'defKey')).toEqual({ bold: true });
    expect(cssOf({ size: 12, fill: '#ffffcc' })).toEqual({ fontSize: '12pt', backgroundColor: '#ffffcc' });
  });
  test('html and docx style the cells of that column and nothing else', () => {
    const doc = buildReport(template({ defKey: look }), [ds], { lang: 'en' });
    expect(doc.blocks[0].styles[1]).toBeNull();
    expect(html(doc)).toContain('<td style="font-size:12pt;font-weight:bold;font-style:italic;text-decoration:underline;color:#ff0000;background-color:#ffffcc">A</td><td>n</td>');
    const xml = buildDocumentXml(doc);
    expect(xml).toContain('<w:rPr><w:b/><w:i/><w:color w:val="FF0000"/><w:sz w:val="24"/><w:u w:val="single"/></w:rPr>');
    expect(xml.match(/w:fill="FFFFCC"/g).length).toBe(1);
  });
  test('a template without styles renders as before', () => {
    const doc = buildReport(template(), [ds], { lang: 'en' });
    expect(html(doc)).toContain('<tr><td>A</td><td>n</td></tr>');
    expect(buildDocumentXml(doc)).not.toContain('<w:sz ');
  });
});

describe('report header style', () => {
  const {
    setColumnStyle, setColumnAlign, lookOf, alignOf, labelOf, renderHtml: html,
  } = require('../src/lib/report');
  const { buildDocumentXml } = require('../src/lib/report/docx');
  const ds = { name: 'm', entities: [{ id: 'a', defKey: 'A', defName: 'n', fields: [{ id: '1', defKey: 'x' }] }] };
  const template = extra => ({
    defName: 't', kind: 'list', sections: [sectionOf('entityList', { columns: ['defKey', 'defName'], ...extra })],
  });
  test('a header starts bold and centred, only a change is stored', () => {
    expect(lookOf({}, 'defKey', 'head')).toEqual({ bold: true });
    expect(alignOf({}, 'defKey', 'head')).toBe('center');
    expect(setColumnStyle({}, 'defKey', { bold: true }, 'head')).toEqual({});
    expect(setColumnStyle({}, 'defKey', { bold: false, fill: '#DDEEFF' }, 'head')).toEqual({ defKey: { bold: false, fill: '#ddeeff' } });
    expect(setColumnAlign({}, 'defKey', 'center', 'head')).toEqual({});
    expect(setColumnAlign({}, 'defKey', 'left', 'head')).toEqual({ defKey: 'left' });
  });
  test('header and cells are styled apart', () => {
    const doc = buildReport(template({
      headStyles: { defKey: { bold: false, color: '#ffffff', fill: '#336699' } },
      headAligns: { defKey: 'left' },
      styles: { defKey: { italic: true } },
    }), [ds], { lang: 'en' });
    const out = html(doc);
    expect(out).toContain('<th style="text-align:left;font-weight:normal;color:#ffffff;background-color:#336699">');
    expect(out).toContain(`<th>${labelOf('defName', 'en')}</th>`);
    expect(out).toContain('<td style="font-style:italic">A</td>');
    const xml = buildDocumentXml(doc);
    expect(xml).toContain('w:fill="336699"/></w:tcPr><w:p><w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr>');
    expect(xml.match(/w:fill="E7EAF0"/g).length).toBe(1);
    expect(xml.match(/<w:jc w:val="center"\/>/g).length).toBe(1);
  });
  test('an untouched header renders as before', () => {
    const doc = buildReport(template(), [ds], { lang: 'en' });
    expect(html(doc)).toContain(`<th>${labelOf('defKey', 'en')}</th>`);
    expect(buildDocumentXml(doc)).toContain('w:fill="E7EAF0"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr>');
  });
});

describe('report designer helpers', () => {
  const {
    emptyHistory, record, undo, redo, spreadStyle, sameTemplate,
  } = require('../src/lib/report');
  test('undo and redo step through the changes', () => {
    let h = record(emptyHistory(), 'a', 'widths', 0);
    h = record(h, 'b', 'labels', 5000);
    const back = undo(h, 'c');
    expect(back.state).toBe('b');
    expect(undo(back.history, 'b').state).toBe('a');
    expect(redo(back.history, 'b').state).toBe('c');
    expect(undo(emptyHistory(), 'x')).toBeNull();
    expect(redo(h, 'c')).toBeNull();
  });
  test('a burst of one kind of change is a single step, a new change drops the redo steps', () => {
    let h = record(emptyHistory(), 'a', 'widths', 0);
    h = record(h, 'a1', 'widths', 300);
    h = record(h, 'a2', 'widths', 600);
    expect(h.past).toEqual(['a']);
    h = record(h, 'a3', 'widths', 5000);
    expect(h.past).toEqual(['a', 'a3']);
    const back = undo(h, 'now');
    expect(record(back.history, 'a3', 'aligns', 9000).future).toEqual([]);
  });
  test('font and colours spread to every column, alignment does not', () => {
    const section = { styles: { a: { bold: true, fill: '#ffffcc' }, b: { italic: true } }, aligns: { a: 'right' } };
    expect(spreadStyle(section, ['a', 'b', 'c'], 'a')).toEqual({
      a: { bold: true, fill: '#ffffcc' }, b: { bold: true, fill: '#ffffcc' }, c: { bold: true, fill: '#ffffcc' },
    });
    expect(spreadStyle(section, ['a', 'b'], 'c')).toEqual({});
    expect(spreadStyle({ headStyles: { a: { bold: false } } }, ['a', 'b'], 'a', 'head')).toEqual({ a: { bold: false }, b: { bold: false } });
  });
  test('templates compare by what they say', () => {
    const a = { id: '1', defName: 't', sections: [{ id: 's', columns: [], widths: {}, options: {} }] };
    const b = { sections: [{ options: {}, id: 's', columns: [], title: '' }], defName: 't', id: '1' };
    expect(sameTemplate(a, b)).toBe(true);
    expect(sameTemplate(a, { ...b, defName: 'u' })).toBe(false);
    expect(sameTemplate(a, { ...b, sections: [{ ...b.sections[0], widths: { x: 10 } }] })).toBe(false);
  });
});
