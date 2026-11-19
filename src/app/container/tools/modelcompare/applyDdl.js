import React from 'react';
import {Button, FormatMessage, Message, Modal, openModal} from 'components';
import {splitStatements, isDestructive, isTransactional, dialectOfConn} from '../../../../lib/ddl_statements';
import {executeDdl} from '../../../../lib/testdata/db';
import {connTarget} from '../testdata/generate/connInfo';

const t = (id, data) => FormatMessage.string({id: `modelCompare.${id}`, data});

// failures that end before the first statement is sent
const NOT_STARTED = ['DRIVER_MISSING', 'CONNECT_FAILED', 'LOGIN_FAILED', 'JAVA_NOT_FOUND', 'BAD_PARAMS'];

const outcome = (error) => {
  if (typeof error.executed === 'number') {
    if (error.rolledBack) return t('applyRolledBack');
    return error.executed > 0 ? t('applyKept', {count: error.executed}) : t('applyNoneRan');
  }
  return NOT_STARTED.includes(error.code) ? t('applyNoneRan') : t('applyUnknown');
};

const showFailure = (cls, error, statements, onClose) => {
  const failed = typeof error.index === 'number' ? statements[error.index] : null;
  let modal;
  const close = () => {
    modal && modal.close();
    onClose();
  };
  modal = openModal(<div className={`${cls}-apply`}>
    {failed !== null && <div>{t('applyFailAt', {index: error.index + 1, total: statements.length})}</div>}
    {failed !== null && <pre className={`${cls}-apply-sql`}>{failed}</pre>}
    <div className={`${cls}-apply-label`}>{t('applyDbMessage')}</div>
    <pre className={`${cls}-apply-sql`}>{error.message || error.code}</pre>
    <div className={`${cls}-apply-outcome`}>{outcome(error)}</div>
  </div>, {
    small: true,
    status: 'error',
    title: t('applyFailTitle'),
    onClose,
    buttons: [<Button key='close' onClick={close}><FormatMessage id='button.close'/></Button>],
  });
};

const confirmMessage = (cls, target, statements, dialect) => {
  const destructive = statements.filter(isDestructive);
  const where = [target.host, target.database].filter(Boolean).join(' / ') || target.address;
  return <div className={`${cls}-apply`}>
    <div>{t('applyConn')}<b>{target.name}</b>{where ? `（${where}）` : ''}</div>
    <div>{t('applyCount', {count: statements.length})}</div>
    <div>{isTransactional(dialect) ? t('applyTransactional') : t('applyNotTransactional')}</div>
    {destructive.length > 0 && <div className={`${cls}-apply-danger`}>
      <div>{t('applyDestructive', {count: destructive.length})}</div>
      {destructive.map((s, i) => <pre key={i} className={`${cls}-apply-sql`}>{s}</pre>)}
    </div>}
    <div>{t('applyTestFirst')}</div>
  </div>;
};

// Runs the script text on the connection after the user confirms. onApplied: the statements
// all ran; onFailed: the error dialog was closed (the database may have changed either way).
export const applyScript = ({cls, dataSource, config, conn, text, openLoading, closeLoading,
                              onApplied, onFailed}) => {
  const dialect = dialectOfConn(dataSource, conn);
  const statements = splitStatements(text, dialect);
  if (statements.length === 0) {
    Message.warring({title: t('applyNothing')});
    return;
  }
  Modal.confirm({
    title: t('applyToDb'),
    message: confirmMessage(cls, connTarget(dataSource, conn), statements, dialect),
    onOk: () => {
      const progress = done => openLoading(`${t('applying')} ${done}/${statements.length}`);
      progress(0);
      executeDdl(dataSource, config, conn, statements, p => progress(p.done)).promise
        .then((body) => {
          closeLoading();
          Message.success({title: t('applied', {count: body.executed})});
          onApplied();
        }, (error) => {
          closeLoading();
          showFailure(cls, error, statements, onFailed);
        });
    },
  });
};
