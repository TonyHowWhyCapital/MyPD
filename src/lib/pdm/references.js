import '../Math';
import { elements, child, value, insert, encode } from './xml';
import {
  readReferences, refTarget, rowsOf, cardinalityOf,
} from './read';
import {
  MODEL_ORDER, find, build, ensureCollection, setAttribute, remove,
} from './edit';

// Writing gives new tables and columns the ids of the file. The references of the project
// still name them by the ids they had before, so those are remembered first.
export const originIds = dataSource => (dataSource.entities || []).map(e => ({
  ids: [e.id, e.sourceId],
  fields: (e.fields || []).map(f => [f.id, f.sourceId]),
}));

export const finalIds = (dataSource, origin) => {
  const map = {};
  (dataSource.entities || []).forEach((e, i) => {
    origin[i].ids.concat(e.id).filter(id => id).forEach((id) => { map[id] = e.id; });
    (e.fields || []).forEach((f, n) => {
      (origin[i].fields[n] || []).concat(f.id).filter(id => id).forEach((id) => { map[id] = f.id; });
    });
  });
  return map;
};

const keyOf = (r, join = r) => [r.child, join.childField, r.parent, join.parentField].join('|').toUpperCase();

// A reference hangs on a key of the parent table, here its primary key.
const primaryKey = (ctx, table) => {
  const key = refTarget(ctx, table, 'c:PrimaryKey');
  return key ? { key, columns: elements(child(key, 'c:Key.Columns')).map(c => c.attrs.Ref || c.attrs.Id) } : null;
};

const stamp = ctx => [
  `<a:CreationDate>${ctx.now}</a:CreationDate>`,
  `<a:Creator>${encode(ctx.user)}</a:Creator>`,
  `<a:ModificationDate>${ctx.now}</a:ModificationDate>`,
  `<a:Modifier>${encode(ctx.user)}</a:Modifier>`,
];

const freeName = (ctx) => {
  const taken = new Set(readReferences(ctx).map(r => value(r.el, 'a:Code').toLowerCase()));
  let n = taken.size + 1;
  while (taken.has(`reference_${n}`)) {
    n += 1;
  }
  return `Reference_${n}`;
};

// What the child rows do when the parent changes: nothing, refuse, follow, empty, default.
const RULES = ['0', '1', '2', '3', '4'];

// The same shape the modeling tool writes; changes and deletions of the parent are
// refused unless the line says otherwise. `joins` pairs a column of the parent with one of the child.
const create = (ctx, { parent, child: childTable, key, joins, rows, updateRule, deleteRule }) => {
  const name = freeName(ctx);
  const nodes = build(ctx, [
    `<o:Reference Id="${ctx.nextId()}">`,
    `<a:ObjectID>${Math.uuid().toUpperCase()}</a:ObjectID>`,
    `<a:Name>${name}</a:Name>`,
    `<a:Code>${name}</a:Code>`,
    ...stamp(ctx),
    `<a:Cardinality>${cardinalityOf(rows)}</a:Cardinality>`,
    `<a:UpdateConstraint>${RULES.includes(`${updateRule}`) ? updateRule : 1}</a:UpdateConstraint>`,
    `<a:DeleteConstraint>${RULES.includes(`${deleteRule}`) ? deleteRule : 1}</a:DeleteConstraint>`,
    '<c:ParentTable>',
    `<o:Table Ref="${parent.attrs.Id}"/>`,
    '</c:ParentTable>',
    '<c:ChildTable>',
    `<o:Table Ref="${childTable.attrs.Id}"/>`,
    '</c:ChildTable>',
    '<c:ParentKey>',
    `<o:Key Ref="${key.attrs.Id}"/>`,
    '</c:ParentKey>',
    '<c:Joins>',
    ...joins.reduce((lines, join) => lines.concat([
      `<o:ReferenceJoin Id="${ctx.nextId()}">`,
      `<a:ObjectID>${Math.uuid().toUpperCase()}</a:ObjectID>`,
      ...stamp(ctx),
      '<c:Object1>',
      `<o:Column Ref="${join.parentColumn.attrs.Id}"/>`,
      '</c:Object1>',
      '<c:Object2>',
      `<o:Column Ref="${join.childColumn.attrs.Id}"/>`,
      '</c:Object2>',
      '</o:ReferenceJoin>',
    ]), []),
    '</c:Joins>',
    '</o:Reference>',
  ]);
  insert(ensureCollection(ctx, ctx.model, 'c:References', MODEL_ORDER), nodes, null, ctx.eol);
  return nodes[0];
};

