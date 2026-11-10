import './Math';

// Flat, grid-friendly views of a whole model, edited from the Table, Column or
// Domain angle at once, plus mutations that apply an edited row back into the
// dataSource and keep dependent objects (correlations, indexes, diagram cells,
// view groups) consistent.

const entitiesOf = ds => ds.entities || [];
const domainsOf = ds => ds.domains || [];
const mappingsOf = ds => ds.dataTypeMapping?.mappings || [];
const defaultDb = ds => ds.profile?.default?.db || ds.profile?.dataTypeSupports?.[0]?.id;

export const getTableRows = ds => entitiesOf(ds).map(e => ({
  id: e.id,
  defKey: e.defKey || '',
  defName: e.defName || '',
  comment: e.comment || '',
  fieldCount: (e.fields || []).length,
}));

const domainLabel = (ds, domainId) => {
  const domain = domainsOf(ds).find(d => d.id === domainId);
  return domain ? (domain.defName || domain.defKey || '') : '';
};

// The database-specific type text a column resolves to, after domain and mapping.
export const resolveColumnType = (ds, field) => {
  const dbId = defaultDb(ds);
  const domain = field.domain && domainsOf(ds).find(d => d.id === field.domain);
  const mapping = mappingsOf(ds).find(m => m.id === (field.baseType || domain?.applyFor));
  const type = mapping?.[dbId] || field.type || '';
  const len = domain ? domain.len : field.len;
  const scale = domain ? domain.scale : field.scale;
  return { type, len: len === undefined ? '' : len, scale: scale === undefined ? '' : scale };
};

export const getColumnRows = ds => entitiesOf(ds).reduce((rows, e) => rows.concat(
  (e.fields || []).map((f) => {
    const resolved = resolveColumnType(ds, f);
    return {
      entityId: e.id,
      entityKey: e.defKey || '',
      id: f.id,
      defKey: f.defKey || '',
      defName: f.defName || '',
      type: f.type || '',
      resolvedType: resolved.type,
      len: resolved.len,
      scale: resolved.scale,
      primaryKey: !!f.primaryKey,
      notNull: !!f.notNull,
      autoIncrement: !!f.autoIncrement,
      defaultValue: f.defaultValue || '',
      comment: f.comment || '',
      domain: f.domain || '',
      domainName: domainLabel(ds, f.domain),
    };
  }),
), []);

export const getDomainRows = ds => domainsOf(ds).map((d) => {
  const mapping = mappingsOf(ds).find(m => m.id === d.applyFor);
  return {
    id: d.id,
    defKey: d.defKey || '',
    defName: d.defName || '',
    applyFor: d.applyFor || '',
    applyForName: mapping ? `${mapping.defKey}${mapping.defName ? `(${mapping.defName})` : ''}` : '',
    len: d.len === undefined ? '' : d.len,
    scale: d.scale === undefined ? '' : d.scale,
  };
});

const TABLE_FIELDS = ['defKey', 'defName', 'comment'];
const DOMAIN_FIELDS = ['defKey', 'defName', 'applyFor', 'len', 'scale'];
const COLUMN_FIELDS = ['defKey', 'defName', 'type', 'len', 'scale', 'primaryKey',
  'notNull', 'autoIncrement', 'defaultValue', 'comment', 'domain'];

const pick = (patch, keys) => keys.reduce((acc, k) => {
  if (k in patch) {
    acc[k] = patch[k];
  }
  return acc;
}, {});

const mapEntities = (ds, fn) => ({ ...ds, entities: entitiesOf(ds).map(fn) });

export const updateTable = (ds, id, patch) => mapEntities(ds, e => (e.id === id
  ? { ...e, ...pick(patch, TABLE_FIELDS) } : e));

// Dropping a column clears its type when a domain is chosen, so the domain drives it.
export const updateColumn = (ds, entityId, fieldId, patch) => mapEntities(ds, (e) => {
  if (e.id !== entityId) {
    return e;
  }
  return {
    ...e,
    fields: (e.fields || []).map((f) => {
      if (f.id !== fieldId) {
        return f;
      }
      const next = { ...f, ...pick(patch, COLUMN_FIELDS) };
      if ('domain' in patch) {
        const domain = patch.domain && domainsOf(ds).find(d => d.id === patch.domain);
        next.baseType = domain ? domain.applyFor : '';
        if (domain) {
          next.type = '';
        }
      } else if ('type' in patch) {
        next.domain = '';
        next.baseType = '';
      }
      return next;
    }),
  };
});

