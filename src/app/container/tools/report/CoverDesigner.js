import React, { useState } from 'react';
import {
  Button, Checkbox, FormatMessage, Input, NumberInput, Select,
} from 'components';
import {
  layoutOf, setLayout, coverPartsOf, COVER_ITEMS, COVER_SIZES, LOGO_SIZES, setCoverItem,
  resetCoverPlaces,
} from '../../../../lib/report';
import { getPrefix } from '../../../../lib/prefixUtil';
import CoverPage from './CoverPage';
import ColorField from './ColorField';
import './style/cover.less';

const Option = Select.Option;
const text = (id, data) => FormatMessage.string({ id: `report.cover.${id}`, data });
// The layout field that holds the text of a part; the date is the day of the report.
const FIELD = {
  title: 'coverTitle', subtitle: 'subtitle', organization: 'organization', author: 'author', version: 'version',
};
const COLUMNS = ['item', 'content', 'show', 'size', 'bold', 'color', 'x', 'y'];
const pad = n => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Every part of the cover in a row of its own: text, size, weight, colour and place. The
// page on the right shows the result and takes the parts by dragging.
export default ({
  prefix, template, modelName, lang, onChange,
}) => {
  const currentPrefix = getPrefix(prefix);
  const cls = `${currentPrefix}-report-cover`;
  const [tpl, setTpl] = useState(template);
  const [selected, setSelected] = useState('title');
  const layout = layoutOf(tpl);
  const parts = coverPartsOf(layout, today(), lang, modelName);
  const commit = (next) => {
    setTpl(next);
    onChange(next);
  };
  const setItem = (key, change) => commit(setLayout(tpl, {
    coverItems: setCoverItem(layout.coverItems, key, change),
  }));
  const partName = key => text(`parts.${key}`);
  const content = (key) => {
    if (key === 'logo') {
      return layout.logo
        ? <img className={`${cls}-thumb`} alt='' src={layout.logo.data}/>
        : <i className={`${cls}-muted`}>{text('noLogo')}</i>;
    }
    if (key === 'date') return <i className={`${cls}-muted`}>{text('dateText')}</i>;
    return <Input
      value={layout[FIELD[key]]}
      placeholder={key === 'title' ? modelName : ''}
      onChange={e => commit(setLayout(tpl, { [FIELD[key]]: e.target.value }))}
    />;
  };
  const row = (key) => {
    const item = layout.coverItems[key];
    const isLogo = key === 'logo';
    return <tr
      key={key}
      className={selected === key ? 'picked' : ''}
      onClick={() => setSelected(key)}
    >
      <td>{partName(key)}</td>
      <td className='content'>{content(key)}</td>
      <td className='center'>
        <Checkbox
          checked={!item.hidden}
          onChange={e => setItem(key, { hidden: !e.target.checked })}
        />
      </td>
      <td>
        <Select
          notAllowEmpty
          value={item.size}
          onChange={e => setItem(key, { size: Number(e.target.value) })}
        >
          {(isLogo ? LOGO_SIZES : COVER_SIZES).map(s => <Option key={s} value={s}>
            {isLogo ? text('sizeLogo', { size: s }) : `${s} pt`}
          </Option>)}
        </Select>
      </td>
      <td className='center'>
        {!isLogo && <Checkbox
          checked={item.bold}
          onChange={e => setItem(key, { bold: e.target.checked })}
        />}
      </td>
      <td>
        {!isLogo && <ColorField
          cls={`${currentPrefix}-report-design`}
          value={item.color}
          fallback='#222222'
          onChange={color => setItem(key, { color })}
        />}
      </td>
      {['x', 'y'].map(axis => <td key={axis} className='number'>
        <NumberInput
          value={Math.round(item[axis])}
          min={0}
          max={100}
          maxLength={3}
          onChange={e => e.target.value !== '' && setItem(key, { [axis]: e.target.value })}
        />
      </td>)}
    </tr>;
  };
  return <div className={cls}>
    <div className={`${cls}-side`}>
      <div className={`${cls}-tip`}>{text('tip')}</div>
      <table>
        <thead>
          <tr>{COLUMNS.map(h => <th key={h}>{text(h)}</th>)}</tr>
        </thead>
        <tbody>{COVER_ITEMS.map(row)}</tbody>
      </table>
      <Button onClick={() => commit(setLayout(tpl, {
        coverItems: resetCoverPlaces(layout.coverItems),
      }))}
      >
        {text('reset')}
      </Button>
    </div>
    <CoverPage
      cls={cls}
      cover={{
        texts: parts.texts.filter(t => !t.hidden),
        logo: parts.logo && !parts.logo.hidden ? parts.logo : null,
        background: layout.background,
      }}
      landscape={layout.landscape}
      width={layout.landscape ? 520 : 400}
      selected={selected}
      placeholder={key => `（${partName(key)}）`}
      onSelect={setSelected}
      onMove={(key, x, y) => setItem(key, { x, y })}
    />
  </div>;
};
