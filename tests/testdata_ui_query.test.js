import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import langs from '../src/lang';
import { FINDING_CODES, SKIP_REASONS, checkAgainstModel } from '../src/lib/testdata/query_check';
import { checkWarnings } from '../src/lib/testdata/db';
import {
  findingText, skipText, warningText, placeText, errorCodeText, checkErrorParts, checkErrorLine,
  isCheckCode, sampleText, timeText, connWhere, statusText,
} from '../src/app/container/tools/testdata/rules/queryText';
import {
  queryState, needsReminder, runCheck, chooseConn, checkConn, retryJava, resetQuerySession,
  onSessionChange, setAppConfig,
} from '../src/app/container/tools/testdata/rules/querySession';

const LANGS = ['zh', 'en', 'zhTW'];
const sayIn = lang => (id, data) => {
  const text = _.get(langs[lang], id, '');
  return typeof text === 'string' && data
    ? text.replace(/\{(\w+)\}/g, (all, name) => (data[name] === undefined ? all : data[name])) : text;
};
const root = path.resolve(__dirname, '..');
const keyPaths = (o, pre = '') => Object.keys(o).reduce((p, k) => {
  const v = o[k];
  return p.concat(v && typeof v === 'object' ? keyPaths(v, `${pre}${k}.`) : `${pre}${k}`);
}, []).sort();

// every code the database tool can answer with, read from its sources as the generate window
// does: the Java tool and the list at the top of db.js
const javaDir = path.join(root, 'scripts/java/mypd');
const javaSource = fs.readdirSync(javaDir).filter(f => /^TestData.*\.java$/.test(f))
  .map(f => fs.readFileSync(path.join(javaDir, f), 'utf8')).join('\n');
const toolCodes = javaSource.match(/"(?:[A-Z]+_[A-Z_]+|TIMEOUT|CONSTRAINT)"/g)
  .map(c => c.slice(1, -1))
  .filter(c => !/_$/.test(c) && !['IS_GENERATEDCOLUMN', 'IS_AUTOINCREMENT', 'TABLE_NAME',
    'COLUMN_NAME', 'TABLE_SCHEM', 'TABLE_CAT', 'DATA_TYPE', 'TYPE_NAME', 'COLUMN_SIZE',
    'DECIMAL_DIGITS', 'IS_NULLABLE'].includes(c))
  .concat('JAVA_NOT_FOUND', 'TOOL_FAILED', 'CANCELLED')
  .filter((c, i, l) => l.indexOf(c) === i);

