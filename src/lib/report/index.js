import '../Math';
import {
  sectionTypes, buildSection, resolveColumns, toggleColumn, moveColumn, SEQ,
  resolveWidths, columnPercents, setColumnWidth,
} from './sections';
import { labelOf } from './labels';
import {
  dragColumn, widthsOf, applyWidths, clearWidths, hasWidths,
} from './resize';
import {
  ALIGNS, alignOf, setColumnAlign, nextAlign, applyAligns,
} from './align';
import { renderMarkdown } from './markdown';
import { renderHtml } from './html';
import { renderDocx } from './docx';

export {
  sectionTypes, resolveColumns, toggleColumn, moveColumn, labelOf, renderMarkdown, renderHtml, renderDocx,
  resolveWidths, columnPercents, setColumnWidth,
  dragColumn, widthsOf, applyWidths, clearWidths, hasWidths,
  ALIGNS, alignOf, setColumnAlign, nextAlign, applyAligns,
};

const KINDS = ['document', 'list'];
const newId = () => Math.uuid();

const section = (type, extra = {}) => ({ id: newId(), type, title: '', columns: [], options: {}, ...extra });

export const getDefaultReportTemplates = (lang = 'zh') => {
  const l = key => labelOf(key, lang);
  const documentSections = ['toc', 'modelSummary', 'entityList', 'entityDetail', 'indexList', 'viewList', 'dictList', 'domainList']
    .map(type => section(type, { id: `default-document-${type}` }));
  return [
    { id: 'default-document', defKey: 'defaultDocument', defName: l('tpl.document'), kind: 'document', sections: documentSections },
    {
      id: 'default-entity-list', defKey: 'defaultEntityList', defName: l('tpl.entityList'), kind: 'list',
      sections: [section('entityList', { id: 'default-entity-list-s', columns: ['defKey', 'defName', 'comment', 'fieldCount'] })],
    },
    {
      id: 'default-field-list', defKey: 'defaultFieldList', defName: l('tpl.fieldList'), kind: 'list',
      sections: [section('fieldList', { id: 'default-field-list-s' })],
    },
  ];
};

export const getEmptyReportTemplate = (kind = 'document', lang = 'zh') => ({
  id: newId(),
  defKey: '',
  defName: labelOf(kind === 'list' ? 'tpl.newList' : 'tpl.newDocument', lang),
  kind,
  sections: kind === 'list' ? [section('entityList')] : [section('toc'), section('modelSummary')],
});

export const validateReportTemplate = (tpl) => {
  const errors = [];
  if (!tpl || typeof tpl !== 'object') return ['template.invalid'];
  if (!tpl.id) errors.push('id.required');
  if (!String(tpl.defName || '').trim()) errors.push('name.required');
  if (!KINDS.includes(tpl.kind)) errors.push('kind.invalid');
  const sections = Array.isArray(tpl.sections) ? tpl.sections : [];
  if (!sections.length) errors.push('sections.empty');
  sections.forEach((s) => {
    const def = sectionTypes[s.type];
    if (!def) {
      errors.push('section.type.unknown');
      return;
    }
    const known = def.columns.map(c => c.key);
    if ((s.columns || []).some(c => !known.includes(c))) errors.push('section.column.unknown');
  });
  if (tpl.kind === 'list' && sections.length) {
    if (sections.length !== 1) errors.push('list.needOneSection');
    else if (sectionTypes[sections[0].type] && !sectionTypes[sections[0].type].flat) errors.push('list.sectionNotTable');
  }
  return [...new Set(errors)];
};

const stored = ds => ds?.profile?.reportTemplates || [];

export const getReportTemplates = (dataSource, lang = 'zh') => {
  const list = stored(dataSource);
  return list.length ? list : getDefaultReportTemplates(lang);
};

const withTemplates = (ds, templates) => ({
  ...ds,
  profile: { ...(ds.profile || {}), reportTemplates: templates },
});

