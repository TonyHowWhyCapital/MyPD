const { remarkSetting, splitRemark, namedByRemark, joinRemark } = require('../src/lib/remark');
const { _getTemplateString } = require('../src/lib/utils');

const project = (sql) => ({ profile: { sql } });

describe('remark setting', () => {
  test('defaults to the legacy rule, split on semicolon', () => {
    expect(remarkSetting({})).toEqual({ split: true, separator: ';' });
    expect(remarkSetting(project({ remarkSplit: false, remarkSeparator: '|' })))
      .toEqual({ split: false, separator: '|' });
  });
});

describe('database remark to name and comment', () => {
  const pipe = { split: true, separator: '|' };

  test('splits at the first separator and keeps other symbols in the comment', () => {
    expect(splitRemark('案件編號|為主要鍵值,前兩碼為年月', pipe))
      .toEqual({ defName: '案件編號', comment: '為主要鍵值,前兩碼為年月' });
    expect(splitRemark('a|b|c', pipe)).toEqual({ defName: 'a', comment: 'b|c' });
  });

  test('every character of the setting is a separator', () => {
    const many = { split: true, separator: ',| ' };
    expect(splitRemark('案件編號,說明', many)).toEqual({ defName: '案件編號', comment: '說明' });
    expect(splitRemark('案件編號|說明', many)).toEqual({ defName: '案件編號', comment: '說明' });
    expect(splitRemark('案件編號 說明', many)).toEqual({ defName: '案件編號', comment: '說明' });
    expect(splitRemark('案件編號, 說明|其他', many)).toEqual({ defName: '案件編號', comment: '說明|其他' });
    expect(splitRemark('  案件編號  ', many)).toEqual({ defName: '案件編號', comment: '' });
    expect(splitRemark('案件編號;說明', many)).toEqual({ defName: '案件編號;說明', comment: '' });
  });

  test('a separator of several characters written before still splits where it did', () => {
    expect(splitRemark('案件編號--說明', { split: true, separator: '--' }))
      .toEqual({ defName: '案件編號', comment: '說明' });
  });

  test('remarks are joined with the first separator', () => {
    expect(joinRemark('案件編號', '說明', ',| ')).toBe('案件編號,說明');
  });

  test('keeps the whole remark as the name without a separator or with split off', () => {
    expect(splitRemark('案件編號', pipe)).toEqual({ defName: '案件編號', comment: '' });
    expect(splitRemark('案件編號|說明', { split: false, separator: '|' }))
      .toEqual({ defName: '案件編號|說明', comment: '' });
    expect(splitRemark(undefined, pipe)).toEqual({ defName: '', comment: '' });
  });

  test('an explicit comment wins over the split one', () => {
    expect(namedByRemark({ defName: 'n|c', comment: 'own' }, pipe))
      .toEqual({ defName: 'n', comment: 'own' });
  });
});

describe('name and comment to database remark', () => {
  test('joins with the separator and round-trips', () => {
    const remark = joinRemark('案件編號', '為主要鍵值,前兩碼為年月', '|');
    expect(remark).toBe('案件編號|為主要鍵值,前兩碼為年月');
    expect(splitRemark(remark, { split: true, separator: '|' }).defName).toBe('案件編號');
  });

  test('emits one part when the other is blank or identical', () => {
    expect(joinRemark('n', '', '|')).toBe('n');
    expect(joinRemark('', 'c', '|')).toBe('c');
    expect(joinRemark('same', 'same', '|')).toBe('same');
  });

  test('DDL templates use the project separator for name and comment only', () => {
    const tpl = "{{=it.func.join(it.entity.defName,it.entity.comment,';')}} {{=it.func.join('a','b',',')}}";
    const entity = { defName: '案件', comment: '說明' };
    expect(_getTemplateString(tpl, { entity, remarkSeparator: '|' })).toBe('案件|說明 a,b');
    expect(_getTemplateString(tpl, { entity })).toBe('案件;說明 a,b');
  });

  test('full project DDL for SQL Server merges name and comment into one remark', () => {
    const { _getAllDataSQLByFilter } = require('../src/lib/utils');
    const shop = JSON.parse(JSON.stringify(require('../src/lib/template/电商商城.pdma.json')));
    const sqlServer = shop.profile.dataTypeSupports.find(s => s.defKey === 'SQLServer').id;
    const entity = shop.entities[0];
    entity.defName = '案件';
    entity.comment = '案件主檔';
    entity.fields[0].defName = '案件編號';
    entity.fields[0].comment = '為主要鍵值,前兩碼為年月';
    const ddl = sep => _getAllDataSQLByFilter(
      { ...shop, profile: { ...shop.profile, sql: { ...shop.profile.sql, remarkSeparator: sep } } },
      sqlServer, ['createTable'], { entities: [entity.id] });
    expect(ddl('|')).toContain("'MS_Description', '案件|案件主檔'");
    expect(ddl('|')).toContain("'MS_Description', '案件編號|為主要鍵值,前兩碼為年月'");
    expect(ddl(undefined)).toContain("'MS_Description', '案件編號;為主要鍵值,前兩碼為年月'");
  });
});
