import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildChapterOptimizeRetrievalQuery,
  buildGenerationRetrievalQuery,
  buildRetrievalQuery,
  formatEvidence,
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
