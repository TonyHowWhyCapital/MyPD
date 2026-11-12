import '../Math';
import {
  elements, child, value, walk, fragment, insert, detach, setText, isAttached, encode,
} from './xml';
import { openPdm } from './read';

// The tools for changing a PDM file in place: finding an object, making one, setting an
// attribute and taking an object out together with whatever pointed at it.
export const MODEL_ORDER = ['c:DBMS', 'c:PhysicalDiagrams', 'c:DefaultDiagram', 'c:Domains', 'c:Tables',
  'c:References', 'c:DefaultGroups', 'c:TargetModels'];
// A reference to a deleted object inside one of these makes its owner meaningless.
const OWNER_DIES_WITH_REF = new Set(['c:Object', 'c:ParentTable', 'c:ChildTable', 'c:ParentKey',
  'c:Object1', 'c:Object2', 'c:SourceSymbol', 'c:DestinationSymbol', 'c:Column']);
const OWNER_DIES_WHEN_EMPTY = new Set(['c:Joins', 'c:IndexColumns', 'c:Key.Columns']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export const norm = v => (v === undefined || v === null || v === false ? '' : `${v}`);

export const createContext = (xml, options) => {
  const doc = openPdm(xml);
  const objects = new Map();
  let maxId = 0;
  doc.byId.forEach((el, id) => {
    maxId = Math.max(maxId, parseInt(id.slice(1), 10) || 0);
    const objectId = value(el, 'a:ObjectID');
    if (objectId) {
      objects.set(objectId.toUpperCase(), el);
    }
  });
  return {
    ...doc,
    objects,
    removed: new Set(),
    nextId: () => {
      maxId += 1;
      return `o${maxId}`;
    },
    now: options.now || Math.floor(Date.now() / 1000),
    user: options.user || 'MyPD',
  };
};

export const find = (ctx, id, tag) => {
  const el = ctx.objects.get(norm(id).toUpperCase());
  return el && el.tag === tag && isAttached(el) ? el : undefined;
};

export const build = (ctx, lines) => {
  const nodes = fragment(lines.join(ctx.eol));
  nodes.filter(n => n.type === 'el').forEach(n => walk(n, (el) => {
    if (el.attrs.Id) {
      ctx.byId.set(el.attrs.Id, el);
    } else if (el.attrs.Ref) {
      ctx.refs.push(el);
    }
  }));
  return nodes;
};

export const createObject = (ctx, tag, id, withName = true) => {
  const wanted = norm(id).toUpperCase();
  const objectId = GUID.test(wanted) && !ctx.objects.has(wanted) ? wanted : Math.uuid().toUpperCase();
  const el = build(ctx, [
    `<${tag} Id="${ctx.nextId()}">`,
    `<a:ObjectID>${objectId}</a:ObjectID>`,
    ...(withName ? ['<a:Name></a:Name>', '<a:Code></a:Code>'] : []),
    `<a:CreationDate>${ctx.now}</a:CreationDate>`,
    `<a:Creator>${encode(ctx.user)}</a:Creator>`,
    `<a:ModificationDate>${ctx.now}</a:ModificationDate>`,
    `<a:Modifier>${encode(ctx.user)}</a:Modifier>`,
    `</${tag}>`,
  ])[0];
  ctx.objects.set(objectId, el);
  return el;
};

export const ensureCollection = (ctx, owner, tag, order) => {
  const existing = child(owner, tag);
  if (existing) {
    return existing;
  }
  const later = order.slice(order.indexOf(tag) + 1);
  const before = elements(owner).find(e => later.includes(e.tag));
  const nodes = build(ctx, [`<${tag}>`, `</${tag}>`]);
  insert(owner, nodes, before, ctx.eol);
  return nodes[0];
};

export const setAttribute = (ctx, el, tag, content) => {
  const existing = child(el, tag);
  if (content === '') {
    if (existing) {
      detach(existing);
    }
  } else if (existing) {
    setText(existing, content.replace(/\r?\n/g, ctx.eol));
  } else {
    const firstCollection = elements(el).find(e => e.tag.startsWith('c:'));
    const nodes = build(ctx, [`<${tag}></${tag}>`]);
    setText(nodes[0], content.replace(/\r?\n/g, ctx.eol));
    insert(el, nodes, firstCollection, ctx.eol);
  }
};

export const remove = (ctx, el) => {
  walk(el, (e) => {
    if (e.attrs.Id) {
      ctx.removed.add(e.attrs.Id);
    }
  });
  const collection = el.parent;
  detach(el);
  if (collection.tag.startsWith('c:') && elements(collection).length === 0) {
    const owner = collection.parent;
    detach(collection);
    if (OWNER_DIES_WHEN_EMPTY.has(collection.tag)) {
      remove(ctx, owner);
    }
  }
};

// Deleting a table or column leaves keys, references, indexes and diagram
// symbols pointing at it. Repeat until nothing points at a deleted object.
export const sweepDanglingRefs = (ctx) => {
  let dangling;
  do {
    dangling = ctx.refs.filter(r => ctx.removed.has(r.attrs.Ref) && isAttached(r));
    dangling.filter(r => isAttached(r)).forEach((r) => {
      remove(ctx, OWNER_DIES_WITH_REF.has(r.parent.tag) ? r.parent.parent : r);
    });
  } while (dangling.length);
};
