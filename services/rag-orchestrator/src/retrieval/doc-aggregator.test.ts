import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateChunksByDocument, buildDocumentHitReason } from './doc-aggregator';
import type { ChunkWithEmbedding } from './types';

function chunk(
  partial: Partial<ChunkWithEmbedding> & Pick<ChunkWithEmbedding, 'id' | 'documentId' | 'content'>
): ChunkWithEmbedding {
  return {
    embedding: [],
    metadata: {},
    score: 0,
    ...partial,
  };
}

describe('aggregateChunksByDocument', () => {
  it('deduplicates by document_id and keeps max score', () => {
    const chunks: ChunkWithEmbedding[] = [
      chunk({
        id: 'c1',
        documentId: 'doc-a',
        content: '身份：剑客',
        score: 0.6,
        metadata: { doc_type: 'persona_card', section: 'identity' },
      }),
      chunk({
        id: 'c2',
        documentId: 'doc-a',
        content: '关系：师徒',
        score: 0.9,
        metadata: { doc_type: 'persona_card', section: 'relationship' },
      }),
      chunk({
        id: 'c3',
        documentId: 'doc-b',
        content: '世界观',
        score: 0.5,
        metadata: { doc_type: 'world_doc', section: 'general' },
      }),
    ];

    const rows = aggregateChunksByDocument(chunks);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].documentId, 'doc-a');
    assert.equal(rows[0].docScore, 0.9);
    assert.deepEqual(rows[0].matchedSections.sort(), ['identity', 'relationship']);
    assert.deepEqual(rows[0].hitChunkIds.sort(), ['c1', 'c2']);
  });
});

describe('buildDocumentHitReason', () => {
  it('includes sections and score', () => {
    const reason = buildDocumentHitReason('林策 师徒', {
      documentId: 'd1',
      docType: 'persona_card',
      docScore: 0.88,
      matchedSections: ['relationship'],
      hitChunkIds: ['c1'],
      topChunks: [
        chunk({
          id: 'c1',
          documentId: 'd1',
          content: '林策与师父',
          score: 0.88,
          metadata: { docTitle: '林策角色卡' },
        }),
      ],
    });
    assert.ok(reason.includes('relationship'));
    assert.ok(reason.includes('0.880'));
  });
});
