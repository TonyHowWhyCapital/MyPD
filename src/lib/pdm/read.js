import { parseXml, elements, child, value, walk } from './xml';

const SIGNATURE = 'PDM_DATA_MODEL_XML';
// Diagram units in the file are much finer than canvas pixels, and y grows upwards.
export const CANVAS_SCALE = 24;

const dbMatchers = [
  [/mysql|maria/i, 'MYSQL'],
  [/oracle/i, 'ORACLE'],
  [/sql server|sql azure|sybase|transact/i, 'SQLServer'],
  [/postgre/i, 'PostgreSQL'],
  [/db2/i, 'DB2'],
  [/sqlite/i, 'SQLite'],
  [/hive/i, 'Hive'],
  [/gauss/i, 'GaussDB'],
  [/kingbase/i, 'Kingbase'],
];

export const isPdmFile = (filePath) => /\.pdm$/i.test(filePath || '');

export const parseDataType = (dataType) => {
  const match = /^([^()]+?)\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/.exec((dataType || '').trim());
  if (!match) {
    return { type: (dataType || '').trim(), len: '', scale: '' };
  }
  return {
    type: match[1],
    len: parseInt(match[2], 10),
    scale: match[3] === undefined ? '' : parseInt(match[3], 10),
  };
};

export const composeDataType = ({ type, len, scale }) => {
  const hasLen = len !== '' && len !== undefined && len !== null;
  const hasScale = scale !== '' && scale !== undefined && scale !== null;
  return `${type || ''}${hasLen ? `(${len}${hasScale ? `,${scale}` : ''})` : ''}`;
};

export const sameDataType = (a, b) => {
  const normalize = t => (t || '').replace(/\s+/g, '').toLowerCase();
  return normalize(a) === normalize(b);
};

// Locates the model element and indexes every object by its file-local Id.
export const openPdm = (xml) => {
  const root = parseXml(xml);
  const header = root.children.find(c => c.type === 'misc' && c.raw.includes(SIGNATURE));
  const model = child(child(child(child(root, 'Model'), 'o:RootObject'), 'c:Children'), 'o:Model');
  if (!header || !model) {
    throw new Error('Invalid PDM file: not a physical data model in XML format');
  }
  const byId = new Map();
  const refs = [];
  walk(root, (el) => {
    if (el.attrs.Id) {
      byId.set(el.attrs.Id, el);
    } else if (el.attrs.Ref) {
      refs.push(el);
    }
  });
  const target = (/\sTarget="([^"]*)"/.exec(header.raw) || [])[1] || '';
  return { root, model, byId, refs, target, eol: xml.includes('\r\n') ? '\r\n' : '\n' };
};

const resolve = (doc, el) => (el && el.attrs.Ref ? doc.byId.get(el.attrs.Ref) : el);
export const refTarget = (doc, owner, collection) => resolve(doc, elements(child(owner, collection))[0]);
const objectId = el => value(el, 'a:ObjectID');

// Every package nests the same collections as the model itself.
export const scopes = (model) => {
  return [model].concat(elements(child(model, 'c:Packages'), 'o:Package')
    .reduce((all, p) => all.concat(scopes(p)), []));
};

export const collect = (doc, collection, tag) => {
  return scopes(doc.model)
    .reduce((all, s) => all.concat(elements(child(s, collection), tag)), []);
};

const readDomains = (doc, base, dbId) => {
  const mappings = [...(base.dataTypeMapping?.mappings || [])];
  const mappingFor = (type) => {
    let mapping = mappings.find(m => sameDataType(m[dbId], type));
    if (!mapping) {
      mapping = { id: `PDM-TYPE-${type.toUpperCase()}`, defKey: type, defName: type, [dbId]: type };
      mappings.push(mapping);
    }
    return mapping;
  };
  const domains = collect(doc, 'c:Domains', 'o:PhysicalDomain').map((el) => {
    const dataType = parseDataType(value(el, 'a:DataType'));
    return {
      id: objectId(el),
      defKey: value(el, 'a:Code'),
      defName: value(el, 'a:Name'),
      applyFor: mappingFor(dataType.type).id,
      len: dataType.len,
      scale: dataType.scale,
      uiHint: '',
      defaultValue: value(el, 'a:DefaultValue'),
      notNull: value(el, 'a:PhysicalDomain.Mandatory') === '1',
      comment: value(el, 'a:Comment'),
    };
  });
  return { domains, mappings };
};

