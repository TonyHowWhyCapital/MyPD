// Source-preserving XML tree. Untouched nodes serialize back to their original
// bytes, so saving a model rewrites only the objects that actually changed.

const TAG = /<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export const decode = (text) => {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (all, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' }[name];
  });
};

export const encode = (text) => {
  return `${text}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

const parseAttrs = (source) => {
  const attrs = {};
  let match = ATTR.exec(source);
  while (match) {
    attrs[match[1]] = decode(match[2] === undefined ? match[3] : match[2]);
    match = ATTR.exec(source);
  }
  return attrs;
};

const closers = [['<?', '?>'], ['<!--', '-->'], ['<![CDATA[', ']]>'], ['<!', '>']];

export const parseXml = (source) => {
  const root = { type: 'el', tag: '#root', open: '', close: '', attrs: {}, children: [], parent: null, dirty: true };
  let current = root;
  let pos = 0;
  const addRaw = (raw, type = 'text') => {
    if (raw) {
      current.children.push({ type, raw, parent: current });
    }
  };
  while (pos < source.length) {
    const lt = source.indexOf('<', pos);
    if (lt < 0) {
      addRaw(source.slice(pos));
      break;
    }
    addRaw(source.slice(pos, lt));
    const closer = closers.find(c => source.startsWith(c[0], lt));
    if (closer) {
      const end = source.indexOf(closer[1], lt);
      if (end < 0) {
        throw new Error(`Invalid XML: unterminated ${closer[0]} at ${lt}`);
      }
      pos = end + closer[1].length;
      addRaw(source.slice(lt, pos), closer[0] === '<![CDATA[' ? 'cdata' : 'misc');
    } else if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt);
      const tag = source.slice(lt + 2, end).trim();
      if (end < 0 || current === root || current.tag !== tag) {
        throw new Error(`Invalid XML: unexpected </${tag}> at ${lt}`);
      }
      pos = end + 1;
      current.close = source.slice(lt, pos);
      current.raw = source.slice(current.start, pos);
      current = current.parent;
    } else {
      TAG.lastIndex = lt;
      const match = TAG.exec(source);
      if (!match) {
        throw new Error(`Invalid XML: malformed tag at ${lt}`);
      }
      pos = TAG.lastIndex;
      const el = {
        type: 'el',
        tag: match[1],
        attrs: parseAttrs(match[2]),
        open: match[0],
        close: '',
        children: [],
        parent: current,
        dirty: false,
        start: lt,
      };
      current.children.push(el);
      if (match[3]) {
        el.raw = match[0];
      } else {
        current = el;
      }
    }
  }
  if (current !== root) {
    throw new Error(`Invalid XML: <${current.tag}> is not closed`);
  }
  return root;
};

export const serialize = (node) => {
  if (node.type !== 'el' || !node.dirty) {
    return node.raw;
  }
  return node.open + node.children.map(serialize).join('') + node.close;
};

export const touch = (el) => {
  let node = el;
  while (node && !node.dirty) {
    node.dirty = true;
    node = node.parent;
  }
};

export const elements = (el, tag) => {
  return el ? el.children.filter(c => c.type === 'el' && (!tag || c.tag === tag)) : [];
};

export const child = (el, tag) => {
  return el ? el.children.find(c => c.type === 'el' && c.tag === tag) : undefined;
};

export const text = (el) => {
  if (!el) {
    return '';
  }
  return el.children.map((c) => {
    if (c.type === 'cdata') {
      return c.raw.slice(9, -3);
    }
    return c.type === 'text' ? decode(c.raw) : '';
  }).join('');
};

export const value = (el, tag) => text(child(el, tag)).replace(/\r\n/g, '\n');

export const walk = (el, visit) => {
  visit(el);
  el.children.forEach((c) => {
    if (c.type === 'el') {
      walk(c, visit);
    }
  });
};

export const isAttached = (el) => {
  let node = el;
  while (node.parent) {
    if (!node.parent.children.includes(node)) {
      return false;
    }
    node = node.parent;
  }
  return node.tag === '#root';
};

// Parses a generated fragment into nodes that always serialize from their parts.
export const fragment = (source) => {
  const nodes = parseXml(source).children;
  nodes.forEach((n) => {
    if (n.type === 'el') {
      walk(n, (e) => {
        e.dirty = true;
      });
    }
  });
  return nodes;
};

const isBlank = node => node && node.type === 'text' && /^\s*$/.test(node.raw);

// Inserts element nodes before `before` (or at the end), each followed by a line break.
export const insert = (parent, nodes, before, eol) => {
  let index = before ? parent.children.indexOf(before) : parent.children.length;
  if (!before && index > 0 && !isBlank(parent.children[index - 1])) {
    parent.children.splice(index, 0, { type: 'text', raw: eol, parent });
    index += 1;
  }
  nodes.filter(n => n.type === 'el').forEach((n) => {
    // eslint-disable-next-line no-param-reassign
    n.parent = parent;
    parent.children.splice(index, 0, n, { type: 'text', raw: eol, parent });
    index += 2;
  });
  touch(parent);
};

// Detaches an element together with the line break that followed it.
export const detach = (el) => {
  const siblings = el.parent.children;
  const index = siblings.indexOf(el);
  if (index < 0) {
    return;
  }
  siblings.splice(index, isBlank(siblings[index + 1]) ? 2 : 1);
  touch(el.parent);
};

export const setText = (el, content) => {
  // eslint-disable-next-line no-param-reassign
  el.children = [{ type: 'text', raw: encode(content), parent: el }];
  if (!el.close) {
    // eslint-disable-next-line no-param-reassign
    el.open = el.open.replace(/\s*\/>$/, '>');
    // eslint-disable-next-line no-param-reassign
    el.close = `</${el.tag}>`;
  }
  touch(el);
};
