// Settings of the whole run: the default number of rows and the seed.
import React from 'react';
import {
  Icon, NumberInput, Radio, Tooltip,
} from 'components';
import { tr } from './i18n';
import { MAX_ROWS, MAX_SEED, dayText } from './settings';

const { RadioGroup } = Radio;

export default React.memo(({
  base, settings, setSettings, setBaseDate,
}) => {
  const today = dayText();
  const setSeed = patch => setSettings({
    ...settings,
    seed: { ...settings.seed, ...patch },
  });
  return <div className={`${base}-settings`}>
    <span className={`${base}-settings-item`}>
      <Tooltip title={tr('settings.defaultRowsHint')} force placement='top'>
        <span className={`${base}-settings-label`}>
          {tr('settings.defaultRows')} <Icon type='fa-question-circle-o'/>
        </span>
      </Tooltip>
      <NumberInput
        value={settings.defaultRows}
        min={1}
        max={MAX_ROWS}
        maxLength={7}
        onChange={e => e.target.value !== '' && setSettings({
          ...settings,
          defaultRows: e.target.value,
        })}
      />
    </span>
    <span className={`${base}-settings-item`}>
      <Tooltip title={tr('settings.seedHint')} force placement='top'>
        <span className={`${base}-settings-label`}>
          {tr('settings.seed')} <Icon type='fa-question-circle-o'/>
        </span>
      </Tooltip>
      <RadioGroup
        value={settings.seed.fixed ? 'fixed' : 'random'}
        onChange={e => setSeed({ fixed: e.target.value === 'fixed' })}
      >
        <Radio value='fixed'>{tr('settings.seedFixed')}</Radio>
        <Radio value='random'>{tr('settings.seedRandom')}</Radio>
      </RadioGroup>
      {settings.seed.fixed && <NumberInput
        value={settings.seed.value}
        min={0}
        max={MAX_SEED}
        maxLength={10}
        onChange={e => e.target.value !== '' && setSeed({ value: e.target.value })}
      />}
      {settings.seed.fixed && settings.seed.baseDate && <span
        className={`${base}-dim ${base}-settings-base`}
        title={tr('settings.baseDateHint')}
      >
        {tr('settings.baseDate', { date: settings.seed.baseDate })}
        {settings.seed.baseDate !== today
          && <a onClick={() => setBaseDate(today)}>{tr('settings.baseToday')}</a>}
      </span>}
    </span>
  </div>;
});
