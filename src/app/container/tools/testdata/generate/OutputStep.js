// Step 3: where the rows go. Any of the outputs can be combined; they all get the same data.
import React from 'react';
import {
  Checkbox, Icon, Input, Select,
} from 'components';
import { rowsPerStatement } from '../../../../../lib/testdata/sql';
import { tr } from './i18n';
import { pickFile, pickFolder } from './io';

const { Option } = Select;

const Section = ({
  base, on, onToggle, icon, title, hint, disabled, children,
}) => (
  <div className={`${base}-output${on ? ` ${base}-output-on` : ''}${disabled
    ? ` ${base}-output-off` : ''}`}>
    <div className={`${base}-output-head`} onClick={() => !disabled && onToggle(!on)}>
      <Checkbox checked={on} disable={disabled} onChange={() => onToggle(!on)}/>
      <Icon type={icon}/>
      <span className={`${base}-output-title`}>{title}</span>
      <span className={`${base}-dim`}>{hint}</span>
    </div>
    {(on || disabled) && children && <div className={`${base}-output-body`}>{children}</div>}
  </div>
);

const PathRow = ({
  base, label, value, problem, onChange, onBrowse,
}) => (
  <div className={`${base}-field`}>
    <span className={`${base}-field-label`}>{label}</span>
    <div className={`${base}-field-control`}>
      <div className={`${base}-path`}>
        <Input value={value} onChange={e => onChange(e.target.value)}/>
        <a onClick={onBrowse}><Icon type='fa-folder-open-o'/>{tr('output.browse')}</a>
      </div>
      {problem && <div className={`${base}-bad`}>{tr(`output.path.${problem}`)}</div>}
    </div>
  </div>
);

export default React.memo(({
  base, out, setOut, dialect, dialectName, pathProblems, conns, conn, target, onConn,
  onConnSettings,
}) => {
  const set = patch => setOut({ ...out, ...patch });
  const browseFile = (key, name, ext) => pickFile(out[`${key}Path`], name, ext)
    .then(file => file && set({ [`${key}Path`]: file }));
  const browseFolder = () => pickFolder(out.csvPath).then(dir => dir && set({ csvPath: dir }));
  const canMulti = rowsPerStatement(dialect, true) > 1;
  const noConn = conns.length === 0;
  return <div className={`${base}-outputs`}>
    <div className={`${base}-outputs-intro`}>
      {tr('output.intro')}
      {dialect === 'generic' && <div className={`${base}-warn`}>
        <Icon type='fa-exclamation-triangle'/>{tr('output.generic')}
      </div>}
    </div>
    <Section
      base={base}
      on={out.sql}
      onToggle={sql => set({ sql })}
      icon='fa-file-code-o'
      title={tr('output.sql')}
      hint={tr('output.sqlHint', { dialect: dialectName(dialect) })}
    >
      <PathRow
        base={base}
        label={tr('output.file')}
        value={out.sqlPath}
        problem={pathProblems.sql}
        onChange={sqlPath => set({ sqlPath })}
        onBrowse={() => browseFile('sql', 'SQL', 'sql')}
      />
      <div className={`${base}-field`}>
        <span className={`${base}-field-label`}>{tr('output.options')}</span>
        <div className={`${base}-field-control ${base}-checks`}>
          <Checkbox
            checked={canMulti && (out.multiRow === undefined
              ? rowsPerStatement(dialect) > 1 : out.multiRow)}
            disable={!canMulti}
            onChange={e => set({ multiRow: e.target.checked })}
          >
            <span className={`${base}-check-label`}>{tr('output.multiRow')}</span>
          </Checkbox>
          <span className={`${base}-dim`}>
            {canMulti ? tr('output.multiRowHint') : tr('output.multiRowOff')}
          </span>
          {dialect === 'mssql' && <React.Fragment>
            <Checkbox checked={out.go} onChange={e => set({ go: e.target.checked })}>
              <span className={`${base}-check-label`}>{tr('output.go')}</span>
            </Checkbox>
            <span className={`${base}-dim`}>{tr('output.goHint')}</span>
          </React.Fragment>}
        </div>
      </div>
    </Section>
    <Section
      base={base}
      on={out.csv}
      onToggle={csv => set({ csv })}
      icon='fa-file-text-o'
      title={tr('output.csv')}
      hint={tr('output.csvHint')}
    >
      <PathRow
        base={base}
        label={tr('output.folder')}
        value={out.csvPath}
        problem={pathProblems.csv}
        onChange={csvPath => set({ csvPath })}
        onBrowse={browseFolder}
      />
    </Section>
    <Section
      base={base}
      on={out.xlsx}
      onToggle={xlsx => set({ xlsx })}
      icon='fa-file-excel-o'
      title={tr('output.xlsx')}
      hint={tr('output.xlsxHint')}
    >
      <PathRow
        base={base}
        label={tr('output.file')}
        value={out.xlsxPath}
        problem={pathProblems.xlsx}
        onChange={xlsxPath => set({ xlsxPath })}
        onBrowse={() => browseFile('xlsx', 'Excel', 'xlsx')}
      />
    </Section>
    <Section
      base={base}
      on={out.db && !noConn}
      onToggle={db => set({ db })}
      disabled={noConn}
      icon='fa-database'
      title={tr('output.db')}
      hint={tr('output.dbHint')}
    >
      {noConn ? <div className={`${base}-field`}>
        <span className={`${base}-field-label`}/>
        <div className={`${base}-field-control`}>
          <span>{tr('output.noConn')}</span>
          <a onClick={onConnSettings}>{tr('output.connSettings')}</a>
        </div>
      </div> : <React.Fragment>
        <div className={`${base}-field`}>
          <span className={`${base}-field-label`}>{tr('output.conn')}</span>
          <div className={`${base}-field-control ${base}-conn`}>
            {conns.length > 1 ? <Select
              notAllowEmpty
              allowClear={false}
              value={conn ? conn.defKey : ''}
              onChange={e => onConn(e.target.value)}
            >
              {conns.map(c => (
                <Option key={c.defKey} value={c.defKey}>{c.defName || c.defKey}</Option>))}
            </Select> : <b>{target ? target.name : ''}</b>}
            <a onClick={onConnSettings}>{tr('output.connSettings')}</a>
          </div>
        </div>
        {target && <div className={`${base}-field`}>
          <span className={`${base}-field-label`}>{tr('output.target')}</span>
          <div className={`${base}-field-control ${base}-target`}>
            {target.host && <span><i>{tr('confirm.host')}</i>{target.host}</span>}
            {target.database && <span><i>{tr('confirm.database')}</i>{target.database}</span>}
            {!target.host && <span>{target.address || tr('output.noAddress')}</span>}
          </div>
        </div>}
        {target && !target.complete && <div className={`${base}-field`}>
          <span className={`${base}-field-label`}/>
          <div className={`${base}-field-control ${base}-bad`}>{tr('output.connIncomplete')}</div>
        </div>}
        {target && target.dialect !== dialect && target.dialect !== 'generic'
          && <div className={`${base}-field`}>
            <span className={`${base}-field-label`}/>
            <div className={`${base}-field-control ${base}-warn`}>
              <Icon type='fa-exclamation-triangle'/>
              {tr('output.dialectDiffers', {
                conn: dialectName(target.dialect),
                project: dialectName(dialect),
              })}
            </div>
          </div>}
        <div className={`${base}-field`}>
          <span className={`${base}-field-label`}/>
          <div className={`${base}-field-control ${base}-dim`}>{tr('output.dbNext')}</div>
        </div>
      </React.Fragment>}
    </Section>
  </div>;
});
