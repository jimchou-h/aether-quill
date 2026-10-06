import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recallCrossChapterMemory } from './cross-chapter-memory';

describe('recallCrossChapterMemory', () => {
  it('injects neighbor open cards and skips current chapter', () => {
    const result = recallCrossChapterMemory({
      cards: [
        {
          id: 'a',
          chapterNo: 10,
          beat: '本章不应召回',
          entities: ['杨幂'],
          kind: 'ability',
          status: 'fact',
        },
        {
          id: 'b',
          chapterNo: 9,
          beat: '女儿撞破',
          entities: ['杨幂', '刘苡馨'],
          kind: 'foreshadow',
          status: 'open',
          evidence: '妈妈我睡不着',
        },
      ],
      currentChapterNo: 10,
      appearingCharacters: ['杨幂'],
      queryText: '母女',
    });
    assert.ok(result.blockText.includes('【跨章记忆'));
    assert.deepEqual(result.usedIds, ['b']);
  });
});
