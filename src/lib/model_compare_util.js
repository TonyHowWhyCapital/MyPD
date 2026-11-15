import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import {simplePackageChanges, getChanges} from './datasource_version_util';
import {_transform} from './utils';
import {getDbObjectDDL} from './dbobject_util';
import {copiedRule, pastedTestData} from './testdata/field_copy';
import './Math';

const lower = (s) => `${s === undefined || s === null ? '' : s}`.toLocaleLowerCase();
const norm = (v) => (v === undefined || v === null ? '' : v);
const entityKey = (defKey) => `entity:${lower(defKey)}`;
const dbObjectKey = (o) => `dbObject:${lower(o.type)}:${lower(o.defKey)}`;

const assertDataSource = (ds, name) => {
  if (!ds || typeof ds !== 'object' || Array.isArray(ds)
    || (ds.entities !== undefined && !Array.isArray(ds.entities))) {
    throw new Error(`Invalid data source: ${name}`);
  }
};

const toKeySet = (selectedKeys) => {
  if (selectedKeys instanceof Set) return selectedKeys;
  if (Array.isArray(selectedKeys)) return new Set(selectedKeys);
  throw new Error('Invalid selectedKeys: expected an array or Set');
};

const assertResult = (result) => {
  if (!result || !Array.isArray(result.changes) || !Array.isArray(result.items)) {
    throw new Error('Invalid compare result');
  }
};

const defaultDbId = (ds) => ds?.profile?.default?.db || ds?.profile?.dataTypeSupports?.[0]?.id;

const withDefaultDb = (ds, db) => {
  if (!db || !ds.profile || defaultDbId(ds) === db) return ds;
  return {...ds, profile: {...ds.profile, default: {...ds.profile.default, db}}};
};

// A source db id such as MySQL is paired with the target's db by defKey, as the diff engine does.
const resolveSourceDb = (source, target, db) => {
  if (db) return db;
  const targetDb = (target.profile?.dataTypeSupports || []).find(d => d.id === defaultDbId(target));
  const matched = (source.profile?.dataTypeSupports || [])
    .find(d => targetDb && lower(d.defKey) === lower(targetDb.defKey));
  return matched?.id || defaultDbId(source);
};

const fieldName = (entity, id) => (entity.fields || []).find(f => f.id === id)?.defKey || id;

// Index fields reference field ids; the DDL templates want field names.
const resolveIndex = (entity, index) => ({
  ...index,
  fields: (index.fields || []).map(f => ({...f, fieldDefKey: fieldName(entity, f.fieldDefKey)})),
});

const indexSignature = (i) => JSON.stringify([
  !!i.unique,
  norm(i.comment),
  (i.fields || []).map(f => [lower(f.fieldDefKey), f.ascOrDesc || 'A']),
]);

const diffIndexes = (sourceEntity, targetEntity) => {
  const src = (sourceEntity.indexes || []).map(i => resolveIndex(sourceEntity, i));
  const tgt = (targetEntity.indexes || []).map(i => resolveIndex(targetEntity, i));
  const diffs = [];
  src.forEach((s) => {
    const t = tgt.find(i => lower(i.defKey) === lower(s.defKey));
    if (!t) {
      diffs.push({opt: 'add', defKey: s.defKey, source: s, target: null});
    } else if (indexSignature(s) !== indexSignature(t)) {
      diffs.push({opt: 'update', defKey: s.defKey, source: s, target: t});
    }
  });
  tgt.forEach((t) => {
    if (!src.some(i => lower(i.defKey) === lower(t.defKey))) {
      diffs.push({opt: 'delete', defKey: t.defKey, source: null, target: t});
    }
  });
  return {diffs, targetIndexes: tgt, sourceIndexes: src};
};

const indexView = (i) => i && ({
  unique: !!i.unique,
  comment: norm(i.comment),
  fields: (i.fields || []).map(f => f.fieldDefKey),
});

const fieldView = (f) => f && ({
  defKey: f.defKey,
  defName: norm(f.defName),
  comment: norm(f.comment),
  type: norm(f.type),
  len: norm(f.len),
  scale: norm(f.scale),
});

