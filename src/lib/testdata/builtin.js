// Builtin value generators (Taiwan first, plus English). Every generator is a
// cheap function of a random stream: (random) => string | boolean.
import {
  TW_SURNAMES, TW_GIVEN_CHARS, TW_ROADS, TW_COMPANY_HEADS, TW_COMPANY_TAILS, TW_COMPANY_KINDS,
  TW_COMPANY_SUFFIXES, EN_FIRST_NAMES, EN_LAST_NAMES, EN_COMPANY_WORDS, EN_COMPANY_KINDS,
  EN_COMPANY_SUFFIXES, SAFE_DOMAINS, URL_PATHS,
} from './builtin_data';
import { TW_REGIONS, TW_PHONE_AREAS } from './builtin_data_tw';

// [{city, districts:[{name, zip}]}]
export const TW_CITIES = TW_REGIONS.map(([city, text]) => ({
  city,
  districts: text.split(' ').map(item => ({
    name: item.slice(0, -3),
    zip: item.slice(-3),
  })),
}));

// flat list so that every district is equally likely
export const TW_PLACES = TW_CITIES.reduce((all, c) => all.concat(c.districts.map(d => ({
  city: c.city,
  district: d.name,
  zip: d.zip,
}))), []);

const HEX = '0123456789abcdef';
const SECTIONS = ['一段', '二段', '三段', '四段', '五段'];
const NATIONAL_ID_LETTERS = 'ABCDEFGHJKLMNPQRSTUVXYWZIO'; // index + 10 = letter code
// 統一編號 weights; the products are reduced to the sum of their digits
const TAX_ID_WEIGHTS = [1, 2, 1, 2, 1, 2, 4, 1];

const pick = (random, list) => list[Math.floor(random.next() * list.length)];
// frequent entries (the head of the list) come up more often
const pickCommon = (random, list) => {
  const r = random.next();
  return list[Math.floor(r * r * list.length)];
};

const digits = (random, n) => {
  let text = '';
  for (let i = 0; i < n; i += 1) {
    text += Math.floor(random.next() * 10);
  }
  return text;
};

const hex = (random, n) => {
  let text = '';
  for (let i = 0; i < n; i += 1) {
    text += HEX.charAt(Math.floor(random.next() * 16));
  }
  return text;
};

const twSurname = random => pickCommon(random, TW_SURNAMES);

const twGivenName = (random) => {
  const first = pick(random, TW_GIVEN_CHARS);
  return random.next() < 0.1 ? first : first + pick(random, TW_GIVEN_CHARS);
};

const twPhone = (random) => {
  const area = pick(random, TW_PHONE_AREAS);
  return `${area[0]}-${random.int(2, 8)}${digits(random, area[1] - 1)}`;
};

// The place of a row: city, district, postal code and address of one row read the same
// `place` (a number in [0,1) the caller draws once per row), so they agree with each other.
const placeOf = (random, place) => TW_PLACES[Math.floor(
  (place === undefined ? random.next() : place) * TW_PLACES.length)];

const twAddress = (random, where) => {
  const place = placeOf(random, where);
  const road = pick(random, TW_ROADS);
  let text = place.city + place.district + road;
  if (road.charAt(road.length - 1) === '路' && random.next() < 0.3) {
    text += pick(random, SECTIONS);
  }
  if (random.next() < 0.2) {
    text += `${random.int(1, 300)}巷`;
  }
  text += `${random.int(1, 500)}號`;
  if (random.next() < 0.4) {
    text += `${random.int(2, 20)}樓`;
  }
  return text;
};

const twCompany = random => pick(random, TW_COMPANY_HEADS) + pick(random, TW_COMPANY_TAILS)
  + pick(random, TW_COMPANY_KINDS) + pick(random, TW_COMPANY_SUFFIXES);

const digitSum = n => Math.floor(n / 10) + (n % 10);

// 統一編號, 8 digits. Each digit is multiplied by its weight and the digits of the products
// are added up. The old rule wants that sum divisible by 10, the rule in force since 2023
// divisible by 5; a sum divisible by 10 passes both. When the 7th digit is 7 its product is
// 28 -> 2 + 8 = 10, which a checker may count as 1 or as 0 (either may make the number
// valid): checkers differ there, so no number with a 7 in the 7th place is made.
const twTaxId = (random) => {
  let head = digits(random, 6);
  const seventh = Math.floor(random.next() * 9);
  head += seventh >= 7 ? seventh + 1 : seventh;
  let sum = 0;
  for (let i = 0; i < 7; i += 1) {
    sum += digitSum(Number(head.charAt(i)) * TAX_ID_WEIGHTS[i]);
  }
  return head + ((10 - (sum % 10)) % 10);
};

