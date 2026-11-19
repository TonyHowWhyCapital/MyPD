import fs from 'fs';
import os from 'os';
import path from 'path';
import _ from 'lodash';
import { execFileSync, spawnSync } from 'child_process';
import { renderToStaticMarkup } from 'react-dom/server';
import { Message, Modal, openModal } from 'components';
import langs from '../src/lang';
import { configure } from '../src/lib/testdata/db';
import { applyScript } from '../src/app/container/tools/modelcompare/applyDdl';

// The "run on database" flow of the model compare, with the real Java tool on a SQLite file;
// the dialogs are recorded instead of shown.
jest.mock('components', () => {
  /* eslint-disable global-require */
  const React = require('react');
  const lookup = (id, data) => `${require('lodash').get(require('../src/lang').default.zh, id, id)}`
    .replace(/\{(\w+)\}/g, (all, name) => (data && data[name] !== undefined ? data[name] : all));
  const FormatMessage = ({ id }) => lookup(id);
  FormatMessage.string = ({ id, data }) => lookup(id, data);
  /* eslint-enable global-require */
  return {
    Button: ({ children, onClick }) => React.createElement('button', { onClick }, children),
    FormatMessage,
    Message: { success: jest.fn(), error: jest.fn(), warring: jest.fn() },
    Modal: { confirm: jest.fn() },
    openModal: jest.fn(),
  };
}, { virtual: true });

const zh = id => _.get(langs.zh, `modelCompare.${id}`);
const root = path.resolve(__dirname, '..');
const jar = path.join(root, 'public/jar/pdmaner-java.jar');
const works = (cmd, args) => {
  try {
    return spawnSync(cmd, args).status === 0;
  } catch (e) {
    return false;
  }
};
const hasAll = works('java', ['-version']) && works('sqlite3', ['-version'])
  && fs.existsSync(jar) && fs.existsSync(path.join(root, 'public/jar/tools/mypd/ApplyDdl.class'));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mypd-apply-test-'));
const dbFile = path.join(work, 'test.db');
const password = 'Pw-for-apply-7731';
const conn = {
  defKey: 'local',
  defName: 'Local test',
  type: 'SQLite',
  properties: {
    driver_class_name: 'org.sqlite.JDBC', url: `jdbc:sqlite:${dbFile}`, username: 'scott', password,
  },
};
const columns = () => execFileSync('sqlite3', [dbFile, "SELECT name FROM pragma_table_info('T')"])
  .toString().trim().split('\n');

// starts the flow and answers the confirmation; resolves with what the user is shown at the end
const apply = text => new Promise((resolve) => {
  Modal.confirm.mockClear();
  Message.success.mockClear();
  openModal.mockReset();
  // the user closes the error dialog
  openModal.mockImplementation((content, options) => {
    setTimeout(options.onClose);
    return { close: jest.fn() };
  });
  const done = outcome => resolve({
    outcome,
    confirm: renderToStaticMarkup(Modal.confirm.mock.calls[0][0].message),
    failure: openModal.mock.calls.length ? openModal.mock.calls[0] : null,
  });
  applyScript({
    cls: 'mc',
    dataSource: {},
    config: {},
    conn,
    text,
    openLoading: () => {},
    closeLoading: () => {},
    onApplied: () => done('applied'),
    onFailed: () => done('failed'),
  });
  Modal.confirm.mock.calls[0][0].onOk();
});

jest.setTimeout(120000);

afterAll(() => {
  fs.rmdirSync(work, { recursive: true });
});

test('a script with nothing to run says so and asks nothing', () => {
  Modal.confirm.mockClear();
  applyScript({ cls: 'mc', dataSource: {}, config: {}, conn, text: '-- nothing;\n;' });
  expect(Message.warring).toHaveBeenCalledWith({ title: zh('applyNothing') });
  expect(Modal.confirm).not.toHaveBeenCalled();
});

(hasAll ? describe : describe.skip)('run on database (SQLite)', () => {
  beforeAll(() => {
    execFileSync('sqlite3', [dbFile, 'CREATE TABLE T (ID INTEGER); CREATE TABLE OLD (ID INTEGER);']);
    configure({ jarPath: jar, tmpDir: work });
  });

  test('confirms with the connection, the count, the rollback and each DROP, then runs', async () => {
    const shown = await apply('ALTER TABLE T ADD COLUMN A INT;\n-- gone\nDROP TABLE OLD;');
    expect(shown.confirm).toContain('Local test');
    expect(shown.confirm).toContain(zh('applyCount').replace('{count}', 2));
    expect(shown.confirm).toContain(zh('applyTransactional'));
    expect(shown.confirm).toMatch(/class="mc-apply-danger".*DROP TABLE OLD/);
    expect(shown.confirm).not.toContain('ALTER TABLE T ADD COLUMN A INT</pre>');
    expect(shown.confirm).not.toContain(password);
    expect(shown.confirm).not.toContain('scott');
    expect(shown.outcome).toBe('applied');
    expect(Message.success).toHaveBeenCalledWith({ title: zh('applied').replace('{count}', 2) });
    expect(columns()).toEqual(['ID', 'A']);
  });

  test('a failure names the statement and says everything was rolled back', async () => {
    const shown = await apply('ALTER TABLE T ADD COLUMN B INT;\nALTER TABLE NO_SUCH ADD COLUMN C INT;');
    expect(shown.outcome).toBe('failed');
    const [content, options] = shown.failure;
    const html = renderToStaticMarkup(content);
    expect(options.title).toBe(zh('applyFailTitle'));
    expect(html).toContain(zh('applyFailAt').replace('{index}', 2).replace('{total}', 2));
    expect(html).toContain('ALTER TABLE NO_SUCH ADD COLUMN C INT');
    expect(html).toContain('NO_SUCH');
    expect(html).toContain(zh('applyRolledBack'));
    expect(html).not.toContain(password);
    expect(columns()).toEqual(['ID', 'A']);
  });
});
