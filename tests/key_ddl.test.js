import { uniqueKeyDdl, withUniqueKeys } from '../src/lib/key_ddl';

const entity = {
  defKey: 'EMP',
  fields: [{ id: 'a', defKey: 'ID' }, { id: 'b', defKey: 'BADGE' }, { id: 'c', defKey: 'DEPT' }],
  keys: [
    { primary: true, defKey: 'PK', constraintName: 'PK_EMP', fields: ['a'] },
    { primary: false, defKey: 'AK_1', constraintName: 'UQ_EMP_BADGE', fields: ['b'] },
    { primary: false, defKey: 'AK_2', constraintName: '', fields: ['c', 'b', 'gone'] },
    { primary: false, defKey: 'AK_3', constraintName: '', fields: [] },
  ],
};

test('alternate keys become unique constraints, the primary key does not', () => {
  expect(uniqueKeyDdl(entity, ';')).toEqual([
    'ALTER TABLE EMP ADD CONSTRAINT UQ_EMP_BADGE UNIQUE (BADGE);',
    'ALTER TABLE EMP ADD CONSTRAINT AK_2 UNIQUE (DEPT, BADGE);',
  ]);
});

test('they follow the create statement, and a table without keys is left alone', () => {
  expect(withUniqueKeys('CREATE TABLE EMP();', entity, ';').split('\n')).toHaveLength(3);
  expect(withUniqueKeys('CREATE TABLE X();', { defKey: 'X', fields: [] }, ';')).toBe('CREATE TABLE X();');
  expect(withUniqueKeys('', entity, ';')).toBe('');
});

test('the table is named the way the create statement names it, columns in its quotes', () => {
  const lines = withUniqueKeys('CREATE TABLE [dbo].[EMP](\n [ID] int\n);', entity, ';').split('\n').slice(-2);
  expect(lines).toEqual([
    'ALTER TABLE [dbo].[EMP] ADD CONSTRAINT [UQ_EMP_BADGE] UNIQUE ([BADGE]);',
    'ALTER TABLE [dbo].[EMP] ADD CONSTRAINT [AK_2] UNIQUE ([DEPT], [BADGE]);',
  ]);
  expect(withUniqueKeys('create table if not exists `EMP` (', entity, ';')).toContain('ALTER TABLE `EMP` ADD CONSTRAINT `UQ_EMP_BADGE` UNIQUE (`BADGE`);');
  expect(withUniqueKeys('CREATE TABLE hr.EMP(', entity, ';')).toContain('ALTER TABLE hr.EMP ADD CONSTRAINT UQ_EMP_BADGE UNIQUE (BADGE);');
});
