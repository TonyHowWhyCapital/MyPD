import React, { useState } from 'react';
import { FormatMessage, Button, Select, Icon, Message, Download, openModal } from 'components';
import { buildReport, renderReport } from '../../../../lib/report';
import { openProjectFilePath, readJsonPromise } from '../../../../lib/middle';
import { getPrefix } from '../../../../lib/prefixUtil';
import ReportPreview from './ReportPreview';

const Option = Select.Option;
const FORMATS = ['docx', 'html', 'markdown', 'csv'];

export default React.memo(({ prefix, template, getDataSource, lang, onTemplateChange }) => {
  const currentPrefix = getPrefix(prefix);
  const [extras, setExtras] = useState([]);
  const [format, setFormat] = useState('docx');
  const addModel = () => {
    openProjectFilePath().then(path => readJsonPromise(path).then((data) => {
      setExtras(pre => pre.concat({ path, data }));
    })).catch((err) => {
      // A cancelled file dialog rejects without a message.
      if (err && err.message) {
        Message.error({ title: `${FormatMessage.string({ id: 'report.loadFail' })}: ${err.message}` });
      }
    });
  };
  const allModels = () => [getDataSource(), ...extras.map(e => e.data)];
  const build = () => buildReport(template, allModels(), { lang });
  const preview = () => {
    // docx and html honour column widths, so their preview is the one that can be resized.
    const laidOut = ['docx', 'html'].includes(format);
    const modal = openModal(laidOut
      ? <ReportPreview prefix={prefix} template={template} models={allModels()} lang={lang} onChange={onTemplateChange}/>
      : <pre style={{ margin: 0, maxHeight: '70vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{renderReport(build(), format).data}</pre>, {
      title: FormatMessage.string({ id: 'report.previewTitle' }),
      bodyStyle: { width: '80%' },
      buttons: [<Button key='close' onClick={() => modal.close()}><FormatMessage id='report.close'/></Button>],
    });
  };
  const exportReport = () => {
    try {
      const { data, extension, mime } = renderReport(build(), format);
      // Download wraps parts in a Blob, so a docx Uint8Array goes in as one binary part.
      Download([data], mime, `${template.defName || 'report'}.${extension}`);
    } catch (err) {
      Message.error({ title: `${FormatMessage.string({ id: 'report.exportFail' })}: ${err.message}` });
    }
  };
  return <div className={`${currentPrefix}-report-generate`}>
    <div className={`${currentPrefix}-report-title`}><FormatMessage id='report.generate'/></div>
    <div className={`${currentPrefix}-report-label`}><FormatMessage id='report.models'/></div>
    <div className={`${currentPrefix}-report-models`}>
      <div className={`${currentPrefix}-report-model`}>
        <span><Icon type='fa-database'/><FormatMessage id='report.currentModel'/></span>
      </div>
      {extras.map((e, i) => <div key={e.path} className={`${currentPrefix}-report-model`}>
        <span title={e.path}><Icon type='fa-file-o'/>{e.data.name || e.path}</span>
        <a
          className='danger'
          title={FormatMessage.string({ id: 'report.removeModel' })}
          onClick={() => setExtras(extras.filter((_, idx) => idx !== i))}
        ><Icon type='fa-times'/></a>
      </div>)}
    </div>
    <Button onClick={addModel}><Icon type='fa-plus'/> <FormatMessage id='report.addModel'/></Button>
    <div className={`${currentPrefix}-report-row`}>
      <span className={`${currentPrefix}-report-label`}><FormatMessage id='report.format'/></span>
      <Select notAllowEmpty value={format} onChange={e => setFormat(e.target.value)}>
        {FORMATS.filter(f => f !== 'csv' || template.kind === 'list').map(f => <Option key={f} value={f}>{FormatMessage.string({ id: `report.formats.${f}` })}</Option>)}
      </Select>
    </div>
    <div className={`${currentPrefix}-report-hint`}><FormatMessage id={`report.formatHint.${format}`}/></div>
    <div className={`${currentPrefix}-report-actions`}>
      <Button type='primary' onClick={exportReport}><FormatMessage id='report.export'/></Button>
      <Button onClick={preview}><FormatMessage id='report.preview'/></Button>
    </div>
  </div>;
});
