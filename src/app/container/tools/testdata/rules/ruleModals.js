// Windows opened from a rule picker: the editor of one rule and the rule library.
import React, {
  forwardRef, useImperativeHandle, useState,
} from 'react';
import {
  Button, openModal, Message, FormatMessage,
} from 'components';
import { tr } from './i18n';
import { projectRules, libraryProblems, saveProjectRule } from './libraryOps';
import { newRule } from '../../../../../lib/testdata/model';
import RuleEditor from './RuleEditor';
import { saveWithReminder } from './querySave';

const Draft = forwardRef(({
  rule, dataSource, entity, field, rules,
}, ref) => {
  const [draft, setDraft] = useState(rule);
  const [showAll, setShowAll] = useState(false);
  useImperativeHandle(ref, () => ({
    // the draft when it can be stored, otherwise nothing and the problems show
    result: () => {
      if (libraryProblems(draft, rules).length > 0) {
        setShowAll(true);
        return null;
      }
      return { ...draft, name: `${draft.name}`.trim() };
    },
  }), [draft, rules]);
  return <RuleEditor
    rule={draft}
    onChange={setDraft}
    dataSource={dataSource}
    rules={rules}
    entity={entity}
    field={field}
    showAll={showAll}
  />;
});

// Edits a rule of the project in a window of its own. `rule` missing = a new rule.
// onOk(rule, dataSource) is called after the rule was stored in the project.
export const openRuleEditor = ({
  rule, kind, getDataSource, updateDataSource, entity, field, onOk,
}) => {
  const dataSource = getDataSource();
  const ref = React.createRef();
  let modal;
  const ok = () => {
    const result = ref.current && ref.current.result();
    if (!result) {
      Message.error({ title: tr('msg.invalid') });
      return;
    }
    // a query the database has not accepted in this session is asked about first
    saveWithReminder({ rule: result, original: rule, dataSource: getDataSource() }, () => {
      const next = saveProjectRule(getDataSource(), result);
      updateDataSource(next);
      modal && modal.close();
      onOk && onOk(result, next);
    });
  };
  modal = openModal(<Draft
    ref={ref}
    rule={rule || newRule(kind || 'builtin')}
    rules={projectRules(dataSource).filter(r => !rule || r.id !== rule.id)}
    dataSource={dataSource}
    entity={entity}
    field={field}
  />, {
    title: tr(rule ? 'editor.editTitle' : 'editor.newTitle'),
    bodyStyle: { width: '70%', minWidth: 760 },
    buttons: [
      <Button type='primary' key='ok' onClick={ok}><FormatMessage id='button.ok'/></Button>,
      <Button key='cancel' onClick={() => modal && modal.close()}>
        <FormatMessage id='button.cancel'/>
      </Button>],
  });
  return modal;
};

// The rule library in a window of its own; `Library` is passed in so that this file and
// the library do not import each other.
export const openRuleLibrary = (Library, {
  getDataSource, updateDataSource, initialTab, initialRuleId, onClose,
}) => {
  let modal;
  let guard = null;
  const close = () => {
    modal && modal.close();
    onClose && onClose();
  };
  const tryClose = () => (guard ? guard(close) : close());
  modal = openModal(<Library
    onCloseGuard={(fn) => { guard = fn; }}
    dataSource={getDataSource()}
    getDataSource={getDataSource}
    updateDataSource={updateDataSource}
    initialTab={initialTab}
    initialRuleId={initialRuleId}
  />, {
    bodyStyle: { width: '90%' },
    title: tr('title'),
    beforeClose: tryClose,
    buttons: [
      <Button key='close' onClick={tryClose}><FormatMessage id='button.close'/></Button>],
  });
  return modal;
};
