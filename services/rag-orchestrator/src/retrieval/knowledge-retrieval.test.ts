import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildChapterOptimizeRetrievalQuery,
  buildGenerationRetrievalQuery,
  buildRetrievalQuery,
  buildStructuredKnowledgeEvidence,
  formatEvidence,
  resolveChapterScopedEmbeddingQuery,
  resolveMemoryChapterSummaryEmbeddingQuery,
  MEMORY_CHAPTER_SUMMARY_EMBED_MAX_CHARS,
  MEMORY_CHAPTER_SUMMARY_FALLBACK_CHARS,
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

describe('resolveMemoryChapterSummaryEmbeddingQuery', () => {
  const chapters = [
    { chapterNo: 11, structuredMatchingText: '港口 走私 杨幂', summary: '很长的摘要'.repeat(100) },
    { chapterNo: 12, structuredMatchingText: '', summary: '第十二章摘要' },
  ];

  it('prefers structuredMatchingText for current chapter', () => {
    assert.equal(
      resolveMemoryChapterSummaryEmbeddingQuery({
        currentChapterNo: 11,
        chapters,
      }),
      '港口 走私 杨幂'
    );
  });

  it('falls back to summary prefix when structured text missing', () => {
    const got = resolveMemoryChapterSummaryEmbeddingQuery({
      currentChapterNo: 12,
      chapters,
    });
    assert.equal(got, '第十二章摘要');
  });

  it('falls back to prompt when no chapter anchor', () => {
    assert.equal(
      resolveMemoryChapterSummaryEmbeddingQuery({
        chapters,
        fallbackPrompt: '优化节奏与对话',
      }),
      '优化节奏与对话'
    );
  });

  it('truncates long structured text to embed max chars', () => {
    const long = '词'.repeat(MEMORY_CHAPTER_SUMMARY_EMBED_MAX_CHARS + 50);
    const got = resolveMemoryChapterSummaryEmbeddingQuery({
      currentChapterNo: 11,
      chapters: [{ chapterNo: 11, structuredMatchingText: long }],
    });
    assert.equal(got.length, MEMORY_CHAPTER_SUMMARY_EMBED_MAX_CHARS);
  });

  it('truncates fallback prompt', () => {
    const got = resolveMemoryChapterSummaryEmbeddingQuery({
      chapters: [],
      fallbackPrompt: 'x'.repeat(MEMORY_CHAPTER_SUMMARY_FALLBACK_CHARS + 100),
    });
    assert.equal(got.length, MEMORY_CHAPTER_SUMMARY_FALLBACK_CHARS);
  });

  it('returns empty when nothing available', () => {
    assert.equal(
      resolveMemoryChapterSummaryEmbeddingQuery({
        currentChapterNo: 99,
        chapters,
      }),
      ''
    );
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
    assert.ok(r.evidenceText.includes('canonical_character=林策'));
    assert.ok(r.evidenceText.includes('角色卡·林策'));
    assert.ok(r.titleMatchedDocumentIds.includes('d1'));
    assert.ok(r.titleMatchedDocumentIds.includes('d2'));
    assert.equal(r.titleMatchedDocumentIds.includes('d3'), false);
    for (const id of r.evidenceDocumentIds) {
      assert.ok(r.titleMatchedDocumentIds.includes(id));
    }
  });

  it('adds multi-persona preamble and canonical anchors for matched persona cards', () => {
    const personaDocs = Array.from({ length: 4 }, (_, i) => ({
      id: `p${i + 1}`,
      title: `人物小传：角色${i + 1}`,
      content: `角色${i + 1}设定，马甲：化名${i + 1}`,
      docType: 'persona_card',
    }));
    const r = buildStructuredKnowledgeEvidence(
      1,
      {
        chapterNo: 1,
        chapters: [{ chapterNo: 1, structuredMatchingText: '角色1 角色2 角色3 角色4' }],
        knowledgeDocuments: personaDocs,
      },
      { personaTopN: 10, otherTopN: 0 }
    );
    assert.equal(r.titleMatchedDocumentIds.length, 4);
    assert.ok(r.evidenceText.includes('多角色设定须知'));
    assert.ok(r.evidenceText.includes('canonical_character=角色2'));
    assert.ok(r.evidenceText.includes('马甲：化名2'));
    for (const id of r.evidenceDocumentIds) {
      assert.ok(r.titleMatchedDocumentIds.includes(id));
    }
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
