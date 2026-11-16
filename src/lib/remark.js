// A database keeps one remark per table or column, the model keeps a display name and a
// comment. This file is the single rule for going both ways. No dom or react imports,
// utils.js runs it inside the worker.
//
// The separator setting is a set of characters: each one of them separates the name from
// the comment (",| " is a comma, a bar and a space). Remarks are joined with the first one.
export const DEFAULT_SEPARATOR = ';';

export const remarkSetting = (dataSource) => {
  const sql = (dataSource && dataSource.profile && dataSource.profile.sql) || {};
  return {
    split: sql.remarkSplit !== false,
    separator: sql.remarkSeparator || DEFAULT_SEPARATOR,
  };
};

// Only the first separator splits, so the comment may contain the others. Separators that
// follow it at once ("name, comment", "name -- comment") belong to the split.
export const splitRemark = (remark, setting) => {
  const text = (remark || '').trim();
  const { split, separator } = setting || remarkSetting();
  const separators = Array.from(separator || DEFAULT_SEPARATOR);
  const at = split ? Array.from(text).findIndex(c => separators.includes(c)) : -1;
  if (at < 0) {
    return { defName: text, comment: '' };
  }
  const chars = Array.from(text);
  let rest = at + 1;
  while (rest < chars.length && (separators.includes(chars[rest]) || /\s/.test(chars[rest]))) {
    rest += 1;
  }
  return { defName: chars.slice(0, at).join('').trim(), comment: chars.slice(rest).join('').trim() };
};

// The reverse engine returns the whole remark as defName. An explicit comment wins.
export const namedByRemark = (data, setting, comment) => {
  const parts = splitRemark(data && data.defName, setting);
  return { defName: parts.defName, comment: comment || (data && data.comment) || parts.comment };
};

const blank = v => v === undefined || v === null || /^\s*$/.test(`${v}`);

export const joinRemark = (defName, comment, separator = DEFAULT_SEPARATOR) => {
  if (blank(comment) || comment === defName) {
    return blank(defName) ? '' : defName;
  }
  // of several separators the first one is written
  return blank(defName) ? comment : `${defName}${Array.from(separator || DEFAULT_SEPARATOR)[0]}${comment}`;
};
