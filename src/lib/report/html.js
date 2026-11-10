import { labelOf } from './labels';

export const escapeHtml = v => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#222;line-height:1.5}
h1.title{border-bottom:2px solid #444;padding-bottom:8px}
.meta{color:#777;font-size:13px}
table{border-collapse:collapse;width:100%;margin:8px 0 20px;font-size:14px}
th,td{border:1px solid #bbb;padding:4px 8px;text-align:left;vertical-align:top;white-space:pre-wrap}
th{background:#f0f2f5}
nav.toc ul{list-style:none;padding-left:0}
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
      const head = b.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
      const rows = b.rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    return '';
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>${CSS}</style></head>
<body><h1 class="title">${escapeHtml(doc.title)}</h1>
<p class="meta">${escapeHtml(labelOf('generatedTime', lang))}: ${escapeHtml(doc.generatedTime)}</p>
${body}
</body></html>`;
};
