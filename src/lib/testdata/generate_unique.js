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

// The text two values are compared by. Letters are compared without case and without
// accents and trailing blanks are ignored, the way the usual collations of SQL Server and
// MySQL do (a database that tells 'é' from 'e' only loses a few values by this). NULL and
// booleans have keys no text has: NULL is not the text 'null'.
const ACCENTED = /[\u00C0-\u024F\u0300-\u036F\u1E00-\u1EFF]/;

export const uniqueKey = (v) => {
  if (typeof v !== 'string') {
    if (v === null || v === undefined) {
      return '\u0000';
    }
    if (typeof v === 'boolean') {
      return v ? '\u0000t' : '\u0000f';
    }
    return `${v}`;
  }
  let text = v.charCodeAt(v.length - 1) === 32 ? v.replace(/ +$/, '') : v;
  if (ACCENTED.test(text)) {
    text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return text.toLowerCase();
};

// null when one of the values is NULL and NULLs count as different from each other
const keyText = (row, at, nullsDiffer) => {
  if (at.length === 1) {
    return nullsDiffer && row[at[0]] === null ? null : uniqueKey(row[at[0]]);
  }
  let text = '';
  for (let i = 0; i < at.length; i += 1) {
    if (nullsDiffer && row[at[i]] === null) {
      return null;
    }
    text += `${uniqueKey(row[at[i]])}\u0001`;
  }
  return text;
};

// sets: [[position of a column in the row, ...], ...]. options.nullsDiffer: a row with a
// NULL in a set never repeats another one (every database but SQL Server reads a unique
// index that way).
export const createUniqueTracker = (sets, expected, options = {}) => {
  const stores = sets.map(() => createHashSet(expected));
  const keys = new Array(sets.length);
  const nullsDiffer = !!options.nullsDiffer;
  return {
    sets,
    // indices of the sets the row collides with; remembers the keys for accept()
    violated: (row) => {
      let list = null;
      for (let i = 0; i < sets.length; i += 1) {
        keys[i] = keyText(row, sets[i], nullsDiffer);
        if (keys[i] !== null && stores[i].has(keys[i])) {
          list = list || [];
          list.push(i);
        }
      }
      return list;
    },
    // call right after violated() returned null for the same row
    accept: () => {
      for (let i = 0; i < sets.length; i += 1) {
        if (keys[i] !== null) {
          stores[i].add(keys[i]);
        }
      }
    },
  };
};
