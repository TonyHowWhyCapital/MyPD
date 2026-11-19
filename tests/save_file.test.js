/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('electron', () => ({ ipcRenderer: {}, shell: {} }), { virtual: true });
jest.mock('@electron/remote', () => ({ app: { getPath: () => require('os').tmpdir() }, dialog: {} }), { virtual: true });
jest.mock('components', () => ({ FormatMessage: { string: () => '' } }), { virtual: true });
jest.mock('../src/lib/datasource_util', () => ({ defaultJVM: '', transform: x => x }));
jest.mock('../src/lib/update', () => ({ compareVersion: () => 0 }));
jest.mock('../src/lib/event_tool', () => ({ postWorkerFuc: jest.fn() }));

const { saveNormalFile, saveJsonPromise } = require('../src/lib/json');
const { postWorkerFuc } = require('../src/lib/event_tool');

describe('saving a file', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mypd-save-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('replaces the content and leaves no temp file', async () => {
    const file = path.join(dir, 'a.pdma.json');
    fs.writeFileSync(file, 'old');
    await expect(saveNormalFile(file, 'new')).resolves.toBe('new');
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
    expect(fs.readdirSync(dir)).toEqual(['a.pdma.json']);
  });

  test('keeps the old file when the write fails', async () => {
    const file = path.join(dir, 'a.pdma.json');
    fs.writeFileSync(file, 'old');
    await expect(saveNormalFile(file, Symbol('not writable'))).rejects.toBeTruthy();
    expect(fs.readFileSync(file, 'utf8')).toBe('old');
    expect(fs.readdirSync(dir)).toEqual(['a.pdma.json']);
  });

  test('rejects when the worker fails to serialize', async () => {
    postWorkerFuc.mockReturnValueOnce(Promise.reject(new Error('Invalid string length')));
    await expect(saveJsonPromise(path.join(dir, 'b.json'), { a: 1 })).rejects.toThrow('Invalid string length');
  });
});