const emptyUpdate = (entity, source, db) => ({
  type: 'entity',
  opt: 'update',
  data: {
    id: entity.id,
    baseInfo: {defKey: entity.defKey, defName: entity.defName, comment: entity.comment},
    baseChanged: null,
    fieldAdded: null,
    fieldRemoved: null,
    fieldModified: null,
    propAdded: null,
    propRemoved: null,
    propModified: null,
    refEntityAdd: null,
    refEntityRemoved: null,
    indexAdded: null,
    indexRemoved: null,
    indexModified: null,
    fullFields: (entity.fields || []).map(f => ({...f, ..._transform(f, source, db)})),
    newIndexes: [],
  },
});

const dbObjectsOf = (ds) => (Array.isArray(ds.dbObjects) ? ds.dbObjects : []);

const diffDbObjects = (source, target) => {
  const out = [];
  const src = dbObjectsOf(source);
  const tgt = dbObjectsOf(target);
  const same = (a, b) => ['defName', 'comment', 'body'].every(k => norm(a[k]) === norm(b[k]))
    && isEqual(a.props || {}, b.props || {});
  src.forEach((s) => {
    const t = tgt.find(o => dbObjectKey(o) === dbObjectKey(s));
    if (!t) out.push({key: dbObjectKey(s), opt: 'add', source: s, target: null});
    else if (!same(s, t)) out.push({key: dbObjectKey(s), opt: 'update', source: s, target: t});
  });
  tgt.forEach((t) => {
    if (!src.some(o => dbObjectKey(o) === dbObjectKey(t))) {
      out.push({key: dbObjectKey(t), opt: 'delete', source: null, target: t});
    }
  });
  return out;
};

const buildEntityItem = (change, info) => {
  const d = change.data;
  if (change.opt !== 'update') {
    return {
      key: entityKey(d.defKey),
      objectType: 'entity',
      opt: change.opt,
      defKey: d.defKey,
      defName: d.defName || '',
      children: [],
    };
  }
  const k = entityKey(d.baseInfo.defKey);
  const children = [];
  if (d.baseChanged) {
    children.push({key: `${k}/base`, part: 'base', opt: 'update', defKey: d.baseInfo.defKey,
      before: d.baseChanged.before, after: d.baseChanged.after});
  }
  (d.fieldAdded || []).forEach(f => children.push({key: `${k}/field:${lower(f.defKey)}`, part: 'field',
    opt: 'add', defKey: f.defKey, before: null, after: fieldView(f)}));
  (d.fieldRemoved || []).forEach(f => children.push({key: `${k}/field:${lower(f.defKey)}`, part: 'field',
    opt: 'delete', defKey: f.defKey, before: fieldView(f), after: null}));
  (d.fieldModified || []).forEach(f => children.push({key: `${k}/field:${lower(f.defKey)}`, part: 'field',
    opt: 'update', defKey: f.defKey, before: fieldView(f.before), after: fieldView(f.after)}));
  (info?.diffs || []).forEach(i => children.push({key: `${k}/index:${lower(i.defKey)}`, part: 'index',
    opt: i.opt, defKey: i.defKey, before: indexView(i.target), after: indexView(i.source)}));
  return {key: k, objectType: 'entity', opt: 'update', defKey: d.baseInfo.defKey,
    defName: d.baseInfo.defName || '', children};
};

/**
 * Compares two models. The generated script turns `target` into `source`.
 * @returns {{changes: Array, items: Array, indexInfo: Object, dbObjectChanges: Array, db: string}}
 */
