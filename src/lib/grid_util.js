// View-only helpers shared by every grid: multi-column sort, column order and
// column visibility. None of them touch the model; preferences live in
// localStorage per grid.

// Header click cycle for one column: unsorted -> ascending -> descending -> unsorted.
// Columns keep the order they were added in, which is their sort priority.
export const toggleSort = (sorts, key) => {
  const current = sorts.find(s => s.key === key);
  if (!current) {
    return sorts.concat({ key, dir: 'asc' });
  }
  return current.dir === 'asc'
    ? sorts.map(s => (s.key === key ? { key, dir: 'desc' } : s))
    : sorts.filter(s => s.key !== key);
};

const isBlank = v => v === '' || v === undefined || v === null;
const compareValues = (a, b) => {
  if (isBlank(a) || isBlank(b)) {
    // Blank values stay together at the top when ascending.
    return (isBlank(a) ? 0 : 1) - (isBlank(b) ? 0 : 1);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return (a ? 1 : 0) - (b ? 1 : 0);
  }
  return `${a}`.localeCompare(`${b}`, undefined, { numeric: true, sensitivity: 'base' });
};

// Stable multi-column sort. `getters` maps a sort key to the value shown in that column.
export const sortRows = (rows, sorts, getters = {}) => {
  if (sorts.length === 0) {
    return rows;
  }
  const valueOf = (row, key) => (getters[key] ? getters[key](row) : row[key]);
  return rows.map((row, index) => ({ row, index })).sort((x, y) => {
    for (let i = 0; i < sorts.length; i += 1) {
      const { key, dir } = sorts[i];
      const result = compareValues(valueOf(x.row, key), valueOf(y.row, key));
      if (result !== 0) {
        return dir === 'desc' ? -result : result;
      }
    }
    return x.index - y.index;
  }).map(item => item.row);
};

// Applies a saved column order. Keys the saved order does not know yet (added
// in a later version) keep their place at the end.
export const orderColumns = (keys, saved = []) => {
  const known = saved.filter(k => keys.includes(k));
  return known.concat(keys.filter(k => !known.includes(k)));
};

// Moves column `from` to where `to` is: dragging rightwards drops it after the
// target, dragging leftwards before it.
export const moveColumn = (keys, from, to) => {
  const fromIndex = keys.indexOf(from);
  const toIndex = keys.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || from === to) {
    return keys;
  }
  const next = keys.filter(k => k !== from);
  next.splice(toIndex, 0, from);
  return next;
};

const STORE_PREFIX = 'mypd.grid.';

export const loadGridView = (gridId, defaultHidden = []) => {
  try {
    const saved = JSON.parse(localStorage.getItem(`${STORE_PREFIX}${gridId}`)) || {};
    return {
      hidden: Array.isArray(saved.hidden) ? saved.hidden : defaultHidden,
      order: Array.isArray(saved.order) ? saved.order : [],
    };
  } catch (e) {
    return { hidden: defaultHidden, order: [] };
  }
};

export const saveGridView = (gridId, view) => {
  try {
    localStorage.setItem(`${STORE_PREFIX}${gridId}`, JSON.stringify(view));
  } catch (e) {
    // Preferences are a convenience; a full or unavailable store is not an error.
  }
};

const WIDTH_PREFIX = 'mypd.gridWidths.';
export const MIN_COLUMN_WIDTH = 40;
export const MAX_FIT_WIDTH = 600;

// Column widths in px by column key; empty when the grid still uses its defaults.
export const loadGridWidths = (gridId) => {
  try {
    const saved = JSON.parse(localStorage.getItem(`${WIDTH_PREFIX}${gridId}`)) || {};
    return Object.keys(saved).reduce((all, k) => (
      typeof saved[k] === 'number' && saved[k] > 0 ? { ...all, [k]: saved[k] } : all), {});
  } catch (e) {
    return {};
  }
};

export const saveGridWidths = (gridId, widths) => {
  try {
    if (Object.keys(widths).length === 0) {
      localStorage.removeItem(`${WIDTH_PREFIX}${gridId}`);
    } else {
      localStorage.setItem(`${WIDTH_PREFIX}${gridId}`, JSON.stringify(widths));
    }
  } catch (e) {
    // Preferences are a convenience; a full or unavailable store is not an error.
  }
};

export const clampWidth = (width, max = Infinity) => {
  return Math.round(Math.min(max, Math.max(MIN_COLUMN_WIDTH, width)));
};

// Width that shows the longest of the texts; `measure` gives the px width of one text.
export const fitWidth = (texts, measure, padding = 24) => {
  const longest = (texts || []).reduce((max, t) => Math.max(max, measure(`${t || ''}`)), 0);
  return clampWidth(longest + padding, MAX_FIT_WIDTH);
};
