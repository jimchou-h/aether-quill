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
