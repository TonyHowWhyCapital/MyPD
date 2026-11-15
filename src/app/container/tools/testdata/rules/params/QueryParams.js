// The form of a `query` rule: the SQL, what the project model says about it while it is
// typed, and the check by the database itself.
import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { Button, Select, Icon } from 'components';
import { checkAgainstModel, applySuggestion } from '../../../../../../lib/testdata/query_check';
import { CANCELLED } from '../../../../../../lib/testdata/db';
import { connections } from '../../generate/connInfo';
import { projectOnScreen } from '../machine';
import { say } from '../i18n';
import {
  queryState, runCheck, chooseConn, retryJava, onSessionChange,
} from '../querySession';
import {
  findingText, skipText, statusText, connWhere,
} from '../queryText';
import QueryResult from './QueryResult';
import { Row } from './common';

const { Option } = Select;
const DELAY = 350;
const q = (id, data) => say(`testDataQuery.${id}`, data);

// what the project model says, a moment after the typing stops
const useModelCheck = (sql, dataSource) => {
  const screen = useMemo(() => projectOnScreen(dataSource), [dataSource]);
  const [result, setResult] = useState(() => checkAgainstModel(sql, screen));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    const timer = setTimeout(() => setResult(checkAgainstModel(sql, screen)), DELAY);
    return () => clearTimeout(timer);
  }, [sql, screen]);
  return result;
};

const ModelFindings = ({
  base, model, scope, onLocate, onReplace,
}) => {
  if (model.status === 'empty') {
    return null;
  }
  const clean = model.status === 'analysed' && model.findings.length === 0;
  return <div className={`${base}-query-model`}>
    <div className={`${base}-query-title`}>
      <b>{q('model.title')}</b>
      <span>{q(scope === 'machine' ? 'model.machineNote' : 'model.titleNote')}</span>
    </div>
    {model.status === 'notAnalysed' && <div className={`${base}-query-neutral`}>
      <Icon type='fa-info-circle'/>{skipText(say, model.reason)}
    </div>}
    {clean && <div className={`${base}-query-neutral`}>
      <Icon type='fa-check'/>{q(model.tables.length > 0 ? 'model.clean' : 'model.nothing')}
    </div>}
    {model.findings.map(item => (
      <div
        key={`${item.code}:${item.start}`}
        className={`${base}-query-finding ${base}-query-finding-${item.severity}`}
      >
        <span className={`${base}-query-severity`}>
          <Icon type={item.severity === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle'}/>
          {q(`model.severity.${item.severity}`)}
        </span>
        <span className={`${base}-query-finding-text`}>
          <a title={q('model.locate')} onClick={() => onLocate(item.start, item.end)}>
            {findingText(say, item)}
          </a>
          {(item.suggestions || []).length > 0 && <span className={`${base}-query-suggest`}>
            {q('model.suggest')}
            {item.suggestions.map(name => (
              <span
                key={name}
                className={`${base}-chip`}
                onClick={() => onReplace(item, name)}
              >{name}</span>))}
          </span>}
        </span>
      </div>))}
  </div>;
};

export default ({
  base, tr, params, set, dataSource, scope,
}) => {
  const sql = params.sql || '';
  const area = useRef(null);
  const [, redraw] = useState(0);
  const [running, setRunning] = useState(null);
  // the SQL of the last check started here: tells "never checked" from "changed since"
  const [checkedSql, setCheckedSql] = useState(null);
  const live = useRef({});
  live.current = { running };
  useEffect(() => {
    const stop = onSessionChange(() => redraw(n => n + 1));
    return () => {
      stop();
      live.current.gone = true;
      live.current.running && live.current.running.cancel();
    };
  }, []);
  const model = useModelCheck(sql, dataSource);
  const state = queryState(dataSource, sql);
  const conns = connections(dataSource);
  const locate = (start, end) => {
    const box = area.current;
    if (box) {
      box.focus();
      box.setSelectionRange(start, end);
    }
  };
  const locateError = (position) => {
    if (!position) {
      return;
    }
    const lineEnd = sql.indexOf('\n', position.offset);
    locate(position.offset, position.lineOnly ? (lineEnd < 0 && sql.length) || lineEnd
      : position.offset);
  };
  const check = () => {
    const run = runCheck(dataSource, sql);
    setRunning(run);
    setCheckedSql(sql);
    run.then((entry) => {
      if (!live.current.gone) {
        setRunning(null);
        // the caret goes where the database stopped
        entry.status === 'failed' && locateError(entry.error.position);
      }
    }, (error) => {
      if (!live.current.gone) {
        setRunning(null);
        error && error.code === CANCELLED && setCheckedSql(null);
      }
    });
  };
  const blocked = {
    noConnection: q('check.noConnection'),
    incomplete: q('check.incomplete', { name: state.target ? state.target.name : '' }),
    noJava: q('check.noJava'),
  }[state.state] || '';
  const empty = sql.trim() === '';
  const changed = state.state === 'unchecked' && checkedSql !== null && checkedSql !== sql;
  return <Row base={base} label={tr('param.sql')} hint={tr('hint.query')} wide>
    <textarea
      ref={area}
      className={`${base}-code`}
      rows={5}
      spellCheck={false}
      placeholder='SELECT CODE FROM T_CUSTOMER'
      value={sql}
      onChange={e => set('sql', e.target.value)}
    />
    <ModelFindings
      base={base}
      model={model}
      scope={scope}
      onLocate={locate}
      onReplace={(item, name) => set('sql', applySuggestion(sql, item, name))}
    />
    <div className={`${base}-query-bar`}>
      {running ? <Button onClick={() => running.cancel()}>{q('check.cancel')}</Button>
        : <span title={empty ? q('check.emptySql') : q('check.hint')}>
          <Button type='primary' disable={!!blocked || empty} onClick={check}>
            {q('check.button')}
          </Button>
        </span>}
      {state.target && <span className={`${base}-query-conn`}>
        <i>{q('check.using')}</i>
        {conns.length > 1 ? <Select
          notAllowEmpty
          allowClear={false}
          disable={!!running}
          value={state.conn.defKey}
          onChange={e => !running && chooseConn(e.target.value)}
        >
          {conns.map(c => <Option key={c.defKey} value={c.defKey}>{c.defName || c.defKey}</Option>)}
        </Select> : <b>{state.target.name}</b>}
        <span title={connWhere(state.target)}>{connWhere(state.target)}</span>
      </span>}
    </div>
    {blocked && <div className={`${base}-query-blocked`}>
      <Icon type='fa-exclamation-circle'/>{blocked}
      {state.state === 'noJava' && <a onClick={retryJava}>{q('check.retry')}</a>}
    </div>}
    {running && <div className={`${base}-query-neutral`}>
      <Icon type='fa-spinner fa-spin'/>{q('check.running')}
    </div>}
    {!running && !blocked && !empty && !state.entry && <div className={`${base}-query-status`}>
      {changed ? q('check.status.changed') : statusText(say, state)}
    </div>}
    {!running && !blocked && state.entry && <QueryResult
      base={base}
      entry={state.entry}
      status={statusText(say, state)}
      onLocate={locateError}
    />}
  </Row>;
};
