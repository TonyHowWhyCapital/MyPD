import { compileExpr, checkExpr, exprColumns, EXPR_FUNCTIONS } from '../src/lib/testdata/expr';
import { createRandom } from '../src/lib/testdata/random';
import {
  parseDateTime, parseTime, formatDate, formatDateTime, addMonths, resolveDateSpec, naiveNow,
  compileMask, maskProblem,
} from '../src/lib/testdata/pattern';

const now = new Date(2026, 0, 15, 10, 30, 45);
const env = () => ({ random: createRandom(7), now });
const run = (text, row = {}, rowIndex = 0) => compileExpr(text).run(row, rowIndex, env());
const codeOf = (text) => {
  const problem = checkExpr(text);
  return problem && problem.code;
};

describe('expr: values and operators', () => {
  test('literals', () => {
    expect(run('42')).toBe(42);
    expect(run('4.5')).toBe(4.5);
    expect(run('.5')).toBe(0.5);
    expect(run("'it''s'")).toBe("it's");
    expect(run('"a"')).toBe('a');
    expect(run('true')).toBe(true);
    expect(run('NULL')).toBe(null);
  });

  test('arithmetic precedence and parentheses', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('10 - 4 - 3')).toBe(3);
    expect(run('7 % 4')).toBe(3);
    expect(run('-3 + 5')).toBe(2);
    expect(run('2 * -3')).toBe(-6);
    expect(run('8 / 2 / 2')).toBe(2);
  });

  test('division by zero and NULL give NULL', () => {
    expect(run('1 / 0')).toBe(null);
    expect(run('1 % 0')).toBe(null);
    expect(run('[A] + 1', { A: null })).toBe(null);
    expect(run('[MISSING] * 2', {})).toBe(null);
    expect(run('-[A]', { A: null })).toBe(null);
  });

  test('numeric strings are numbers in arithmetic, other text is an error', () => {
    expect(run('[A] + 1', { A: '41' })).toBe(42);
    let error;
    try {
      run('[A] + 1', { A: 'abc' });
    } catch (e) {
      error = e;
    }
    expect(error.code).toBe('expr.type');
  });

  test('concat with & and concat()', () => {
    expect(run("'A' & 1 & 'B'")).toBe('A1B');
    expect(run("'x' & [A]", { A: null })).toBe('x');
    expect(run("concat('a', 1.5, true)")).toBe('a1.5true');
    expect(run('0.1 + 0.2 & \'\'')).toBe('0.3');
    expect(run("1 + 2 & 'x'")).toBe('3x');
  });

  test('comparisons', () => {
    expect(run('1 < 2')).toBe(true);
    expect(run('2 <= 2')).toBe(true);
    expect(run('3 > 4')).toBe(false);
    expect(run('3 >= 4')).toBe(false);
    expect(run('1 = 1')).toBe(true);
    expect(run('1 == 2')).toBe(false);
    expect(run('1 <> 2')).toBe(true);
    expect(run('1 != 1')).toBe(false);
    expect(run("'10' > 9")).toBe(true);
    expect(run("'b' > 'a'")).toBe(true);
    expect(run("[D] < '2026-01-01'", { D: '2025-12-31' })).toBe(true);
    expect(run('[A] = null', { A: null })).toBe(true);
    expect(run('[A] <> 1', { A: null })).toBe(true);
    expect(run('[A] < 1', { A: null })).toBe(false);
  });

  test('column references', () => {
    expect(run('[PRICE] * [QTY]', { PRICE: 12.5, QTY: 4 })).toBe(50);
    expect(run('[ 訂單 編號 ]', { '訂單 編號': 'x' })).toBe('x');
    expect(exprColumns('[A] + [B] * [A]')).toEqual(['A', 'B']);
    expect(exprColumns("if([X] > 0, [Y], 'n')")).toEqual(['X', 'Y']);
    expect(exprColumns('1 +')).toEqual([]);
    expect(exprColumns(undefined)).toEqual([]);
  });
});

