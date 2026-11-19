// 比较清单里「不一致」的简要原因。左边是 simplePackageChanges 的 current（模型或检查表），
// 右边是 pre（数据库、自定义元数据或比较表）。t 是 FormatMessage.string。

import {typeText} from './compare_diff_rows';

const TYPE_ATTRS = ['type', 'len', 'scale'];
const TEXT_ATTRS = ['defKey', 'defName', 'comment'];
const ATTR_LANG = {
  defKey: 'components.compare.code',
  defName: 'components.compare.name',
  comment: 'components.compare.comment',
};

const lower = v => (v || '').toLocaleLowerCase();
const msg = (t, id, data) => t({id: `components.compare.${id}`, data});
const attrNames = (t, names) => names.filter(n => ATTR_LANG[n]).map(n => t({id: ATTR_LANG[n]})).join('、');

export const findChange = (changes, key) => (changes || [])
  .find(c => lower(c.data?.defKey || c.data?.baseInfo?.defKey) === key);

export const tableReason = (change, t) => {
  if (!change) {
    return '';
  } else if (change.opt === 'add') {
    return msg(t, 'reasonTableOnlyLeft');
  } else if (change.opt === 'delete') {
    return msg(t, 'reasonTableOnlyRight');
  }
  const data = change.data || {};
  const parts = [];
  const base = (data.baseChanged?.changeNames || []).filter(n => TEXT_ATTRS.includes(n));
  if (base.length) {
    parts.push(msg(t, 'reasonTableAttrs', {attrs: attrNames(t, base)}));
  }
  [['fieldAdded', 'reasonFieldsOnlyLeft'], ['fieldRemoved', 'reasonFieldsOnlyRight'],
    ['fieldModified', 'reasonFieldsModified']].forEach(([key, id]) => {
    const count = (data[key] || []).length;
    if (count) {
      parts.push(msg(t, id, {count}));
    }
  });
  return parts.join('；');
};

export const fieldReason = (change, fieldKey, t) => {
  if (!change || change.opt !== 'update') {
    return '';
  }
  const data = change.data || {};
  const has = key => (data[key] || []).some(f => lower(f.defKey) === fieldKey);
  if (has('fieldAdded')) {
    return msg(t, 'reasonFieldOnlyLeft');
  } else if (has('fieldRemoved')) {
    return msg(t, 'reasonFieldOnlyRight');
  }
  const field = (data.fieldModified || []).find(f => lower(f.defKey) === fieldKey);
  if (!field) {
    return '';
  }
  const changed = field.changeNames || [];
  const parts = [];
  if (TYPE_ATTRS.some(a => changed.includes(a))) {
    parts.push(msg(t, 'reasonFieldType', {left: typeText(field.after) || '—', right: typeText(field.before) || '—'}));
  }
  const text = changed.filter(a => TEXT_ATTRS.includes(a));
  if (text.length) {
    parts.push(msg(t, 'reasonAttrs', {attrs: attrNames(t, text)}));
  }
  return parts.join('；');
};
