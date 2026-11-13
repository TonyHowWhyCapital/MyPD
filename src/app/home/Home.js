import React, { useState } from 'react';
import _ from 'lodash/object';

import {Icon, Modal, openModal, Button, FormatMessage, SearchInput, Tooltip } from 'components';
// eslint-disable-next-line import/extensions,import/named

// eslint-disable-next-line import/named
import { platform, getUiState, setUiState } from '../../lib/middle';
import ProjectEdit from '../container/projectedit';
import ProjectList from './ProjectList';
import './style/layout.less';
import {getPrefix} from '../../lib/prefixUtil';
import { version } from '../../../package';

import template from '../../lib/template';
import {READING} from '../../lib/variable';


export default React.memo(({prefix, importProject, createProject, openTemplate,
                             renameProject, updateHistory, deleteProject, lang, config}) => {
  const currentPrefix = getPrefix(prefix);
  const [searchValue, setSearchValue] = useState('');
  // which of the two lists the page shows
  const [section, setSection] = useState('recent');
  // 卡片或清单，记在本机
  const [view, setView] = useState(() => (getUiState('homeView') === 'list' ? 'list' : 'card'));
  const changeView = (next) => {
    setUiState('homeView', next);
    setView(next);
  };
  const proInfo = (h) => {
    Modal.info({
      title: FormatMessage.string({id: 'home.proInfo'}),
      message: <ProjectEdit data={h} reading lang={lang}/>,
      contentStyle: {
        height: '60vh',
        overflow: 'auto',
      },
    });
  };
  const _createProject = (projectData) => {
    let modal = null;
    let newDataSource = {};
    let oldData = {};
    const onOk = () => {
      if (!newDataSource.name || (!newDataSource.path && platform === 'json')) {
        Modal.error({
          title: FormatMessage.string({id: 'optFail'}),
          message: FormatMessage.string({id: 'formValidateMessage'}),
        });
      } else {
        if (projectData && Object.keys(oldData).length > 0){
          renameProject(newDataSource, oldData, projectData);
        } else {
          if (!newDataSource.describe){
            newDataSource.describe = newDataSource.name;
          }
          const group = `${newDataSource.firstGroup || ''}`.trim();
          createProject({
            ..._.omit(newDataSource, ['path', 'firstGroup']),
            viewGroups: group ? [{
              id: Math.uuid(),
              defKey: group,
              defName: group,
              refEntities: [],
              refViews: [],
              refDiagrams: [],
              refDicts: [],
              refLogicEntities: [],
            }] : [],
          }, newDataSource.path);
        }
        modal && modal.close();
      }
    };
    const onCancel = () => {
      modal && modal.close();
    };
    const onChange = (project) => {
      newDataSource = project;
    };
    const dataFinish = (data) => {
      if (data) {
        newDataSource = data;
        oldData = data;
      } else {
        modal && modal.close();
      }
    };
    modal = openModal(<ProjectEdit
      data={projectData}
      lang={lang}
      onChange={onChange}
      dataFinish={dataFinish}
    />, {
      title: projectData?.name ? FormatMessage.string({id: 'home.editProject'})
        : FormatMessage.string({id: 'home.createProject'}),
      buttons: [<Button type='primary' key='ok' onClick={onOk}>
        <FormatMessage id='button.ok'/>
      </Button>,
        <Button key='onCancel' onClick={onCancel}>
          <FormatMessage id='button.cancel'/>
        </Button>],
    });
  };
  const proConfig = (h) => {
    _createProject(h);
  };
  const removeHistory = (h) => {
    updateHistory('remove', h);
  };
  const removeProject = (h) => {
    Modal.confirm({
      title: FormatMessage.string({id: 'deleteConfirmTitle'}),
      message: FormatMessage.string({id: 'deleteFromDiskConfirm'}),
      lang,
      onOk:() => {
        deleteProject(h);
      },
    });
  };
  const openTemplateClick = (data, t) => {
    openTemplate(data, t);
  };
  const onProjectClick = (h) => {
    importProject(h.path);
  };
  const _menuClick = (m, p) => {
    if (m.key === 'removeHistory') {
      removeHistory(p);
    } else if(m.key === 'openReading') {
      importProject(p.path, READING);
    } else {
      removeProject(p);
    }
  };
  const onMouseOver = (e) => {
    const target = e.currentTarget;
    const child = target.children[1];
    child.style.display = 'block';
  };
  const onMouseLeave = (e) => {
    const target = e.currentTarget;
    target.children[1].style.display = 'none';
  };
  const onChange = (e) => {
    setSearchValue(e.target.value);
  };
  const Tool = ({p}) => {
    const dropDownMenus = [
      {key: 'openReading', name: FormatMessage.string({id: 'home.openReading'})},
      {key: 'removeHistory', name: FormatMessage.string({id: 'home.removeHistory'})},
      {key: 'removeProject', name: FormatMessage.string({id: 'home.removeProject'})},
    ];
    return  <div className={`${currentPrefix}-home-container-body-right-list-tab-item-tool`}>
      <span><Icon type='icon-xinxi' onClick={() => proInfo(p)}/></span>
      <span><Icon type='edit.svg' onClick={() => proConfig(p)}/></span>
      <span
        onMouseOver={onMouseOver}
        onMouseLeave={onMouseLeave}
      >
        <span
        >
          <Icon
            type='more.svg'
          />
        </span>
        <span>
          {
              dropDownMenus.map((m) => {
                return <div key={m.key} onClick={() => _menuClick(m, p)}>{m.name}</div>;
              })
            }
        </span>
      </span>
    </div>;
  };
  const reg = new RegExp((searchValue || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
  const histories = config?.data[0]?.projectHistories || [];
  const matches = p => reg.test(p.describe || '') || reg.test(p.name || '') || reg.test(p.path || '');
  const templates = Object.keys(template).map(key => ({ ...template[key], key }))
    .filter(p => reg.test(p.describe || '') || reg.test(p.name || ''));
  const recent = histories.filter(matches);
  const sections = [
    { key: 'recent', icon: 'fa-clock-o', title: 'home.recently', count: recent.length },
    { key: 'template', icon: 'fa-clone', title: 'home.exampleProject', count: templates.length },
  ];
  const card = (p, onClick) => <div
    key={p.path || p.key}
    onClick={onClick}
    className={`${currentPrefix}-home-container-body-right-list-tab-item`}
  >
    <div className={`${currentPrefix}-home-container-body-right-list-tab-item-title`}>
      {p.name}
    </div>
    <div className={`${currentPrefix}-home-container-body-right-list-tab-item-body`}>
      <div className={`${currentPrefix}-home-container-body-right-list-tab-item-body-icon`}>
        {p.avatar ? <img src={p.avatar} alt='avatar'/> : <Icon type='fa-file'/>}
      </div>
      <div className={`${currentPrefix}-home-container-body-right-list-tab-item-body-desc`}>
        {p.describe}
      </div>
    </div>
  </div>;
  const cards = list => <div className={`${currentPrefix}-home-main-cards`}>{list}</div>;
  const empty = <div className={`${currentPrefix}-home-list-empty`}><FormatMessage id='home.listEmpty'/></div>;
  const recentBody = () => {
    if (view === 'list') {
      return <ProjectList
        cls={`${currentPrefix}-home-list`}
        projects={recent}
        onOpen={onProjectClick}
        onInfo={proInfo}
        onEdit={proConfig}
        onReadOnly={p => importProject(p.path, READING)}
        onForget={removeHistory}
        onDelete={removeProject}
      />;
    }
    return recent.length === 0 ? empty : cards(recent.map(p => <Tooltip
      offsetLeft={-18}
      offsetTop={-2}
      force
      title={<Tool p={p}/>}
      placement='top'
      key={p.path}
      className={`${currentPrefix}-home-container-body-right-list-tab-item-tooltip`}
    >{card(p, () => onProjectClick(p))}</Tooltip>));
  };
  const templateBody = () => {
    if (templates.length === 0) {
      return empty;
    }
    if (view === 'card') {
      return cards(templates.map(p => card(p, () => openTemplateClick(p, p.key))));
    }
    return <table className={`${currentPrefix}-home-list ${currentPrefix}-home-list-templates`}>
      <thead>
        <tr>
          <th><FormatMessage id='home.colName'/></th>
          <th><FormatMessage id='home.colDescribe'/></th>
        </tr>
      </thead>
      <tbody>
        {templates.map(p => <tr key={p.key} onDoubleClick={() => openTemplateClick(p, p.key)}>
          <td className='name' onClick={() => openTemplateClick(p, p.key)}>
            {p.avatar ? <img src={p.avatar} alt=''/> : <Icon type='fa-file-o'/>}
            <span>{p.name}</span>
          </td>
          <td className='describe' title={p.describe}>{p.describe}</td>
        </tr>)}
      </tbody>
    </table>;
  };
  return <div className={`${currentPrefix}-home-container`}>
    <div className={`${currentPrefix}-home-container-body`}>
      <div className={`${currentPrefix}-home-side`}>
        <div className={`${currentPrefix}-home-side-brand`}>
          <div className={`${currentPrefix}-home-container-body-left-logo-icon`}>{}</div>
          <div>
            <b><FormatMessage id='system.title'/></b>
            <span>v{version}</span>
          </div>
        </div>
        <Button type='primary' onClick={() => _createProject()}>
          <Icon type='fa-plus'/> <FormatMessage id='home.createProject'/>
        </Button>
        <Button onClick={() => importProject()}>
          <Icon type='fa-folder-open-o'/> <FormatMessage id='toolbar.open'/>
        </Button>
        <div className={`${currentPrefix}-home-side-nav`}>
          {sections.map(s => <div
            key={s.key}
            className={section === s.key ? 'active' : ''}
            onClick={() => setSection(s.key)}
          >
            <Icon type={s.icon}/>
            <span><FormatMessage id={s.title}/></span>
            <em>{s.count}</em>
          </div>)}
        </div>
      </div>
      <div className={`${currentPrefix}-home-main`}>
        <div className={`${currentPrefix}-home-main-head`}>
          <div className={`${currentPrefix}-home-main-title`}>
            <FormatMessage id={sections.find(s => s.key === section).title}/>
          </div>
          <div className={`${currentPrefix}-home-main-search`}>
            <SearchInput placeholder={FormatMessage.string({id: 'home.search'})} onChange={onChange}/>
          </div>
          <div className={`${currentPrefix}-home-list-views`}>
            {['card', 'list'].map(v => <a
              key={v}
              className={view === v ? 'active' : ''}
              title={FormatMessage.string({id: `home.view.${v}`})}
              onClick={() => changeView(v)}
            ><Icon type={v === 'card' ? 'fa-th-large' : 'fa-list'}/></a>)}
          </div>
        </div>
        <div className={`${currentPrefix}-home-main-body`}>
          {section === 'recent' ? recentBody() : templateBody()}
        </div>
      </div>
    </div>
  </div>;
});