describe('language pack of the query checks', () => {
  test('the three languages have the same keys and no empty text', () => {
    expect(keyPaths(langs.en.testDataQuery)).toEqual(keyPaths(langs.zh.testDataQuery));
    expect(keyPaths(langs.zhTW.testDataQuery)).toEqual(keyPaths(langs.zh.testDataQuery));
    LANGS.forEach(lang => keyPaths(langs[lang].testDataQuery).forEach((key) => {
      expect([lang, key, `${_.get(langs[lang].testDataQuery, key)}`.trim() !== ''])
        .toEqual([lang, key, true]);
    }));
  });

  test('Traditional Chinese uses the words of Taiwan', () => {
    const text = JSON.stringify(langs.zhTW.testDataQuery);
    ['数据', '字段', '项目', '连接', '檢查透過', '許可權', '語句', '視窗化', '地址', '保存']
      .forEach(word => expect([word, text.includes(word)]).toEqual([word, false]));
    ['資料表', '欄位', '專案', '資料庫', '連線', '儲存'].forEach(word => expect(text).toContain(word));
  });

  test.each(LANGS)('every finding, reason and warning has a %s text', (lang) => {
    const say = sayIn(lang);
    expect(FINDING_CODES.length).toBe(5);
    FINDING_CODES.forEach((code) => {
      const text = findingText(say, { code, name: 'NAME_X', table: 'TABLE_Y', tables: ['A', 'B'] });
      expect([code, text.includes('NAME_X'), /\{\w+\}/.test(text)]).toEqual([code, true, false]);
    });
    SKIP_REASONS.forEach((reason) => {
      const text = skipText(say, reason);
      expect([reason, say(`testDataQuery.model.reason.${reason}`) !== '' && text !== ''
        && !/\{\w+\}/.test(text)]).toEqual([reason, true]);
    });
    ['warning', 'info'].forEach(s => expect(say(`testDataQuery.model.severity.${s}`)).not.toBe(''));
    const warnings = checkWarnings({ columns: [{}, {}], sample: [null, 1, 1] })
      .concat(checkWarnings({ columns: [{}], sample: [] }));
    expect(warnings.map(w => w.code).sort())
      .toEqual(['duplicateValues', 'multipleColumns', 'noRows', 'nullValues']);
    warnings.forEach((w) => {
      const text = warningText(say, w);
      expect([w.code, text !== '' && !/\{\w+\}/.test(text)]).toEqual([w.code, true]);
    });
  });

  test.each(LANGS)('every code of the database tool has a %s text in a failed check', (lang) => {
    const say = sayIn(lang);
    expect(toolCodes).toEqual(expect.arrayContaining(['SQL_SYNTAX', 'TABLE_MISSING',
      'COLUMN_MISSING', 'PERMISSION_DENIED', 'TIMEOUT', 'SQL_ERROR', 'CONNECT_FAILED', 'LOGIN_FAILED',
      'DRIVER_MISSING', 'SQL_NOT_SELECT', 'SQL_MULTIPLE', 'SQL_FORBIDDEN', 'JAVA_NOT_FOUND']));
    const unknown = say('testData.dbError.unknown', { code: 'X' }).replace('X', '');
    toolCodes.forEach((code) => {
      const text = errorCodeText(say, code);
      expect([code, text !== '' && !text.includes(code) && !/\{\w+\}/.test(text)
        && text !== unknown.replace('', code)]).toEqual([code, true]);
      expect([code, isCheckCode(say, code)]).toEqual([code, true]);
    });
    ['TABLE_MISSING', 'COLUMN_MISSING', 'PERMISSION_DENIED'].forEach((code) => {
      expect(errorCodeText(say, code, 'T_NOPE')).toContain('T_NOPE');
      expect(errorCodeText(say, code)).not.toMatch(/\{object\}/);
    });
    expect(errorCodeText(say, 'SOMETHING_NEW')).toContain('SOMETHING_NEW');
    expect(isCheckCode(say, 'NO_CONNECTION')).toBe(false);
    expect(isCheckCode(say, '')).toBe(false);
  });
});

