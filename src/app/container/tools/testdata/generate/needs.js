// What has to be read before rows can be made: the lists of `file` rules, the results of
// `query` rules and the existing keys of parent tables that are not generated. Everything
// read is kept, so a preview that runs again after a keystroke reads nothing twice; an
// error is kept as well until the user asks to read again.
import { resolveRule } from '../../../../../lib/testdata/columns';

export const NO_CONNECTION = 'NO_CONNECTION';
export const PARENT_EMPTY = 'PARENT_EMPTY';

const entityOf = (dataSource, id) => ((dataSource && dataSource.entities) || [])
  .find(e => e.id === id);
const fieldOf = (entity, id) => ((entity && entity.fields) || []).find(f => f.id === id);

// {path: {column, header}} of the file rules the planned tables use
const fileParams = (dataSource, plan) => {
  const found = {};
  plan.tables.forEach((table) => {
    const entity = entityOf(dataSource, table.entityId);
    table.columns.forEach((column) => {
      const field = fieldOf(entity, column.id);
      const { rule } = field ? resolveRule(dataSource, entity, field) : {};
      const p = (rule && rule.params) || {};
      if (rule && rule.kind === 'file' && p.path && !found[p.path]) {
        found[p.path] = {
          column: p.column,
          header: !!p.header,
        };
      }
    });
  });
  return found;
};

// Parent keys read from the database, per parent table. The columns of a composite key
// are read together so that they come from the same row; a parent some child points at
// with a composite key is read in one go for all its columns.
const parentRequests = (dataSource, plan, connKey) => {
  const parents = [];
  plan.tables.forEach((table) => {
    const groups = {};
    (table.foreignKeys || []).filter(k => k.source === 'database').forEach((k) => {
      groups[k.group] = (groups[k.group] || []).concat(k);
    });
    Object.keys(groups).forEach((g) => {
      const keys = groups[g];
      let parent = parents.find(p => p.entityId === keys[0].refEntityId);
      if (!parent) {
        parent = {
          entityId: keys[0].refEntityId,
          fieldIds: [],
          composite: false,
        };
        parents.push(parent);
      }
      parent.composite = parent.composite || keys.length > 1;
      keys.forEach(k => !parent.fieldIds.includes(k.refFieldId)
        && parent.fieldIds.push(k.refFieldId));
    });
  });
  return parents.reduce((list, parent) => {
    const entity = entityOf(dataSource, parent.entityId);
    const table = entity ? entity.defKey : '';
    const columns = parent.fieldIds.map(id => (fieldOf(entity, id) || {}).defKey || '');
    const base = {
      entityId: parent.entityId,
      table,
      needsConnection: true,
    };
    if (parent.composite) {
      return list.concat({
        ...base,
        kind: 'keyRows',
        id: `keyRows|${connKey}|${table}|${columns.join(',')}`,
        fieldIds: parent.fieldIds,
        columns,
      });
    }
    return list.concat(parent.fieldIds.map((fieldId, i) => ({
      ...base,
      kind: 'keys',
      id: `keys|${connKey}|${table}|${columns[i]}`,
      fieldIds: [fieldId],
      columns: [columns[i]],
    })));
  }, []);
};

// everything the plan needs read, each with an id that changes when its source changes
export const requestsOf = (dataSource, plan, connKey = '') => {
  const needs = plan.needs || {};
  const params = fileParams(dataSource, plan);
  const files = (needs.files || []).map((path) => {
    const p = params[path] || {};
    return {
      kind: 'file',
      id: `file|${path}|${p.column === undefined ? 0 : p.column}|${p.header ? 1 : 0}`,
      path,
      params: p,
    };
  });
  const queries = (needs.queries || []).map(sql => ({
    kind: 'query',
    id: `query|${connKey}|${sql}`,
    sql,
    needsConnection: true,
  }));
  return files.concat(queries, parentRequests(dataSource, plan, connKey));
};

// io = { readFile(path, params), runQuery(sql), readKeys(table, column),
//        readKeyRows(table, columns) } each -> Promise; hasConnection() -> bool
export const createLoader = (io) => {
  const kept = new Map();   // id -> {values} | {error}
  const pending = new Map();
  // a parent table without rows cannot give its children anything to point at
  const filled = request => (values) => {
    if (!Array.isArray(values) || values.length === 0) {
      const error = new Error(`No rows in ${request.table}`);
      error.code = PARENT_EMPTY;
      error.table = request.table;
      throw error;
    }
    return values;
  };
  const read = (request) => {
    if (request.needsConnection && !io.hasConnection()) {
      const error = new Error('No database connection');
      error.code = NO_CONNECTION;
      return Promise.reject(error);
    }
    switch (request.kind) {
      case 'file': return io.readFile(request.path, request.params);
      case 'query': return io.runQuery(request.sql);
      case 'keys': return io.readKeys(request.table, request.columns[0]).then(filled(request));
      default: return io.readKeyRows(request.table, request.columns).then(filled(request));
    }
  };
  const one = (request) => {
    if (kept.has(request.id)) {
      return Promise.resolve(kept.get(request.id));
    }
    if (!pending.has(request.id)) {
      // a failure to start is an answer like any other
      const started = new Promise(resolve => resolve(read(request)));
      pending.set(request.id, started.then(values => ({ values: values || [] }),
        error => ({ error })).then((answer) => {
        pending.delete(request.id);
        // without a connection nothing was tried: ask again once there is one
        if (!(answer.error && answer.error.code === NO_CONNECTION)) {
          kept.set(request.id, answer);
        }
        return answer;
      }));
    }
    return pending.get(request.id);
  };
  return {
    // -> { lists: {file, query}, parentKeys, errors: [{request, error}] }
    load: async (requests) => {
      const answers = await Promise.all(requests.map(one));
      const out = {
        lists: {
          file: {},
          query: {},
        },
        parentKeys: {},
        errors: [],
      };
      requests.forEach((request, i) => {
        const { values, error } = answers[i];
        if (error) {
          out.errors.push({
            request,
            error,
          });
        } else if (request.kind === 'file') {
          out.lists.file[request.path] = values;
        } else if (request.kind === 'query') {
          out.lists.query[request.sql] = values;
        } else {
          const byField = out.parentKeys[request.entityId] || {};
          request.fieldIds.forEach((fieldId, at) => {
            byField[fieldId] = request.kind === 'keys' ? values : values.map(row => row[at]);
          });
          out.parentKeys[request.entityId] = byField;
        }
      });
      return out;
    },
    // forget what was read (all of it, or only the failures)
    clear: (onlyErrors) => {
      Array.from(kept.keys()).forEach((id) => {
        if (!onlyErrors || kept.get(id).error) {
          kept.delete(id);
        }
      });
    },
    isLoaded: requests => requests.every(r => kept.has(r.id)),
  };
};
