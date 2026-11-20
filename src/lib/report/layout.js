import { labelOf } from './labels';
import { IMAGE_FIELDS, imageOf } from './image';
import { COVER_TEXTS, coverItemsOf, storeCoverItems } from './cover';

// How a report is laid out as a document: cover page, running header, page numbers,
// chapter numbers. The template keeps only what differs from the defaults of its kind.
export const PAGE_NUMBERS = ['none', 'page', 'slash', 'pageOfTotal'];
export const COVER_FIELDS = ['coverTitle', 'subtitle', 'organization', 'author', 'version'];
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
  out.coverItems = coverItemsOf(stored.coverItems);
  return out;
};

export const setLayout = (template, change) => {
  const base = defaultsOf(template);
  const next = { ...layoutOf(template), ...change };
  const kept = { ...next, coverItems: storeCoverItems(next.coverItems) };
  const layout = Object.keys(kept).reduce((out, k) => {
    const plain = k in base ? kept[k] === base[k] : !kept[k];
    return plain ? out : { ...out, [k]: kept[k] };
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

// Every part of the cover with its text, '' when there is nothing to show. The title is
// the one typed for the cover, or else `fallbackTitle`, the name of the model.
export const coverPartsOf = (layout, generatedTime, lang, fallbackTitle = '') => {
  const values = {
    title: layout.coverTitle.trim() || fallbackTitle,
    subtitle: layout.subtitle.trim(),
    organization: layout.organization.trim(),
    author: layout.author.trim(),
    version: layout.version.trim(),
    date: generatedTime.slice(0, 10),
  };
  const items = layout.coverItems;
  const part = (key) => {
    const label = ['title', 'subtitle'].includes(key) ? '' : labelOf(`cover.${key}`, lang);
    const value = values[key];
    return {
      key, label, value, text: value && (label ? `${label}：${value}` : value), ...items[key],
    };
  };
  return {
    texts: COVER_TEXTS.map(part),
    logo: layout.logo ? { key: 'logo', ...layout.logo, ...items.logo } : null,
  };
};

export const coverOf = (layout, generatedTime, lang, fallbackTitle = '') => {
  if (!layout.cover) return null;
  const { texts, logo } = coverPartsOf(layout, generatedTime, lang, fallbackTitle);
  const shown = texts.filter(t => t.text && !t.hidden);
  const textOf = key => (shown.find(t => t.key === key) || {}).text || '';
  return {
    title: textOf('title'),
    subtitle: textOf('subtitle'),
    logo: logo && !logo.hidden ? logo : null,
    background: layout.background,
    texts: shown,
    // For formats without a page: the details under the title, as label and value.
    rows: shown.filter(t => t.label).map(t => [t.label, t.value]),
  };
};

// The text of the page number, split where the numbers go.
export const pageNumberParts = (kind, lang) => {
  const pattern = {
    page: '{page}', slash: '{page} / {total}', pageOfTotal: labelOf('pageOfTotal', lang),
  }[kind];
  return pattern ? pattern.split(/(\{page\}|\{total\})/).filter(Boolean) : [];
};
