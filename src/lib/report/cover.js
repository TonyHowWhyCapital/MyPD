// Where each part of the cover sits on the page and how large it is. `x` is the centre and
// `y` the top of the part, both in percent of the page, so a landscape page keeps the
// arrangement. A text is centred on `x` and may run as far as the nearer page edge allows.
export const COVER_TEXTS = ['title', 'subtitle', 'organization', 'author', 'version', 'date'];
export const COVER_ITEMS = ['logo', ...COVER_TEXTS];
// Points for a text, percent of the page width for the logo.
export const COVER_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64];
export const LOGO_SIZES = [10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80];

const DEFAULTS = {
  logo: { x: 50, y: 12, size: 30 },
  title: { x: 50, y: 36, size: 32, bold: true },
  subtitle: { x: 50, y: 46, size: 18, color: '#555555' },
  organization: { x: 50, y: 66, size: 13 },
  author: { x: 50, y: 70, size: 13 },
  version: { x: 50, y: 74, size: 13 },
  date: { x: 50, y: 78, size: 13 },
};
const HEX = /^#[0-9a-f]{6}$/i;
const LIMITS = { x: [2, 98], y: [0, 97] };

const clamp = (v, [low, high]) => Math.min(Math.max(Math.round(v * 10) / 10, low), high);
const numberOr = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const cleanItem = (key, stored) => {
  const base = DEFAULTS[key];
  const s = stored || {};
  const sizes = key === 'logo' ? LOGO_SIZES : COVER_SIZES;
  const item = {
    x: clamp(numberOr(s.x, base.x), LIMITS.x),
    y: clamp(numberOr(s.y, base.y), LIMITS.y),
    size: sizes.includes(s.size) ? s.size : base.size,
    hidden: s.hidden === true,
  };
  if (key === 'logo') return item;
  return {
    ...item,
    bold: typeof s.bold === 'boolean' ? s.bold : !!base.bold,
    color: HEX.test(s.color || '') ? s.color.toLowerCase() : (base.color || ''),
  };
};

// Every part with all of its settings, whatever the template stores.
export const coverItemsOf = stored => COVER_ITEMS.reduce((out, key) => ({
  ...out, [key]: cleanItem(key, (stored || {})[key]),
}), {});

// What the template keeps: only the settings that differ from the default arrangement.
export const storeCoverItems = (items) => {
  const out = {};
  COVER_ITEMS.forEach((key) => {
    const item = cleanItem(key, (items || {})[key]);
    const base = cleanItem(key);
    const diff = Object.keys(item).reduce((d, k) => (item[k] === base[k] ? d : { ...d, [k]: item[k] }), {});
    if (Object.keys(diff).length) out[key] = diff;
  });
  return Object.keys(out).length ? out : undefined;
};

export const setCoverItem = (items, key, change) => ({
  ...coverItemsOf(items), [key]: cleanItem(key, { ...coverItemsOf(items)[key], ...change }),
});

export const resetCoverPlaces = items => COVER_ITEMS.reduce((out, key) => {
  const item = coverItemsOf(items)[key];
  return { ...out, [key]: { ...item, x: DEFAULTS[key].x, y: DEFAULTS[key].y } };
}, {});

// The box a part takes on a page of the given size, in the units of that size.
export const textBox = (item, pageWidth, pageHeight) => {
  const half = Math.min(item.x, 100 - item.x);
  return {
    left: Math.round(((item.x - half) / 100) * pageWidth),
    width: Math.round(((half * 2) / 100) * pageWidth),
    top: Math.round((item.y / 100) * pageHeight),
  };
};

export const logoBox = (item, pageWidth, pageHeight) => {
  const width = (item.size / 100) * pageWidth;
  return {
    left: Math.round((item.x / 100) * pageWidth - width / 2),
    width: Math.round(width),
    top: Math.round((item.y / 100) * pageHeight),
  };
};
