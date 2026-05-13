import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countChunkTokens,
  mergeNewlinesInsideDialogue,
  segmentForIngestion,
  splitParagraphByTokens,
} from './segmenter';

describe('mergeNewlinesInsideDialogue', () => {
  it('merges single newlines between 「 and 」', () => {
    assert.equal(mergeNewlinesInsideDialogue('前「行一\n行二」后'), '前「行一 行二」后');
  });
});

describe('segmentForIngestion', () => {
  it('keeps short paragraph as one chunk', () => {
    const parts = segmentForIngestion('第一段。\n\n第二段。', {
      maxTokensPerChunk: 700,
      tokenOverlap: 100,
      mode: 'paragraph-first',
    });
    assert.equal(parts.length, 2);
  });

  it('splits very long single paragraph into multiple token windows', () => {
    const unit = '这是一段用于拉长篇幅的测试文字，包含标点与重复模式。';
    const long = Array.from({ length: 400 }, () => unit).join('');
    const parts = segmentForIngestion(long, {
      maxTokensPerChunk: 200,
      tokenOverlap: 40,
      mode: 'paragraph-first',
    });
    assert.ok(parts.length >= 3);
    for (const p of parts) {
      const n = countChunkTokens(p);
      assert.ok(n <= 220, `chunk token ${n} should be near window cap`);
      assert.ok(n >= 8);
    }
  });
});

describe('splitParagraphByTokens', () => {
  it('honors overlap between consecutive windows', () => {
    const unit = '甲乙丙丁戊。';
    const body = Array.from({ length: 200 }, () => unit).join('');
    const parts = splitParagraphByTokens(body, 120, 30);
    assert.ok(parts.length >= 2);
  });
});
