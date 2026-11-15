// Asked every time before rows are written into a database: where they go, what is in
// the tables now, what happens to it and what to do when a row is refused.
import React, { useEffect, useRef, useState } from 'react';
import {
  Button, Icon, Input, Radio, openModal, FormatMessage,
} from 'components';
import { inspectTables } from '../../../../../lib/testdata/db';
import { tr } from './i18n';
import { count } from './format';
import { plannedRows } from './planView';

const { RadioGroup } = Radio;

const same = (typed, wanted) => `${typed}`.trim().toLowerCase() === `${wanted}`.trim().toLowerCase();

const Confirm = ({
  base, view, config, conn, target, plan, dialectName, errorText, onState,
}) => {
  const [state, setState] = useState({ loading: true });
  const [existing, setExisting] = useState('append');
  const [onError, setOnError] = useState('rollback');
  const [typed, setTyped] = useState('');
  const alive = useRef(true);
  const names = plan.tables.map(t => t.defKey);
  const inspect = () => {
    setState({ loading: true });
    inspectTables(view, config, conn, names).then((tables) => {
      alive.current && setState({ tables });
    }).catch((error) => {
      alive.current && setState({ error });
    });
  };
  useEffect(() => {
    inspect();
    return () => {
      alive.current = false;
    };
  }, []);
  const tables = state.tables || {};
  const missing = names.filter(n => tables[n] && tables[n].exists === false);
  const unreadable = names.filter(n => tables[n] && tables[n].exists !== false
    && tables[n].rows === null);
  const present = names.reduce((sum, n) => sum + ((tables[n] && tables[n].rows) || 0), 0);
  const typedOk = existing !== 'clear' || same(typed, target.confirm);
  const ready = !!state.tables && missing.length === 0 && unreadable.length === 0 && typedOk;
  useEffect(() => {
    onState({
      ready,
      existing,
      onError,
    });
  }, [ready, existing, onError]);
  const rowsOf = (table) => {
    const planned = plannedRows(plan, table);
    if (planned.kind === 'fixed') {
      return count(planned.min);
    }
    return planned.kind === 'range' ? `${count(planned.min)}–${count(planned.max)}`
      : tr('confirm.rowsUnknown');
  };
  const stateOf = (name) => {
    const t = tables[name];
    if (!t) {
      return <span className={`${base}-dim`}>…</span>;
    }
    if (t.exists === false) {
      return <span className={`${base}-bad`}>{tr('confirm.tableMissing')}</span>;
    }
    if (t.rows === null) {
      return <span className={`${base}-bad`} title={t.error ? t.error.message : ''}>
        {tr('confirm.tableUnreadable', { reason: t.error ? errorText(t.error) : '' })}
      </span>;
    }
    return tr('rows.count', { rows: count(t.rows) });
  };
  return <div className={`${base}-confirm`}>
    <div className={`${base}-confirm-target`}>
      <Icon type='fa-database'/>
      <div>
        <div className={`${base}-confirm-name`}>{target.name}</div>
        <div className={`${base}-confirm-where`}>
          {target.host && <span><i>{tr('confirm.host')}</i>{target.host}</span>}
          {target.database && <span><i>{tr('confirm.database')}</i>{target.database}</span>}
          {!target.host && target.address && <span>{target.address}</span>}
          <span><i>{tr('confirm.type')}</i>{dialectName(target.dialect)}</span>
        </div>
      </div>
    </div>
    <div className={`${base}-confirm-lead`}>{tr('confirm.lead')}</div>
    {state.loading && <div className={`${base}-confirm-wait`}>
      <Icon type='fa-spinner fa-spin'/>{tr('confirm.inspecting')}
    </div>}
    {state.error && <div className={`${base}-confirm-fail`}>
      <div className={`${base}-bad`}>
        <Icon type='fa-exclamation-circle'/>{tr('confirm.inspectFailed')}
      </div>
      <div>{errorText(state.error)}</div>
      <a onClick={inspect}>{tr('confirm.retry')}</a>
    </div>}
    {state.tables && <React.Fragment>
      <div className={`${base}-confirm-tables`}>
        <table className={`${base}-grid`}>
          <thead>
            <tr>
              <th>{tr('grid.table')}</th>
              <th>{tr('confirm.now')}</th>
              <th>{tr('confirm.toWrite')}</th>
            </tr>
          </thead>
          <tbody>
            {plan.tables.map(t => (
              <tr key={t.entityId}>
                <td title={t.defKey}>{t.defKey}</td>
                <td>{stateOf(t.defKey)}</td>
                <td>{rowsOf(t)}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && <div className={`${base}-bad ${base}-confirm-block`}>
        <Icon type='fa-exclamation-circle'/>
        {tr('confirm.missing', { tables: missing.join(', ') })}
      </div>}
      {unreadable.length > 0 && <div className={`${base}-bad ${base}-confirm-block`}>
        <Icon type='fa-exclamation-circle'/>
        {tr('confirm.unreadable', { tables: unreadable.join(', ') })}
      </div>}
      {missing.length === 0 && unreadable.length === 0 && <React.Fragment>
        <div className={`${base}-confirm-choice`}>
          <div className={`${base}-confirm-label`}>{tr('confirm.existing')}</div>
          <RadioGroup value={existing} onChange={e => setExisting(e.target.value)}>
            <Radio value='append'>{tr('confirm.append')}</Radio>
            <Radio value='clear'>{tr('confirm.clear')}</Radio>
          </RadioGroup>
          <div className={`${base}-confirm-effect`}>
            {existing === 'append' ? tr('confirm.appendEffect')
            : tr('confirm.clearEffect', {
              tables: names.length,
              rows: count(present),
            })}
          </div>
          {existing === 'append' && present > 0 && <div className={`${base}-warn`}>
            <Icon type='fa-exclamation-triangle'/>{tr('confirm.appendWarn')}
          </div>}
          {existing === 'clear' && <div className={`${base}-confirm-typed`}>
            <div className={`${base}-bad`}>
              <Icon type='fa-exclamation-triangle'/>
              {tr(target.byDatabase ? 'confirm.typeDatabase' : 'confirm.typeConnection',
              { name: target.confirm })}
            </div>
            <Input
              value={typed}
              placeholder={target.confirm}
              onChange={e => setTyped(e.target.value)}
          />
          </div>}
        </div>
        <div className={`${base}-confirm-choice`}>
          <div className={`${base}-confirm-label`}>{tr('confirm.onError')}</div>
          <RadioGroup value={onError} onChange={e => setOnError(e.target.value)}>
            <Radio value='rollback'>{tr('confirm.rollback')}</Radio>
            <Radio value='skip'>{tr('confirm.skip')}</Radio>
          </RadioGroup>
          <div className={`${base}-confirm-effect`}>
            {tr(onError === 'rollback' ? 'confirm.rollbackEffect' : 'confirm.skipEffect')}
          </div>
        </div>
      </React.Fragment>}
    </React.Fragment>}
  </div>;
};

// the button follows what the content says without the content being drawn again
const WriteButton = ({ bind, onClick }) => {
  const [ready, setReady] = useState(false);
  useEffect(() => bind(setReady), []);
  return <Button type='primary' disable={!ready} onClick={onClick}>
    {tr('confirm.write')}
  </Button>;
};

// onOk({existing, onError}) when the user confirms; nothing is called when they back out
export const openDbConfirm = (props, onOk) => {
  let modal;
  let current = { ready: false };
  let setReady = () => {};
  const onState = (s) => {
    current = s;
    setReady(s.ready);
  };
  const ok = () => {
    if (current.ready) {
      modal.close();
      onOk({
        existing: current.existing,
        onError: current.onError,
      });
    }
  };
  modal = openModal(<Confirm {...props} onState={onState}/>, {
    title: tr('confirm.title'),
    bodyStyle: { width: 640 },
    buttons: [
      <WriteButton
        key='ok'
        bind={(fn) => {
          setReady = fn;
          fn(current.ready);
          return () => {
            setReady = () => {};
          };
        }}
        onClick={ok}
      />,
      <Button key='cancel' onClick={() => modal.close()}>
        <FormatMessage id='button.cancel'/>
      </Button>],
  });
  return modal;
};
