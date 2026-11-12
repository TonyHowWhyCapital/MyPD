import '../Math';
import {
  elements, child, value, insert, detach, serialize,
} from './xml';
import {
  pdmToDataSource, parseDataType, composeDataType, sameDataType, resolveDb,
} from './read';
import {
  MODEL_ORDER, norm, createContext, find, build, createObject, ensureCollection, setAttribute,
  remove, sweepDanglingRefs,
} from './edit';
import { syncReferences, originIds } from './references';

const TABLE_ORDER = ['c:Columns', 'c:Keys', 'c:Indexes', 'c:PrimaryKey', 'c:ClusterObject'];
const flag = v => (v ? '1' : '');

const effectiveType = (field, dataSource, dbId) => {
  const mappings = dataSource.dataTypeMapping?.mappings || [];
  const domain = field.domain && (dataSource.domains || []).find(d => d.id === field.domain);
  const mapping = mappings.find(m => m.id === (field.baseType || domain?.applyFor));
  return composeDataType({
    type: mapping?.[dbId] || field.type,
    len: domain ? domain.len : field.len,
    scale: domain ? domain.scale : field.scale,
  });
};

const domainType = (domain, dataSource, dbId) => {
  const mapping = (dataSource.dataTypeMapping?.mappings || []).find(m => m.id === domain.applyFor);
  return composeDataType({ type: mapping?.[dbId] || '', len: domain.len, scale: domain.scale });
};

const syncProps = (ctx, el, before, after, specs) => {
  specs.forEach(([key, tag, toXml = norm]) => {
    const content = toXml(after[key], after);
    if (before ? norm(before[key]) !== norm(after[key]) : content !== '') {
      setAttribute(ctx, el, tag, content);
    }
  });
};

const setDataType = (ctx, el, dataType) => {
  const parsed = parseDataType(dataType);
  setAttribute(ctx, el, 'a:DataType', dataType);
  setAttribute(ctx, el, 'a:Length', norm(parsed.len));
  setAttribute(ctx, el, 'a:Precision', norm(parsed.scale));
};

const nameOrCode = (name, object) => norm(name) || norm(object.defKey);
const namedSpecs = [['defName', 'a:Name', nameOrCode], ['defKey', 'a:Code'], ['comment', 'a:Comment']];
const columnSpecs = namedSpecs.concat([['defaultValue', 'a:DefaultValue']]);
const columnFlagSpecs = [['autoIncrement', 'a:Identity', flag], ['notNull', 'a:Column.Mandatory', flag]];

const reorder = (ctx, collection, ordered) => {
  const current = elements(collection);
  if (current.length === ordered.length && current.every((e, i) => e === ordered[i])) {
    return;
  }
  // eslint-disable-next-line no-param-reassign
  collection.children = [{ type: 'text', raw: ctx.eol, parent: collection }];
  insert(collection, ordered, null, ctx.eol);
};

const refLines = (tag, els) => els.map(e => `<${tag} Ref="${e.attrs.Id}"/>`);

const syncDomains = (ctx, before, after, dbId) => {
  before.domains.filter(d => !after.domains.some(a => a.id === d.id)).forEach((d) => {
    const el = find(ctx, d.id, 'o:PhysicalDomain');
    el && remove(ctx, el);
  });
  after.domains.forEach((domain) => {
    const old = before.domains.find(d => d.id === domain.id);
    let el = old && find(ctx, domain.id, 'o:PhysicalDomain');
    if (!el) {
      el = createObject(ctx, 'o:PhysicalDomain', domain.id);
      insert(ensureCollection(ctx, ctx.model, 'c:Domains', MODEL_ORDER), [el], null, ctx.eol);
      // eslint-disable-next-line no-param-reassign
      domain.id = value(el, 'a:ObjectID');
    }
    syncProps(ctx, el, old, domain, namedSpecs.slice(0, 2));
    const type = domainType(domain, after, dbId);
    if (type && !sameDataType(old ? domainType(old, before, dbId) : '', type)) {
      setDataType(ctx, el, type);
    }
  });
};

const syncColumnDomain = (ctx, column, domainId) => {
  const existing = child(column, 'c:Domain');
  existing && detach(existing);
  const domain = domainId && find(ctx, domainId, 'o:PhysicalDomain');
  if (domain) {
    insert(column, build(ctx, ['<c:Domain>', ...refLines('o:PhysicalDomain', [domain]), '</c:Domain>']),
      null, ctx.eol);
  }
};

const syncColumns = (ctx, table, old, entity, sources, dbId) => {
  const oldFields = old ? old.fields : [];
  oldFields.filter(f => !entity.fields.some(a => a.id === f.id)).forEach((f) => {
    const el = find(ctx, f.id, 'o:Column');
    el && remove(ctx, el);
  });
  if (!entity.fields.length) {
    return [];
  }
  const collection = ensureCollection(ctx, table, 'c:Columns', TABLE_ORDER);
  const columns = entity.fields.map((field) => {
    const oldField = oldFields.find(f => f.id === field.id);
    let el = oldField && find(ctx, field.id, 'o:Column');
    if (!el || el.parent !== collection) {
      el = createObject(ctx, 'o:Column', field.id);
      // eslint-disable-next-line no-param-reassign
      field.id = value(el, 'a:ObjectID');
    }
    const before = oldField || {};
    syncProps(ctx, el, oldField, field, columnSpecs);
    const type = effectiveType(field, sources.after, dbId);
    if (!sameDataType(oldField ? effectiveType(oldField, sources.before, dbId) : '', type)) {
      setDataType(ctx, el, type);
    }
    syncProps(ctx, el, oldField, field, columnFlagSpecs);
    if (norm(before.domain) !== norm(field.domain)) {
      syncColumnDomain(ctx, el, field.domain);
    }
    return el;
  });
  reorder(ctx, collection, columns);
  return columns;
};

