import '../src/lib/Math';
import { _mergeDataSource } from '../src/lib/utils';

jest.mock('components', () => ({}), { virtual: true });
const { groupKeyProblem, pickNewGroups } = require('../src/components/listgroupselect/newGroup');

describe('group created while choosing tables', () => {
  test('a code is required and must be unique, ignoring case', () => {
    const groups = [{ id: '', defKey: '' }, { id: 'g1', defKey: 'Sales' }];
    expect(groupKeyProblem('  ', groups)).toBe('required');
    expect(groupKeyProblem('sales', groups)).toBe('duplicate');
    expect(groupKeyProblem('Stock', groups)).toBe('');
  });

  test('only new groups are handed to the project, and the merge puts the tables in them', () => {
    const newGroups = pickNewGroups([
      { id: 'g1', defKey: 'Sales', defName: 'Sales', fields: [] },
      { id: 'g2', defKey: 'Stock', defName: '庫存', fields: [], isNew: true },
      { id: 'g3', defKey: 'Unused', defName: 'Unused', fields: [], isNew: true },
    ]);
    expect(newGroups.map(g => g.defKey)).toEqual(['Stock', 'Unused']);
    const old = {
      profile: {}, entities: [],
      viewGroups: [{ id: 'g1', defKey: 'Sales', defName: 'Sales', refEntities: [], refViews: [], refDiagrams: [], refDicts: [] }],
    };
    const merged = _mergeDataSource(old, { viewGroups: newGroups },
      [{ id: 'e1', defKey: 'item', defName: 'Item', fields: [], group: 'g2' }], true);
    const stock = merged.viewGroups.find(g => g.defKey === 'Stock');
    expect(stock.defName).toBe('庫存');
    expect(stock.refEntities).toEqual([merged.entities.find(e => e.defKey === 'item').id]);
    // a new group nobody was put in is not added
    expect(merged.viewGroups.map(g => g.defKey)).toEqual(['Sales', 'Stock']);
  });
});