export const saveReportTemplate = (dataSource, tpl) => {
  const template = { ...tpl, id: tpl.id || newId() };
  const base = getReportTemplates(dataSource);
  const exists = base.some(t => t.id === template.id);
  return withTemplates(dataSource, exists ? base.map(t => (t.id === template.id ? template : t)) : [...base, template]);
};

export const removeReportTemplate = (dataSource, id) => {
  return withTemplates(dataSource, getReportTemplates(dataSource).filter(t => t.id !== id));
};

const pad = n => String(n).padStart(2, '0');
const formatTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const modelName = (ds, i, lang) => ds.name || `${labelOf('modelN', lang)} ${i + 1}`;

const buildListTable = (template, dataSources, lang) => {
  const sec = template.sections.find(s => sectionTypes[s.type]?.flat);
  if (!sec) return [];
  const multi = dataSources.length > 1;
  const tables = dataSources.map((ds, i) => {
    const table = buildSection(ds, sec, { lang, level: 1, flatOnly: true }).find(b => b.type === 'table');
    return { table, name: modelName(ds, i, lang) };
  }).filter(t => t.table);
  if (!tables.length) return [];
  const headers = tables[0].table.headers;
  // The models end up in one table, so the running number continues across them.
  const seqAt = resolveColumns(sectionTypes[sec.type], sec).indexOf(SEQ);
  const rows = tables.flatMap(({ table, name }) => table.rows.map(r => (multi ? [name, ...r] : r)))
    .map((r, n) => (seqAt < 0 ? r : r.map((v, i) => (i === seqAt + (multi ? 1 : 0) ? String(n + 1) : v))));
  const widths = tables[0].table.widths || [];
  return [{
    type: 'table',
    headers: multi ? [labelOf('model', lang), ...headers] : headers,
    rows,
    widths: multi ? [null, ...widths] : widths,
    sectionId: sec.id,
    keys: multi ? [null, ...tables[0].table.keys] : tables[0].table.keys,
    aligns: multi ? ['left', ...tables[0].table.aligns] : tables[0].table.aligns,
  }];
};

export const buildReport = (template, dataSources, options = {}) => {
  const lang = options.lang || 'zh';
  const list = dataSources.length ? dataSources : [{}];
  const multi = list.length > 1;
  const now = options.now ? new Date(options.now) : new Date();
  const title = options.title || (multi ? template.defName : `${list[0].name || ''} ${template.defName}`.trim());
  const doc = { title, generatedTime: formatTime(now), lang, blocks: [] };
  if (template.kind === 'list') {
    doc.blocks = buildListTable(template, list, lang);
    return doc;
  }
  const hasToc = template.sections.some(s => s.type === 'toc');
  if (multi && hasToc) doc.blocks.push({ type: 'toc' });
  list.forEach((ds, i) => {
    if (multi) doc.blocks.push({ type: 'heading', level: 1, text: modelName(ds, i, lang) });
    const ctx = { lang, level: multi ? 2 : 1 };
    template.sections.forEach((s) => {
      // In multi-model reports one TOC at the top covers every model.
      if (multi && s.type === 'toc') return;
      doc.blocks.push(...buildSection(ds, s, ctx));
    });
  });
  return doc;
};

const csvCell = (v) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const renderCsv = (doc) => {
  return doc.blocks.filter(b => b.type === 'table')
    .map(t => [t.headers, ...t.rows].map(r => r.map(csvCell).join(',')).join('\r\n'))
    .join('\r\n\r\n');
};

const FORMATS = {
  markdown: () => ({ extension: 'md', mime: 'text/markdown;charset=utf-8', run: renderMarkdown }),
  html: () => ({ extension: 'html', mime: 'text/html;charset=utf-8', run: renderHtml }),
  docx: () => ({ extension: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', run: renderDocx }),
  csv: () => ({ extension: 'csv', mime: 'text/csv;charset=utf-8', run: d => `﻿${renderCsv(d)}` }),
};

export const renderReport = (doc, format) => {
  if (!FORMATS[format]) throw new Error(`Unsupported report format: ${format}`);
  const { run, extension, mime } = FORMATS[format]();
  return { data: run(doc), extension, mime };
};
