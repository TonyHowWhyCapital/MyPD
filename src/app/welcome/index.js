import React, { useState, useEffect } from 'react';
import { connect } from 'react-redux';

import { Modal } from 'components';
import { fail, success, pageType, CONFIG } from '../../lib/variable';
import {
  getUserConfigData,
  removeHistory,
  saveUserConfigSome,
} from '../../actions/config';
import Home from '../home';
import {setMemoryCache} from '../../lib/cache';
import {
  openProject,
  updateProject,
  closeProject,
  createProject,
  renameProject,
  removeProject,
  saveProject,
  autoSaveProject,
  openDemoProject,
} from '../../actions/core';
import { openLoading, closeLoading } from '../../actions/common';
import {ConfigContent} from '../../lib/context';

// Reads the user's settings and goes straight to the home page, nothing is shown meanwhile.
const Welcome = React.memo(({ prefix, getUserData, config, ...restProps }) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    getUserData();
  }, []);
  useEffect(() => {
    if (config.result === success) {
      setMemoryCache(CONFIG, config);
      setReady(true);
    } else if (config.result === fail) {
      Modal.error({title: config?.data.toString()});
    }
  }, [config.result]);
  if (!ready) {
    return null;
  }
  return <ConfigContent.Provider value={config}>
    <Home config={config} {...restProps}/>
  </ConfigContent.Provider>;
});

const mapStateToProps = (state) => {
  return {
    projectInfo: state.core.info,
    dataSource: state.core.data,
    config: state.config,
    common: state.common,
    mode: state.core.mode,
  };
};
const mapDispatchToProps = (dispatch) => {
  return {
    getUserData: (title) => {
      dispatch(getUserConfigData(title));
    },
    saveUserData: (data) => {
      dispatch(saveUserConfigSome(data));
    },
    openTemplate: (h, t, title) => {
      dispatch(openDemoProject(h, t, title, pageType[2]));
    },
    open: (title, path, suffix, isDemoProject, mode) => {
      dispatch(openProject(title, pageType[2], path, suffix, isDemoProject, mode));
    },
    close: () => {
      dispatch(closeProject(pageType[1]));
    },
    update: (data) => {
      dispatch(updateProject(data));
    },
    rename: (newData, oldData, title, dataInfo) => {
      dispatch(renameProject(newData, oldData, title, dataInfo));
    },
    delete: (data, title) => {
      dispatch(removeProject(data, title));
    },
    save: (data, title, saveAs, callback) => {
      dispatch(saveProject(data, title, saveAs, callback));
    },
    autoSave: (data) => {
      // 静悄悄保存 无需任何提示
      dispatch(autoSaveProject(data));
    },
    create: (data, path, title) => {
      dispatch(createProject(data, path, title, pageType[2]));
    },
    openLoading: (title) => {
      dispatch(openLoading(title));
    },
    closeLoading: () => {
      dispatch(closeLoading());
    },
    updateHistory: (opt, ...data) => {
      switch (opt) {
        case 'remove': dispatch(removeHistory(...data));break;
        default: break;
      }
    },
  };
};

export default connect(mapStateToProps, mapDispatchToProps)(Welcome);
