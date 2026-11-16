// 由简体语言包生成繁体语言包：node bin/gen-lang-zhtw.js（修改 zh.js 或 ext 语言包后重新执行）
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var babel = require('@babel/core');
var OpenCC = require('opencc-js');

var root = path.resolve(__dirname, '..');
var openccConvert = OpenCC.Converter({ from: 'cn', to: 'twp' });
var loadModule = function (file) {
    var code = babel.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), {
        presets: [['@babel/env', { targets: { node: 'current' } }]],
        babelrc: false,
    }).code;
    var m = { exports: {} };
    // 语言包只含纯数据，其依赖（如已生成的繁体包）无需真实加载
    vm.runInNewContext(code, { module: m, exports: m.exports, require: function () { return {}; } });
    return m.exports;
};
var load = function (file) {
    return loadModule(file).default;
};

// 通用词库的转换不符合台湾惯用说法之处，在 src/lib/locale/zhtw_terms.js 逐条修正（程序运行时的转换共用同一份）；
// “视图”会被词库与动词“查看”一并转成“檢視”，因此先占位再还原为“檢視表”
var termLists = loadModule('src/lib/locale/zhtw_terms.js');
var terms = termLists.common.concat(termLists.ui);
var convert = function (text) {
    return terms.reduce(function (p, t) {
        return typeof t[0] === 'string' ? p.split(t[0]).join(t[1]) : p.replace(t[0], t[1]);
    }, openccConvert(text.split('视图').join('\u0001')).split('\u0001').join('檢視表'));
};

// 整条文字就是“代码”而键名表明它指的是标识（表代码、字段代码）时，说“代碼”而不是“程式碼”
var CODE_KEY = /^(defKey|indexesFieldKey|code|key|fieldCode|groupCode|ruleObjectCode)$/;
var deepConvert = function (value, key) {
    if (typeof value === 'string') {
        return value === '代码' && CODE_KEY.test(key || '') ? '代碼' : convert(value);
    } else if (Array.isArray(value)) {
        return value.map(deepConvert);
    } else if (value && typeof value === 'object') {
        return Object.keys(value).reduce(function (p, k) {
            p[k] = deepConvert(value[k], k);
            return p;
        }, {});
    }
    return value;
};

var write = function (file, data) {
    var header = '// 此文件由 bin/gen-lang-zhtw.js 生成，请勿手工修改\n/* eslint-disable */\n';
    fs.writeFileSync(path.join(root, file), header + 'export default ' + JSON.stringify(data, null, 2) + ';\n');
    console.log('generated ' + file);
};

var extDir = 'src/lang/ext';
var merged = fs.readdirSync(path.join(root, extDir)).filter(function (f) { return /\.js$/.test(f); }).sort()
    .reduce(function (p, f) {
        return Object.assign(p, load(path.join(extDir, f)).zh);
    }, Object.assign({}, load('src/lang/zh.js')));

// 扩展语言包可带 zhTW 块：自动转换的用词不符合台湾习惯时，逐条覆盖
var deepMerge = function (base, over) {
    return Object.keys(over || {}).reduce(function (p, k) {
        var nested = over[k] && typeof over[k] === 'object' && p[k] && typeof p[k] === 'object';
        p[k] = nested ? deepMerge(Object.assign({}, p[k]), over[k]) : over[k];
        return p;
    }, base);
};
var zhTW = fs.readdirSync(path.join(root, extDir)).filter(function (f) { return /\.js$/.test(f); }).sort()
    .reduce(function (p, f) {
        return deepMerge(p, load(path.join(extDir, f)).zhTW);
    }, deepConvert(merged));
zhTW.config.language = Object.assign({}, zhTW.config.language, { zh: '簡體中文', zhTW: '繁體中文', en: 'English' });
write('src/lang/zhTW.js', zhTW);
write('src/lib/report/labels.zhTW.js', deepConvert(load('src/lib/report/labels.js').zh));
