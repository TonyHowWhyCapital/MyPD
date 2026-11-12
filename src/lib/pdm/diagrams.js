import {
  elements, child, value, insert, setText,
} from './xml';
import { refTarget, CANVAS_SCALE } from './read';
import {
  MODEL_ORDER, find, build, createObject, ensureCollection, setAttribute, remove,
} from './edit';
import { numberOf } from './extras';

const WIDTH = 12000;
const heightFor = columns => 2200 + 420 * Math.max(columns, 1);

const rectOf = (symbol) => {
  const n = (value(symbol, 'a:Rect').match(/-?\d+/g) || []).map(Number);
  return n.length === 4 ? {
    left: Math.min(n[0], n[2]), right: Math.max(n[0], n[2]), bottom: Math.min(n[1], n[3]), top: Math.max(n[1], n[3]),
  } : null;
};
const rectText = r => `((${r.left},${r.bottom}), (${r.right},${r.top}))`;

// The project measures a diagram from its top left table, the file from its own origin
// with the y axis pointing up. This is the point of the file the project calls (0, 0).
const frameOf = (ctx, symbols) => {
  const rects = elements(symbols, 'o:TableSymbol')
    .filter(s => (refTarget(ctx, s, 'c:Object') || {}).tag === 'o:Table').map(rectOf).filter(r => r);
  return rects.length === 0 ? { x: 0, top: 0 } : {
    x: Math.min(...rects.map(r => r.left)),
    top: Math.max(...rects.map(r => r.top)),
  };
};

const placed = (frame, position, width, height) => {
  const left = frame.x + Math.round((position?.x || 0) * CANVAS_SCALE);
  const top = frame.top - Math.round((position?.y || 0) * CANVAS_SCALE);
  return { left, right: left + width, bottom: top - height, top };
};

const addTable = (ctx, symbols, table, rect, colour) => {
  insert(symbols, build(ctx, [
    `<o:TableSymbol Id="${ctx.nextId()}">`,
    `<a:CreationDate>${ctx.now}</a:CreationDate>`,
    `<a:ModificationDate>${ctx.now}</a:ModificationDate>`,
    `<a:Rect>${rectText(rect)}</a:Rect>`,
    ...(colour ? [`<a:FillColor>${colour}</a:FillColor>`] : []),
    '<c:Object>',
    `<o:Table Ref="${table.attrs.Id}"/>`,
    '</c:Object>',
    '</o:TableSymbol>',
  ]), null, ctx.eol);
};

const newDiagram = (ctx, diagram) => {
  const el = createObject(ctx, 'o:PhysicalDiagram', diagram.id);
  setAttribute(ctx, el, 'a:Name', `${diagram.defName || diagram.defKey || ''}`);
  setAttribute(ctx, el, 'a:Code', `${diagram.defKey || ''}`);
  insert(ensureCollection(ctx, ctx.model, 'c:PhysicalDiagrams', MODEL_ORDER), [el], null, ctx.eol);
  // eslint-disable-next-line no-param-reassign
  diagram.id = value(el, 'a:ObjectID');
  return el;
};

// Brings the tables shown in each diagram in line with the project: a table that was
// moved gets its new place, one put on the diagram gets a symbol, one taken off loses
// it. How a symbol looks and how large it is stays as the file has it. A diagram the
// project does not have is left alone.
export const syncDiagrams = (ctx, before, after, ids) => {
  (after.diagrams || []).forEach((diagram) => {
    const old = (before.diagrams || []).find(d => d.id === diagram.id);
    const tables = cells => (cells || []).filter(c => c.shape === 'table');
    const tableOf = node => find(ctx, ids[node.originKey] || node.originKey, 'o:Table');
    const known = find(ctx, diagram.id, 'o:PhysicalDiagram');
    // A diagram showing none of the tables written here has nothing to say in this file.
    if (!known && !tables(diagram.canvasData?.cells).some(tableOf)) {
      return;
    }
    const el = known || newDiagram(ctx, diagram);
    const symbols = ensureCollection(ctx, el, 'c:Symbols', ['c:Symbols']);
    const frame = frameOf(ctx, symbols);
    const oldNodes = tables(old?.canvasData?.cells);
    const symbolOf = node => elements(symbols, 'o:TableSymbol')
      .find(s => `${old.id}-${s.attrs.Id}` === node.id);
    const nodes = tables(diagram.canvasData?.cells);
    oldNodes.filter(o => !nodes.some(n => n.id === o.id)).forEach((o) => {
      const symbol = symbolOf(o);
      symbol && remove(ctx, symbol);
    });
    nodes.forEach((node) => {
      const was = oldNodes.find(o => o.id === node.id);
      const symbol = was && symbolOf(was);
      if (symbol) {
        const rect = rectOf(symbol);
        if (was.position.x !== node.position?.x || was.position.y !== node.position?.y) {
          setText(child(symbol, 'a:Rect'),
            rectText(placed(frame, node.position, rect.right - rect.left, rect.top - rect.bottom)));
        }
        if (node.fillColor && node.fillColor !== was.fillColor && numberOf(node.fillColor)) {
          setAttribute(ctx, symbol, 'a:FillColor', numberOf(node.fillColor));
        }
        return;
      }
      const table = tableOf(node);
      if (table) {
        const entity = (after.entities || []).find(e => e.id === (ids[node.originKey] || node.originKey));
        addTable(ctx, symbols, table, placed(frame, node.position,
          node.size?.width ? Math.round(node.size.width * CANVAS_SCALE) : WIDTH,
          node.size?.height ? Math.round(node.size.height * CANVAS_SCALE)
            : heightFor((entity?.fields || []).length)), numberOf(node.fillColor));
      }
    });
  });
};
