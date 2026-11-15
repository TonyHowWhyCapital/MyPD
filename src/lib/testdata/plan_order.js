// Ordering: tables so that parents come before their children, and the columns of one row
// so that a formula is worked out after the columns it reads.

// Stable topological order of the items 0..n-1; deps[i] lists the items that must come
// before item i. The lowest item that is ready always goes next, so the order only changes
// where it has to. When a cycle blocks the rest: `cycle` holds the items of one cycle
// (each depends on the next one) and `order` ends with the blocked items in their own order.
export const stableOrder = (n, deps) => {
  const placed = new Array(n).fill(false);
  const order = [];
  const ready = i => !placed[i] && (deps[i] || []).every(d => d === i || placed[d] || d >= n);
  let found = true;
  while (found) {
    found = false;
    for (let i = 0; i < n; i += 1) {
      if (ready(i)) {
        placed[i] = true;
        order.push(i);
        found = true;
        break;
      }
    }
  }
  if (order.length === n) {
    return {
      order,
      cycle: null,
    };
  }
  const walk = [];
  let at = placed.indexOf(false);
  while (!walk.includes(at)) {
    walk.push(at);
    at = (deps[at] || []).find(d => d !== at && d < n && !placed[d]);
  }
  return {
    order: order.concat(placed.map((p, i) => (p ? -1 : i)).filter(i => i >= 0)),
    cycle: walk.slice(walk.indexOf(at)),
  };
};

// Tables with their parents first. `edges` are {child, parent, nullable, ...} (indices into
// the list of tables). A cycle is cut at an edge whose columns may be NULL; when a cycle has
// no such edge it is cut at its first edge and reported in `stuck`.
export const orderTables = (n, edges) => {
  let live = edges.slice();
  const cut = [];
  const stuck = [];
  for (;;) {
    const deps = [];
    live.forEach((e) => {
      deps[e.child] = (deps[e.child] || []).concat(e.parent);
    });
    const { order, cycle } = stableOrder(n, deps);
    if (!cycle) {
      return {
        order,
        cut,
        stuck,
      };
    }
    const inCycle = cycle.map((child, i) => live
      .filter(e => e.child === child && e.parent === cycle[(i + 1) % cycle.length]));
    const flat = inCycle.reduce((a, b) => a.concat(b), []);
    // every edge between one pair of tables has to go, so the pair must be all nullable
    const loose = inCycle.find(list => list.every(e => e.nullable));
    const gone = loose || inCycle[0];
    if (!loose) {
      stuck.push(...flat.filter(e => gone.includes(e)));
    }
    cut.push(...gone);
    live = live.filter(e => !gone.includes(e));
  }
};

// Order in which the columns of a row are filled. deps[i] = indices of the columns that
// column i reads. Returns the order and, when formulas read each other in a circle, the
// indices of that circle.
export const orderColumns = (n, deps) => stableOrder(n, deps);
