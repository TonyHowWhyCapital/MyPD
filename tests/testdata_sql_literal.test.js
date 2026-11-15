import {
  DIALECTS, plainNumber, sqlFilePrelude, sqlLiteral,
} from '../src/lib/testdata/sql';

const col = (kind, extra) => ({ defKey: 'C', kind, type: '', ...extra });
const str = col('string');
const lit = (value, dialect, column = str) => sqlLiteral(value, column, dialect);

const BS = String.fromCharCode(92); // one backslash
const NUL = String.fromCharCode(0);

describe('strings', () => {
  test('a quote is doubled in every dialect', () => {
    expect(lit("O'Brien", 'mssql')).toBe("N'O''Brien'");
    expect(lit("O'Brien", 'mysql')).toBe("'O''Brien'");
    expect(lit("O'Brien", 'postgresql')).toBe("'O''Brien'");
    expect(lit("O'Brien", 'oracle')).toBe("'O''Brien'");
    expect(lit("O'Brien", 'generic')).toBe("'O''Brien'");
    expect(lit("'; DROP TABLE t; --", 'mssql')).toBe("N'''; DROP TABLE t; --'");
    expect(lit("''", 'generic')).toBe("''''''");
  });

  test('unicode stays as it is, SQL Server gets the N prefix', () => {
    const text = '臺北市信義區 😀 é';
    expect(lit(text, 'mssql')).toBe(`N'${text}'`);
    DIALECTS.filter(d => d !== 'mssql').forEach(d => expect(lit(text, d)).toBe(`'${text}'`));
  });

  test('the empty string, which Oracle cannot tell from NULL', () => {
    expect(lit('', 'mssql')).toBe("N''");
    expect(lit('', 'mysql')).toBe("''");
    expect(lit('', 'postgresql')).toBe("''");
    expect(lit('', 'generic')).toBe("''");
    expect(lit('', 'oracle')).toBe('NULL');
  });

  test('a backslash', () => {
    const text = `C:${BS}temp${BS}`;
    expect(lit(text, 'mssql')).toBe(`N'C:${BS}temp${BS}'`);
    expect(lit(text, 'oracle')).toBe(`'C:${BS}temp${BS}'`);
    expect(lit(text, 'generic')).toBe(`'C:${BS}temp${BS}'`);
    // right with and without NO_BACKSLASH_ESCAPES: no backslash is left in a literal
    expect(lit(text, 'mysql'))
      .toBe("CONCAT('C:', CHAR(92 USING utf8mb4), 'temp', CHAR(92 USING utf8mb4))");
    expect(lit(BS, 'mysql')).toBe('CHAR(92 USING utf8mb4)');
    expect(lit(`${BS}'`, 'mysql')).toBe("CONCAT(CHAR(92 USING utf8mb4), '''')");
    // right with and without standard_conforming_strings
    expect(lit(text, 'postgresql')).toBe(`E'C:${BS}${BS}temp${BS}${BS}'`);
    expect(lit(`${BS}'`, 'postgresql')).toBe(`E'${BS}${BS}'''`);
  });

  test('line breaks and control characters never stand raw in a statement', () => {
    const text = 'a\r\nGO\nb';
    expect(lit(text, 'mssql')).toBe("N'a' + NCHAR(13) + NCHAR(10) + N'GO' + NCHAR(10) + N'b'");
    expect(lit(text, 'mysql')).toBe("CONCAT('a', CHAR(13 USING utf8mb4), "
      + "CHAR(10 USING utf8mb4), 'GO', CHAR(10 USING utf8mb4), 'b')");
    expect(lit(text, 'postgresql')).toBe(`E'a${BS}r${BS}nGO${BS}nb'`);
    expect(lit(text, 'oracle')).toBe("'a' || CHR(13) || CHR(10) || 'GO' || CHR(10) || 'b'");
    expect(lit('\n', 'mssql')).toBe('NCHAR(10)');
    expect(lit('\n', 'oracle')).toBe('CHR(10)');
    expect(lit(`a${String.fromCharCode(1)}b${String.fromCharCode(127)}`, 'postgresql'))
      .toBe(`E'a${BS}u0001b${BS}u007f'`);
    ['mssql', 'mysql', 'postgresql', 'oracle'].forEach((d) => {
      // eslint-disable-next-line no-control-regex
      expect(lit(`x\r\ny${NUL}${String.fromCharCode(26)}z`, d)).not.toMatch(/[\u0000-\u0008\n-\u001F]/);
    });
    // standard SQL has no escape: the line break stays inside the literal
    expect(lit('a\nb', 'generic')).toBe("'a\nb'");
    // a tab is harmless everywhere
    DIALECTS.forEach(d => expect(lit('a\tb', d)).toContain('a\tb'));
  });

  test('NUL is kept where the database can store it', () => {
    expect(lit(`a${NUL}b`, 'mssql')).toBe("N'a' + NCHAR(0) + N'b'");
    expect(lit(`a${NUL}b`, 'mysql')).toBe("CONCAT('a', CHAR(0 USING utf8mb4), 'b')");
    expect(lit(`a${NUL}b`, 'oracle')).toBe("'a' || CHR(0) || 'b'");
    expect(lit(`a${NUL}b`, 'postgresql')).toBe("'ab'");
    expect(lit(`a${NUL}b`, 'generic')).toBe("'ab'");
  });

  test('the ampersand is no problem: the Oracle script switches substitution off', () => {
    expect(lit('AT&T &name', 'oracle')).toBe("'AT&T &name'");
    expect(sqlFilePrelude('oracle')).toMatch(/^SET DEFINE OFF\n/);
  });

  test('very long strings', () => {
    const long = 'x'.repeat(100000);
    expect(lit(long, 'mssql')).toBe(`N'${long}'`);
    expect(lit(long, 'mysql')).toBe(`'${long}'`);
    expect(lit(long, 'postgresql')).toBe(`'${long}'`);
    // SQL Server cuts a concatenation at 4000 characters unless one side is (max)
    expect(lit(`${'x'.repeat(5000)}\ny`, 'mssql'))
      .toBe(`CAST(N'${'x'.repeat(5000)}' AS nvarchar(max)) + NCHAR(10) + N'y'`);
    expect(lit(`${'x'.repeat(3000)}\ny`, 'mssql')).toBe(`N'${'x'.repeat(3000)}' + NCHAR(10) + N'y'`);
  });

  test('Oracle literals stay below 4000 bytes and lines below the SQL*Plus limit', () => {
    expect(lit('x'.repeat(1000), 'oracle')).toBe(`'${'x'.repeat(1000)}'`);
    // up to 4000 bytes: VARCHAR2 pieces
    const medium = lit('x'.repeat(2500), 'oracle');
    expect(medium).toBe(`'${'x'.repeat(1000)}' ||\n    '${'x'.repeat(1000)}' ||\n    '${
      'x'.repeat(500)}'`);
    // more than 4000 bytes: every piece is a CLOB, VARCHAR2 concatenation ends there
    const chinese = lit('中'.repeat(1500), 'oracle');
    expect(chinese).toBe(`TO_CLOB('${'中'.repeat(1000)}') ||\n    TO_CLOB('${'中'.repeat(500)}')`);
    const huge = lit(`${"'".repeat(2500)}\n${'😀'.repeat(1500)}`, 'oracle');
    expect(huge.startsWith('TO_CLOB(')).toBe(true);
    huge.split('\n').forEach(line => expect(line.length).toBeLessThan(2499));
    const pieces = huge.match(/'(?:[^']|'')*'/g);
    pieces.forEach(p => expect(Buffer.byteLength(p.slice(1, -1).replace(/''/g, "'"), 'utf8'))
      .toBeLessThanOrEqual(4000));
    // a surrogate pair is never cut in two
    expect(huge).not.toMatch(/[\uD800-\uDBFF]'|'[\uDC00-\uDFFF]/);
    expect(lit(`\n${'x'.repeat(5000)}`, 'oracle').startsWith('TO_CLOB(CHR(10)) ||')).toBe(true);
  });
});

