// Adds what a PDM file holds to an open project: the chosen tables, the domains and data
// types they rest on, their references and the diagrams they appear in.
// `imported` is the file read on top of the project (pdmToDataSource(xml, dataSource)),
// so the data types it names are already the project's own wherever they match.

const sameKey = (a, b) => `${a || ''}`.toLowerCase() === `${b || ''}`.toLowerCase();
const blank = v => (v === undefined || v === null ? '' : `${v}`);
const sameDomain = (a, b) => a.applyFor === b.applyFor && blank(a.len) === blank(b.len)
  && blank(a.scale) === blank(b.scale);
const match = (list, item) => (list || []).find(o => o.id === item.id)
  || (list || []).find(o => sameKey(o.defKey, item.defKey));

// A type the project did not know is only filled in for the database of the file. The
// project shows its own default database, so that one gets the same type.
const mergeMappings = (dataSource, imported) => {
  const known = dataSource.dataTypeMapping?.mappings || [];
  const db = dataSource.profile?.default?.db;
  return (imported.dataTypeMapping?.mappings || []).map((m) => {
    return known.some(k => k.id === m.id) || !db || m[db] ? m : { ...m, [db]: m.defKey };
  });
};

// A domain the project already has under the same code is used as it is. When the two
// differ the columns keep their own type instead of silently taking the project's.
const mergeDomains = (dataSource, imported) => {
  const domains = [...(dataSource.domains || [])];
  const ids = {};
  (imported.domains || []).forEach((d) => {
    const at = domains.findIndex(o => o.id === d.id);
    const twin = at < 0 && domains.find(o => sameKey(o.defKey, d.defKey));
    if (at >= 0) {
      domains[at] = { ...domains[at], ...d };
      ids[d.id] = d.id;
    } else if (twin) {
      ids[d.id] = sameDomain(twin, d) ? twin.id : '';
    } else {
      domains.push(d);
      ids[d.id] = d.id;
    }
  });
  return { domains, ids };
};

// Tables and columns the project already has keep their ids, so whatever points at them
// still does after the import.
const idsOf = (dataSource, imported) => {
  const entity = {};
  const field = {};
  (imported.entities || []).forEach((e) => {
    const old = match(dataSource.entities, e);
    entity[e.id] = old ? old.id : e.id;
    (e.fields || []).forEach((f) => {
      const oldField = old && match(old.fields, f);
      field[f.id] = oldField ? oldField.id : f.id;
    });
  });
  return { entity, field };
};

const port = (value, ids) => {
  const [id, side] = `${value || ''}`.split('%');
  return side ? `${ids.field[id] || id}%${side}` : value;
};

const mergeDiagrams = (dataSource, imported, ids, present) => {
  const diagrams = [...(dataSource.diagrams || [])];
  const added = [];
  (imported.diagrams || []).forEach((d) => {
    const cells = d.canvasData?.cells || [];
    const nodes = cells.filter(c => c.shape === 'table' && present.has(ids.entity[c.originKey]))
      .map(c => ({ ...c, originKey: ids.entity[c.originKey] }));
    if (nodes.length === 0) {
      return;
    }
    const kept = new Set(nodes.map(n => n.id));
    const edges = cells.filter(c => c.source && kept.has(c.source.cell) && kept.has(c.target.cell))
      .map(c => ({
        ...c,
        source: { ...c.source, port: port(c.source.port, ids) },
        target: { ...c.target, port: port(c.target.port, ids) },
      }));
    const diagram = { ...d, canvasData: { ...d.canvasData, cells: nodes.concat(edges) } };
    const at = diagrams.findIndex(o => o.id === d.id);
    if (at >= 0) {
      diagrams[at] = diagram;
    } else {
      let defKey = d.defKey;
      for (let n = 1; diagrams.some(o => sameKey(o.defKey, defKey)); n += 1) {
        defKey = `${d.defKey}_${n}`;
      }
      diagrams.push({ ...diagram, defKey });
    }
    added.push({ id: d.id, tables: nodes.map(n => n.originKey) });
  });
  return { diagrams, added };
};

// `groupOf` says which group each chosen table goes to ('' for none), `newGroups` are
// the groups made while choosing. A diagram joins the group most of its tables are in.
const mergeGroups = (dataSource, newGroups, chosen, groupOf, added) => {
  const moved = new Set(chosen.map(e => e.id));
  const groups = (dataSource.viewGroups || []).concat(newGroups).map(g => ({
    ...g,
    refEntities: (g.refEntities || []).filter(id => !moved.has(id)),
    refDiagrams: [...(g.refDiagrams || [])],
  }));
  chosen.forEach((e) => {
    const group = groups.find(g => g.id === groupOf[e.id]);
    group && group.refEntities.push(e.id);
  });
  added.filter(d => !groups.some(g => g.refDiagrams.includes(d.id))).forEach((d) => {
    const count = g => d.tables.filter(id => g.refEntities.includes(id)).length;
    const best = groups.reduce((a, g) => (count(g) > (a ? count(a) : 0) ? g : a), null);
    best && best.refDiagrams.push(d.id);
  });
  return groups;
};

export const mergePdm = (dataSource, imported, { entityIds, groupOf = {}, newGroups = [] } = {}) => {
  const ids = idsOf(dataSource, imported);
  const { domains, ids: domainIds } = mergeDomains(dataSource, imported);
  const picked = (imported.entities || []).filter(e => !entityIds || entityIds.includes(e.id));
  const present = new Set((dataSource.entities || []).map(e => e.id)
    .concat(picked.map(e => ids.entity[e.id])));
  const chosen = picked.map(e => ({
    ...e,
    id: ids.entity[e.id],
    fields: (e.fields || []).map(f => ({
      ...f,
      id: ids.field[f.id],
      domain: f.domain ? (domainIds[f.domain] || '') : '',
    })),
    indexes: (e.indexes || []).map(i => ({
      ...i,
      fields: (i.fields || []).map(f => ({ ...f, fieldDefKey: ids.field[f.fieldDefKey] || f.fieldDefKey })),
    })),
    correlations: (e.correlations || []).filter(c => present.has(ids.entity[c.refEntity])).map(c => ({
      ...c,
      myField: ids.field[c.myField] || c.myField,
      refEntity: ids.entity[c.refEntity],
      refField: ids.field[c.refField] || c.refField,
    })),
  }));
  const entities = (dataSource.entities || []).map(e => chosen.find(c => c.id === e.id) || e)
    .concat(chosen.filter(c => !(dataSource.entities || []).some(e => e.id === c.id)));
  const { diagrams, added } = mergeDiagrams(dataSource, imported, ids, present);
  const chosenGroups = Object.keys(groupOf)
    .reduce((map, id) => ({ ...map, [ids.entity[id] || id]: groupOf[id] }), {});
  return {
    ...dataSource,
    entities,
    domains,
    dataTypeMapping: { ...dataSource.dataTypeMapping, mappings: mergeMappings(dataSource, imported) },
    diagrams,
    viewGroups: mergeGroups(dataSource, newGroups, chosen, chosenGroups, added),
  };
};
