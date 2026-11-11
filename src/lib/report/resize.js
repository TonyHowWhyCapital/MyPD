// Column widths set by dragging in the preview. Everything is a percent of the table.
export const MIN_COLUMN = 3;

// The border after column `index` moves by `delta`, taking the width from its neighbour.
export const dragColumn = (percents, index, delta) => {
  const a = percents[index];
  const b = percents[index + 1];
  if (a === undefined || b === undefined) {
    return percents;
  }
  const low = Math.min(0, MIN_COLUMN - a);
  const high = Math.max(0, b - MIN_COLUMN);
  const d = Math.max(low, Math.min(delta, high));
  return percents.map((p, i) => {
    if (i === index) return a + d;
    return i === index + 1 ? b - d : p;
  });
};

// Whole numbers that still add up to 100, the template stores nothing finer.
export const wholePercents = (percents) => {
  const total = percents.reduce((sum, p) => sum + p, 0) || 1;
  const exact = percents.map(p => Math.max((p * 100) / total, 1));
  const whole = exact.map(Math.floor);
  const order = exact.map((p, i) => [p - whole[i], i]).sort((x, y) => y[0] - x[0]);
  let left = 100 - whole.reduce((sum, p) => sum + p, 0);
  for (let n = 0; left > 0 && n < order.length; n += 1, left -= 1) {
    whole[order[n][1]] += 1;
  }
  return whole;
};

// `keys` lines up with the table's columns, a column without a key is not stored.
export const widthsOf = (keys, percents) => {
  const whole = wholePercents(percents);
  return keys.reduce((map, key, i) => (key ? { ...map, [key]: whole[i] } : map), {});
};

export const applyWidths = (template, sectionId, widths) => ({
  ...template,
  sections: template.sections.map(s => (s.id === sectionId ? { ...s, widths } : s)),
});

export const clearWidths = template => ({
  ...template,
  sections: template.sections.map(({ widths, ...rest }) => rest),
});

export const hasWidths = template => template.sections
  .some(s => Object.keys(s.widths || {}).length > 0);
