// Remembers which values (or tuples of values) a table already holds, so that keys and
// unique indexes stay unique. Only two 32 bit hashes are kept per value: a million rows
// cost about 16 MB whatever the length of the values. Two different values with the same
// 64 bit hash are taken for equal, which only costs one more try.

const hashPair = (text) => {
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = (Math.imul(b, 33) + c) | 0;
  }
  a ^= a >>> 15;
  a = Math.imul(a, 2246822507);
  b ^= b >>> 13;
  b = Math.imul(b, 3266489909);
  return [(a ^ (b >>> 16)) >>> 0, (b ^ (a >>> 16)) >>> 0];
};

export const createHashSet = (expected = 1024) => {
  let size = 1024;
  while (size < expected * 2) {
    size *= 2;
  }
  let hi = new Uint32Array(size);
  let lo = new Uint32Array(size);
  let used = new Uint8Array(size);
  let count = 0;
  const slot = (a, b) => {
    let at = (a ^ Math.imul(b, 40503)) & (size - 1);
    while (used[at] && (hi[at] !== a || lo[at] !== b)) {
      at = (at + 1) & (size - 1);
    }
    return at;
  };
  const put = (a, b) => {
    const at = slot(a, b);
    if (!used[at]) {
      used[at] = 1;
      hi[at] = a;
      lo[at] = b;
      count += 1;
    }
  };
  const grow = () => {
    const old = [hi, lo, used, size];
    size *= 2;
    hi = new Uint32Array(size);
    lo = new Uint32Array(size);
    used = new Uint8Array(size);
    count = 0;
    for (let i = 0; i < old[3]; i += 1) {
      if (old[2][i]) {
        put(old[0][i], old[1][i]);
      }
    }
  };
  return {
    has: (text) => {
      const [a, b] = hashPair(text);
      return used[slot(a, b)] === 1;
    },
    add: (text) => {
      if (count * 2 >= size) {
        grow();
      }
      const [a, b] = hashPair(text);
      put(a, b);
    },
    size: () => count,
  };
};

// Text of the values of a row at the given positions. Letters are compared without case
// and trailing blanks ignored, the way the usual collations of SQL Server and MySQL do.
const plain = (v) => {
  if (typeof v !== 'string') {
    return `${v}`;
  }
  return (v.charCodeAt(v.length - 1) === 32 ? v.replace(/ +$/, '') : v).toLowerCase();
};

const keyText = (row, at) => {
  if (at.length === 1) {
    return plain(row[at[0]]);
  }
  let text = '';
  for (let i = 0; i < at.length; i += 1) {
    text += `${plain(row[at[i]])}\u0001`;
  }
  return text;
};

// sets: [[position of a column in the row, ...], ...]
export const createUniqueTracker = (sets, expected) => {
  const stores = sets.map(() => createHashSet(expected));
  const keys = new Array(sets.length);
  return {
    sets,
    // indices of the sets the row collides with; remembers the keys for accept()
    violated: (row) => {
      let list = null;
      for (let i = 0; i < sets.length; i += 1) {
        keys[i] = keyText(row, sets[i]);
        if (stores[i].has(keys[i])) {
          list = list || [];
          list.push(i);
        }
      }
      return list;
    },
    // call right after violated() returned null for the same row
    accept: () => {
      for (let i = 0; i < sets.length; i += 1) {
        stores[i].add(keys[i]);
      }
    },
  };
};
