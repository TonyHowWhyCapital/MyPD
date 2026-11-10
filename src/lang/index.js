import en from './en';
import zh from './zh';
import zhTW from './zhTW';
import impact from './ext/impact';
import modelCompare from './ext/modelCompare';
import dbObject from './ext/dbObject';
import report from './ext/report';
import entityTemplate from './ext/entityTemplate';

// 每个扩展功能的语言包独占一个顶层命名空间
const ext = [impact, modelCompare, dbObject, report, entityTemplate];
const merge = (base, lang) => ext.reduce((p, n) => ({...p, ...n[lang]}), base);

export default {
    en: merge(en, 'en'),
    zh: merge(zh, 'zh'),
    zhTW,
};
