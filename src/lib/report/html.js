import { labelOf } from './labels';
import { columnPercents } from './sections';
import { cssText } from './style';

export const escapeHtml = v => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#222;line-height:1.5}
h1.title{border-bottom:2px solid #444;padding-bottom:8px}
.meta{color:#777;font-size:13px}
table{border-collapse:collapse;width:100%;margin:8px 0 20px;font-size:14px}
th,td{border:1px solid #bbb;padding:4px 8px;text-align:left;vertical-align:top;white-space:pre-wrap}
th{background:#f0f2f5;text-align:center}
td.center{text-align:center}td.right{text-align:right}
table.sized{table-layout:fixed}table.sized th,table.sized td{word-break:break-all}
nav.toc ul{list-style:none;padding-left:0}
section.cover{min-height:90vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;page-break-after:always}
section.cover{background-size:cover;background-position:center;-webkit-print-color-adjust:exact}
section.cover img{max-width:240px;max-height:140px;margin-bottom:32px}
section.cover h1{font-size:40px;border-bottom:3px solid #444;padding:0 24px 16px;margin-bottom:16px}
section.cover .sub{font-size:22px;color:#555;margin:0 0 96px}
section.cover dl{margin:0;font-size:16px}section.cover dl div{margin:6px 0}
section.cover dt,section.cover dd{display:inline;margin:0}
@media print{body{max-width:none;margin:0}thead{display:table-header-group}tr{page-break-inside:avoid}h2,h3,h4,h5,h6{page-break-after:avoid}}
nav.toc li.l2{margin-left:16px}nav.toc li.l3{margin-left:32px}nav.toc li.l4{margin-left:48px}`;

export const renderHtml = (doc) => {
  const lang = doc.lang || 'zh';
  const headings = doc.blocks.filter(b => b.type === 'heading');
  let counter = 0;
  const body = doc.blocks.map((b) => {
    if (b.type === 'heading') {
      const level = Math.min(b.level + 1, 6);
      counter += 1;
      return `<h${level} id="h-${counter}">${escapeHtml(b.text)}</h${level}>`;
    }
    if (b.type === 'paragraph') return `<p>${escapeHtml(b.text).replace(/\r?\n/g, '<br>')}</p>`;
    if (b.type === 'toc') {
      const items = headings.map((h, i) => `<li class="l${h.level}"><a href="#h-${i + 1}">${escapeHtml(h.text)}</a></li>`);
      return `<nav class="toc"><strong>${escapeHtml(labelOf('contents', lang))}</strong><ul>${items.join('')}</ul></nav>`;
    }
    if (b.type === 'table') {
      const headCss = i => [(b.headAligns || [])[i] && b.headAligns[i] !== 'center' ? `text-align:${b.headAligns[i]}` : '',
        cssText((b.headStyles || [])[i])].filter(Boolean).join(';');
      const head = b.headers.map((h, i) => `<th${headCss(i) ? ` style="${headCss(i)}"` : ''}>${escapeHtml(h)}</th>`).join('');
      const aligns = b.aligns || [];
      const styles = (b.styles || []).map(cssText);
      const td = i => `<td${aligns[i] && aligns[i] !== 'left' ? ` class="${aligns[i]}"` : ''}${styles[i] ? ` style="${styles[i]}"` : ''}>`;
      const rows = b.rows.map(r => `<tr>${r.map((c, i) => `${td(i)}${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
      const percents = columnPercents(b.widths, b.headers.length);
      const cols = percents
        ? `<colgroup>${percents.map(p => `<col style="width:${p}%">`).join('')}</colgroup>` : '';
      return `<table${percents ? ' class="sized"' : ''}>${cols}<thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    return '';
  }).join('\n');
  const bg = doc.cover && doc.cover.background ? ` style="background-image:url(${doc.cover.background.data})"` : '';
  const logo = doc.cover && doc.cover.logo ? `<img alt="" src="${doc.cover.logo.data}">` : '';
  const cover = doc.cover && `<section class="cover"${bg}>${logo}<h1>${escapeHtml(doc.title)}</h1>
${doc.cover.subtitle ? `<p class="sub">${escapeHtml(doc.cover.subtitle)}</p>` : ''}
<dl>${doc.cover.rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}：</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>`;
  const top = cover || `<h1 class="title">${escapeHtml(doc.title)}</h1>
<p class="meta">${escapeHtml(labelOf('generatedTime', lang))}: ${escapeHtml(doc.generatedTime)}</p>`;
  const page = doc.layout && doc.layout.landscape ? '@page{size:A4 landscape}' : '';
  return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>${CSS}${page}</style></head>
<body>${top}
${body}
</body></html>`;
};
