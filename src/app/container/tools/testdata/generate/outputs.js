// The outputs of a run as sinks for runAll (run.js). Every sink writes beside its target
// under a temporary name and moves the result in place only when the run got through, so
// a cancelled or failed run leaves no half file and never damages a file that was there.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSqlWriter, createDbBundleWriter, safeFileName } from '../../../../../lib/testdata/files';
import { createCsvWriter } from '../../../../../lib/testdata/csv';
import { createXlsxWriter } from '../../../../../lib/testdata/xlsx';

const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1679616).toString(36)}`;

const removeFile = (file) => {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    // not there
  }
};

export const removeTree = (dir) => {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return;
  }
  names.forEach((name) => {
    const full = path.join(dir, name);
    let isDir = false;
    try {
      isDir = fs.lstatSync(full).isDirectory();
    } catch (e) {
      // gone meanwhile
    }
    if (isDir) {
      removeTree(full);
    } else {
      removeFile(full);
    }
  });
  try {
    fs.rmdirSync(dir);
  } catch (e) {
    // not empty or gone
  }
};

const sizeOf = (file) => {
  try {
    return fs.statSync(file).size;
  } catch (e) {
    return 0;
  }
};

// creates the folders of `dir` that are missing -> the ones it made, outermost first
const makeDirs = (dir) => {
  const made = [];
  let current = path.resolve(dir);
  const missing = [];
  while (!fs.existsSync(current)) {
    missing.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  missing.forEach((d) => {
    fs.mkdirSync(d);
    made.push(d);
  });
  return made;
};

const dropEmptyDirs = dirs => dirs.slice().reverse().forEach((d) => {
  try {
    fs.rmdirSync(d);
  } catch (e) {
    // holds something else by now
  }
});

// one file written under a temporary name
const fileSink = (key, file, open) => {
  const temp = `${file}.${stamp()}.tmp`;
  let made = [];
  return {
    key,
    create: () => {
      made = makeDirs(path.dirname(file));
      return open(temp);
    },
    commit: async (result) => {
      fs.renameSync(temp, file);
      made = [];
      return {
        kind: key,
        file,
        bytes: sizeOf(file),
        rows: result.rows,
      };
    },
    discard: () => {
      removeFile(temp);
      removeFile(`${temp}.part`);
      dropEmptyDirs(made);
    },
  };
};

// options: {multiRow, go} as createSqlWriter takes them
export const sqlSink = (file, dialect, options) => fileSink('sql', file,
  temp => createSqlWriter(temp, dialect, options));

export const xlsxSink = file => fileSink('xlsx', file, temp => createXlsxWriter(temp));

// one CSV file per table in `dir`
export const csvSink = (dir) => {
  const temp = path.join(dir, `.mypd-${stamp()}.tmp`);
  let made = [];
  return {
    key: 'csv',
    create: () => {
      made = makeDirs(dir);
      return createCsvWriter(temp);
    },
    commit: async (result) => {
      const files = result.files.map((f) => {
        const target = path.join(dir, f.file);
        fs.renameSync(f.path, target);
        return {
          table: f.table,
          file: target,
          rows: f.rows,
          bytes: sizeOf(target),
        };
      });
      removeTree(temp);
      made = [];
      return {
        kind: 'csv',
        dir,
        files,
        bytes: files.reduce((sum, f) => sum + f.bytes, 0),
        rows: result.rows,
      };
    },
    discard: () => {
      removeTree(temp);
      dropEmptyDirs(made);
    },
  };
};

// the bundle the database tool reads, in a private temporary folder that never outlives
// the run: discard() is called after the write as well
export const dbSink = (dialect, tmpRoot) => {
  let dir = '';
  return {
    key: 'db',
    create: () => {
      dir = fs.mkdtempSync(path.join(tmpRoot || os.tmpdir(), 'mypd-testdata-rows-'));
      return createDbBundleWriter(dir, dialect);
    },
    commit: async result => ({
      kind: 'db',
      dir,
      rows: result.rows,
    }),
    discard: () => {
      if (dir) {
        removeTree(dir);
      }
    },
  };
};

// the CSV file names the tables of a plan get, as createCsvWriter gives them
export const csvFileNames = (tables) => {
  const used = new Set();
  return tables.map(t => `${safeFileName(t.defKey, used)}.csv`);
};

// files of the chosen outputs that exist already and would be replaced
// targets = {sql?: file, xlsx?: file, csv?: dir}
export const existingTargets = (targets, tables) => {
  const found = [];
  ['sql', 'xlsx'].forEach((key) => {
    if (targets[key] && fs.existsSync(targets[key])) {
      found.push(targets[key]);
    }
  });
  if (targets.csv) {
    csvFileNames(tables).map(name => path.join(targets.csv, name))
      .filter(file => fs.existsSync(file)).forEach(file => found.push(file));
  }
  return found;
};

// '' when the path can be written to, else a code: 'empty' | 'relative' | 'isDirectory' |
// 'isFile' (a folder is wanted but a file is there) | 'parentIsFile'
export const targetProblem = (target, kind) => {
  const value = `${target || ''}`.trim();
  if (!value) {
    return 'empty';
  }
  if (!path.isAbsolute(value)) {
    return 'relative';
  }
  const stat = (p) => {
    try {
      return fs.statSync(p);
    } catch (e) {
      return null;
    }
  };
  const own = stat(value);
  if (own && kind === 'file' && own.isDirectory()) {
    return 'isDirectory';
  }
  if (own && kind === 'dir' && !own.isDirectory()) {
    return 'isFile';
  }
  let parent = path.dirname(value);
  while (parent !== path.dirname(parent) && !stat(parent)) {
    parent = path.dirname(parent);
  }
  const up = stat(parent);
  return up && !up.isDirectory() ? 'parentIsFile' : '';
};
