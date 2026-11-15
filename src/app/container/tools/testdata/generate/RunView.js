// A run on screen: progress per table while it works, and what came of it at the end.
import React, { useState } from 'react';
import { Icon } from 'components';
import { tr } from './i18n';
import {
  count, fileSize, duration, percent,
} from './format';
import { showInFolder } from './io';

const ERRORS_SHOWN = 5;

const Bar = ({ base, value, state }) => (
  <span className={`${base}-bar ${base}-bar-${state}`}>
    <i style={{ width: `${value}%` }}/>
  </span>
);

const stateIcon = {
  waiting: 'fa-clock-o',
  running: 'fa-spinner fa-spin',
  done: 'fa-check',
  stopped: 'fa-ban',
  failed: 'fa-times',
};

// run.tables: [{entityId, defKey, state, done, total, db: {state, done, total, written, failed}}]
const Progress = ({ base, run, finished }) => (
  <div className={`${base}-run-tables`}>
    <table className={`${base}-grid`}>
      <thead>
        <tr>
          <th>{tr('grid.table')}</th>
          <th className={`${base}-run-col`}>{tr('run.generated')}</th>
          {run.withDb && <th className={`${base}-run-col`}>{tr('run.written')}</th>}
        </tr>
      </thead>
      <tbody>
        {run.tables.map(t => (
          <tr key={t.entityId}>
            <td title={t.defKey}>{t.defKey}</td>
            <td className={`${base}-run-col`}>
              <Icon type={stateIcon[t.state] || stateIcon.waiting}/>
              <Bar base={base} value={t.state === 'done' ? 100 : percent(t.done, t.total)} state={t.state}/>
              <span className={`${base}-run-count`}>
                {t.state === 'waiting' && (finished ? '—' : tr('run.waiting'))}
                {t.state === 'done' && tr('rows.count', { rows: count(t.done) })}
                {t.state !== 'waiting' && t.state !== 'done'
                  && `${count(t.done)}${t.total ? ` / ${count(t.total)}` : ''}`}
              </span>
            </td>
            {run.withDb && <td className={`${base}-run-col`}>
              <Icon type={stateIcon[t.db.state] || stateIcon.waiting}/>
              <Bar
                base={base}
                value={t.db.state === 'done' ? 100 : percent(t.db.done, t.db.total)}
                state={t.db.state}
              />
              <span className={`${base}-run-count`}>
                {t.db.state === 'waiting' && (finished ? '—' : tr('run.waiting'))}
                {t.db.state !== 'waiting' && !t.db.undone
                  && tr('rows.count', { rows: count(t.db.written) })}
                {t.db.undone && tr('run.undone')}
                {t.db.failed > 0 && <b className={`${base}-bad`}>
                  {tr('run.failedRows', { count: count(t.db.failed) })}
                </b>}
              </span>
            </td>}
          </tr>))}
      </tbody>
    </table>
  </div>
);

const Files = ({ base, outputs }) => {
  const list = [];
  if (outputs.sql) {
    list.push(['sql', tr('output.sql'), outputs.sql.file, outputs.sql.bytes]);
  }
  if (outputs.csv) {
    list.push(['csv', tr('summary.csvFiles', { count: outputs.csv.files.length }),
      outputs.csv.dir, outputs.csv.bytes, outputs.csv.files[0] && outputs.csv.files[0].file]);
  }
  if (outputs.xlsx) {
    list.push(['xlsx', tr('output.xlsx'), outputs.xlsx.file, outputs.xlsx.bytes]);
  }
  if (list.length === 0) {
    return null;
  }
  return <div className={`${base}-summary-block`}>
    <div className={`${base}-summary-title`}>{tr('summary.files')}</div>
    {list.map(([key, label, target, bytes, reveal]) => (
      <div key={key} className={`${base}-summary-file`}>
        <span className={`${base}-summary-kind`}>{label}</span>
        <span className={`${base}-summary-path`} title={target}>{target}</span>
        <span className={`${base}-dim`}>{fileSize(bytes)}</span>
        <a onClick={() => showInFolder(reveal || target)}>
          <Icon type='fa-folder-open-o'/>{tr('summary.show')}
        </a>
      </div>))}
  </div>;
};

