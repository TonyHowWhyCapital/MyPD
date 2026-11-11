// How the cells of a column line up. Headers are always centred.
export const ALIGNS = ['left', 'center', 'right'];

// Flags and the running number sit in the middle, numbers to the right, text to the left.
const CENTER = ['seq', 'primaryKey', 'notNull', 'autoIncrement', 'unique'];
const RIGHT = ['len', 'scale', 'fieldCount', 'indexCount'];

export const defaultAlign = (key) => {
  if (CENTER.includes(key)) return 'center';
  return RIGHT.includes(key) ? 'right' : 'left';
};

export const alignOf = (section, key) => {
  const stored = (section.aligns || {})[key];
  return ALIGNS.includes(stored) ? stored : defaultAlign(key);
};

export const resolveAligns = (cols, section) => cols.map(c => alignOf(section, c));

// Only a choice that differs from the default is stored.
export const setColumnAlign = (section, key, align) => {
  const { [key]: dropped, ...rest } = section.aligns || {};
  return ALIGNS.includes(align) && align !== defaultAlign(key) ? { ...rest, [key]: align } : rest;
};

export const nextAlign = align => ALIGNS[(ALIGNS.indexOf(align) + 1) % ALIGNS.length];

export const applyAligns = (template, sectionId, aligns) => ({
  ...template,
  sections: template.sections.map(s => (s.id === sectionId ? { ...s, aligns } : s)),
});