export const compareModels = (source, target, options = {}) => {
  assertDataSource(source, 'source');
  assertDataSource(target, 'target');
  const db = resolveSourceDb(source, target, options.db);
  const src = withDefaultDb({...source, entities: source.entities || []}, db);
  const tgt = {...target, entities: target.entities || []};
  const changes = simplePackageChanges(src, tgt, db, true);
  const indexInfo = {};
  src.entities.forEach((se) => {
    const te = tgt.entities.find(e => lower(e.defKey) === lower(se.defKey));
    if (!te) return;
    const info = diffIndexes(se, te);
    if (info.diffs.length === 0) return;
    const key = entityKey(se.defKey);
    indexInfo[key] = info;
    if (!changes.some(c => c.opt === 'update' && entityKey(c.data.baseInfo.defKey) === key)) {
      changes.push(emptyUpdate(se, src, db));
    }
  });
  const dbObjectChanges = diffDbObjects(source, target);
  const items = changes.map(c => buildEntityItem(c,
    indexInfo[entityKey(c.opt === 'update' ? c.data.baseInfo.defKey : c.data.defKey)]))
    .concat(dbObjectChanges.map(c => ({
      key: c.key,
      objectType: 'dbObject',
      opt: c.opt,
      defKey: (c.source || c.target).defKey,
      defName: (c.source || c.target).defName || '',
      children: [],
    })));
  return {changes, items, indexInfo, dbObjectChanges, db};
};

const childSelected = (selected, item, child) => selected.has(child.key) || selected.has(item.key);

const applyIndexSelection = (info, selected, item) => {
  const picked = (info?.diffs || []).filter(i => item.children
    .some(c => c.part === 'index' && lower(c.defKey) === lower(i.defKey) && childSelected(selected, item, c)));
  let list = (info?.targetIndexes || []).slice();
  picked.forEach((i) => {
    const at = list.findIndex(x => lower(x.defKey) === lower(i.defKey));
    if (i.opt === 'delete') list = list.filter((x, n) => n !== at);
    else if (at < 0) list.push(i.source);
    else list[at] = i.source;
  });
  return {picked, list};
};

/** Returns a changes array holding only the ticked differences. */
export const selectChanges = (result, selectedKeys) => {
  assertResult(result);
  const selected = toKeySet(selectedKeys);
  return result.changes.reduce((out, change) => {
    if (change.opt !== 'update') {
      return selected.has(entityKey(change.data.defKey)) ? out.concat(change) : out;
    }
    const d = change.data;
    const item = result.items.find(i => i.key === entityKey(d.baseInfo.defKey));
    const has = (part, defKey) => item.children.some(c => c.part === part
      && (part === 'base' || lower(c.defKey) === lower(defKey)) && childSelected(selected, item, c));
    const keep = (list, getKey) => {
      const kept = (list || []).filter(f => has('field', getKey(f)));
      return kept.length > 0 ? kept : null;
    };
    const baseChanged = d.baseChanged && has('base') ? d.baseChanged : null;
    const fieldAdded = keep(d.fieldAdded, f => f.defKey);
    const fieldRemoved = keep(d.fieldRemoved, f => f.defKey);
    const fieldModified = keep(d.fieldModified, f => f.defKey);
    const {picked, list} = applyIndexSelection(result.indexInfo?.[item.key], selected, item);
    if (!baseChanged && !fieldAdded && !fieldRemoved && !fieldModified && picked.length === 0) {
      return out;
    }
    return out.concat({
      ...change,
      data: {
        ...d,
        baseChanged,
        fieldAdded,
        fieldRemoved,
        fieldModified,
        indexChanged: picked.length > 0,
        newIndexes: list,
      },
    });
  }, []);
};

const selectedDbObjectChanges = (result, selected) => (result.dbObjectChanges || [])
  .filter(c => selected.has(c.key));

/** Renders the ALTER script (entities, then database objects) for the ticked differences. */
export const generateAlterScript = (result, selectedKeys, targetDataSource) => {
  assertResult(result);
  assertDataSource(targetDataSource, 'targetDataSource');
  const selected = toKeySet(selectedKeys);
  const parts = [];
  const changes = selectChanges(result, selected);
  if (changes.length > 0) {
    parts.push(getChanges(changes, targetDataSource).trim());
  }
  const dbId = defaultDbId(targetDataSource);
  selectedDbObjectChanges(result, selected).forEach((c) => {
    if (c.opt !== 'add') parts.push(getDbObjectDDL(c.target, targetDataSource, dbId, 'drop'));
    if (c.opt !== 'delete') parts.push(getDbObjectDDL(c.source, targetDataSource, dbId, 'create'));
  });
  return parts.filter(Boolean).join('\n\n');
};

const collectIds = (ds) => {
  const ids = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.id === 'string') ids.add(v.id);
      Object.keys(v).forEach(k => walk(v[k]));
    }
  };
  walk(ds.entities);
  walk(ds.views);
  walk(ds.dbObjects);
  return ids;
};

