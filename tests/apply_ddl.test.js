import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { configure, executeDdl } from '../src/lib/testdata/db';

// Runs the ddl mode of the real Java tool against a throwaway SQLite file with the driver inside
// the engine jar. Skipped when java, the jar or the sqlite3 command is not there.
const root = path.resolve(__dirname, '..');
const jar = path.join(root, 'public/jar/pdmaner-java.jar');
const tools = path.join(root, 'public/jar/tools');
const works = (cmd, args) => {
  try {
    return spawnSync(cmd, args).status === 0;
  } catch (e) {
    return false;
  }
};
const hasAll = works('java', ['-version']) && fs.existsSync(path.join(tools, 'mypd/ApplyDdl.class'))
  && fs.existsSync(jar) && works('sqlite3', ['-version']);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mypd-ddl-test-'));
const tmpDir = path.join(work, 'tmp');
const password = 'S3cret-pw-5182';
let files = 0;
const freshConn = () => {
  files += 1;
  const file = path.join(work, `test${files}.db`);
  execFileSync('sqlite3', [file, 'CREATE TABLE T (ID INTEGER PRIMARY KEY);']);
  return {
    file,
    conn: {
      defKey: 'sqlite',
      properties: {
        driver_class_name: 'org.sqlite.JDBC', url: `jdbc:sqlite:${file}`, username: 'u', password,
      },
    },
  };
};
const columns = file => execFileSync('sqlite3', [file, "SELECT name FROM pragma_table_info('T')"])
  .toString().trim().split('\n');
const tables = file => execFileSync('sqlite3', [file,
  "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"]).toString().trim().split('\n');
const fail = promise => promise.then(() => {
  throw new Error('expected a rejection');
}, e => e);
const failing = ['CREATE TABLE U (ID INTEGER)', 'ALTER TABLE NO_SUCH ADD COLUMN X INT',
  'ALTER TABLE T ADD COLUMN Z INT'];

jest.setTimeout(120000);

afterAll(() => {
  fs.rmdirSync(work, { recursive: true });
});

(hasAll ? describe : describe.skip)('executeDdl against SQLite', () => {
  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    configure({ jarPath: jar, tmpDir });
  });

  afterEach(() => {
    // parameter, result and progress files never outlive a call
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  test('creates a table and adds columns, reporting each step', async () => {
    const { file, conn } = freshConn();
    const progress = [];
    const run = executeDdl({}, {}, conn, ['CREATE TABLE U (ID INTEGER)',
      'ALTER TABLE T ADD COLUMN NAME VARCHAR(20)', 'ALTER TABLE T ADD COLUMN AGE INT'],
    p => progress.push(p));
    expect(await run.promise).toEqual({ executed: 3, transactional: true });
    expect(tables(file)).toEqual(['T', 'U']);
    expect(columns(file)).toEqual(['ID', 'NAME', 'AGE']);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toEqual({ done: 3, total: 3 });
    progress.forEach(p => expect(p.total).toBe(3));
  });

  test('a failure in a transactional database undoes the statements before it', async () => {
    const { file, conn } = freshConn();
    const error = await fail(executeDdl({}, {}, conn, failing).promise);
    expect(error).toMatchObject({ index: 1, executed: 0, rolledBack: true });
    expect(error.message).toMatch(/NO_SUCH/);
    expect(error.message).not.toContain(password);
    expect(tables(file)).toEqual(['T']);
    expect(columns(file)).toEqual(['ID']);
  });

  test('a database that commits DDL at once keeps what ran and stops at the failure', () => {
    // the dialect of the parameter file decides the transaction strategy: SQLite run as MySQL
    const { file, conn } = freshConn();
    const params = path.join(work, 'params.json');
    const out = path.join(work, 'out.json');
    fs.writeFileSync(params, JSON.stringify({
      ...conn.properties, mode: 'ddl', dialect: 'mysql', statements: failing, out,
    }), { mode: 0o600 });
    spawnSync('java', ['-cp', jar, `-Dloader.path=${tools}${path.sep}`, '-Dloader.main=mypd.TestData',
      'org.springframework.boot.loader.PropertiesLauncher', `params=${params}`]);
    const result = JSON.parse(fs.readFileSync(out, 'utf8'));
    fs.unlinkSync(out);
    expect(fs.existsSync(params)).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.body).toMatchObject({ index: 1, executed: 1, rolledBack: false });
    expect(tables(file)).toEqual(['T', 'U']);
    expect(columns(file)).toEqual(['ID']);
  });

  test('nothing to run is refused', async () => {
    const { conn } = freshConn();
    expect(await fail(executeDdl({}, {}, conn, []).promise)).toMatchObject({ code: 'BAD_PARAMS' });
  });
});
