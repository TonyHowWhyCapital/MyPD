// Where the project file is, for the paths of `file` rules stored relative to it. The
// app has one project open at a time and tells its file here whenever it changes
// (opened, saved for the first time, saved as); '' = the project was never saved.
import {
  resolvePath, storedPath, isFullPath,
} from '../../../../../lib/testdata/file_list';

let current = '';

export const setProjectFile = (file) => {
  current = typeof file === 'string' ? file : '';
};

export const getProjectFile = () => current;

// the file a `file` rule reads; '' when it is relative and the project has no file yet
export const ruleFile = params => resolvePath(params && params.path, current);

// how a file chosen for a rule of the project is stored: {path, form, reason}
export const ruleFilePath = chosen => storedPath(chosen, current);

// What to say about the way the path is stored -> {text, canRelative}
//   scope 'project': inside the project folder -> relative, else the full path
//   scope 'machine': always the full path
export const pathNote = (tr, path, scope, projectFile) => {
  if (!path) {
    return { text: '' };
  }
  if (scope === 'machine') {
    return { text: tr('path.machine') };
  }
  if (!isFullPath(path)) {
    const file = resolvePath(path, projectFile);
    return { text: file ? tr('path.relative', { file }) : '' };
  }
  if (!projectFile) {
    return { text: tr('path.unsaved') };
  }
  return storedPath(path, projectFile).form === 'relative'
    ? { text: tr('path.inside'), canRelative: true } : { text: tr('path.outside') };
};