const MANY = ['n', '0,n', '1,n'];

// Which end of a drawn line is the parent: the one that is not "many". `rows` says how
// many rows the child may have.
const relationOf = (cell, tableOf, ids) => {
  const [from = '', to = ''] = `${cell.relation || ''}`.split(':');
  const end = side => ({
    table: tableOf[side?.cell],
    field: `${side?.port || ''}`.split('%')[0],
  });
  const source = end(cell.source);
  const target = end(cell.target);
  if (!source.table || !target.table || !source.field || !target.field
    || (MANY.includes(from) && MANY.includes(to))) {
    return null;
  }
  const [parent, many, rows] = MANY.includes(from) ? [target, source, from] : [source, target, to];
  const id = v => ids[v] || v;
  return {
    parent: id(parent.table),
    parentField: id(parent.field),
    child: id(many.table),
    childField: id(many.field),
    rows,
    updateRule: cell.updateRule,
    deleteRule: cell.deleteRule,
  };
};

// Every relation drawn in a diagram, with the diagrams it is drawn in.
const drawn = (dataSource, ids = {}) => {
  const all = new Map();
  (dataSource.diagrams || []).forEach((d) => {
    const cells = d.canvasData?.cells || [];
    const tableOf = cells.filter(c => c.shape === 'table')
      .reduce((map, c) => ({ ...map, [c.id]: c.originKey }), {});
    cells.filter(c => c.shape === 'erdRelation').forEach((c) => {
      const relation = relationOf(c, tableOf, ids);
      if (relation) {
        const entry = all.get(keyOf(relation)) || { relation, diagrams: [] };
        entry.diagrams.push(d.id);
        all.set(keyOf(relation), entry);
      }
    });
  });
  return all;
};

const centre = (symbol) => {
  const n = (value(symbol, 'a:Rect').match(/-?\d+/g) || []).map(Number);
  return n.length === 4 ? [Math.round((n[0] + n[2]) / 2), Math.round((n[1] + n[3]) / 2)] : null;
};

// The line of a new reference, between the symbols its two tables already have in the
// diagram. Without both of them the reference exists but is not drawn there.
const addSymbol = (ctx, diagramId, reference, parent, childTable) => {
  const symbols = child(find(ctx, diagramId, 'o:PhysicalDiagram'), 'c:Symbols');
  const symbolOf = table => elements(symbols, 'o:TableSymbol')
    .find(s => refTarget(ctx, s, 'c:Object') === table);
  const from = symbolOf(childTable);
  const to = symbolOf(parent);
  const a = from && centre(from);
  const b = to && centre(to);
  if (!a || !b) {
    return;
  }
  const nodes = build(ctx, [
    `<o:ReferenceSymbol Id="${ctx.nextId()}">`,
    `<a:CreationDate>${ctx.now}</a:CreationDate>`,
    `<a:ModificationDate>${ctx.now}</a:ModificationDate>`,
    `<a:Rect>((${Math.min(a[0], b[0])},${Math.min(a[1], b[1])}), (${Math.max(a[0], b[0])},${Math.max(a[1], b[1])}))</a:Rect>`,
    `<a:ListOfPoints>((${a[0]},${a[1]}),(${b[0]},${b[1]}))</a:ListOfPoints>`,
    '<a:CornerStyle>2</a:CornerStyle>',
    '<a:ArrowStyle>1</a:ArrowStyle>',
    '<a:LineColor>4194432</a:LineColor>',
    '<a:ShadowColor>12632256</a:ShadowColor>',
    '<c:SourceSymbol>',
    `<o:TableSymbol Ref="${from.attrs.Id}"/>`,
    '</c:SourceSymbol>',
    '<c:DestinationSymbol>',
    `<o:TableSymbol Ref="${to.attrs.Id}"/>`,
    '</c:DestinationSymbol>',
    '<c:Object>',
    `<o:Reference Ref="${reference.attrs.Id}"/>`,
    '</c:Object>',
    '</o:ReferenceSymbol>',
  ]);
  insert(symbols, nodes, elements(symbols)[0], ctx.eol);
};

