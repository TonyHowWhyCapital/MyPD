// The few things the window asks of the desktop: choosing where a file or a folder goes
// and showing a result in the file manager.
import os from 'os';
import path from 'path';
import { showFileInFolder } from '../../../../../lib/middle';

// required when used: this file must load without Electron (jest)
// eslint-disable-next-line global-require, import/no-extraneous-dependencies
const dialogOf = () => require('@electron/remote').dialog;

// -> the chosen path, or '' when the user backed out
export const pickFile = (defaultPath, name, extension) => dialogOf().showSaveDialog({
  defaultPath,
  filters: [{ name, extensions: [extension] }],
  properties: ['createDirectory'],
}).then(({ filePath }) => {
  if (!filePath) {
    return '';
  }
  return new RegExp(`\\.${extension}$`, 'i').test(filePath) ? filePath : `${filePath}.${extension}`;
}).catch(() => '');

export const pickFolder = defaultPath => dialogOf().showOpenDialog({
  defaultPath,
  properties: ['openDirectory', 'createDirectory'],
}).then(({ filePaths }) => (filePaths && filePaths[0]) || '').catch(() => '');

export const showInFolder = target => showFileInFolder(target);

// where the outputs go by default: beside the project file, like the other exports
export const defaultFolder = projectFile => (projectFile ? path.dirname(projectFile)
  : path.join(os.homedir(), 'Documents'));

// a project name as the start of a file name
export const baseName = (dataSource) => {
  const name = `${(dataSource && dataSource.name) || ''}`
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F<>:"/\\|?*]/g, '_').trim();
  return name || 'testdata';
};

export const defaultTargets = (dataSource, projectFile) => {
  const dir = defaultFolder(projectFile);
  const base = baseName(dataSource);
  return {
    sql: path.join(dir, `${base}-testdata.sql`),
    csv: path.join(dir, `${base}-testdata-csv`),
    xlsx: path.join(dir, `${base}-testdata.xlsx`),
  };
};
