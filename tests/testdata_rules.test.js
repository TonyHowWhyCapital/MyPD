import { createRandom, hashString } from '../src/lib/testdata/random';
import { BUILTINS, TW_CITIES, builtinGenerator } from '../src/lib/testdata/builtin';
import { BUILTIN_NAMES } from '../src/lib/testdata/model';
import {
  TW_SURNAMES, TW_GIVEN_CHARS, TW_ROADS, ZH_CHARS,
} from '../src/lib/testdata/builtin_data';

const take = (fn, n) => {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(fn(i));
  return out;
};

describe('createRandom', () => {
  test('same seed, same sequence; known first values stay stable', () => {
    const a = createRandom(1);
    const b = createRandom(1);
    const first = take(() => a.next(), 50);
    expect(take(() => b.next(), 50)).toEqual(first);
    expect(first.every(v => v >= 0 && v < 1)).toBe(true);
    expect(new Set(first).size).toBe(50);
    // pins the algorithm: a change here changes every generated data set
    expect(hashString('seed:1')).toBe(3541216320);
    const pinned = createRandom(12345);
    expect(take(() => pinned.int(0, 999999), 3)).toEqual([27399, 24644, 791282]);
    const fork = createRandom(12345).fork('col');
    expect(take(() => fork.int(0, 999999), 2)).toEqual([54215, 322940]);
  });

  test('different seeds differ, odd seeds are accepted', () => {
    const of = seed => take(() => 0, 1).map(() => createRandom(seed).next())[0];
    expect(of(1)).not.toBe(of(2));
    expect(of(0)).not.toBe(of(1));
    expect(of(-1)).not.toBe(of(1));
    expect(of(1.5)).not.toBe(of(1));
    expect(of(NaN)).toBe(of(0));
    expect(of(undefined)).toBe(of(0));
    expect(of('7')).toBe(of(7));
    expect(of(2 ** 40)).not.toBe(of(0));
  });

  test('int is inclusive, uniform enough, and survives odd bounds', () => {
    const random = createRandom(5);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i += 1) counts[random.int(1, 6) - 1] += 1;
    counts.forEach(c => expect(Math.abs(c - 10000)).toBeLessThan(500));
    expect(random.int(3, 3)).toBe(3);
    const swapped = take(() => random.int(9, 7), 100);
    expect(swapped.every(v => v >= 7 && v <= 9)).toBe(true);
    const negative = take(() => random.int(-5, -2), 100);
    expect(negative.every(v => v >= -5 && v <= -2 && Number.isInteger(v))).toBe(true);
    const big = take(() => random.int(0, Number.MAX_SAFE_INTEGER), 200);
    expect(big.every(v => Number.isSafeInteger(v) && v >= 0)).toBe(true);
    expect(big.some(v => v > 2 ** 40)).toBe(true);
    expect(random.int(NaN, 5)).toBe(0);
    expect(take(() => random.int(1.2, 3.8), 50).every(v => v === 2 || v === 3)).toBe(true);
  });

  test('pick and weighted', () => {
    const random = createRandom(9);
    expect(random.pick([])).toBeUndefined();
    expect(random.pick(undefined)).toBeUndefined();
    expect(random.pick(['only'])).toBe('only');
    expect(new Set(take(() => random.pick(['a', 'b', 'c']), 200)).size).toBe(3);
    const items = [{ value: 'a', weight: 9 }, { value: 'b', weight: 1 }, { value: 'c', weight: 0 }];
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 10000; i += 1) counts[random.weighted(items).value] += 1;
    expect(counts.c).toBe(0);
    expect(Math.abs(counts.a - 9000)).toBeLessThan(300);
    expect(random.weighted([])).toBeUndefined();
    expect(random.weighted([{ value: 'x', weight: 0 }])).toBeUndefined();
    expect(new Set(take(() => random.weighted(['p', 'q']), 100)).size).toBe(2);
  });

  test('forks are independent of the parent and of each other', () => {
    const plain = createRandom(3);
    const expectedA = take(() => plain.fork('a').next(), 1)[0];
    const seqA = (() => {
      const f = createRandom(3).fork('a');
      return take(() => f.next(), 20);
    })();
    // use the parent and another fork heavily first
    const busy = createRandom(3);
    take(() => busy.next(), 500);
    const other = busy.fork('b');
    take(() => other.next(), 500);
    const late = busy.fork('a');
    expect(take(() => late.next(), 20)).toEqual(seqA);
    expect(seqA[0]).toBe(expectedA);
    // forking does not disturb the parent stream either
    const p1 = createRandom(3);
    const p2 = createRandom(3);
    p2.fork('x');
    p2.fork('y').next();
    expect(take(() => p2.next(), 10)).toEqual(take(() => p1.next(), 10));
    // labels and nesting matter
    const first = label => createRandom(3).fork(label).next();
    expect(first('a')).not.toBe(first('b'));
    expect(createRandom(3).fork('a').fork('b').next()).not.toBe(first('ab'));
    expect(createRandom(3).fork('a').fork('b').next())
      .toBe(createRandom(3).fork('a').fork('b').next());
    expect(first('a')).not.toBe(createRandom(4).fork('a').next());
  });
});

