import {
  checkAgainstModel, applySuggestion, modelTables, FINDING_CODES, SKIP_REASONS,
} from '../src/lib/testdata/query_check';
import { tokenize, nearest, distance } from '../src/lib/testdata/query_tokens';

const table = (defKey, fields) => ({ id: defKey, defKey, fields: fields.map(f => ({ defKey: f })) });
const ds = {
  entities: [
    table('T_CUSTOMER', ['ID', 'NAME', 'EMAIL', 'STATUS', 'CREATED_AT', 'LEVEL_CODE', 'DATE', 'ORDER']),
    table('T_ORDER', ['ID', 'CUSTOMER_ID', 'AMOUNT', 'STATUS', 'CREATED_AT']),
    table('t_item', ['id', 'order_id', 'sku', 'qty']),
    table('客戶', ['編號', '姓名']),
  ],
  views: [table('V_ACTIVE', ['ID', 'NAME'])],
};
const check = sql => checkAgainstModel(sql, ds);
const codes = sql => check(sql).findings.map(f => `${f.code}:${f.name}`);
const one = (sql) => {
  const { findings } = check(sql);
  expect(findings).toHaveLength(1);
  return findings[0];
};

describe('the tokens of a query', () => {
  const kinds = sql => tokenize(sql).tokens.map(t => `${t.type}:${t.text}`);
  test('strings, quoted names, comments, numbers and parameters', () => {
    expect(kinds("SELECT a, 'it''s -- /* x */ FROM' -- c\nFROM t /* FROM z */ WHERE b = 1.5e3"))
      .toEqual(['word:SELECT', 'word:a', 'op:,', "string:'it''s -- /* x */ FROM'", 'word:FROM',
        'word:t', 'word:WHERE', 'word:b', 'op:=', 'number:1.5e3']);
    expect(kinds('SELECT [Order Id], `my col`, "Na""me" FROM [dbo].[T]')).toEqual(['word:SELECT',
      'quoted:[Order Id]', 'op:,', 'quoted:`my col`', 'op:,', 'quoted:"Na""me"', 'word:FROM',
      'quoted:[dbo]', 'op:.', 'quoted:[T]']);
    expect(tokenize('SELECT "Na""me"').tokens[1]).toMatchObject({ name: 'Na"me', from: 8, to: 14 });
    expect(kinds("SELECT N'文字', x'1F' WHERE a = @p AND b = :name AND c = ? AND d = $1"))
      .toEqual(['word:SELECT', "string:N'文字'", 'op:,', "string:x'1F'", 'word:WHERE', 'word:a',
        'op:=', 'param:@p', 'word:AND', 'word:b', 'op:=', 'param::name', 'word:AND', 'word:c',
        'op:=', 'param:?', 'word:AND', 'word:d', 'op:=', 'param:$1']);
    expect(kinds('a::int <> b || c ->> d')).toEqual(['word:a', 'op:::', 'word:int', 'op:<>',
      'word:b', 'op:||', 'word:c', 'op:->>', 'word:d']);
    expect(kinds('SELECT 編號 FROM 客戶')).toEqual(['word:SELECT', 'word:編號', 'word:FROM', 'word:客戶']);
    expect(kinds('arr[1]')).toEqual(['word:arr', 'op:[', 'number:1', 'op:]']);
  });
  test('depth of parentheses and what cannot be read', () => {
    expect(tokenize('a (b (c) d) e').tokens.map(t => t.depth)).toEqual([0, 0, 1, 1, 2, 1, 1, 0, 0]);
    expect(tokenize("SELECT 'abc").problem).toBe('unterminated');
    expect(tokenize('SELECT /* abc').problem).toBe('unterminated');
    expect(tokenize('SELECT "abc').problem).toBe('unterminated');
    expect(tokenize('SELECT [abc').problem).toBe('unterminated');
    expect(tokenize('SELECT (a').problem).toBe('unbalanced');
    expect(tokenize('SELECT a)').problem).toBe('unbalanced');
    expect(tokenize("SELECT 'a\\'b'").problem).toBe('quoting');
    expect(tokenize('SELECT a # c').problem).toBe('quoting');
    expect(tokenize('SELECT $$a$$').problem).toBe('quoting');
  });
  test('nearest names', () => {
    expect(distance('kitten', 'sitting')).toBe(3);
    expect(distance('nmae', 'name')).toBe(1);
    expect(nearest('T_CUSTMER', ['T_CUSTOMER', 'T_ORDER'])).toEqual(['T_CUSTOMER']);
    expect(nearest('customerid', ['CUSTOMER_ID', 'AMOUNT'])).toEqual(['CUSTOMER_ID']);
    expect(nearest('XYZ', ['T_CUSTOMER', 'T_ORDER'])).toEqual([]);
    expect(nearest('ab', ['cd'])).toEqual([]);
    expect(nearest('NAMF', ['NAME', 'NAMX', 'OTHER'])).toEqual(['NAME', 'NAMX']);
  });
});