describe('expr: functions', () => {
  test('every documented function exists', () => {
    EXPR_FUNCTIONS.forEach((name) => {
      const problem = checkExpr(`${name}()`);
      expect(problem === null || problem.code === 'expr.function.args').toBe(true);
    });
  });

  test('math', () => {
    expect(run('round(2.567, 2)')).toBe(2.57);
    expect(run('round(1.005, 2)')).toBe(1.01);
    expect(run('round(2.5)')).toBe(3);
    expect(run('round(-2.5)')).toBe(-3);
    expect(run('floor(2.9)')).toBe(2);
    expect(run('ceil(2.1)')).toBe(3);
    expect(run('abs(-4)')).toBe(4);
    expect(run('min(3, 1, 2)')).toBe(1);
    expect(run('max(3, 1, 2)')).toBe(3);
    expect(run('abs([A])', { A: null })).toBe(null);
  });

  test('text', () => {
    expect(run("upper('abc')")).toBe('ABC');
    expect(run("lower('ABC')")).toBe('abc');
    expect(run("substr('abcdef', 2, 3)")).toBe('bcd');
    expect(run("substr('abcdef', 4)")).toBe('def');
    expect(run("substr('abc', 0, 2)")).toBe('ab');
    expect(run("len('abcd')")).toBe(4);
    expect(run('len([A])', { A: null })).toBe(0);
    expect(run('pad(7, 3)')).toBe('007');
    expect(run("pad('ab', 5, '*')")).toBe('***ab');
    expect(run("pad('abcdef', 3, '0')")).toBe('abcdef');
    expect(run("'ORD' & pad(seq(), 6, '0')", {}, 122)).toBe('ORD000123');
  });

  test('if is lazy and logic helpers work', () => {
    expect(run("if(1 < 2, 'y', 'n')")).toBe('y');
    expect(run("if([A] > 5, 'big', 'small')", { A: 3 })).toBe('small');
    expect(run("if(true, 1, 1 + 'abc')")).toBe(1);
    expect(run('and(1 < 2, 2 < 3)')).toBe(true);
    expect(run('or(1 > 2, 2 > 3)')).toBe(false);
    expect(run('not(1 > 2)')).toBe(true);
    expect(run('IF(TRUE, 1, 2)')).toBe(1);
  });

  test('rand is seeded and inside its bounds', () => {
    const compiled = compileExpr('rand(1, 6)');
    const a = env();
    const b = env();
    const first = [];
    const second = [];
    for (let i = 0; i < 200; i += 1) {
      first.push(compiled.run({}, i, a));
      second.push(compiled.run({}, i, b));
    }
    expect(first).toEqual(second);
    expect(first.every(v => Number.isInteger(v) && v >= 1 && v <= 6)).toBe(true);
    expect(new Set(first).size).toBe(6);
    const real = run('rand(0.5, 1.5)');
    expect(real >= 0.5 && real < 1.5).toBe(true);
    const unit = run('rand()');
    expect(unit >= 0 && unit < 1).toBe(true);
  });

  test('seq is the 1-based row number', () => {
    expect(run('seq()', {}, 0)).toBe(1);
    expect(run('seq() * 10', {}, 4)).toBe(50);
  });

  test('date arithmetic on canonical strings', () => {
    expect(run("addDays('2026-01-31', 1)")).toBe('2026-02-01');
    expect(run("addDays('2024-02-28', 1)")).toBe('2024-02-29');
    expect(run("addDays('2026-03-01', -1)")).toBe('2026-02-28');
    expect(run("addDays('2026-01-31 08:00:00', 1)")).toBe('2026-02-01 08:00:00');
    expect(run("addMonths('2026-01-31', 1)")).toBe('2026-02-28');
    expect(run("addMonths('2024-01-31', 1)")).toBe('2024-02-29');
    expect(run("addMonths('2026-03-15', -3)")).toBe('2025-12-15');
    expect(run("addMonths('2026-11-30 12:00:00', 3)")).toBe('2027-02-28 12:00:00');
    expect(run("addHours('2026-01-31 23:30:00', 1)")).toBe('2026-02-01 00:30:00');
    expect(run("addHours('2026-01-31', 36)")).toBe('2026-02-01 12:00:00');
    expect(run('addDays([D], 7)', { D: '2026-12-28' })).toBe('2027-01-04');
    expect(run('addDays([D], 7)', { D: null })).toBe(null);
    expect(run('today()')).toBe('2026-01-15');
    expect(run('now()')).toBe('2026-01-15 10:30:45');
    expect(run('addDays(today(), 30)')).toBe('2026-02-14');
  });

  test('a bad date is a runtime error with a code', () => {
    expect(() => run("addDays('2026-02-30', 1)")).toThrow(/expr\.date/);
    expect(() => run("addDays('hello', 1)")).toThrow(/expr\.date/);
  });
});

