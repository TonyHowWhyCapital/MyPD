/**
 * @jest-environment jsdom
 */
const { escapeHtml, highlightHtml } = require('../src/lib/string');
const { markdownToHtml } = require('../src/components/ercanvas/components/util');

describe('search highlight', () => {
  test('wraps every case-insensitive match and keeps the rest', () => {
    expect(highlightHtml('UserUSER', 'user', 'hl'))
      .toBe('<span><span class="hl">User</span><span class="hl">USER</span></span>');
  });

  test('escapes names that carry markup', () => {
    const html = highlightHtml('<img src=x onerror=alert(1)>', 'img', 'hl');
    expect(html).not.toContain('<img');
    expect(html).toBe('<span>&lt;<span class="hl">img</span> src=x onerror=alert(1)&gt;</span>');
  });

  test('treats regex characters in the search as plain text', () => {
    expect(highlightHtml('a.b(c)', '(c)', 'hl')).toBe('<span>a.b<span class="hl">(c)</span></span>');
  });

  test('handles empty values', () => {
    expect(highlightHtml(undefined, 'x', 'hl')).toBe('<span></span>');
    expect(highlightHtml('a&b', '', 'hl')).toBe('<span>a&amp;b</span>');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('markdown notes', () => {
  test('still renders markdown with the canvas styles', () => {
    const html = markdownToHtml('**bold**\n\n- item', { breaks: true });
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('style="margin: 5px"');
    expect(html).toContain('list-style: circle');
  });

  test('strips script and event handlers', () => {
    const html = markdownToHtml('<img src=x onerror="require(\'child_process\')"><script>alert(1)</script>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
  });

  test('accepts an empty note', () => {
    expect(markdownToHtml(undefined)).toBe('');
  });
});
