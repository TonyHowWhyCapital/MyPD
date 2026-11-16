// Simplified Chinese to Traditional Chinese with the wording used in Taiwan, while the
// program runs: for the built-in project content, for projects written in Simplified
// Chinese and for the messages of the Java engine, none of which are in the language packs.
import { Converter } from 'opencc-js/dist/umd/cn2t';
import { common, ui } from './zhtw_terms';

let converters = null;
const get = () => {
  if (!converters) {
    converters = {
      // characters and phrases
      phrase: Converter({ from: 'cn', to: 'twp' }),
      // characters only: tells whether a text is written in Simplified Chinese at all
      char: Converter({ from: 'cn', to: 'tw' }),
    };
  }
  return converters;
};

const CJK = /[㐀-鿿]/;
const VIEW = '\u0001';

export const applyTerms = (text, terms) => terms.reduce((p, [from, to]) => {
  return typeof from === 'string' ? p.split(from).join(to) : p.replace(from, to);
}, text);

// The word list turns 视图 (a database view) into 檢視 like the verb 查看; it is kept apart.
const convert = (text, terms) => applyTerms(
  get().phrase(text.split('视图').join(VIEW)).split(VIEW).join('檢視表'), terms);

// -> true when the text has characters that only Simplified Chinese writes
export const isSimplified = (text) => {
  return typeof text === 'string' && CJK.test(text) && get().char(text) !== text;
};

// A text of the interface or of the program itself, known to be Simplified Chinese.
export const toTW = (text) => {
  return typeof text === 'string' && CJK.test(text) ? convert(text, common.concat(ui)) : text;
};

// A text a user may have written: left alone unless it is in Simplified Chinese, so
// Traditional Chinese wording that the word list would "correct" (文件, 信息) is not touched.
export const userTextToTW = (text) => {
  return isSimplified(text) ? convert(text, common) : text;
};

// A text of the program's own project templates: Simplified Chinese for certain, but model
// content, so only the terms of the trade are corrected.
export const modelTextToTW = (text) => {
  return typeof text === 'string' && CJK.test(text) ? convert(text, common) : text;
};
