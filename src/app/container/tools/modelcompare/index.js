import React, {useRef, useState} from 'react';
import {
  Button, Checkbox, CodeEditor, FormatMessage, Message, Modal, Terminal, openModal,
} from 'components';
import {
  openProjectFilePath, readJsonPromise, getLogPath, showItemInFolder,
} from '../../../../lib/middle';
import {
  compareModels, generateAlterScript, mergeSelected, allSelectableKeys,
} from '../../../../lib/model_compare_util';
import {getPrefix} from '../../../../lib/prefixUtil';
import DiffTree, {leafKeys} from './DiffTree';
import SourcePicker from './SourcePicker';
import {loadDbSnapshot} from './dbSnapshot';
import {applyScript} from './applyDdl';

import './style/index.less';

const errorModal = (error) => {
  const body = error?.body || error?.message || error;
  Modal.error({
    bodyStyle: {width: '80%'},
    contentStyle: {width: '100%', height: '100%'},
    title: FormatMessage.string({id: 'modelCompare.loadFail'}),
    message: <div>
      <div style={{textAlign: 'center'}}><FormatMessage id='dbConnect.log'/><a onClick={showItemInFolder}>{getLogPath()}</a></div>
      <Terminal termReady={term => term.write(typeof body === 'object' ? JSON.stringify(body, null, 2) : `${body}`)}/>
    </div>,
  });
};

