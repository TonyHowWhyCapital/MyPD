import { sortNav, nextNavSort, readNavSorts } from '../src/lib/nav_sort';

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
  expect(sortNav(menus, {})).toBe(menus);
});

test('by code, numbers inside a code count as numbers and case does not matter', () => {
  expect(keys(sortNav(menus, { entities: 'key' }))).toEqual(['T1', 't2', 'T10']);
});

test('by name', () => {
  expect(keys(sortNav(menus, { entities: 'name' }))).toEqual(['T1', 'T10', 't2']);
});

test('the project keeps its own order', () => {
  sortNav(menus, { entities: 'key' });
  expect(keys(menus)).toEqual(['T10', 't2', 'T1']);
});

test('the choices follow one another and start over', () => {
  expect(nextNavSort('')).toBe('key');
  expect(nextNavSort('key')).toBe('name');
  expect(nextNavSort('name')).toBe('');
});

test('each list has its own order', () => {
  const sorted = sortNav(menus, { diagrams: 'key' });
  expect(keys(sorted)).toEqual(['T10', 't2', 'T1']);
});

test('what was kept is read safely, one order for all being the older form', () => {
  expect(readNavSorts('key').views).toBe('key');
  expect(readNavSorts({ entities: 'name', views: 'bogus', other: 'key' })).toEqual({ entities: 'name' });
  expect(readNavSorts(undefined)).toEqual({});
});
