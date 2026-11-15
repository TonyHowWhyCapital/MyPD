// The reminder before a `query` rule is saved whose SQL the database has not accepted in
// this session: it says which it is (never checked, the last check failed and why, no
// connection) and offers to check now, to save anyway or to go back. Saving always stays
// possible: the database may simply be out of reach.
import React, { useEffect, useRef, useState } from 'react';
import { Button, Icon, openModal } from 'components';
import { getPrefix } from '../../../../../lib/prefixUtil';
import { CANCELLED } from '../../../../../lib/testdata/db';
import {
  needsReminder, queryState, runCheck, sqlOf,
} from './querySession';
import { checkErrorLine, connWhere } from './queryText';
import { say } from './i18n';

const q = (id, data) => say(`testDataQuery.${id}`, data);

const Reminder = ({
  dataSource, sql, onSave, onBack,
}) => {
  const prefix = getPrefix();
  const base = `${prefix}-testdata`;
  const [running, setRunning] = useState(null);
  const live = useRef({});
  live.current.running = running;
  useEffect(() => () => {
    live.current.gone = true;
    live.current.running && live.current.running.cancel();
  }, []);
  const state = queryState(dataSource, sql);
  const canCheck = state.state === 'unchecked' || state.state === 'failed';
  const checkNow = () => {
    const run = runCheck(dataSource, sql);
    setRunning(run);
    run.then((entry) => {
      if (live.current.gone) {
        return;
      }
      setRunning(null);
      // accepted: that was all that stood in the way
      entry.status === 'ok' && onSave(true);
    }, (error) => {
      !live.current.gone && error && error.code === CANCELLED && setRunning(null);
    });
  };
  const why = {
    noConnection: q('save.noConnection'),
    incomplete: q('check.incomplete', { name: state.target ? state.target.name : '' }),
    noJava: q('save.noJava'),
    failed: q('save.failed'),
  }[state.state] || q('save.unchecked');
  return <div className={`${base}-query-remind`}>
    <div className={`${base}-query-remind-why`}>
      <Icon type='fa-exclamation-triangle'/>{why}
    </div>
    {state.state === 'failed' && <div className={`${base}-query-remind-reason`}>
      {checkErrorLine(say, state.entry.error)}
    </div>}
    <pre className={`${base}-query-remind-sql`}>{sql}</pre>
    {canCheck && <div className={`${base}-query-conn`}>
      <i>{q('check.using')}</i><b>{state.target.name}</b>
      <span>{connWhere(state.target)}</span>
    </div>}
    <div className={`${base}-query-remind-note`}>{q('save.note')}</div>
    {running && <div className={`${base}-query-neutral`}>
      <Icon type='fa-spinner fa-spin'/>{q('check.running')}
    </div>}
    <div className={`${prefix}-modal-footer`}>
      {canCheck && !running && <Button type='primary' onClick={checkNow}>
        {q('save.checkNow')}
      </Button>}
      {running && <Button onClick={() => running.cancel()}>{q('check.cancel')}</Button>}
      <Button disable={!!running} onClick={() => onSave(false)}>{q('save.saveAnyway')}</Button>
      <Button disable={!!running} onClick={onBack}>{q('save.back')}</Button>
    </div>
  </div>;
};

// Runs `save` at once when there is nothing to remind of; otherwise asks first.
//   rule      the draft about to be saved
//   original  the stored rule it replaces (none for a new rule): untouched SQL is not asked about
// save(checked) gets true when the check made from the reminder passed.
export const saveWithReminder = ({ rule, original, dataSource }, save) => {
  if (!needsReminder(rule, original, dataSource)) {
    save(false);
    return null;
  }
  let modal;
  const close = () => modal && modal.close();
  modal = openModal(<Reminder
    dataSource={dataSource}
    sql={sqlOf(rule)}
    onBack={close}
    onSave={(checked) => {
      close();
      save(checked);
    }}
  />, {
    title: q('save.title'),
    bodyStyle: { width: 560 },
  });
  return modal;
};

export default saveWithReminder;
