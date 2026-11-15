import { diagramCorrelations, mergeCorrelations, cellsOfDiagrams } from '../src/lib/correlations';
import shop from '../src/lib/template/电商商城.pdma.json';

const table = (id, entity) => ({id, shape: 'table', originKey: entity});
const line = (from, fromField, to, toField, relation = '1:n') => ({
  shape: 'erdRelation',
  source: {cell: from, port: `${fromField}%out`},
  target: {cell: to, port: `${toField}%in`},
  relation,
});
const diagramA = [table('a', 'USER'), table('b', 'ORDER'), line('a', 'U_ID', 'b', 'O_USER')];
const diagramB = [table('c', 'ORDER'), table('d', 'ITEM'), line('c', 'O_ID', 'd', 'I_ORDER')];
const entities = [{id: 'USER'}, {id: 'ORDER'}, {id: 'ITEM'}];
const count = list => list.reduce((a, e) => a + e.correlations.length, 0);

test('a line gives one relation between the two fields it joins', () => {
  expect(diagramCorrelations([diagramA])).toEqual([{
    myEntity: 'USER',
    myField: 'U_ID',
    refEntity: 'ORDER',
    refField: 'O_USER',
    myRows: '1',
    refRows: 'n',
    innerType: '',
  }]);
  expect(diagramCorrelations([[line('x', 'A', 'y', 'B')]])).toEqual([]);
});

test('saving keeps the relations of every diagram, also of those not open', () => {
  const drawn = diagramCorrelations([diagramA, diagramB]);
  const saved = mergeCorrelations(entities, [], drawn);
  expect(count(saved)).toBe(2);
  // nothing changed in any diagram: the same relations again, none lost, none doubled
  expect(mergeCorrelations(saved, drawn, drawn)).toEqual(saved);
});

test('a line removed from a diagram removes its relation only', () => {
  const before = diagramCorrelations([diagramA, diagramB]);
  const saved = mergeCorrelations(entities, [], before);
  const after = diagramCorrelations([diagramA.slice(0, 2), diagramB]);
  const next = mergeCorrelations(saved, before, after);
  expect(next.find(e => e.id === 'USER').correlations).toEqual([]);
  expect(next.find(e => e.id === 'ORDER').correlations.length).toBe(1);
});

test('a relation no diagram ever drew is kept', () => {
  const imported = {myField: 'I_SKU', refEntity: 'SKU', refField: 'S_ID', myRows: 'n', refRows: '1'};
  const withImport = entities.map(e => (e.id === 'ITEM' ? {...e, correlations: [imported]} : e));
  const drawn = diagramCorrelations([diagramA]);
  const next = mergeCorrelations(withImport, drawn, drawn);
  expect(next.find(e => e.id === 'ITEM').correlations).toEqual([imported]);
});

test('a kept relation gives way to a line joining the same fields the other way round', () => {
  const imported = {myField: 'O_USER', refEntity: 'USER', refField: 'U_ID', myRows: 'n', refRows: '1'};
  const withImport = entities.map(e => (e.id === 'ORDER' ? {...e, correlations: [imported]} : e));
  const next = mergeCorrelations(withImport, [], diagramCorrelations([diagramA]));
  expect(next.find(e => e.id === 'ORDER').correlations).toEqual([]);
  expect(next.find(e => e.id === 'USER').correlations.length).toBe(1);
});

test('the shop template keeps its relations through a save that changes no diagram', () => {
  const drawn = diagramCorrelations(cellsOfDiagrams(shop.diagrams));
  expect(drawn.length).toBe(7);
  const saved = mergeCorrelations(shop.entities, drawn, drawn);
  expect(count(saved)).toBeGreaterThanOrEqual(7);
  expect(mergeCorrelations(saved, drawn, drawn)).toEqual(saved);
});