// What the database makes of a string literal written by sqlLiteral. Anything in the
// expression that is neither a literal nor the glue the dialect uses fails the test.
const decode = (sql, dialect) => {
  if (sql === 'NULL') {
    return null;
  }
  let out = '';
  const rest = sql.replace(/([NE]?)'((?:[^']|'')*)'|N?CHA?R\((\d+)( USING utf8mb4)?\)/g,
    (all, prefix, body, code) => {
      if (code !== undefined) {
        out += String.fromCharCode(Number(code));
        return '';
      }
      let text = body.replace(/''/g, "'");
      if (prefix === 'E') {
        text = text.replace(/\\(u[0-9a-f]{4}|.)/g, (m, e) => {
          if (e.length === 5) {
            return String.fromCharCode(parseInt(e.slice(1), 16));
          }
          return {
            n: '\n', r: '\r', b: '\b', f: '\f',
          }[e] || e;
        });
      } else if (dialect === 'mysql') {
        expect(text).not.toContain(BS);
      }
      out += text;
      return '';
    });
  const glue = {
    mssql: /^(CAST\( AS nvarchar\(max\)\))?( \+ )*$/,
    mysql: /^(CONCAT\((, )*\))?$/,
    postgresql: /^$/,
    oracle: /^(TO_CLOB\(\)|\(|\)| \|\| | \|\|\n {4})*$/,
    generic: /^$/,
  }[dialect];
  expect(rest).toMatch(glue);
  return out;
};