const sameResolved = (a, b) => lower(a.type) === lower(b.type)
  && `${norm(a.len)}` === `${norm(b.len)}` && `${norm(a.scale)}` === `${norm(b.scale)}`;

// Writes the type the source resolves to, so the merged field does not depend on source-only domains or mappings.
const convertField = (field, source, target, sourceDb, targetDb) => {
  const resolved = _transform(field, source, sourceDb);
  const base = {...field};
  const domain = (source.domains || []).find(d => d.id === field.domain);
  const tDomain = domain && (target.domains || []).find(d => lower(d.defKey) === lower(domain.defKey));
  const tMapping = (target.dataTypeMapping?.mappings || []).find(m => m.id === field.baseType);
  const literal = {
    ...base,
    type: norm(resolved.type === undefined ? field.type : resolved.type),
    len: norm(resolved.len === undefined ? field.len : resolved.len),
    scale: norm(resolved.scale === undefined ? field.scale : resolved.scale),
  };
  delete literal.domain;
  delete literal.baseType;
  // the rule of the test data belongs to the source model: the rule of the target with
  // the same name is bound, never an id the target does not have
  const testData = pastedTestData(target, field, copiedRule(source, field));
  delete literal.testData;
  if (testData) literal.testData = testData;
  if (tDomain || tMapping) {
    const attempt = {...literal};
    if (tDomain) attempt.domain = tDomain.id;
    if (tMapping) attempt.baseType = tMapping.id;
    const check = _transform(attempt, target, targetDb);
    const want = _transform(literal, target, targetDb);
    if (sameResolved({...attempt, ...check}, {...literal, ...want})) {
      Object.assign(literal, attempt);
    }
  }
  if (field.refDict && !(target.dicts || []).some(d => d.id === field.refDict)) literal.refDict = '';
  return literal;
};