describe('expr: errors carry a code and a position', () => {
  test('codes', () => {
    expect(codeOf('')).toBe('expr.empty');
    expect(codeOf('   ')).toBe('expr.empty');
    expect(codeOf(null)).toBe('expr.empty');
    expect(codeOf('1 +')).toBe('expr.end');
    expect(codeOf('1 2')).toBe('expr.unexpected');
    expect(codeOf('* 2')).toBe('expr.unexpected');
    expect(codeOf('(1 + 2')).toBe('expr.paren');
    expect(codeOf('1 + 2)')).toBe('expr.unexpected');
    expect(codeOf('round(1, 2')).toBe('expr.paren');
    expect(codeOf("'abc")).toBe('expr.string.unterminated');
    expect(codeOf('[abc')).toBe('expr.column.unterminated');
    expect(codeOf('[ ]')).toBe('expr.column.empty');
    expect(codeOf('1 # 2')).toBe('expr.char');
    expect(codeOf('1.2.3')).toBe('expr.number');
    expect(codeOf('12abc')).toBe('expr.number');
    expect(codeOf('nope(1)')).toBe('expr.function.unknown');
    expect(codeOf('abs()')).toBe('expr.function.args');
    expect(codeOf('abs(1, 2)')).toBe('expr.function.args');
    expect(codeOf('if(1, 2)')).toBe('expr.function.args');
    expect(codeOf('today(1)')).toBe('expr.function.args');
    expect(codeOf('foo')).toBe('expr.unexpected');
    expect(codeOf('round(1,)')).toBe('expr.unexpected');
    expect(codeOf('1'.repeat(4001))).toBe('expr.tooLong');
    expect(codeOf(`${'('.repeat(200)}1${')'.repeat(200)}`)).toBe('expr.tooDeep');
    expect(codeOf(`${'-'.repeat(200)}1`)).toBe('expr.tooDeep');
  });

  test('positions point at the problem', () => {
    expect(checkExpr('1 + # 2').pos).toBe(4);
    expect(checkExpr('1 + nope(2)').pos).toBe(4);
    expect(checkExpr("1 + 'abc").pos).toBe(4);
    expect(checkExpr('1 + (2 * 3').pos).toBe(4);
    expect(checkExpr('1 +').pos).toBe(3);
    expect(checkExpr('1 + 2')).toBe(null);
  });

  test('no access to JS internals', () => {
    expect(codeOf('constructor(1)')).toBe('expr.function.unknown');
    expect(codeOf('__proto__')).toBe('expr.unexpected');
    expect(codeOf('toString')).toBe('expr.unexpected');
    expect(run('[constructor]', {})).toBe(null);
  });
});

describe('pattern helpers', () => {
  test('masks', () => {
    const random = createRandom(3);
    expect(compileMask('A-####')(random)).toMatch(/^[A-Z]-\d{4}$/);
    expect(compileMask('aa**')(random)).toMatch(/^[a-z]{2}[A-Za-z0-9]{2}$/);
    expect(compileMask('\\A\\#-#x')(random)).toMatch(/^A#-\d{1}x$/);
    expect(compileMask('訂單-##')(random)).toMatch(/^訂單-\d\d$/);
    expect(maskProblem('')).toBe('pattern.mask.empty');
    expect(maskProblem(undefined)).toBe('pattern.mask.empty');
    expect(maskProblem('ab\\')).toBe('pattern.mask.escape');
    expect(maskProblem('ab\\\\')).toBe(null);
    expect(() => compileMask('x\\')).toThrow(/pattern\.mask\.escape/);
  });

  test('parsing and formatting dates', () => {
    expect(formatDate(parseDateTime('2026-02-28').ms)).toBe('2026-02-28');
    expect(parseDateTime('2026-02-28').hasTime).toBe(false);
    expect(formatDateTime(parseDateTime('2026-2-8 7:05').ms)).toBe('2026-02-08 07:05:00');
    expect(formatDateTime(parseDateTime('2026-02-28T23:59:59').ms)).toBe('2026-02-28 23:59:59');
    expect(formatDate(parseDateTime('0099-01-01').ms)).toBe('0099-01-01');
    expect(parseDateTime('2026-02-29')).toBe(null);
    expect(parseDateTime('2024-02-29')).not.toBe(null);
    expect(parseDateTime('2026-13-01')).toBe(null);
    expect(parseDateTime('2026-01-01 24:00:00')).toBe(null);
    expect(parseDateTime('hello')).toBe(null);
    expect(parseDateTime(20260101)).toBe(null);
    expect(parseTime('7:05')).toBe('07:05:00');
    expect(parseTime('23:59:59')).toBe('23:59:59');
    expect(parseTime('24:00')).toBe(null);
    expect(formatDate(addMonths(parseDateTime('2026-01-31').ms, 13))).toBe('2027-02-28');
  });

  test('relative date specs', () => {
    const base = naiveNow(now);
    expect(formatDateTime(base)).toBe('2026-01-15 10:30:45');
    expect(formatDateTime(resolveDateSpec('now', base).ms)).toBe('2026-01-15 10:30:45');
    expect(formatDateTime(resolveDateSpec('now-365d', base).ms)).toBe('2025-01-15 10:30:45');
    expect(formatDateTime(resolveDateSpec('now+30d', base).ms)).toBe('2026-02-14 10:30:45');
    expect(formatDateTime(resolveDateSpec('now - 2h', base).ms)).toBe('2026-01-15 08:30:45');
    expect(formatDateTime(resolveDateSpec('now+1M', base).ms)).toBe('2026-02-15 10:30:45');
    expect(formatDateTime(resolveDateSpec('now-1y', base).ms)).toBe('2025-01-15 10:30:45');
    expect(formatDate(resolveDateSpec('2020-05-06', base).ms)).toBe('2020-05-06');
    expect(resolveDateSpec('now+5x', base)).toBe(null);
    expect(resolveDateSpec('tomorrow', base)).toBe(null);
    expect(resolveDateSpec(undefined, base)).toBe(null);
  });
});