const readField = (doc, el, pkColumns, domains, mappings, dbId) => {
  const dataType = parseDataType(value(el, 'a:DataType'));
  const field = {
    id: objectId(el),
    defKey: value(el, 'a:Code'),
    defName: value(el, 'a:Name'),
    comment: value(el, 'a:Comment'),
    type: dataType.type,
    len: dataType.len,
    scale: dataType.scale,
    primaryKey: pkColumns.includes(el),
    notNull: value(el, 'a:Column.Mandatory') === '1',
    autoIncrement: value(el, 'a:Identity') === '1',
    defaultValue: value(el, 'a:DefaultValue'),
    hideInGraph: false,
    refDict: '',
    uiHint: '',
    domain: '',
    baseType: '',
  };
  const domainEl = refTarget(doc, el, 'c:Domain');
  const domain = domainEl && domains.find(d => d.id === objectId(domainEl));
  const mapping = domain && mappings.find(m => m.id === domain.applyFor);
  // A column may diverge from its domain in the file. Linking it anyway would
  // silently replace the column's own type with the domain's.
  if (mapping && sameDataType(composeDataType({ ...domain, type: mapping[dbId] }),
    composeDataType(dataType))) {
    field.domain = domain.id;
    field.baseType = mapping.id;
  }
  return field;
};

const readEntity = (doc, el, createEntity, domains, mappings, dbId) => {
  const pkColumns = elements(child(refTarget(doc, el, 'c:PrimaryKey'), 'c:Key.Columns'))
    .map(c => resolve(doc, c));
  const columns = elements(child(el, 'c:Columns'), 'o:Column');
  return {
    ...createEntity(),
    id: objectId(el),
    defKey: value(el, 'a:Code'),
    defName: value(el, 'a:Name'),
    comment: value(el, 'a:Comment'),
    fields: columns.map(c => readField(doc, c, pkColumns, domains, mappings, dbId)),
    indexes: elements(child(el, 'c:Indexes'), 'o:Index').map(index => ({
      id: objectId(index),
      defKey: value(index, 'a:Code'),
      defName: value(index, 'a:Name'),
      unique: value(index, 'a:Unique') === '1',
      comment: value(index, 'a:Comment'),
      fields: elements(child(index, 'c:IndexColumns'), 'o:IndexColumn')
        .map(ic => ({ ic, column: refTarget(doc, ic, 'c:Column') }))
        .filter(({ column }) => column)
        .map(({ ic, column }) => ({
          id: objectId(ic),
          fieldDefKey: objectId(column),
          ascOrDesc: value(ic, 'a:Ascending') === '0' ? 'D' : 'A',
        })),
    })),
    // The primary key is listed with the others; its columns are the ones marked above.
    keys: elements(child(el, 'c:Keys'), 'o:Key').map(key => ({
      id: objectId(key),
      defKey: value(key, 'a:Code'),
      defName: value(key, 'a:Name'),
      constraintName: value(key, 'a:ConstraintName'),
      primary: key === refTarget(doc, el, 'c:PrimaryKey'),
      fields: elements(child(key, 'c:Key.Columns')).map(c => resolve(doc, c)).filter(c => c).map(objectId),
    })),
    correlations: [],
  };
};

// How many rows of the child one row of the parent may have, in the words of the file
// and in those of the project.
const ROWS = { '0..*': 'n', '1..*': '1,n', '0..1': '0,1', '1..1': '1' };
export const rowsOf = cardinality => ROWS[cardinality] || 'n';
export const cardinalityOf = (rows) => {
  return Object.keys(ROWS).find(c => ROWS[c] === (rows === '0,n' ? 'n' : rows)) || '0..*';
};

// A reference over several columns has one join for each pair of them.
export const readReferences = (doc) => {
  return collect(doc, 'c:References', 'o:Reference').map((el) => {
    const parent = refTarget(doc, el, 'c:ParentTable');
    const childTable = refTarget(doc, el, 'c:ChildTable');
    const joins = elements(child(el, 'c:Joins'), 'o:ReferenceJoin').map(join => ({
      el: join,
      parentColumn: refTarget(doc, join, 'c:Object1'),
      childColumn: refTarget(doc, join, 'c:Object2'),
    })).filter(j => j.parentColumn && j.childColumn).map(j => ({
      el: j.el,
      parentField: objectId(j.parentColumn),
      childField: objectId(j.childColumn),
    }));
    if (!parent || !childTable || joins.length === 0) {
      return null;
    }
    return {
      el,
      parent: objectId(parent),
      child: objectId(childTable),
      cardinality: value(el, 'a:Cardinality'),
      joins,
    };
  }).filter(r => r);
};

const readRect = (symbol) => {
  const numbers = (value(symbol, 'a:Rect').match(/-?\d+/g) || []).map(Number);
  if (numbers.length !== 4) {
    return null;
  }
  return { x: Math.min(numbers[0], numbers[2]), top: Math.max(numbers[1], numbers[3]) };
};

