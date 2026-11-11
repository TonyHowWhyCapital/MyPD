// A database keeps one remark per table or column, the model keeps a display name and a
// comment. This file is the single rule for going both ways. No dom or react imports,
// utils.js runs it inside the worker.
export const DEFAULT_SEPARATOR = ';';

export const remarkSetting = (dataSource) => {
  const sql = (dataSource && dataSource.profile && dataSource.profile.sql) || {};
  return {
    split: sql.remarkSplit !== false,
    separator: sql.remarkSeparator || DEFAULT_SEPARATOR,
  };
};

// Only the first separator splits, so the comment may contain it.
export const splitRemark = (remark, setting) => {
  const text = remark || '';
  const { split, separator } = setting || remarkSetting();
  const at = split ? text.indexOf(separator) : -1;
  if (at < 0) {
    return { defName: text, comment: '' };
  }
  return { defName: text.slice(0, at).trim(), comment: text.slice(at + separator.length).trim() };
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
  return blank(defName) ? comment : `${defName}${separator}${comment}`;
};
