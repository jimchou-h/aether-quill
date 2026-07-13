import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findMissingProjectIdsFromJsonMirror,
  mergeKnowledgeChaptersFromJsonMirror,
  mergeMembersForProjectIds,
  shouldMergeOutlineFromJson,
} from './workspace-json-merge.util';

test('findMissingProjectIdsFromJsonMirror 识别 PG 未收录的项目', () => {
  const loaded = {
    projects: [{ id: '1', name: 'A' }],
    members: [],
  };
  const fromJson = {
    projects: [
      { id: '1', name: 'A' },
      { id: '2', name: '系统' },
    ],
    members: [],
  };
  assert.deepEqual(findMissingProjectIdsFromJsonMirror(loaded, fromJson), ['2']);
});

test('mergeMembersForProjectIds 仅为缺失项目追加 member', () => {
  const existing = [{ userId: '1', projectId: '1' }];
  const jsonMembers = [
    { userId: '1', projectId: '1' },
    { userId: '1', projectId: '2' },
  ];
  assert.deepEqual(mergeMembersForProjectIds(existing, jsonMembers, new Set(['2'])), [
    { userId: '1', projectId: '1' },
    { userId: '1', projectId: '2' },
  ]);
});

test('mergeKnowledgeChaptersFromJsonMirror 合并 JSON 中较新的章节正文', () => {
  const loaded = [
    {
      chapterNo: 1,
      title: '旧标题',
      content: '旧正文',
      updatedAt: '2026-07-10T10:00:00.000Z',
    },
  ];
  const jsonChapters = [
    {
      chapterNo: 1,
      title: '新标题',
      content: '新正文',
      updatedAt: '2026-07-11T10:00:00.000Z',
    },
  ];

  const { changed } = mergeKnowledgeChaptersFromJsonMirror(loaded, jsonChapters, (chapter) => ({
    ...chapter,
    updatedAt: String(chapter.updatedAt),
  }));

  assert.equal(changed, true);
  assert.equal(loaded[0]?.content, '新正文');
});

test('shouldMergeOutlineFromJson 在 JSON 章节不旧于 PG 时合并大纲', () => {
  const loadedChapters = [
    { chapterNo: 1, title: 't', content: 'c', updatedAt: '2026-07-10T10:00:00.000Z' },
  ];
  const jsonChapters = [
    { chapterNo: 1, title: 't', content: 'c', updatedAt: '2026-07-11T10:00:00.000Z' },
  ];
  assert.equal(
    shouldMergeOutlineFromJson('旧大纲', '新大纲', loadedChapters, jsonChapters),
    true
  );
});