describe('what is found', () => {
  test('an unknown table is a warning with the nearest name and its place', () => {
    const sql = 'SELECT NAME FROM T_CUSTMER';
    const f = one(sql);
    expect(f).toMatchObject({
      code: 'tableUnknown', severity: 'warning', name: 'T_CUSTMER', suggestions: ['T_CUSTOMER'],
    });
    expect(sql.slice(f.start, f.end)).toBe('T_CUSTMER');
    expect(applySuggestion(sql, f, 'T_CUSTOMER')).toBe('SELECT NAME FROM T_CUSTOMER');
    // nothing is said about the columns of a table that is not known
    expect(codes('SELECT NOPE, x.ALSO FROM SOMETHING_ELSE x WHERE x.Q = 1'))
      .toEqual(['tableUnknown:SOMETHING_ELSE']);
    expect(one('SELECT 1 FROM SOMETHING_ELSE').suggestions).toEqual([]);
  });
  test('an unknown column of a known table, qualified or alone', () => {
    const sql = 'select nmae from t_customer where stauts = 1';
    expect(check(sql).findings).toMatchObject([
      { code: 'columnUnknown', severity: 'warning', name: 'nmae', table: 'T_CUSTOMER', suggestions: ['NAME'] },
      { code: 'columnUnknown', name: 'stauts', table: 'T_CUSTOMER', suggestions: ['STATUS'] },
    ]);
    const f = one('SELECT c.NAME, o.AMOUNTS FROM T_CUSTOMER c JOIN T_ORDER o ON o.CUSTOMER_ID = c.ID');
    expect(f).toMatchObject({ code: 'columnUnknown', name: 'AMOUNTS', table: 'T_ORDER', suggestions: ['AMOUNT'] });
    expect(codes('SELECT T_ORDER.NOPE FROM T_ORDER')).toEqual(['columnUnknown:NOPE']);
    expect(codes('SELECT o.ID FROM T_ORDER o LEFT OUTER JOIN t_item i ON i.order_idd = o.ID'))
      .toEqual(['columnUnknown:order_idd']);
    expect(codes('SELECT UPPER(NAEM), COUNT(DISTINCT EMIAL) FROM T_CUSTOMER GROUP BY NAEM'))
      .toEqual(['columnUnknown:NAEM', 'columnUnknown:EMIAL', 'columnUnknown:NAEM']);
    expect(codes('SELECT TOP 5 NAEM FROM T_CUSTOMER ORDER BY CREATD DESC'))
      .toEqual(['columnUnknown:NAEM', 'columnUnknown:CREATD']);
    expect(codes('SELECT DISTINCT NAEM FROM T_CUSTOMER LIMIT 10')).toEqual(['columnUnknown:NAEM']);
    expect(codes('SELECT NAEM AS N FROM T_CUSTOMER')).toEqual(['columnUnknown:NAEM']);
    expect(codes('SELECT NAEM N FROM T_CUSTOMER')).toEqual(['columnUnknown:NAEM']);
  });
  test('quoted names keep their place without the quotes', () => {
    const sql = 'SELECT c.[Nmae], c.`Emial`, c."Stauts" FROM [dbo].[T_CUSTOMER] c';
    const { findings } = check(sql);
    expect(findings.map(f => sql.slice(f.start, f.end))).toEqual(['Nmae', 'Emial', 'Stauts']);
    expect(applySuggestion(sql, findings[0], 'NAME')).toContain('c.[NAME],');
    expect(codes('SELECT [Nmae], `Emial` FROM T_CUSTOMER'))
      .toEqual(['columnUnknown:Nmae', 'columnUnknown:Emial']);
  });
  test('views, schema prefixes, letter case and Chinese names', () => {
    expect(codes('SELECT NAME FROM v_active')).toEqual([]);
    expect(codes('SELECT NOPE FROM V_ACTIVE')).toEqual(['columnUnknown:NOPE']);
    expect(codes('SELECT name FROM dbo.t_customer')).toEqual([]);
    expect(codes('SELECT name FROM shop.dbo.T_Customer WHERE Id = 1')).toEqual([]);
    expect(codes('select SKU from T_ITEM where QTY > 1')).toEqual([]);
    expect(codes('SELECT 姓名 FROM 客戶 WHERE 編號 = 1')).toEqual([]);
    expect(check('SELECT 姓名字 FROM 客户').findings).toMatchObject([
      { code: 'tableUnknown', name: '客户', suggestions: ['客戶'] }]);
    expect(codes('SELECT 姓 FROM 客戶')).toEqual(['columnUnknown:姓']);
    expect(check('SELECT 1 FROM dbo.T_ORDER o').tables).toEqual([
      { name: 'dbo.T_ORDER', alias: 'o', known: true, modelName: 'T_ORDER' }]);
  });
  test('a column that several joined tables have is only mentioned', () => {
    const f = one('SELECT STATUS FROM T_CUSTOMER c JOIN T_ORDER o ON o.CUSTOMER_ID = c.ID');
    expect(f).toMatchObject({
      code: 'columnAmbiguous', severity: 'info', name: 'STATUS', tables: ['T_CUSTOMER', 'T_ORDER'],
    });
    // the ORDER BY may name a column of the result; USING and NATURAL merge columns
    expect(codes('SELECT c.ID FROM T_CUSTOMER c JOIN T_ORDER o ON o.CUSTOMER_ID = c.ID ORDER BY ID'))
      .toEqual([]);
    expect(codes('SELECT ID FROM T_CUSTOMER JOIN T_ORDER USING (ID)')).toEqual([]);
    expect(codes('SELECT ID FROM T_CUSTOMER NATURAL JOIN T_ORDER')).toEqual([]);
    // every joined table is known and none has the column
    expect(check('SELECT AMUONT FROM T_CUSTOMER c, T_ORDER o ORDER BY NOPE').findings).toMatchObject([
      { code: 'columnNowhere', severity: 'warning', name: 'AMUONT', tables: ['T_CUSTOMER', 'T_ORDER'], suggestions: ['AMOUNT'] },
      { code: 'columnNowhere', name: 'NOPE', suggestions: [] },
    ]);
    // one of them is not in the model: the column may be its own
    expect(codes('SELECT NOPE FROM T_CUSTOMER c JOIN ELSEWHERE e ON e.ID = c.ID'))
      .toEqual(['tableUnknown:ELSEWHERE']);
  });
  test('a query without FROM that names a column', () => {
    expect(codes('SELECT NAME T_CUSTOMER WHERE ID = 1')).toEqual(['noFrom:NAME']);
    expect(codes('SELECT 1')).toEqual([]);
    expect(codes('SELECT GETDATE()')).toEqual([]);
    expect(codes('SELECT CURRENT_TIMESTAMP')).toEqual([]);
    expect(codes('SELECT seq.NEXTVAL')).toEqual([]);
    expect(codes("SELECT 'a' AS x")).toEqual([]);
  });
  test('empty text', () => {
    expect(check('').status).toBe('empty');
    expect(check('  \n ; ').status).toBe('empty');
    expect(check('-- nothing yet').status).toBe('empty');
    expect(check(undefined).status).toBe('empty');
  });
});

