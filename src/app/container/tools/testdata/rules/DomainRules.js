// The rule of each domain of the project: columns of the domain take it unless they
// have a rule of their own.
import React from 'react';
import { Select } from 'components';
import { getTestData } from '../../../../../lib/testdata/model';
import { tr } from './i18n';
import { ruleSummary } from './ruleText';

const { Option } = Select;

const typeOf = (dataSource, domain) => {
  const mappings = (dataSource.dataTypeMapping && dataSource.dataTypeMapping.mappings) || [];
  const mapping = mappings.find(m => m.id === domain.applyFor);
  const db = dataSource.profile && dataSource.profile.default && dataSource.profile.default.db;
  const type = (mapping && (mapping[db] || mapping.defName || mapping.defKey)) || '';
  const size = [domain.len, domain.scale].filter(v => v !== undefined && v !== null && v !== '');
  return `${type}${size.length > 0 ? `(${size.join(',')})` : ''}`;
};

export default React.memo(({
  base, dataSource, screen, onBind,
}) => {
  const domains = dataSource.domains || [];
  const { rules, domainRules } = getTestData(dataSource);
  // how many columns take their type from each domain
  const counts = {};
  ((screen || dataSource).entities || []).forEach((entity) => {
    (entity.fields || []).forEach((f) => {
      if (f.domain) {
        counts[f.domain] = (counts[f.domain] || 0) + 1;
      }
    });
  });
  if (domains.length === 0) {
    return <div className={`${base}-empty`}>{tr('domainTab.empty')}</div>;
  }
  return <div className={`${base}-domains`}>
    {rules.length === 0 && <div className={`${base}-note`}>{tr('domainTab.noRules')}</div>}
    <table>
      <thead>
        <tr>
          <th>{tr('domainTab.domain')}</th>
          <th>{tr('domainTab.type')}</th>
          <th>{tr('domainTab.fields')}</th>
          <th>{tr('domainTab.rule')}</th>
          <th>{tr('editor.params')}</th>
        </tr>
      </thead>
      <tbody>
        {domains.map((d) => {
          const rule = rules.find(r => r.id === domainRules[d.id]);
          return <tr key={d.id}>
            <td>
              <span>{d.defName || d.defKey}</span>
              {d.defName && d.defKey && d.defName !== d.defKey
                && <span className={`${base}-dim`}>{d.defKey}</span>}
            </td>
            <td>{typeOf(dataSource, d)}</td>
            <td>{tr('domainTab.fieldCount', { count: counts[d.id] || 0 })}</td>
            <td className={`${base}-domains-rule`}>
              <Select
                notAllowEmpty
                allowClear={false}
                disable={rules.length === 0}
                value={rule ? rule.id : ''}
                onChange={e => onBind(d.id, e.target.value)}
              >
                {[<Option key='__none' value=''>{tr('domainTab.none')}</Option>]
                  .concat(rules.map(r => <Option key={r.id} value={r.id}>{r.name}</Option>))}
              </Select>
            </td>
            <td className={`${base}-dim`}>
              {rule ? ruleSummary(tr, rule, { dicts: dataSource.dicts }) : ''}
            </td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
});
