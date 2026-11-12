import React, { useMemo, useState } from 'react';
import {
  FormatMessage, Button, Input, Select, Text, Icon, openModal,
} from 'components';
import { sectionTypes, labelOf } from '../../../../lib/report';
import { getPrefix } from '../../../../lib/prefixUtil';
import SectionPreview from './SectionPreview';
import ColumnDesigner from './ColumnDesigner';

const Option = Select.Option;

export default React.memo(({
  prefix, draft, lang, getDataSource, onChange, onSave,
}) => {
  const currentPrefix = getPrefix(prefix);
  const [newType, setNewType] = useState('entityList');
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
  const addSection = () => {
    const section = { id: Math.uuid(), type: newType, title: '', columns: [], options: {} };
    setSections(isList ? [section] : draft.sections.concat(section));
  };
  const text = id => FormatMessage.string({ id: `report.${id}` });
  const last = draft.sections.length - 1;
  return <div className={`${currentPrefix}-report-editor`}>
    <div className={`${currentPrefix}-report-editor-head`}>
      <span className={`${currentPrefix}-report-title`}><FormatMessage id='report.editor'/></span>
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
      <div className={`${currentPrefix}-report-row`}>
        <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.sections'/></span>
        <Select notAllowEmpty value={newType} onChange={e => setNewType(e.target.value)}>
          {addableTypes.map(t => <Option key={t} value={t}>{labelOf(`section.${t}`, lang)}</Option>)}
        </Select>
        <Button onClick={addSection}>
          <Icon type='fa-plus'/> <FormatMessage id='report.addSection'/>
        </Button>
      </div>
      {draft.sections.length === 0
        && <div className={`${currentPrefix}-report-blank`}><FormatMessage id='report.sectionEmpty'/></div>}
      {draft.sections.map((s, i) => {
        const def = sectionTypes[s.type];
        const typeName = labelOf(`section.${s.type}`, lang);
        const hasTable = def && def.columns.length > 0;
        return <div key={s.id} className={`${currentPrefix}-report-section`}>
          <div className={`${currentPrefix}-report-section-head`}>
            <strong><em>{i + 1}</em>{typeName}</strong>
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
                onClick={() => setSections(draft.sections.filter((_, idx) => idx !== i))}
              ><Icon type='fa-trash-o'/></a>
            </span>
          </div>
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
        </div>;
      })}
    </div>
  </div>;
});
