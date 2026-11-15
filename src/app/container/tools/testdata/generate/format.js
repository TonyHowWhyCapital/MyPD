// Numbers, sizes and times as the window shows them. Pure: `tr` gives the units.

// 1234567 -> "1,234,567"; anything that is no number -> ''
export const count = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return '';
  }
  return `${Math.round(n)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const fileSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n < 1024) {
    return `${n} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

export const duration = (tr, ms) => {
  const total = Math.max(0, Number(ms) || 0);
  if (total < 1000) {
    return tr('time.short');
  }
  const seconds = Math.round(total / 1000);
  if (seconds < 60) {
    return tr('time.seconds', { s: seconds });
  }
  return tr('time.minutes', {
    m: Math.floor(seconds / 60),
    s: seconds % 60,
  });
};

// "VARCHAR(32)", "DECIMAL(10,2)", "INT"
export const typeText = (column) => {
  const { type, len, scale } = column;
  if (len === null || len === undefined || len === '') {
    return type || '';
  }
  return scale === null || scale === undefined || scale === ''
    ? `${type}(${len})` : `${type}(${len},${scale})`;
};

// a generated value as a cell of the preview shows it; null is told apart by the caller
export const cellText = (value) => {
  if (value === true) {
    return 'true';
  }
  if (value === false) {
    return 'false';
  }
  return `${value}`;
};

// percentage of done in total, 0..100
export const percent = (done, total) => (total > 0
  ? Math.max(0, Math.min(100, Math.floor((done / total) * 100))) : 0);