// letter + gender digit (1/2) + 7 digits + check digit
const twNationalId = (random) => {
  const index = Math.floor(random.next() * 26);
  const code = index + 10;
  const body = `${random.int(1, 2)}${digits(random, 7)}`;
  let sum = Math.floor(code / 10) + (code % 10) * 9;
  for (let i = 0; i < 8; i += 1) {
    sum += Number(body.charAt(i)) * (8 - i);
  }
  return NATIONAL_ID_LETTERS.charAt(index) + body + ((10 - (sum % 10)) % 10);
};

const enFirstName = random => pick(random, EN_FIRST_NAMES);
const enLastName = random => pick(random, EN_LAST_NAMES);

const enCompany = random => `${pick(random, EN_COMPANY_WORDS)} ${pick(random, EN_COMPANY_KINDS)} ${
  pick(random, EN_COMPANY_SUFFIXES)}`;

const username = (random) => {
  const first = enFirstName(random).toLowerCase();
  const last = enLastName(random).toLowerCase();
  const style = random.next();
  let name = `${first}.${last}`;
  if (style < 0.3) {
    name = `${first}_${last}`;
  } else if (style < 0.5) {
    name = first.charAt(0) + last;
  }
  return random.next() < 0.6 ? name + random.int(1, 999) : name;
};

const url = (random) => {
  const host = pick(random, EN_COMPANY_WORDS).toLowerCase();
  const path = pick(random, URL_PATHS);
  return `https://www.${host}.${pick(random, SAFE_DOMAINS)}/${path}`;
};

const uuid = (random) => {
  const variant = HEX.charAt(8 + Math.floor(random.next() * 4));
  return `${hex(random, 8)}-${hex(random, 4)}-4${hex(random, 3)}-${variant}${hex(random, 3)}-${
    hex(random, 12)}`;
};

export const BUILTINS = {
  'tw.name': random => twSurname(random) + twGivenName(random),
  'tw.surname': twSurname,
  'tw.givenName': twGivenName,
  'tw.mobile': random => `09${digits(random, 8)}`,
  'tw.phone': twPhone,
  'tw.address': twAddress,
  'tw.city': (random, place) => placeOf(random, place).city,
  'tw.district': (random, place) => placeOf(random, place).district,
  'tw.zip': (random, place) => placeOf(random, place).zip,
  'tw.company': twCompany,
  'tw.taxId': twTaxId,
  'tw.nationalId': twNationalId,
  'en.name': random => `${enFirstName(random)} ${enLastName(random)}`,
  'en.firstName': enFirstName,
  'en.lastName': enLastName,
  'en.company': enCompany,
  email: random => `${username(random)}@${pick(random, SAFE_DOMAINS)}`,
  username,
  url,
  ipv4: random => `${random.int(1, 223)}.${random.int(0, 255)}.${random.int(0, 255)}.${
    random.int(1, 254)}`,
  uuid,
  boolean: random => random.next() < 0.5,
  color: random => `#${hex(random, 6).toUpperCase()}`,
};

// (random[, place]) => value, or undefined for an unknown name
export const builtinGenerator = name => (
  Object.prototype.hasOwnProperty.call(BUILTINS, name) ? BUILTINS[name] : undefined
);

// builtins whose value depends on the place of the row
export const PLACE_BUILTINS = ['tw.city', 'tw.district', 'tw.zip', 'tw.address'];

// Every value of the builtins that pick from a list (they may repeat, the caller sorts
// that out), a mask for the ones that are one; undefined when the values cannot be listed.
const LISTS = {
  'tw.surname': () => TW_SURNAMES,
  'tw.city': () => TW_CITIES.map(c => c.city),
  'tw.district': () => TW_PLACES.map(p => p.district),
  'tw.zip': () => TW_PLACES.map(p => p.zip),
  'en.firstName': () => EN_FIRST_NAMES,
  'en.lastName': () => EN_LAST_NAMES,
  boolean: () => [true, false],
};

export const builtinList = name => (
  Object.prototype.hasOwnProperty.call(LISTS, name) ? LISTS[name]() : undefined
);

export const builtinMask = name => (name === 'tw.mobile' ? '09########' : undefined);