describe('what is not analysed says why', () => {
  test.each([
    ['WITH x AS (SELECT ID FROM T_ORDER) SELECT ID FROM x', 'cte'],
    ['SELECT ID FROM T_ORDER UNION SELECT ID FROM T_CUSTOMER', 'setOperation'],
    ['SELECT ID FROM T_ORDER EXCEPT SELECT ID FROM T_CUSTOMER', 'setOperation'],
    ['SELECT ID FROM (SELECT ID FROM T_ORDER) x', 'derivedTable'],
    ['SELECT o.ID FROM T_ORDER o JOIN (SELECT ID FROM T_CUSTOMER) c ON c.ID = o.ID', 'derivedTable'],
    ['SELECT ID FROM T_ORDER WHERE CUSTOMER_ID IN (SELECT ID FROM T_CUSTOMER)', 'subquery'],
    ['SELECT (SELECT MAX(ID) FROM T_ORDER) FROM T_CUSTOMER', 'subquery'],
    ['SELECT value FROM STRING_SPLIT(\'a,b\', \',\')', 'tableFunction'],
    ['SELECT x FROM generate_series(1, 10) x', 'tableFunction'],
    ['SELECT n FROM T_ORDER CROSS APPLY fn(ID) n', 'fromShape'],
    ['SELECT * FROM T_ORDER PIVOT (SUM(AMOUNT) FOR STATUS IN ([1], [2])) p', 'fromShape'],
    ['SELECT * FROM T_ORDER o, LATERAL (VALUES (1)) v', 'tableFunction'],
    ['SELECT a.ID FROM T_ORDER a JOIN T_ORDER a ON 1 = 1', 'fromShape'],
    ['SELECT ID FROM a.b.c.T_ORDER', 'fromShape'],
    ['(SELECT ID FROM T_ORDER)', 'notSelect'],
    ['DELETE FROM T_ORDER', 'notSelect'],
    ['SELECT ID FROM T_ORDER; SELECT 2', 'multiple'],
    ["SELECT ID FROM T_ORDER WHERE NAME = 'abc", 'unterminated'],
    ['SELECT ID FROM T_ORDER WHERE (ID = 1', 'unbalanced'],
    ["SELECT ID FROM T_ORDER WHERE NAME = 'a\\'b'", 'quoting'],
    [`SELECT ID FROM T_ORDER WHERE ID IN (${'1,'.repeat(12000)}1)`, 'tooLong'],
  ])('%s', (sql, reason) => {
    expect(check(sql)).toEqual({
      status: 'notAnalysed', reason, findings: [], tables: [],
    });
    expect(SKIP_REASONS).toContain(reason);
  });
});

