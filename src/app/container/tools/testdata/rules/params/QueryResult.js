// What the database answered to the check of a query: accepted, with the column the values
// come from and the first values, or refused, with the reason in plain words, the object
// and the place the database names, and its own message.
import React from 'react';
import { Icon } from 'components';
import { say } from '../i18n';
import { checkErrorParts, warningText, sampleText } from '../queryText';

const q = (id, data) => say(`testDataQuery.${id}`, data);

const Accepted = ({ base, result }) => {
  const column = result.firstColumn;
  return <React.Fragment>
    {column && <div className={`${base}-query-line`}>
      <i>{q('check.firstColumn')}</i>
      <b>{column.name}</b>
      {column.typeName && <span className={`${base}-query-type`}>{column.typeName}</span>}
    </div>}
    <div className={`${base}-query-line`}>
      <i>{result.sample.length > 0 ? q('check.sample', { count: result.sample.length })
        : q('check.noValues')}</i>
      <span className={`${base}-query-values`}>
        {result.sample.map((value, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <code key={i} className={value === null ? `${base}-query-null` : ''}>
            {sampleText(value)}
          </code>))}
        {result.truncated && <span className={`${base}-query-more`}>… {q('check.more')}</span>}
      </span>
    </div>
    {result.warnings.map(w => (
      <div key={w.code} className={`${base}-query-warning`}>
        <Icon type='fa-exclamation-triangle'/>{warningText(say, w)}
      </div>))}
  </React.Fragment>;
};

const Refused = ({ base, error, onLocate }) => {
  const parts = checkErrorParts(say, error);
  return <React.Fragment>
    <div className={`${base}-query-reason`}>{parts.text}</div>
    {parts.object && <div className={`${base}-query-line`}>
      <i>{q('check.object')}</i><b>{parts.object}</b>
    </div>}
    {(parts.place || parts.near) && <div className={`${base}-query-line`}>
      <i>{q('check.position')}</i>
      <span>{parts.place || q('check.near', { near: parts.near })}</span>
      {parts.position && <a onClick={() => onLocate(parts.position)}>{q('check.goto')}</a>}
    </div>}
    {parts.raw && <div className={`${base}-query-line ${base}-query-raw`}>
      <i>{q('check.raw')}</i>
      <pre>{parts.raw}</pre>
    </div>}
  </React.Fragment>;
};

export default ({
  base, entry, status, onLocate,
}) => {
  const ok = entry.status === 'ok';
  const title = ok ? q('check.ok') : checkErrorParts(say, entry.error).title;
  return <div className={`${base}-query-result ${base}-query-result-${ok ? 'ok' : 'bad'}`}>
    <div className={`${base}-query-head`}>
      <Icon type={ok ? 'fa-check-circle' : 'fa-times-circle'}/>
      <b>{title}</b>
      <span>{status}</span>
    </div>
    {ok ? <Accepted base={base} result={entry.result}/>
      : <Refused base={base} error={entry.error} onLocate={onLocate}/>}
  </div>;
};