describe('any text comes back as it went in', () => {
  const alphabet = ["'", '"', BS, '\n', '\r', NUL, ';', '--', '/*', '*/', '&', '%', '_', '中',
    '文', '😀', ']', '[', '`', '$', 'GO', '\t', String.fromCharCode(26), ' ', 'a', 'N', 'E',
    '||', '+', ',', '(', ')', "''", `${BS}'`, `${BS}n`, 'é', 'CHAR(0)'];
  let seed = 12345;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const samples = [];
  for (let i = 0; i < 400; i += 1) {
    const length = Math.floor(next() * 12);
    let text = '';
    for (let k = 0; k < length; k += 1) {
      text += alphabet[Math.floor(next() * alphabet.length)];
    }
    samples.push(text);
  }
  samples.push("'".repeat(4001), `${'中文'.repeat(3000)}\n'x'`, `${BS}`.repeat(50));

  DIALECTS.forEach((dialect) => {
    test(dialect, () => {
      samples.forEach((text) => {
        let expected = text;
        if (dialect === 'postgresql' || dialect === 'generic') {
          expected = text.split(NUL).join('');
        }
        if (dialect === 'oracle' && text === '') {
          expected = null;
        }
        expect(decode(lit(text, dialect), dialect)).toBe(expected);
      });
    });
  });
});

