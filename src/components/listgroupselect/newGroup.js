import React from 'react';
import {Button, FormatMessage, Input, Modal, openModal} from 'components';

export const NEW_GROUP = '__new_group__';

const text = id => FormatMessage.string({id});

// why a new group cannot be created with this code, '' when it can
export const groupKeyProblem = (defKey, groups) => {
  const key = `${defKey || ''}`.trim();
  if (!key) {
    return 'required';
  }
  return (groups || []).some(g => `${g.defKey || ''}`.toLowerCase() === key.toLowerCase())
    ? 'duplicate' : '';
};

// groups created in the list, in the shape the project stores them
export const pickNewGroups = (groups) => {
  return (groups || []).filter(g => g.isNew).map(g => ({
    id: g.id,
    defKey: g.defKey,
    defName: g.defName,
    refEntities: [],
    refViews: [],
    refDiagrams: [],
    refDicts: [],
  }));
};

// Asks for the code and name of a new group; onCreated gets the group once confirmed.
export const openNewGroup = ({groups, onCreated}) => {
  let modal;
  const draft = {defKey: '', defName: ''};
  const onOk = () => {
    const problem = groupKeyProblem(draft.defKey, groups);
    if (problem) {
      Modal.error({title: text('optFail'), message: text(`groupNew.${problem}`)});
      return;
    }
    const defKey = draft.defKey.trim();
    modal.close();
    onCreated({
      id: Math.uuid(), defKey, defName: draft.defName.trim() || defKey, fields: [], isNew: true,
    });
  };
  const row = {display: 'flex', alignItems: 'center', margin: '8px 10px'};
  const label = {width: 90, textAlign: 'right', paddingRight: 8, flexShrink: 0};
  modal = openModal(<div style={{minWidth: 360}}>
    <div style={row}>
      <span style={label}>{text('tableBase.defKey')}</span>
      <Input autoFocus onChange={(e) => { draft.defKey = e.target.value; }}/>
    </div>
    <div style={row}>
      <span style={label}>{text('tableBase.defName')}</span>
      <Input onChange={(e) => { draft.defName = e.target.value; }}/>
    </div>
  </div>, {
    title: text('groupNew.title'),
    buttons: [
      <Button key='ok' type='primary' onClick={onOk}><FormatMessage id='button.ok'/></Button>,
      <Button key='cancel' onClick={() => modal.close()}><FormatMessage id='button.cancel'/></Button>,
    ],
  });
};
