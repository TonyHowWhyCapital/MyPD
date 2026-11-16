// Puts the content of a project into the language of the interface.
//
// What a project is created with (default fields, domains, basic data types, UI hints,
// column headers, naming rules, code templates) is kept in the project file. A name that
// is still one of the built-in ones, in any language, is replaced by the built-in name
// of the language in use; a name the user changed is left alone.
// For Traditional Chinese the texts of the model itself (names, comments, dictionaries,
// diagram labels) are also converted when they are written in Simplified Chinese.
import emptyProject from '../template/empty.json';
import { toTW, userTextToTW, modelTextToTW } from './zhtw';
import en from './builtin_en';

const CJK = /[㐀-鿿]/;
const names = { zh: s => s, zhTW: toTW, en: s => en[s] || s };

// -> the built-in text `zh` (as in the template) in the language
export const builtinText = (zh, lang) => (names[lang] || names.zh)(zh);

// every form a built-in text has -> the text of the template
let known = null;
const knownTexts = () => {
  if (!known) {
    known = new Map();
    const add = (zh) => {
      if (typeof zh === 'string' && CJK.test(zh)) {
        Object.keys(names).forEach(lang => known.set(builtinText(zh, lang), zh));
      }
    };
    const { profile, dataTypeMapping, domains, namingRules } = emptyProject;
    profile.default.entityInitFields.forEach(f => add(f.defName));
    profile.uiHint.forEach(u => add(u.defName));
    profile.headers.forEach(h => add(h.value));
    dataTypeMapping.mappings.forEach(m => add(m.defName));
    domains.forEach(d => add(d.defName));
    namingRules.forEach((r) => {
      add(r.defName);
      add(r.intro);
      add(r.programCode);
    });
    profile.codeTemplates.forEach(t => Object.keys(t).forEach(k => add(t[k])));
  }
  return known;
};

// -> the text in the language when it is a built-in one, or undefined
const builtin = (text, lang) => {
  const zh = typeof text === 'string' ? knownTexts().get(text) : undefined;
  return zh === undefined ? undefined : builtinText(zh, lang);
};

// keys whose value is a text people read; `value` only beside `refKey` (a column header)
const TEXT_KEYS = ['defName', 'comment', 'intro', 'label', 'note', 'text', 'describe', 'title'];
// parts of a project that hold settings and code: not free text
const SETTINGS = ['codeTemplates', 'namingRules', 'dbConn', 'dbConns', 'dataTypeSupports', 'sql'];

const mapList = (list, fn) => (Array.isArray(list) ? list.map(fn) : list);
// -> the object with the texts under `keys` passed through `fn`
const mapKeys = (object, keys, fn) => keys.reduce((p, k) => {
  return typeof object[k] === 'string' ? { ...p, [k]: fn(object[k]) } : p;
}, object);

// The places that hold built-in texts. Only there is a text compared with the built-in
// ones: 名称 or 日期 elsewhere is a name somebody gave to a field of their own.
const localizeBuiltins = (dataSource, fn) => {
  const initKeys = emptyProject.profile.default.entityInitFields.map(f => f.defKey);
  const headers = list => mapList(list, h => mapKeys(h, ['value'], fn));
  const sheets = list => mapList(list, e => ({
    ...e,
    ...('headers' in e ? { headers: headers(e.headers) } : {}),
    ...('fields' in e ? {
      fields: mapList(e.fields, f => (initKeys.includes(f.defKey) ? mapKeys(f, ['defName'], fn) : f)),
    } : {}),
  }));
  const named = list => mapList(list, i => mapKeys(i, ['defName'], fn));
  const profile = dataSource.profile || {};
  return {
    ...dataSource,
    ...('profile' in dataSource ? {
      profile: {
        ...profile,
        ...(profile.default ? {
          default: { ...profile.default, entityInitFields: named(profile.default.entityInitFields) },
        } : {}),
        ...('uiHint' in profile ? { uiHint: named(profile.uiHint) } : {}),
        ...('headers' in profile ? { headers: headers(profile.headers) } : {}),
        ...('codeTemplates' in profile ? {
          codeTemplates: mapList(profile.codeTemplates, t => mapKeys(t, Object.keys(t), fn)),
        } : {}),
      },
    } : {}),
    ...(dataSource.dataTypeMapping ? {
      dataTypeMapping: {
        ...dataSource.dataTypeMapping,
        mappings: named(dataSource.dataTypeMapping.mappings),
      },
    } : {}),
    ...('domains' in dataSource ? { domains: named(dataSource.domains) } : {}),
    ...('namingRules' in dataSource ? {
      namingRules: mapList(dataSource.namingRules,
        r => mapKeys(r, ['defName', 'intro', 'programCode'], fn)),
    } : {}),
    ...('entities' in dataSource ? { entities: sheets(dataSource.entities) } : {}),
    ...('views' in dataSource ? { views: sheets(dataSource.views) } : {}),
    ...('logicEntities' in dataSource ? { logicEntities: sheets(dataSource.logicEntities) } : {}),
  };
};

// -> the value with every readable text of the model passed through `fn`
const mapModelTexts = (value, fn) => {
  if (Array.isArray(value)) {
    return value.map(v => mapModelTexts(v, fn));
  } else if (value && typeof value === 'object') {
    return Object.keys(value).reduce((p, k) => {
      const v = value[k];
      if (typeof v === 'string') {
        p[k] = TEXT_KEYS.includes(k) || (k === 'value' && 'refKey' in value) ? fn(v) : v;
      } else {
        p[k] = SETTINGS.includes(k) ? v : mapModelTexts(v, fn);
      }
      return p;
    }, {});
  }
  return value;
};

// dataSource: a project; lang: 'zh' | 'zhTW' | 'en'
// options.known: the project is one of the program's own templates, written in Simplified
//   Chinese throughout, so every text is converted and the project name with it.
// -> the project in that language; the same object when nothing had to change
export const localizeProject = (dataSource, lang, options = {}) => {
  if (!dataSource || !names[lang]) {
    return dataSource;
  }
  let changed = false;
  const track = fn => (v) => {
    const next = fn(v);
    changed = changed || next !== v;
    return next;
  };
  let result = localizeBuiltins(dataSource, track((v) => {
    const found = builtin(v, lang);
    return found === undefined ? v : found;
  }));
  if (lang === 'zhTW') {
    const convert = options.known ? modelTextToTW : userTextToTW;
    result = mapModelTexts(result, track(convert));
    if (options.known && typeof result.name === 'string') {
      result = { ...result, name: track(modelTextToTW)(result.name) };
    }
  }
  return changed ? result : dataSource;
};

// -> what a new project starts from, in the language
const empty = {};
export const getEmptyProject = (lang) => {
  if (!empty[lang]) {
    empty[lang] = localizeProject(emptyProject, lang, { known: true });
  }
  return empty[lang];
};
