
export const success = 'SUCCESS';
export const fail = 'FAIL';
export const reset = 'RESET';
export const CONFIG = 'config';

// 页面类型
export const pageType = ['welcome', 'home', 'main'];

// 语言类型
export const langType = ['zh', 'zhTW', 'en'];
// 语言设置为 auto 时跟随系统语言
export const langAuto = 'auto';
export const getSystemLang = (locale = (typeof navigator !== 'undefined' ? navigator.language : '')) => {
  if (/^zh[-_](TW|HK|MO|Hant)/i.test(locale || '')) {
    return 'zhTW';
  } else if (/^zh/i.test(locale || '')) {
    return 'zh';
  }
  return 'en';
};
export const resolveLang = (setting, locale) => {
  return langType.includes(setting) ? setting : getSystemLang(locale);
};

// 状态
export const READING = 'reading';
export const EDIT = 'edit';
