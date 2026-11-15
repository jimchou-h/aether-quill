import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeHtml, renderMarkdownToSafeHtml } from './renderMarkdown';

test('escapeHtml neutralizes script tags', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('renderMarkdownToSafeHtml renders headings and lists', () => {
  const html = renderMarkdownToSafeHtml('# Title\n\n- item one\n- item two');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>item one<\/li>/);
});

test('renderMarkdownToSafeHtml does not execute raw html', () => {
  const html = renderMarkdownToSafeHtml('<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('renderMarkdownToSafeHtml renders inline emphasis', () => {
  const html = renderMarkdownToSafeHtml('**bold** and `code`');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
});

test('renderMarkdownToSafeHtml renders blockquotes with block content inside', () => {
  const html = renderMarkdownToSafeHtml('> 引用原文：**案上那封没有署名的信**\n> - 附带一条观察');
  assert.match(html, /<blockquote>/);
  assert.match(html, /<strong>案上那封没有署名的信<\/strong>/);
  assert.match(html, /<li>附带一条观察<\/li>/);
});

test('renderMarkdownToSafeHtml renders pipe tables', () => {
  const html = renderMarkdownToSafeHtml(
    '| 建议 | 状态 |\n| --- | --- |\n| 拆信提前 | 已解决 |\n| 开场节奏 | `未解决` |'
  );
  assert.match(html, /<table>/);
  assert.match(html, /<th>建议<\/th>/);
  assert.match(html, /<td>拆信提前<\/td>/);
  assert.match(html, /<td><code>未解决<\/code><\/td>/);
});

test('renderMarkdownToSafeHtml keeps fenced code literal', () => {
  const html = renderMarkdownToSafeHtml('```markdown\n他推门而入。\n<b>不是标签</b>\n```');
  assert.equal(html, '<pre><code>他推门而入。\n&lt;b&gt;不是标签&lt;/b&gt;</code></pre>');
});

test('renderMarkdownToSafeHtml renders horizontal rules but keeps list markers', () => {
  assert.match(renderMarkdownToSafeHtml('---'), /<hr>/);
  assert.match(renderMarkdownToSafeHtml('- 一条建议'), /<li>一条建议<\/li>/);
});

test('renderMarkdownToSafeHtml escapes html inside table cells', () => {
  const html = renderMarkdownToSafeHtml('| 列 |\n| --- |\n| <img src=x onerror=alert(1)> |');
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
});
