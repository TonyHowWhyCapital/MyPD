import { useEffect, useRef } from 'react';
import { Modal, FormatMessage } from 'components';

const text = (id, data) => FormatMessage.string({ id: `guard.${id}`, data });

// Asks before something is deleted or overwritten; `name` says what.
export const confirmThen = (kind, name, proceed) => Modal.confirm({
  title: text(`${kind}Title`),
  message: name ? text(`${kind}Message`, { name }) : text(`${kind}Unnamed`),
  onOk: proceed,
});

// For a tool that edits a draft: `leave(proceed)` runs `proceed` at once when nothing is
// unsaved and asks first otherwise. Closing the tool goes through the same question.
export const useLeaveGuard = (dirty, name, onCloseGuard) => {
  const leave = (proceed) => {
    if (!dirty) {
      proceed();
      return;
    }
    confirmThen('discard', name, proceed);
  };
  const ref = useRef(leave);
  ref.current = leave;
  useEffect(() => {
    onCloseGuard && onCloseGuard(proceed => ref.current(proceed));
  }, []);
  return leave;
};
