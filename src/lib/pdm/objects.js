import { value, insert } from './xml';
import { collect } from './read';
import {
  MODEL_ORDER, find, createObject, ensureCollection, setAttribute, remove, syncProps, namedSpecs,
} from './edit';
import { getDbObjectDDL } from '../dbobject_util';

// Procedures, functions and views of the file are kept with the database objects of the
// project. A procedure is its whole statement, a view the query it selects.
const KINDS = {
  procedure: { tag: 'o:Procedure', collection: 'c:Procedures' },
  view: { tag: 'o:View', collection: 'c:Views' },
};

// The file writes a statement with placeholders the modeling tool fills in on generation.
const filled = (definition, code) => definition
  .replace(/\[%QUALIFIER%\]|%QUALIFIER%/g, '')
  .replace(/%FUNC%|%PROC%/g, code)
  .replace(/\[%PROCPRMS%\]|%PROCPRMS%/g, '');

const named = (el, type) => ({
  id: value(el, 'a:ObjectID'),
  type,
  defKey: value(el, 'a:Code'),
  defName: value(el, 'a:Name'),
  comment: value(el, 'a:Comment'),
  refEntity: '',
});

export const readObjects = (doc) => {
  const procedures = collect(doc, KINDS.procedure.collection, KINDS.procedure.tag).map(el => ({
    ...named(el, 'procedure'),
    props: { kind: value(el, 'a:BaseProcedure.Function') === '1' ? 'FUNCTION' : 'PROCEDURE', params: [], returns: '' },
    body: '',
    customDDL: filled(value(el, 'a:Definition'), value(el, 'a:Code')),
  }));
  const views = collect(doc, KINDS.view.collection, KINDS.view.tag).map(el => ({
    ...named(el, 'view'),
    props: {},
    body: value(el, 'a:View.SQLQuery'),
    customDDL: '',
  }));
  return procedures.concat(views);
};

const statement = (object, dataSource, dbId) => {
  return `${object.customDDL || ''}`.trim() || getDbObjectDDL(object, dataSource, dbId);
};

// `forget` says the project has read these objects from the file, so one that is no
// longer in the project was deleted there. An older project never knew them.
export const syncObjects = (ctx, before, after, dbId, forget) => {
  const mine = (after.dbObjects || []).filter(o => KINDS[o.type]);
  const had = before.dbObjects || [];
  if (forget) {
    had.filter(o => !mine.some(m => m.id === o.id)).forEach((o) => {
      const el = find(ctx, o.id, KINDS[o.type].tag);
      el && remove(ctx, el);
    });
  }
  mine.forEach((object) => {
    const { tag, collection } = KINDS[object.type];
    const old = had.find(o => o.id === object.id);
    let el = old && find(ctx, object.id, tag);
    if (!el) {
      el = createObject(ctx, tag, object.id);
      insert(ensureCollection(ctx, ctx.model, collection, MODEL_ORDER), [el], null, ctx.eol);
      // eslint-disable-next-line no-param-reassign
      object.id = value(el, 'a:ObjectID');
    }
    syncProps(ctx, el, el && old, object, namedSpecs);
    if (object.type === 'view') {
      if (!old || old.body !== object.body) {
        setAttribute(ctx, el, 'a:View.SQLQuery', `${object.body || ''}`);
        // the copy the modeling tool keeps of the query with its own marks is now stale
        setAttribute(ctx, el, 'a:TaggedSQLQuery', '');
      }
      return;
    }
    if (!old || statement(old, before, dbId) !== statement(object, after, dbId)) {
      setAttribute(ctx, el, 'a:Definition', statement(object, after, dbId));
    }
    if (!old || old.props?.kind !== object.props?.kind) {
      setAttribute(ctx, el, 'a:BaseProcedure.Function', object.props?.kind === 'FUNCTION' ? '1' : '');
    }
  });
};
