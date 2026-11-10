import React from 'react';
import { Button, FormatMessage, Modal, openModal } from 'components';
import Domain from '../../app/container/domain';
import { commitDomain, domainKeyProblem, draftDomainFromColumn } from '../../lib/model_edit_util';

export const NEW_DOMAIN = '__new_domain__';

// Opens the domain form pre-filled from the column. On confirm the domain is
// added to the project and handed to `onCreated` so the column can use it.
export const openNewDomain = ({ field, getDataSource, updateDataSource, onCreated }) => {
  const dataSource = getDataSource();
  const { domain: draft, mapping } = draftDomainFromColumn(dataSource, field);
  // The form lists the proposed type mapping too, so the column type is selectable.
  const formDataSource = mapping ? commitDomain(dataSource, draft, mapping) : dataSource;
  const data = { ...draft };
  let modal = null;
  const onOk = () => {
    const current = getDataSource();
    const problem = domainKeyProblem(current, data.defKey);
    if (problem) {
      Modal.error({
        title: FormatMessage.string({ id: 'optFail' }),
        message: FormatMessage.string({ id: `modelEdit.domainKey.${problem}` }),
      });
      return;
    }
    const domain = { ...data, defKey: `${data.defKey}`.trim() };
    updateDataSource(commitDomain(current, domain, mapping));
    modal.close();
    onCreated(domain);
  };
  modal = openModal(<Domain
    dataSource={formDataSource}
    data={draft}
    dataChange={(value, name) => {
      data[name] = value;
    }}
  />, {
    title: FormatMessage.string({ id: 'menus.add.newDomain' }),
    focusFirst: true,
    buttons: [
      <Button key='ok' type='primary' onClick={onOk}><FormatMessage id='button.ok'/></Button>,
      <Button key='cancel' onClick={() => modal.close()}><FormatMessage id='button.cancel'/></Button>,
    ],
  });
};
