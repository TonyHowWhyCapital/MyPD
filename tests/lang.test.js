import langs from '../src/lang';
import LABELS from '../src/lib/report/labels';

const keyPaths = (o, pre = '') => Object.keys(o).reduce((p, k) => {
  const v = o[k];
  return p.concat(v && typeof v === 'object' && !Array.isArray(v) ? keyPaths(v, `${pre}${k}.`) : `${pre}${k}`);
}, []).sort();

test('the app ships Simplified Chinese, Traditional Chinese and English', () => {
  expect(Object.keys(langs).sort()).toEqual(['en', 'zh', 'zhTW']);
});

test('the Traditional Chinese pack is in step with the Simplified one (rerun bin/gen-lang-zhtw.js if this fails)', () => {
  expect(keyPaths(langs.zhTW)).toEqual(keyPaths(langs.zh));
  expect(Object.keys(LABELS.zhTW).sort()).toEqual(Object.keys(LABELS.zh).sort());
});

test('Traditional Chinese text uses Traditional characters', () => {
  expect(langs.zhTW.toolbar.save).toBe('儲存');
  expect(langs.zhTW.config.language.zhTW).toBe('繁體中文');
  expect(LABELS.zhTW.defName).toBe('名稱');
});

test('every extension feature string exists in English as well', () => {
  ['impact', 'modelCompare', 'dbObject', 'report', 'entityTemplate'].forEach((ns) => {
    expect(keyPaths(langs.en[ns])).toEqual(keyPaths(langs.zh[ns]));
  });
});
