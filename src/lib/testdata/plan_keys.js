// What the model says about keys: which columns point at a parent row, which groups of
// columns must be unique, and how many different values a rule can give at most.
import { spaceSize, sequenceRows } from './value_space';

const same = (a, b) => `${a}`.toLowerCase() === `${b}`.toLowerCase();

// "n", "0,n", "1,n": this end of a relation has many rows
const many = rows => /n/i.test(`${rows === undefined || rows === null ? '' : rows}`);
const isKey = (entity, fieldId) => ((entity && entity.fields) || [])
  .some(f => f.id === fieldId && f.primaryKey);

// A correlation is kept on ONE of its two tables, and not always on the child: the app
// writes it on the table a relation line of a diagram STARTS from (a line drawn from the
// parent gives `myRows: '1', refRows: 'n'` on the parent), an imported model writes it on
// the child (`n` : `1`). The child is the end with many rows; where the rows do not tell
// (1:1, n:n, nothing), the end that is not a primary key, else the table that has it.
const heldByOther = (c, owner, entityById) => {
  const mine = many(c.myRows);
  const theirs = many(c.refRows);
  if (mine !== theirs) {
    return theirs;
  }
  return isKey(owner, c.myField) && !isKey(entityById.get(c.refEntity), c.refField);
};

// The column pairs of `entity` as the child: {myField, refEntity, refField}, whichever
// table the correlation is kept on.
export const childPairs = (entity, entityById) => {
  const pairs = [];
  if (!entity) {
    return pairs;
  }
  const owners = [entity];
  entityById.forEach(e => e !== entity && e.id !== entity.id && owners.push(e));
  owners.forEach(owner => (owner.correlations || []).forEach((c) => {
    if (!c) {
      return;
    }
    const other = heldByOther(c, owner, entityById);
    if (owner === entity && !other) {
      pairs.push({ myField: c.myField, refEntity: c.refEntity, refField: c.refField });
    }
    if (c.refEntity === entity.id && other) {
      pairs.push({ myField: c.refField, refEntity: owner.id, refField: c.myField });
    }
  }));
  return pairs;
};

// Foreign keys of a table. A correlation carries one column pair and no name of the
// reference it belongs to, so the pairs are grouped here: pairs to the same parent table
// that read different parent columns are one (composite) key and take all their values from
// ONE parent row; a second pair reading the same parent column starts another key.
export const fkGroups = (entity, entityById) => {
  const fields = (entity && entity.fields) || [];
  const groups = [];
  const used = [];
  childPairs(entity, entityById).forEach((c) => {
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

// Upper bound of the number of different values a rule gives for a column: what the
// generator can really draw (see value_space.js); Infinity when it cannot be told before
// the data is there (files and queries not loaded, formulas, most builtins).
// ctx = { lists, now } when the caller has them.
export const ruleCapacity = (rule, column, dataSource, field, ctx) => spaceSize(rule, column, {
  ...(ctx || {}),
  dataSource,
  field,
});

// A sequence never repeats while it stays inside the column, so its values need no
// checking. It leaves the column when a number is too large for the type (127 for a
// TINYINT) or a text too long; such a sequence stops the run instead of repeating.
export const neverRepeats = (rule, column, rows) => {
  if (!rule || rule.kind !== 'sequence' || !['int', 'decimal', 'string'].includes(column.kind)) {
    return false;
  }
  const count = Math.max(1, rows || 0);
  return sequenceRows(rule.params || {}, column, count) >= count;
};