describe('words of a failed check', () => {
  const en = sayIn('en');
  const tw = sayIn('zhTW');
  test('the object, the place and the message of the database', () => {
    const error = {
      code: 'COLUMN_MISSING',
      message: 'ERROR: column c.nope does not exist',
      object: 'c.nope',
      position: { offset: 17, line: 2, column: 3 },
      sqlState: '42703',
    };
    expect(checkErrorParts(en, error)).toEqual({
      code: 'COLUMN_MISSING',
      kind: 'failed',
      title: 'The database did not accept the query',
      text: 'Column c.nope does not exist in the database',
      object: 'c.nope',
      position: error.position,
      place: 'line 2, character 3',
      near: '',
      raw: 'ERROR: column c.nope does not exist',
    });
    expect(checkErrorLine(en, error)).toBe('Column c.nope does not exist in the database '
      + '(line 2, character 3) (ERROR: column c.nope does not exist)');
    expect(checkErrorLine(tw, error)).toBe('資料庫裡沒有欄位 c.nope（第 2 行第 3 個字元）'
      + '（ERROR: column c.nope does not exist）');
    expect(placeText(en, { offset: 9, line: 2, column: 1, lineOnly: true })).toBe('line 2');
    expect(placeText(en, undefined)).toBe('');
  });
  test('a refusal before the database and a failed connection are told apart', () => {
    const refused = checkErrorParts(en, { code: 'SQL_NOT_SELECT', message: 'The query must start with SELECT or WITH' });
    expect(refused).toMatchObject({ kind: 'refused', title: 'This query cannot be run', raw: '' });
    expect(refused.text).toBe('Only SELECT queries can be run');
    const down = checkErrorParts(en, { code: 'CONNECT_FAILED', message: 'Connection refused' });
    expect(down).toMatchObject({ kind: 'notRun', title: 'The check could not be made', raw: 'Connection refused' });
    expect(checkErrorParts(en, { code: 'SQL_SYNTAX', message: "near 'x'", near: 'x' }))
      .toMatchObject({ kind: 'failed', near: 'x', place: '' });
    expect(checkErrorLine(en, { code: 'SQL_SYNTAX', near: 'FORM' }))
      .toBe('The SQL syntax is not correct (near FORM)');
    expect(checkErrorParts(en, { message: 'boom' }).text).toBe('boom');
    expect(checkErrorParts(en, undefined).text).not.toBe('');
    expect(checkErrorParts(en, { code: 'JAVA_NOT_FOUND', message: 'Java was not found' }).raw).toBe('');
  });
  test('values, time and the place of a connection', () => {
    expect(sampleText(null)).toBe('NULL');
    expect(sampleText(12.5)).toBe('12.5');
    expect(sampleText('x'.repeat(80))).toHaveLength(61);
    expect(timeText(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('03:04:05');
    expect(connWhere({ name: 'n', host: 'h:1', database: 'db' })).toBe('h:1 / db');
    expect(connWhere({ name: 'n', host: '', database: '', address: 'jdbc:x' })).toBe('jdbc:x');
    expect(connWhere(null)).toBe('');
    expect(statusText(en, { state: 'unchecked' })).toBe('The database has not checked this query yet');
    expect(statusText(en, { entry: { status: 'ok', at: new Date(2026, 0, 2, 3, 4, 5).getTime(), conn: 'Dev' } }))
      .toBe('Passed at 03:04:05 on "Dev"');
  });
  test('the model finding of the bundled example reads as a sentence', () => {
    const ds = { entities: [{ defKey: 'T_ORDER', fields: [{ defKey: 'ID' }] }] };
    const [item] = checkAgainstModel('SELECT IDD FROM T_ORDER', ds).findings;
    expect(findingText(en, item)).toBe('Table T_ORDER of the project model has no column IDD');
    expect(findingText(tw, item)).toBe('專案模型的資料表 T_ORDER 沒有欄位 IDD');
    expect(findingText(tw, checkAgainstModel('SELECT ID FROM T_ORDR', ds).findings[0]))
      .toBe('專案模型裡沒有資料表 T_ORDR（資料庫裡可能仍然有）');
  });
});

describe('what is remembered about checks while the app is open', () => {
  const conn = (key, more = {}) => ({
    defKey: key,
    defName: `Conn ${key}`,
    properties: {
      driver_class_name: 'org.postgresql.Driver', url: `jdbc:postgresql://127.0.0.1:5432/${key}`, username: 'u', password: 'p', ...more,
    },
  });
  const project = (conns, def) => ({ dbConn: conns, profile: { default: { dbConn: def || '' } } });
  const ds = project([conn('a'), conn('b')], 'b');
  const rule = (sql, kind = 'query') => ({ id: 'r', name: 'r', kind, params: { sql } });
  const answer = (result, error) => (dataSource, config, c, sql, options) => {
    const promise = error ? Promise.reject(error) : Promise.resolve(result);
    promise.cancel = () => {};
    promise.args = { config, c, sql, options };
    return promise;
  };
  const accepted = { ok: true, columns: [{ name: 'ID' }], sample: [1], warnings: [] };
  beforeEach(() => resetQuerySession());

  test('the connection in use: chosen, default, the only one, the first', () => {
    expect(checkConn(ds).defKey).toBe('b');
    chooseConn('a');
    expect(checkConn(ds).defKey).toBe('a');
    chooseConn('gone');
    expect(checkConn(ds).defKey).toBe('b');
    expect(checkConn(project([conn('x')])).defKey).toBe('x');
    expect(checkConn(project([conn('x'), conn('y')])).defKey).toBe('x');
    expect(checkConn(project([]))).toBe(null);
    expect(checkConn({})).toBe(null);
  });

  test('states without a check', () => {
    expect(queryState({}, 'SELECT 1')).toEqual({ state: 'noConnection', conn: null, target: null });
    expect(queryState(project([conn('a', { url: '' })]), 'SELECT 1').state).toBe('incomplete');
    const state = queryState(ds, 'SELECT 1');
    expect(state).toMatchObject({ state: 'unchecked', entry: null });
    expect(state.target).toMatchObject({ name: 'Conn b', host: '127.0.0.1:5432', database: 'b' });
    expect(JSON.stringify(state.target)).not.toContain('"p"');
  });

  test('a check is remembered by the exact SQL and the connection', async () => {
    setAppConfig({ javaHome: '/java' });
    let calls = 0;
    const stop = onSessionChange(() => { calls += 1; });
    const run = runCheck(ds, 'SELECT ID FROM T', { check: answer(accepted) });
    const entry = await run;
    expect(entry).toMatchObject({ status: 'ok', conn: 'Conn b', result: accepted });
    expect(typeof entry.at).toBe('number');
    expect(calls).toBe(1);
    expect(queryState(ds, 'SELECT ID FROM T')).toMatchObject({ state: 'ok', entry });
    expect(queryState(ds, 'SELECT ID FROM T ').state).toBe('unchecked');
    expect(queryState(ds, 'select id from t').state).toBe('unchecked');
    chooseConn('a');
    expect(queryState(ds, 'SELECT ID FROM T').state).toBe('unchecked');
    chooseConn('b');
    // the same key with another address is another database
    const moved = project([conn('a'), conn('b', { url: 'jdbc:postgresql://127.0.0.1:5432/other' })], 'b');
    expect(queryState(moved, 'SELECT ID FROM T').state).toBe('unchecked');
    const failed = await runCheck(ds, 'SELECT X FROM T', {
      check: answer(null, Object.assign(new Error('no such column'), { code: 'COLUMN_MISSING' })),
    });
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'COLUMN_MISSING' } });
    expect(queryState(ds, 'SELECT X FROM T').state).toBe('failed');
    stop();
    resetQuerySession();
    expect(queryState(ds, 'SELECT ID FROM T').state).toBe('unchecked');
  });

  test('the settings of the app and the limits reach the check', () => {
    setAppConfig({ javaHome: '/java' });
    let seen;
    const check = (...args) => {
      seen = args;
      return answer(accepted)(...args);
    };
    return runCheck(ds, 'SELECT 1', { check }).then(() => {
      expect(seen[1]).toEqual({ javaHome: '/java' });
      expect(seen[2].defKey).toBe('b');
      expect(seen[4].timeout).toBeGreaterThan(0);
      expect(seen[4].sample).toBe(5);
    });
  });

  test('a cancelled check is not remembered; missing Java is', async () => {
    const cancelled = Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
    await expect(runCheck(ds, 'SELECT 1', { check: answer(null, cancelled) })).rejects.toBe(cancelled);
    expect(queryState(ds, 'SELECT 1').state).toBe('unchecked');
    const noJava = Object.assign(new Error('Java was not found'), { code: 'JAVA_NOT_FOUND' });
    expect((await runCheck(ds, 'SELECT 1', { check: answer(null, noJava) })).status).toBe('failed');
    expect(queryState(ds, 'SELECT 2').state).toBe('noJava');
    expect(queryState(ds, 'SELECT 1').state).toBe('failed');
    retryJava();
    expect(queryState(ds, 'SELECT 2').state).toBe('unchecked');
    await runCheck(ds, 'SELECT 3', { check: answer(null, noJava) });
    await runCheck(ds, 'SELECT 4', { check: answer(accepted) });
    expect(queryState(ds, 'SELECT 5').state).toBe('unchecked');
  });

  test('when saving reminds', async () => {
    // other kinds of rule and an empty query (reported as a problem instead) never
    expect(needsReminder(rule('SELECT 1', 'list'), null, ds)).toBe(false);
    expect(needsReminder(rule('  '), null, ds)).toBe(false);
    expect(needsReminder(null, null, ds)).toBe(false);
    // a new rule, a changed query, a rule that became a query
    expect(needsReminder(rule('SELECT 1'), null, ds)).toBe(true);
    expect(needsReminder(rule('SELECT 2'), rule('SELECT 1'), ds)).toBe(true);
    expect(needsReminder(rule('SELECT 1'), rule('SELECT 1', 'list'), ds)).toBe(true);
    // a stored query nobody touched: renaming it does not nag, with or without a connection
    expect(needsReminder({ ...rule('SELECT 1'), name: 'renamed' }, rule('SELECT 1'), ds)).toBe(false);
    expect(needsReminder(rule('SELECT 1'), rule('SELECT 1'), {})).toBe(false);
    // no connection: still reminded, saving stays possible
    expect(needsReminder(rule('SELECT 1'), null, {})).toBe(true);
    // accepted in this session: no reminder; failed: reminder
    await runCheck(ds, 'SELECT 1', { check: answer(accepted) });
    expect(needsReminder(rule('SELECT 1'), null, ds)).toBe(false);
    expect(needsReminder(rule('SELECT 1 '), null, ds)).toBe(true);
    await runCheck(ds, 'SELECT 9', {
      check: answer(null, Object.assign(new Error('x'), { code: 'SQL_SYNTAX' })),
    });
    expect(needsReminder(rule('SELECT 9'), null, ds)).toBe(true);
  });
});
