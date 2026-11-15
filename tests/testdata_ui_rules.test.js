import fs from 'fs';
import os from 'os';
import path from 'path';
import _ from 'lodash';
import langs from '../src/lang';
import {
  RULE_KINDS, BUILTIN_NAMES, EXPORT_TYPE, newRule, getTestData, setTestData, upsertRule,
  setDomainRule, validateRule,
} from '../src/lib/testdata/model';
import { EXPR_FUNCTIONS, compileExpr } from '../src/lib/testdata/expr';
import { ensureTestDataHeader } from '../src/lib/testdata_header';
import {
  problemKey, problemText, errorText, ruleSummary, dateSpecText, effectiveLabel, usageLabel,
  BUILTIN_GROUPS, EXPR_SIGNATURES, KIND_ICONS,
} from '../src/app/container/tools/testdata/rules/ruleText';
import {
  deleteProjectRules, addRules, addProjectRules, nameTaken, libraryProblems, usageNames,
  effectiveRule, fieldValue, withOpenTabs, findTwin, cleanRules, bindDomain,
} from '../src/app/container/tools/testdata/rules/libraryOps';
import {
  sampleValues, genericColumn, defaultGenericKind, valueText, SAMPLE_COUNT,
} from '../src/app/container/tools/testdata/rules/sample';
import {
  parseListText, parseRows, listColumns, readListFile, readListText,
} from '../src/app/container/tools/testdata/rules/fileList';

const LANGS = ['zh', 'en', 'zhTW'];
const tr = lang => (id, data) => {
  const text = _.get(langs[lang], `testDataRule.${id}`, '');
  return data ? text.replace(/\{(\w+)\}/g, (all, name) => data[name]) : text;
};
const zh = tr('zh');
const en = tr('en');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const keyPaths = (o, pre = '') => Object.keys(o).reduce((p, k) => {
  const v = o[k];
  return p.concat(v && typeof v === 'object' ? keyPaths(v, `${pre}${k}.`) : `${pre}${k}`);
}, []).sort();

// every problem code the engine can report for a rule, read from its source
const engineCodes = () => {
  const found = new Set();
  ['model.js', 'values.js', 'expr.js', 'pattern.js'].forEach((file) => {
    const source = read(`src/lib/testdata/${file}`);
    const re = /'([a-z]+(?:\.[A-Za-z]+)+)'/g;
    for (let m = re.exec(source); m; m = re.exec(source)) {
      found.add(m[1]);
    }
  });
  // codes put together from the kind of the rule
  ['number', 'text'].forEach(kind => ['min.invalid', 'max.invalid', 'range']
    .forEach(tail => found.add(`${kind}.${tail}`)));
  ['file', 'query'].forEach(kind => ['missing', 'empty'].forEach(t => found.add(`${kind}.${t}`)));
  BUILTIN_NAMES.concat(EXPORT_TYPE).forEach(name => found.delete(name));
  return [...found].sort();
};

