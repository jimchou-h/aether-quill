import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCrossEncoderRerankEnabled } from './cross-encoder-scorer';
import { Reranker, computeFusedRerankScore, normalizeVectorScore } from './reranker';
import { tokenizeForRerank } from './reranker-tokenize';
import type { ChunkWithEmbedding } from './types';

function chunk(
  id: string,
  content: string,
  score?: number,
  documentId = 'doc-1'
): ChunkWithEmbedding {
  return {
    id,
    documentId,
    content,
    embedding: [],
    metadata: { docTitle: '测试文档' },
    score,
  };
}

describe('tokenizeForRerank', () => {
  it('emits CJK bigrams for continuous Chinese runs', () => {
    const tokens = tokenizeForRerank('林天走进密室');
    assert.ok(tokens.includes('林天'));
    assert.ok(tokens.includes('天走'));
    assert.ok(tokens.includes('走进'));
    assert.ok(tokens.includes('进密'));
    assert.ok(tokens.includes('密室'));
  });

  it('emits single CJK char for length-1 run', () => {
    assert.deepEqual(tokenizeForRerank('林'), ['林']);
  });

  it('emits latin words lowercased', () => {
    const tokens = tokenizeForRerank('Hello World 42');
    assert.ok(tokens.includes('hello'));
    assert.ok(tokens.includes('world'));
    assert.ok(tokens.includes('42'));
  });
});

describe('computeFusedRerankScore', () => {
  it('blends vector and lexical with normalized weights', () => {
    const fused = computeFusedRerankScore(0.8, 0.2, 0.7, 0.3);
    assert.ok(Math.abs(fused - (0.7 * 0.8 + 0.3 * 0.2)) < 1e-9);
  });

  it('vectorWeight=1 uses only vector score', () => {
    assert.equal(computeFusedRerankScore(0.9, 0.1, 1, 0), 0.9);
  });

  it('lexicalWeight=1 uses only lexical score', () => {
    assert.equal(computeFusedRerankScore(0.9, 0.4, 0, 1), 0.4);
  });

  it('clips negative vector scores to zero', () => {
    assert.equal(normalizeVectorScore(-0.2), 0);
    assert.equal(computeFusedRerankScore(-0.2, 1, 1, 0), 0);
  });
});

describe('Reranker', () => {
  it('prefers high vector score chunk when lexical tie under default fusion', () => {
    const reranker = new Reranker({ vectorWeight: 1, lexicalWeight: 0 });
    const ranked = reranker.rerank(
      '林天 密室',
      [chunk('a', '无关段落内容', 0.3, 'doc-a'), chunk('b', '林天在密室中点燃火把', 0.95, 'doc-b')],
      2
    );
    assert.equal(ranked[0]?.id, 'b');
  });

  it('ranks Chinese lexical match higher than unrelated content when vector equal', () => {
    const reranker = new Reranker({ vectorWeight: 0, lexicalWeight: 1 });
    const ranked = reranker.rerank(
      '林天走进密室',
      [
        chunk('weak', '完全是别的剧情', 0.5, 'doc-a'),
        chunk('strong', '林天走进密室，点燃了墙上的火把', 0.5, 'doc-b'),
      ],
      2
    );
    assert.equal(ranked[0]?.id, 'strong');
  });

  it('uses injected cross-encoder scores when provider enabled', () => {
    const prev = process.env.RERANK_PROVIDER;
    process.env.RERANK_PROVIDER = 'cross-encoder';
    try {
      const reranker = new Reranker({
        vectorWeight: 0,
        lexicalWeight: 1,
        crossEncoderScorer: {
          score: (_query, chunks) => chunks.map((c) => (c.id === 'ce-winner' ? 0.99 : 0.01)),
        },
      });
      const ranked = reranker.rerank(
        '任意查询',
        [chunk('other', '内容甲', 0.9, 'doc-a'), chunk('ce-winner', '内容乙', 0.1, 'doc-b')],
        2
      );
      assert.equal(ranked[0]?.id, 'ce-winner');
    } finally {
      if (prev === undefined) {
        delete process.env.RERANK_PROVIDER;
      } else {
        process.env.RERANK_PROVIDER = prev;
      }
    }
  });

  it('limits chunks per document in topN', () => {
    const reranker = new Reranker({ vectorWeight: 1, lexicalWeight: 0, maxPerDocument: 1 });
    const ranked = reranker.rerank(
      'q',
      [
        chunk('a1', 'seg1', 0.9, 'doc-a'),
        chunk('a2', 'seg2', 0.85, 'doc-a'),
        chunk('b1', 'seg3', 0.8, 'doc-b'),
        chunk('c1', 'seg4', 0.7, 'doc-c'),
      ],
      3
    );
    assert.equal(ranked.length, 3);
    const docIds = ranked.map((c) => c.documentId);
    assert.equal(new Set(docIds).size, 3);
    assert.equal(docIds.filter((id) => id === 'doc-a').length, 1);
  });

  it('allows multiple chunks per document when maxPerDocument > 1', () => {
    const reranker = new Reranker({ vectorWeight: 1, lexicalWeight: 0, maxPerDocument: 2 });
    const ranked = reranker.rerank(
      'q',
      [
        chunk('a1', 'seg1', 0.9, 'doc-a'),
        chunk('a2', 'seg2', 0.85, 'doc-a'),
        chunk('b1', 'seg3', 0.8, 'doc-b'),
      ],
      3
    );
    assert.equal(ranked.length, 3);
    assert.equal(ranked.filter((c) => c.documentId === 'doc-a').length, 2);
  });

  it('ignores cross-encoder scorer when provider not enabled', () => {
    const prev = process.env.RERANK_PROVIDER;
    delete process.env.RERANK_PROVIDER;
    try {
      const reranker = new Reranker({
        vectorWeight: 1,
        lexicalWeight: 0,
        crossEncoderScorer: {
          score: () => [0.99, 0.01],
        },
      });
      const ranked = reranker.rerank(
        'q',
        [chunk('low', 'x', 0.2, 'a'), chunk('high', 'y', 0.9, 'b')],
        2
      );
      assert.equal(ranked[0]?.id, 'high');
    } finally {
      if (prev !== undefined) {
        process.env.RERANK_PROVIDER = prev;
      }
    }
  });
});

describe('isCrossEncoderRerankEnabled', () => {
  it('returns true only for known provider values', () => {
    const prev = process.env.RERANK_PROVIDER;
    process.env.RERANK_PROVIDER = 'cross-encoder';
    assert.equal(isCrossEncoderRerankEnabled(), true);
    process.env.RERANK_PROVIDER = 'fusion';
    assert.equal(isCrossEncoderRerankEnabled(), false);
    if (prev === undefined) {
      delete process.env.RERANK_PROVIDER;
    } else {
      process.env.RERANK_PROVIDER = prev;
    }
  });
});
