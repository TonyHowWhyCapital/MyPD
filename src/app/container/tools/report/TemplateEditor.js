import React, { useMemo, useRef, useState } from 'react';
import {
  FormatMessage, Button, Input, Select, Text, Icon, Modal, openModal,
} from 'components';
import { sectionTypes, labelOf } from '../../../../lib/report';
import { getPrefix } from '../../../../lib/prefixUtil';
import SectionPreview from './SectionPreview';
import ColumnDesigner from './ColumnDesigner';
import LayoutPanel from './LayoutPanel';

const Option = Select.Option;

export default React.memo(({
  prefix, draft, lang, dirty, getDataSource, onChange, onSave,
}) => {
  const currentPrefix = getPrefix(prefix);
  const [newType, setNewType] = useState('entityList');
  // Folded sections are a matter of this window, the template does not keep them.
  const [folded, setFolded] = useState({});
  const dragged = useRef(-1);
  // The report tool is modal, the model cannot change underneath it.
  const dataSource = useMemo(() => getDataSource(), []);
  if (!draft) {
    return <div className={`${currentPrefix}-report-editor`}>
      <div className={`${currentPrefix}-report-blank`}><FormatMessage id='report.noSelection'/></div>
    </div>;
  }
  const isList = draft.kind === 'list';
  const addableTypes = Object.keys(sectionTypes).filter(t => !isList || sectionTypes[t].flat);
  const setSections = sections => onChange({ ...draft, sections });
  const patchSection = (index, patch) => {
    setSections(draft.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };
  const design = (index) => {
    const section = draft.sections[index];
    const modal = openModal(<ColumnDesigner
      prefix={prefix}
      section={section}
      def={sectionTypes[section.type]}
      dataSource={dataSource}
      lang={lang}
      onChange={patch => patchSection(index, patch)}
    />, {
      title: `${FormatMessage.string({ id: 'report.designTitle' })} - ${section.title || labelOf(`section.${section.type}`, lang)}`,
      bodyStyle: { width: '88%' },
      buttons: [<Button key='close' onClick={() => modal.close()}><FormatMessage id='report.close'/></Button>],
    });
  };
  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= draft.sections.length) return;
    const next = draft.sections.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setSections(next);
  };
  const drop = (to) => {
    const from = dragged.current;
    dragged.current = -1;
    if (from < 0 || from === to) return;
    const next = draft.sections.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    setSections(next);
  };
  const remove = (index) => {
    const section = draft.sections[index];
    Modal.confirm({
      title: FormatMessage.string({ id: 'report.removeSectionTitle' }),
      message: section.title || labelOf(`section.${section.type}`, lang),
      onOk: () => setSections(draft.sections.filter((_, idx) => idx !== index)),
    });
  };
  const allFolded = draft.sections.length > 0 && draft.sections.every(s => folded[s.id]);
  const foldAll = () => setFolded(allFolded ? {} : draft.sections.reduce((m, s) => ({ ...m, [s.id]: true }), {}));
  const addSection = () => {
    // Picking the type a list already shows would only throw its layout away.
    if (isList && draft.sections.length === 1 && draft.sections[0].type === newType) return;
    const section = { id: Math.uuid(), type: newType, title: '', columns: [], options: {} };
    setSections(isList ? [section] : draft.sections.concat(section));
  };
  const text = id => FormatMessage.string({ id: `report.${id}` });
  const last = draft.sections.length - 1;
  return <div className={`${currentPrefix}-report-editor`}>
    <div className={`${currentPrefix}-report-editor-head`}>
      <span className={`${currentPrefix}-report-title`}><FormatMessage id='report.editor'/></span>
      {dirty && <i className='unsaved'>● <FormatMessage id='report.unsaved'/></i>}
      <Button type='primary' onClick={onSave}><FormatMessage id='report.save'/></Button>
    </div>
    <div className={`${currentPrefix}-report-editor-body`}>
      <div className={`${currentPrefix}-report-row`}>
        <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.name'/></span>
        <Input
          value={draft.defName}
          onChange={e => onChange({ ...draft, defName: e.target.value })}
        />
        <span className={`${currentPrefix}-report-kind`}>
          <Icon type={isList ? 'fa-list' : 'fa-file-text-o'}/>
          <FormatMessage id={isList ? 'report.kindList' : 'report.kindDocument'}/>
        </span>
      </div>
      <LayoutPanel cls={`${currentPrefix}-report`} draft={draft} onChange={onChange}/>
      <div className={`${currentPrefix}-report-row`}>
        <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.sections'/></span>
        <Select notAllowEmpty value={newType} onChange={e => setNewType(e.target.value)}>
          {addableTypes.map(t => <Option key={t} value={t}>{labelOf(`section.${t}`, lang)}</Option>)}
        </Select>
        <Button onClick={addSection}>
          <Icon type={isList ? 'fa-exchange' : 'fa-plus'}/> <FormatMessage id={isList ? 'report.replaceSection' : 'report.addSection'}/>
        </Button>
        {draft.sections.length > 1 && <a className='fold-all' onClick={foldAll}>
          <FormatMessage id={allFolded ? 'report.expandAll' : 'report.collapseAll'}/>
        </a>}
      </div>
      {draft.sections.length === 0
        && <div className={`${currentPrefix}-report-blank`}><FormatMessage id='report.sectionEmpty'/></div>}
      {draft.sections.map((s, i) => {
        const def = sectionTypes[s.type];
        const typeName = labelOf(`section.${s.type}`, lang);
        const hasTable = def && def.columns.length > 0;
        const open = !folded[s.id];
        return <div
          key={s.id}
          className={`${currentPrefix}-report-section`}
          onDragOver={e => dragged.current >= 0 && e.preventDefault()}
          onDrop={() => drop(i)}
        >
          <div
            className={`${currentPrefix}-report-section-head`}
            draggable={draft.sections.length > 1}
            title={draft.sections.length > 1 ? text('dragSection') : undefined}
            onDragStart={() => { dragged.current = i; }}
            onDragEnd={() => { dragged.current = -1; }}
          >
            <strong>
              <a
                className='fold'
                title={text(open ? 'collapse' : 'expand')}
                onClick={() => setFolded({ ...folded, [s.id]: open })}
              ><Icon type={open ? 'fa-angle-down' : 'fa-angle-right'}/></a>
              <em>{i + 1}</em>{typeName}{s.title ? <small>{s.title}</small> : null}
            </strong>
            <span>
              {hasTable && <a className='primary' onClick={() => design(i)}>
                <Icon type='fa-columns'/><FormatMessage id='report.design'/>
              </a>}
              <a className={i === 0 ? 'disabled' : ''} title={text('moveUp')} onClick={() => move(i, -1)}>
                <Icon type='fa-arrow-up'/>
              </a>
              <a className={i === last ? 'disabled' : ''} title={text('moveDown')} onClick={() => move(i, 1)}>
                <Icon type='fa-arrow-down'/>
              </a>
              <a
                className='danger'
                title={text('remove')}
                onClick={() => remove(i)}
              ><Icon type='fa-trash-o'/></a>
            </span>
          </div>
          {open && <React.Fragment>
          <div className={`${currentPrefix}-report-row`}>
            <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.sectionTitle'/></span>
            <Input
              value={s.title || ''}
              placeholder={FormatMessage.string({ id: 'report.sectionTitleHint', data: { name: typeName } })}
              onChange={e => patchSection(i, { title: e.target.value })}
            />
          </div>
          {s.type === 'text' && <div className={`${currentPrefix}-report-row`}>
            <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.text'/></span>
            <Text
              rows={4}
              style={{ flex: 1 }}
              value={s.options?.text || ''}
              onChange={e => patchSection(i, { options: { ...s.options, text: e.target.value } })}
            />
          </div>}
          {hasTable && <SectionPreview
            cls={`${currentPrefix}-report-strip`}
            section={s}
            dataSource={dataSource}
            lang={lang}
            onClick={() => design(i)}
          />}
          </React.Fragment>}
        </div>;
      })}
    </div>
  </div>;
});
