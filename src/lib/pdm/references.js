import '../Math';
import { elements, child, value, insert, encode } from './xml';
import { readReferences, refTarget } from './read';
import {
  MODEL_ORDER, find, build, ensureCollection, remove,
} from './edit';

// Writing gives new tables and columns the ids of the file. The references of the project
// still name them by the ids they had before, so those are remembered first.
export const originIds = dataSource => (dataSource.entities || []).map(e => ({
  ids: [e.id, e.sourceId],
  fields: (e.fields || []).map(f => [f.id, f.sourceId]),
}));

const finalIds = (dataSource, origin) => {
  const map = {};
  (dataSource.entities || []).forEach((e, i) => {
    origin[i].ids.concat(e.id).filter(id => id).forEach((id) => { map[id] = e.id; });
    (e.fields || []).forEach((f, n) => {
      (origin[i].fields[n] || []).concat(f.id).filter(id => id).forEach((id) => { map[id] = f.id; });
    });
  });
  return map;
};

const keyOf = r => [r.child, r.childField, r.parent, r.parentField].join('|').toUpperCase();

// A reference hangs on a key of the parent table, here its primary key.
const parentKey = (ctx, table, column) => {
  const key = refTarget(ctx, table, 'c:PrimaryKey');
  const columns = elements(child(key, 'c:Key.Columns')).map(c => c.attrs.Ref || c.attrs.Id);
  return key && columns.includes(column.attrs.Id) ? key : null;
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

// The same shape the modeling tool writes: many rows of the child for one of the parent,
// changes and deletions of the parent restricted.
const create = (ctx, { parent, child: childTable, parentColumn, childColumn, key }) => {
  const name = freeName(ctx);
  const nodes = build(ctx, [
    `<o:Reference Id="${ctx.nextId()}">`,
    `<a:ObjectID>${Math.uuid().toUpperCase()}</a:ObjectID>`,
    `<a:Name>${name}</a:Name>`,
    `<a:Code>${name}</a:Code>`,
    ...stamp(ctx),
    '<a:Cardinality>0..*</a:Cardinality>',
    '<a:UpdateConstraint>1</a:UpdateConstraint>',
    '<a:DeleteConstraint>1</a:DeleteConstraint>',
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
    `<o:ReferenceJoin Id="${ctx.nextId()}">`,
    `<a:ObjectID>${Math.uuid().toUpperCase()}</a:ObjectID>`,
    ...stamp(ctx),
    '<c:Object1>',
    `<o:Column Ref="${parentColumn.attrs.Id}"/>`,
    '</c:Object1>',
    '<c:Object2>',
    `<o:Column Ref="${childColumn.attrs.Id}"/>`,
    '</c:Object2>',
    '</o:ReferenceJoin>',
    '</c:Joins>',
    '</o:Reference>',
  ]);
  insert(ensureCollection(ctx, ctx.model, 'c:References', MODEL_ORDER), nodes, null, ctx.eol);
  return nodes[0];
};

const MANY = ['n', '0,n', '1,n'];

// Which end of a drawn line is the parent: the one that is not "many".
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
  const [parent, many] = MANY.includes(from) ? [target, source] : [source, target];
  const id = v => ids[v] || v;
  return {
    parent: id(parent.table), parentField: id(parent.field), child: id(many.table), childField: id(many.field),
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

// Brings the references of the file in line with the lines drawn in the diagrams of the
// project. A reference goes only when its line was taken out of a diagram that is still
// there, so one the file holds without a line, or of a diagram not in the project, stays.
export const syncReferences = (ctx, before, after, origin) => {
  const now = drawn(after, finalIds(after, origin));
  const was = drawn(before);
  const kept = id => (after.diagrams || []).some(d => d.id === id);
  const existing = readReferences(ctx);
  existing.forEach((r) => {
    const old = was.get(keyOf(r));
    if (old && !now.has(keyOf(r)) && old.diagrams.some(kept)) {
      remove(ctx, r.el);
    }
  });
  const have = new Set(existing.map(keyOf));
  now.forEach(({ relation: r, diagrams }, key) => {
    if (have.has(key)) {
      return;
    }
    const parent = find(ctx, r.parent, 'o:Table');
    const childTable = find(ctx, r.child, 'o:Table');
    const parentColumn = find(ctx, r.parentField, 'o:Column');
    const childColumn = find(ctx, r.childField, 'o:Column');
    const pk = parent && parentColumn && parentKey(ctx, parent, parentColumn);
    if (pk && childTable && childColumn) {
      const reference = create(ctx, { parent, child: childTable, parentColumn, childColumn, key: pk });
      diagrams.forEach(id => addSymbol(ctx, id, reference, parent, childTable));
    }
  });
};
