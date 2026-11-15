// Values and their columns: what a column of each database can hold, values the automatic
// rule makes for special types, numbers and dates as text, and the builtin generators.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeValueGenerator, VALUE_ERROR_CODES } from '../src/lib/testdata/values';
import { createRandom } from '../src/lib/testdata/random';
import {
  makeFit, makeKeyFit, intRange, textLength,
} from '../src/lib/testdata/fit';
import { fieldColumn, typeTraits } from '../src/lib/testdata/columns';
import { compileExpr } from '../src/lib/testdata/expr';
import { validateRule, importRules, exportRules } from '../src/lib/testdata/model';
import { BUILTINS, TW_CITIES } from '../src/lib/testdata/builtin';
import {
  TW_COMPANY_HEADS, TW_COMPANY_TAILS, TW_COMPANY_KINDS,
} from '../src/lib/testdata/builtin_data';
import { buildPlan } from '../src/lib/testdata/plan';
import { createGenerator } from '../src/lib/testdata/generate';
import { csvField, csvLine, createCsvWriter } from '../src/lib/testdata/csv';
import { cellXml, excelSerial } from '../src/lib/testdata/xlsx';
import {
  field, entity, project, rule, collect,
} from './testdata_planner_helpers';

const now = new Date(2026, 10, 15, 10, 0, 0);
const dsOn = db => project([], {}, {
  profile: {
    default: { db: 'x' },
    dataTypeSupports: [{
      id: 'x',
      defKey: db,
    }],
  },
});
const columnOn = (db, type, more = {}) => fieldColumn(dsOn(db), field('C', type, more));
const gen = (r, column, n = 50, seed = 1) => {
  const make = makeValueGenerator(r, column, {
    random: createRandom(seed),
    now,
  });
  return Array.from({ length: n }, (x, i) => make(i, {}));
};
const codeOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return null;
};
const auto = { kind: 'auto' };

describe('S7: what a column takes depends on the database', () => {
  test('ranges of whole numbers', () => {
    const range = (db, type) => intRange(columnOn(db, type));
    expect(range('SQLServer', 'TINYINT')).toEqual({ min: 0, max: 255 });
    expect(range('MYSQL', 'TINYINT')).toEqual({ min: -128, max: 127 });
    expect(range('MYSQL', 'TINYINT UNSIGNED')).toEqual({ min: 0, max: 255 });
    expect(range('MYSQL', 'INT(10) UNSIGNED')).toEqual({ min: 0, max: 4294967295 });
    expect(range('MYSQL', 'SMALLINT')).toEqual({ min: -32768, max: 32767 });
    expect(range('MYSQL', 'INT(5)')).toEqual({ min: -2147483648, max: 2147483647 });
    expect(range('MYSQL', 'YEAR')).toEqual({ min: 1901, max: 2155 });
    expect(range('PostgreSQL', 'BIGINT').max).toBe(Number.MAX_SAFE_INTEGER);
    expect(intRange({ kind: 'int', type: 'TINYINT' })).toEqual({ min: 0, max: 127 });
    expect(typeTraits('int(10) unsigned zerofill').unsigned).toBe(true);
    expect(columnOn('MYSQL', 'INT UNSIGNED')).toMatchObject({ kind: 'int', unsigned: true });
  });

  test('a number outside the column is an error, never a clamped value', () => {
    const tiny = makeFit(columnOn('MYSQL', 'TINYINT'));
    expect(tiny(127)).toBe(127);
    expect(tiny(-128)).toBe(-128);
    expect(codeOf(() => tiny(128))).toBe('value.range');
    expect(makeFit(columnOn('SQLServer', 'TINYINT'))(255)).toBe(255);
    expect(codeOf(() => makeFit(columnOn('SQLServer', 'TINYINT'))(-1))).toBe('value.range');
    const money = makeFit(columnOn('MYSQL', 'DECIMAL', { len: 5, scale: 2 }));
    expect(money(999.994)).toBe(999.99);
    expect(codeOf(() => money(1000))).toBe('value.range');
    gen(auto, columnOn('SQLServer', 'TINYINT'), 500)
      .forEach(v => expect(v >= 0 && v <= 255).toBe(true));
  });

  test('a parent key goes into the child column whole or not at all', () => {
    expect(makeKeyFit(columnOn('MYSQL', 'VARCHAR', { len: 3 }))(425)).toBe('425');
    expect(codeOf(() => makeKeyFit(columnOn('MYSQL', 'VARCHAR', { len: 2 }))(425)))
      .toBe('foreignKeyFit');
    expect(codeOf(() => makeKeyFit(columnOn('MYSQL', 'TINYINT'))(500))).toBe('foreignKeyFit');
    expect(codeOf(() => makeKeyFit(columnOn('MYSQL', 'CHAR', { len: 2 }))('AB12')))
      .toBe('foreignKeyFit');
    expect(codeOf(() => makeKeyFit(columnOn('MYSQL', 'INT'))('K-1'))).toBe('foreignKeyFit');
    expect(makeKeyFit(columnOn('MYSQL', 'INT'))(7)).toBe(7);
    expect(makeKeyFit(columnOn('MYSQL', 'CHAR', { len: 4 }))('AB12')).toBe('AB12');
    expect(makeKeyFit(columnOn('MYSQL', 'INT'))(null)).toBe(null);
  });
});