describe('numbers', () => {
  test('no exponent, no grouping, whatever the size', () => {
    expect(plainNumber(0)).toBe('0');
    expect(plainNumber(-0)).toBe('0');
    expect(plainNumber(-12.5)).toBe('-12.5');
    expect(plainNumber(1234567.891)).toBe('1234567.891');
    expect(plainNumber(1e21)).toBe('1000000000000000000000');
    expect(plainNumber(-1.5e25)).toBe('-15000000000000000000000000');
    expect(plainNumber(1e-7)).toBe('0.0000001');
    expect(plainNumber(-1.25e-9)).toBe('-0.00000000125');
    expect(plainNumber(1.5e-7)).toBe('0.00000015');
    expect(plainNumber(123456789012345680000)).toBe('123456789012345680000');
    expect(plainNumber(NaN)).toBe(null);
    expect(plainNumber(Infinity)).toBe(null);
    expect(Number(plainNumber(4.2e-11))).toBe(4.2e-11);
  });

  test('in a statement', () => {
    DIALECTS.forEach((d) => {
      expect(lit(42, d, col('int'))).toBe('42');
      expect(lit(-7, d, col('int'))).toBe('-7');
      expect(lit(8421.5, d, col('decimal'))).toBe('8421.5');
      expect(lit(-0.001, d, col('decimal'))).toBe('-0.001');
      expect(lit(1e22, d, col('decimal'))).toBe('10000000000000000000000');
      expect(lit(NaN, d, col('decimal'))).toBe('NULL');
      expect(lit(-Infinity, d, col('decimal'))).toBe('NULL');
      // a number given as text (more digits than a double holds) stays a number
      expect(lit('12345678901234567890.12', d, col('decimal'))).toBe('12345678901234567890.12');
      expect(lit('-8421.50', d, col('decimal'))).toBe('-8421.50');
      expect(lit('+5', d, col('int'))).toBe('5');
      expect(lit(' 7 ', d, col('int'))).toBe('7');
    });
    // text that is no number is never written bare
    expect(lit('1; DROP TABLE t', 'mysql', col('int'))).toBe("'1; DROP TABLE t'");
    expect(lit('1e5', 'mssql', col('int'))).toBe("N'1e5'");
    expect(lit('0x10', 'postgresql', col('int'))).toBe("'0x10'");
    // a number for a text column is text
    expect(lit(7, 'mssql', str)).toBe("N'7'");
    expect(lit(7.5, 'oracle', str)).toBe("'7.5'");
    // without a column the type of the value decides
    expect(sqlLiteral(3, null, 'generic')).toBe('3');
    expect(sqlLiteral('3', undefined, 'generic')).toBe("'3'");
  });
});