export const addColumn = (ds, entityId) => {
  const id = Math.uuid();
  return {
    next: mapEntities(ds, e => (e.id === entityId ? {
      ...e,
      fields: (e.fields || []).concat({
        id,
        defKey: '',
        defName: '',
        comment: '',
        type: 'VARCHAR',
        len: '',
        scale: '',
        primaryKey: false,
        notNull: false,
        autoIncrement: false,
        defaultValue: '',
        hideInGraph: false,
        domain: '',
        baseType: '',
        refDict: '',
        uiHint: '',
      }),
    } : e)),
    id,
  };
};

const cleanDiagramsForEntities = (ds, removedIds) => ({
  ...ds,
  diagrams: (ds.diagrams || []).map((d) => {
    const cells = d.canvasData?.cells || [];
    const deadNodes = new Set(cells
      .filter(c => c.shape === 'table' && removedIds.includes(c.originKey)).map(c => c.id));
    return {
      ...d,
      canvasData: {
        ...d.canvasData,
        cells: cells.filter(c => !(c.shape === 'table' && removedIds.includes(c.originKey))
          && !(c.source && deadNodes.has(c.source.cell))
          && !(c.target && deadNodes.has(c.target.cell))),
      },
    };
  }),
  viewGroups: (ds.viewGroups || []).map(g => ({
    ...g,
    refEntities: (g.refEntities || []).filter(id => !removedIds.includes(id)),
  })),
});

export const removeTables = (ds, ids) => {
  const removed = new Set(ids);
  const next = {
    ...ds,
    entities: entitiesOf(ds)
      .filter(e => !removed.has(e.id))
      .map(e => ({
        ...e,
        correlations: (e.correlations || []).filter(c => !removed.has(c.refEntity)),
      })),
  };
  return cleanDiagramsForEntities(next, ids);
};

const cleanDiagramsForFields = (ds, fieldIds) => ({
  ...ds,
  diagrams: (ds.diagrams || []).map(d => ({
    ...d,
    canvasData: {
      ...d.canvasData,
      cells: (d.canvasData?.cells || []).filter(c => !(c.shape === 'erdRelation'
        && [c.source?.port, c.target?.port]
          .some(p => p && fieldIds.includes(`${p}`.split('%')[0])))),
    },
  })),
});

// rows: [{entityId, fieldId}]. Removes the columns and every index entry,
// correlation and diagram edge that referenced them.
export const removeColumns = (ds, rows) => {
  const byEntity = rows.reduce((acc, r) => {
    (acc[r.entityId] = acc[r.entityId] || new Set()).add(r.fieldId);
    return acc;
  }, {});
  const fieldIds = rows.map(r => r.fieldId);
  const next = mapEntities(ds, (e) => {
    const removed = byEntity[e.id];
    return {
      ...e,
      fields: (e.fields || []).filter(f => !(removed && removed.has(f.id))),
      correlations: (e.correlations || [])
        .filter(c => !fieldIds.includes(c.myField) && !fieldIds.includes(c.refField)),
      indexes: (e.indexes || []).map(idx => ({
        ...idx,
        fields: (idx.fields || []).filter(f => !fieldIds.includes(f.fieldDefKey)),
      })).filter(idx => (idx.fields || []).length > 0),
    };
  });
  return cleanDiagramsForFields(next, fieldIds);
};

export const updateDomain = (ds, id, patch) => ({
  ...ds,
  domains: domainsOf(ds).map(d => (d.id === id ? { ...d, ...pick(patch, DOMAIN_FIELDS) } : d)),
});

export const addDomain = (ds) => {
  const id = Math.uuid();
  const mapping = mappingsOf(ds)[0];
  return {
    next: {
      ...ds,
      domains: domainsOf(ds).concat({
        id,
        defKey: '',
        defName: '',
        applyFor: mapping ? mapping.id : '',
        len: '',
        scale: '',
        uiHint: '',
      }),
    },
    id,
  };
};

const uniqueKey = (base, taken) => {
  let key = base;
  for (let n = 2; taken.includes(key.toLowerCase()); n += 1) {
    key = `${base}_${n}`;
  }
  return key;
};