describe('language pack', () => {
  test('the three languages have the same keys', () => {
    expect(keyPaths(langs.en.testDataRule)).toEqual(keyPaths(langs.zh.testDataRule));
    expect(keyPaths(langs.zhTW.testDataRule)).toEqual(keyPaths(langs.zh.testDataRule));
  });

  test('every code the engine can report for a rule has a message in every language', () => {
    const codes = engineCodes();
    expect(codes.length).toBeGreaterThan(60);
    expect(codes).toEqual(expect.arrayContaining(['rule.name.empty', 'number.range.column',
      'expr.function.args', 'pattern.mask.escape', 'import.rule.invalid', 'value.type',
      'file.missing', 'text.min.invalid', 'dict.empty']));
    LANGS.forEach((lang) => {
      const missing = codes.filter(code => !_.get(langs[lang],
        `testDataRule.problem.${problemKey(code)}`));
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    });
  });

  test('the codes the windows add themselves have a message too', () => {
    ['rule.name.duplicate', 'file.read', 'file.tooLarge', 'sample.expr.needTable',
      'sample.failed', 'expr.invalid'].forEach((code) => {
      LANGS.forEach(lang => expect(tr(lang)(`problem.${problemKey(code)}`)).not.toBe(''));
    });
  });

  test('every kind, builtin and formula function has a name', () => {
    LANGS.forEach((lang) => {
      const t = tr(lang);
      RULE_KINDS.forEach((kind) => {
        expect(t(`kind.${kind}`)).not.toBe('');
        expect(t(`kindHint.${kind}`)).not.toBe('');
        expect(KIND_ICONS[kind]).toBeTruthy();
      });
      BUILTIN_NAMES.forEach(name => expect(t(`builtin.${problemKey(name)}`)).not.toBe(''));
      EXPR_FUNCTIONS.forEach(name => expect(t(`fn.${name}`)).not.toBe(''));
    });
  });

  test('every text a window asks for by name exists', () => {
    const dir = path.join(root, 'src/app/container/tools/testdata/rules');
    const files = fs.readdirSync(dir).concat(fs.readdirSync(path.join(dir, 'params'))
      .map(f => `params/${f}`)).filter(f => /\.js$/.test(f));
    const asked = new Set();
    files.forEach((file) => {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      const re = /\btr\(\s*'([A-Za-z0-9_.]+)'/g;
      for (let m = re.exec(source); m; m = re.exec(source)) {
        asked.add(m[1]);
      }
    });
    expect(asked.size).toBeGreaterThan(80);
    const missing = [...asked].filter(id => typeof _.get(langs.zh.testDataRule, id) !== 'string');
    expect(missing).toEqual([]);
  });

  test('Traditional Chinese uses the words of Taiwan', () => {
    const t = langs.zhTW.testDataRule;
    expect(t.column).toBe('測試資料規則');
    expect(t.tab.project).toBe('專案規則');
    expect(t.tab.domain).toBe('資料域');
    expect(t.action.import).toBe('匯入');
    expect(t.editor.kind).toBe('規則類型');
    expect(t.builtin.tw_nationalId).toBe('身分證字號');
    expect(JSON.stringify(t)).not.toMatch(/臺灣|這臺|隻能|唯讀取|引數|副檔名|迴圈/);
  });
});

describe('texts of a rule', () => {
  test('a problem code becomes a message, with the place in a formula and the detail', () => {
    expect(problemText(zh, 'rule.name.empty')).toBe('请填写规则名称');
    expect(problemText(en, 'expr.paren', { pos: 4 })).toBe('A bracket is not closed (character 5)');
    expect(problemText(en, 'expr.function.unknown', { pos: 0, detail: 'foo' }))
      .toBe('There is no such function (character 1): foo');
    expect(problemText(en, 'no.such.code')).toBe('The rule has a problem (no.such.code)');
  });

  test('an error of the engine is told in words', () => {
    let error;
    try {
      compileExpr('1 +');
    } catch (e) {
      error = e;
    }
    expect(errorText(en, error)).toBe('The formula is not complete (character 4)');
    expect(errorText(en, new Error('plain'))).toBe('plain');
  });

  test('relative dates read as words', () => {
    expect(dateSpecText(en, 'now')).toBe('now');
    expect(dateSpecText(en, 'now-365d')).toBe('365 day(s) ago');
    expect(dateSpecText(zh, 'now+2M')).toBe('2 个月后');
    expect(dateSpecText(en, '2024-01-31')).toBe('2024-01-31');
  });

  test('each kind is summed up in a line', () => {
    const rule = (kind, params, more) => ({ ...newRule(kind), params, ...more });
    expect(ruleSummary(en, rule('auto', {}))).toBe('Decided from the column type');
    expect(ruleSummary(en, rule('sequence', {
      start: 1, step: 1, prefix: 'ORD', suffix: '', pad: 6,
    }))).toBe('ORD000001, ORD000002…');
    expect(ruleSummary(en, rule('number', { min: 0, max: 1000, decimals: 0 })))
      .toBe('Whole number, 0 ~ 1000');
    expect(ruleSummary(en, rule('number', { min: 1, max: 9, decimals: 2 })))
      .toBe('1 ~ 9, 2 decimals');
    expect(ruleSummary(en, rule('date', { from: 'now-30d', to: 'now' })))
      .toBe('30 day(s) ago ~ now');
    expect(ruleSummary(en, rule('text', { min: 5, max: 20, charset: 'alnum' })))
      .toBe('5 ~ 20 characters, Letters and digits');
    expect(ruleSummary(en, rule('list', { items: [], order: 'random' }))).toBe('The list is empty');
    expect(ruleSummary(en, rule('list', {
      items: [{ value: 'A', weight: 3 }, { value: 'B' }, { value: 'C' }, { value: 'D' }],
      order: 'cycle',
    }))).toBe('A, B, C… 4 values, weighted, In turn');
    expect(ruleSummary(en, rule('pattern', { mask: 'A-####' }))).toBe('A-####');
    expect(ruleSummary(en, rule('dict', { dict: 'd1', use: 'name' }),
      { dicts: [{ id: 'd1', defKey: 'SEX', defName: 'Gender' }] })).toBe('Name of Gender');
    expect(ruleSummary(en, rule('dict', { use: 'key' }))).toBe('Code of dictionary of the column');
    expect(ruleSummary(zh, rule('builtin', { name: 'tw.mobile' }))).toBe('手机号码');
    expect(ruleSummary(en, rule('file', { path: '/tmp/a/names.csv', column: 1 })))
      .toBe('names.csv, column 2');
    expect(ruleSummary(en, rule('query', { sql: 'SELECT  ID\nFROM T' }))).toBe('SELECT ID FROM T');
    expect(ruleSummary(en, rule('expr', { expr: '[A] * 2' }))).toBe('[A] * 2');
    expect(ruleSummary(en, rule('constant', { value: 'Y' }, { nullRate: 10, unique: true })))
      .toBe('Always Y, NULL 10%, unique');
    RULE_KINDS.forEach(kind => expect(ruleSummary(zh, newRule(kind))).not.toBe(''));
  });

  test('the cell of a column names the rule in force', () => {
    const named = { id: 'r', name: 'Mobile', kind: 'builtin' };
    expect(effectiveLabel(zh, { rule: { kind: 'auto' }, source: 'auto' })).toBe('自动');
    expect(effectiveLabel(zh, { rule: named, source: 'field' })).toBe('Mobile');
    expect(effectiveLabel(zh, { rule: named, source: 'domain' })).toBe('Mobile（数据域）');
    expect(usageLabel(en, { fields: [], domains: [] })).toBe('Not used');
    expect(usageLabel(en, { fields: [1, 2], domains: [1] })).toBe('2 column(s), 1 domain(s)');
  });

  test('builtin groups and formula signatures cover everything the engine has', () => {
    expect(BUILTIN_GROUPS.reduce((all, g) => all.concat(g.names), []).sort())
      .toEqual([...BUILTIN_NAMES].sort());
    EXPR_FUNCTIONS.forEach((name) => {
      expect(EXPR_SIGNATURES[name]).toBeTruthy();
      // the example of a function is a formula that really runs
      expect(() => compileExpr(EXPR_SIGNATURES[name][1])).not.toThrow();
    });
  });
});

const project = () => {
  const mobile = { ...newRule('builtin'), id: 'r1', name: 'Mobile', params: { name: 'tw.mobile' } };
  const status = {
    ...newRule('list'), id: 'r2', name: 'Status', params: { items: [{ value: 'A' }] },
  };
  let ds = {
    domains: [{ id: 'd1', defKey: 'Phone', defName: 'Phone number' }],
    entities: [{
      id: 'e1',
      defKey: 'MEMBER',
      fields: [
        { id: 'f1', defKey: 'ID', type: 'INT', primaryKey: true, notNull: true },
        { id: 'f2', defKey: 'MOBILE', type: 'VARCHAR', len: 20, testData: { rule: 'r1', nullRate: 5 } },
        { id: 'f3', defKey: 'TEL', type: 'VARCHAR', len: 20, domain: 'd1' },
        { id: 'f4', defKey: 'STATUS', type: 'VARCHAR', len: 2, testData: { rule: 'r2' } },
      ],
    }],
  };
  ds = setTestData(ds, upsertRule(upsertRule(getTestData(ds), mobile), status));
  return setTestData(ds, setDomainRule(getTestData(ds), 'd1', 'r1'));
};

describe('library changes', () => {
  test('deleting a rule frees the columns and domains that used it and keeps a null rate', () => {
    const ds = project();
    expect(usageNames(ds, 'r1')).toEqual({ fields: ['MEMBER.MOBILE'], domains: ['Phone number'] });
    const next = deleteProjectRules(ds, ['r1', 'r2']);
    expect(getTestData(next).rules).toEqual([]);
    expect(getTestData(next).domainRules).toEqual({});
    const [, mobile, , status] = next.entities[0].fields;
    expect(mobile.testData).toEqual({ nullRate: 5 });
    expect('testData' in status).toBe(false);
    expect(ds.entities[0].fields[1].testData).toEqual({ rule: 'r1', nullRate: 5 });
  });

  test('copies get fresh ids and names that do not clash', () => {
    const ds = project();
    const rules = getTestData(ds).rules;
    const { rules: all, added } = addRules(rules, [rules[0]]);
    expect(all).toHaveLength(3);
    expect(added[0].name).toBe('Mobile (2)');
    expect(added[0].id).not.toBe('r1');
    const copied = addProjectRules(ds, [{ ...rules[0], id: 'x', name: 'Other' }]);
    expect(getTestData(copied.dataSource).rules.map(r => r.name))
      .toEqual(['Mobile', 'Status', 'Other']);
    expect(findTwin(rules, { ...rules[0], id: 'zzz' })).toBe(rules[0]);
    expect(findTwin(rules, { ...rules[0], id: 'zzz', nullRate: 3 })).toBeUndefined();
  });

  test('a name can be used once in a library', () => {
    const rules = getTestData(project()).rules;
    const draft = { ...newRule('constant'), name: ' mobile ', params: { value: 'x' } };
    expect(nameTaken(rules, draft)).toBe(true);
    expect(libraryProblems(draft, rules)).toEqual(['rule.name.duplicate']);
    expect(libraryProblems({ ...rules[0], name: 'Mobile' }, rules)).toEqual([]);
    expect(libraryProblems({ ...draft, name: '' }, rules)).toEqual(['rule.name.empty']);
  });

  test('the rule in force: the column, then its domain, then automatic', () => {
    const ds = project();
    const [id, mobile, tel] = ds.entities[0].fields;
    expect(effectiveRule(ds, mobile, mobile.testData)).toMatchObject({ source: 'field', nullRate: 5 });
    expect(effectiveRule(ds, mobile, undefined).source).toBe('auto');
    expect(effectiveRule(ds, tel, undefined)).toMatchObject({ source: 'domain', nullRate: 0 });
    expect(effectiveRule(ds, tel, { rule: 'r2' }).rule.name).toBe('Status');
    expect(effectiveRule(ds, tel, { rule: 'gone' }).source).toBe('domain');
    expect(effectiveRule(ds, id, { rule: 'r1', nullRate: 50 }).nullRate).toBe(0);
    expect(effectiveRule(bindDomain(ds, 'd1', ''), tel, undefined).source).toBe('auto');
  });

  test('what a column stores', () => {
    expect(fieldValue('r1', undefined)).toEqual({ rule: 'r1' });
    expect(fieldValue('', 20)).toEqual({ nullRate: 20 });
    expect(fieldValue('r1', 250)).toEqual({ rule: 'r1', nullRate: 100 });
    expect(fieldValue('', '')).toBeUndefined();
    expect(fieldValue('', undefined)).toBeUndefined();
  });

  test('a table open in a tab counts as it is on screen', () => {
    const ds = project();
    const tabs = {
      a: {
        type: 'entity',
        key: 'e1',
        isInit: false,
        data: { fields: [{ id: 'f9', defKey: 'NEW', testData: { rule: 'r2' } }] },
      },
      b: { type: 'entity', key: 'e1', isInit: true, data: { fields: [] } },
      c: { type: 'diagram', key: 'x', data: {} },
    };
    expect(usageNames(withOpenTabs(ds, tabs), 'r2').fields).toEqual(['MEMBER.NEW']);
    expect(withOpenTabs(ds, {})).toBe(ds);
  });

  test('what is not a rule is dropped from the machine library', () => {
    expect(cleanRules([null, 3, { id: 'a', kind: 'auto' }, { id: '', kind: 'auto' },
      { id: 'b', kind: 'foreign' }])).toEqual([{ id: 'a', kind: 'auto' }]);
    expect(cleanRules('x')).toEqual([]);
  });
});

describe('sample values', () => {
  const now = new Date(2024, 4, 15, 10, 0, 0);
  const sample = (rule, kind = 'string', more = {}) => sampleValues({
    rule, column: genericColumn(kind), now, ...more,
  });

  test('every kind a user can choose gives values with its default settings or says why not', () => {
    const outcome = RULE_KINDS.reduce((all, kind) => {
      const result = sample(newRule(kind));
      return { ...all, [kind]: result.error ? result.error.code : result.values.length };
    }, {});
    expect(outcome).toEqual({
      auto: SAMPLE_COUNT,
      sequence: SAMPLE_COUNT,
      number: SAMPLE_COUNT,
      date: SAMPLE_COUNT,
      text: SAMPLE_COUNT,
      list: 'list.items.empty',
      pattern: 'pattern.mask.empty',
      dict: 'dict.missing',
      builtin: SAMPLE_COUNT,
      file: 'file.path.empty',
      query: 'query.sql.empty',
      expr: 'expr.empty',
      constant: SAMPLE_COUNT,
    });
  });

  test('the same rule shows the same values, another seed shows others', () => {
    const rule = { ...newRule('builtin'), params: { name: 'tw.name' } };
    expect(sample(rule).values).toEqual(sample(rule).values);
    expect(sample(rule, 'string', { seed: 2 }).values).not.toEqual(sample(rule).values);
    sample(rule).values.forEach(v => expect(v).toMatch(/^[一-鿿]{2,4}$/));
  });

  test('values fit the column they are tried on', () => {
    const number = { ...newRule('number'), params: { min: 1, max: 5, decimals: 2 } };
    sample(number, 'int').values.forEach(v => expect(Number.isInteger(v)).toBe(true));
    sample({ ...newRule('date') }, 'date').values
      .forEach(v => expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/));
    expect(sample({ ...newRule('builtin'), params: { name: 'tw.name' } }, 'int').error.code)
      .toBe('value.type');
    expect(defaultGenericKind(number)).toBe('decimal');
    expect(defaultGenericKind(newRule('date'))).toBe('date');
    expect(defaultGenericKind({ kind: 'date', params: { from: '2024-01-01 08:00:00' } }))
      .toBe('datetime');
    expect(defaultGenericKind(newRule('list'))).toBe('string');
  });

  test('a list, a pattern and a file list', () => {
    const list = { ...newRule('list'), params: { items: [{ value: 'A' }, { value: 'B' }], order: 'cycle' } };
    expect(sample(list).values.slice(0, 4)).toEqual(['A', 'B', 'A', 'B']);
    const pattern = { ...newRule('pattern'), params: { mask: 'A-###' } };
    sample(pattern).values.forEach(v => expect(v).toMatch(/^[A-Z]-\d{3}$/));
    const file = { ...newRule('file'), params: { path: '/x.txt', column: 0, order: 'cycle' } };
    expect(sample(file).error.code).toBe('file.missing');
    expect(sample(file, 'string', { lists: { file: { '/x.txt': ['p', 'q'] } } }).values.slice(0, 3))
      .toEqual(['p', 'q', 'p']);
  });

  test('a formula reads the other columns of a real table', () => {
    const ds = project();
    const entity = ds.entities[0];
    const field = { id: 'f5', defKey: 'LABEL', type: 'VARCHAR', len: 50 };
    const withField = { ...ds, entities: [{ ...entity, fields: entity.fields.concat(field) }] };
    const rule = { ...newRule('expr'), params: { expr: 'concat([ID], \'-\', [MOBILE])' } };
    expect(sample(rule).error.code).toBe('sample.expr.needTable');
    const result = sampleValues({
      rule, column: genericColumn('string'), field, entity: withField.entities[0], dataSource: withField, now,
    });
    expect(result.error).toBeNull();
    expect(result.values[0]).toMatch(/^1-09\d{8}$/);
    expect(result.values[1]).toMatch(/^2-09\d{8}$/);
    const unknown = { ...newRule('expr'), params: { expr: '[NOPE] + 1' } };
    expect(sampleValues({
      rule: unknown, column: genericColumn('int'), field, entity: withField.entities[0], dataSource: withField,
    }).error).toMatchObject({ code: 'expr.column.unknown', detail: 'NOPE' });
    expect(sample({ ...newRule('expr'), params: { expr: 'seq() * 2' } }, 'int').values.slice(0, 3))
      .toEqual([2, 4, 6]);
    expect(sample({ ...newRule('expr'), params: { expr: '(1 + ' } }).error)
      .toMatchObject({ code: 'expr.end', pos: 5 });
  });

  test('the null rate shows as NULL on a column that allows it', () => {
    const rule = { ...newRule('constant'), params: { value: 'x' } };
    expect(sample(rule, 'string', { nullRate: 100 }).values.every(v => v === null)).toBe(true);
    expect(sampleValues({
      rule, column: { ...genericColumn('string'), notNull: true }, nullRate: 100,
    }).values.every(v => v === 'x')).toBe(true);
    expect(valueText(null)).toBe('NULL');
    expect(valueText(false)).toBe('false');
    expect(valueText(12.5)).toBe('12.5');
  });
});

