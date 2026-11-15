import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  fileListKey, fileNeed, storedPath, resolvePath, isFullPath, withFullPaths, withProjectPaths,
} from '../src/lib/testdata/file_list';
import { validateRule, importRules, exportRules } from '../src/lib/testdata/model';
import { makeValueGenerator } from '../src/lib/testdata/values';
import { createRandom } from '../src/lib/testdata/random';
import { buildPlan } from '../src/lib/testdata/plan';
import { createGenerator } from '../src/lib/testdata/generate';
import {
  detectEncoding, decodeBytes, wholeLines, big5Available,
} from '../src/app/container/tools/testdata/rules/fileEncoding';
import { readListFile, readListText } from '../src/app/container/tools/testdata/rules/fileList';
import { libraryProblems, rulesFor, findTwin } from '../src/app/container/tools/testdata/rules/libraryOps';
import { requestsOf, createLoader } from '../src/app/container/tools/testdata/generate/needs';
import { pathNote } from '../src/app/container/tools/testdata/rules/projectFile';

const { posix, win32 } = path;
const fileRule = (id, params) => ({ id, name: id, kind: 'file', params });

// ---- byte fixtures: the same three lines saved the ways Windows programs save them ----
// 王小明 / 陳美玲 / 許功蓋 in Big5; 許 功 蓋 end in 0x5C, the classic trap of Big5
const BIG5 = Buffer.from([
  0xA4, 0xFD, 0xA4, 0x70, 0xA9, 0xFA, 0x0D, 0x0A,
  0xB3, 0xAF, 0xAC, 0xFC, 0xAC, 0xC2, 0x0D, 0x0A,
  0xB3, 0x5C, 0xA5, 0x5C, 0xBB, 0x5C, 0x0D, 0x0A]);
const TEXT = '王小明\r\n陳美玲\r\n許功蓋\r\n';
const NAMES = ['王小明', '陳美玲', '許功蓋'];
const UTF8 = Buffer.from(TEXT, 'utf8');
const UTF8_BOM = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), UTF8]);
const UTF16LE = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(TEXT, 'utf16le')]);
const UTF16BE = Buffer.concat([Buffer.from([0xFE, 0xFF]),
  Buffer.from(TEXT, 'utf16le').swap16()]);