// A domain proposal taken from a column's current type. The type mapping is
// reused when one already produces that type for the current database;
// otherwise a new mapping is proposed alongside.
export const draftDomainFromColumn = (ds, field) => {
  const dbId = defaultDb(ds);
  const resolved = resolveColumnType(ds, field);
  const sameType = m => !!resolved.type
    && `${m[dbId] || ''}`.toLowerCase() === resolved.type.toLowerCase();
  const existing = mappingsOf(ds).find(m => m.id === field.baseType && sameType(m))
    || mappingsOf(ds).find(sameType);
  const mapping = existing || (resolved.type
    ? { id: Math.uuid(), defKey: resolved.type, defName: resolved.type, [dbId]: resolved.type }
    : null);
  return {
    domain: {
      id: Math.uuid(),
      defKey: uniqueKey(field.defKey || 'domain',
        domainsOf(ds).map(d => `${d.defKey || ''}`.toLowerCase())),
      defName: field.defName || '',
      applyFor: mapping ? mapping.id : '',
      len: resolved.len,
      scale: resolved.scale,
      uiHint: '',
    },
    mapping: existing ? null : mapping,
  };
};

// 'required' or 'duplicate' when the domain code cannot be used, otherwise ''.
export const domainKeyProblem = (ds, defKey) => {
  const key = `${defKey || ''}`.trim().toLowerCase();
  if (!key) {
    return 'required';
  }
  return domainsOf(ds).some(d => `${d.defKey || ''}`.toLowerCase() === key) ? 'duplicate' : '';
};

// Adds the domain, and the proposed mapping only when the domain still uses it.
export const commitDomain = (ds, domain, mapping) => ({
  ...ds,
  dataTypeMapping: {
    ...ds.dataTypeMapping,
    mappings: mapping && domain.applyFor === mapping.id
      ? mappingsOf(ds).concat(mapping) : mappingsOf(ds),
  },
  domains: domainsOf(ds).concat(domain),
});

// Turns a column's current type into a new domain and links the column to it,
// so other columns can then share the same definition.
export const addDomainFromColumn = (ds, entityId, fieldId) => {
  const field = (entitiesOf(ds).find(e => e.id === entityId)?.fields || [])
    .find(f => f.id === fieldId);
  if (!field) {
    return { next: ds, id: '' };
  }
  const { domain, mapping } = draftDomainFromColumn(ds, field);
  const next = updateColumn(commitDomain(ds, domain, mapping), entityId, fieldId,
    { domain: domain.id });
  return { next, id: domain.id, defKey: domain.defKey };
};

// A domain in use cannot be removed, since columns would lose their type source.
export const domainUsage = (ds, id) => entitiesOf(ds).reduce((count, e) => count
  + (e.fields || []).filter(f => f.domain === id).length, 0);

export const removeDomains = (ds, ids) => {
  const removable = ids.filter(id => domainUsage(ds, id) === 0);
  const removed = new Set(removable);
  return {
    next: { ...ds, domains: domainsOf(ds).filter(d => !removed.has(d.id)) },
    removed: removable,
    blocked: ids.filter(id => !removed.has(id)),
  };
};

export const getTypeOptions = ds => mappingsOf(ds).map(m => ({
  id: m.id,
  label: `${m.defKey}${m.defName ? `(${m.defName})` : ''}`,
}));

// Header click cycle for one column: unsorted -> ascending -> descending -> unsorted.
// Columns keep the order they were added in, which is their sort priority.
export const toggleSort = (sorts, key) => {
  const current = sorts.find(s => s.key === key);
  if (!current) {
    return sorts.concat({ key, dir: 'asc' });
  }
  return current.dir === 'asc'
    ? sorts.map(s => (s.key === key ? { key, dir: 'desc' } : s))
    : sorts.filter(s => s.key !== key);
};

const isBlank = v => v === '' || v === undefined || v === null;
const compareValues = (a, b) => {
  if (isBlank(a) || isBlank(b)) {
    // Blank values stay together at the top when ascending.
    return (isBlank(a) ? 0 : 1) - (isBlank(b) ? 0 : 1);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return (a ? 1 : 0) - (b ? 1 : 0);
  }
  return `${a}`.localeCompare(`${b}`, undefined, { numeric: true, sensitivity: 'base' });
};

// Stable multi-column sort. `getters` maps a sort key to the value shown in that column.
export const sortRows = (rows, sorts, getters = {}) => {
  if (sorts.length === 0) {
    return rows;
  }
  const valueOf = (row, key) => (getters[key] ? getters[key](row) : row[key]);
  return rows.map((row, index) => ({ row, index })).sort((x, y) => {
    for (let i = 0; i < sorts.length; i += 1) {
      const { key, dir } = sorts[i];
      const result = compareValues(valueOf(x.row, key), valueOf(y.row, key));
      if (result !== 0) {
        return dir === 'desc' ? -result : result;
      }
    }
    return x.index - y.index;
  }).map(item => item.row);
};