describe('the list of a file rule', () => {
  test('one column of a text or CSV file, blanks left out', () => {
    expect(parseListText('a\nb\r\n\r\nc')).toEqual(['a', 'b', 'c']);
    expect(parseListText('﻿name,city\n"Lin, A",Taipei\n"say ""hi""",Tainan\n',
      { column: 0, header: true })).toEqual(['Lin, A', 'say "hi"']);
    expect(parseListText('name,city\nA,Taipei\nB,\n', { column: 1, header: true }))
      .toEqual(['Taipei']);
    expect(parseListText('a\tb\nc\td', { column: 1 })).toEqual(['b', 'd']);
    expect(parseListText('a\nb\nc', {}, 2)).toEqual(['a', 'b']);
    expect(parseRows('"multi\nline",x')).toEqual([['multi\nline', 'x']]);
    expect(listColumns('name,city\nA,B', true)).toEqual(['name', 'city']);
    expect(listColumns('name,city\nA,B', false)).toEqual(['1', '2']);
  });

  test('a file is read from disk, a missing or empty one is refused with a code', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-ui-'));
    const file = path.join(dir, 'list.csv');
    fs.writeFileSync(file, 'code,name\n001,甲\n002,乙\n');
    await expect(readListFile(file, { column: 1, header: true })).resolves.toEqual(['甲', '乙']);
    await expect(readListFile(file, { column: 5 })).rejects.toMatchObject({ code: 'file.empty' });
    await expect(readListFile(path.join(dir, 'none.csv'), {}))
      .rejects.toMatchObject({ code: 'file.read' });
    await expect(readListText(file, { maxBytes: 5 })).rejects.toMatchObject({ code: 'file.tooLarge' });
    await expect(readListText(file, { maxBytes: 12, partial: true })).resolves.toMatchObject({ text: 'code,name\n', encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('the rule column in the headers of a project', () => {
  const old = () => ({
    profile: {
      headers: [{ refKey: 'defKey' }, { refKey: 'uiHint', enable: true }, { refKey: 'extProps' }],
    },
    entities: [
      { id: 'e1', headers: [{ refKey: 'hideInGraph' }, { refKey: 'defKey' }, { refKey: 'extProps' }] },
      { id: 'e2', headers: [] },
    ],
    views: [{ id: 'v1', headers: [{ refKey: 'defKey' }] }],
  });

  test('a project made before the column gets it once, after the UI hint column', () => {
    const next = ensureTestDataHeader(old());
    expect(next.profile.headers.map(h => h.refKey)).toEqual(['defKey', 'uiHint', 'testData', 'extProps']);
    expect(next.profile.headers[2]).toEqual({
      refKey: 'testData', hideInGraph: true, freeze: false, enable: true,
    });
    expect(next.entities[0].headers.map(h => h.refKey))
      .toEqual(['hideInGraph', 'defKey', 'extProps', 'testData']);
    expect(next.entities[1].headers).toEqual([]);
    expect(next.views).toEqual(old().views);
    expect(ensureTestDataHeader(next)).toBe(next);
  });

  test('the templates shipped with the app open with the column', () => {
    const template = JSON.parse(read('src/lib/template/电商商城.pdma.json'));
    const next = ensureTestDataHeader(template);
    expect(next.profile.headers.some(h => h.refKey === 'testData')).toBe(true);
    next.entities.forEach(e => expect(e.headers.filter(h => h.refKey === 'testData')).toHaveLength(1));
    const empty = JSON.parse(read('src/lib/template/empty.json'));
    expect(empty.profile.headers.filter(h => h.refKey === 'testData')).toHaveLength(1);
    expect(ensureTestDataHeader(empty)).toBe(empty);
  });

  test('a rule kept in a draft passes the check the library uses', () => {
    expect(validateRule({ ...newRule('builtin'), name: 'x' }, { library: true })).toEqual([]);
  });
});
