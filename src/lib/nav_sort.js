// The order the model tree shows its tables, views, diagrams and dictionaries in. Only what
// is shown changes: the order kept in the project stays as it is.
export const NAV_SORTS = ['', 'key', 'name'];

export const NAV_LISTS = ['entities', 'logicEntities', 'views', 'diagrams', 'dicts'];
// the list each kind of row belongs to
export const NAV_LIST_OF = {
  entity: 'entities', logicEntity: 'logicEntities', view: 'views', diagram: 'diagrams', dict: 'dicts',
};

const textOf = (node, by) => `${(by === 'name' && node.defName) || node.defKey || ''}`;

// `sorts` names an order for each list, e.g. { entities: 'key' }; a list without one keeps
// the order of the project.
export const sortNav = (menus, sorts) => {
  if (!NAV_LISTS.some(list => sorts && sorts[list])) {
    return menus;
  }
  const compare = by => (a, b) => textOf(a, by)
    .localeCompare(textOf(b, by), undefined, { numeric: true, sensitivity: 'base' });
  const walk = (node) => {
    if (!node.children) {
      return node;
    }
    if (!NAV_LISTS.includes(node.type)) {
      return { ...node, children: node.children.map(walk) };
    }
    return sorts[node.type] ? { ...node, children: [...node.children].sort(compare(sorts[node.type])) } : node;
  };
  return (menus || []).map(walk);
};

// What was kept on the machine, made safe to use; one order for every list is the older form.
export const readNavSorts = (kept) => {
  if (typeof kept === 'string') {
    return NAV_SORTS.includes(kept) && kept ? NAV_LISTS.reduce((all, list) => ({ ...all, [list]: kept }), {}) : {};
  }
  return NAV_LISTS.reduce((all, list) => {
    const by = kept && kept[list];
    return NAV_SORTS.includes(by) && by ? { ...all, [list]: by } : all;
  }, {});
};

export const nextNavSort = by => NAV_SORTS[(NAV_SORTS.indexOf(by) + 1) % NAV_SORTS.length];
