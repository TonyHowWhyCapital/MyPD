// The "generate test data" window. Three steps: the tables and how many rows each gets,
// the rules of their columns with a preview, and where the rows go.
//
// Props (given by `openTestData` in src/app/main/index.js)
//   dataSource, getDataSource, updateDataSource   the project and its normal update path
//   config            settings of the app (Java home, JVM options)
//   projectFile       path of the project file; the outputs are offered beside it
//   entityIds         tables ticked when the window opens (from the context menu); without
//                     them the tables ticked last time are, as the project remembers them
//   openConnSettings  () => void, shows the connection settings of the project
//   onClose           () => void, closes the window (asks first while a run is at work)
//   onCloseGuard      (fn) => void, registers the question asked before closing
import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Button, Icon, Modal, StepBar,
} from 'components';
import { getPrefix } from '../../../../../lib/prefixUtil';
import { getUiState, setUiState } from '../../../../../lib/middle';
import { buildPlan } from '../../../../../lib/testdata/plan';
import { dialectOf } from '../../../../../lib/testdata/sql';
import { runQuery, readKeys, readKeyRows } from '../../../../../lib/testdata/db';
import { readListFile } from '../rules/fileList';
import { tr as ruleTr, say } from '../rules/i18n';
import { tr } from './i18n';
import { count } from './format';
import {
  patchTable, seedOfRun, clockOfRun, withSeedBase, readSettings, writeSettings, selectionOf,
  withSelection,
} from './settings';
import { connections, pickConn, connTarget } from './connInfo';
import { runErrorText, dbErrorParts } from './problems';
import { checkErrorLine, isCheckCode } from '../rules/queryText';
import { problemItems } from './problemItems';
import { createLoader } from './needs';
import { totalRows } from './planView';
import { existingTargets, targetProblem } from './outputs';
import { defaultTargets } from './io';
import useProject from './useProject';
import useRun from './useRun';
import TablePicker from './TablePicker';
import Splitter from './Splitter';
import TableGrid from './TableGrid';
import SettingsBar from './SettingsBar';
import ProblemPanel from './ProblemPanel';
import ColumnsStep from './ColumnsStep';
import OutputStep from './OutputStep';
import RunView from './RunView';
import { openDbConfirm } from './DbConfirm';
import './style/index.less';

const STEPS = ['tables', 'columns', 'output'];
const OUTPUT_KEY = 'testDataOutput';
const LAYOUT_KEY = 'testDataLayout';

const dialectName = dialect => tr(`dialect.${dialect}`) || dialect;

