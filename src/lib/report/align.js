// How a column lines up. Its cells and its header are set apart, `part` is 'cell' or
// 'head'. A header starts out centred.
export const ALIGNS = ['left', 'center', 'right'];

// Flags and the running number sit in the middle, numbers to the right, text to the left.
const CENTER = ['seq', 'primaryKey', 'notNull', 'autoIncrement', 'unique'];
const RIGHT = ['len', 'scale', 'fieldCount', 'indexCount'];

export const defaultAlign = (key) => {
  if (CENTER.includes(key)) return 'center';
  return RIGHT.includes(key) ? 'right' : 'left';
};

export const alignStore = part => (part === 'head' ? 'headAligns' : 'aligns');
const startOf = (key, part) => (part === 'head' ? 'center' : defaultAlign(key));

export const alignOf = (section, key, part = 'cell') => {
  const stored = (section[alignStore(part)] || {})[key];
  return ALIGNS.includes(stored) ? stored : startOf(key, part);
};

export const resolveAligns = (cols, section, part = 'cell') => cols.map(c => alignOf(section, c, part));

// Only a choice that differs from the default is stored.
export const setColumnAlign = (section, key, align, part = 'cell') => {
  const { [key]: dropped, ...rest } = section[alignStore(part)] || {};
  return ALIGNS.includes(align) && align !== startOf(key, part) ? { ...rest, [key]: align } : rest;
};

export const nextAlign = align => ALIGNS[(ALIGNS.indexOf(align) + 1) % ALIGNS.length];

export const applyAligns = (template, sectionId, aligns) => ({
  ...template,
  sections: template.sections.map(s => (s.id === sectionId ? { ...s, aligns } : s)),
});
