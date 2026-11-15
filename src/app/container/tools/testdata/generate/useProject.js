// The project as the window works on it. Changes go to the app through its normal update
// path (a moment later, so that typing a number does not redraw the whole app with every
// key); changes made elsewhere while the window is open (the connection settings) are
// taken over. Tables open in editor tabs are kept in step: see setFieldValue.
import {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { getAllTabData, replaceDataByTabId } from '../../../../../lib/cache';
import { notify } from '../../../../../lib/subscribe';
import { readSettings, writeSettings } from './settings';
import {
  withTabRules, entityTabs, patchTabData, applyFieldValue, dirtyEntityIds,
} from './planView';

const PUSH_DELAY = 300;
const WATCH_INTERVAL = 500;

export default ({ dataSource, getDataSource, updateDataSource }) => {
  const [ds, setDs] = useState(() => (getDataSource && getDataSource()) || dataSource);
  const [tabVersion, setTabVersion] = useState(0);
  const ref = useRef({
    ds,
    seen: ds,
    own: new WeakSet(),
    timer: null,
  });
  const flush = () => {
    const r = ref.current;
    if (r.timer) {
      clearTimeout(r.timer);
      r.timer = null;
      updateDataSource && updateDataSource(r.ds);
    }
  };
  const get = () => ref.current.ds;
  // local at once, the app after a pause; `now` for changes other windows read right away
  const update = (next, now) => {
    const r = ref.current;
    if (!next || next === r.ds) {
      return;
    }
    r.own.add(next);
    r.ds = next;
    setDs(next);
    clearTimeout(r.timer);
    r.timer = setTimeout(flush, PUSH_DELAY);
    if (now) {
      flush();
    }
  };
  useEffect(() => {
    const watch = setInterval(() => {
      const r = ref.current;
      const outside = getDataSource && getDataSource();
      if (r.timer || !outside || outside === r.seen) {
        return;
      }
      r.seen = outside;
      if (!r.own.has(outside)) {
        // somebody else changed the project (connection settings, a save): follow
        r.ds = outside;
        setDs(outside);
        setTabVersion(v => v + 1);
      }
    }, WATCH_INTERVAL);
    return () => {
      clearInterval(watch);
      flush();
    };
  }, []);
  // what the plan and the generator read: the project with the rules the tabs show
  const view = useMemo(() => withTabRules(ds, getAllTabData()), [ds, tabVersion]);
  const settings = useMemo(() => readSettings(ds), [ds]);
  const unsaved = useMemo(() => dirtyEntityIds(getAllTabData()), [ds, tabVersion]);
  return {
    ds,
    view,
    settings,
    unsaved,
    get,
    update,
    // for windows opened from here that write the project themselves (rule editor, library)
    updateNow: next => update(next, true),
    // the day a fixed seed counts relative dates from
    setBaseDate: baseDate => update(writeSettings(ref.current.ds, {
      ...readSettings(ref.current.ds),
      seed: { ...readSettings(ref.current.ds).seed, baseDate },
    })),
    setSettings: next => update(writeSettings(ref.current.ds, next)),
    // The rule and the null rate of a column: {rule, nullRate} | undefined. Written into
    // the project and into every editor tab that shows the table, the way the app does
    // it when a tool changes a table that is open (replaceDataByTabId + tabDataChange).
    // The other edits of the tab stay untouched and unsaved.
    setFieldValue: (entityId, fieldId, value) => {
      update(applyFieldValue(ref.current.ds, entityId, fieldId, value));
      const tabs = getAllTabData();
      entityTabs(tabs).filter(t => t.entityId === entityId).forEach((t) => {
        const data = patchTabData(t.data, fieldId, value);
        if (data) {
          replaceDataByTabId(t.tabKey, {
            ...tabs[t.tabKey],
            data,
          });
          notify('tabDataChange', {
            id: entityId,
            d: data,
          });
        }
      });
      setTabVersion(v => v + 1);
    },
  };
};
