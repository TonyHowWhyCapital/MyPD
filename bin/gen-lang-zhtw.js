// 由简体语言包生成繁体语言包：node bin/gen-lang-zhtw.js（修改 zh.js 或 ext 语言包后重新执行）
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var babel = require('@babel/core');
var OpenCC = require('opencc-js');

var root = path.resolve(__dirname, '..');
var openccConvert = OpenCC.Converter({ from: 'cn', to: 'twp' });
// 通用词库对数据库术语的转换不符合台湾惯用说法，在此修正；
// “视图”会被词库与动词“查看”一并转成“檢視”，因此先占位再还原
var terms = [
    ['分割槽', '分割區'],
    ['儲存過程', '預存程序'],
    ['表空間', '資料表空間'],
    ['外來鍵', '外鍵'],
    // 同物异名收敛为一个说法，并修正词库逐词转换造成的叠字与大陆用语
    ['程式程式碼', '程式碼'],
    ['模版', '範本'],
    ['模板', '範本'],
    ['對比', '比較'],
    ['比對', '比較'],
    ['字尾', '副檔名'],
    ['只讀', '唯讀'],
    ['自定義', '自訂'],
    ['丟失', '遺失'],
    ['級聯', '串聯'],
    // “型別”专指字段的数据类型，数据库的种类说“類型”
    ['資料庫型別', '資料庫類型'],
    ['主題域', '主題領域'],
    // 测试数据规则的种类
    ['規則型別', '規則類型'],
    ['公元', '西元'],
];
var convert = function (text) {
    return terms.reduce(function (p, t) {
        return p.split(t[0]).join(t[1]);
    }, openccConvert(text.split('视图').join('\u0001')).split('\u0001').join('視圖'));
};

var load = function (file) {
    var code = babel.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), {
        presets: [['@babel/env', { targets: { node: 'current' } }]],
        babelrc: false,
    }).code;
    var m = { exports: {} };
    // 语言包只含纯数据，其依赖（如已生成的繁体包）无需真实加载
    vm.runInNewContext(code, { module: m, exports: m.exports, require: function () { return {}; } });
    return m.exports.default;
};

var deepConvert = function (value) {
    if (typeof value === 'string') {
        return convert(value);
    } else if (Array.isArray(value)) {
        return value.map(deepConvert);
    } else if (value && typeof value === 'object') {
        return Object.keys(value).reduce(function (p, k) {
            p[k] = deepConvert(value[k]);
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
