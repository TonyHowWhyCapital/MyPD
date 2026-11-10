import './Math';

export const ACTION_TYPES = ['deleteEntity', 'deleteField', 'changeFieldType'];
const SEP = '%';

const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
const formatTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const item = (objectType, obj, reason, severity, detail, parentDefKey = '') => ({
  objectType,
  objectId: obj.id || '',
  objectDefKey: obj.defKey || '',
  objectDefName: obj.defName || '',
  parentDefKey,
  reason,
  severity,
  detail,
});

const portField = (end) => {
  const raw = (end && (end.portOrigin || end.port)) || '';
  return raw.split(SEP)[0];
};

const getDiagramNodes = (ds, entityId) => (ds.diagrams || []).map((d) => ({
  diagram: d,
  cells: d.canvasData?.cells || [],
})).map(({ diagram, cells }) => ({
  diagram,
  nodes: cells.filter(c => c.shape === 'table' && c.originKey === entityId),
  edges: cells.filter(c => c.source && c.target),
}));

const isField = (ctx) => ctx.action.type !== 'deleteEntity';

// Each collector returns items for one kind of relationship. Add a kind by adding an entry.
export const collectors = [
  {
    reason: 'fkReference',
    collect: ({ ds, action, entity, field }) => {
      const result = [];
      (ds.entities || []).filter(e => e.id !== entity.id).forEach((e) => {
        (e.correlations || []).filter(c => c.refEntity === entity.id
          && (action.type === 'deleteEntity' || c.refField === field.id)).forEach((c) => {
          const myField = (e.fields || []).find(f => f.id === c.myField);
          let severity = 'break';
          let detail = action.type === 'deleteEntity' ? 'references the deleted table' : 'references the field';
          if (action.type === 'changeFieldType') {
            severity = 'change';
            detail = `type ${myField?.type || ''} may mismatch ${action.after.type}`;
          }
          result.push(myField
            ? item('field', myField, 'fkReference', severity, detail, e.defKey)
            : item('entity', e, 'fkReference', severity, detail));
        });
      });
      return result;
    },
  },
  {
    reason: 'ownCorrelation',
    collect: ({ ds, action, entity, field }) => (entity.correlations || [])
      .filter(c => action.type === 'deleteEntity' || c.myField === field.id)
      .map((c) => {
        const ref = (ds.entities || []).find(e => e.id === c.refEntity);
        return item('entity', ref || { id: c.refEntity }, 'ownCorrelation',
          action.type === 'deleteEntity' ? 'info' : 'break',
          'relationship owned by this table is removed', entity.defKey);
      }),
  },
  {
    reason: 'viewReference',
    collect: ({ ds, action, entity }) => (ds.views || [])
      .filter(v => action.type === 'deleteEntity' && (v.refEntities || []).includes(entity.id))
      .map(v => item('view', v, 'viewReference', 'change', 'view references the deleted table')),
  },
  {
    reason: 'viewFieldReference',
    collect: ({ ds, action, entity, field }) => {
      const result = [];
      (ds.views || []).forEach((v) => {
        (v.fields || []).forEach((vf) => {
          if (vf.refEntity !== entity.id) return;
          if (action.type === 'deleteEntity') {
            result.push(item('viewField', vf, 'viewReference', 'change', 'source table is deleted', v.defKey));
          } else if (vf.refEntityField === field.id) {
            result.push(item('viewField', vf, 'viewReference',
              action.type === 'deleteField' ? 'break' : 'change',
              action.type === 'deleteField' ? 'source field is deleted' : 'derived type changes', v.defKey));
          }
        });
      });
      return result;
    },
  },
  {
    reason: 'indexMember',
    collect: ({ action, entity, field }) => (entity.indexes || [])
      .filter(i => action.type === 'deleteEntity' || (i.fields || []).some(f => f.fieldDefKey === field.id))
      .map(i => item('index', i, 'indexMember',
        action.type === 'deleteEntity' ? 'info' : 'change',
        action.type === 'deleteEntity' ? 'index is dropped with the table' : 'field is a member of this index', entity.defKey)),
  },
  {
    reason: 'diagramNode',
    collect: ({ ds, action, entity }) => getDiagramNodes(ds, entity.id)
      .filter(g => action.type === 'deleteEntity' && g.nodes.length)
      .map(g => item('diagram', g.diagram, 'diagramNode', 'change', 'diagram contains this table')),
  },
  {
    reason: 'diagramEdge',
    collect: ({ ds, action, entity, field }) => {
      const result = [];
      getDiagramNodes(ds, entity.id).forEach(({ diagram, nodes, edges }) => {
        const ids = nodes.map(n => n.id);
        edges.forEach((e) => {
          const ends = [e.source, e.target].filter(end => ids.includes(end.cell));
          if (!ends.length) return;
          if (action.type === 'deleteEntity'
            || (action.type === 'deleteField' && ends.some(end => portField(end) === field.id))) {
            result.push(item('diagram', { id: e.id, defKey: diagram.defKey, defName: diagram.defName },
              'diagramEdge', 'change', 'relationship line is removed', diagram.defKey));
          }
        });
      });
      return result;
    },
  },
  {
    reason: 'groupMember',
    collect: ({ ds, action, entity }) => (ds.viewGroups || [])
      .filter(g => action.type === 'deleteEntity' && (g.refEntities || []).includes(entity.id))
      .map(g => item('group', g, 'groupMember', 'info', 'table is a member of this group')),
  },
  {
    reason: 'dbObjectReference',
    collect: ({ ds, action, entity }) => (ds.dbObjects || [])
      .filter(o => action.type === 'deleteEntity' && o.refEntity === entity.id)
      .map(o => item('dbObject', o, 'dbObjectReference', 'break', `${o.type || 'object'} depends on the deleted table`, entity.defKey)),
  },
  {
    reason: 'sameDomainField',
    collect: ({ ds, action, entity, field }) => {
      if (action.type !== 'changeFieldType' || !field.domain) return [];
      const result = [];
      (ds.entities || []).forEach((e) => {
        (e.fields || []).forEach((f) => {
          if (f.domain === field.domain && f.id !== field.id) {
            result.push(item('field', f, 'sameDomainField', 'info', 'shares the same domain', e.defKey));
          }
        });
      });
      return result;
    },
  },
];

