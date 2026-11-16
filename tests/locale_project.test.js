import { localizeProject, getEmptyProject, builtinText } from '../src/lib/locale/project';
import { toTW, userTextToTW, isSimplified } from '../src/lib/locale/zhtw';
import empty from '../src/lib/template/empty.json';
import shop from '../src/lib/template/电商商城.pdma.json';

const names = list => list.map(i => i.defName);

describe('wording of Taiwan', () => {
  test('interface texts use the terms of Taiwan', () => {
    expect(toTW('字段代码')).toBe('欄位代碼');
    expect(toTW('默认字串')).toBe('預設字串');
    expect(toTW('数据库视图')).toBe('資料庫檢視表');
    expect(toTW('当前配置')).toBe('目前設定');
    expect(toTW('Login failed')).toBe('Login failed');
  });

  test('a text somebody wrote in Traditional Chinese is left as it is', () => {
    expect(isSimplified('文件編號')).toBe(false);
    expect(userTextToTW('文件編號')).toBe('文件編號');
    expect(userTextToTW('信息')).toBe('信息');
    expect(userTextToTW('用户信息')).toBe('使用者資訊');
  });
});

describe('a new project', () => {
  test('starts in Traditional Chinese', () => {
    const p = getEmptyProject('zhTW');
    expect(names(p.domains)).toEqual(expect.arrayContaining(['預設字串', '主鍵識別碼', '資料字典']));
    expect(names(p.profile.default.entityInitFields))
      .toEqual(['租戶代號', '樂觀鎖', '建立者', '建立時間', '更新者', '更新時間']);
    expect(p.profile.headers.find(h => h.refKey === 'defKey').value).toBe('欄位代碼');
    expect(names(p.dataTypeMapping.mappings)).toContain('二進位');
    expect(JSON.stringify(p)).not.toMatch(/[数据库创类说认]/);
  });

  test('starts in English', () => {
    const p = getEmptyProject('en');
    expect(names(p.domains)).toEqual(expect.arrayContaining(['Default string', 'ID or key']));
    expect(names(p.profile.uiHint)).toContain('Drop-down list');
    ['domains'].forEach(k => expect(JSON.stringify(names(p[k]))).not.toMatch(/[一-鿿]/));
    expect(JSON.stringify(names(p.namingRules))).not.toMatch(/[一-鿿]/);
  });

  test('is the template itself in Simplified Chinese, and keeps every key and code', () => {
    expect(getEmptyProject('zh')).toBe(empty);
    const p = getEmptyProject('zhTW');
    expect(p.domains.map(d => d.defKey)).toEqual(empty.domains.map(d => d.defKey));
    expect(p.profile.dataTypeSupports).toBe(empty.profile.dataTypeSupports);
  });
});

describe('an existing project', () => {
  const project = {
    name: '我的项目',
    domains: [{ defKey: 'DefaultString', defName: '默认字串' }, { defKey: 'Mine', defName: '我的默认字串' }],
    profile: { default: { entityInitFields: [{ defKey: 'CREATED_BY', defName: '创建人' }] } },
    entities: [{
      defKey: 'T_用户',
      defName: '用户信息',
      comment: '保存用户',
      fields: [
        { defKey: 'CREATED_BY', defName: '创建人', defaultValue: '默认' },
        { defKey: 'NAME', defName: '名称', comment: '' },
        { defKey: 'DOC', defName: '文件編號' },
      ],
    }],
    dbConn: [{ defName: '测试库' }],
  };

  test('is put into Traditional Chinese, texts of the model included', () => {
    const p = localizeProject(project, 'zhTW');
    expect(names(p.domains)).toEqual(['預設字串', '我的預設字串']);
    expect(p.entities[0]).toMatchObject({ defKey: 'T_用户', defName: '使用者資訊', comment: '儲存使用者' });
    expect(p.entities[0].fields.map(f => f.defName)).toEqual(['建立者', '名稱', '文件編號']);
    expect(p.entities[0].fields[0].defaultValue).toBe('默认');
    expect(p.name).toBe('我的项目');
    expect(p.dbConn).toBe(project.dbConn);
  });

  test('converting again changes nothing', () => {
    const once = localizeProject(project, 'zhTW');
    expect(localizeProject(once, 'zhTW')).toBe(once);
  });

  test('in English only the built-in names change', () => {
    const p = localizeProject(project, 'en');
    expect(names(p.domains)).toEqual(['Default string', '我的默认字串']);
    expect(p.entities[0].fields.map(f => f.defName)).toEqual(['Created by', '名称', '文件編號']);
    expect(p.entities[0].defName).toBe('用户信息');
  });

  test('built-in names come back when the language goes back', () => {
    const back = localizeProject(localizeProject(project, 'en'), 'zh');
    expect(names(back.domains)).toEqual(['默认字串', '我的默认字串']);
    expect(back.profile.default.entityInitFields[0].defName).toBe('创建人');
    expect(builtinText('默认字串', 'zhTW')).toBe('預設字串');
  });

  test('a sample project is converted throughout, its name too', () => {
    const p = localizeProject(shop, 'zhTW', { known: true });
    expect(p.name).toBe('電商商城');
    expect(p.entities.map(e => e.defKey)).toEqual(shop.entities.map(e => e.defKey));
    expect(JSON.stringify(p.entities.map(e => [e.defName, e.fields.map(f => f.defName)])))
      .not.toMatch(/[买卖订单户类别状态时间]/);
  });
});
