import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLowRiskReplacements,
  buildNormalizedTextIndex,
  extractSentenceAtOffset,
  processContentSafety,
  scanContentSafety,
} from './index';

test('buildNormalizedTextIndex maps full-width and case', () => {
  const { normalized, indexMap } = buildNormalizedTextIndex('ＡＢ　Ｃ');
  assert.equal(normalized, 'ab c');
  assert.equal(indexMap[0], 0);
});

test('scanContentSafety finds keyword hits with original offsets', () => {
  const text = '前文【硬线违禁演示】后文';
  const result = scanContentSafety(text);
  assert.equal(result.hasHigh, true);
  assert.equal(result.hits[0]?.matchedText, '【硬线违禁演示】');
  assert.ok((result.hits[0]?.startOffset ?? -1) > 0);
});

test('scanContentSafety respects whitelist window', () => {
  const text = '教学内容：【可替换演示】（白名单：教学内容）';
  const result = scanContentSafety(text, [
    {
      ruleId: 'demo-low-replace',
      severity: 'low',
      action: 'replace',
      type: 'keyword',
      pattern: '【可替换演示】',
      replacement: '[已处理]',
      whitelist: ['教学内容'],
    },
  ]);
  assert.equal(result.hits.length, 0);
});

test('applyLowRiskReplacements replaces low-risk tokens', () => {
  const text = '出现【可替换演示】词语';
  const hits = scanContentSafety(text).hits;
  const replaced = applyLowRiskReplacements(text, hits);
  assert.match(replaced, /\[已处理\]/);
  assert.doesNotMatch(replaced, /【可替换演示】/);
});

test('extractSentenceAtOffset returns sentence boundaries', () => {
  const text = '第一句。第二句【中风险演示】！第三句';
  const offset = text.indexOf('【中风险演示】');
  const extracted = extractSentenceAtOffset(text, offset);
  assert.match(extracted.sentence, /第二句/);
});

test('processContentSafety skips when disabled', async () => {
  const result = await processContentSafety('【硬线违禁演示】', { enabled: false });
  assert.equal(result.scanEnabled, false);
  assert.equal(result.blocked, false);
  assert.equal(result.text, '【硬线违禁演示】');
});

test('processContentSafety blocks high severity', async () => {
  const result = await processContentSafety('【硬线违禁演示】', { enabled: true });
  assert.equal(result.blocked, true);
  assert.match(result.blockReason || '', /高风险/);
});

test('processContentSafety rewrites medium severity and rescans', async () => {
  const result = await processContentSafety('他喊道：【中风险演示】', {
    enabled: true,
    rewriteSentence: async () => '他低声提醒同伴注意前方。',
  });
  assert.equal(result.blocked, false);
  assert.equal(result.rewriteAttempts, 1);
  assert.doesNotMatch(result.text, /【中风险演示】/);
});

test('processContentSafety rewrites all unique medium sentences in one batch', async () => {
  const text = '第一句【中风险演示】。第二句【中风险演示】！第三句【中风险演示】？';
  const rewritten = new Set<string>();
  const result = await processContentSafety(text, {
    enabled: true,
    rewriteSentence: async (sentence) => {
      rewritten.add(sentence);
      return sentence.replace(/【中风险演示】/g, '');
    },
  });
  assert.equal(result.blocked, false);
  assert.equal(result.rewriteAttempts, 3);
  assert.equal(rewritten.size, 3);
  assert.doesNotMatch(result.text, /【中风险演示】/);
});

test('processContentSafety dedupes multiple medium hits in the same sentence', async () => {
  let rewriteCalls = 0;
  const result = await processContentSafety('他喊道：【中风险演示】，又一次【中风险演示】！', {
    enabled: true,
    rewriteSentence: async (sentence) => {
      rewriteCalls += 1;
      return sentence.replace(/【中风险演示】/g, '');
    },
  });
  assert.equal(result.blocked, false);
  assert.equal(rewriteCalls, 1);
  assert.equal(result.rewriteAttempts, 1);
  assert.doesNotMatch(result.text, /【中风险演示】/);
});

test('processContentSafety blocks after max rewrite batches', async () => {
  const result = await processContentSafety('他喊道：【中风险演示】', {
    enabled: true,
    rewriteSentence: async (sentence) => sentence,
  });
  assert.equal(result.blocked, true);
  assert.match(result.blockReason || '', /批量改写后仍未通过/);
  assert.equal(result.rewriteAttempts, 3);
});
