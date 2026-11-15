import _ from 'lodash';
import langs from '../src/lang';
import {
  runErrorText, planProblemText, keyFitReason,
} from '../src/app/container/tools/testdata/generate/problems';
import { problemText, plainDetail } from '../src/app/container/tools/testdata/rules/ruleText';

const text = (lang, block) => (id, data) => `${_.get(langs[lang], `${block}.${id}`, '')}`
  .replace(/\{(\w+)\}/g, (all, name) => (data && data[name] !== undefined ? data[name] : all));
const tr = lang => text(lang, 'testData');
const ruleTr = lang => text(lang, 'testDataRule');

const f = (id, more) => ({ id, defKey: id.toUpperCase(), type: 'VARCHAR', len: 8, ...more });
const parent = { id: 'p', defKey: 'PARENT', fields: [f('code', { len: 32, primaryKey: true })] };
// the relation as the app keeps it for a line drawn from the parent
parent.correlations = [{ myField: 'code', refEntity: 'c', refField: 'p_code', myRows: '1', refRows: 'n' }];
const child = { id: 'c', defKey: 'CHILD', fields: [f('id', { primaryKey: true }), f('p_code')] };
const ds = { entities: [parent, child] };

describe('a key that does not go into the column of the child', () => {
  test('the reason is an example in words, not the shorthand of the engine', () => {
    expect(keyFitReason(tr('zhTW'), 'foreignKeyFit: value.changed: 0000000001 -> 00000000'))
      .toBe('例如 0000000001 會變成 00000000');
    expect(keyFitReason(tr('en'), 'foreignKeyFit: value.range: 500')).toBe('e.g. 500');
    expect(keyFitReason(tr('zh'), 'foreignKeyFit')).toBe('');
    expect(keyFitReason(tr('zh'), undefined)).toBe('');
  });

  test('found by the plan: both tables and both columns are named', () => {
    const message = planProblemText(tr('zhTW'), ruleTr('zhTW'), {
      code: 'foreignKeyFit',
      entityId: 'c',
      fieldId: 'p_code',
      detail: {
        refEntityId: 'p',
        refFieldId: 'code',
        reason: 'foreignKeyFit: value.changed: 0000000001 -> 00000000',
      },
    }, ds);
    expect(message).toBe('CHILD.P_CODE 放不下 PARENT.CODE 的鍵值（例如 0000000001 會變成 00000000）：'
      + '兩個欄位的資料型別或長度不一致');
  });

  test('found while rows are made: the error names the column only, the model the parent', () => {
    const error = Object.assign(new Error('foreignKeyFit: value.changed: AB123456789 -> AB123456'), {
      code: 'foreignKeyFit', entityId: 'c', fieldId: 'p_code', row: 35,
    });
    expect(runErrorText(tr('en'), ruleTr('en'), error, ds)).toBe('CHILD.P_CODE cannot hold the keys '
      + 'of PARENT.CODE (e.g. AB123456789 would become AB123456): the two columns differ in data '
      + 'type or length');
    LANGS.forEach(lang => expect(runErrorText(tr(lang), ruleTr(lang), error, ds))
      .not.toMatch(/\{\w+\}| \. |value\.changed/));
  });
});

const LANGS = ['zh', 'en', 'zhTW'];

describe('a value of the wrong kind', () => {
  test('the value is shown, the kind of the column is not repeated in shorthand', () => {
    expect(plainDetail('value.type', 'datetime: 王小明')).toBe('王小明');
    expect(plainDetail('value.range', '500 (0..255)')).toBe('500 (0..255)');
    expect(plainDetail('value.type', undefined)).toBeUndefined();
    expect(problemText(ruleTr('zhTW'), 'value.type', { detail: 'datetime: 王小明' }))
      .toBe('產生的值不符合欄位的資料型別：王小明');
    const error = Object.assign(new Error('value.type: int: abc'), {
      code: 'value.type', detail: 'int: abc', entityId: 'c', fieldId: 'id', row: 2,
    });
    expect(runErrorText(tr('en'), ruleTr('en'), error, ds))
      .toBe('CHILD.ID: The value does not fit the data type of the column: abc (row 3)');
  });
});
