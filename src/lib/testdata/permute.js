// A seeded one-to-one mapping of 0..size-1 onto itself: row i of a table takes value
// number permute(i) of the values of its rule, so no value comes twice and all of them are
// used when the table has as many rows as there are values. Nothing is kept per row.

const SMALL = 4096;
const ROUNDS = 6;

const mix = (x, key) => {
  let h = Math.imul(x ^ key, 0x9E3779B1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85EBCA6B);
  h ^= h >>> 13;
  h = Math.imul(h, 0xC2B2AE35);
  return (h ^ (h >>> 16)) >>> 0;
};

// Fisher-Yates for small sets: every order is possible
const shuffled = (size, random) => {
  const list = new Uint32Array(size);
  for (let i = 0; i < size; i += 1) {
    list[i] = i;
  }
  for (let i = size - 1; i > 0; i -= 1) {
    const j = Math.floor(random.next() * (i + 1));
    const swap = list[i];
    list[i] = list[j];
    list[j] = swap;
  }
  return i => list[i];
};

// Feistel network over two halves of `half` bits each, walking on while the result lies
// outside 0..size-1 (the network covers less than four times the size, so that is short).
const feistel = (size, random) => {
  let bits = 2;
  while (2 ** bits < size) {
    bits += 1;
  }
  const half = Math.ceil(bits / 2);
  const span = 2 ** half;
  const shift = 32 - half;
  const keys = [];
  for (let r = 0; r < ROUNDS; r += 1) {
    keys.push(Math.floor(random.next() * 4294967296) | 0);
  }
  return (index) => {
    let value = index;
    do {
      let left = Math.floor(value / span);
      let right = value % span;
      for (let r = 0; r < ROUNDS; r += 1) {
        const next = left ^ (mix(right, keys[r]) >>> shift);
        left = right;
        right = next;
      }
      value = (left * span) + right;
    } while (value >= size);
    return value;
  };
};

// size: whole number from 0 to 2^53; random: a stream of ./random
export const createPermutation = (size, random) => {
  if (!(size > 1)) {
    return () => 0;
  }
  return size <= SMALL ? shuffled(size, random) : feistel(size, random);
};