const syncPrimaryKey = (ctx, table, old, entity, columns) => {
  const pkIds = fields => fields.filter(f => f.primaryKey).map(f => f.id).join();
  if (pkIds(old ? old.fields : []) === pkIds(entity.fields)) {
    return;
  }
  const pkColumns = columns.filter((c, i) => entity.fields[i].primaryKey);
  const pkRef = elements(child(table, 'c:PrimaryKey'))[0];
  let key = pkRef && ctx.byId.get(pkRef.attrs.Ref);
  if (!pkColumns.length) {
    key && remove(ctx, key);
    return;
  }
  if (!key) {
    const keys = ensureCollection(ctx, table, 'c:Keys', TABLE_ORDER);
    key = createObject(ctx, 'o:Key');
    const name = `Key_${elements(keys).length + 1}`;
    setAttribute(ctx, key, 'a:Name', name);
    setAttribute(ctx, key, 'a:Code', name);
    insert(keys, [key], null, ctx.eol);
    insert(ensureCollection(ctx, table, 'c:PrimaryKey', TABLE_ORDER),
      build(ctx, refLines('o:Key', [key])), null, ctx.eol);
  }
  const existing = child(key, 'c:Key.Columns');
  existing && detach(existing);
  insert(key, build(ctx, ['<c:Key.Columns>', ...refLines('o:Column', pkColumns), '</c:Key.Columns>']),
    null, ctx.eol);
};

const indexSignature = index => (index.fields || []).map(f => `${f.fieldDefKey}:${f.ascOrDesc}`).join();

const syncIndexes = (ctx, table, old, entity) => {
  const oldIndexes = old ? old.indexes : [];
  const indexes = entity.indexes || [];
  const hasColumn = index => (index.fields || []).some(f => find(ctx, f.fieldDefKey, 'o:Column'));
  oldIndexes.filter(i => !indexes.some(a => a.id === i.id)).forEach((i) => {
    const el = find(ctx, i.id, 'o:Index');
    el && remove(ctx, el);
  });
  indexes.forEach((index) => {
    const oldIndex = oldIndexes.find(i => i.id === index.id);
    let el = oldIndex && find(ctx, index.id, 'o:Index');
    if (!el && !hasColumn(index)) {
      return;
    }
    if (!el) {
      el = createObject(ctx, 'o:Index', index.id);
      insert(ensureCollection(ctx, table, 'c:Indexes', TABLE_ORDER), [el], null, ctx.eol);
      // eslint-disable-next-line no-param-reassign
      index.id = value(el, 'a:ObjectID');
    }
    syncProps(ctx, el, oldIndex, index, [
      ['defName', 'a:Name', nameOrCode], ['defKey', 'a:Code'], ['comment', 'a:Comment'],
      ['unique', 'a:Unique', flag],
    ]);
    if (!hasColumn(index) || (oldIndex && indexSignature(oldIndex) === indexSignature(index))) {
      return;
    }
    const existing = child(el, 'c:IndexColumns');
    existing && detach(existing);
    const collection = build(ctx, ['<c:IndexColumns>', '</c:IndexColumns>'])[0];
    insert(el, [collection], null, ctx.eol);
    index.fields.forEach((f) => {
      const column = find(ctx, f.fieldDefKey, 'o:Column');
      if (column) {
        const indexColumn = createObject(ctx, 'o:IndexColumn', null, false);
        f.ascOrDesc === 'D' && setAttribute(ctx, indexColumn, 'a:Ascending', '0');
        insert(indexColumn, build(ctx, ['<c:Column>', ...refLines('o:Column', [column]), '</c:Column>']),
          null, ctx.eol);
        insert(collection, [indexColumn], null, ctx.eol);
      }
    });
  });
};

const syncEntities = (ctx, before, after, dbId) => {
  before.entities.filter(e => !after.entities.some(a => a.id === e.id)).forEach((e) => {
    const el = find(ctx, e.id, 'o:Table');
    el && remove(ctx, el);
  });
  after.entities.forEach((entity) => {
    const old = before.entities.find(e => e.id === entity.id);
    let table = old && find(ctx, entity.id, 'o:Table');
    if (!table) {
      table = createObject(ctx, 'o:Table', entity.id);
      insert(ensureCollection(ctx, ctx.model, 'c:Tables', MODEL_ORDER), [table], null, ctx.eol);
      // eslint-disable-next-line no-param-reassign
      entity.id = value(table, 'a:ObjectID');
    }
    syncProps(ctx, table, old, entity, namedSpecs);
    const columns = syncColumns(ctx, table, old, entity, { before, after }, dbId);
    syncPrimaryKey(ctx, table, old, entity, columns);
    syncIndexes(ctx, table, old, entity);
  });
};

// Rewrites only what differs between the file and the project: tables, columns,
// primary keys, indexes, domains and references. Everything else in the file is kept as is.
export const applyDataSourceToPdm = (xml, dataSource, options = {}) => {
  const ctx = createContext(xml, options);
  const after = {
    ...dataSource,
    domains: (dataSource.domains || []).map(d => ({ ...d })),
    entities: (dataSource.entities || []).map(e => ({
      ...e,
      fields: (e.fields || []).map(f => ({ ...f })),
      indexes: (e.indexes || []).map(i => ({ ...i })),
    })),
  };
  const before = pdmToDataSource(xml, dataSource);
  const dbId = resolveDb(ctx.target, dataSource);
  const origin = originIds(after);
  syncDomains(ctx, before, after, dbId);
  syncEntities(ctx, before, after, dbId);
  syncReferences(ctx, before, after, origin);
  sweepDanglingRefs(ctx);
  return serialize(ctx.root);
};
