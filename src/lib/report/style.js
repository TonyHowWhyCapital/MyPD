// The look of a column: size, weight, colours. Its cells and its header are styled apart,
// `part` is 'cell' or 'head'. A header starts out bold, a cell plain.
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24];
const HEX = /^#[0-9a-f]{6}$/i;
const FLAGS = ['bold', 'italic', 'underline'];

const BASE = { cell: {}, head: { bold: true } };
const STORE = { cell: 'styles', head: 'headStyles' };
const baseOf = part => BASE[part] || BASE.cell;
export const styleStore = part => STORE[part] || STORE.cell;

// Keeps only what is valid and differs from the starting look, so an untouched column
// stores nothing.
export const cleanStyle = (style, base = {}) => {
  const s = style || {};
  const out = {};
  if (FONT_SIZES.includes(Number(s.size))) out.size = Number(s.size);
  FLAGS.forEach((f) => { if (typeof s[f] === 'boolean' && s[f] !== !!base[f]) out[f] = s[f]; });
  ['color', 'fill'].forEach((c) => { if (HEX.test(s[c] || '')) out[c] = s[c].toLowerCase(); });
  return out;
};

// What the template stores for the column, and the look that results from it.
export const styleOf = (section, key, part = 'cell') => cleanStyle(
  ((section && section[styleStore(part)]) || {})[key], baseOf(part),
);
export const lookOf = (section, key, part = 'cell') => ({ ...baseOf(part), ...styleOf(section, key, part) });

export const setColumnStyle = (section, key, change, part = 'cell') => {
  const { [key]: dropped, ...rest } = section[styleStore(part)] || {};
  const next = cleanStyle({ ...lookOf(section, key, part), ...change }, baseOf(part));
  return Object.keys(next).length ? { ...rest, [key]: next } : rest;
};

// Gives every column the font and colours of `key`. Alignment is not part of it, a
// number column stays to the right.
export const spreadStyle = (section, cols, key, part = 'cell') => {
  const look = styleOf(section, key, part);
  const plain = Object.keys(look).length === 0;
  return cols.reduce((map, c) => {
    const { [c]: dropped, ...rest } = map;
    return plain ? rest : { ...rest, [c]: look };
  }, section[styleStore(part)] || {});
};

// null for a column left as it is, so the renderers keep their own default.
export const resolveStyles = (cols, section, part = 'cell') => cols.map(c => (
  Object.keys(styleOf(section, c, part)).length ? lookOf(section, c, part) : null));

const CSS = [
  ['fontSize', 'font-size', s => s.size && `${s.size}pt`],
  ['fontWeight', 'font-weight', s => (s.bold === true && 'bold') || (s.bold === false && 'normal')],
  ['fontStyle', 'font-style', s => s.italic && 'italic'],
  ['textDecoration', 'text-decoration', s => s.underline && 'underline'],
  ['color', 'color', s => s.color],
  ['backgroundColor', 'background-color', s => s.fill],
];
const pairs = style => CSS.map(([js, css, get]) => [js, css, get(style || {})]).filter(p => p[2]);

// For a React style prop, and for a style attribute.
export const cssOf = style => pairs(style).reduce((map, [js, , v]) => ({ ...map, [js]: v }), {});
export const cssText = style => pairs(style).map(([, css, v]) => `${css}:${v}`).join(';');
