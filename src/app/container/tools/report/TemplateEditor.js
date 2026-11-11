import React, { useState } from 'react';
import {
  FormatMessage, Button, Input, Select, Text,
} from 'components';
import { sectionTypes, labelOf } from '../../../../lib/report';
import { getPrefix } from '../../../../lib/prefixUtil';
import ColumnPicker from './ColumnPicker';

const Option = Select.Option;

export default React.memo(({ prefix, draft, lang, onChange, onSave }) => {
  const currentPrefix = getPrefix(prefix);
  const [newType, setNewType] = useState('entityList');
  if (!draft) {
    return <div className={`${currentPrefix}-report-editor`}><FormatMessage id='report.noSelection'/></div>;
  }
  const isList = draft.kind === 'list';
  const addableTypes = Object.keys(sectionTypes).filter(t => !isList || sectionTypes[t].flat);
  const setSections = sections => onChange({ ...draft, sections });
  const patchSection = (index, patch) => {
    setSections(draft.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)));
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
  return <div className={`${currentPrefix}-report-editor`}>
    <div className={`${currentPrefix}-report-title`}><FormatMessage id='report.editor'/></div>
    <div className={`${currentPrefix}-report-row`}>
      <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.name'/></span>
      <Input value={draft.defName} onChange={e => onChange({ ...draft, defName: e.target.value })}/>
    </div>
    <div className={`${currentPrefix}-report-row`}>
      <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.kind'/></span>
      <span><FormatMessage id={isList ? 'report.kindList' : 'report.kindDocument'}/></span>
    </div>
    <div className={`${currentPrefix}-report-row`}>
      <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.sections'/></span>
      <Select notAllowEmpty value={newType} onChange={e => setNewType(e.target.value)}>
        {addableTypes.map(t => <Option key={t} value={t}>{labelOf(`section.${t}`, lang)}</Option>)}
      </Select>
      <Button onClick={addSection}><FormatMessage id='report.addSection'/></Button>
    </div>
    <div className={`${currentPrefix}-report-sections`}>
      {draft.sections.map((s, i) => {
        const def = sectionTypes[s.type];
        return <div key={s.id} className={`${currentPrefix}-report-section`}>
          <div className={`${currentPrefix}-report-section-head`}>
            <strong>{labelOf(`section.${s.type}`, lang)}</strong>
            <span>
              <a onClick={() => move(i, -1)}><FormatMessage id='report.moveUp'/></a>
              <a onClick={() => move(i, 1)}><FormatMessage id='report.moveDown'/></a>
              <a onClick={() => setSections(draft.sections.filter((_, idx) => idx !== i))}><FormatMessage id='report.remove'/></a>
            </span>
          </div>
          <div className={`${currentPrefix}-report-row`}>
            <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.sectionTitle'/></span>
            <Input value={s.title || ''} onChange={e => patchSection(i, { title: e.target.value })}/>
          </div>
          {s.type === 'text' && <div className={`${currentPrefix}-report-row`}>
            <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.text'/></span>
            <Text
              rows={4}
              style={{ width: '100%' }}
              value={s.options?.text || ''}
              onChange={e => patchSection(i, { options: { ...s.options, text: e.target.value } })}
            />
          </div>}
          {def && def.columns.length > 0 && <div className={`${currentPrefix}-report-row`}>
            <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.columns'/></span>
            <ColumnPicker
              currentPrefix={currentPrefix}
              def={def}
              section={s}
              lang={lang}
              onChange={columns => patchSection(i, { columns })}
              onWidths={widths => patchSection(i, { widths })}
              onAligns={aligns => patchSection(i, { aligns })}
            />
          </div>}
        </div>;
      })}
    </div>
    <Button type='primary' onClick={onSave}><FormatMessage id='report.save'/></Button>
  </div>;
});
