// The first rows of one table as they would be generated. Made again a moment after
// anything changes; lists and keys from outside are read once and kept (see needs.js).
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from 'components';
import { previewTable } from '../../../../../lib/testdata/generate';
import { tr } from './i18n';
import { cellText } from './format';
import { requestsOf } from './needs';

export const PREVIEW_ROWS = 20;
const DELAY = 400;

// -> {loading, columns, rows, error, loadErrors}
const usePreview = ({
  view, plan, entityId, seed, now, loader, connKey, version,
}) => {
  const [state, setState] = useState({
    loading: true, columns: [], rows: [], error: null, loadErrors: [],
  });
  const run = useRef(0);
  useEffect(() => {
    run.current += 1;
    const mine = run.current;
    const table = plan.tables.find(t => t.entityId === entityId);
    if (!table) {
      setState({
        loading: false, columns: [], rows: [], error: null, loadErrors: [],
      });
      return () => {};
    }
    setState(s => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      let loaded = {
        lists: {}, parentKeys: {}, errors: [],
      };
      try {
        loaded = await loader.load(requestsOf(view, plan, connKey));
        const result = await previewTable(view, plan, entityId, PREVIEW_ROWS, {
          seed,
          now,
          lists: loaded.lists,
          parentKeys: loaded.parentKeys,
        });
        if (mine === run.current) {
          setState({
            loading: false,
            columns: result.columns,
            rows: result.rows,
            error: null,
            loadErrors: loaded.errors,
          });
        }
      } catch (error) {
        if (mine === run.current) {
          setState({
            loading: false, columns: table.columns, rows: [], error, loadErrors: loaded.errors,
          });
        }
      }
    }, DELAY);
    return () => clearTimeout(timer);
  }, [view, plan, entityId, seed, now, connKey, version]);
  return state;
};

export default React.memo(({
  base, view, plan, entityId, seed, now, loader, connKey, errorText, loadErrorText,
}) => {
  const [version, setVersion] = useState(0);
  const state = usePreview({
    view, plan, entityId, seed, now, loader, connKey, version,
  });
  const table = plan.tables.find(t => t.entityId === entityId);
  const hasForeign = !!table && (table.foreignKeys || []).length > 0;
  const external = requestsOf(view, plan, connKey).length > 0;
  const reload = () => {
    loader.clear();
    setVersion(v => v + 1);
  };
  return <div className={`${base}-preview`}>
    <div className={`${base}-preview-head`}>
      <span className={`${base}-preview-title`}>
        {tr('preview.title', { rows: PREVIEW_ROWS })}
      </span>
      {state.loading && <span className={`${base}-dim`}>
        <Icon type='fa-spinner fa-spin'/>{tr('preview.loading')}
      </span>}
      {hasForeign && !state.loading && <span className={`${base}-dim`}>
        {tr('preview.approximate')}
      </span>}
      <span className={`${base}-preview-tools`}>
        {external && <a onClick={reload} title={tr('preview.reloadHint')}>
          <Icon type='fa-refresh'/>{tr('preview.reload')}
        </a>}
      </span>
    </div>
    {state.loadErrors.length > 0 && <div className={`${base}-preview-errors`}>
      {state.loadErrors.map(e => (
        <div key={e.request.id} className={`${base}-bad`}>
          <Icon type='fa-exclamation-circle'/>{loadErrorText(e)}
        </div>))}
    </div>}
    {state.error && state.loadErrors.length === 0 && <div className={`${base}-preview-errors`}>
      <div className={`${base}-bad`}>
        <Icon type='fa-exclamation-circle'/>{errorText(state.error)}
      </div>
    </div>}
    <div className={`${base}-preview-body`}>
      {state.rows.length > 0 && <table className={`${base}-grid ${base}-preview-grid`}>
        <thead>
          <tr>
            <th className={`${base}-preview-no`}>#</th>
            {state.columns.map(c => <th key={c.id} title={c.defName || c.defKey}>{c.defKey}</th>)}
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <tr key={i}>
              <td className={`${base}-preview-no`}>{i + 1}</td>
              {state.columns.map((c, at) => (row[at] === null || row[at] === undefined
                ? <td key={c.id} className={`${base}-preview-null`}>NULL</td>
                : <td
                  key={c.id}
                  className={typeof row[at] === 'number' ? `${base}-preview-number` : ''}
                  title={cellText(row[at])}
                >
                  {cellText(row[at])}
                </td>))}
            </tr>))}
        </tbody>
      </table>}
      {state.rows.length === 0 && !state.loading && !state.error
        && <div className={`${base}-empty`}>{tr('preview.empty')}</div>}
    </div>
  </div>;
});
