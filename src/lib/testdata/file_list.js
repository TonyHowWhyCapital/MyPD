// What identifies the list of a `file` rule and where its file is.
//
// The list: two rules may read the same file differently (another column, a heading
// line, another encoding), so a list is kept under the file AND the options that change
// what is read: `fileListKey(params)`. The planner asks for it in `needs.files`, the
// windows load it into `lists.file[key]`, the generator looks it up with the same key.
//
// The path: a file inside the folder of the project file is stored relative to that
// folder (the project can move with its lists); any other file is stored with its full
// path. A relative path only means something inside a project, so a rule that leaves the
// project (machine library, export) gets the full path.
import nodePath from 'path';

export const FILE_ENCODINGS = ['auto', 'utf8', 'big5', 'utf16le'];

export const fileEncoding = (params) => {
  const encoding = params && params.encoding;
  return FILE_ENCODINGS.includes(encoding) ? encoding : 'auto';
};

export const fileColumn = (params) => {
  const column = Number(params && params.column);
  return Number.isInteger(column) && column >= 0 ? column : 0;
};

// The key of the list in `lists.file`. A rule with nothing special (first column, no
// heading, encoding found automatically) is keyed by its path alone.
export const fileListKey = (params) => {
  const p = params || {};
  const column = fileColumn(p);
  const header = !!p.header;
  const encoding = fileEncoding(p);
  const path = `${p.path === undefined || p.path === null ? '' : p.path}`;
  return column === 0 && !header && encoding === 'auto' ? path
    : [path, column, header ? 1 : 0, encoding].join('\n');
};

// what a window has to read for a `file` rule
export const fileNeed = params => ({
  key: fileListKey(params),
  path: `${(params && params.path) || ''}`,
  column: fileColumn(params),
  header: !!(params && params.header),
  encoding: fileEncoding(params),
});

// a full path of any system: /x, \\server\x, C:\x, C:/x
export const isFullPath = text => /^(?:[\\/]|[A-Za-z]:[\\/])/.test(`${text || ''}`);

const apiOf = api => api || nodePath;
const folderOf = (projectFile, api) => (projectFile ? apiOf(api).dirname(projectFile) : '');

// How a chosen file is stored in a rule of the project whose file is `projectFile`
// ('' = never saved). -> {path, form: 'relative' | 'absolute', reason: 'inside' |
// 'outside' | 'unsaved'}; a relative path is written with `/` on every system.
export const storedPath = (chosen, projectFile, api) => {
  const p = apiOf(api);
  const full = `${chosen || ''}`;
  const folder = folderOf(projectFile, api);
  if (!folder) {
    return { path: full, form: 'absolute', reason: 'unsaved' };
  }
  if (!isFullPath(full)) {
    // typed by hand without a folder: taken as beside the project
    return { path: full.replace(/\\/g, '/'), form: 'relative', reason: 'inside' };
  }
  const relative = p.relative(folder, full);
  if (!relative || relative.startsWith('..') || isFullPath(relative)) {
    return { path: full, form: 'absolute', reason: 'outside' };
  }
  return { path: relative.split(p.sep).join('/'), form: 'relative', reason: 'inside' };
};

// The file a stored path stands for. A relative path of a project that has no file yet
// cannot be found: '' is returned and the caller reports `file.path.unsaved`.
export const resolvePath = (stored, projectFile, api) => {
  const text = `${stored || ''}`;
  if (!text || isFullPath(text)) {
    return text;
  }
  const folder = folderOf(projectFile, api);
  return folder ? apiOf(api).join(folder, ...text.split(/[\\/]/)) : '';
};

const mapFilePaths = (rules, change) => (rules || []).map((rule) => {
  const path = rule && rule.kind === 'file' && rule.params ? rule.params.path : undefined;
  if (typeof path !== 'string' || path === '') {
    return rule;
  }
  const next = change(path);
  return next === path ? rule : { ...rule, params: { ...rule.params, path: next } };
});

// rules leaving the project: relative paths become full paths (kept as they are when the
// project has no file, there is nothing to resolve them against)
export const withFullPaths = (rules, projectFile, api) => mapFilePaths(rules,
  path => resolvePath(path, projectFile, api) || path);

// rules entering the project: a file inside the project folder is stored relative
export const withProjectPaths = (rules, projectFile, api) => mapFilePaths(rules,
  path => (isFullPath(path) ? storedPath(path, projectFile, api).path : path));