export default React.memo(({
  prefix, dataSource, getDataSource, updateDataSource, config, projectFile, entityIds,
  openConnSettings, onClose, onCloseGuard,
}) => {
  const base = `${getPrefix(prefix)}-tdgen`;
  const project = useProject({
    dataSource,
    getDataSource,
    updateDataSource,
  });
  const { view } = project;
  const hasTables = (view.entities || []).length > 0;
  const [step, setStep] = useState('tables');
  // The tables ticked and the answers for missing parents live in the settings of the
  // project. Tables given by the context menu are shown in their place for this visit and
  // are stored with the first thing that is changed here, or with a run.
  const [preset, setPreset] = useState(() => ((entityIds || []).length > 0 ? entityIds : null));
  const settings = useMemo(() => (preset ? withSelection(project.settings,
    preset.filter(id => (view.entities || []).some(e => e.id === id)), {})
    : project.settings), [preset, project.settings, view]);
  const { selected, external } = useMemo(() => selectionOf(settings), [settings]);
  const save = (next) => {
    if (next !== project.settings) {
      project.setSettings(next);
    }
    setPreset(null);
  };
  const choose = (nextSelected, nextExternal) => {
    const next = withSelection(settings, nextSelected, nextExternal);
    // the same ticks again change nothing and write nothing
    next !== settings && save(next);
  };
  const [active, setActive] = useState('');
  const [focusField, setFocusField] = useState('');
  const [connKey, setConnKey] = useState('');
  const [out, setOutState] = useState(() => {
    const saved = getUiState(OUTPUT_KEY, {}) || {};
    const targets = defaultTargets(view, projectFile);
    return {
      sql: saved.sql !== false,
      csv: !!saved.csv,
      xlsx: !!saved.xlsx,
      db: false,
      multiRow: saved.multiRow,
      go: saved.go !== false,
      sqlPath: targets.sql,
      csvPath: targets.csv,
      xlsxPath: targets.xlsx,
    };
  });
  const setOut = (next) => {
    setOutState(next);
    setUiState(OUTPUT_KEY, {
      sql: next.sql, csv: next.csv, xlsx: next.xlsx, multiRow: next.multiRow, go: next.go,
    });
  };
  // sizes the blocks were dragged to: {picker, tables, preview} in px, absent as laid out
  const [layout, setLayoutState] = useState(() => getUiState(LAYOUT_KEY, {}) || {});
  const setSize = (name, size) => {
    const { [name]: dropped, ...rest } = layout;
    const next = size === null ? rest : { ...rest, [name]: size };
    setLayoutState(next);
    setUiState(LAYOUT_KEY, next);
  };
  const runner = useRun();
  const { run } = runner;
  const conns = connections(view);
  const conn = pickConn(view, connKey);
  const target = connTarget(view, conn);
  const dialect = dialectOf(view);
  const multiRow = out.multiRow === undefined ? undefined : !!out.multiRow;
  // the seed of the previews: the stored one, or one number for as long as the window is open
  const seed = useMemo(() => seedOfRun(settings), [settings.seed.fixed, settings.seed.value]);
  const clock = useMemo(() => clockOfRun(settings),
    [settings.seed.fixed, settings.seed.baseDate]);
  const planOf = (ds, lists) => buildPlan(ds, {
    entityIds: selected.filter(id => (ds.entities || []).some(e => e.id === id)),
    external,
    lists,
    now: clockOfRun(readSettings(ds)),
  });
  const plan = useMemo(() => planOf(view), [view, selected, external, clock]);
  const live = useRef({});
  live.current = {
    view, conn, config,
  };
  const loader = useMemo(() => createLoader({
    hasConnection: () => !!live.current.conn,
    readFile: (file, params) => readListFile(file, params),
    runQuery: sql => runQuery(live.current.view, live.current.config, live.current.conn, sql),
    readKeys: (table, column) => readKeys(live.current.view, live.current.config,
      live.current.conn, table, column),
    readKeyRows: (table, columns) => readKeyRows(live.current.view, live.current.config,
      live.current.conn, table, columns),
  }), []);
  const errorText = error => runErrorText(tr, ruleTr, error, view);
  const loadErrorText = ({ request, error }) => tr(`load.${request.kind}`, {
    name: request.file || request.path || request.table || '',
    // a query the database refused reads as in the rule editor: the object, the place;
    // the name says which file it is: the reason does not repeat the path
    reason: (request.kind === 'query' && error && isCheckCode(say, error.code)
      && checkErrorLine(say, error)) || errorText(request.kind === 'file' && error && error.code
      ? { code: error.code } : error),
  });
  const gotoTable = (id) => {
    setActive(id);
    setFocusField('');
    setStep('tables');
  };
  const gotoColumn = (id, fieldId) => {
    setActive(id);
    setFocusField(fieldId || '');
    setStep('columns');
  };
  const answerParent = (id, answer) => {
    const { [id]: dropped, ...rest } = external;
    if (answer === 'generate') {
      choose(selected.includes(id) ? selected : selected.concat(id), rest);
    } else {
      choose(selected, { ...rest, [id]: 'database' });
    }
  };
  const unselect = id => choose(selected.filter(s => s !== id), external);
  const items = useMemo(() => problemItems({
    plan,
    view,
    tr,
    ruleTr,
    hasConn: !!conn,
    external,
    actions: {
      answerParent,
      unselect,
      gotoTable,
      gotoColumn,
      connSettings: openConnSettings,
      patchTable: (id, patch) => save(patchTable(settings, id, patch)),
    },
  }), [plan, view, conn, external, settings, selected]);
  const problemsOf = (entityId, fieldId) => items.filter(i => i.entityId === entityId
    && (fieldId === undefined || i.fieldId === fieldId));
  const blocking = items.filter(i => i.blocking).length;
  const databaseParents = Object.keys(external).filter(id => external[id] === 'database'
    && plan.tables.some(t => (t.foreignKeys || []).some(k => k.refEntityId === id
      && k.source === 'database')));
  const pathProblems = {
    sql: out.sql ? targetProblem(out.sqlPath, 'file') : '',
    csv: out.csv ? targetProblem(out.csvPath, 'dir') : '',
    xlsx: out.xlsx ? targetProblem(out.xlsxPath, 'file') : '',
  };
  const useDb = out.db && !!conn;
  // why the run cannot start, '' when it can
  const blocked = () => {
    if (plan.tables.length === 0) {
      return tr('blocked.noTables');
    }
    if (blocking > 0) {
      return tr('blocked.problems', { count: blocking });
    }
    if (!out.sql && !out.csv && !out.xlsx && !useDb) {
      return tr('blocked.noOutput');
    }
    if (pathProblems.sql || pathProblems.csv || pathProblems.xlsx) {
      return tr('blocked.badPath');
    }
    return useDb && !target.complete ? tr('output.connIncomplete') : '';
  };
  const reason = blocked();
  const launch = (db) => {
    // a fixed seed counts its dates from a day that is written down with the first run,
    // so that the same settings give the same data tomorrow as well
    // (tables ticked from the context menu are written down with it)
    const stamped = settings === project.settings ? withSeedBase(project.get())
      : writeSettings(project.get(), settings);
    project.update(stamped, true);
    setPreset(null);
    const stored = readSettings(stamped);
    runner.start({
      view,
      plan,
      // the rules are tried once more with the lists that were read for the run
      recheck: lists => problemItems({
        plan: planOf(view, lists),
        view,
        tr,
        ruleTr,
        hasConn: !!conn,
        external,
        actions: {},
      }).filter(i => i.blocking).map(i => i.text),
      config,
      loader,
      conn,
      connKey: conn ? conn.defKey : '',
      dialect,
      connDialect: target && target.dialect !== 'generic' ? target.dialect : dialect,
      seed: seedOfRun(stored),
      now: clockOfRun(stored),
      targets: {
        sql: out.sql ? out.sqlPath.trim() : '',
        csv: out.csv ? out.csvPath.trim() : '',
        xlsx: out.xlsx ? out.xlsxPath.trim() : '',
      },
      sqlOptions: {
        multiRow,
        go: out.go,
        generator: 'MyPD',
      },
      db,
    });
  };
  const confirmDb = () => (useDb ? openDbConfirm({
    base, view, config, conn, target, plan, dialectName, errorText,
  }, launch) : launch(null));
  const generate = () => {
    if (reason) {
      return;
    }
    const found = existingTargets({
      sql: out.sql ? out.sqlPath.trim() : '',
      csv: out.csv ? out.csvPath.trim() : '',
      xlsx: out.xlsx ? out.xlsxPath.trim() : '',
    }, plan.tables);
    if (found.length === 0) {
      confirmDb();
      return;
    }
    Modal.confirm({
      title: tr('overwrite.title'),
      message: <div className={`${base}-overwrite`}>
        <div>{tr('overwrite.message', { count: found.length })}</div>
        {found.slice(0, 8).map(f => <div key={f} className={`${base}-overwrite-file`}>{f}</div>)}
        {found.length > 8 && <div>{tr('overwrite.more', { count: found.length - 8 })}</div>}
      </div>,
      onOk: confirmDb,
    });
  };
  useEffect(() => {
    onCloseGuard && onCloseGuard((proceed) => {
      if (!runner.active()) {
        proceed();
        return;
      }
      Modal.confirm({
        title: tr('run.leaveTitle'),
        message: tr('run.leaveMessage'),
        onOk: () => {
          runner.cancel();
          runner.whenIdle(proceed);
        },
      });
    });
  }, []);
  const at = STEPS.indexOf(step);
  const total = totalRows(plan);
  let totalText = total.min === total.max ? count(total.min)
    : `${count(total.min)}–${count(total.max)}`;
  if (total.open) {
    totalText = `≥ ${count(total.min)}`;
  }
  const working = run && run.status !== 'finished';
  return <div className={`${base}`}>
    {!run && <StepBar
      steps={STEPS.map(s => ({ key: s, title: tr(`step.${s}`) }))}
      current={step}
      onChange={setStep}
    />}
    {!run && step !== 'output' && <ProblemPanel base={base} items={items}/>}
    <div className={`${base}-content`}>
      {run && <RunView
        base={base}
        run={run}
        target={target}
        errorText={errorText}
        loadErrorText={loadErrorText}
        dbErrorParts={e => dbErrorParts(tr, e)}
      />}
      {!run && step === 'tables' && <div className={`${base}-split`}>
        <TablePicker
          base={base}
          dataSource={view}
          selected={selected}
          width={layout.picker}
          onChange={ids => choose(ids, external)}
        />
        <Splitter
          base={base}
          axis='x'
          side='before'
          min={180}
          keep={420}
          onSize={size => setSize('picker', size)}
        />
        <div className={`${base}-main`}>
          <SettingsBar
            base={base}
            settings={settings}
            setSettings={save}
            setBaseDate={baseDate => save({
              ...settings,
              seed: {
                ...settings.seed,
                baseDate,
              },
            })}
          />
          {plan.tables.length === 0 ? <div className={`${base}-empty ${base}-empty-big`}>
            <Icon type={hasTables ? 'fa-hand-o-left' : 'fa-table'}/>
            <div>{tr(hasTables ? 'tables.empty' : 'tables.none')}</div>
            <div className={`${base}-dim`}>
              {tr(hasTables ? 'tables.emptyHint' : 'tables.noneHint')}
            </div>
          </div> : <TableGrid
            base={base}
            dataSource={view}
            plan={plan}
            settings={settings}
            problemsOf={problemsOf}
            databaseParents={databaseParents}
            unsaved={project.unsaved}
            active={active}
            onPatch={(id, patch) => save(patchTable(settings, id, patch))}
            onOpen={id => gotoColumn(id)}
            onRemove={unselect}
            onParentAnswer={answerParent}
          />}
        </div>
      </div>}
      {!run && step === 'columns' && <ColumnsStep
        base={base}
        project={project}
        plan={plan}
        active={active}
        focusField={focusField}
        problemsOf={problemsOf}
        seed={seed}
        now={clock}
        loader={loader}
        connKey={conn ? conn.defKey : ''}
        errorText={errorText}
        loadErrorText={loadErrorText}
        layout={layout}
        setSize={setSize}
        onActive={(id) => {
          setActive(id);
          setFocusField('');
        }}
        onTable={gotoTable}
      />}
      {!run && step === 'output' && <OutputStep
        base={base}
        out={{ ...out, multiRow }}
        setOut={setOut}
        dialect={dialect}
        dialectName={dialectName}
        pathProblems={pathProblems}
        conns={conns}
        conn={conn}
        target={target}
        onConn={setConnKey}
        onConnSettings={openConnSettings}
      />}
    </div>
    <div className={`${base}-footer`}>
      <div className={`${base}-footer-info`}>
        {!run && plan.tables.length > 0 && <span>
          {tr('footer.summary', {
            tables: plan.tables.length,
            rows: totalText,
          })}
        </span>}
        {!run && blocking > 0 && <a className={`${base}-bad`} onClick={() => setStep('tables')}>
          <Icon type='fa-exclamation-circle'/>{tr('footer.problems', { count: blocking })}
        </a>}
        {!run && step === 'output' && reason && blocking === 0
          && <span className={`${base}-bad`}>{reason}</span>}
      </div>
      <div className={`${base}-footer-buttons`}>
        {working && <Button onClick={runner.cancel} disable={run.status === 'cancelling'}>
          {tr(run.status === 'cancelling' ? 'run.cancelling' : 'run.cancel')}
        </Button>}
        {run && !working && <Button onClick={runner.reset}>{tr('run.back')}</Button>}
        {!run && at > 0 && <Button onClick={() => setStep(STEPS[at - 1])}>
          {tr('footer.back')}
        </Button>}
        {!run && at < STEPS.length - 1 && <Button
          type='primary'
          onClick={() => setStep(STEPS[at + 1])}
        >
          {tr('footer.next')}
        </Button>}
        {!run && step === 'output' && <span title={reason}>
          <Button type='primary' disable={!!reason} onClick={generate}>
            <Icon type='fa-play'/>{tr('footer.generate')}
          </Button>
        </span>}
        {!working && <Button onClick={onClose}>{tr('footer.close')}</Button>}
      </div>
    </div>
  </div>;
});
