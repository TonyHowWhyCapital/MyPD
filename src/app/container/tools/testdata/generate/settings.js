// The settings of a test data run as stored in the project (profile.testData.settings):
// default number of rows, the seed and what each table asks for. Pure, nothing mutates.
import {
  getTestData, setTestData, seedNow, stampSeedBase, MAX_ROWS, DEFAULT_ROWS,
} from '../../../../../lib/testdata/model';

export { MAX_ROWS, DEFAULT_ROWS };
export const MAX_SEED = 2147483646;
export const MAX_START = 9000000000000000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const given = v => v !== undefined && v !== null && v !== '';

// a whole number between min and max, or undefined when the value is none
export const wholeNumber = (v, min, max) => {
  if (!given(v) || typeof v === 'boolean') {
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return undefined;
  }
  return Math.min(max, Math.max(min, n));
};

// what one table stores; only what differs from the defaults is kept
export const normalizeTable = (raw) => {
  const t = isObject(raw) ? raw : {};
  const out = {};
  const rows = wholeNumber(t.rows, 1, MAX_ROWS);
  if (rows !== undefined) {
    out.rows = rows;
  }
  if (isObject(t.perParent) && typeof t.perParent.field === 'string' && t.perParent.field) {
    // a range still being typed (max below min, one end empty) is kept as it is and
    // reported by the plan, so the numbers do not jump under the user's hands
    const min = wholeNumber(t.perParent.min, 0, MAX_ROWS);
    const max = wholeNumber(t.perParent.max, 0, MAX_ROWS);
    out.perParent = {
      field: t.perParent.field,
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
    };
  }
  if (t.autoIncrement === 'database') {
    out.autoIncrement = 'database';
  }
  const startAt = wholeNumber(t.startAt, -MAX_START, MAX_START);
  if (startAt !== undefined && startAt !== 1) {
    out.startAt = startAt;
  }
  return out;
};

export const normalizeSettings = (raw) => {
  const s = isObject(raw) ? raw : {};
  const seed = isObject(s.seed) ? s.seed : {};
  const tables = isObject(s.tables) ? s.tables : {};
  const value = wholeNumber(seed.value, 0, MAX_SEED);
  const defaultRows = wholeNumber(s.defaultRows, 1, MAX_ROWS);
  return {
    ...s,
    defaultRows: defaultRows === undefined ? DEFAULT_ROWS : defaultRows,
    seed: {
      fixed: seed.fixed !== false,
      value: value === undefined ? 1 : value,
      // the day relative dates are counted from while the seed is fixed (model.js)
      ...(DAY.test(seed.baseDate) ? { baseDate: seed.baseDate } : {}),
    },
    tables: Object.keys(tables).reduce((all, id) => {
      const table = normalizeTable(tables[id]);
      return Object.keys(table).length > 0 ? { ...all, [id]: table } : all;
    }, {}),
  };
};

export const readSettings = dataSource => normalizeSettings(getTestData(dataSource).settings);

export const tableSetting = (settings, entityId) => ((settings && settings.tables) || {})[entityId]
  || {};

// patch = part of a TableSetting; a key set to undefined is removed
export const patchTable = (settings, entityId, patch) => {
  const merged = { ...tableSetting(settings, entityId), ...patch };
  Object.keys(merged).forEach((k) => {
    if (merged[k] === undefined) {
      delete merged[k];
    }
  });
  return normalizeSettings({
    ...settings,
    tables: {
      ...(settings.tables || {}),
      [entityId]: merged,
    },
  });
};

// settings of tables that are gone are dropped when the settings are written
export const pruneTables = (settings, entityIds) => ({
  ...settings,
  tables: Object.keys(settings.tables || {}).filter(id => entityIds.includes(id))
    .reduce((all, id) => ({ ...all, [id]: settings.tables[id] }), {}),
});

// the seed a run uses: the stored number, or a new one every time
export const seedOfRun = (settings, now = Date.now()) => (settings.seed.fixed
  ? settings.seed.value : (now % MAX_SEED) + 1);

// The clock relative dates ("now-365d") are counted from: the base date of a fixed seed,
// so that the same settings give the same data on any day; the real time otherwise.
export const clockOfRun = (settings, now = new Date()) => seedNow(settings, now);

// the project with the base date of a fixed seed written down, if it has none yet
export const withSeedBase = (dataSource, now = new Date()) => {
  const td = getTestData(dataSource);
  const stamped = stampSeedBase(td, now);
  return stamped === td ? dataSource : setTestData(dataSource, stamped);
};

// the first settings written also fix the day a fixed seed counts its dates from
export const writeSettings = (dataSource, settings, now = new Date()) => withSeedBase(
  setTestData(dataSource, {
    ...getTestData(dataSource),
    settings: normalizeSettings(settings),
  }), now,
);

export const dayText = (now = new Date()) => {
  const two = n => `${n}`.padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
};