// ---- independent validators, written from the public rules ------------------
// 統一編號: weights 1,2,1,2,1,2,4,1; add the digits of every product; divisible by 5.
// When the 7th digit is 7 its product 28 gives 10, which counts as 1 or 0.
const validTaxId = (id) => {
  if (!/^\d{8}$/.test(id)) return false;
  const weights = [1, 2, 1, 2, 1, 2, 4, 1];
  let sum = 0;
  id.split('').forEach((ch, i) => {
    const product = Number(ch) * weights[i];
    sum += Math.floor(product / 10) + (product % 10);
  });
  if (sum % 5 === 0) return true;
  // 7 * 4 = 28 -> 2 + 8 = 10 was added above; the alternative reading adds 1 (or 0)
  return id.charAt(6) === '7' && ((sum - 10 + 1) % 5 === 0 || (sum - 10) % 5 === 0);
};

// 身分證字號: letter -> two digits, weights 1,9,8,7,6,5,4,3,2,1,1, sum divisible by 10
const validNationalId = (id) => {
  if (!/^[A-Z][12]\d{8}$/.test(id)) return false;
  const codes = {
    A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19, L: 20, M: 21,
    N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
  };
  const all = `${codes[id.charAt(0)]}${id.slice(1)}`.split('').map(Number);
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  return all.reduce((sum, d, i) => sum + d * weights[i], 0) % 10 === 0;
};

