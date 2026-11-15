// The rule of a column when the column is copied and pasted. A column stores the id of
// a rule of ITS project, which means nothing in another project; what travels with a
// copied column is therefore the name and the kind of the rule. On paste the rule of the
// target project with that name is used; when there is none the column keeps its null
// rate and gets automatic values, never an id that points nowhere.
import { getTestData } from './model';

const sameName = (a, b) => `${a || ''}`.trim().toLowerCase() === `${b || ''}`.trim().toLowerCase();

// the rule of the project with this name (names are unique within a library)
export const ruleByName = (dataSource, name, kind) => {
  if (!`${name || ''}`.trim()) {
    return null;
  }
  return getTestData(dataSource).rules
    .find(r => sameName(r.name, name) && (!kind || r.kind === kind)) || null;
};

// what is put beside a copied column: {name, kind} of its own rule, or undefined
export const copiedRule = (dataSource, field) => {
  const id = field && field.testData && field.testData.rule;
  const rule = id ? getTestData(dataSource).rules.find(r => r.id === id) : null;
  return rule ? { name: rule.name, kind: rule.kind } : undefined;
};

// `field.testData` of a pasted column in the project it is pasted into
export const pastedTestData = (dataSource, field, copied) => {
  const value = field && field.testData;
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const rules = getTestData(dataSource).rules;
  let rule = rules.find(r => r.id === value.rule);
  if (!rule && copied) {
    rule = ruleByName(dataSource, copied.name, copied.kind);
  }
  const next = {};
  if (rule) {
    next.rule = rule.id;
  }
  if (value.nullRate !== undefined) {
    next.nullRate = value.nullRate;
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

// the text of the rule column of a line pasted from a spreadsheet -> testData or undefined
export const testDataFromText = (dataSource, text) => {
  const rule = ruleByName(dataSource, text);
  return rule ? { rule: rule.id } : undefined;
};
