import { useEffect, useState } from 'react';
import { fileEncoding, fileListKey } from '../../../../../lib/testdata/file_list';
import { readListText, parseListText, listColumns } from './fileList';
import { ruleFile } from './projectFile';

const FILE_PREVIEW_BYTES = 256 * 1024;
const FILE_PREVIEW_VALUES = 2000;

// The first values of the file of a `file` rule, read again when the file, the column,
// the heading option or the encoding changes.
// -> {loading, key, file, values, columns, encoding, auto, damaged, error}
//    key: where the generator looks the list up (fileListKey); file: the file read
export default (rule) => {
  const p = (rule && rule.params) || {};
  const active = !!rule && rule.kind === 'file' && typeof p.path === 'string' && p.path !== '';
  const file = active ? ruleFile(p) : '';
  const encoding = fileEncoding(p);
  const [state, setState] = useState({});
  useEffect(() => {
    if (!active) {
      setState({});
      return () => {};
    }
    let alive = true;
    const key = fileListKey(p);
    setState(s => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      readListText(file, {
        maxBytes: FILE_PREVIEW_BYTES,
        partial: true,
        encoding,
      }).then((read) => {
        const values = parseListText(read.text, p, FILE_PREVIEW_VALUES);
        alive && setState({
          key,
          file,
          values,
          columns: listColumns(read.text, !!p.header),
          encoding: read.encoding,
          auto: read.auto,
          damaged: read.damaged,
          error: values.length === 0 ? { code: 'file.empty' } : null,
        });
      }).catch((e) => {
        alive && setState({
          key,
          file,
          values: [],
          error: { code: e.code || 'file.read' },
        });
      });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active, file, p.path, p.column, p.header, encoding]);
  return state;
};

// the lists a preview needs, from what the hook read
export const listsOf = state => (state && state.key !== undefined
  && (state.values || []).length > 0 ? { file: { [state.key]: state.values } } : undefined);
