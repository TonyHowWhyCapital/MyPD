import _ from 'lodash';
import { _transform } from '../utils';
import { labelOf } from './labels';

const yes = v => (v ? 'Y' : '');
const str = v => (v === undefined || v === null ? '' : String(v));
const entityName = e => str(e.defName);
const entityTitle = e => (e.defName && e.defName !== e.defKey ? `${e.defKey} (${e.defName})` : str(e.defKey));

const fieldRow = (ds, e, f) => {
  const t = _transform(f, ds) || {};
  const pick = (a, b) => (a === undefined || a === '' || a === null ? str(b) : str(a));
  return {
    entityDefKey: str(e.defKey),
    entityDefName: entityName(e),
    defKey: str(f.defKey),
    defName: str(f.defName),
    type: pick(t.type, f.type),
    len: pick(t.len, f.len),
    scale: pick(t.scale, f.scale),
    primaryKey: yes(f.primaryKey),
    notNull: yes(f.notNull),
    autoIncrement: yes(f.autoIncrement),
    defaultValue: str(f.defaultValue),
    comment: str(f.comment),
    domain: str(t.domain),
    baseType: str(t.baseType),
  };
};

const findEntity = (ds, id) => (ds.entities || []).find(e => e.id === id);
const findName = (ds, id) => {
  const e = findEntity(ds, id);
  return e ? str(e.defKey) : str(id);
};

const indexRows = (ds) => _.flatMap(ds.entities || [], e => (e.indexes || []).map(i => ({
  entityDefKey: str(e.defKey),
  indexName: str(i.defKey),
  unique: yes(i.unique),
  indexFields: (i.fields || []).map((f) => {
    const field = (e.fields || []).find(fi => fi.id === f.fieldDefKey);
    return str(field ? field.defKey : f.fieldDefKey) + (f.ascOrDesc === 'D' ? ' DESC' : '');
  }).join(', '),
  comment: str(i.comment),
})));

const relationRows = (ds) => _.flatMap(ds.entities || [], e => (e.correlations || []).map((c) => {
  const refEntity = findEntity(ds, c.refEntity);
  const field = (id, ent) => str((ent?.fields || []).find(f => f.id === id)?.defKey || id);
  return {
    entityDefKey: str(e.defKey),
    myField: field(c.myField, e),
    refEntity: refEntity ? str(refEntity.defKey) : str(c.refEntity),
    refField: field(c.refField, refEntity),
    relation: (c.myRows || c.refRows) ? `${str(c.myRows)} : ${str(c.refRows)}` : '',
    innerType: str(c.innerType),
  };
}));

const dictRows = (ds) => _.flatMap(ds.dicts || [], d => {
  const items = d.items || [];
  const base = { dictDefKey: str(d.defKey), dictDefName: str(d.defName) };
  if (!items.length) return [{ ...base, itemKey: '', itemName: '', itemIntro: '' }];
  return items.map(i => ({ ...base, itemKey: str(i.defKey), itemName: str(i.defName), itemIntro: str(i.intro) }));
});

const dbObjectRows = (ds) => (ds.dbObjects || []).map(o => ({
  objectType: str(o.type),
  defKey: str(o.defKey),
  defName: str(o.defName),
  refEntity: o.refEntity ? findName(ds, o.refEntity) : '',
  comment: str(o.comment),
  props: Object.keys(o.props || {}).map(k => `${k}=${str(o.props[k])}`).join('; '),
}));

const actionText = a => (a ? [a.type, [a.entityDefKey, a.fieldDefKey].filter(Boolean).join('.')].filter(Boolean).join(' ') : '');
const impactRows = (ds) => _.flatMap(ds.impactAnalyses || [], a => {
  const base = { analysisName: str(a.defName), createdTime: str(a.createdTime), action: actionText(a.action) };
  return (a.items || []).map(i => ({
    ...base,
    objectType: str(i.objectType),
    objectDefKey: str(i.objectDefKey),
    parentDefKey: str(i.parentDefKey),
    severity: str(i.severity),
    reason: str(i.reason),
    detail: str(i.detail),
  }));
});

const countOf = (ds) => {
  const entities = ds.entities || [];
  return {
    name: str(ds.name),
    describe: str(ds.describe),
    version: str(ds.version),
    entityCount: entities.length,
    fieldCount: _.sumBy(entities, e => (e.fields || []).length),
    indexCount: _.sumBy(entities, e => (e.indexes || []).length),
    viewCount: (ds.views || []).length,
    dictCount: (ds.dicts || []).length,
    domainCount: (ds.domains || []).length,
    relationCount: _.sumBy(entities, e => (e.correlations || []).length),
  };
};

const keys = arr => arr.map(key => ({ key }));
const FIELD_COLS = ['defKey', 'defName', 'type', 'len', 'scale', 'primaryKey', 'notNull', 'autoIncrement', 'defaultValue', 'comment', 'domain'];

// rows(ds) feeds every flat type. build() wraps them as one table behind an optional heading.
const flat = (columns, defaultColumns, rows) => ({ flat: true, columns: keys(columns), defaultColumns, rows });

