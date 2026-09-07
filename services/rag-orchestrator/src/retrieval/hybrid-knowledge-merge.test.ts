import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeTitleAndVectorEvidence } from './hybrid-knowledge-merge';
import type { StructuredKnowledgeRetrievalResult } from './knowledge-retrieval';
import type { KnowledgeRetrievalResult } from './knowledge-retrieval';

function structuredHit(ids: string[]): StructuredKnowledgeRetrievalResult {
  return {
    chunks: ids.map((id, i) => ({
      id: `doc-full:${id}`,
      documentId: id,
      content: `content-${id}`,
      embedding: [],
      metadata: { docTitle: id, docType: 'persona_card', evidenceKind: 'full_document_by_title' },
      score: 1 - i * 0.01,
    })),
    citations: [],
    evidenceText: ids.map((id) => `证据 ${id}`).join('\n'),
    query: '林策',
    titleMatchedDocumentIds: ids,
    evidenceDocumentIds: ids,
    fullDocuments: ids.map((id, i) => ({
      documentId: id,
      title: `人物小传：${id}`,
      content: `content-${id}`,
      docType: 'persona_card',
      matchedSections: ['title_match'],
      reason: `标题匹配第 ${i + 1}`,
      docScore: 0.9 - i * 0.01,
      hitChunkIds: [`doc-full:${id}`],
    })),
  };
}

function vectorHit(ids: string[]): KnowledgeRetrievalResult {
  return {
    chunks: ids.map((id) => ({
      id: `chunk:${id}`,
      documentId: id,
      content: `vec-${id}`,
      embedding: [],
      metadata: { docTitle: id, docType: 'world_setting' },
      score: 0.5,
    })),
    citations: [],
    evidenceText: ids.map((id) => `向量 ${id}`).join('\n'),
    query: '旧港口',
    fullDocuments: ids.map((id) => ({
      documentId: id,
      title: `世界观：${id}`,
      content: `vec-${id}`,
      docType: 'world_setting',
      matchedSections: ['vector'],
      reason: '向量命中',
      docScore: 0.5,
      hitChunkIds: [`chunk:${id}`],
    })),
  };
}

describe('mergeTitleAndVectorEvidence', () => {
  it('keeps title hits and supplements vector-only docs', () => {
    const merged = mergeTitleAndVectorEvidence(structuredHit(['pc-lin']), vectorHit(['ws-harbor']), {
      personaTopN: 5,
      otherTopN: 5,
    });
    assert.equal(merged.retrievalMode, 'hybrid');
    assert.ok(merged.evidenceDocumentIds.includes('pc-lin'));
    assert.ok(merged.evidenceDocumentIds.includes('ws-harbor'));
    assert.deepEqual(merged.dualHitDocumentIds, []);
    const harbor = merged.fullDocuments.find((d) => d.documentId === 'ws-harbor');
    assert.equal(harbor?.evidenceSource, 'vector');
  });

  it('prefers title match on dual hit', () => {
    const a = structuredHit(['pc-lin']);
    const b = vectorHit(['pc-lin']);
    b.fullDocuments![0]!.docType = 'persona_card';
    b.fullDocuments![0]!.title = '人物小传：pc-lin';
    const merged = mergeTitleAndVectorEvidence(a, b, { personaTopN: 5, otherTopN: 5 });
    assert.deepEqual(merged.dualHitDocumentIds, ['pc-lin']);
    assert.equal(merged.fullDocuments.length, 1);
    assert.ok(
      merged.fullDocuments[0]?.evidenceSource === 'full_document_by_title' ||
        merged.fullDocuments[0]?.evidenceSource === 'title_match'
    );
  });

  it('promotes non-persona vector chunk hits into merged fullDocuments', () => {
    // 真实场景：retrieveKnowledgeForDraft 的 fullDocuments 只回表角色卡，
    // 其他文档只以 chunk 形式存在（documentId=ws-harbor 命中 chunks，但不在 fullDocuments 里）。
    const structured = structuredHit(['pc-lin']);
    const vector: KnowledgeRetrievalResult = {
      chunks: [
        {
          id: 'chunk:ws-harbor:1',
          documentId: 'ws-harbor',
          content: '旧港口是走私据点',
          embedding: [],
          metadata: { docTitle: '世界观：旧港口', doc_type: 'world_setting' },
          score: 0.62,
        },
      ],
      citations: [],
      evidenceText: '',
      query: '旧港口',
      fullDocuments: [],
    };
    const merged = mergeTitleAndVectorEvidence(structured, vector, {
      personaTopN: 5,
      otherTopN: 5,
    });
    assert.equal(merged.retrievalMode, 'hybrid');
    const harbor = merged.fullDocuments.find((d) => d.documentId === 'ws-harbor');
    assert.ok(harbor, 'expected chunk-derived document to be promoted into fullDocuments');
    assert.equal(harbor?.evidenceSource, 'vector');
    assert.ok(merged.evidenceText.includes('旧港口是走私据点'));
    assert.ok(merged.evidenceDocumentIds.includes('ws-harbor'));
    assert.ok(merged.chunks.some((c) => c.id === 'chunk:ws-harbor:1'));
  });

  it('falls back to vector when structured skipped', () => {
    const skipped: StructuredKnowledgeRetrievalResult = {
      chunks: [],
      citations: [],
      evidenceText: '',
      query: '',
      retrievalSkippedNoStructured: true,
      titleMatchedDocumentIds: [],
      evidenceDocumentIds: [],
      fullDocuments: [],
    };
    const merged = mergeTitleAndVectorEvidence(skipped, vectorHit(['ws-harbor']), {
      personaTopN: 5,
      otherTopN: 5,
    });
    assert.equal(merged.retrievalMode, 'vector');
    assert.equal(merged.retrievalSkippedNoStructured, false);
    assert.ok(merged.evidenceDocumentIds.includes('ws-harbor'));
  });
});
