// A section may give its columns their own header text. Only a real change is stored.
import { labelOf } from './labels';

export const columnLabel = (section, key, lang) => {
  const own = ((section && section.labels) || {})[key];
  return typeof own === 'string' && own.trim() ? own.trim() : labelOf(key, lang);
};

// The built-in name when the column was renamed, otherwise ''.
export const originalLabel = (section, key, lang) => {
  const original = labelOf(key, lang);
  return columnLabel(section, key, lang) === original ? '' : original;
};

export const setColumnLabel = (section, key, text, lang) => {
  const { [key]: dropped, ...rest } = section.labels || {};
  const name = `${text === undefined || text === null ? '' : text}`.trim();
  return name && name !== labelOf(key, lang) ? { ...rest, [key]: name } : rest;
};
