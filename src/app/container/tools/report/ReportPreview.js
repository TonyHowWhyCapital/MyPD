import React, { useMemo, useRef, useState } from 'react';
import { Button, FormatMessage, Icon } from 'components';
import {
  buildReport, labelOf, columnPercents, dragColumn, widthsOf, applyWidths, clearWidths, hasWidths,
  nextAlign, setColumnAlign, cssOf,
} from '../../../../lib/report';
import { getPrefix } from '../../../../lib/prefixUtil';

// A long table adds nothing to judging the layout.
const MAX_ROWS = 50;
const percentText = p => `${Math.round(p)}%`;

const original = (block, i) => ((block.renamed || [])[i]
  ? FormatMessage.string({ id: 'report.originalName', data: { name: block.renamed[i] } }) : undefined);

const Table = ({ cls, block, onDrag, onAlign }) => {
  const aligns = block.aligns || [];
  const percents = columnPercents(block.widths, block.headers.length);
  const rows = block.rows.slice(0, MAX_ROWS);
  return <React.Fragment>
    <table className={percents ? 'sized' : ''} data-section={block.sectionId || ''}>
      <colgroup>
        {block.headers.map((h, i) => <col key={i} style={{ width: percents ? `${percents[i]}%` : '' }}/>)}
      </colgroup>
      <thead>
        <tr>{block.headers.map((h, i) => <th
          key={i}
          style={{ textAlign: (block.headAligns || [])[i], ...cssOf((block.headStyles || [])[i]) }}
        >
          <span title={original(block, i)} className={original(block, i) ? 'renamed' : ''}>{h}</span>
          {block.keys && block.keys[i] && <Icon
            type={`fa-align-${aligns[i]}`}
            title={FormatMessage.string({ id: 'report.alignTip' })}
            onClick={() => onAlign(block, i)}
          />}
          {block.sectionId && <small>{percents ? percentText(percents[i]) : ''}</small>}
          {block.sectionId && i < block.headers.length - 1
            && <span className={`${cls}-handle`} onMouseDown={e => onDrag(e, block, i)}/>}
        </th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, n) => <tr key={n}>{r.map((c, i) => <td key={i} style={{ textAlign: aligns[i] || 'left', ...cssOf((block.styles || [])[i]) }}>{c}</td>)}</tr>)}
      </tbody>
    </table>
    {block.rows.length > MAX_ROWS && <div className={`${cls}-more`}>
      {FormatMessage.string({ id: 'report.previewRows', data: { count: MAX_ROWS, total: block.rows.length } })}
    </div>}
  </React.Fragment>;
};

const Blocks = ({ cls, doc, onDrag, onAlign }) => {
  const headings = doc.blocks.filter(b => b.type === 'heading');
  return doc.blocks.map((b, n) => {
    if (b.type === 'heading') {
      const Tag = `h${Math.min(b.level + 1, 6)}`;
      return <Tag key={n}>{b.text}</Tag>;
    }
    if (b.type === 'paragraph') return <p key={n}>{b.text}</p>;
    if (b.type === 'toc') {
      return <ul key={n} className={`${cls}-toc`}>
        <li><strong>{labelOf('contents', doc.lang)}</strong></li>
        {headings.map((h, i) => <li key={i} style={{ marginLeft: (h.level - 1) * 16 }}>{h.text}</li>)}
      </ul>;
    }
    return b.type === 'table' ? <Table key={n} cls={cls} block={b} onDrag={onDrag} onAlign={onAlign}/> : null;
  });
};

// The report as it will be laid out in docx and html. Dragging a header border resizes
// every table of that section and writes the widths back into the template.
export default ({
  prefix, template, models, lang, onChange,
}) => {
  const cls = `${getPrefix(prefix)}-report-preview`;
  const paper = useRef(null);
  const [tpl, setTpl] = useState(template);
  const doc = useMemo(() => buildReport(tpl, models, { lang }), [tpl]);
  const update = (next) => {
    setTpl(next);
    onChange(next);
  };
  // While dragging the columns are moved in the DOM, so a large report stays smooth.
  const show = (sectionId, percents) => {
    paper.current.querySelectorAll(`table[data-section="${sectionId}"]`).forEach((table) => {
      table.classList.add('sized');
      table.querySelectorAll('col').forEach((col, i) => { col.style.width = `${percents[i]}%`; });
      table.querySelectorAll('th > small').forEach((el, i) => { el.textContent = percentText(percents[i]); });
    });
  };
  const onDrag = (e, block, index) => {
    e.preventDefault();
    const cells = Array.from(e.currentTarget.closest('tr').children)
      .map(th => th.getBoundingClientRect().width);
    const total = cells.reduce((sum, w) => sum + w, 0);
    const start = cells.map(w => (w / total) * 100);
    const x = e.clientX;
    let current = null;
    const move = (ev) => {
      current = dragColumn(start, index, ((ev.clientX - x) / total) * 100);
      show(block.sectionId, current);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      current && update(applyWidths(tpl, block.sectionId, widthsOf(block.keys, current)));
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  const onAlign = (block, i) => {
    const key = block.keys[i];
    update({
      ...tpl,
      sections: tpl.sections.map(s => (s.id === block.sectionId
        ? { ...s, aligns: setColumnAlign(s, key, nextAlign(block.aligns[i])) } : s)),
    });
  };
  return <div className={cls}>
    <div className={`${cls}-bar`}>
      <span>
        <span><Icon type='fa-arrows-h'/><FormatMessage id='report.previewTip'/></span>
        <span><Icon type='fa-align-left'/><FormatMessage id='report.previewTipAlign'/></span>
        <span><Icon type='fa-info-circle'/><FormatMessage id='report.previewTipKeep'/></span>
      </span>
      <Button disable={!hasWidths(tpl)} onClick={() => update(clearWidths(tpl))}>
        <FormatMessage id='report.previewReset'/>
      </Button>
    </div>
    <div className={`${cls}-scroll`}>
      <div className={`${cls}-paper`} ref={paper}>
        <h1>{doc.title}</h1>
        <div className={`${cls}-more`}>{labelOf('generatedTime', lang)}: {doc.generatedTime}</div>
        <Blocks cls={cls} doc={doc} onDrag={onDrag} onAlign={onAlign}/>
      </div>
    </div>
  </div>;
};