const tableTypes = {
  modelSummary: {
    flat: true,
    columns: keys(['name', 'describe', 'version', 'entityCount', 'fieldCount', 'indexCount', 'viewCount', 'dictCount', 'domainCount', 'relationCount']),
    defaultColumns: ['name', 'describe', 'entityCount', 'fieldCount', 'viewCount', 'dictCount', 'domainCount'],
    summary: true,
  },
  entityList: flat(['defKey', 'defName', 'comment', 'fieldCount', 'indexCount'], ['defKey', 'defName', 'comment'],
    ds => (ds.entities || []).map(e => ({
      defKey: str(e.defKey), defName: str(e.defName), comment: str(e.comment),
      fieldCount: str((e.fields || []).length), indexCount: str((e.indexes || []).length),
    }))),
  fieldList: flat(['entityDefKey', 'entityDefName', ...FIELD_COLS], ['entityDefKey', 'defKey', 'defName', 'type', 'len', 'scale', 'primaryKey', 'notNull', 'comment'],
    ds => _.flatMap(ds.entities || [], e => (e.fields || []).map(f => fieldRow(ds, e, f)))),
  indexList: flat(['entityDefKey', 'indexName', 'unique', 'indexFields', 'comment'], ['entityDefKey', 'indexName', 'unique', 'indexFields', 'comment'], indexRows),
  viewList: flat(['defKey', 'defName', 'comment', 'fieldCount', 'refEntities'], ['defKey', 'defName', 'comment', 'refEntities'],
    ds => (ds.views || []).map(v => ({
      defKey: str(v.defKey), defName: str(v.defName), comment: str(v.comment),
      fieldCount: str((v.fields || []).length),
      refEntities: (v.refEntities || []).map(id => findName(ds, id)).join(', '),
    }))),
  dictList: flat(['dictDefKey', 'dictDefName', 'itemKey', 'itemName', 'itemIntro'], ['dictDefKey', 'dictDefName', 'itemKey', 'itemName', 'itemIntro'], dictRows),
  domainList: flat(['defKey', 'defName', 'baseType', 'len', 'scale'], ['defKey', 'defName', 'baseType', 'len', 'scale'],
    ds => (ds.domains || []).map(d => ({
      defKey: str(d.defKey), defName: str(d.defName), len: str(d.len), scale: str(d.scale),
      baseType: str((ds.dataTypeMapping?.mappings || []).find(m => m.id === d.applyFor)?.defName),
    }))),
  relationList: flat(['entityDefKey', 'myField', 'refEntity', 'refField', 'relation', 'innerType'], ['entityDefKey', 'myField', 'refEntity', 'refField', 'relation'], relationRows),
  dbObjectList: flat(['objectType', 'defKey', 'defName', 'refEntity', 'comment', 'props'], ['objectType', 'defKey', 'defName', 'refEntity', 'comment'], dbObjectRows),
  impactAnalysisList: flat(['analysisName', 'createdTime', 'action', 'objectType', 'objectDefKey', 'parentDefKey', 'severity', 'reason', 'detail'],
    ['analysisName', 'action', 'objectType', 'objectDefKey', 'parentDefKey', 'severity', 'reason'], impactRows),
};

export const resolveColumns = (def, section) => {
  const known = def.columns.map(c => c.key);
  const chosen = (section.columns || []).filter(c => known.includes(c));
  return chosen.length ? chosen : def.defaultColumns;
};

const heading = (section, ctx, fallbackKey) => {
  const text = section.title || (fallbackKey ? labelOf(fallbackKey, ctx.lang) : '');
  return text && !ctx.flatOnly ? [{ type: 'heading', level: ctx.level, text }] : [];
};

const tableBuild = (def, type) => (ds, section, ctx) => {
  const cols = resolveColumns(def, section);
  const headers = cols.map(c => labelOf(c, ctx.lang));
  const source = def.summary ? [countOf(ds)] : def.rows(ds);
  const rows = def.summary
    ? cols.map(c => [labelOf(c, ctx.lang), str(source[0][c])])
    : source.map(r => cols.map(c => str(r[c])));
  return [
    ...heading(section, ctx, `section.${type}`),
    { type: 'table', headers: def.summary ? [labelOf('item', ctx.lang), labelOf('value', ctx.lang)] : headers, rows },
  ];
};

export const sectionTypes = {
  text: {
    flat: false,
    columns: [],
    defaultColumns: [],
    build: (ds, section, ctx) => [
      ...heading(section, ctx, ''),
      ...str(section.options?.text).split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
        .map(text => ({ type: 'paragraph', text })),
    ],
  },
  toc: {
    flat: false,
    columns: [],
    defaultColumns: [],
    build: () => [{ type: 'toc' }],
  },
  entityDetail: {
    flat: false,
    columns: keys(FIELD_COLS),
    defaultColumns: ['defKey', 'defName', 'type', 'len', 'scale', 'primaryKey', 'notNull', 'comment'],
    build: (ds, section, ctx) => {
      const cols = resolveColumns(sectionTypes.entityDetail, section);
      const headers = cols.map(c => labelOf(c, ctx.lang));
      return [
        ...heading(section, ctx, 'section.entityDetail'),
        ..._.flatMap(ds.entities || [], (e) => [
          { type: 'heading', level: ctx.level + 1, text: entityTitle(e) },
          ...(e.comment ? [{ type: 'paragraph', text: str(e.comment) }] : []),
          { type: 'table', headers, rows: (e.fields || []).map(f => { const r = fieldRow(ds, e, f); return cols.map(c => r[c]); }) },
        ]),
      ];
    },
  },
};

Object.keys(tableTypes).forEach((type) => {
  sectionTypes[type] = { ...tableTypes[type], build: tableBuild(tableTypes[type], type) };
});

export const buildSection = (ds, section, ctx) => {
  const def = sectionTypes[section.type];
  return def ? def.build(ds, section, ctx) : [];
};
