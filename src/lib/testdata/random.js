// Deterministic random numbers for test data generation.
// mulberry32 over a 32 bit state: the same seed gives the same sequence on every
// platform and run. A stream is identified by a key (seed + fork labels), its state
// comes from hashing that key, so a fork never depends on how much the parent or
// any sibling stream has been used.

const TWO_32 = 4294967296;

// FNV-1a over UTF-16 code units, followed by a murmur3 style avalanche
export const hashString = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
};

const createStream = (key) => {
  let state = hashString(key);
  // unsigned 32 bit integer
  const next32 = () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  const next = () => next32() / TWO_32;
  // 53 bit resolution, only needed for ranges wider than 2^32
  const next53 = () => ((next32() >>> 5) * 67108864 + (next32() >>> 6)) / 9007199254740992;
  const int = (min, max) => {
    let lo = Math.ceil(Number(min));
    let hi = Math.floor(Number(max));
    if (!(lo <= hi)) {
      if (!(hi < lo)) {
        return 0; // NaN bounds
      }
      const swap = lo;
      lo = hi;
      hi = swap;
    }
    const range = hi - lo + 1;
    if (range <= TWO_32) {
      return lo + Math.floor(next() * range);
    }
    return Math.min(hi, lo + Math.floor(next53() * range));
  };
  const pick = (array) => {
    if (!array || array.length === 0) {
      return undefined;
    }
    return array[Math.floor(next() * array.length)];
  };
  const weightOf = (item) => {
    if (item === null || typeof item !== 'object' || item.weight === undefined
      || item.weight === null) {
      return 1;
    }
    const w = Number(item.weight);
    return w > 0 ? w : 0;
  };
  // returns one element of `items`; an element may carry `weight` (default 1)
  const weighted = (items) => {
    if (!items || items.length === 0) {
      return undefined;
    }
    let total = 0;
    for (let i = 0; i < items.length; i += 1) {
      total += weightOf(items[i]);
    }
    if (!(total > 0)) {
      return undefined;
    }
    let r = next() * total;
    let last;
    for (let i = 0; i < items.length; i += 1) {
      const w = weightOf(items[i]);
      if (w > 0) {
        last = items[i];
        if (r < w) {
          return last;
        }
        r -= w;
      }
    }
    return last;
  };
  // A number in [0,1) that depends only on the stream and `index`, not on how much of the
  // stream was used: columns that must agree within a row read the same index.
  const base = hashString(`${key}\u0001#at`);
  const at = (index) => {
    let h = base ^ Math.imul((index | 0) + 0x9E3779B9, 0x85EBCA6B);
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / TWO_32;
  };
  // \u0001 separates labels so that fork('a').fork('b') differs from fork('ab')
  const fork = label => createStream(`${key}\u0001${String(label)}`);
  return {
    next,
    int,
    pick,
    weighted,
    fork,
    at,
  };
};

export const createRandom = (seed) => {
  const n = Number(seed);
  return createStream(`seed:${Number.isFinite(n) ? n : 0}`);
};
