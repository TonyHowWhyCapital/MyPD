import React, { useEffect, useRef, useState } from 'react';
import { Message, Modal, FormatMessage } from 'components';
import {
  getReportTemplates, getEmptyReportTemplate, saveReportTemplate, removeReportTemplate,
  validateReportTemplate, sameTemplate,
} from '../../../../lib/report';
import { getPrefix } from '../../../../lib/prefixUtil';
import TemplateList from './TemplateList';
import TemplateEditor from './TemplateEditor';
import GeneratePanel from './GeneratePanel';
import './style/index.less';

export default React.memo(({
  prefix, dataSource, getDataSource, updateDataSource, config, onCloseGuard,
}) => {
  const currentPrefix = getPrefix(prefix);
  const lang = config?.lang || 'zh';
  // The modal's dataSource prop never refreshes, so keep the saved copy here.
  const [ds, setDs] = useState(dataSource);
  const templates = getReportTemplates(ds, lang);
  const usingDefaults = !(ds.profile?.reportTemplates || []).length;
  const [draft, setDraft] = useState(templates[0] || null);
  const dirty = !!draft && !sameTemplate(draft, templates.find(t => t.id === draft.id));
  // Anything that would drop the edits asks first.
  const leave = (proceed) => {
    if (!dirty) {
      proceed();
      return;
    }
    Modal.confirm({
      title: FormatMessage.string({ id: 'report.discardTitle' }),
      message: FormatMessage.string({ id: 'report.discardMessage', data: { name: draft.defName } }),
      onOk: proceed,
    });
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    onCloseGuard && onCloseGuard(proceed => leaveRef.current(proceed));
  }, []);
  const persist = (next) => {
    updateDataSource(next);
    setDs(next);
  };
  const add = kind => leave(() => {
    const tpl = getEmptyReportTemplate(kind, lang);
    persist(saveReportTemplate(ds, tpl));
    setDraft(tpl);
  });
  const copy = tpl => leave(() => {
    const next = { ...JSON.parse(JSON.stringify(tpl)), id: Math.uuid(), defName: `${tpl.defName}_copy` };
    persist(saveReportTemplate(ds, next));
    setDraft(next);
  });
  const remove = (tpl) => {
    Modal.confirm({
      title: FormatMessage.string({ id: 'report.delete' }),
      message: tpl.defName,
      onOk: () => {
        const next = removeReportTemplate(ds, tpl.id);
        persist(next);
        if (draft?.id === tpl.id) setDraft(getReportTemplates(next, lang)[0] || null);
        Message.success({ title: FormatMessage.string({ id: 'report.deleted' }) });
      },
    });
  };
  const save = () => {
    const errors = validateReportTemplate(draft);
    if (errors.length) {
      const title = errors.map(e => FormatMessage.string({ id: `report.error.${e}` })).join('; ');
      Message.error({ title });
      return;
    }
    persist(saveReportTemplate(ds, draft));
    Message.success({ title: FormatMessage.string({ id: 'report.saved' }) });
  };
  return <div className={`${currentPrefix}-report`}>
    <TemplateList
      prefix={prefix}
      templates={templates}
      selectedId={draft?.id}
      usingDefaults={usingDefaults}
      dirty={dirty}
      onSelect={id => id !== draft?.id && leave(() => setDraft(templates.find(t => t.id === id) || null))}
      onAdd={add}
      onCopy={copy}
      onDelete={remove}
    />
    <TemplateEditor
      prefix={prefix}
      draft={draft}
      lang={lang}
      dirty={dirty}
      getDataSource={getDataSource}
      onChange={setDraft}
      onSave={save}
    />
    {draft && <GeneratePanel
      prefix={prefix}
      template={draft}
      getDataSource={getDataSource}
      lang={lang}
      onTemplateChange={setDraft}
    />}
  </div>;
});
