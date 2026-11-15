// The rules of one library as a list: name, kind, what the rule produces and, for the
// rules of the project, how many columns and domains use it.
import React, { useEffect, useRef } from 'react';
import { Icon, Checkbox, SearchInput } from 'components';
import { tr } from './i18n';
import {
  ruleSummary, usageLabel, kindLabel, KIND_ICONS,
} from './ruleText';

export default React.memo(({
  base, rules, usage, currentId, checked, onCheck, onCheckAll, onSelect, keyword,
  onKeyword, emptyText, draft, dicts,
}) => {
  const text = `${keyword || ''}`.trim().toLowerCase();
  const shown = rules.filter(r => !text || `${r.name || ''}`.toLowerCase().includes(text)
    || kindLabel(tr, r.kind).toLowerCase().includes(text));
  // a new rule that is not stored yet leads the list
  const pending = draft && !rules.some(r => r.id === draft.id) ? draft : null;
  const allChecked = shown.length > 0 && shown.every(r => checked.includes(r.id));
  // the rule being edited stays in sight
  const body = useRef(null);
  useEffect(() => {
    const active = body.current && body.current.querySelector(`.${base}-list-item-active`);
    active && active.scrollIntoView({ block: 'nearest' });
  }, [currentId, rules.length]);
  return <div className={`${base}-list`}>
    <div className={`${base}-list-head`}>
      <Checkbox
        checked={allChecked}
        disable={shown.length === 0}
        onChange={e => onCheckAll(e.target.checked ? shown.map(r => r.id) : [])}
      />
      <SearchInput
        placeholder={tr('list.search')}
        onChange={e => onKeyword(e.target.value)}
      />
    </div>
    <div className={`${base}-list-body`} ref={body}>
      {pending && <div className={`${base}-list-item ${base}-list-item-active`}>
        <span className={`${base}-list-check`}/>
        <div className={`${base}-list-text`}>
          <div className={`${base}-list-name`}>
            <Icon type={KIND_ICONS[pending.kind] || 'fa-magic'}/>
            <span>{pending.name || tr('list.newName')}</span>
            <span className={`${base}-tag`}>{tr('list.unsaved')}</span>
          </div>
          <div className={`${base}-list-summary`}>{ruleSummary(tr, pending, { dicts })}</div>
        </div>
      </div>}
      {rules.length === 0 && !pending && <div className={`${base}-empty`}>{emptyText}</div>}
      {rules.length > 0 && shown.length === 0 && <div className={`${base}-empty`}>
        {tr('list.noMatch')}
      </div>}
      {shown.map((r) => {
        const used = usage ? usage[r.id] : null;
        const inUse = used && (used.fields.length + used.domains.length) > 0;
        return <div
          key={r.id}
          className={`${base}-list-item${currentId === r.id ? ` ${base}-list-item-active` : ''}`}
          onClick={() => onSelect(r)}
        >
          <span className={`${base}-list-check`} onClick={e => e.stopPropagation()}>
            <Checkbox checked={checked.includes(r.id)} onChange={() => onCheck(r.id)}/>
          </span>
          <div className={`${base}-list-text`}>
            <div className={`${base}-list-name`}>
              <Icon type={KIND_ICONS[r.kind] || 'fa-magic'}/>
              <span title={r.name}>{r.name}</span>
              <span className={`${base}-list-kind`}>{kindLabel(tr, r.kind)}</span>
            </div>
            <div className={`${base}-list-summary`} title={ruleSummary(tr, r, { dicts })}>
              {ruleSummary(tr, r, { dicts })}
            </div>
            {used && <div className={`${base}-list-usage${inUse ? ` ${base}-list-usage-on` : ''}`}>
              {usageLabel(tr, used)}
            </div>}
          </div>
        </div>;
      })}
    </div>
    <div className={`${base}-list-foot`}>
      {checked.length > 0 ? tr('list.checked', { count: checked.length }) : tr('list.checkHint')}
    </div>
  </div>;
});
