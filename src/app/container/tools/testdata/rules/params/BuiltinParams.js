// The builtin data of a `builtin` rule: grouped, each with a value the generator made.
import React, { useMemo } from 'react';
import { Row } from './common';
import { BUILTIN_GROUPS, problemKey } from '../ruleText';
import { builtinGenerator } from '../../../../../../lib/testdata/builtin';
import { createRandom } from '../../../../../../lib/testdata/random';
import { valueText } from '../sample';

// the same example every time the list is opened
const exampleOf = (name) => {
  const generate = builtinGenerator(name);
  return generate ? valueText(generate(createRandom(7).fork(name))) : '';
};

export default ({
  base, tr, params, setParams,
}) => {
  const groups = useMemo(() => BUILTIN_GROUPS.map(g => ({
    ...g,
    items: g.names.map(name => ({ name, example: exampleOf(name) })),
  })), []);
  return <Row base={base} label={tr('param.builtin')} wide>
    <div className={`${base}-builtin`}>
      {groups.map(g => (
        <div key={g.key} className={`${base}-builtin-group`}>
          <div className={`${base}-builtin-title`}>{tr(`builtinGroup.${g.key}`)}</div>
          <div className={`${base}-builtin-items`}>
            {g.items.map(item => (
              <div
                key={item.name}
                title={item.example}
                className={`${base}-builtin-item${params.name === item.name
                  ? ` ${base}-builtin-list-item-active` : ''}`}
                onClick={() => setParams({ ...params, name: item.name })}
              >
                <span>{tr(`builtin.${problemKey(item.name)}`)}</span>
                <span className={`${base}-builtin-example`}>{item.example}</span>
              </div>))}
          </div>
        </div>))}
    </div>
  </Row>;
};
