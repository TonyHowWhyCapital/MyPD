// Changes to the rule libraries, on plain data. Nothing here mutates its input.
import {
  getTestData, setTestData, upsertRule, removeRule, setDomainRule, setFieldRule, ruleUsage,
  copyRules, validateRule, RULE_KINDS,
} from '../../../../../lib/testdata/model';
import { resolveRule } from '../../../../../lib/testdata/columns';

export const projectRules = dataSource => getTestData(dataSource).rules;

export const saveProjectRule = (dataSource, rule) => setTestData(dataSource,
  upsertRule(getTestData(dataSource), rule));

// rules of the machine library as stored, minus anything that is not a rule
export const cleanRules = list => (Array.isArray(list) ? list : [])
  .filter(r => r && typeof r === 'object' && typeof r.id === 'string' && r.id
    && RULE_KINDS.includes(r.kind));

// removes the rules, what the domains point to and what the columns point to; a null
// rate set on a column stays
export const deleteProjectRules = (dataSource, ruleIds) => {
  const ids = ruleIds || [];
  let next = setTestData(dataSource, ids.reduce((td, id) => removeRule(td, id),
    getTestData(dataSource)));
  ids.forEach((id) => {
    ruleUsage(next, id).fields.forEach(({ entityId, fieldId }) => {
      const entity = (next.entities || []).find(e => e.id === entityId);
      const field = ((entity && entity.fields) || []).find(f => f.id === fieldId);
      const rate = field && field.testData ? field.testData.nullRate : undefined;
      next = setFieldRule(next, entityId, fieldId, rate === undefined ? null : { nullRate: rate });
    });
  });
  return next;
};

// copies with fresh ids and names that do not clash -> {rules: all of them, added}
export const addRules = (existing, incoming) => {
  const added = copyRules(incoming, existing);
  return {
    rules: (existing || []).concat(added),
    added,
  };
};

export const addProjectRules = (dataSource, incoming) => {
  const td = getTestData(dataSource);
  const { rules, added } = addRules(td.rules, incoming);
  return {
    dataSource: setTestData(dataSource, { ...td, rules }),
    added,
  };
};

export const bindDomain = (dataSource, domainId, ruleId) => setTestData(dataSource,
  setDomainRule(getTestData(dataSource), domainId, ruleId || null));

// another rule of the same library already has this name (names tell rules apart in lists)
export const nameTaken = (rules, rule) => {
  const name = `${(rule && rule.name) || ''}`.trim().toLowerCase();
  return !!name && (rules || []).some(r => r.id !== rule.id
    && `${r.name || ''}`.trim().toLowerCase() === name);
};

// problems of a rule about to be stored in `rules`
export const libraryProblems = (rule, rules) => {
  const problems = validateRule(rule, { library: true });
  return nameTaken(rules, rule) ? problems.concat('rule.name.duplicate') : problems;
};

const label = o => (o ? (o.defKey || o.defName || '') : '');

// who uses the rule, by name: {fields: ['TABLE.COLUMN'], domains: ['name']}
export const usageNames = (dataSource, ruleId) => {
  const usage = ruleUsage(dataSource, ruleId);
  return {
    fields: usage.fields.map(({ entityId, fieldId }) => {
      const entity = (dataSource.entities || []).find(e => e.id === entityId);
      const field = ((entity && entity.fields) || []).find(f => f.id === fieldId);
      return `${label(entity)}.${label(field)}`;
    }),
    domains: usage.domains.map((id) => {
      const domain = (dataSource.domains || []).find(d => d.id === id);
      return domain ? (domain.defName || domain.defKey || id) : id;
    }),
  };
};

// the rule in force for a column whose own setting is `value` ({rule, nullRate} or nothing)
export const effectiveRule = (dataSource, field, value) => {
  const { testData, ...rest } = field || {};
  return resolveRule(dataSource, null, value ? { ...rest, testData: value } : rest);
};

// {rule, nullRate} as stored on a column, or undefined when nothing is left to store
export const fieldValue = (ruleId, nullRate) => {
  const value = {};
  if (ruleId) {
    value.rule = ruleId;
  }
  const rate = Number(nullRate);
  if (nullRate !== undefined && nullRate !== null && nullRate !== '' && Number.isFinite(rate)) {
    value.nullRate = Math.max(0, Math.min(100, rate));
  }
  return Object.keys(value).length > 0 ? value : undefined;
};

// the project with the tables being edited in open tabs as they are on screen, so that a
// column bound a moment ago counts as a use before the project is saved
export const withOpenTabs = (dataSource, tabs) => {
  const open = Object.keys(tabs || {}).map(key => tabs[key])
    .filter(t => t && t.type === 'entity' && t.data && !t.isInit);
  if (open.length === 0) {
    return dataSource;
  }
  return {
    ...dataSource,
    entities: (dataSource.entities || []).map((entity) => {
      const tab = open.find(t => t.key === entity.id);
      return tab ? { ...entity, fields: tab.data.fields || [] } : entity;
    }),
  };
};

const content = rule => JSON.stringify([rule.kind, rule.params || {},
  rule.nullRate === undefined ? null : rule.nullRate, !!rule.unique, rule.note || '']);

// the rule of `rules` that is the same as `rule` in everything but its id
export const findTwin = (rules, rule) => (rules || [])
  .find(r => r.name === rule.name && content(r) === content(rule));