export const mergeSelected = (targetDataSource, sourceDataSource, result, selectedKeys) => {
  assertDataSource(targetDataSource, 'targetDataSource');
  assertDataSource(sourceDataSource, 'sourceDataSource');
  assertResult(result);
  const selected = toKeySet(selectedKeys);
  const target = cloneDeep(targetDataSource);
  const source = sourceDataSource;
  const sourceDb = result.db || defaultDbId(source);
  const targetDb = defaultDbId(target);
  target.entities = target.entities || [];
  const used = collectIds(target);
  const freshId = (id) => {
    let next = id;
    while (!next || used.has(next)) next = Math.uuid();
    used.add(next);
    return next;
  };
  const findEntity = (list, key) => list.find(e => lower(e.defKey) === lower(key));
  const copyIndex = (index, srcEntity, tgtEntity, keepId) => {
    const fields = (index.fields || []).map((f) => {
      const name = fieldName(srcEntity, f.fieldDefKey);
      const tf = (tgtEntity.fields || []).find(x => lower(x.defKey) === lower(name));
      return tf ? {...f, fieldDefKey: tf.id, id: freshId(f.id)} : null;
    }).filter(Boolean);
    return fields.length > 0 ? {...cloneDeep(index), id: keepId || freshId(index.id), fields} : null;
  };
  result.items.filter(i => i.objectType === 'entity').forEach((item) => {
    const whole = selected.has(item.key);
    const srcEntity = findEntity(source.entities || [], item.defKey);
    if (item.opt === 'delete' && whole) {
      const gone = findEntity(target.entities, item.defKey);
      target.entities = target.entities.filter(e => e !== gone);
      (target.viewGroups || []).forEach((g) => {
        if (g.refEntities) g.refEntities = g.refEntities.filter(id => id !== gone.id);
      });
      return;
    }
    if (item.opt === 'add' && whole) {
      const entity = cloneDeep(srcEntity);
      const idMap = {};
      entity.id = freshId(entity.id);
      entity.fields = (entity.fields || []).map((f) => {
        const nf = convertField(f, source, target, sourceDb, targetDb);
        idMap[f.id] = freshId(f.id);
        return {...nf, id: idMap[f.id]};
      });
      entity.indexes = (entity.indexes || []).map(i => ({
        ...i,
        id: freshId(i.id),
        fields: (i.fields || []).map(f => ({...f, fieldDefKey: idMap[f.fieldDefKey] || f.fieldDefKey, id: freshId(f.id)})),
      }));
      entity.correlations = (entity.correlations || []).filter(c => c.refEntity === srcEntity.id
        || target.entities.some(e => e.id === c.refEntity))
        .map(c => ({...c, myField: idMap[c.myField] || c.myField}));
      target.entities.push(entity);
      return;
    }
    if (item.opt !== 'update') return;
    const entity = findEntity(target.entities, item.defKey);
    const on = (c) => selected.has(c.key) || whole;
    const kids = (part, opt) => item.children.filter(c => c.part === part && (!opt || c.opt === opt) && on(c));
    if (kids('base').length > 0) {
      entity.defName = srcEntity.defName;
      entity.comment = srcEntity.comment;
    }
    kids('field', 'delete').forEach((c) => {
      const f = (entity.fields || []).find(x => lower(x.defKey) === lower(c.defKey));
      entity.fields = entity.fields.filter(x => x !== f);
      entity.indexes = (entity.indexes || [])
        .map(i => ({...i, fields: (i.fields || []).filter(x => x.fieldDefKey !== f.id)}))
        .filter(i => i.fields.length > 0);
      entity.correlations = (entity.correlations || []).filter(x => x.myField !== f.id);
    });
    kids('field', 'update').forEach((c) => {
      const at = entity.fields.findIndex(x => lower(x.defKey) === lower(c.defKey));
      const sf = (srcEntity.fields || []).find(x => lower(x.defKey) === lower(c.defKey));
      entity.fields[at] = {...convertField(sf, source, target, sourceDb, targetDb), id: entity.fields[at].id};
    });
    const addedKeys = kids('field', 'add').map(c => lower(c.defKey));
    (srcEntity.fields || []).forEach((sf, n) => {
      if (!addedKeys.includes(lower(sf.defKey))) return;
      const prev = (srcEntity.fields || []).slice(0, n).reverse()
        .map(p => entity.fields.findIndex(x => lower(x.defKey) === lower(p.defKey))).find(x => x > -1);
      const nf = {...convertField(sf, source, target, sourceDb, targetDb), id: freshId(sf.id)};
      entity.fields.splice(prev === undefined ? 0 : prev + 1, 0, nf);
    });
    kids('index').forEach((c) => {
      const at = (entity.indexes || []).findIndex(x => lower(x.defKey) === lower(c.defKey));
      const si = (srcEntity.indexes || []).find(x => lower(x.defKey) === lower(c.defKey));
      entity.indexes = entity.indexes || [];
      if (c.opt === 'delete') {
        entity.indexes.splice(at, 1);
        return;
      }
      const made = copyIndex(si, srcEntity, entity, at > -1 ? entity.indexes[at].id : null);
      if (!made) return;
      if (at > -1) entity.indexes[at] = made;
      else entity.indexes.push(made);
    });
  });
  const dbChanges = selectedDbObjectChanges(result, selected);
  if (dbChanges.length > 0) {
    const entityId = (srcId) => {
      const se = (source.entities || []).find(e => e.id === srcId);
      return findEntity(target.entities, se?.defKey)?.id || '';
    };
    let list = dbObjectsOf(target).slice();
    dbChanges.forEach((c) => {
      const at = list.findIndex(o => dbObjectKey(o) === c.key);
      if (c.opt === 'delete') {
        list = list.filter((o, n) => n !== at);
        return;
      }
      const obj = cloneDeep(c.source);
      obj.refEntity = obj.refEntity ? entityId(obj.refEntity) : obj.refEntity;
      if (at > -1) list[at] = {...obj, id: list[at].id};
      else list.push({...obj, id: freshId(obj.id)});
    });
    target.dbObjects = list;
  }
  return target;
};

/** Every key a "select all" tick covers: whole objects for add/delete, leaves for updates. */
export const allSelectableKeys = (result) => result.items.reduce((keys, item) => keys.concat(
  item.opt === 'update' && item.children.length > 0 ? item.children.map(c => c.key) : item.key), []);
