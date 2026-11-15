import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import langs from '../src/lang';
import {
  normalizeSettings, normalizeTable, patchTable, readSettings, writeSettings, seedOfRun,
  clockOfRun, withSeedBase, dayText, wholeNumber, MAX_ROWS, MAX_SEED,
} from '../src/app/container/tools/testdata/generate/settings';
import {
  PLAN_FIXES, RUN_CODES, FS_CODES, planProblemText, runErrorText, dbErrorParts, detailText,
  fixesOf, isBlocking,
} from '../src/app/container/tools/testdata/generate/problems';
import { NO_CONNECTION, PARENT_EMPTY } from '../src/app/container/tools/testdata/generate/needs';
import { problemKey } from '../src/app/container/tools/testdata/rules/ruleText';
import { VALUE_ERROR_CODES } from '../src/lib/testdata/values';
import {
  root, read, LANGS, tr, ruleTr, project,
} from './testdata_ui_generate_helpers';

describe('settings stored in the project', () => {
  test('defaults: 100 rows, a fixed seed of 1, no table settings', () => {
    expect(normalizeSettings(undefined)).toEqual({
      defaultRows: 100, seed: { fixed: true, value: 1 }, tables: {},
    });
    expect(normalizeSettings({ defaultRows: 'x', seed: 'y', tables: [] })).toEqual({
      defaultRows: 100, seed: { fixed: true, value: 1 }, tables: {},
    });
  });
  test('numbers are whole and inside their limits', () => {
    const s = normalizeSettings({
      defaultRows: 5000000, seed: { fixed: false, value: -4 },
    });
    expect(s.defaultRows).toBe(MAX_ROWS);
    expect(s.seed).toEqual({ fixed: false, value: 0 });
    expect(normalizeSettings({ defaultRows: 0 }).defaultRows).toBe(1);
    expect(normalizeSettings({ defaultRows: 2.5 }).defaultRows).toBe(100);
    expect(normalizeSettings({ seed: { value: MAX_SEED + 10 } }).seed.value).toBe(MAX_SEED);
    expect(wholeNumber('12', 0, 100)).toBe(12);
    expect(wholeNumber('', 0, 100)).toBeUndefined();
    expect(wholeNumber(true, 0, 100)).toBeUndefined();
  });
  test('a table keeps only what differs from the defaults', () => {
    expect(normalizeTable({ rows: '', autoIncrement: 'generate', startAt: 1 })).toEqual({});
    expect(normalizeTable({ rows: 20, autoIncrement: 'database', startAt: 500 })).toEqual({
      rows: 20, autoIncrement: 'database', startAt: 500,
    });
    expect(normalizeTable({ rows: 9999999 }).rows).toBe(MAX_ROWS);
    expect(normalizeTable({ autoIncrement: 'whatever' })).toEqual({});
    const s = normalizeSettings({ tables: { a: {}, b: { rows: 3 }, c: 'junk' } });
    expect(s.tables).toEqual({ b: { rows: 3 } });
  });
  test('a range still being typed is kept so that the plan can report it', () => {
    expect(normalizeTable({ perParent: { field: 'f', min: 5, max: 2 } }).perParent)
      .toEqual({ field: 'f', min: 5, max: 2 });
    expect(normalizeTable({ perParent: { field: 'f', min: '', max: 3 } }).perParent)
      .toEqual({ field: 'f', max: 3 });
    expect(normalizeTable({ perParent: { min: 1, max: 2 } })).toEqual({});
  });
  test('patchTable merges, removes keys set to undefined and drops empty tables', () => {
    let s = normalizeSettings({});
    s = patchTable(s, 't', { rows: 7 });
    s = patchTable(s, 't', { perParent: { field: 'f', min: 1, max: 2 } });
    expect(s.tables.t).toEqual({ rows: 7, perParent: { field: 'f', min: 1, max: 2 } });
    s = patchTable(s, 't', { perParent: undefined });
    expect(s.tables.t).toEqual({ rows: 7 });
    s = patchTable(s, 't', { rows: undefined });
    expect(s.tables).toEqual({});
  });
  test('settings go through the project and keep the rules beside them', () => {
    const ds = {
      profile: {
        x: 1,
        testData: { rules: [{ id: 'r', kind: 'auto' }], domainRules: { d: 'r' } },
      },
    };
    const next = writeSettings(ds, {
      ...readSettings(ds), defaultRows: 250, tables: { t: { rows: 9 } },
    });
    expect(next).not.toBe(ds);
    expect(next.profile.x).toBe(1);
    expect(next.profile.testData.rules).toHaveLength(1);
    expect(next.profile.testData.domainRules).toEqual({ d: 'r' });
    expect(readSettings(next)).toMatchObject({
      defaultRows: 250, seed: { fixed: true, value: 1 }, tables: { t: { rows: 9 } },
    });
    expect(ds.profile.testData.settings).toBeUndefined();
  });
  test('a fixed seed repeats, a free one changes; the clock of a fixed seed is the day', () => {
    const fixed = normalizeSettings({ seed: { fixed: true, value: 42 } });
    const free = normalizeSettings({ seed: { fixed: false, value: 42 } });
    expect(seedOfRun(fixed, 1)).toBe(42);
    expect(seedOfRun(fixed, 999)).toBe(42);
    expect(seedOfRun(free, 1000)).not.toBe(seedOfRun(free, 2000));
    const now = new Date(2026, 4, 6, 15, 30, 12);
    expect(clockOfRun(fixed, now)).toEqual(new Date(2026, 4, 6));
    expect(clockOfRun(free, now)).toBe(now);
    const based = normalizeSettings({ seed: { fixed: true, value: 42, baseDate: '2025-01-31' } });
    expect(based.seed.baseDate).toBe('2025-01-31');
    expect(clockOfRun(based, now)).toEqual(new Date(2025, 0, 31));
    expect(normalizeSettings({ seed: { baseDate: 'soon' } }).seed.baseDate).toBeUndefined();
    expect(dayText(now)).toBe('2026-05-06');
  });
  test('the day a fixed seed counts from is written down once and then kept', () => {
    const ds = { profile: { testData: { rules: [] } } };
    const first = withSeedBase(ds, new Date(2026, 4, 6, 9));
    expect(readSettings(first).seed).toEqual({ fixed: true, value: 1, baseDate: '2026-05-06' });
    expect(withSeedBase(first, new Date(2026, 5, 1))).toBe(first);
    const written = writeSettings(ds, { ...readSettings(ds), defaultRows: 5 },
      new Date(2026, 4, 7));
    expect(readSettings(written).seed.baseDate).toBe('2026-05-07');
    const free = writeSettings(ds, { ...readSettings(ds), seed: { fixed: false, value: 3 } });
    expect(readSettings(free).seed).toEqual({ fixed: false, value: 3 });
    expect(withSeedBase(free)).toBe(free);
  });
});

