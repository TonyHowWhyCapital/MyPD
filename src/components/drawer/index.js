import React, { useEffect, useRef, useState } from 'react';
import ReactDom from 'react-dom';
import {getPrefix} from '../../lib/prefixUtil';
import Icon from '../icon';

import './style/index.less';
import {ConfigContent} from '../../lib/context';
import {getMemoryCache} from '../../lib/cache';
import {CONFIG} from '../../lib/variable';
import {getUiState, setUiState} from '../../lib/middle';

const MIN_WIDTH = 480;

export const Drawer = React.memo(({prefix, title, onClose, children, width,
                                    bodyStyle, buttons, maskClosable, placement, sizeKey}) => {
  const currentPrefix = getPrefix(prefix);
  // The width is kept as a share of the window, so it follows the size of the screen.
  const [size, setSize] = useState(() => (sizeKey && getUiState(sizeKey)) || width);
  const startResize = (down) => {
    down.preventDefault();
    let share = size;
    const move = (e) => {
      const px = placement === 'left' ? e.clientX : window.innerWidth - e.clientX;
      const wide = Math.min(window.innerWidth, Math.max(MIN_WIDTH, px));
      share = `${Math.round((wide / window.innerWidth) * 1000) / 10}%`;
      setSize(share);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      sizeKey && setUiState(sizeKey, share);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  const fitOrRestore = () => {
    const share = size === '100%' ? width : '100%';
    setSize(share);
    sizeKey && setUiState(sizeKey, share);
  };
  const ref = useRef(null);
  const containerRef = useRef(null);
  const updateStyle = () => {
    onClose && onClose();
  };
  const _iconClose = () => {
    updateStyle();
  };
  useEffect(() => {
    containerRef.current.style.transform = 'translateX(0)';
  }, []);
  useEffect(() => {
    const { current } = ref;
    current && current.focus();
  });
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      // 按了键盘的返回键
      updateStyle();
    }
  };
  const onClick = (e) => {
    if (containerRef.current &&
        e.target.compareDocumentPosition(containerRef.current) === 20 && maskClosable) {
      updateStyle();
    }
  };
  const style = {};
  if (placement === 'left') {
    style.left = 0;
    style.transform = 'translateX(-100%)';
  } else {
    style.right = 0;
    style.transform = 'translateX(100%)';
  }
  return (
    <div
      className={`${currentPrefix}-drawer`}
      tabIndex='1'
      onKeyDown={onKeyDown}
      ref={ref}
      onClick={onClick}
      >
      <div
        style={{width: size, ...style}}
        ref={containerRef}
        className={`${currentPrefix}-drawer-container`}
        >
        <div
          className={`${currentPrefix}-drawer-header`}
          >
          <div className={`${currentPrefix}-drawer-header-title`}>{title}</div>
          <Icon className={`${currentPrefix}-drawer-header-icon`} type='fa-times' onClick={_iconClose}/>
        </div>
        <div
          style={{height: `calc(100% - ${buttons ? 64 : 32}px)`, ...bodyStyle}}
          className={`${currentPrefix}-drawer-content`}
          >
          {children}
        </div>
        {
          buttons && <div className={`${currentPrefix}-drawer-button-${placement}`}>{buttons}</div>
        }
        <div
          className={`${currentPrefix}-drawer-resize ${currentPrefix}-drawer-resize-${placement}`}
          onMouseDown={startResize}
          onDoubleClick={fitOrRestore}
        />
      </div>
    </div>
  );
});

export const openDrawer = (com, params) => {
  const dom = document.createElement('div');
  document.body.appendChild(dom);
  const close = () => {
    const { beforeClose } = params;
    const remove = () => {
      const result = ReactDom.unmountComponentAtNode(dom);
      if (result) {
        dom.parentElement.removeChild(dom);
      }
    };
    if (beforeClose && typeof beforeClose === 'function') {
      const result = beforeClose();
      if (result.then) {
        result.then(() => {
          remove();
        });
      } else {
        result && remove();
      }
    } else {
      remove();
    }
  };
  const DrawerCompose = () => {
    const { title, width, bodyStyle, buttons, maskClosable = true, placement = 'left', sizeKey } = params;
    const _iconClose = () => {
      const { onClose } = params;
      onClose && onClose();
      close();
    };
    return (
      <ConfigContent.Provider value={getMemoryCache(CONFIG)}>
        <Drawer
          placement={placement}
          buttons={buttons}
          title={title}
          width={width}
          sizeKey={sizeKey}
          maskClosable={maskClosable}
          bodyStyle={bodyStyle}
          onClose={_iconClose}
          >
          {com}
        </Drawer>
      </ConfigContent.Provider>
    );
  };
  ReactDom.render(<DrawerCompose/>, dom);
  return {
    close,
  };
};
