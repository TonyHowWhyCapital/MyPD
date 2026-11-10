import React, { useState } from 'react';
import {Button, CodeEditor, FormatMessage, openModal} from 'components';
import Preview from './Preview';
// eslint-disable-next-line import/named
import {platform} from '../../../lib/middle';

export default ({prefix, onChange, value, templateShow,
                             templateType, dataTypeSupport, dataSource, ...restProps}) => {
  const codeType = dataSource?.profile?.dataTypeSupports?.filter(d => d.id ===
      dataTypeSupport)[0];
  const [codeData, updateCodeData] = useState(value);
  const codeChange = (e) => {
    onChange && onChange(e);
    updateCodeData(e.target.value || '');
  };
  const openOptModal = (type) => {
    let modal = null;
    let cacheTemplate = codeData;
    const templateChange = (tempValue) => {
      cacheTemplate = tempValue;
    };
    const onOk = () => {
      onChange && onChange({target: {
          value: cacheTemplate,
        }});
      updateCodeData(cacheTemplate);
      modal && modal.close();
    };
    const onCancel = () => {
      modal && modal.close();
    };
    if (type === 'previewEdit') {
      modal = openModal(<Preview
        dataSource={dataSource}
        template={codeData}
        db={codeType?.id}
        mode={templateType === 'appCode' ? codeType?.defKey : 'SQL'}
        templateShow={templateShow}
        templateChange={templateChange}
      />, {
        fullScreen: true,
        title: FormatMessage.string({id: 'database.templateEditOpt.previewEdit'}),
        buttons: [<Button type='primary' key='ok' onClick={onOk}>
          <FormatMessage id='button.ok'/>
        </Button>,
          <Button key='cancel' onClick={onCancel}>
            <FormatMessage id='button.cancel'/>
          </Button>],
      });
    }
  };
  return <div className={`${prefix}-code-editor-content`}>
    <div className={`${prefix}-code-editor-content-opt`}>
      <span
        onClick={() => openOptModal('previewEdit')}
      >
        <FormatMessage id='database.templateEditOpt.previewEdit'/>
      </span>
      <span
        onClick={() => openOptModal('getTemplateByDefaultOrRemote')}
      >
        <FormatMessage id='database.templateEditOpt.getTemplateByDefaultOrRemote'/>
      </span>
    </div>
    <div>
      <CodeEditor value={codeData} onChange={codeChange} {...restProps}/>
    </div>
  </div>;
};
