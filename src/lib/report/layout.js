import { labelOf } from './labels';
import { IMAGE_FIELDS, imageOf } from './image';

// How a report is laid out as a document: cover page, running header, page numbers,
// chapter numbers. The template keeps only what differs from the defaults of its kind.
export const PAGE_NUMBERS = ['none', 'page', 'slash', 'pageOfTotal'];
export const COVER_FIELDS = ['subtitle', 'organization', 'author', 'version'];
const FLAGS = ['cover', 'header', 'tocPages', 'numbering', 'landscape'];

const DEFAULTS = {
  document: {
    cover: true, header: true, tocPages: true, numbering: true, landscape: false, pageNumber: 'pageOfTotal',
  },
  list: {
    cover: false, header: false, tocPages: false, numbering: false, landscape: false, pageNumber: 'none',
  },
};
const defaultsOf = template => DEFAULTS[template && template.kind === 'list' ? 'list' : 'document'];

export const layoutOf = (template) => {
  const base = defaultsOf(template);
  const stored = (template && template.layout) || {};
  const out = { ...base };
  FLAGS.forEach((f) => { if (typeof stored[f] === 'boolean') out[f] = stored[f]; });
  if (PAGE_NUMBERS.includes(stored.pageNumber)) out.pageNumber = stored.pageNumber;
  COVER_FIELDS.forEach((f) => { out[f] = typeof stored[f] === 'string' ? stored[f] : ''; });
  IMAGE_FIELDS.forEach((f) => { out[f] = imageOf(stored[f]); });
  return out;
};

export const setLayout = (template, change) => {
  const base = defaultsOf(template);
  const next = { ...layoutOf(template), ...change };
  const layout = Object.keys(next).reduce((out, k) => {
    const plain = k in base ? next[k] === base[k] : !next[k];
    return plain ? out : { ...out, [k]: next[k] };
  }, {});
  const { layout: dropped, ...rest } = template;
  return Object.keys(layout).length ? { ...rest, layout } : rest;
};

// '1', '1.1', '1.2', '2' ... in front of every heading. A level that was skipped counts as 1.
export const numberHeadings = (blocks) => {
  let counters = [];
  return blocks.map((b) => {
    if (b.type !== 'heading') return b;
    const depth = Math.max(b.level, 1);
    counters = Array.from({ length: depth }, (_, i) => counters[i] || (i === depth - 1 ? 0 : 1));
    counters[depth - 1] += 1;
    return { ...b, text: `${counters.join('.')} ${b.text}` };
  });
};

export const coverOf = (layout, generatedTime, lang) => {
  if (!layout.cover) return null;
  const rows = ['organization', 'author', 'version']
    .filter(f => layout[f].trim())
    .map(f => [labelOf(`cover.${f}`, lang), layout[f].trim()]);
  return {
    subtitle: layout.subtitle.trim(),
    logo: layout.logo,
    background: layout.background,
    rows: [...rows, [labelOf('cover.date', lang), generatedTime.slice(0, 10)]],
  };
};

// The text of the page number, split where the numbers go.
export const pageNumberParts = (kind, lang) => {
  const pattern = {
    page: '{page}', slash: '{page} / {total}', pageOfTotal: labelOf('pageOfTotal', lang),
  }[kind];
  return pattern ? pattern.split(/(\{page\}|\{total\})/).filter(Boolean) : [];
};
