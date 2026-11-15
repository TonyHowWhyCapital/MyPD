// What the model says about keys: which columns point at a parent row, which groups of
// columns must be unique, and how many different values a rule can give at most.

const same = (a, b) => `${a}`.toLowerCase() === `${b}`.toLowerCase();

// Foreign keys of a table. A correlation carries one column pair and no name of the
// reference it belongs to, so the pairs are grouped here: pairs to the same parent table
// that read different parent columns are one (composite) key and take all their values from
// ONE parent row; a second pair reading the same parent column starts another key.
export const fkGroups = (entity, entityById) => {
  const fields = (entity && entity.fields) || [];
  const groups = [];
  const used = [];
  ((entity && entity.correlations) || []).forEach((c) => {
    const parent = c && entityById.get(c.refEntity);
    if (!parent || used.includes(c.myField) || !fields.some(f => f.id === c.myField)
      || !(parent.fields || []).some(f => f.id === c.refField)) {
      return; // dangling line of a diagram, or a second parent for the same column
    }
    used.push(c.myField);
    let group = groups.find(g => g.refEntityId === c.refEntity
      && !g.pairs.some(p => p.refFieldId === c.refField));
    if (!group) {
      group = {
        refEntityId: c.refEntity,
        self: c.refEntity === entity.id,
        pairs: [],
      };
      groups.push(group);
    }
    group.pairs.push({
      fieldId: c.myField,
      refFieldId: c.refField,
    });
  });
  return groups;
};

const addSet = (sets, ids) => {
  const set = ids.filter((id, i) => ids.indexOf(id) === i);
  const equal = s => s.length === set.length && s.every(id => set.includes(id));
  if (set.length > 0 && !sets.some(equal)) {
    sets.push(set);
  }
};

// Groups of columns (field ids) whose values must be unique as a tuple: the primary key,
// unique indexes, alternate keys (`entity.keys`, written by the PDM import) and columns
// whose rule asks for unique values. `fieldDefKey` of an index holds the field id; files
// read from a database may still carry the column name there.
export const uniqueSets = (entity, columns, ruleOf) => {
  const fields = (entity && entity.fields) || [];
  const idOf = (ref) => {
    const found = fields.find(f => f.id === ref) || fields.find(f => same(f.defKey, ref));
    return found ? found.id : null;
  };
  const sets = [];
  addSet(sets, fields.filter(f => f.primaryKey).map(f => f.id));
  ((entity && entity.indexes) || []).filter(i => i && i.unique).forEach((i) => {
    const ids = (i.fields || []).map(f => idOf(f && f.fieldDefKey));
    if (!ids.includes(null)) {
      addSet(sets, ids);
    }
  });
  ((entity && entity.keys) || []).filter(k => k && !k.primary).forEach((k) => {
    const ids = (k.fields || []).map(idOf);
    if (!ids.includes(null)) {
      addSet(sets, ids);
    }
  });
  columns.forEach((c) => {
    const rule = ruleOf(c.id);
    if (rule && rule.unique) {
      addSet(sets, [c.id]);
    }
  });
  const present = sets.filter(s => s.every(id => columns.some(c => c.id === id)));
  // a set that contains another unique set is unique anyway
  return present.filter(s => !present.some(o => o !== s && o.length < s.length
    && o.every(id => s.includes(id))));
};

const CHARSETS = {
  alnum: 62,
  alpha: 52,
  digit: 10,
  hex: 16,
  zh: 3000,
};

const power = (base, exp) => (exp > 18 ? Infinity : base ** Math.max(0, exp));

const maskCapacity = (mask) => {
  let total = 1;
  const text = `${mask || ''}`;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
    } else if (ch === '#') {
      total *= 10;
    } else if (ch === 'A' || ch === 'a') {
      total *= 26;
    } else if (ch === '*') {
      total *= 62;
    }
    if (total > 1e15) {
      return Infinity;
    }
  }
  return total;
};

const distinct = values => values.filter((v, i) => values.indexOf(v) === i).length;

const autoCapacity = (column) => {
  if (column.kind === 'string') {
    return column.len === null ? Infinity : power(36, column.len);
  }
  if (column.kind === 'int') {
    const byType = {
      TINYINT: 128,
      SMALLINT: 32768,
      INT2: 32768,
    }[column.type];
    return byType || (column.len === null ? Infinity : power(10, column.len));
  }
  return Infinity;
};

const sequenceCapacity = (params, column) => {
  if (column.len === null) {
    return Infinity;
  }
  if (column.kind === 'string') {
    const fixed = `${params.prefix || ''}${params.suffix || ''}`.length;
    return column.len > fixed ? power(10, column.len - fixed) : 1;
  }
  return column.kind === 'int' ? power(10, column.len) : Infinity;
};

const dictCapacity = (params, dataSource, field) => {
  const id = params.dict || (field && field.refDict);
  const dict = ((dataSource && dataSource.dicts) || []).find(d => d.id === id);
  if (!dict) {
    return Infinity;
  }
  const items = (dict.items || []).filter(i => i && i.enabled !== false);
  return distinct(items.map(i => `${params.use === 'name' ? i.defName : i.defKey}`));
};

// Upper bound of the number of different values a rule gives for a column; Infinity when
// it cannot be told before the data is there (files, queries, formulas).
export const ruleCapacity = (rule, column, dataSource, field) => {
  const params = (rule && rule.params) || {};
  const limit = column.kind === 'bool' ? 2 : Infinity;
  let capacity = Infinity;
  switch (rule && rule.kind) {
    case 'auto': capacity = autoCapacity(column); break;
    case 'sequence': capacity = sequenceCapacity(params, column); break;
    case 'constant': capacity = 1; break;
    case 'list':
      capacity = distinct((params.items || []).map(i => `${i && i.value}`));
      break;
    case 'dict': capacity = dictCapacity(params, dataSource, field); break;
    case 'pattern': capacity = maskCapacity(params.mask); break;
    case 'builtin': capacity = params.name === 'boolean' ? 2 : Infinity; break;
    case 'number': {
      const span = Number(params.max) - Number(params.min);
      const decimals = Math.max(0, Number(params.decimals) || 0);
      capacity = Number.isNaN(span) || span < 0 ? Infinity
        : Math.floor(span * power(10, decimals)) + 1;
      break;
    }
    case 'text': {
      const max = Number(params.max);
      const len = column.len === null ? max : Math.min(max, column.len);
      capacity = Number.isNaN(len) ? Infinity : power(CHARSETS[params.charset] || 62, len);
      break;
    }
    default: break;
  }
  return Math.min(limit, capacity);
};

// A sequence never repeats while it fits the column, so its values need no checking.
export const neverRepeats = (rule, column, rows) => {
  if (!rule || rule.kind !== 'sequence' || (column.kind !== 'string' && column.kind !== 'int')) {
    return false;
  }
  const params = rule.params || {};
  const start = params.start === undefined ? 1 : Number(params.start);
  const step = params.step === undefined ? 1 : Number(params.step);
  if (!step || Number.isNaN(step) || Number.isNaN(start) || start < 0 || step < 0) {
    return false;
  }
  if (column.len === null) {
    return true;
  }
  const fixed = column.kind === 'string' ? `${params.prefix || ''}${params.suffix || ''}`.length : 0;
  const digits = `${Math.floor(start + (Math.max(1, rows) - 1) * step)}`.length;
  return Math.max(digits, Number(params.pad) || 0) <= column.len - fixed;
};
