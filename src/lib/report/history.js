// Undo and redo for the layout designer. A burst of changes of one kind, such as dragging
// a border or typing a name, counts as one step.
const BURST = 800;
const LIMIT = 100;

export const emptyHistory = () => ({ past: [], future: [], key: '', time: 0 });

// `state` is what was there before the change, `key` names the kind of change.
export const record = (history, state, key, now) => {
  if (key && key === history.key && now - history.time < BURST) {
    return { ...history, time: now, future: [] };
  }
  return { past: [...history.past, state].slice(-LIMIT), future: [], key, time: now };
};

// Both return null when there is nothing to step to.
export const undo = (history, current) => (history.past.length ? {
  state: history.past[history.past.length - 1],
  history: { ...emptyHistory(), past: history.past.slice(0, -1), future: [current, ...history.future] },
} : null);

export const redo = (history, current) => (history.future.length ? {
  state: history.future[0],
  history: { ...emptyHistory(), past: [...history.past, current], future: history.future.slice(1) },
} : null);