describe('length of text per database', () => {
  // Assumptions: SQL Server VARCHAR/CHAR count bytes of a double byte code page (2 per
  // Chinese character), NVARCHAR counts UTF-16 units; Oracle VARCHAR2/CHAR count UTF-8
  // bytes unless the type says CHAR, NVARCHAR2 counts characters; MySQL and PostgreSQL
  // count characters.
  test('which unit a column counts in', () => {
    expect(columnOn('SQLServer', 'VARCHAR', { len: 10 }).lenUnit).toBe('dbcs');
    expect(columnOn('SQLServer', 'NVARCHAR', { len: 10 }).lenUnit).toBeUndefined();
    expect(columnOn('ORACLE', 'VARCHAR2', { len: 10 }).lenUnit).toBe('utf8');
    expect(columnOn('ORACLE', 'VARCHAR2(10 CHAR)').lenUnit).toBeUndefined();
    expect(columnOn('ORACLE', 'VARCHAR2(10 BYTE)')).toMatchObject({ len: 10, lenUnit: 'utf8' });
    expect(columnOn('ORACLE', 'NVARCHAR2', { len: 10 }).lenUnit).toBeUndefined();
    expect(columnOn('MYSQL', 'VARCHAR', { len: 10 }).lenUnit).toBeUndefined();
    expect(columnOn('PostgreSQL', 'VARCHAR', { len: 10 }).lenUnit).toBeUndefined();
  });

  test('Chinese text is cut to what the column really holds', () => {
    const text = '臺北市中正區忠孝路一段100號';
    const mssql = columnOn('SQLServer', 'VARCHAR', { len: 10 });
    const oracle = columnOn('ORACLE', 'VARCHAR2', { len: 10 });
    expect(makeFit(mssql)(text)).toBe('臺北市中正');
    expect(makeFit(oracle)(text)).toBe('臺北市');
    expect(makeFit(columnOn('SQLServer', 'NVARCHAR', { len: 10 }))(text)).toBe('臺北市中正區忠孝路一');
    expect(makeFit(columnOn('ORACLE', 'VARCHAR2(10 CHAR)'))(text)).toBe('臺北市中正區忠孝路一');
    expect(makeFit(oracle)('abcdefghijkl')).toBe('abcdefghij');
    expect(makeFit(oracle)('ab😀cd😀ef')).toBe('ab😀cd'); // 2 + 4 + 2, the next 4 do not fit
    expect(textLength('中a', mssql)).toBe(3);
    expect(textLength('中a', oracle)).toBe(4);
    // builtin and text rules stay inside the bytes
    const bytes = v => Buffer.byteLength(v, 'utf8');
    gen({ kind: 'builtin', params: { name: 'tw.address' } }, columnOn('ORACLE', 'VARCHAR2',
      { len: 30 }), 300).forEach(v => expect(bytes(v)).toBeLessThanOrEqual(30));
    const zh = gen({ kind: 'text', params: { min: 4, max: 20, charset: 'zh' } },
      columnOn('ORACLE', 'VARCHAR2', { len: 30 }), 300);
    zh.forEach(v => expect(bytes(v)).toBeLessThanOrEqual(30));
    expect(Math.max(...zh.map(v => v.length))).toBe(10);
    gen({ kind: 'text', params: { min: 4, max: 20, charset: 'zh' } }, mssql, 100)
      .forEach(v => expect(v.length).toBeLessThanOrEqual(5));
  });
});