// Lines between the same two tables that together cover the parent's whole key are one
// reference over several columns. Any other line is a reference of its own.
const grouped = (ctx, lines) => {
  const pairs = lines.reduce((map, line) => {
    const pair = `${line.relation.parent}|${line.relation.child}`;
    return { ...map, [pair]: (map[pair] || []).concat(line) };
  }, {});
  return Object.keys(pairs).reduce((all, pair) => {
    const group = pairs[pair];
    const parent = find(ctx, group[0].relation.parent, 'o:Table');
    const pk = parent && primaryKey(ctx, parent);
    const columns = group.map(l => (find(ctx, l.relation.parentField, 'o:Column') || { attrs: {} }).attrs.Id);
    const whole = pk && pk.columns.length > 1 && columns.length === pk.columns.length
      && pk.columns.every(c => columns.includes(c));
    return all.concat(whole ? [group] : group.map(line => [line]));
  }, []);
};

// Brings the references of the file in line with the lines drawn in the diagrams of the
// project. A reference goes only when its lines were taken out of a diagram that still
// shows both tables, so one the file holds without a line, or of a diagram not in the
// project, stays.
export const syncReferences = (ctx, before, after, ids) => {
  const now = drawn(after, ids);
  const was = drawn(before);
  // Taking a table off a diagram takes its lines along; that is not deleting the reference.
  const shows = (diagramId, r) => {
    const diagram = (after.diagrams || []).find(d => d.id === diagramId);
    const tables = (diagram?.canvasData?.cells || []).filter(c => c.shape === 'table')
      .map(c => ids[c.originKey] || c.originKey);
    return tables.includes(r.parent) && tables.includes(r.child);
  };
  const have = new Set();
  readReferences(ctx).forEach((r) => {
    const keys = r.joins.map(join => keyOf(r, join));
    const lines = keys.map(k => now.get(k)).filter(l => l);
    const old = keys.map(k => was.get(k)).filter(l => l);
    if (lines.length === 0 && old.some(l => l.diagrams.some(id => shows(id, r)))) {
      remove(ctx, r.el);
      return;
    }
    keys.forEach(k => have.add(k));
    if (lines.length > 0 && cardinalityOf(lines[0].relation.rows) !== cardinalityOf(rowsOf(r.cardinality))) {
      setAttribute(ctx, r.el, 'a:Cardinality', cardinalityOf(lines[0].relation.rows));
    }
    [['updateRule', 'a:UpdateConstraint'], ['deleteRule', 'a:DeleteConstraint']].forEach(([key, tag]) => {
      const wanted = lines.length > 0 ? lines[0].relation[key] : undefined;
      if (RULES.includes(`${wanted}`) && `${wanted}` !== `${r[key]}`) {
        setAttribute(ctx, r.el, tag, `${wanted}`);
      }
    });
  });
  const fresh = [...now.keys()].filter(k => !have.has(k)).map(k => now.get(k));
  grouped(ctx, fresh).forEach((group) => {
    const r = group[0].relation;
    const parent = find(ctx, r.parent, 'o:Table');
    const childTable = find(ctx, r.child, 'o:Table');
    const pk = parent && primaryKey(ctx, parent);
    const joins = group.map(line => ({
      parentColumn: find(ctx, line.relation.parentField, 'o:Column'),
      childColumn: find(ctx, line.relation.childField, 'o:Column'),
    }));
    if (pk && childTable && joins.every(j => j.parentColumn && j.childColumn
      && pk.columns.includes(j.parentColumn.attrs.Id))) {
      const reference = create(ctx, {
        parent, child: childTable, key: pk.key, joins, rows: r.rows, updateRule: r.updateRule, deleteRule: r.deleteRule,
      });
      [...new Set(group.reduce((all, line) => all.concat(line.diagrams), []))]
        .forEach(id => addSymbol(ctx, id, reference, parent, childTable));
    }
  });
};
