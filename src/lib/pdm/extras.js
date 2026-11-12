import { child, text, value } from './xml';

// What the modeling tool keeps beside the core of a table: the extended attributes of a
// column, who owns the table, how many rows it expects, and the colour of a symbol.

// Extended attributes are stored as text: "{id},Name,length=value" one after the other,
// grouped under the definition they belong to, which is itself written the same way.
// Every length counts characters as they stand in the file, line ends included.
const HEAD = /^\{[0-9A-Fa-f-]+\},([^,=\r\n]*),(\d+)=/;

const parseEntries = (source, eol) => {
  const entries = [];
  let rest = source;
  while (rest.length > 0) {
    const head = HEAD.exec(rest);
    if (!head) {
      return null;
    }
    const length = Number(head[2]);
    const body = rest.slice(head[0].length, head[0].length + length);
    if (body.length !== length) {
      return null;
    }
    entries.push({ prefix: head[0].slice(0, head[0].lastIndexOf(',') + 1), name: head[1], body });
    rest = rest.slice(head[0].length + length);
    if (!rest.startsWith(eol)) {
      return null;
    }
    rest = rest.slice(eol.length);
  }
  return entries;
};

// The groups with their attributes, or null when the text is not laid out as expected.
const parseExtended = (source, eol) => {
  const groups = parseEntries(source, eol);
  if (!groups) {
    return null;
  }
  const parsed = groups.map(g => ({ ...g, attributes: parseEntries(g.body, eol) }));
  return parsed.every(g => g.attributes) ? parsed : null;
};

const write = (entries, eol) => entries.map(e => `${e.prefix}${e.body.length}=${e.body}${eol}`).join('');

const raw = (el, eol) => text(child(el, 'a:ExtendedAttributesText')).replace(/\r?\n/g, eol);

export const readExtended = (el, eol) => {
  const groups = parseExtended(raw(el, eol), eol) || [];
  return groups.reduce((all, g) => g.attributes
    .reduce((map, a) => ({ ...map, [a.name]: a.body.split(eol).join('\n') }), all), {});
};

// Only the value of an attribute the file already has can be changed from the project.
// Returns the new text, or null when nothing differs.
export const changedExtended = (el, eol, before, after) => {
  const groups = parseExtended(raw(el, eol), eol);
  if (!groups || !after) {
    return null;
  }
  let changed = false;
  const next = groups.map(g => ({
    ...g,
    attributes: g.attributes.map((a) => {
      const wanted = after[a.name];
      if (wanted === undefined || `${wanted}` === `${(before || {})[a.name]}`) {
        return a;
      }
      changed = true;
      return { ...a, body: `${wanted}`.replace(/\r?\n/g, eol) };
    }),
  }));
  return changed ? write(next.map(g => ({ ...g, body: write(g.attributes, eol) })), eol) : null;
};

// A colour of the file is one number, blue first; the project writes it as rgb().
export const colourOf = (number) => {
  const n = Number(number);
  // eslint-disable-next-line no-bitwise
  return Number.isFinite(n) && `${number}` !== '' ? `rgb(${n & 255}, ${(n >> 8) & 255}, ${(n >> 16) & 255})` : '';
};
export const numberOf = (colour) => {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(`${colour || ''}`.trim());
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(`${colour || ''}`.trim());
  const parts = (hex && hex.slice(1).map(h => parseInt(h, 16))) || (rgb && rgb.slice(1).map(Number));
  // eslint-disable-next-line no-bitwise
  return parts ? `${parts[0] | (parts[1] << 8) | (parts[2] << 16)}` : '';
};

// The owner of a table is a user of the model, named here by its code.
export const OWNER = 'Owner';
export const ROWS = 'RowCount';
export const readTableExtras = (doc, el, resolve) => {
  const owner = resolve(doc, (child(el, 'c:Owner') || { children: [] }).children.find(c => c.type === 'el'));
  const extras = {};
  if (owner) {
    extras[OWNER] = value(owner, 'a:Code');
  }
  if (value(el, 'a:Number')) {
    extras[ROWS] = value(el, 'a:Number');
  }
  return extras;
};