describe('S4: the automatic rule for special types', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  test('UUID columns get UUIDs, also as a primary key', async () => {
    gen(auto, columnOn('PostgreSQL', 'UUID')).forEach(v => expect(v).toMatch(UUID));
    gen(auto, columnOn('SQLServer', 'UNIQUEIDENTIFIER', { primaryKey: true, notNull: true }))
      .forEach(v => expect(v).toMatch(UUID));
    const ds = project([entity('T', [field('ID', 'UUID', {
      primaryKey: true,
      notNull: true,
    })])], { settings: { tables: { T: { rows: 2000 } } } });
    const plan = buildPlan(ds, { entityIds: ['T'] });
    expect(plan.problems).toEqual([]);
    const { rows } = await collect(createGenerator(ds, plan, { seed: 1 }), 'T');
    rows.forEach(r => expect(r[0]).toMatch(UUID));
    expect(new Set(rows.map(r => r[0])).size).toBe(2000);
  });

  test('YEAR, ENUM, SET, JSON and INTERVAL', () => {
    gen(auto, columnOn('MYSQL', 'YEAR'), 300).forEach(v => expect(v >= 1976 && v <= 2026).toBe(true));
    const enumColumn = columnOn('MYSQL', "ENUM('new','paid','it''s')");
    expect(enumColumn).toMatchObject({
      subtype: 'enum',
      len: null,
      values: ['new', 'paid', "it's"],
    });
    expect(new Set(gen(auto, enumColumn, 200))).toEqual(new Set(['new', 'paid', "it's"]));
    // the values may also stand where the length goes
    expect(columnOn('MYSQL', 'ENUM', { len: "'a','b'" }).values).toEqual(['a', 'b']);
    expect(new Set(gen(auto, columnOn('MYSQL', "SET('x','y')"), 100))).toEqual(new Set(['x', 'y']));
    gen(auto, columnOn('MYSQL', 'JSON')).forEach((v) => {
      expect(Object.keys(JSON.parse(v))).toEqual(['id', 'name', 'active']);
    });
    expect(columnOn('PostgreSQL', 'JSONB').subtype).toBe('json');
    gen(auto, columnOn('PostgreSQL', 'INTERVAL')).forEach(v => expect(v)
      .toMatch(/^\d{1,2} \d\d:\d\d:\d\d$/));
    gen(auto, columnOn('ORACLE', 'INTERVAL DAY(2) TO SECOND(6)')).forEach(v => expect(v)
      .toMatch(/^\d{1,2} \d\d:\d\d:\d\d$/));
    gen(auto, columnOn('ORACLE', 'INTERVAL YEAR TO MONTH')).forEach(v => expect(v)
      .toMatch(/^\d{1,2}-\d{1,2}$/));
  });
});