// The binding rule. Every query here is correct for the model above (or uses constructs the
// reader must leave alone): none may produce a warning.
describe('no false errors', () => {
  test.each([
    'SELECT * FROM T_CUSTOMER',
    'SELECT c.* FROM T_CUSTOMER c',
    'SELECT T_CUSTOMER.* FROM T_CUSTOMER',
    'SELECT c FROM T_CUSTOMER c',
    'SELECT COUNT(*) FROM T_CUSTOMER',
    'SELECT COUNT(*) AS total FROM T_CUSTOMER GROUP BY STATUS HAVING COUNT(*) > 1 ORDER BY total',
    'SELECT COUNT(*) cnt FROM T_CUSTOMER GROUP BY STATUS HAVING cnt > 1 ORDER BY cnt DESC',
    'SELECT NAME nm FROM T_CUSTOMER ORDER BY nm',
    'SELECT label = NAME FROM T_CUSTOMER ORDER BY label',
    "SELECT NAME AS 'label' FROM T_CUSTOMER",
    'SELECT NAME AS "Label" FROM T_CUSTOMER ORDER BY "Label"',
    // keywords that are also columns of the model, and keywords that are not columns
    'SELECT DATE, "ORDER", [ORDER], `ORDER` FROM T_CUSTOMER',
    'SELECT c.DATE, c.ORDER FROM T_CUSTOMER c',
    'SELECT NAME FROM T_CUSTOMER WHERE CREATED_AT > CURRENT_TIMESTAMP',
    'SELECT NAME FROM T_CUSTOMER WHERE CREATED_AT > SYSDATE - 7',
    'SELECT NAME FROM T_CUSTOMER WHERE EMAIL IS NOT NULL AND STATUS = TRUE',
    'SELECT NAME FROM T_CUSTOMER WHERE ROWNUM <= 10',
    'SELECT ROWID, NAME FROM T_CUSTOMER',
    'SELECT c.ROWID, c.ctid FROM T_CUSTOMER c',
    // functions with words of their own
    'SELECT DATEADD(day, 1, CREATED_AT), DATEDIFF(month, CREATED_AT, GETDATE()) FROM T_CUSTOMER',
    'SELECT DATEPART(weekday, CREATED_AT), DATENAME(dw, CREATED_AT) FROM T_CUSTOMER',
    'SELECT EXTRACT(YEAR FROM CREATED_AT), EXTRACT(epoch FROM CREATED_AT) FROM T_CUSTOMER',
    'SELECT CAST(ID AS VARCHAR(10)), CAST(ID AS mytype), CONVERT(NVARCHAR, ID) FROM T_CUSTOMER',
    'SELECT CAST(ID AS UNSIGNED), CONVERT(NAME USING utf8mb4) FROM T_CUSTOMER',
    'SELECT ID::text, NAME::character varying, AMOUNT::double precision FROM T_ORDER',
    "SELECT TRIM(BOTH 'x' FROM NAME), SUBSTRING(NAME FROM 1 FOR 2), POSITION('a' IN NAME) FROM T_CUSTOMER",
    "SELECT TIMESTAMPDIFF(SECOND, CREATED_AT, NOW()), DATE_ADD(CREATED_AT, INTERVAL 1 DAY) FROM T_CUSTOMER",
    "SELECT date_trunc('day', CREATED_AT), TO_CHAR(CREATED_AT, 'YYYY-MM') FROM T_CUSTOMER",
    "SELECT NAME FROM T_CUSTOMER WHERE CREATED_AT > NOW() - INTERVAL '7 days'",
    "SELECT NAME FROM T_CUSTOMER WHERE CREATED_AT > DATE '2024-01-01'",
    "SELECT CREATED_AT AT TIME ZONE 'UTC' FROM T_CUSTOMER",
    'SELECT NAME COLLATE Chinese_PRC_CI_AS FROM T_CUSTOMER ORDER BY NAME COLLATE "C"',
    'SELECT ROW_NUMBER() OVER (PARTITION BY STATUS ORDER BY ID) rn, NAME FROM T_CUSTOMER',
    'SELECT SUM(AMOUNT) OVER w FROM T_ORDER WINDOW w AS (PARTITION BY STATUS)',
    "SELECT STRING_AGG(NAME, ',') WITHIN GROUP (ORDER BY NAME) FROM T_CUSTOMER",
    "SELECT GROUP_CONCAT(NAME SEPARATOR ',') FROM T_CUSTOMER",
    "SELECT LISTAGG(NAME, ',') WITHIN GROUP (ORDER BY NAME) FROM T_CUSTOMER",
    'SELECT IIF(STATUS = 1, yes_text, no_text), my_function(anything) FROM T_CUSTOMER',
    'SELECT dbo.fn_label(ID), pkg.fn(NAME) FROM T_CUSTOMER',
    'SELECT c.ID FROM T_CUSTOMER c WHERE other_schema.fn(c.ID) = 1',
    'SELECT COALESCE(NAME, EMAIL, \'?\'), NULLIF(STATUS, 0), ROUND(ID / 2, 1) FROM T_CUSTOMER',
    "SELECT CASE STATUS WHEN 1 THEN 'a' ELSE 'b' END AS label FROM T_CUSTOMER",
    "SELECT CASE WHEN STATUS = 1 AND (ID > 5 OR NAME LIKE 'A%') THEN NAME ELSE EMAIL END FROM T_CUSTOMER",
    // strings and comments that look like code
    "SELECT NAME FROM T_CUSTOMER WHERE NAME = 'SELECT nope FROM nowhere'",
    'SELECT NAME FROM T_CUSTOMER WHERE NAME = "nope" AND EMAIL <> "FROM x"',
    'SELECT NAME -- , NOPE\nFROM T_CUSTOMER /* JOIN NOWHERE n ON n.x = 1 */ WHERE ID = 1',
    "SELECT NAME FROM T_CUSTOMER WHERE NAME = N'王' AND EMAIL LIKE '%@x.tw' ESCAPE '!'",
    // parameters and literals
    'SELECT NAME FROM T_CUSTOMER WHERE ID = @id AND STATUS = :status AND EMAIL = ? AND ID > $1',
    'SELECT NAME FROM T_CUSTOMER WHERE ID BETWEEN 1 AND 0x1F AND ID IN (1, 2, 3)',
    'SELECT @@ROWCOUNT, NAME FROM T_CUSTOMER',
    // joins, aliases, schemas, hints, limits
    'SELECT c.NAME, o.AMOUNT FROM T_CUSTOMER AS c INNER JOIN T_ORDER AS o ON o.CUSTOMER_ID = c.ID',
    'SELECT c.NAME FROM T_CUSTOMER c LEFT JOIN T_ORDER o ON (o.CUSTOMER_ID = c.ID AND o.STATUS = 1) '
      + 'RIGHT OUTER JOIN t_item i ON i.order_id = o.ID FULL JOIN V_ACTIVE v ON v.ID = c.ID',
    'SELECT c.NAME FROM T_CUSTOMER c CROSS JOIN T_ORDER o WHERE o.CUSTOMER_ID = c.ID',
    'SELECT c.NAME, o.AMOUNT FROM T_CUSTOMER c, T_ORDER o WHERE c.ID = o.CUSTOMER_ID',
    'SELECT T_CUSTOMER.NAME FROM T_CUSTOMER JOIN T_ORDER ON T_ORDER.CUSTOMER_ID = T_CUSTOMER.ID',
    'SELECT NAME FROM T_CUSTOMER WITH (NOLOCK) WHERE ID = 1',
    'SELECT c.NAME FROM T_CUSTOMER c WITH (NOLOCK, INDEX(ix)) JOIN T_ORDER o WITH (NOLOCK) ON o.CUSTOMER_ID = c.ID',
    'SELECT [NAME] FROM [dbo].[T_CUSTOMER] WHERE [ID] = 1',
    'SELECT `NAME` FROM `shop`.`T_CUSTOMER` WHERE `ID` = 1',
    'SELECT "NAME" FROM "public"."T_CUSTOMER" WHERE "ID" = 1',
    'SELECT shop.dbo.T_CUSTOMER.NAME FROM shop.dbo.T_CUSTOMER',
    'SELECT TOP (10) PERCENT WITH TIES NAME FROM T_CUSTOMER ORDER BY ID',
    'SELECT NAME FROM T_CUSTOMER ORDER BY ID OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY',
    'SELECT NAME FROM T_CUSTOMER ORDER BY 1 DESC NULLS LAST LIMIT 5 OFFSET 2',
    'SELECT NAME FROM T_CUSTOMER FETCH FIRST 5 ROWS ONLY',
    'SELECT DISTINCT ON (STATUS) NAME FROM T_CUSTOMER',
    'SELECT NAME FROM T_CUSTOMER GROUP BY ROLLUP (STATUS, NAME)',
    'SELECT NAME FROM T_CUSTOMER GROUP BY NAME WITH ROLLUP',
    'SELECT NAME FROM T_CUSTOMER OPTION (MAXDOP 1, RECOMPILE)',
    'SELECT NAME FROM T_CUSTOMER START WITH ID = 1 CONNECT BY PRIOR ID = STATUS',
    'SELECT NAME FROM T_CUSTOMER WHERE ID = ANY(ARRAY[1, 2]) AND tags[1] = 2',
    "SELECT NAME->>'name', EMAIL -> 'a' FROM T_CUSTOMER",
    // tables outside the model that every database has
    'SELECT table_name FROM information_schema.tables',
    'SELECT name FROM sys.objects WHERE type = \'U\'',
    'SELECT SYSDATE FROM DUAL',
    'SELECT 1 FROM dual',
  ])('%s', (sql) => {
    const result = check(sql);
    expect(result.findings.filter(f => f.severity !== 'info')).toEqual([]);
  });

  test('a project without tables only says that the table is not in the model', () => {
    expect(checkAgainstModel('SELECT a FROM t WHERE b = 1', {}).findings.map(f => f.code))
      .toEqual(['tableUnknown']);
    expect(checkAgainstModel('SELECT a FROM t', undefined).findings).toHaveLength(1);
    expect(modelTables({ entities: [null, {}, { defKey: 'A' }, { defKey: 'a', fields: [{ defKey: 'x' }] }] }))
      .toEqual({ a: { name: 'A', columns: {} } });
  });

  test('every finding has one of the known codes and a place inside the text', () => {
    const sql = 'SELECT nmae, o.x FROM T_CUSTOMER c JOIN T_ORDR o ON o.ID = c.IDD';
    const { findings } = check(sql);
    expect(findings.length).toBeGreaterThan(1);
    findings.forEach((f) => {
      expect(FINDING_CODES).toContain(f.code);
      expect(['warning', 'info']).toContain(f.severity);
      expect(sql.slice(f.start, f.end)).toBe(f.name);
    });
  });
});
