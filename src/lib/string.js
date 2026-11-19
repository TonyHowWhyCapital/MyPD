export const firstUp = (str) => {
  return str.split('').map((s, i) => {
    if (i === 0) {
      return s.toLocaleUpperCase();
    }
    return s;
  }).join('');
}

const htmlEntities = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
export const escapeHtml = str => String(str == null ? '' : str).replace(/[&<>"']/g, c => htmlEntities[c]);

// 把 text 中与 search（忽略大小写）相同的片段包上高亮 span；名称可能来自项目文件或数据库，先转义再拼接
export const highlightHtml = (text, search, className) => {
  const value = String(text == null ? '' : text);
  if (!search) {
    return `<span>${escapeHtml(value)}</span>`;
  }
  const reg = new RegExp(`(${search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'ig');
  const html = value.split(reg).map((part, i) => (i % 2 === 1
    ? `<span class="${className}">${escapeHtml(part)}</span>`
    : escapeHtml(part))).join('');
  return `<span>${html}</span>`;
};