const DbErrors = ({ base, table, dbErrorParts }) => {
  const [all, setAll] = useState(false);
  const errors = table.errors || [];
  const shown = all ? errors : errors.slice(0, ERRORS_SHOWN);
  return <div className={`${base}-summary-errors`}>
    {shown.map((e, i) => {
      const parts = dbErrorParts(e);
      // eslint-disable-next-line react/no-array-index-key
      return <div key={i} className={`${base}-summary-error`}>
        <span className={`${base}-bad`}>
          {typeof e.row === 'number' ? tr('summary.rowNo', { row: count(e.row) }) : ''}
          {parts.text}
        </span>
        {parts.raw && <span className={`${base}-raw`} title={parts.raw}>{parts.raw}</span>}
      </div>;
    })}
    {errors.length > ERRORS_SHOWN && <a onClick={() => setAll(!all)}>
      {all ? tr('problems.less') : tr('summary.moreErrors', {
        count: errors.length - ERRORS_SHOWN,
      })}
    </a>}
    {table.failed > errors.length && all && <div className={`${base}-dim`}>
      {tr('summary.errorsCut', { count: count(errors.length) })}
    </div>}
  </div>;
};

const Database = ({
  base, result, target, dbErrorParts,
}) => {
  const tables = (result.database && result.database.tables) || [];
  if (tables.length === 0) {
    return null;
  }
  return <div className={`${base}-summary-block`}>
    <div className={`${base}-summary-title`}>
      {tr('summary.database', { name: target ? target.name : '' })}
    </div>
    <table className={`${base}-grid`}>
      <thead>
        <tr>
          <th>{tr('grid.table')}</th>
          <th>{tr('summary.deleted')}</th>
          <th>{tr('summary.written')}</th>
          <th>{tr('summary.failedCount')}</th>
        </tr>
      </thead>
      <tbody>
        {tables.map(t => (
          <React.Fragment key={t.name}>
            <tr>
              <td title={t.name}>{t.name}</td>
              <td>{typeof t.deleted === 'number' ? count(t.deleted) : '—'}</td>
              <td>{count(t.written)}</td>
              <td className={t.failed > 0 ? `${base}-bad` : ''}>{count(t.failed)}</td>
            </tr>
            {((t.errors || []).length > 0 || (t.warnings || []).length > 0) && <tr>
              <td colSpan={4} className={`${base}-summary-detail`}>
                {(t.warnings || []).map((w, i) => {
                  const parts = dbErrorParts(w);
                  // eslint-disable-next-line react/no-array-index-key
                  return <div key={i} className={`${base}-summary-error`}>
                    <span className={`${base}-warn`}>
                      <Icon type='fa-exclamation-triangle'/>{parts.text}
                    </span>
                    {parts.raw && <span className={`${base}-raw`} title={parts.raw}>{parts.raw}</span>}
                  </div>;
                })}
                <DbErrors base={base} table={t} dbErrorParts={dbErrorParts}/>
              </td>
            </tr>}
          </React.Fragment>))}
      </tbody>
    </table>
  </div>;
};

