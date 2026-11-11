// The look of a column's cells: size, weight, colours. Headers keep the report's own look.
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24];
const HEX = /^#[0-9a-f]{6}$/i;
const FLAGS = ['bold', 'italic', 'underline'];

// Keeps only what is valid and set, so an untouched column stores nothing.
export const cleanStyle = (style) => {
  const s = style || {};
  const out = {};
  if (FONT_SIZES.includes(Number(s.size))) out.size = Number(s.size);
  FLAGS.forEach((f) => { if (s[f] === true) out[f] = true; });
  ['color', 'fill'].forEach((c) => { if (HEX.test(s[c] || '')) out[c] = s[c].toLowerCase(); });
  return out;
};

export const styleOf = (section, key) => cleanStyle(((section && section.styles) || {})[key]);

export const setColumnStyle = (section, key, change) => {
  const { [key]: dropped, ...rest } = section.styles || {};
  const next = cleanStyle({ ...styleOf(section, key), ...change });
  return Object.keys(next).length ? { ...rest, [key]: next } : rest;
};

export const resolveStyles = (cols, section) => cols.map((c) => {
  const s = styleOf(section, c);
  return Object.keys(s).length ? s : null;
});

const CSS = [
  ['fontSize', 'font-size', s => s.size && `${s.size}pt`],
  ['fontWeight', 'font-weight', s => s.bold && 'bold'],
  ['fontStyle', 'font-style', s => s.italic && 'italic'],
  ['textDecoration', 'text-decoration', s => s.underline && 'underline'],
  ['color', 'color', s => s.color],
  ['backgroundColor', 'background-color', s => s.fill],
];
const pairs = style => CSS.map(([js, css, get]) => [js, css, get(style || {})]).filter(p => p[2]);

// For a React style prop, and for a style attribute.
export const cssOf = style => pairs(style).reduce((map, [js, , v]) => ({ ...map, [js]: v }), {});
export const cssText = style => pairs(style).map(([, css, v]) => `${css}:${v}`).join(';');
