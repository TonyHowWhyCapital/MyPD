// The order the model tree shows its tables, views, diagrams and dictionaries in. Only what
// is shown changes: the order kept in the project stays as it is.
export const NAV_SORTS = ['', 'key', 'name'];

const LISTS = ['entities', 'logicEntities', 'views', 'diagrams', 'dicts'];

const textOf = (node, by) => `${(by === 'name' && node.defName) || node.defKey || ''}`;

export const sortNav = (menus, by) => {
  if (!by) {
    return menus;
  }
  const compare = (a, b) => textOf(a, by).localeCompare(textOf(b, by), undefined, { numeric: true, sensitivity: 'base' });
  const walk = (node) => {
    if (!node.children) {
      return node;
    }
    return {
      ...node,
      children: LISTS.includes(node.type) ? [...node.children].sort(compare) : node.children.map(walk),
    };
  };
  return (menus || []).map(walk);
};

export const nextNavSort = by => NAV_SORTS[(NAV_SORTS.indexOf(by) + 1) % NAV_SORTS.length];
