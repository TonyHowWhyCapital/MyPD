// 将比较结果（simplePackageChanges 或 packageChanges 的输出）展开为逐项的 调整前/调整后 清单。
// before 一律是被比较的旧侧（数据库、上一版本、差异表），after 是新侧（模型、本版本、比对表）。

export const KIND_ORDER = [
  'tableAdd', 'tableRemove', 'tableBase',
  'viewAdd', 'viewRemove', 'viewBase',
  'fieldAdd', 'fieldRemove', 'fieldModify',
  'indexAdd', 'indexRemove', 'indexModify',
  'propAdd', 'propRemove', 'propModify',
  'refAdd', 'refRemove',
];

export const KIND_LANG_KEY = KIND_ORDER.reduce((p, k) => ({
  ...p, [k]: `components.compare.diffKind_${k}`,
}), {});

export const ATTR_LANG_KEY = {
  defKey: 'components.compare.code',
  defName: 'components.compare.name',
  comment: 'components.compare.comment',
  type: 'components.compare.type',
  fieldCount: 'components.compare.fieldCount',
  primaryKey: 'tableHeaders.primaryKey',
  notNull: 'tableHeaders.notNull',
  autoIncrement: 'tableHeaders.autoIncrement',
  defaultValue: 'tableHeaders.defaultValue',
  domain: 'tableHeaders.domain',
  refDict: 'tableHeaders.refDict',
  uiHint: 'tableHeaders.uiHint',
  hideInGraph: 'tableHeaders.hideInGraph',
  index: 'versionData.index',
  prop: 'tableHeaders.extProps',
  refEntity: 'tableHeaders.refEntity',
};

const TYPE_ATTRS = ['type', 'len', 'scale'];
const TABLE_ATTRS = ['defKey', 'defName', 'comment'];
// 字段比较中由其他属性派生、或不是使用者可见设定的属性
const HIDDEN_FIELD_ATTRS = ['id', 'dbType', 'originDefKey', 'originType', 'index',
  'beforeFieldKey', 'afterFieldKey', 'baseType', 'baseTypeData', 'domainData',
  'refDictData', 'uiHintData', 'extProps', 'notes', 'testData',
  // 外键引用以 id 保存，被引用的表删除后无法转成代码，只会显示成 id
  'refEntity', 'refEntityField'];

const isEmpty = (v) => v === undefined || v === null || v === '';
const text = (v) => {
  if (v === true) {
    return '✓';
  } else if (v === false || isEmpty(v)) {
    return '';
  } else if (typeof v === 'object') {
    return JSON.stringify(v);
  }
  return String(v);
};

export const typeText = (f) => {
  const type = text(f?.originType || f?.type);
  const len = text(f?.len);
  const scale = text(f?.scale);
  if (!len && !scale) {
    return type;
  }
  return `${type}(${len}${scale ? `,${scale}` : ''})`;
};

const nameLabel = (t) => {
  const key = text(t?.originDefKey || t?.defKey);
  const name = text(t?.defName);
  return name ? `${key}[${name}]` : key;
};

const fieldLabel = (f) => text(f?.defName) ? `${typeText(f)} [${f.defName}]` : typeText(f);

const fieldKey = f => text(f?.originDefKey || f?.defKey || f?.after?.originDefKey
  || f?.after?.defKey || f?.before?.defKey);

const indexText = (i) => {
  const fields = (i?.fields || []).map(f => `${text(f.fieldDefKey)}${f.ascOrDesc ? ` ${f.ascOrDesc}` : ''}`);
  return `${i?.unique ? 'UNIQUE ' : ''}(${fields.join(', ')})`;
};

const row = (table, kind, target, attr, before, after) => ({table, kind, target, attr, before, after});

const fieldModifyRows = (table, f) => {
  const changed = f.changeNames || [];
  const target = fieldKey(f);
  const rows = [];
  if (TYPE_ATTRS.some(a => changed.includes(a))) {
    const before = typeText(f.before);
    const after = typeText(f.after);
    if (before !== after) {
      rows.push(row(table, 'fieldModify', target, 'type', before, after));
    }
  }
  changed.filter(a => !TYPE_ATTRS.includes(a) && !HIDDEN_FIELD_ATTRS.includes(a)).forEach((a) => {
    const before = text(f.before?.[a]);
    const after = text(f.after?.[a]);
    if (before !== after) {
      rows.push(row(table, 'fieldModify', target, a, before, after));
    }
  });
  return rows;
};

const indexModifyRows = (table, i) => {
  const target = text(i.after?.defKey || i.before?.defKey);
  const rows = [];
  const before = indexText(i.before);
  const after = indexText(i.after);
  if (before !== after) {
    rows.push(row(table, 'indexModify', target, 'index', before, after));
  }
  TABLE_ATTRS.filter(a => (i.changeNames || []).includes(a)).forEach((a) => {
    rows.push(row(table, 'indexModify', target, a, text(i.before?.[a]), text(i.after?.[a])));
  });
  return rows;
};

const updateRows = (data, prefix) => {
  const table = nameLabel(data.baseInfo);
  const list = key => data[key] || [];
  const base = data.baseChanged;
  return [
    ...(base ? TABLE_ATTRS.filter(a => (base.changeNames || TABLE_ATTRS).includes(a)
      && text(base.before?.[a]) !== text(base.after?.[a]))
      .map(a => row(table, `${prefix}Base`, '', a, text(base.before?.[a]), text(base.after?.[a]))) : []),
    ...list('fieldAdded').map(f => row(table, 'fieldAdd', fieldKey(f), 'type', '', fieldLabel(f))),
    ...list('fieldRemoved').map(f => row(table, 'fieldRemove', fieldKey(f), 'type', fieldLabel(f), '')),
    ...list('fieldModified').reduce((p, f) => p.concat(fieldModifyRows(table, f)), []),
    ...list('indexAdded').map(i => row(table, 'indexAdd', text(i.defKey), 'index', '', indexText(i))),
    ...list('indexRemoved').map(i => row(table, 'indexRemove', text(i.defKey), 'index', indexText(i), '')),
    ...list('indexModified').reduce((p, i) => p.concat(indexModifyRows(table, i)), []),
    ...list('propAdded').map(p => row(table, 'propAdd', text(p.key), 'prop', '', text(p.value))),
    ...list('propRemoved').map(p => row(table, 'propRemove', text(p.key), 'prop', text(p.value), '')),
    ...list('propModified').map(p => row(table, 'propModify', text(p.after?.key),
      'prop', text(p.before?.value), text(p.after?.value))),
    ...list('refEntityAdd').map(r => row(table, 'refAdd', nameLabel(r), 'refEntity', '', nameLabel(r))),
    ...list('refEntityRemoved').map(r => row(table, 'refRemove', nameLabel(r), 'refEntity', nameLabel(r), '')),
  ];
};

export const diffRows = (changes = []) => {
  const rows = changes.reduce((p, c) => {
    const prefix = c.type === 'view' ? 'view' : 'table';
    if (c.opt === 'add') {
      const label = nameLabel(c.data);
      return p.concat(row(label, `${prefix}Add`, '', 'fieldCount', '', `${label} (${(c.data.fields || []).length})`));
    } else if (c.opt === 'delete') {
      return p.concat(row(nameLabel(c.data), `${prefix}Remove`, '', 'defKey', nameLabel(c.data), ''));
    } else if (c.opt === 'update') {
      return p.concat(updateRows(c.data, prefix));
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
