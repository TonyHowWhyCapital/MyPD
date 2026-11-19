// 将“模型相对数据库”的变更（simplePackageChanges 的结果）展开为逐项的 调整前（数据库）/调整后（模型）清单。

export const KIND_ORDER = ['tableAdd', 'tableExtra', 'tableBase', 'fieldAdd', 'fieldRemove', 'fieldModify'];

export const KIND_LANG_KEY = {
  tableAdd: 'components.compare.diffKind_tableAdd',
  tableExtra: 'components.compare.diffKind_tableExtra',
  tableBase: 'components.compare.diffKind_tableBase',
  fieldAdd: 'components.compare.diffKind_fieldAdd',
  fieldRemove: 'components.compare.diffKind_fieldRemove',
  fieldModify: 'components.compare.diffKind_fieldModify',
};

export const ATTR_LANG_KEY = {
  defKey: 'components.compare.code',
  defName: 'components.compare.name',
  comment: 'components.compare.comment',
  type: 'components.compare.type',
  fieldCount: 'components.compare.fieldCount',
};

const FIELD_TEXT_ATTRS = ['defName', 'comment'];
const TYPE_ATTRS = ['type', 'len', 'scale'];
const TABLE_ATTRS = ['defKey', 'defName', 'comment'];

const isEmpty = (v) => v === undefined || v === null || v === '';
const text = (v) => (isEmpty(v) ? '' : String(v));

export const typeText = (f) => {
  const type = text(f?.type);
  const len = text(f?.len);
  const scale = text(f?.scale);
  if (!len && !scale) {
    return type;
  }
  return `${type}(${len}${scale ? `,${scale}` : ''})`;
};

const tableLabel = (t) => {
  const key = text(t?.originDefKey || t?.defKey);
  const name = text(t?.defName);
  return name ? `${key}[${name}]` : key;
};

const fieldLabel = (f) => text(f?.defName) ? `${typeText(f)} [${f.defName}]` : typeText(f);

const row = (table, kind, target, attr, before, after) => ({table, kind, target, attr, before, after});

const updateRows = (data) => {
  const table = tableLabel(data.baseInfo);
  const rows = [];
  const base = data.baseChanged;
  if (base) {
    TABLE_ATTRS.filter(a => (base.changeNames || []).includes(a)).forEach((a) => {
      rows.push(row(table, 'tableBase', '', a, text(base.before?.[a]), text(base.after?.[a])));
    });
  }
  (data.fieldAdded || []).forEach((f) => {
    rows.push(row(table, 'fieldAdd', text(f.defKey), 'type', '', fieldLabel(f)));
  });
  (data.fieldRemoved || []).forEach((f) => {
    rows.push(row(table, 'fieldRemove', text(f.defKey), 'type', fieldLabel(f), ''));
  });
  (data.fieldModified || []).forEach((f) => {
    const changed = f.changeNames || [];
    const target = text(f.defKey);
    if (TYPE_ATTRS.some(a => changed.includes(a))) {
      const before = typeText(f.before);
      const after = typeText(f.after);
      if (before !== after) {
        rows.push(row(table, 'fieldModify', target, 'type', before, after));
      }
    }
    FIELD_TEXT_ATTRS.filter(a => changed.includes(a)).forEach((a) => {
      rows.push(row(table, 'fieldModify', target, a, text(f.before?.[a]), text(f.after?.[a])));
    });
  });
  return rows;
};

export const diffRows = (changes = []) => {
  const rows = changes.reduce((p, c) => {
    if (c.opt === 'add') {
      const label = tableLabel(c.data);
      return p.concat(row(label, 'tableAdd', '', 'fieldCount', '', `${label} (${(c.data.fields || []).length})`));
    } else if (c.opt === 'delete') {
      return p.concat(row(tableLabel(c.data), 'tableExtra', '', 'defKey', tableLabel(c.data), ''));
    } else if (c.opt === 'update') {
      return p.concat(updateRows(c.data));
    }
    return p;
  }, []);
  // Array.prototype.sort is stable in Electron 13 (V8 9), so field order inside a table is kept
  return rows.sort((a, b) => {
    if (a.table !== b.table) {
      return a.table.toLowerCase() < b.table.toLowerCase() ? -1 : 1;
    }
    return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  });
};
