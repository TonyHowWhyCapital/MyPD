// Builtin value generators (Taiwan first, plus English). Every generator is a
// cheap function of a random stream: (random) => string | boolean.
import {
  TW_SURNAMES, TW_GIVEN_CHARS, TW_ROADS, TW_COMPANY_CHARS, TW_COMPANY_KINDS,
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
const TW_PLACES = TW_CITIES.reduce((all, c) => all.concat(c.districts.map(d => ({
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

const twAddress = (random) => {
  const place = pick(random, TW_PLACES);
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

const twCompany = random => pick(random, TW_COMPANY_CHARS) + pick(random, TW_COMPANY_CHARS)
  + pick(random, TW_COMPANY_KINDS) + pick(random, TW_COMPANY_SUFFIXES);

const digitSum = n => Math.floor(n / 10) + (n % 10);

// 8 digits; the weighted digit sum must be divisible by 5 (rule in force since 2023).
// A 7 in the 7th position gives 28 -> 2 + 8 = 10, which may count as 1 or as 0;
// it is counted as 1 here, so the number passes in both readings of the check.
const twTaxId = (random) => {
  const head = digits(random, 7);
  let sum = 0;
  for (let i = 0; i < 7; i += 1) {
    const product = digitSum(Number(head.charAt(i)) * TAX_ID_WEIGHTS[i]);
    sum += product === 10 ? 1 : product;
  }
  // two last digits fit (0-4 and 5-9)
  const last = ((5 - (sum % 5)) % 5) + (random.next() < 0.5 ? 0 : 5);
  return head + last;
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
  'tw.city': random => pick(random, TW_CITIES).city,
  'tw.district': random => pick(random, TW_PLACES).district,
  'tw.zip': random => pick(random, TW_PLACES).zip,
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

// (random) => value, or undefined for an unknown name
export const builtinGenerator = name => (
  Object.prototype.hasOwnProperty.call(BUILTINS, name) ? BUILTINS[name] : undefined
);
