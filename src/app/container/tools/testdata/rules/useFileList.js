import { useEffect, useState } from 'react';
import { readListText, parseListText, listColumns } from './fileList';

const FILE_PREVIEW_BYTES = 256 * 1024;
const FILE_PREVIEW_VALUES = 2000;

// the first values of the file of a `file` rule, read again when the file, the column
// or the heading option changes
export default (rule) => {
  const p = (rule && rule.params) || {};
  const active = !!rule && rule.kind === 'file' && typeof p.path === 'string' && p.path !== '';
  const [state, setState] = useState({});
  useEffect(() => {
    if (!active) {
      setState({});
      return () => {};
    }
    let alive = true;
    setState(s => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      readListText(p.path, { maxBytes: FILE_PREVIEW_BYTES, partial: true }).then((text) => {
        const values = parseListText(text, p, FILE_PREVIEW_VALUES);
        alive && setState({
          path: p.path,
          values,
          columns: listColumns(text, !!p.header),
          error: values.length === 0 ? { code: 'file.empty' } : null,
        });
      }).catch((e) => {
        alive && setState({ path: p.path, values: [], error: { code: e.code || 'file.read' } });
      });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active, p.path, p.column, p.header]);
  return state;
};
