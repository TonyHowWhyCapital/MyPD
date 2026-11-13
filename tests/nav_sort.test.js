import { sortNav, nextNavSort } from '../src/lib/nav_sort';

const tables = keys => keys.map(([defKey, defName]) => ({ id: defKey, defKey, defName, type: 'entity' }));
const menus = [{
  type: 'groups',
  defKey: 'g',
  children: [
    { type: 'entities', defKey: 'entities', children: tables([['T10', 'b'], ['t2', 'c'], ['T1', 'a']]) },
    { type: 'diagrams', defKey: 'diagrams', children: [] },
  ],
}];
const keys = list => list[0].children[0].children.map(e => e.defKey);

test('the stored order is shown when no order is chosen', () => {
  expect(sortNav(menus, '')).toBe(menus);
});

test('by code, numbers inside a code count as numbers and case does not matter', () => {
  expect(keys(sortNav(menus, 'key'))).toEqual(['T1', 't2', 'T10']);
});

test('by name', () => {
  expect(keys(sortNav(menus, 'name'))).toEqual(['T1', 'T10', 't2']);
});

test('the project keeps its own order', () => {
  sortNav(menus, 'key');
  expect(keys(menus)).toEqual(['T10', 't2', 'T1']);
});

test('the choices follow one another and start over', () => {
  expect(nextNavSort('')).toBe('key');
  expect(nextNavSort('key')).toBe('name');
  expect(nextNavSort('name')).toBe('');
});
