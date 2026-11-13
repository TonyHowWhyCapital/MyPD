import React, {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from 'react';
import ReactDom from 'react-dom';

import './style/index.less';
import {getPrefix} from '../../lib/prefixUtil';

const Tooltip = React.memo(forwardRef(({prefix, children, offsetLeft = 0, offsetTop = 0,
                                         title, visible = true, className = '', mouseEnterDelay,
                                         force, placement = 'bottom', conversion = 1, clickClose, propagation,
                                         compareName = ['clientWidth', 'scrollWidth']}, ref) => {
  const currentPrefix = getPrefix(prefix);
  // A hint of text waits for the pointer to rest, so passing over a list does not make
  // hints flash; a panel (a menu, a help sheet) opens at once as before.
  const restDelay = typeof title === 'string' ? 0.5 : 0;
  const enterDelay = mouseEnterDelay === undefined ? restDelay : mouseEnterDelay;
  const containerRef = useRef(null);
  const parentRef = useRef(null);
  const statusRef = useRef(null);
  const overStatusRef = useRef(null);
  const titleRef = useRef(null);
  const arrowRef = useRef(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  useImperativeHandle(ref, () => {
    return {
      setTooltipVisible,
    };
  }, []);
  const _onMouseOver = (e) => {
    const currentTarget = e.currentTarget;
    clearTimeout(overStatusRef.current);
    overStatusRef.current = setTimeout(() => {
      if ((currentTarget[compareName[0]] < currentTarget[compareName[1]] || force)
          && visible && title) {
        if (statusRef.current) {
          clearTimeout(statusRef.current);
        }
        parentRef.current = currentTarget;
        setTooltipVisible(true);
      }
    }, enterDelay * 1000);
    !propagation && e.stopPropagation();
  };
  const _onMouseLeave = (e) => {
    if (statusRef.current) {
      clearTimeout(statusRef.current);
    }
    if (overStatusRef.current) {
      clearTimeout(overStatusRef.current);
    }
    statusRef.current = setTimeout(() => {
      containerRef.current && setTooltipVisible(false);
    }, 100);
    !propagation && e.stopPropagation();
  };
  const onContainerMouseOver = () => {
    if (statusRef.current) {
      clearTimeout(statusRef.current);
    }
    setTooltipVisible(true);
  };
  useEffect(() => {
    if (tooltipVisible) {
      const rect = parentRef.current.getBoundingClientRect();
      containerRef.current.style.display = 'block';
      const containerRect = containerRef.current.getBoundingClientRect();
      if (placement === 'bottom') {
        containerRef.current.style.top = `${rect.bottom + 10 + offsetTop}px`;
        containerRef.current.style.left = `${rect.left + (rect.width / 2) - containerRef.current.clientWidth / 2 + offsetLeft}px`;
      } else if (placement === 'top') {
        containerRef.current.style.bottom = `${window.innerHeight - rect.top / conversion + 10 + offsetTop}px`;
        containerRef.current.style.left = `${rect.left / conversion + (rect.width / 2 / conversion) - containerRef.current.clientWidth / 2 + offsetLeft}px`;
      } else if (placement === 'topLeft') {
        titleRef.current.style.maxHeight = `${rect.top - 20}px`;
        titleRef.current.style.maxWidth = `${window.innerWidth - 20}px`;
        containerRef.current.style.bottom = `${window.innerHeight - rect.top + 10 + offsetTop}px`;
        let right = window.innerWidth - rect.x - (rect.width / 2);
        if ((right + containerRect.width) >= window.innerWidth) {
          arrowRef.current.style.right = `${right}px`;
          right = 5;
        }
        containerRef.current.style.right = `${right}px`;
      } else if (placement === 'left') {
        containerRef.current.style.top = `${rect.y + rect.height / 2 - containerRef.current.clientHeight / 2}px`;
        containerRef.current.style.right = `${window.innerWidth - rect.x + 8}px`;
      }
    }
  }, [tooltipVisible]);
  const Compose = useCallback(() => {
    useEffect(() => {
      return () => {
        setTooltipVisible(false);
      };
    }, []);
    return React.cloneElement(children, {
      onMouseOver: _onMouseOver,
      onMouseLeave: _onMouseLeave,
      onClick: (e) => {
        if (clickClose) {
          setTooltipVisible(false);
        }
        children.props?.onClick?.(e);
      },
    });
  }, [children]);
  return [<Compose key='parent'/>,
  tooltipVisible && visible && ReactDom.createPortal(<div
    className={`${currentPrefix}-tooltip-container`}
    onMouseOver={onContainerMouseOver}
    onMouseLeave={_onMouseLeave}
  >
    <div className={`${currentPrefix}-tooltip-content ${typeof title === 'string' ? `${currentPrefix}-tooltip-content-text` : ''} ${className}`} ref={containerRef}>
      <div ref={titleRef}>{title}</div>
      <div ref={arrowRef} className={`${currentPrefix}-tooltip-content-arrow-${placement}`}>{}</div>
    </div>
  </div>, document.body),
  ];
}));

export default Tooltip;
