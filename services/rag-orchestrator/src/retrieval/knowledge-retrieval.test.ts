import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildChapterOptimizeRetrievalQuery,
  buildGenerationRetrievalQuery,
  buildRetrievalQuery,
  buildStructuredKnowledgeEvidence,
  formatEvidence,
  resolveChapterScopedEmbeddingQuery,
} from './knowledge-retrieval';
import type { ChunkWithEmbedding } from './types';

describe('buildGenerationRetrievalQuery', () => {
  const project = {
    outlineSummary: '大纲A',
    personaProfile: '主角设定',
  };

  it('concatenates user prompt with outline/persona when task is not an object', () => {
    const q = buildGenerationRetrievalQuery('续写战斗场面', project, {
      task: 'chapter.optimize.plan',
    });
    assert.ok(q.includes('续写战斗场面'));
    assert.ok(q.includes('大纲A'));
    assert.ok(q.includes('主角设定'));
  });

  it('uses buildRetrievalQuery when task is a write-style object', () => {
    const q = buildGenerationRetrievalQuery('写一章', project, {
      task: { goal: '揭露反派', pov: '第一人称', mustInclude: ['雨天'] },
    });
    assert.ok(q.includes('写一章'));
    assert.ok(q.includes('揭露反派'));
    assert.ok(q.includes('雨天'));
  });
});

describe('resolveChapterScopedEmbeddingQuery', () => {
  const ctx = {
    chapters: [
      { chapterNo: 1, structuredMatchingText: '  港口 走私  ' },
      { chapterNo: 2, structuredMatchingText: '' },
    ],
  };

  it('returns undefined when no chapter anchor', () => {
    assert.equal(resolveChapterScopedEmbeddingQuery(ctx, NaN, 0), undefined);
  });

  it('prefers task chapterNo over extra', () => {
    assert.equal(resolveChapterScopedEmbeddingQuery(ctx, 1, 2), '港口 走私');
  });

  it('uses extra chapterNo when task invalid', () => {
    assert.equal(resolveChapterScopedEmbeddingQuery(ctx, NaN, 1), '港口 走私');
  });

  it('returns empty string when chapter has no structured text', () => {
    assert.equal(resolveChapterScopedEmbeddingQuery(ctx, 2, 0), '');
  });
});

describe('buildChapterOptimizeRetrievalQuery', () => {
  const project = {
    outlineSummary: '卷一',
    personaProfile: '主角',
  };

  it('uses summary and instruction without full chapter body', () => {
    const q = buildChapterOptimizeRetrievalQuery(project, {
      chapterNo: 3,
      title: '风起',
      instruction: '加强对话张力',
      chapterSummary: '主角与反派首次对峙。',
    });
    assert.ok(q.includes('第3章'));
    assert.ok(q.includes('风起'));
    assert.ok(q.includes('加强对话张力'));
    assert.ok(q.includes('主角与反派首次对峙'));
    assert.ok(q.includes('卷一'));
    assert.ok(q.includes('主角'));
    assert.ok(!q.includes('<chapter-original>'));
  });
});

describe('formatEvidence', () => {
  it('includes chunk_id and doc title', () => {
    const chunks: ChunkWithEmbedding[] = [
      {
        id: 'doc-1-seg-0',
        documentId: 'doc-1',
        content: '正文片段',
        embedding: [],
        metadata: { docTitle: '第一章草稿' },
      },
    ];
    const text = formatEvidence(chunks);
    assert.ok(text.includes('chunk_id=doc-1-seg-0'));
    assert.ok(text.includes('doc=第一章草稿'));
    assert.ok(text.includes('正文片段'));
  });
});

describe('buildStructuredKnowledgeEvidence', () => {
  const docs = [
    { id: 'd1', title: '世界观：旧港口设定集', content: '全文A', docType: 'world_setting' },
    { id: 'd2', title: '人物小传：林策', content: '全文B', docType: 'persona_card' },
    { id: 'd3', title: '无关文档', content: '全文C', docType: 'other' },
  ];

  it('returns empty when structured text missing', () => {
    const r = buildStructuredKnowledgeEvidence(1, {
      chapterNo: 1,
      chapters: [{ chapterNo: 1 }],
      knowledgeDocuments: docs,
    });
    assert.equal(r.retrievalSkippedNoStructured, true);
    assert.equal(r.evidenceText, '');
    assert.deepEqual(r.titleMatchedDocumentIds, []);
  });

  it('injects top title-matched full documents', () => {
    const r = buildStructuredKnowledgeEvidence(2, {
      chapterNo: 2,
      chapters: [{ chapterNo: 2, structuredMatchingText: '旧港口 林策' }],
      knowledgeDocuments: docs,
    });
    assert.equal(r.retrievalSkippedNoStructured, undefined);
    assert.ok(r.evidenceText.includes('document_id=d1'));
    assert.ok(r.evidenceText.includes('全文A'));
    assert.ok(r.evidenceText.includes('document_id=d2'));
    assert.ok(r.evidenceText.includes('知识裁剪'));
    assert.ok(r.titleMatchedDocumentIds.includes('d1'));
    assert.ok(r.titleMatchedDocumentIds.includes('d2'));
    assert.equal(r.titleMatchedDocumentIds.includes('d3'), false);
  });
});

describe('buildRetrievalQuery', () => {
  it('joins goal and outline', () => {
    const q = buildRetrievalQuery(
      { goal: '逃亡', pov: '第三人称' },
      { outlineSummary: '卷一', personaProfile: '未配置人物设定' }
    );
    assert.ok(q.includes('逃亡'));
    assert.ok(q.includes('第三人称'));
    assert.ok(q.includes('卷一'));
  });
});
