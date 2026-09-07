import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAppearingPersonaInjection } from './appearing-persona-injection';

describe('buildAppearingPersonaInjection', () => {
  it('injects linked static card + snapshot for appearing personas', () => {
    const result = buildAppearingPersonaInjection({
      appearingNames: ['林策'],
      currentChapterNo: 5,
      staticCardMaxChars: 2000,
      personas: [
        {
          id: 'p1',
          name: '林策',
          profile: '简介备用',
          state: '待更新',
          status: 'published',
          chapterStates: [
            {
              chapterNo: 4,
              appeared: true,
              snapshot: { clothing: '黑袍', status: '冷静' },
              summaryLine: '着装：黑袍；状态：冷静',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
      knowledgeDocuments: [
        {
          id: 'd1',
          title: '林策角色卡',
          content: '静态设定：港口走私客。'.repeat(5),
          docType: 'persona_card',
          personaId: 'p1',
        },
      ],
    });

    assert.ok(result.text.includes('【出场人物设定】'));
    assert.ok(result.text.includes('【静态设定卡】'));
    assert.ok(result.text.includes('【动态快照】'));
    assert.ok(result.text.includes('黑袍'));
    assert.deepEqual(result.injectedNames, ['林策']);
  });

  it('falls back to profile when no linked card', () => {
    const result = buildAppearingPersonaInjection({
      appearingNames: ['阿宁'],
      personas: [
        {
          id: 'p2',
          name: '阿宁',
          profile: '短发少女，口风利落',
          state: '在码头等待',
          status: 'published',
        },
      ],
      knowledgeDocuments: [],
      staticCardMaxChars: 400,
    });

    assert.ok(result.text.includes('【人物简介】'));
    assert.ok(result.text.includes('短发少女'));
    assert.ok(result.text.includes('【当前状态】'));
  });
});
