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
