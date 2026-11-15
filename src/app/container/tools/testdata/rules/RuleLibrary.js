// RuleLibrary: the rule manager. Three sections: the rules of the project, the rule
// library of this machine and the rule of each domain of the project.
//
// Props (the ones `openExtTool` in src/app/main/index.js gives every tool window)
//   dataSource        the project when the window opens
//   updateDataSource  (dataSource) => void, the normal update path of the app: every
//                     change to the rules of the project goes through it at once
//   onCloseGuard      (fn) => void; registers the question asked before the window closes
//                     while a rule has unsaved changes
//   initialTab        optional 'project' | 'machine' | 'domain'
//   initialRuleId     optional id of the project rule to show first
import React, { useMemo, useRef, useState } from 'react';
import _ from 'lodash';
import {
  Button, Message, Modal,
} from 'components';
import { getPrefix } from '../../../../../lib/prefixUtil';
import { useLeaveGuard } from '../../../../../lib/leave_guard';
import {
  newRule, ruleUsage, getTestData, setTestData, upsertRule,
} from '../../../../../lib/testdata/model';
import { tr } from './i18n';
import { usageLabel } from './ruleText';
import {
  projectRules, deleteProjectRules, addRules, bindDomain, libraryProblems, usageNames,
  findTwin,
} from './libraryOps';
import { getMachineRules, setMachineRules, projectOnScreen } from './machine';
import { exportToFile, importFromFile } from './ruleFiles';
import RuleList from './RuleList';
import RuleEditor from './RuleEditor';
import DomainRules from './DomainRules';
import '../style/index.less';

const TABS = ['project', 'machine', 'domain'];
const clone = rule => JSON.parse(JSON.stringify(rule));