// ---- every code the engine can stop with has a text ------------------------------
const engineFiles = fs.readdirSync(path.join(root, 'src/lib/testdata'))
  .filter(f => /\.js$/.test(f) && !/^builtin_data/.test(f));
const codesIn = (source) => {
  const found = [];
  const add = code => !found.includes(code) && found.push(code);
  const calls = /\b(?:fail|report|missing|writerError|sqlError|problem|notice|warn)\(\s*'([A-Za-z][\w.]*)'/g;
  let m = calls.exec(source);
  while (m) {
    add(m[1]);
    m = calls.exec(source);
  }
  // code: 'x'  and  code: cond ? 'x' : 'y'
  const props = /\bcode:\s*([^,\n]*)/g;
  m = props.exec(source);
  while (m) {
    // of a choice only what stands behind the question mark is a code
    const span = m[1].includes('?') ? m[1].slice(m[1].indexOf('?')) : m[1];
    (span.match(/'([A-Za-z][\w.]*)'/g) || []).forEach(q => add(q.slice(1, -1)));
    m = props.exec(source);
  }
  return found;
};
const planFiles = engineFiles.filter(f => /^plan/.test(f));
const planCodes = planFiles.reduce((all, f) => all
  .concat(codesIn(read(`src/lib/testdata/${f}`))), []).filter((c, i, l) => l.indexOf(c) === i);
const engineCodes = engineFiles.filter(f => f !== 'db.js').reduce((all, f) => all
  .concat(codesIn(read(`src/lib/testdata/${f}`))), []).filter((c, i, l) => l.indexOf(c) === i);
// codes of the database tool: the list at the top of db.js, its constants and the Java sources
const dbSource = read('src/lib/testdata/db.js');
const NOT_CODES = ['DEFAULT_JVM', 'PROGRESS_INTERVAL', 'KILL_AFTER', 'STDERR_KEPT', 'MAIN',
  'IS_GENERATEDCOLUMN', 'IS_AUTOINCREMENT', 'SUCCESS', 'FAILED', 'UTF_8', 'ATOMIC_MOVE',
  'REPLACE_EXISTING', 'READ_COMMITTED', 'TYPE_FORWARD_ONLY', 'CONCUR_READ_ONLY', 'MAX_VALUE',
  'MIN_VALUE', 'TABLE_NAME', 'COLUMN_NAME', 'TABLE_SCHEM', 'TABLE_CAT', 'DATA_TYPE',
  'TYPE_NAME', 'COLUMN_SIZE', 'DECIMAL_DIGITS', 'IS_NULLABLE', 'ROUND_HALF_UP', 'HALF_UP',
  'NO_GENERATED_KEYS', 'EXECUTE_FAILED', 'SUCCESS_NO_INFO', 'ISO_LOCAL_DATE', 'ROOT'];
const javaDir = path.join(root, 'scripts/java/mypd');
const javaSource = fs.readdirSync(javaDir).filter(f => /^TestData.*\.java$/.test(f))
  .map(f => fs.readFileSync(path.join(javaDir, f), 'utf8')).join('\n');
const dbCodes = (dbSource.match(/\b[A-Z][A-Z]+(?:_[A-Z]+)+\b|\b(?:TIMEOUT|CONSTRAINT|CANCELLED)\b/g) || [])
  .concat(javaSource.match(/"(?:[A-Z]+_[A-Z_]+|TIMEOUT|CONSTRAINT)"/g).map(q => q.slice(1, -1)))
  .concat((javaSource.match(/\\"code\\":\\"([A-Z_]+)\\"/g) || [])
    .map(q => /([A-Z_]+)\\"$/.exec(q)[1]))
  .filter(c => !NOT_CODES.includes(c) && !/_$/.test(c))
  .filter((c, i, l) => l.indexOf(c) === i);

const hasText = (lang, code) => {
  const key = problemKey(code);
  return [_.get(langs[lang], ['testData', 'problem', key]),
    _.get(langs[lang], ['testData', 'notice', key]),
    _.get(langs[lang], ['testData', 'dbError', code]),
    _.get(langs[lang], ['testDataRule', 'problem', key])]
    .some(v => typeof v === 'string' && v.trim() !== '');
};

describe('messages of problems and errors', () => {
  test('the scan of the engine finds its codes', () => {
    ['entityNotFound', 'tooManyRows', 'autoIncrementParentKey', 'cycle', 'badRule',
      'perParentRange', 'uniqueImpossible'].forEach(c => expect(planCodes).toContain(c));
    ['uniqueExhausted', 'noParentRows', 'parentKeysMissing', 'testdata.writer.closed']
      .forEach(c => expect(engineCodes).toContain(c));
    ['VALUE_OUT_OF_RANGE', 'PERMISSION_DENIED', 'COLUMN_NOT_WRITABLE', 'JAVA_NOT_FOUND',
      'CANCELLED', 'SQL_NOT_SELECT', 'CONSTRAINT', 'TIMEOUT', 'LOGIN_FAILED',
      'IDENTITY_NOT_ADVANCED'].forEach(c => expect(dbCodes).toContain(c));
  });
  test.each(LANGS)('every code of the planner, the generator and the writers has a %s text',
    (lang) => {
      expect(engineCodes.filter(code => !hasText(lang, code))).toEqual([]);
      expect(RUN_CODES.concat(NO_CONNECTION, PARENT_EMPTY, 'missingParent', 'needsConnection')
        .concat(VALUE_ERROR_CODES).filter(code => !hasText(lang, code))).toEqual([]);
    });
  test.each(LANGS)('every code of the database tool has a %s text', (lang) => {
    expect(dbCodes.filter(code => !hasText(lang, code))).toEqual([]);
  });
  test.each(LANGS)('common file system errors have a %s text', (lang) => {
    expect(FS_CODES.filter(c => !_.get(langs[lang], ['testData', 'fsError', c]))).toEqual([]);
  });
  test('every problem of the plan offers something to do', () => {
    // notices do not stop a run and are shown beside their column
    const notices = Object.keys(langs.zh.testData.notice);
    planCodes.filter(code => !notices.includes(code)).forEach((code) => {
      expect([code, (PLAN_FIXES[code] || []).length > 0]).toEqual([code, true]);
    });
    expect(fixesOf({ code: 'somethingNew', entityId: 'e', fieldId: 'f' })).toEqual(['column']);
    expect(fixesOf({ code: 'somethingNew', entityId: 'e' })).toEqual(['table']);
  });
  test('a plan problem names its table, column and parent', () => {
    const ds = project();
    const zh = planProblemText(tr('zh'), ruleTr('zh'), {
      code: 'autoIncrementParentKey',
      entityId: 'orders',
      fieldId: 'o_user',
      detail: { refEntityId: 'users', refFieldId: 'u_id' },
    }, ds);
    expect(zh).toContain('ORDERS.O_USER');
    expect(zh).toContain('USERS.U_ID');
    expect(zh).not.toMatch(/\{\w+\}/);
    const en = planProblemText(tr('en'), ruleTr('en'), {
      code: 'tooManyRows', entityId: 'items', detail: { rows: 1500000, max: 1000000 },
    }, ds);
    expect(en).toBe('ITEMS would get 1,500,000 rows, more than the limit of 1,000,000 rows per table');
    const unique = planProblemText(tr('en'), ruleTr('en'), {
      code: 'uniqueImpossible',
      entityId: 'orders',
      fieldId: 'o_id',
      detail: { fields: ['o_id', 'o_no'], capacity: 10, rows: 100 },
    }, ds);
    expect(unique).toContain('O_ID, O_NO');
    expect(unique).toContain('10');
    const bad = planProblemText(tr('zh'), ruleTr('zh'), {
      code: 'badRule', entityId: 'users', fieldId: 'u_name', detail: ['file.path.empty'],
    }, ds);
    expect(bad).toContain('USERS.U_NAME');
    expect(bad).toContain(langs.zh.testDataRule.problem.file_path_empty);
  });
  test.each(LANGS)('no message of a known code leaves a placeholder unfilled (%s)', (lang) => {
    const ds = project();
    planCodes.forEach((code) => {
      const message = planProblemText(tr(lang), ruleTr(lang), {
        code,
        entityId: 'orders',
        fieldId: 'o_user',
        detail: code === 'badRule' ? ['rule.invalid'] : {
          refEntityId: 'users',
refFieldId: 'u_id',
rows: 5,
max: 3,
min: 9,
capacity: 2,
          fields: ['o_id'],
startAt: 1,
last: 300,
reason: 'foreignKeyFit: value.range: 500',
          nullRate: 5,
        },
      }, ds);
      expect([code, /\{\w+\}/.test(message), message.trim() !== '']).toEqual([code, false, true]);
    });
  });
  test('an unknown code shows the code and what came with it, never a blank', () => {
    const plan = planProblemText(tr('zh'), ruleTr('zh'), {
      code: 'brandNewCode', entityId: 'users', fieldId: 'u_name', detail: { limit: 5 },
    }, project());
    expect(plan).toContain('brandNewCode');
    expect(plan).toContain('USERS.U_NAME');
    expect(plan).toContain('limit: 5');
    const run = runErrorText(tr('en'), ruleTr('en'),
      Object.assign(new Error('Something odd happened'), { code: 'ODD_THING' }), project());
    expect(run).toContain('ODD_THING');
    expect(run).toContain('Something odd happened');
    expect(runErrorText(tr('en'), ruleTr('en'), { code: 'ODD' }, project())).toContain('ODD');
    expect(detailText([{ a: 1 }, 'x'])).toBe('a: 1, x');
    expect(detailText({ nested: { deep: 1 }, plain: 2 })).toBe('plain: 2');
  });
  test('errors of a run: engine codes, rule codes, the file system, plain errors', () => {
    const ds = project();
    const en = e => runErrorText(tr('en'), ruleTr('en'), e, ds);
    expect(en({
      code: 'uniqueExhausted', entityId: 'users', fieldId: 'u_name', row: 41,
    })).toBe('USERS.U_NAME ran out of unique values at row 42. Widen the rule or lower the number of rows');
    expect(en({ code: 'file.missing', entityId: 'users', fieldId: 'u_name' }))
      .toBe(`USERS.U_NAME: ${langs.en.testDataRule.problem.file_missing}`);
    expect(en({ code: 'ENOSPC', path: '/x' })).toBe('The disk is full');
    expect(en({ code: 'EACCES', path: '/x/y.sql' })).toBe('No permission to write /x/y.sql');
    expect(en({ code: 'EWHATEVER', path: '/x' })).toContain('EWHATEVER');
    expect(en(new Error('plain'))).toBe('plain');
    expect(en({ code: 'JAVA_NOT_FOUND', message: 'Java was not found' }))
      .toContain('Java was not found.');
  });
  test('an error of the database keeps its own message beside the explanation', () => {
    const parts = dbErrorParts(tr('zh'), {
      row: 7, code: 'VALUE_OUT_OF_RANGE', message: 'Arithmetic overflow error for type int',
    });
    expect(parts.text).toBe(langs.zh.testData.dbError.VALUE_OUT_OF_RANGE);
    expect(parts.raw).toBe('Arithmetic overflow error for type int');
    const unknown = dbErrorParts(tr('en'), { code: 'NEW_DB_CODE', message: 'ORA-99999: odd' });
    expect(unknown.text).toContain('NEW_DB_CODE');
    expect(unknown.raw).toBe('ORA-99999: odd');
    expect(dbErrorParts(tr('en'), {}).text).toBe(langs.en.testData.dbError.none);
  });
  test('a problem is blocking unless the engine says it is only a notice', () => {
    expect(isBlocking({ code: 'x' })).toBe(true);
    expect(isBlocking({ code: 'x', level: 'warning' })).toBe(false);
    expect(isBlocking({ code: 'x', blocking: false })).toBe(false);
  });
});