const normalizeAction = (ds, action) => {
  if (!action || !ACTION_TYPES.includes(action.type)) {
    throw new Error(`Unknown impact action type: ${action && action.type}`);
  }
  const entity = (ds.entities || []).find(e => e.id === action.entityId);
  if (!entity) {
    throw new Error(`Entity not found: ${action.entityId}`);
  }
  const result = { type: action.type, entityId: entity.id, entityDefKey: entity.defKey };
  let field = null;
  if (isField({ action })) {
    field = (entity.fields || []).find(f => f.id === action.fieldId);
    if (!field) {
      throw new Error(`Field not found: ${action.fieldId}`);
    }
    result.fieldId = field.id;
    result.fieldDefKey = field.defKey;
  }
  if (action.type === 'changeFieldType') {
    if (!action.after || !action.after.type) {
      throw new Error('changeFieldType requires after.type');
    }
    result.before = { type: field.type, len: field.len, scale: field.scale };
    result.after = { type: action.after.type, len: action.after.len, scale: action.after.scale };
  }
  return { action: result, entity, field };
};

export const analyzeImpact = (dataSource, action) => {
  const { action: normalized, entity, field } = normalizeAction(dataSource, action);
  const ctx = { ds: dataSource, action: normalized, entity, field };
  const items = collectors.reduce((all, c) => all.concat(c.collect(ctx)), []);
  const summary = { total: items.length, bySeverity: { break: 0, change: 0, info: 0 }, byObjectType: {} };
  items.forEach((i) => {
    summary.bySeverity[i.severity] += 1;
    summary.byObjectType[i.objectType] = (summary.byObjectType[i.objectType] || 0) + 1;
  });
  return { action: normalized, items, summary };
};

export const getImpactModels = (dataSource) => dataSource?.impactAnalyses || [];

export const createImpactModel = (dataSource, action, { defName, note = '', now = new Date() } = {}) => {
  const result = analyzeImpact(dataSource, action);
  const a = result.action;
  const fallback = [a.type, a.entityDefKey, a.fieldDefKey].filter(Boolean).join(' ');
  return {
    id: Math.uuid(),
    defName: defName || fallback,
    note,
    createdTime: formatTime(now),
    action: a,
    items: result.items,
  };
};

export const saveImpactModel = (dataSource, model) => {
  const models = getImpactModels(dataSource);
  const exists = models.some(m => m.id === model.id);
  return {
    ...dataSource,
    impactAnalyses: exists ? models.map(m => (m.id === model.id ? model : m)) : models.concat(model),
  };
};

export const removeImpactModel = (dataSource, id) => ({
  ...dataSource,
  impactAnalyses: getImpactModels(dataSource).filter(m => m.id !== id),
});