describe('builtin generators', () => {
  const sample = (name, n = 500, seed = 11) => {
    const random = createRandom(seed);
    return take(() => BUILTINS[name](random), n);
  };

  test('validators agree with well known examples', () => {
    expect(validTaxId('04595257')).toBe(true);
    expect(validTaxId('10458575')).toBe(true); // 7 in the 7th position
    expect(validTaxId('04595258')).toBe(false);
    expect(validTaxId('12345678')).toBe(false);
    expect(validNationalId('A123456789')).toBe(true);
    expect(validNationalId('A123456788')).toBe(false);
    expect(validNationalId('F131104093')).toBe(true);
  });

  test('every contract name has a generator and is deterministic', () => {
    expect(Object.keys(BUILTINS).sort()).toEqual(BUILTIN_NAMES.slice().sort());
    BUILTIN_NAMES.forEach((name) => {
      expect(sample(name, 30)).toEqual(sample(name, 30));
      expect(sample(name, 30)).not.toEqual(sample(name, 30, 12));
      sample(name, 30).forEach(v => expect(['string', 'boolean']).toContain(typeof v));
    });
    expect(builtinGenerator('tw.name')).toBe(BUILTINS['tw.name']);
    expect(builtinGenerator('toString')).toBeUndefined();
    expect(builtinGenerator(undefined)).toBeUndefined();
  });

  test('tw.taxId passes the 統一編號 check', () => {
    const ids = sample('tw.taxId', 5000);
    ids.forEach(id => expect(validTaxId(id)).toBe(true));
    // checkers disagree on a 7 in the 7th place, so none is made
    expect(ids.some(id => id.charAt(6) === '7')).toBe(false);
    expect(new Set(ids.map(id => id.charAt(6))).size).toBe(9);
    expect(new Set(ids.map(id => id.charAt(7))).size).toBe(10);
  });

  test('tw.nationalId passes the 身分證字號 check', () => {
    const ids = sample('tw.nationalId', 5000);
    ids.forEach(id => expect(validNationalId(id)).toBe(true));
    expect(new Set(ids.map(id => id.charAt(0))).size).toBe(26);
    expect(new Set(ids.map(id => id.charAt(1))).size).toBe(2);
  });

  test('taiwan names, phones and places', () => {
    sample('tw.surname').forEach(v => expect(TW_SURNAMES).toContain(v));
    sample('tw.givenName').forEach(v => expect(v).toMatch(/^[一-鿿]{1,2}$/));
    sample('tw.name').forEach(v => expect(v).toMatch(/^[一-鿿]{2,3}$/));
    sample('tw.mobile').forEach(v => expect(v).toMatch(/^09\d{8}$/));
    sample('tw.phone').forEach(v => expect(v).toMatch(/^0\d{1,3}-[2-8]\d{4,7}$/));
    const cities = TW_CITIES.map(c => c.city);
    const districts = TW_CITIES.reduce((all, c) => all.concat(c.districts.map(d => d.name)), []);
    const zips = TW_CITIES.reduce((all, c) => all.concat(c.districts.map(d => d.zip)), []);
    sample('tw.city').forEach(v => expect(cities).toContain(v));
    sample('tw.district').forEach(v => expect(districts).toContain(v));
    sample('tw.zip').forEach(v => expect(zips).toContain(v));
    sample('tw.address').forEach((v) => {
      expect(cities.some(c => v.indexOf(c) === 0)).toBe(true);
      expect(v).toMatch(/[路街](?:[一二三四五]段)?(?:\d+巷)?\d+號(?:\d+樓)?$/);
    });
    sample('tw.company').forEach(v => expect(v).toMatch(/(有限公司|企業社)$/));
  });

  test('region data is complete and well formed', () => {
    expect(TW_CITIES.length).toBe(22);
    expect(new Set(TW_CITIES.map(c => c.city)).size).toBe(22);
    const total = TW_CITIES.reduce((n, c) => n + c.districts.length, 0);
    expect(total).toBe(368);
    TW_CITIES.forEach((c) => {
      expect(c.city).toMatch(/^[一-鿿]{2}[市縣]$/);
      expect(new Set(c.districts.map(d => d.name)).size).toBe(c.districts.length);
      c.districts.forEach((d) => {
        expect(d.name).toMatch(/^[一-鿿]{1,3}[區鄉鎮市]$/);
        expect(d.zip).toMatch(/^[1-9]\d\d$/);
      });
    });
    expect(new Set(TW_SURNAMES).size).toBe(TW_SURNAMES.length);
    expect(new Set(TW_GIVEN_CHARS).size).toBe(TW_GIVEN_CHARS.length);
    expect(new Set(TW_ROADS).size).toBe(TW_ROADS.length);
    expect(ZH_CHARS).toMatch(/^[一-鿿]+$/);
  });

  test('english and technical values', () => {
    sample('en.firstName').forEach(v => expect(v).toMatch(/^[A-Z][a-z]+$/));
    sample('en.lastName').forEach(v => expect(v).toMatch(/^[A-Z][a-z]+$/));
    sample('en.name').forEach(v => expect(v).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/));
    sample('en.company').forEach(v => expect(v).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ [A-Za-z.]+$/));
    sample('username').forEach(v => expect(v).toMatch(/^[a-z]+[._]?[a-z]+\d{0,3}$/));
    sample('email').forEach(v => expect(v)
      .toMatch(/^[a-z]+[._]?[a-z]+\d{0,3}@example\.(com|org|net)$/));
    sample('url').forEach(v => expect(v)
      .toMatch(/^https:\/\/www\.[a-z]+\.example\.(com|org|net)\/[a-z]*$/));
    sample('ipv4').forEach((v) => {
      const parts = v.split('.').map(Number);
      expect(parts.length).toBe(4);
      expect(parts.every(p => Number.isInteger(p) && p >= 0 && p <= 255)).toBe(true);
      expect(parts[0]).toBeGreaterThan(0);
    });
    sample('uuid').forEach(v => expect(v)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
    sample('color').forEach(v => expect(v).toMatch(/^#[0-9A-F]{6}$/));
    const flags = sample('boolean', 1000);
    expect(flags.every(v => v === true || v === false)).toBe(true);
    expect(Math.abs(flags.filter(Boolean).length - 500)).toBeLessThan(80);
    expect(new Set(sample('uuid', 2000)).size).toBe(2000);
  });
});