const readDiagrams = (doc, references) => {
  return collect(doc, 'c:PhysicalDiagrams', 'o:PhysicalDiagram').map((el) => {
    const symbols = child(el, 'c:Symbols');
    const tables = elements(symbols, 'o:TableSymbol')
      .map(s => ({ s, rect: readRect(s), table: refTarget(doc, s, 'c:Object') }))
      .filter(t => t.rect && t.table && t.table.tag === 'o:Table');
    const minX = Math.min(...tables.map(t => t.rect.x));
    const maxTop = Math.max(...tables.map(t => t.rect.top));
    const cellId = s => `${objectId(el)}-${s.attrs.Id}`;
    const nodes = tables.map(({ s, rect, table }) => ({
      id: cellId(s),
      shape: 'table',
      position: {
        x: Math.round((rect.x - minX) / CANVAS_SCALE),
        y: Math.round((maxTop - rect.top) / CANVAS_SCALE),
      },
      count: 0,
      originKey: objectId(table),
    }));
    const edges = elements(symbols, 'o:ReferenceSymbol').map((s) => {
      const reference = references.find(r => r.el === refTarget(doc, s, 'c:Object'));
      const parentSymbol = tables.find(t => t.s === refTarget(doc, s, 'c:DestinationSymbol'));
      const childSymbol = tables.find(t => t.s === refTarget(doc, s, 'c:SourceSymbol'));
      if (!reference || !parentSymbol || !childSymbol) {
        return null;
      }
      return reference.joins.map((join, n) => ({
        id: n === 0 ? cellId(s) : `${cellId(s)}-${n}`,
        shape: 'erdRelation',
        source: { cell: cellId(parentSymbol.s), port: `${join.parentField}%out` },
        target: { cell: cellId(childSymbol.s), port: `${join.childField}%in` },
        relation: `1:${rowsOf(reference.cardinality)}`,
        fillColor: '#ACDAFC',
      }));
    }).filter(e => e).reduce((all, e) => all.concat(e), []);
    return {
      id: objectId(el),
      defKey: value(el, 'a:Code'),
      defName: value(el, 'a:Name'),
      relationType: 'field',
      comment: '',
      canvasData: { cells: nodes.concat(edges) },
    };
  });
};

const readGroups = (doc) => {
  return scopes(doc.model).slice(1).map(p => ({
    id: objectId(p),
    defKey: value(p, 'a:Code'),
    defName: value(p, 'a:Name'),
    refEntities: elements(child(p, 'c:Tables'), 'o:Table').map(objectId),
    refViews: [],
    refDiagrams: elements(child(p, 'c:PhysicalDiagrams'), 'o:PhysicalDiagram').map(objectId),
    refDicts: [],
  }));
};

export const resolveDb = (target, base) => {
  const supports = base.profile?.dataTypeSupports || [];
  const key = (dbMatchers.find(m => m[0].test(target)) || [])[1] || target;
  const db = supports.find(s => s.defKey.toLowerCase() === `${key}`.toLowerCase());
  return db ? db.id : (base.profile?.default?.db || supports[0]?.id);
};

const defaultEntity = () => ({
  properties: {},
  sysProps: { nameTemplate: '{defKey}[{defName}]' },
  notes: {},
  headers: [],
  type: 'P',
});

// Builds a project from the file. Object ids are the file's own object ids, so a
// later save can find each table, column, index and domain again.
export const pdmToDataSource = (xml, base, { createEntity = defaultEntity } = {}) => {
  const doc = openPdm(xml);
  const dbId = resolveDb(doc.target, base);
  const { domains, mappings } = readDomains(doc, base, dbId);
  const entities = collect(doc, 'c:Tables', 'o:Table')
    .map(el => readEntity(doc, el, createEntity, domains, mappings, dbId));
  const references = readReferences(doc);
  references.forEach((r) => {
    const entity = entities.find(e => e.id === r.child);
    r.joins.forEach(join => entity.correlations.push({
      myField: join.childField,
      refEntity: r.parent,
      refField: join.parentField,
      myRows: rowsOf(r.cardinality),
      refRows: '1',
      innerType: '',
    }));
  });
  return {
    ...base,
    name: value(doc.model, 'a:Name'),
    describe: value(doc.model, 'a:Comment'),
    profile: {
      ...base.profile,
      // The file is the source of truth for columns, so new tables start empty.
      default: { ...base.profile?.default, db: dbId, entityInitFields: [] },
    },
    entities,
    views: [],
    viewGroups: readGroups(doc),
    domains,
    dataTypeMapping: { ...base.dataTypeMapping, mappings },
    diagrams: readDiagrams(doc, references),
  };
};