describe('NULL, booleans, dates, binary', () => {
  test('NULL', () => {
    DIALECTS.forEach((d) => {
      ['int', 'decimal', 'string', 'date', 'datetime', 'time', 'bool', 'binary'].forEach((kind) => {
        expect(lit(null, d, col(kind))).toBe('NULL');
        expect(lit(undefined, d, col(kind))).toBe('NULL');
      });
    });
    // the word is a text like any other
    expect(lit('NULL', 'mysql')).toBe("'NULL'");
  });

  test('booleans are 1 and 0, TRUE and FALSE on PostgreSQL', () => {
    ['mssql', 'mysql', 'oracle', 'generic'].forEach((d) => {
      expect(lit(true, d, col('bool'))).toBe('1');
      expect(lit(false, d, col('bool'))).toBe('0');
    });
    expect(lit(true, 'postgresql', col('bool'))).toBe('TRUE');
    expect(lit(false, 'postgresql', col('bool'))).toBe('FALSE');
    expect(lit(true, 'postgresql', col('bool', { type: 'BIT' }))).toBe("B'1'");
    expect(lit(false, 'postgresql', col('bool', { type: 'bit' }))).toBe("B'0'");
    expect(lit(1, 'postgresql', col('bool'))).toBe('TRUE');
    expect(lit(0, 'postgresql', col('bool'))).toBe('FALSE');
    expect(lit('true', 'postgresql', col('bool'))).toBe('TRUE');
    expect(lit('0', 'mssql', col('bool'))).toBe('0');
    expect(lit('maybe', 'mssql', col('bool'))).toBe("N'maybe'");
    // a boolean in a column that is none
    expect(lit(true, 'postgresql', col('int'))).toBe('1');
    expect(lit(false, 'mssql', str)).toBe("N'0'");
  });

  test('dates', () => {
    const date = col('date');
    expect(lit('2024-01-31', 'mssql', date)).toBe("'20240131'");
    expect(lit('2024-01-31', 'mysql', date)).toBe("'2024-01-31'");
    expect(lit('2024-01-31', 'postgresql', date)).toBe("'2024-01-31'");
    expect(lit('2024-01-31', 'oracle', date)).toBe("DATE '2024-01-31'");
    expect(lit('2024-01-31', 'generic', date)).toBe("'2024-01-31'");
    // the time of a date column is dropped
    expect(lit('2024-01-31 10:20:30', 'oracle', date)).toBe("DATE '2024-01-31'");
    expect(lit('2024-01-31 10:20:30', 'mssql', date)).toBe("'20240131'");
  });

  test('date and time', () => {
    const dt = col('datetime');
    expect(lit('2024-01-31 23:59:58', 'mssql', dt)).toBe("'2024-01-31T23:59:58'");
    expect(lit('2024-01-31 23:59:58', 'mysql', dt)).toBe("'2024-01-31 23:59:58'");
    expect(lit('2024-01-31 23:59:58', 'postgresql', dt)).toBe("'2024-01-31 23:59:58'");
    expect(lit('2024-01-31 23:59:58', 'oracle', dt)).toBe("TIMESTAMP '2024-01-31 23:59:58'");
    expect(lit('2024-01-31 23:59:58', 'generic', dt)).toBe("'2024-01-31 23:59:58'");
    expect(lit('2024-01-31', 'mssql', dt)).toBe("'2024-01-31T00:00:00'");
    expect(lit('2024-01-31', 'oracle', dt)).toBe("TIMESTAMP '2024-01-31 00:00:00'");
    expect(lit('2024-01-31T01:02:03.123', 'mssql', dt)).toBe("'2024-01-31T01:02:03.123'");
    expect(lit('2024-01-31 01:02:03.5', 'oracle', dt)).toBe("TIMESTAMP '2024-01-31 01:02:03.5'");
  });

  test('time', () => {
    const time = col('time');
    ['mssql', 'mysql', 'postgresql', 'generic'].forEach(d => expect(lit('08:05:00', d, time))
      .toBe("'08:05:00'"));
    expect(lit('08:05:00', 'oracle', col('time', { type: 'VARCHAR2' }))).toBe("'08:05:00'");
    expect(lit('08:05:00', 'oracle', col('time', { type: 'DATE' })))
      .toBe("TO_DATE('1970-01-01 08:05:00', 'YYYY-MM-DD HH24:MI:SS')");
    expect(lit('2024-01-31 08:05:00', 'mysql', time)).toBe("'08:05:00'");
  });

  test('text that is no date is written as text, escaped', () => {
    expect(lit("2024-01-31' OR 1=1 --", 'mssql', col('date'))).toBe("N'2024-01-31'' OR 1=1 --'");
    expect(lit('31/01/2024', 'oracle', col('date'))).toBe("'31/01/2024'");
    expect(lit('yesterday', 'postgresql', col('datetime'))).toBe("'yesterday'");
    expect(lit("8 o'clock", 'mysql', col('time'))).toBe("'8 o''clock'");
  });

  test('binary values are hex', () => {
    const bin = col('binary');
    expect(lit('0a1B', 'mssql', bin)).toBe('0x0A1B');
    expect(lit('0x0a1b', 'mssql', bin)).toBe('0x0A1B');
    expect(lit('0a1b', 'mysql', bin)).toBe("X'0A1B'");
    expect(lit('0a1b', 'postgresql', bin)).toBe("decode('0A1B', 'hex')");
    expect(lit('0a1b', 'oracle', bin)).toBe("HEXTORAW('0A1B')");
    expect(lit('0a1b', 'generic', bin)).toBe("X'0A1B'");
    expect(lit('', 'mssql', bin)).toBe('0x');
    expect(lit('', 'oracle', bin)).toBe('NULL');
    // anything else is taken as text and written as its bytes, never as it stands
    expect(lit("a'b", 'mysql', bin)).toBe("X'612762'");
    expect(lit('abc', 'mssql', bin)).toBe('0x616263');
  });
});
