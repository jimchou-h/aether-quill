import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStructuredKnowledgeEvidence } from './knowledge-retrieval';
import {
  listPersonaCardsFromKnowledgeDocs,
  mapChaptersForStructuredKnowledgeMatch,
  resolveOptimizeStructuredMatchingText,
  shouldApplyChapterOptimizeMatchingBoost,
} from './optimize-matching-text';

const personaCards = [
  { title: '人物小传：林策', docType: 'persona_card' as const },
  { title: '苏晚角色卡', docType: 'persona_card' as const },
];

describe('resolveOptimizeStructuredMatchingText', () => {
  it('returns chapter structured only when no instruction or appearing', () => {
    assert.equal(
      resolveOptimizeStructuredMatchingText({
        chapterStructuredMatchingText: '旧港口',
        personaCards,
      }),
      '旧港口'
    );
  });

  it('supplements from workspace persona name when knowledge doc uses other docType', () => {
    const effective = resolveOptimizeStructuredMatchingText({
      instruction: '加入苏晚的剧情',
      personaCards: listPersonaCardsFromKnowledgeDocs(
        [{ title: '配角笔记', content: '苏晚', docType: 'other' }],
        [{ name: '苏晚' }]
      ),
    });
    assert.ok(effective?.includes('苏晚'));
  });

  it('adds persona name from instruction when missing from chapter structured', () => {
    const effective = resolveOptimizeStructuredMatchingText({
      chapterStructuredMatchingText: '旧港口 走私',
      instruction: '增加林策与苏晚的对手戏',
      personaCards,
    });
    assert.ok(effective?.includes('林策'));
    assert.ok(effective?.includes('苏晚'));

    const r = buildStructuredKnowledgeEvidence(2, {
      chapterNo: 2,
      chapters: [{ chapterNo: 2, structuredMatchingText: effective }],
      knowledgeDocuments: [
        { id: 'd2', title: '人物小传：林策', content: '林策设定', docType: 'persona_card' },
        { id: 'd3', title: '苏晚角色卡', content: '苏晚设定', docType: 'persona_card' },
      ],
    });
    assert.ok(r.evidenceText.includes('canonical_character=林策'));
    assert.ok(r.titleMatchedDocumentIds.includes('d2'));
    assert.ok(r.titleMatchedDocumentIds.includes('d3'));
  });

  it('matches 比企谷小町 card when instruction only mentions 小町', () => {
    const effective = resolveOptimizeStructuredMatchingText({
      instruction: '男主睡前想到了小町，辗转难眠。',
      personaCards: [{ title: '角色卡 -> 比企谷小町', docType: 'persona_card' }],
    });
    assert.ok(effective?.includes('小町'));

    const r = buildStructuredKnowledgeEvidence(1, {
      chapterNo: 1,
      chapters: [{ chapterNo: 1, structuredMatchingText: effective }],
      knowledgeDocuments: [
        {
          id: 'komachi',
          title: '角色卡 -> 比企谷小町',
          content: '比企谷八幡的妹妹…',
          docType: 'persona_card',
        },
      ],
    });
    assert.ok(r.titleMatchedDocumentIds.includes('komachi'));
    assert.ok(r.evidenceText.includes('canonical_character=比企谷小町'));
  });

  it('forces appearingCharacters into matching text', () => {
    const effective = resolveOptimizeStructuredMatchingText({
      chapterStructuredMatchingText: '',
      appearingCharacters: ['林策'],
      personaCards,
    });
    assert.ok(effective?.includes('林策'));
  });
});

describe('mapChaptersForStructuredKnowledgeMatch', () => {
  it('only boosts target chapter', () => {
    const mapped = mapChaptersForStructuredKnowledgeMatch(
      [
        { chapterNo: 1, structuredMatchingText: '第一章' },
        { chapterNo: 2, structuredMatchingText: '第二章' },
      ],
      2,
      { instruction: '加入林策', personaCards }
    );
    assert.equal(mapped[0]?.structuredMatchingText, '第一章');
    assert.ok(mapped[1]?.structuredMatchingText?.includes('林策'));
  });
});

describe('shouldApplyChapterOptimizeMatchingBoost', () => {
  it('applies when instruction present', () => {
    assert.equal(
      shouldApplyChapterOptimizeMatchingBoost({ instruction: '加林策' }),
      true
    );
  });
});
