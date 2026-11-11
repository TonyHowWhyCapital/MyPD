import { labelOf } from './labels';

const RULES = { center: ':---:', right: '---:' };
const cell = v => String(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export const collectHeadings = doc => doc.blocks.filter(b => b.type === 'heading');

export const renderMarkdown = (doc) => {
  const lang = doc.lang || 'zh';
  const out = [`# ${doc.title}`, '', `> ${labelOf('generatedTime', lang)}: ${doc.generatedTime}`, ''];
  doc.blocks.forEach((b) => {
    if (b.type === 'heading') {
      out.push(`${'#'.repeat(Math.min(b.level + 1, 6))} ${b.text}`, '');
    } else if (b.type === 'paragraph') {
      out.push(b.text, '');
    } else if (b.type === 'toc') {
      out.push(`**${labelOf('contents', lang)}**`, '');
      collectHeadings(doc).forEach(h => out.push(`${'  '.repeat(h.level - 1)}- ${h.text}`));
      out.push('');
    } else if (b.type === 'table' && b.headers.length) {
      out.push(`| ${b.headers.map(cell).join(' | ')} |`, `| ${b.headers.map((h, i) => RULES[(b.aligns || [])[i]] || '---').join(' | ')} |`);
      b.rows.forEach(r => out.push(`| ${r.map(cell).join(' | ')} |`));
      out.push('');
    }
  });
  return out.join('\n');
};
