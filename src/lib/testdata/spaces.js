// Value spaces: every value a rule can give for a column, numbered 0..size-1, so that
// unique values are drawn without repeating one (see permute.js) instead of drawn at
// random and checked. A space is { size, at(index, random) -> value, ordered }:
// - no two indexes give values the database could take for equal (see uniqueKey);
// - `ordered` spaces are walked in their own order (counters, lists that cycle);
// - `random` only chooses between spellings of the same value (upper or lower case).
import { uniqueKey } from './generate_unique';

// the permutation works on whole numbers below 2^52
export const MAX_SPACE = 2 ** 52;

export const rangeSpace = (lo, hi, value, ordered) => ({
  size: hi >= lo ? hi - lo + 1 : 0,
  at: i => value(lo + i),
  ordered: !!ordered,
});

// values that are equal for the database are kept once
export const listSpace = (values, ordered) => {
  const seen = new Set();
  const list = [];
  values.forEach((v) => {
    const key = uniqueKey(v);
    if (v !== null && v !== undefined && !seen.has(key)) {
      seen.add(key);
      list.push(v);
    }
  });
  return {
    size: list.length,
    at: i => list[i],
    ordered: !!ordered,
  };
};

// characters that differ only by case are one choice: 'aA' -> [['a', 'A']]
const fold = (chars) => {
  const groups = [];
  const at = {};
  Array.from(chars).forEach((ch) => {
    const key = uniqueKey(ch);
    if (at[key] === undefined) {
      at[key] = groups.length;
      groups.push([ch]);
    } else if (!groups[at[key]].includes(ch)) {
      groups[at[key]].push(ch);
    }
  });
  return groups;
};

// Text of a fixed shape. slots: [{text} literal | {chars} one character of the set]
export const slotsSpace = (slots) => {
  const parts = slots.map(s => (s.chars === undefined ? s : { groups: fold(s.chars) }));
  const size = parts.reduce((n, p) => (p.groups ? n * p.groups.length : n), 1);
  const count = parts.length;
  return {
    size,
    at: (index, random) => {
      let rest = index;
      let text = '';
      for (let k = 0; k < count; k += 1) {
        const { groups } = parts[k];
        if (groups) {
          const radix = groups.length;
          let group;
          if (rest < 2147483648) {
            // whole number arithmetic: much faster than the remainder of a double
            const whole = rest | 0;
            rest = (whole / radix) | 0;
            group = groups[whole - (rest * radix)];
          } else {
            group = groups[rest % radix];
            rest = Math.floor(rest / radix);
          }
          text += group.length === 1 || !random ? group[0]
            : group[Math.floor(random.next() * group.length)];
        } else {
          text += parts[k].text;
        }
      }
      return text;
    },
    ordered: false,
  };
};

// several spaces that share no value, one after the other
export const joinSpaces = (spaces) => {
  if (spaces.length === 1) {
    return spaces[0];
  }
  const size = spaces.reduce((n, s) => n + s.size, 0);
  return {
    size,
    at: (index, random) => {
      let rest = index;
      for (let k = 0; k < spaces.length; k += 1) {
        if (rest < spaces[k].size) {
          return spaces[k].at(rest, random);
        }
        rest -= spaces[k].size;
      }
      return undefined;
    },
    ordered: false,
  };
};

// texts of min..max characters of one set
export const textSpace = (chars, min, max) => {
  const spaces = [];
  for (let length = min; length <= max; length += 1) {
    spaces.push(slotsSpace(new Array(length).fill({ chars })));
  }
  return joinSpaces(spaces);
};

// a space the permutation can walk, else null (too large or not known)
export const usable = space => (space && space.size >= 1 && space.size <= MAX_SPACE
  ? space : null);