export default React.memo(({prefix, dataSource, getDataSource, updateDataSource,
                             config, openLoading, closeLoading}) => {
  const currentPrefix = getPrefix(prefix);
  const fresh = () => (getDataSource ? getDataSource() : dataSource);
  const dbConn = dataSource.dbConn || [];
  const [sides, setSides] = useState({A: {kind: 'current'}, B: {kind: 'db', dbKey: dbConn[0]?.defKey || ''}});
  const [targetSide, setTargetSide] = useState('B');
  const [loaded, setLoaded] = useState(null);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const scriptText = useRef('');

  const pickFile = (side) => {
    openProjectFilePath().then((filePath) => {
      setSides(pre => ({...pre, [side]: {...pre[side], filePath}}));
    }).catch(errorModal);
  };
  const loadSide = (side) => {
    if (side.kind === 'current') return Promise.resolve(fresh());
    if (side.kind === 'file') {
      return side.filePath ? readJsonPromise(side.filePath)
        : Promise.reject(new Error(FormatMessage.string({id: 'modelCompare.noFile'})));
    }
    const conn = dbConn.filter(d => d.defKey === side.dbKey)[0];
    if (!conn) return Promise.reject(new Error(FormatMessage.string({id: 'modelCompare.chooseDb'})));
    return loadDbSnapshot(fresh(), config, conn, (done, total) => {
      openLoading(`${FormatMessage.string({id: 'modelCompare.scanning'})} ${done}/${total}`);
    });
  };
  const run = (a, b, target) => {
    const [source, targetDs] = target === 'A' ? [b, a] : [a, b];
    const next = compareModels(source, targetDs);
    setLoaded({A: a, B: b});
    setResult(next);
    setSelected(new Set());
  };
  const compare = () => {
    openLoading(FormatMessage.string({id: 'modelCompare.scanning'}));
    Promise.all([loadSide(sides.A), loadSide(sides.B)])
      .then(([a, b]) => run(a, b, targetSide))
      .catch(errorModal)
      .finally(closeLoading);
  };
  const changeTarget = (side) => {
    setTargetSide(side);
    if (loaded) run(loaded.A, loaded.B, side);
  };
  const toggle = (keys, checked) => {
    setSelected((pre) => {
      const next = new Set(pre);
      keys.forEach(k => (checked ? next.add(k) : next.delete(k)));
      return next;
    });
  };
  const sourceDs = loaded && (targetSide === 'A' ? loaded.B : loaded.A);
  const targetDs = loaded && loaded[targetSide];
  const leaves = result ? result.items.reduce((a, i) => a.concat(leafKeys(i)), []) : [];
  const allChecked = leaves.length > 0 && leaves.every(k => selected.has(k));
  const canMerge = sides[targetSide].kind === 'current' && selected.size > 0;
  const guard = () => {
    if (selected.size === 0) {
      Message.error({title: FormatMessage.string({id: 'modelCompare.nothingSelected'})});
      return false;
    }
    return true;
  };
  const targetConn = sides[targetSide].kind === 'db'
    ? dbConn.find(d => d.defKey === sides[targetSide].dbKey) : null;
  const showScript = () => {
    if (!guard()) return;
    const script = generateAlterScript(result, [...selected], targetDs);
    scriptText.current = script;
    let modal;
    const close = () => modal && modal.close();
    const apply = () => applyScript({
      cls: `${currentPrefix}-modelcompare`,
      dataSource: fresh(),
      config,
      conn: targetConn,
      text: scriptText.current,
      openLoading,
      closeLoading,
      onApplied: () => {
        close();
        compare();
      },
      onFailed: compare,
    });
    modal = openModal(<CodeEditor
      mode='sql'
      value={script}
      onChange={(e) => { scriptText.current = e.target.value; }}
      width='auto'
      height='calc(100vh - 135px)'
    />, {
      bodyStyle: {width: '80%'},
      title: FormatMessage.string({id: 'modelCompare.scriptTitle'}),
      buttons: [
        ...(targetConn ? [<Button key='apply' type='primary' onClick={apply}>
          <FormatMessage id='modelCompare.applyToDb'/></Button>] : []),
        <Button key='close' onClick={close}><FormatMessage id='button.cancel'/></Button>,
      ],
    });
  };
  const merge = () => {
    if (!guard()) return;
    Modal.confirm({
      title: FormatMessage.string({id: 'modelCompare.merge'}),
      message: FormatMessage.string({id: 'modelCompare.mergeConfirm', data: {count: selected.size}}),
      onOk: () => {
        try {
          const merged = mergeSelected(targetDs, sourceDs, result, [...selected]);
          updateDataSource(merged);
          const a = targetSide === 'A' ? merged : loaded.A;
          const b = targetSide === 'B' ? merged : loaded.B;
          run(a, b, targetSide);
          Message.success({title: FormatMessage.string({id: 'modelCompare.merged'})});
        } catch (e) {
          errorModal(e);
        }
      },
    });
  };
  return (
    <div className={`${currentPrefix}-modelcompare`}>
      <SourcePicker
        prefix={prefix}
        label={FormatMessage.string({id: 'modelCompare.sideA'})}
        value={sides.A}
        dbConn={dbConn}
        onPickFile={() => pickFile('A')}
        onChange={v => setSides(pre => ({...pre, A: v}))}/>
      <SourcePicker
        prefix={prefix}
        label={FormatMessage.string({id: 'modelCompare.sideB'})}
        value={sides.B}
        dbConn={dbConn}
        onPickFile={() => pickFile('B')}
        onChange={v => setSides(pre => ({...pre, B: v}))}/>
      <div className={`${currentPrefix}-modelcompare-bar`}>
        <span><FormatMessage id='modelCompare.target'/></span>
        <Button type={targetSide === 'A' ? 'primary' : undefined} onClick={() => changeTarget('A')}>
          <FormatMessage id='modelCompare.targetA'/>
        </Button>
        <Button type={targetSide === 'B' ? 'primary' : undefined} onClick={() => changeTarget('B')}>
          <FormatMessage id='modelCompare.targetB'/>
        </Button>
        <Button type='primary' onClick={compare}><FormatMessage id='modelCompare.compare'/></Button>
      </div>
      {result && <div>
        <div className={`${currentPrefix}-modelcompare-bar`}>
          <Checkbox
            checked={allChecked}
            onChange={e => toggle(allSelectableKeys(result), e.target.checked)}
          >
            <FormatMessage id='modelCompare.selectAll'/>
          </Checkbox>
          <Button onClick={showScript}><FormatMessage id='modelCompare.generate'/></Button>
          <span title={FormatMessage.string({id: 'modelCompare.mergeTip'})}>
            <Button disable={!canMerge} onClick={merge}><FormatMessage id='modelCompare.merge'/></Button>
          </span>
        </div>
        <div className={`${currentPrefix}-modelcompare-body`}>
          {result.items.length === 0
            ? <FormatMessage id='modelCompare.noDiff'/>
            : <DiffTree
              prefix={prefix}
              items={result.items}
              selected={selected}
              onToggle={toggle}
            />}
        </div>
      </div>}
    </div>
  );
});