// what happened, in one headline and one explanation
const verdict = (run, result, target, errorText, dbErrorParts) => {
  const name = target ? target.name : '';
  if (run.status === 'loading') {
    return ['working', tr('run.loading'), ''];
  }
  if (run.status === 'running') {
    return ['working', tr(`run.stage.${run.stage || 'generate'}`), ''];
  }
  if (run.status === 'cancelling') {
    return ['working', tr('run.cancelling'), ''];
  }
  const files = Object.keys(result.outputs || {}).length > 0 ? tr('summary.filesKept') : '';
  const skip = run.options.onError === 'skip';
  if (result.status === 'done') {
    const tables = (result.database && result.database.tables) || [];
    const failed = tables.reduce((sum, t) => sum + (t.failed || 0), 0);
    const written = tables.reduce((sum, t) => sum + (t.written || 0), 0);
    if (failed === 0) {
      return ['ok', tr('summary.done'), ''];
    }
    return written === 0
      ? ['bad', tr('summary.allFailed', { count: count(failed) }), tr('summary.allFailedExplained')]
      : ['warn', tr('summary.doneWithFailures', { count: count(failed) }),
        tr('summary.skipExplained')];
  }
  if (result.stage === 'load') {
    return ['bad', tr(result.problems ? 'summary.recheckFailed' : 'summary.loadFailed'),
      tr('summary.nothingWritten')];
  }
  if (result.status === 'cancelled') {
    if (result.stage === 'database') {
      return ['warn', tr('summary.cancelledDb'), [tr(skip ? 'summary.cancelledDbSkip'
        : 'summary.cancelledDbRollback', { name }), files].filter(Boolean).join(' ')];
    }
    return ['warn', tr('summary.cancelled'), tr('summary.noFilesLeft')];
  }
  if (result.stage === 'database') {
    const error = result.error || {};
    const parts = dbErrorParts(error);
    let where = '';
    if (error.table) {
      where = typeof error.row === 'number' ? tr('summary.failedAt', {
        table: error.table,
        row: count(error.row),
      }) : tr('summary.failedAtTable', { table: error.table });
    }
    return ['bad', tr('summary.dbFailed'), [where, parts.text,
      tr(skip ? 'summary.dbFailedSkip' : 'summary.dbFailedRollback', { name }), files]
      .filter(Boolean).join(' '), parts.raw];
  }
  return ['bad', tr('summary.failed'),
    `${errorText(result.error)} ${tr('summary.noFilesLeft')}`];
};

export default React.memo(({
  base, run, target, errorText, dbErrorParts, loadErrorText,
}) => {
  const result = run.result || {};
  const [tone, headline, explanation, raw] = verdict(run, result, target, errorText, dbErrorParts);
  const finished = run.status === 'finished';
  const icons = {
    working: 'fa-spinner fa-spin',
    ok: 'fa-check-circle',
    warn: 'fa-exclamation-triangle',
    bad: 'fa-times-circle',
  };
  return <div className={`${base}-run`}>
    <div className={`${base}-run-head ${base}-run-head-${tone}`}>
      <Icon type={icons[tone]}/>
      <div>
        <div className={`${base}-run-headline`}>{headline}</div>
        {explanation && <div className={`${base}-run-explain`}>{explanation}</div>}
        {raw && <div className={`${base}-raw`} title={raw}>{raw}</div>}
        {(result.loadErrors || []).map(e => (
          <div key={e.request.id} className={`${base}-run-explain`}>{loadErrorText(e)}</div>))}
        {(result.problems || []).map(text => (
          <div key={text} className={`${base}-run-explain`}>{text}</div>))}
      </div>
      {finished && <span className={`${base}-run-time`}>
        {tr('summary.elapsed', { time: duration(tr, result.elapsed) })}
      </span>}
    </div>
    {finished && result.outputs && <Files base={base} outputs={result.outputs}/>}
    {finished && <Database
      base={base}
      result={result}
      target={target}
      dbErrorParts={dbErrorParts}
    />}
    {run.tables.length > 0 && result.stage !== 'load' && <div className={`${base}-summary-block`}>
      {finished && <div className={`${base}-summary-title`}>{tr('summary.rows')}</div>}
      <Progress
        base={base}
        // once the database answered, what it took is listed above
        run={finished && result.database ? { ...run, withDb: false } : run}
        finished={finished}
      />
    </div>}
  </div>;
});
