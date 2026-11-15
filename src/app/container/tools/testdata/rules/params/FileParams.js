// The file of a `file` rule: which file, which column of it, and its first values.
import React from 'react';
import { Input, Icon, Checkbox } from 'components';
import { Row, Choice } from './common';
import { openFileOrDirPath } from '../../../../../../lib/middle';
import { problemText } from '../ruleText';
import { valueText } from '../sample';

const FILTERS = [
  { name: 'CSV / TXT', extensions: ['csv', 'txt', 'tsv'] },
  { name: '*', extensions: ['*'] },
];
const PREVIEW = 8;

// fileState = {loading, values, columns, error} read by the editor for the path in `params`
export default ({
  base, tr, params, set, setParams, fileState = {},
}) => {
  const browse = () => {
    openFileOrDirPath(FILTERS, ['openFile']).then((filePath) => {
      setParams({ ...params, path: filePath, column: 0 });
    }).catch(() => {});
  };
  const column = Number.isInteger(Number(params.column)) && Number(params.column) >= 0
    ? Number(params.column) : 0;
  const names = fileState.columns || [];
  const count = Math.max(names.length, column + 1, 1);
  const columns = Array.from({ length: count }, (v, i) => ({
    value: `${i}`,
    label: params.header && names[i] && names[i] !== `${i + 1}` ? `${i + 1} - ${names[i]}`
      : `${i + 1}`,
  }));
  const values = fileState.values || [];
  let preview = tr('hint.fileNone');
  if (params.path) {
    preview = fileState.loading ? tr('sample.fileLoading') : '';
  }
  return <React.Fragment>
    <Row base={base} label={tr('param.path')} hint={tr('hint.file')} wide>
      <Input
        value={params.path || ''}
        onChange={e => set('path', e.target.value)}
        suffix={<span className={`${base}-browse`} title={tr('action.browse')} onClick={browse}>
          <Icon type='fa-ellipsis-h'/>
        </span>}
      />
    </Row>
    <Row base={base} label={tr('param.fileColumn')}>
      <div className={`${base}-form-pair`}>
        <Choice
          value={`${column}`}
          options={columns}
          onChange={v => set('column', Number(v))}
        />
        <Checkbox
          checked={!!params.header}
          onChange={e => set('header', e.target.checked)}
        >
          <span>{tr('param.header')}</span>
        </Checkbox>
      </div>
    </Row>
    <Row base={base} label={tr('param.order')}>
      <Choice
        value={params.order === 'cycle' ? 'cycle' : 'random'}
        options={['random', 'cycle'].map(o => ({ value: o, label: tr(`order.${o}`) }))}
        onChange={v => set('order', v)}
      />
    </Row>
    <Row
      base={base}
      label={tr('hint.filePreview')}
      hint={values.length > 0 ? tr('hint.fileCount') : ''}
    >
      {fileState.error && params.path
        ? <div className={`${base}-expr-error`}>{problemText(tr, fileState.error.code)}</div>
        : <div className={`${base}-file-values`}>
          {preview || values.slice(0, PREVIEW).map((v, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <span key={i}>{valueText(v)}</span>))}
        </div>}
    </Row>
  </React.Fragment>;
};