describe('S9, M4, M5: numbers, dates and text', () => {
  const text = { kind: 'string', len: 50 };

  test('numbers are written without floating point residue', () => {
    expect(gen({ kind: 'sequence', params: { start: 0, step: 0.1 } }, text, 5))
      .toEqual(['0', '0.1', '0.2', '0.3', '0.4']);
    expect(gen({ kind: 'expr', params: { expr: '0.1+0.2' } }, text, 1)).toEqual(['0.3']);
    expect(gen({ kind: 'sequence', params: { start: 0, step: 0.1 } },
      { kind: 'decimal', len: 5, scale: 1 }, 4)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(makeFit(text)(1 / 3)).toBe('0.3333333333');
    expect(validateRule({ kind: 'sequence', params: { step: 0.00000000001 } }))
      .toEqual(['sequence.step.invalid']);
    expect(validateRule({ kind: 'sequence', params: { start: 1e17 } }))
      .toEqual(['sequence.start.invalid']);
    expect(validateRule({ kind: 'sequence', params: { start: 0.5, step: 0.25 } })).toEqual([]);
  });

  test('dates outside the years 1 to 9999 are refused, not garbled', () => {
    expect(validateRule({ kind: 'date', params: { from: 'now-999999y', to: 'now' } }, { now }))
      .toEqual(['date.from.invalid']);
    expect(validateRule({ kind: 'date', params: { from: 'now', to: 'now+999999y' } }, { now }))
      .toEqual(['date.to.invalid']);
    expect(validateRule({ kind: 'date', params: { from: 'now-2000y', to: 'now' } }, { now }))
      .toEqual([]);
    const run = expr => compileExpr(expr).run({}, 0, { now });
    expect(codeOf(() => run("addDays('2024-01-01', 99999999999)"))).toBe('expr.date.range');
    expect(codeOf(() => run("addDays('2024-01-01', 1e9)"))).toBe('expr.number');
    expect(codeOf(() => run("addMonths('2024-01-01', 9999999999)"))).toBe('expr.date.range');
    expect(codeOf(() => run("addHours('0001-01-01', -1)"))).toBe('expr.date.range');
    expect(run("addDays('9999-12-30', 1)")).toBe('9999-12-31');
  });

  test('a number or a date is never cut; text functions keep whole characters', () => {
    expect(codeOf(() => gen({ kind: 'number', params: { min: 0, max: 9, decimals: 2 } },
      { kind: 'string', len: 2 }))).toBe('value.length');
    expect(codeOf(() => gen({ kind: 'date', params: { from: '2024-01-01', to: '2024-12-31' } },
      { kind: 'string', len: 8 }))).toBe('value.length');
    gen({ kind: 'number', params: { min: 0, max: 9, decimals: 2 } }, { kind: 'string', len: 4 })
      .forEach(v => expect(v).toMatch(/^\d\.\d\d$/));
    // without a maximum the rule stays inside the column
    gen({ kind: 'number', params: { decimals: 2 } }, { kind: 'string', len: 6 })
      .forEach(v => expect(v).toMatch(/^\d{1,3}\.\d\d$/));
    const run = expr => compileExpr(expr).run({}, 0, { now });
    expect(run("substr('a😀b', 1, 2)")).toBe('a😀');
    expect(run("substr('a😀b', 2)")).toBe('😀b');
    expect(run("len('a😀b')")).toBe(3);
    expect(run("pad('😀', 3, 'x')")).toBe('xx😀');
    expect(run("substr('abcdef', 2, 3)")).toBe('bcd');
    expect(VALUE_ERROR_CODES).toEqual(expect.arrayContaining(['value.range', 'value.length',
      'value.null', 'sequence.fraction']));
  });
});

describe('M1, M2 and places: builtin generators', () => {
  // short names (leading part + kind) of well-known companies, the ones the first word
  // lists could put together included
  const WELL_KNOWN = ['聯發科技', '華新科技', '華泰電子', '冠德建設', '聯茂電子', '台達電子', '宏達國際',
    '聯強國際', '泰山企業', '達新工業', '華固建設', '宏盛建設', '大華建設', '聯華食品', '聯華實業', '永大機電',
    '華邦電子', '旺宏電子', '光寶科技', '南亞科技', '友達光電', '群創光電', '欣興電子', '台光電子', '健鼎科技',
    '景碩科技', '力成科技', '京元電子', '金像電子', '瑞儀光電', '瑞軒科技', '宏正科技', '宏全國際', '信邦電子',
    '信錦企業', '嘉聯益科技', '鼎元光電', '鼎翰科技', '廣達電腦', '廣宇科技', '廣運機械', '新唐科技', '大毅科技',
    '大同', '正隆', '正新橡膠', '正崴精密', '和碩聯合科技', '和大工業', '和益化學', '安國國際科技', '益登科技',
    '誠美材料', '德律科技', '茂矽電子', '茂迪', '茂達電子', '群光電子', '群聯電子', '毅嘉科技', '永豐餘',
    '永光化學', '永信藥品', '豐泰企業', '豐興鋼鐵', '盛群半導體', '順達科技', '順德工業', '泰豐輪胎', '泰銘實業',
    '隆達電子', '祥碩科技', '興農', '興富發建設', '利奇機械', '達方電子', '達運精密', '達興材料', '弘塑科技',
    '富邦', '富喬工業', '聯華電子', '聯詠科技', '聯亞光電', '聯合再生能源', '聯陽半導體', '聯嘉光電', '聯上實業',
    '嘉泥', '嘉澤端子', '信義房屋', '宏碁', '宏達電', '宏普建設', '宏遠興業', '冠軍建材', '銘異科技', '新光',
    '統一企業', '長榮海運', '遠東新世紀', '中華電信', '台灣積體電路', '鴻海精密', '華碩電腦', '緯創資通',
    '仁寶電腦', '英業達', '研華', '日月光', '國巨', '竹風建設', '松川精密', '曜越科技', '薇閣', '葳格國際'];

  test('tw.company cannot put together the name of a well-known company', () => {
    const names = new Set();
    TW_COMPANY_HEADS.forEach(a => TW_COMPANY_TAILS.forEach(b => TW_COMPANY_KINDS
      .forEach(k => names.add(a + b + k))));
    expect(names.size).toBe(TW_COMPANY_HEADS.length * TW_COMPANY_TAILS.length
      * TW_COMPANY_KINDS.length);
    const leads = new Set();
    TW_COMPANY_HEADS.forEach(a => TW_COMPANY_TAILS.forEach(b => leads.add(a + b)));
    // neither the whole short name nor its leading two characters
    expect(WELL_KNOWN.filter(n => names.has(n) || leads.has(n.slice(0, 2)))).toEqual([]);
    expect(new Set(TW_COMPANY_HEADS).size).toBe(TW_COMPANY_HEADS.length);
    expect(TW_COMPANY_HEADS.filter(c => TW_COMPANY_TAILS.includes(c))).toEqual([]);
    const random = createRandom(3);
    for (let i = 0; i < 2000; i += 1) {
      const name = BUILTINS['tw.company'](random);
      expect(name).toMatch(/^[\u4e00-\u9fff]{4}(股份有限公司|有限公司|企業社)$/);
      expect(names.has(name.slice(0, 4))).toBe(true);
    }
  });

  test('tw.taxId passes the old rule (divisible by 10) and the one of 2023 (by 5)', () => {
    // two checkers written apart from the generator
    const WEIGHTS = [1, 2, 1, 2, 1, 2, 4, 1];
    const sums = (id) => {
      const digits = id.split('').map(Number);
      const parts = digits.map((d, i) => String(d * WEIGHTS[i]).split('').map(Number)
        .reduce((a, b) => a + b, 0));
      const total = parts.reduce((a, b) => a + b, 0);
      // a 7 in the 7th place: 28 -> 10, counted as 1 or as 0
      return digits[6] === 7 ? [total - 10, total - 9] : [total];
    };
    const oldRule = id => /^\d{8}$/.test(id) && sums(id).some(s => s % 10 === 0);
    const newRule = id => /^\d{8}$/.test(id) && sums(id).some(s => s % 5 === 0);
    // a checker that does not know the special case at all
    const naive = id => sums(id.slice(0, 6) + (id[6] === '7' ? '0' : id[6]) + id[7])[0] % 10 === 0;
    expect([oldRule('04595257'), newRule('04595257'), oldRule('12345678')]).toEqual(
      [true, true, false]);
    const random = createRandom(11);
    const ids = Array.from({ length: 20000 }, () => BUILTINS['tw.taxId'](random));
    expect(ids.filter(id => !oldRule(id))).toEqual([]);
    expect(ids.filter(id => !newRule(id))).toEqual([]);
    expect(ids.filter(id => id[6] === '7' || !naive(id))).toEqual([]);
    expect(new Set(ids).size).toBeGreaterThan(19900);
  });

  test('city, district, postal code and address of one row are one place', async () => {
    const names = ['tw.city', 'tw.district', 'tw.zip', 'tw.address'];
    const ds = project([entity('T', [
      field('ID', 'INT', { primaryKey: true, notNull: true }),
      ...names.map((name, i) => field(`C${i}`, 'NVARCHAR', {
        len: 60,
        testData: { rule: name },
      })),
      field('NOTE', 'VARCHAR', { len: 10 }),
    ])], {
      rules: names.map(name => rule(name, 'builtin', { name })),
      settings: { tables: { T: { rows: 500 } } },
    });
    const { rows } = await collect(createGenerator(ds, buildPlan(ds, { entityIds: ['T'] }),
      { seed: 9 }), 'T');
    rows.forEach(([, city, district, zip, address]) => {
      const found = TW_CITIES.find(c => c.city === city);
      expect(found.districts).toContainEqual({
        name: district,
        zip,
      });
      expect(address.startsWith(city + district)).toBe(true);
    });
    expect(new Set(rows.map(r => r[1])).size).toBeGreaterThan(15);
    expect(new Set(rows.map(r => r[2])).size).toBeGreaterThan(150);
  });
});

describe('M3, M7, S6: files', () => {
  test('rules exported with a byte order mark are read', () => {
    const text = exportRules([{ id: 'a', name: 'n', kind: 'auto', params: {} }]);
    const result = importRules(`\uFEFF${text}`);
    expect(result.problems).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(importRules('\uFEFF').problems).toEqual([{ code: 'import.empty' }]);
  });

  test('CSV: formulas are only guarded when asked for', async () => {
    expect(csvField('=1+1')).toBe('=1+1');
    expect(['=1+1', '+1', '-1', '@x', 'a=b'].map(csvField)).toEqual(['=1+1', '+1', '-1', '@x', 'a=b']);
    const guard = { guardFormulas: true };
    expect(['=1+1', '+1', '-1', '@x', 'a=b', '\tx'].map(v => csvField(v, guard)))
      .toEqual(["'=1+1", "'+1", "'-1", "'@x", 'a=b', "'\tx"]);
    expect(csvField(-5, guard)).toBe('-5'); // a number stays a number
    expect(csvLine(['=a', 1], guard)).toBe("'=a,1\r\n");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-csv-'));
    const table = {
      defKey: 'T',
      columns: [{ defKey: 'A', kind: 'string' }],
    };
    const write = async (name, options) => {
      const writer = createCsvWriter(path.join(dir, name), options);
      await writer.beginTable(table);
      await writer.rows([['=SUM(A1)'], ['plain']]);
      await writer.endTable();
      await writer.close();
      return fs.readFileSync(path.join(dir, name, 'T.csv'), 'utf8');
    };
    expect(await write('plain')).toBe('\uFEFFA\r\n=SUM(A1)\r\nplain\r\n');
    expect(await write('guarded', guard)).toBe("\uFEFFA\r\n'=SUM(A1)\r\nplain\r\n");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('Excel: early dates and long whole numbers stay text', () => {
    expect(excelSerial('0001-01-01', 'date')).toBe(null);
    expect(excelSerial('0099-12-31', 'date')).toBe(null);
    expect(excelSerial('1900-02-28', 'date')).toBe(null);
    expect(excelSerial('1900-03-01', 'date')).toBe(61);
    expect(cellXml('A2', '0001-01-01', 'date')).toContain('<t xml:space="preserve">0001-01-01</t>');
    expect(cellXml('A2', 123456789012345, 'int')).toBe('<c r="A2"><v>123456789012345</v></c>');
    expect(cellXml('A2', 1234567890123456, 'int'))
      .toContain('t="inlineStr"><is><t xml:space="preserve">1234567890123456</t>');
    expect(cellXml('A2', -9007199254740991, 'int')).toContain('>-9007199254740991</t>');
    expect(cellXml('A2', 1.5e15, 'decimal')).toContain('t="inlineStr"');
    expect(cellXml('A2', 0.1234567890123456, 'decimal')).toContain('<v>0.1234567890123456</v>');
  });
});