describe('the encoding of a list file', () => {
  test('this build can read Big5', () => {
    expect(big5Available()).toBe(true);
  });

  test('a byte order mark first, then valid UTF-8, else Big5', () => {
    expect(detectEncoding(UTF8)).toBe('utf8');
    expect(detectEncoding(UTF8_BOM)).toBe('utf8bom');
    expect(detectEncoding(UTF16LE)).toBe('utf16le');
    expect(detectEncoding(UTF16BE)).toBe('utf16be');
    expect(detectEncoding(BIG5)).toBe('big5');
    expect(detectEncoding(Buffer.from('plain ascii\n'))).toBe('utf8');
    expect(detectEncoding(Buffer.alloc(0))).toBe('utf8');
  });

  test('every form gives the same text, without the mark', () => {
    [UTF8, UTF8_BOM, UTF16LE, UTF16BE, BIG5].forEach((bytes) => {
      const read = decodeBytes(bytes);
      expect(read).toMatchObject({ text: TEXT, auto: true, damaged: false });
    });
    expect(decodeBytes(BIG5).encoding).toBe('big5');
  });

  test('the user can overrule what was found; a wrong choice shows as damaged', () => {
    expect(decodeBytes(BIG5, 'big5')).toMatchObject({ text: TEXT, encoding: 'big5', auto: false });
    expect(decodeBytes(BIG5, 'utf8')).toMatchObject({ encoding: 'utf8', damaged: true });
    // UTF-8 bytes read as Big5: no error says so, but the words are wrong
    expect(decodeBytes(UTF8, 'big5').text).not.toBe(TEXT);
    expect(decodeBytes(UTF8_BOM, 'utf8')).toMatchObject({ text: TEXT, encoding: 'utf8bom' });
    expect(decodeBytes(UTF16BE, 'utf16le')).toMatchObject({ text: TEXT, encoding: 'utf16be' });
    // UTF-16 without a mark is only read when chosen
    expect(decodeBytes(Buffer.from('ab\n', 'utf16le'), 'utf16le').text).toBe('ab\n');
  });

  test('bytes that are neither are read as Big5 and marked damaged', () => {
    const junk = Buffer.from([0x41, 0x81, 0x30, 0x0A]);
    expect(decodeBytes(junk)).toMatchObject({ encoding: 'big5', damaged: true });
  });

  test('a file cut in the middle of a character is cut back to whole lines', () => {
    expect(wholeLines(UTF8.slice(0, 13)).toString('utf8')).toBe('王小明\r\n');
    expect(decodeBytes(wholeLines(BIG5.slice(0, 11)))).toMatchObject({
      text: '王小明\r\n', encoding: 'big5', damaged: false,
    });
    expect(decodeBytes(wholeLines(UTF16LE.slice(0, 15))).text).toBe('王小明\r\n');
    expect(decodeBytes(wholeLines(UTF16BE.slice(0, 15))).text).toBe('王小明\r\n');
    expect(wholeLines(Buffer.from('no line end')).length).toBe(0);
  });

  test('files on disk: found, overruled, cut for the preview', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-enc-'));
    const write = (name, bytes) => {
      fs.writeFileSync(path.join(dir, name), bytes);
      return path.join(dir, name);
    };
    const files = [write('u8.txt', UTF8), write('u8bom.txt', UTF8_BOM), write('u16.txt', UTF16LE),
      write('u16be.txt', UTF16BE), write('big5.txt', BIG5)];
    for (let i = 0; i < files.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(readListFile(files[i], {})).resolves.toEqual(NAMES);
    }
    await expect(readListFile(files[4], { encoding: 'big5' })).resolves.toEqual(NAMES);
    const wrong = await readListFile(files[4], { encoding: 'utf8' });
    expect(wrong).not.toEqual(NAMES);
    // a CSV in Big5 with a heading and a second column
    const csv = write('c.csv', Buffer.concat([Buffer.from('id,name\r\n1,'), BIG5.slice(0, 8),
      Buffer.from('2,'), BIG5.slice(8, 16)]));
    await expect(readListFile(csv, { column: 1, header: true })).resolves.toEqual(NAMES.slice(0, 2));
    await expect(readListText(files[4], { maxBytes: 11, partial: true }))
      .resolves.toMatchObject({ text: '王小明\r\n', encoding: 'big5' });
    await expect(readListText('', {})).rejects.toMatchObject({ code: 'file.path.unsaved' });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('the key of a list', () => {
  test('the file and what changes its reading', () => {
    expect(fileListKey({ path: '/a.csv' })).toBe('/a.csv');
    expect(fileListKey({ path: '/a.csv', column: 0, header: false, encoding: 'auto' })).toBe('/a.csv');
    expect(fileListKey({ path: '/a.csv', column: 1 })).toBe('/a.csv\n1\n0\nauto');
    expect(fileListKey({ path: '/a.csv', header: true })).toBe('/a.csv\n0\n1\nauto');
    expect(fileListKey({ path: '/a.csv', encoding: 'big5' })).toBe('/a.csv\n0\n0\nbig5');
    expect(fileListKey({ path: '/a.csv', encoding: 'nonsense', order: 'cycle' })).toBe('/a.csv');
    expect(fileNeed({ path: '/a.csv', column: '2', header: 1 })).toEqual({
      key: '/a.csv\n2\n1\nauto', path: '/a.csv', column: 2, header: true, encoding: 'auto',
    });
  });

  test('the encoding is checked and travels with an exported rule', () => {
    expect(validateRule({ kind: 'file', params: { path: '/a', encoding: 'big5' } })).toEqual([]);
    expect(validateRule({ kind: 'file', params: { path: '/a', encoding: 'latin1' } }))
      .toEqual(['file.encoding.unknown']);
    const back = importRules(exportRules([fileRule('r', { path: '/a', encoding: 'big5', column: 1 })]));
    expect(back.problems).toEqual([]);
    expect(back.rules[0].params).toEqual({ path: '/a', encoding: 'big5', column: 1 });
  });

  test('two rules on two columns of one file each get their own list', async () => {
    const ds = {
      entities: [{
        id: 'T',
        defKey: 'T',
        fields: [
          { id: 'id', defKey: 'ID', type: 'INT', primaryKey: true, notNull: true },
          { id: 'a', defKey: 'A', type: 'VARCHAR', len: 20, testData: { rule: 'code' } },
          { id: 'b', defKey: 'B', type: 'VARCHAR', len: 20, testData: { rule: 'name' } },
          { id: 'c', defKey: 'C', type: 'VARCHAR', len: 20, testData: { rule: 'code2' } },
        ],
      }],
      profile: {
        testData: {
          rules: [
            fileRule('code', { path: 'list.csv', column: 0, header: true, order: 'cycle' }),
            fileRule('name', { path: 'list.csv', column: 1, header: true, order: 'cycle' }),
            // the same list as `code`, only drawn differently: read once
            fileRule('code2', { path: 'list.csv', column: 0, header: true, order: 'random' }),
          ],
          settings: { defaultRows: 4 },
        },
      },
    };
    const plan = buildPlan(ds, { entityIds: ['T'] });
    expect(plan.needs.files.map(f => [f.key, f.column])).toEqual([
      ['list.csv\n0\n1\nauto', 0], ['list.csv\n1\n1\nauto', 1]]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-key-'));
    fs.writeFileSync(path.join(dir, 'list.csv'), 'code,name\nA1,甲\nB2,乙\n');
    const requests = requestsOf(ds, plan, '', path.join(dir, 'project.pdma.json'));
    expect(requests.map(r => r.file)).toEqual([path.join(dir, 'list.csv'), path.join(dir, 'list.csv')]);
    expect(new Set(requests.map(r => r.id)).size).toBe(2);
    const loaded = await createLoader({
      hasConnection: () => false,
      readFile: (file, params) => readListFile(file, params),
    }).load(requests);
    expect(loaded.errors).toEqual([]);
    expect(loaded.lists.file).toEqual({
      'list.csv\n0\n1\nauto': ['A1', 'B2'],
      'list.csv\n1\n1\nauto': ['甲', '乙'],
    });
    const rows = [];
    await createGenerator(ds, plan, { seed: 1, lists: loaded.lists }).table('T', {
      onBatch: batch => rows.push(...batch),
    });
    const at = key => plan.tables[0].columns.findIndex(c => c.defKey === key);
    expect(rows.map(r => r[at('A')])).toEqual(['A1', 'B2', 'A1', 'B2']);
    expect(rows.map(r => r[at('B')])).toEqual(['甲', '乙', '甲', '乙']);
    rows.forEach(r => expect(['A1', 'B2']).toContain(r[at('C')]));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a list missing under its key is told with the path alone', () => {
    const make = () => makeValueGenerator(fileRule('r', { path: '/a.csv', column: 3 }).params
      && { kind: 'file', params: { path: '/a.csv', column: 3 } }, { kind: 'string', len: 10 }, {
      random: createRandom(1),
      lists: { file: { '/a.csv': ['x'] } },
    });
    expect(make).toThrow(expect.objectContaining({ code: 'file.missing', detail: '/a.csv' }));
  });
});

describe('where the file of a rule is', () => {
  const project = '/work/shop/shop.pdma.json';

  test('inside the project folder: relative; outside or unsaved: the full path', () => {
    expect(storedPath('/work/shop/lists/names.csv', project, posix)).toEqual({
      path: 'lists/names.csv', form: 'relative', reason: 'inside',
    });
    expect(storedPath('/work/shop/names.csv', project, posix).path).toBe('names.csv');
    expect(storedPath('/work/other/names.csv', project, posix)).toEqual({
      path: '/work/other/names.csv', form: 'absolute', reason: 'outside',
    });
    // a folder whose name only starts like the project folder is outside
    expect(storedPath('/work/shop2/names.csv', project, posix).form).toBe('absolute');
    expect(storedPath('/work/shop/names.csv', '', posix)).toEqual({
      path: '/work/shop/names.csv', form: 'absolute', reason: 'unsaved',
    });
  });

  test('Windows: back slashes become /, another drive stays a full path', () => {
    const file = 'C:\\work\\shop\\shop.pdma.json';
    expect(storedPath('C:\\work\\shop\\lists\\names.csv', file, win32).path).toBe('lists/names.csv');
    expect(storedPath('D:\\lists\\names.csv', file, win32)).toMatchObject({
      path: 'D:\\lists\\names.csv', form: 'absolute',
    });
    expect(storedPath('\\\\server\\share\\names.csv', file, win32).form).toBe('absolute');
    expect(resolvePath('lists/names.csv', file, win32)).toBe('C:\\work\\shop\\lists\\names.csv');
  });

  test('a stored path is found from wherever the project file is now', () => {
    expect(resolvePath('lists/names.csv', project, posix)).toBe('/work/shop/lists/names.csv');
    expect(resolvePath('lists\\names.csv', '/moved/shop.pdma.json', posix))
      .toBe('/moved/lists/names.csv');
    expect(resolvePath('/abs/names.csv', project, posix)).toBe('/abs/names.csv');
    expect(resolvePath('C:\\abs\\names.csv', project, posix)).toBe('C:\\abs\\names.csv');
    // relative without a project file: nowhere to look
    expect(resolvePath('lists/names.csv', '', posix)).toBe('');
    expect(resolvePath('', project, posix)).toBe('');
    expect(['/a', '\\\\s\\x', 'C:\\a', 'c:/a'].every(isFullPath)).toBe(true);
    expect(['a', './a', '../a', 'C:a', ''].some(isFullPath)).toBe(false);
  });

  test('rules leaving a project get full paths, rules entering get the project form', () => {
    const inside = fileRule('a', { path: 'lists/names.csv', column: 1 });
    const outside = fileRule('b', { path: '/elsewhere/x.csv' });
    const other = { id: 'c', name: 'c', kind: 'constant', params: { value: 'lists/names.csv' } };
    const out = withFullPaths([inside, outside, other], project, posix);
    expect(out[0].params).toEqual({ path: '/work/shop/lists/names.csv', column: 1 });
    expect(out[1]).toBe(outside);
    expect(out[2]).toBe(other);
    expect(inside.params.path).toBe('lists/names.csv');
    const back = withProjectPaths(out, project, posix);
    expect(back.map(r => r.params.path || r.params.value))
      .toEqual(['lists/names.csv', '/elsewhere/x.csv', 'lists/names.csv']);
    // into a project somewhere else: the file is outside it, the full path stays
    expect(withProjectPaths(out, '/other/p.pdma.json', posix)[0].params.path)
      .toBe('/work/shop/lists/names.csv');
    // a project never saved: nothing to resolve against, nothing changes
    expect(withFullPaths([inside], '', posix)[0]).toBe(inside);
    expect(withProjectPaths(out, '', posix)[0]).toBe(out[0]);
  });

  test('the library a rule goes to decides; the machine library refuses a relative path', () => {
    const real = path.join(os.tmpdir(), 'shop', 'shop.pdma.json');
    const inside = fileRule('a', { path: 'names.csv' });
    const toMachine = rulesFor('machine', [inside], real);
    expect(toMachine[0].params.path).toBe(path.join(os.tmpdir(), 'shop', 'names.csv'));
    expect(rulesFor('file', [inside], real)[0].params.path).toBe(toMachine[0].params.path);
    expect(rulesFor('project', toMachine, real)[0].params.path).toBe('names.csv');
    // the copy that comes back is recognised as the rule the project already has
    expect(findTwin([inside], rulesFor('project', toMachine, real)[0])).toBe(inside);
    expect(libraryProblems(inside, [], 'machine')).toEqual(['file.path.relative']);
    expect(libraryProblems(inside, [], 'project')).toEqual([]);
    expect(libraryProblems(toMachine[0], [], 'machine')).toEqual([]);
  });

  test('the editor says which form is stored', () => {
    const tr = (id, data) => `${id}${data ? `:${data.file}` : ''}`;
    const file = path.join(os.tmpdir(), 'shop', 'shop.pdma.json');
    const inside = path.join(os.tmpdir(), 'shop', 'names.csv');
    expect(pathNote(tr, 'names.csv', 'project', file)).toEqual({ text: `path.relative:${inside}` });
    expect(pathNote(tr, inside, 'project', file)).toEqual({ text: 'path.inside', canRelative: true });
    expect(pathNote(tr, path.join(os.tmpdir(), 'x.csv'), 'project', file)).toEqual({ text: 'path.outside' });
    expect(pathNote(tr, inside, 'project', '')).toEqual({ text: 'path.unsaved' });
    expect(pathNote(tr, inside, 'machine', file)).toEqual({ text: 'path.machine' });
    expect(pathNote(tr, '', 'project', file)).toEqual({ text: '' });
  });
});
