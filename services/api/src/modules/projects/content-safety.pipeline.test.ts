import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runContentSafetyPipeline,
  summarizeContentSafetyHits,
  toContentSafetyScanPayload,
} from './content-safety.pipeline';

test('runContentSafetyPipeline returns scanEnabled=false when disabled', async () => {
  const result = await runContentSafetyPipeline({
    text: '【硬线违禁演示】',
    traceId: 't1',
    taskKey: 'test',
    enabled: false,
  });
  assert.equal(result.scanEnabled, false);
  assert.equal(result.blocked, false);
});

test('toContentSafetyScanPayload maps final text', async () => {
  const result = await runContentSafetyPipeline({
    text: '正常文本',
    traceId: 't2',
    taskKey: 'test',
    enabled: true,
  });
  const payload = toContentSafetyScanPayload(result);
  assert.equal(payload.finalText, '正常文本');
  assert.equal(payload.blocked, false);
});

test('summarizeContentSafetyHits formats preview', () => {
  const summary = summarizeContentSafetyHits([
    {
      ruleId: 'demo-high-block',
      severity: 'high',
      startOffset: 0,
      endOffset: 1,
      matchedText: '违禁词',
      normalizedMatchedText: '违禁词',
      action: 'block',
    },
  ]);
  assert.match(summary, /「违禁词」/);
});
