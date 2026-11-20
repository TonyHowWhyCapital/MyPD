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
section.cover{position:relative;width:210mm;height:296mm;margin:0 auto 24px;overflow:hidden;page-break-after:always;box-shadow:0 0 0 1px #ddd}
section.cover.landscape{width:297mm;height:209mm}
section.cover{background-size:cover;background-position:center;-webkit-print-color-adjust:exact}
section.cover>*{position:absolute;margin:0}
section.cover>div{text-align:center;white-space:pre-wrap;line-height:1.3}
@media print{section.cover{margin:0;box-shadow:none}}
@media print{body{max-width:none;margin:0}thead{display:table-header-group}tr{page-break-inside:avoid}h2,h3,h4,h5,h6{page-break-after:avoid}}
nav.toc li.l2{margin-left:16px}nav.toc li.l3{margin-left:32px}nav.toc li.l4{margin-left:48px}`;

// Placed the way the cover designer shows it, in percent of an A4 page.
export const coverStyle = (part) => {
  const half = Math.min(part.x, 100 - part.x);
  return {
    left: `${part.x - half}%`,
    width: `${half * 2}%`,
    top: `${part.y}%`,
    fontSize: `${part.size}pt`,
    fontWeight: part.bold ? 'bold' : 'normal',
    color: part.color || '#222222',
  };
};
export const logoStyle = part => ({ left: `${part.x - part.size / 2}%`, top: `${part.y}%`, width: `${part.size}%` });

const inline = style => Object.keys(style)
  .map(k => `${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}:${style[k]}`).join(';');

const coverHtml = (doc) => {
  const { background, logo, texts } = doc.cover;
  const landscape = doc.layout && doc.layout.landscape ? ' landscape' : '';
  const bg = background ? ` style="background-image:url(${background.data})"` : '';
  const img = logo ? `<img alt="" src="${logo.data}" style="${inline(logoStyle(logo))}">` : '';
  const parts = texts.map(t => `<div data-part="${t.key}" style="${inline(coverStyle(t))}">${escapeHtml(t.text)}</div>`);
  return `<section class="cover${landscape}"${bg}>${img}${parts.join('')}</section>`;
};

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
  const cover = doc.cover && coverHtml(doc);
  const top = cover || `<h1 class="title">${escapeHtml(doc.title)}</h1>
<p class="meta">${escapeHtml(labelOf('generatedTime', lang))}: ${escapeHtml(doc.generatedTime)}</p>`;
  // Word lays the report out on A4 too, and the cover is drawn to that size.
  const page = `@page{size:A4${doc.layout && doc.layout.landscape ? ' landscape' : ''}}${cover ? '@page:first{margin:0}' : ''}`;
  return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>${CSS}${page}</style></head>
<body>${top}
${body}
</body></html>`;
};
