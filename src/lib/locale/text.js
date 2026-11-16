// Texts the program holds in Simplified Chinese outside the language packs: labels of the
// documents it writes, names of built-in lists, messages of the Java engine. They are
// shown in the language of the interface.
import { getMemoryCache } from '../cache';
import { CONFIG } from '../variable';
import { toTW, modelTextToTW } from './zhtw';
import en from './text_en';

export const currentLang = () => {
  const config = getMemoryCache(CONFIG);
  return (config && config.lang) || 'zh';
};

// zh: the text in Simplified Chinese -> the text in the language (the one in use by default)
export const localText = (zh, lang = currentLang()) => {
  if (lang === 'zhTW') {
    return toTW(zh);
  }
  return lang === 'en' ? (en[zh] || zh) : zh;
};

// A text read each time it is used, for constants made before the language is known:
// `${lazyText('目录')}` gives the text of the language in use at that moment.
export const lazyText = zh => ({ toString: () => localText(zh) });

// A message of the Java engine, which only writes Simplified Chinese. English has no
// translation of it; the message stays as the engine wrote it.
export const engineText = (text, lang = currentLang()) => {
  return lang === 'zhTW' && typeof text === 'string' ? toTW(text) : text;
};

// Sample data of the program (the model shown when a code template is previewed).
export const sampleText = (value, lang = currentLang()) => {
  if (lang !== 'zhTW') {
    return value;
  } else if (typeof value === 'string') {
    return modelTextToTW(value);
  } else if (Array.isArray(value)) {
    return value.map(v => sampleText(v, lang));
  } else if (value && typeof value === 'object') {
    return Object.keys(value).reduce((p, k) => {
      // codes and keys of the sample stay as they are
      p[k] = /defKey|^id$|Key$/.test(k) ? value[k] : sampleText(value[k], lang);
      return p;
    }, {});
  }
  return value;
};