export default React.memo(({
  prefix, dataSource, updateDataSource, onCloseGuard, initialTab, initialRuleId,
}) => {
  const base = `${getPrefix(prefix)}-testdata`;
  const [ds, setDs] = useState(dataSource);
  const [machine, setMachine] = useState(() => getMachineRules(true));
  const [tab, setTab] = useState(TABS.includes(initialTab) ? initialTab : 'project');
  const first = () => {
    const rules = projectRules(dataSource);
    const rule = rules.find(r => r.id === initialRuleId) || rules[0];
    return rule && tab === 'project' ? clone(rule) : null;
  };
  const [draft, setDraft] = useState(first);
  const [showAll, setShowAll] = useState(false);
  const [checked, setChecked] = useState([]);
  const [keyword, setKeyword] = useState('');
  // what the draft was when editing began: a new rule nobody touched is not a change
  const baseline = useRef(draft);
  const isProject = tab === 'project';
  const rules = isProject ? projectRules(ds) : machine;
  const stored = draft ? rules.find(r => r.id === draft.id) : null;
  const dirty = !!draft && !_.isEqual(draft, stored || baseline.current);
  const leave = useLeaveGuard(dirty, (draft && draft.name) || tr('list.newName'), onCloseGuard);
  const screen = useMemo(() => projectOnScreen(ds), [ds]);
  const usage = useMemo(() => (isProject ? projectRules(ds).reduce((all, r) => ({
    ...all,
    [r.id]: ruleUsage(screen, r.id),
  }), {}) : null), [screen, isProject]);

  const persistProject = (next) => {
    setDs(next);
    updateDataSource && updateDataSource(next);
  };
  const persistMachine = (list) => {
    setMachineRules(list);
    setMachine(getMachineRules());
  };
  const saveRules = (list) => {
    if (isProject) {
      persistProject(setTestData(ds, { ...getTestData(ds), rules: list }));
    } else {
      persistMachine(list);
    }
  };
  const edit = (rule) => {
    baseline.current = rule;
    setDraft(rule);
    setShowAll(false);
  };
  const select = rule => leave(() => edit(clone(rule)));
  const changeTab = next => next !== tab && leave(() => {
    setTab(next);
    setChecked([]);
    setKeyword('');
    const list = next === 'machine' ? machine : projectRules(ds);
    edit(next !== 'domain' && list[0] ? clone(list[0]) : null);
  });
  const add = () => leave(() => edit(newRule('builtin')));
  const save = () => {
    const others = rules.filter(r => r.id !== draft.id);
    if (libraryProblems(draft, others).length > 0) {
      setShowAll(true);
      Message.error({ title: tr('msg.invalid') });
      return;
    }
    const rule = { ...draft, name: `${draft.name}`.trim() };
    saveRules(upsertRule({ rules }, rule).rules);
    edit(rule);
    Message.success({ title: tr('msg.saved') });
  };
  const revert = () => edit(stored ? clone(stored) : null);
  // the rules an action applies to: the ticked ones, or the one being looked at
  const targets = () => {
    if (checked.length > 0) {
      return rules.filter(r => checked.includes(r.id));
    }
    return stored ? [stored] : [];
  };
  const hasTargets = checked.length > 0 || !!stored;
  const duplicate = () => leave(() => {
    const { rules: all, added } = addRules(rules, targets());
    saveRules(all);
    setChecked([]);
    added[0] && edit(clone(added[0]));
  });
  const remove = () => {
    const list = targets();
    const ids = list.map(r => r.id);
    const inUse = isProject ? list.map(r => ({ rule: r, names: usageNames(screen, r.id) }))
      .filter(u => u.names.fields.length + u.names.domains.length > 0) : [];
    const proceed = () => {
      if (isProject) {
        persistProject(deleteProjectRules(ds, ids));
      } else {
        persistMachine(machine.filter(r => !ids.includes(r.id)));
      }
      setChecked([]);
      if (draft && ids.includes(draft.id)) {
        edit(null);
      }
      Message.success({ title: tr('msg.deleted', { count: ids.length }) });
    };
    Modal.confirm({
      title: tr('msg.deleteTitle'),
      message: <div className={`${base}-confirm`}>
        <div>{list.length === 1 ? tr('msg.deleteMessage', { name: list[0].name })
          : tr('msg.deleteMany', { count: list.length })}</div>
        {inUse.length > 0 && <div className={`${base}-confirm-warn`}>
          {tr('msg.deleteInUse')}
        </div>}
        {inUse.map(u => <div key={u.rule.id} className={`${base}-confirm-item`}>
          {tr('msg.deleteInUseItem', {
            name: u.rule.name,
            where: u.names.fields.concat(u.names.domains
              .map(d => `${tr('tab.domain')} ${d}`)).join(tr('summary.sep')),
          })}
        </div>)}
      </div>,
      onOk: proceed,
    });
  };
  const copyOver = () => {
    const list = targets();
    const other = isProject ? machine : projectRules(ds);
    const fresh = list.filter(r => !findTwin(other, r));
    if (fresh.length === 0) {
      Message.success({ title: tr('msg.alreadyThere') });
      return;
    }
    const all = addRules(other, fresh).rules;
    if (isProject) {
      persistMachine(all);
    } else {
      persistProject(setTestData(ds, { ...getTestData(ds), rules: all }));
    }
    setChecked([]);
    Message.success({ title: tr(isProject ? 'msg.toMachine' : 'msg.toProject', { count: fresh.length }) });
  };
  const doExport = () => exportToFile(checked.length > 0 ? targets() : rules);
  // rules of the file that the library already has, to the letter, are not added again
  const doImport = () => leave(() => importFromFile(base, (imported) => {
    const { rules: all, added } = addRules(rules, imported.filter(r => !findTwin(rules, r)));
    if (added.length > 0) {
      saveRules(all);
      edit(clone(added[0]));
    }
    return added.length;
  }));
  const showUsage = () => {
    const names = usageNames(screen, stored.id);
    Modal.info({
      title: tr('usage.title', { name: stored.name }),
      message: <div className={`${base}-usage`}>
        {names.fields.length > 0 && <div className={`${base}-usage-title`}>
          {tr('usage.fieldsTitle')}
        </div>}
        {names.fields.map(n => <div key={n}>{n}</div>)}
        {names.domains.length > 0 && <div className={`${base}-usage-title`}>
          {tr('usage.domainsTitle')}
        </div>}
        {names.domains.map(n => <div key={n}>{n}</div>)}
        <div className={`${base}-dim`}>{tr('usage.unsavedNote')}</div>
      </div>,
    });
  };
  const used = stored && usage ? usage[stored.id] : null;
  const usageLine = used && <div className={`${base}-used`}>
    <span>{tr('editor.usedBy')}</span>
    <span>{usageLabel(tr, used)}</span>
    {used.fields.length + used.domains.length > 0
      && <a onClick={showUsage}>{tr('action.usage')}</a>}
  </div>;
  return <div className={`${base}-library`}>
    <div className={`${base}-bar`}>
      <span className={`${base}-seg`}>
        {TABS.map(t => (
          <span
            key={t}
            className={`${base}-seg-item${tab === t ? ' active' : ''}`}
            onClick={() => changeTab(t)}
          >
            {tr(`tab.${t}`)}
            {t !== 'domain' && <span className={`${base}-seg-count`}>
              {(t === 'machine' ? machine : projectRules(ds)).length}
            </span>}
          </span>))}
      </span>
      <span className={`${base}-bar-hint`}>{tr(`tabHint.${tab}`)}</span>
    </div>
    {tab === 'domain' ? <DomainRules
      base={base}
      dataSource={ds}
      screen={screen}
      onBind={(domainId, ruleId) => persistProject(bindDomain(ds, domainId, ruleId))}
    /> : <div className={`${base}-body`}>
      <div className={`${base}-side`}>
        <div className={`${base}-tools`}>
          <Button type='primary' onClick={add}>{tr('action.add')}</Button>
          <Button onClick={doImport}>{tr('action.import')}</Button>
          <Button disable={rules.length === 0} onClick={doExport}>{tr('action.export')}</Button>
        </div>
        <div className={`${base}-tools ${base}-tools-links`}>
          <a className={hasTargets ? '' : `${base}-off`} onClick={() => hasTargets && duplicate()}>
            {tr('action.duplicate')}
          </a>
          <a className={hasTargets ? '' : `${base}-off`} onClick={() => hasTargets && copyOver()}>
            {tr(isProject ? 'action.toMachine' : 'action.toProject')}
          </a>
          <a
            className={hasTargets ? `${base}-danger` : `${base}-off`}
            onClick={() => hasTargets && remove()}
          >
            {tr('action.delete')}
          </a>
        </div>
        <RuleList
          base={base}
          rules={rules}
          usage={usage}
          draft={draft}
          dicts={ds.dicts}
          currentId={draft ? draft.id : ''}
          checked={checked}
          onCheck={id => setChecked(checked.includes(id)
            ? checked.filter(c => c !== id) : checked.concat(id))}
          onCheckAll={setChecked}
          onSelect={select}
          keyword={keyword}
          onKeyword={setKeyword}
          emptyText={tr(isProject ? 'list.emptyProject' : 'list.emptyMachine')}
        />
      </div>
      <div className={`${base}-main`}>
        {draft ? <React.Fragment>
          <RuleEditor
            key={draft.id}
            prefix={prefix}
            rule={draft}
            onChange={setDraft}
            dataSource={ds}
            rules={rules.filter(r => r.id !== draft.id)}
            showAll={showAll}
            extra={usageLine}
          />
          <div className={`${base}-actions`}>
            <Button type='primary' disable={!dirty && !!stored} onClick={save}>
              {tr('action.save')}
            </Button>
            <Button disable={!dirty && !!stored} onClick={revert}>
              {tr(stored ? 'action.revert' : 'action.cancel')}
            </Button>
            {dirty && <span className={`${base}-unsaved`}>{tr('list.unsaved')}</span>}
          </div>
        </React.Fragment> : <div className={`${base}-empty ${base}-empty-main`}>
          {tr('editor.pick')}
        </div>}
      </div>
    </div>}
  </div>;
});
