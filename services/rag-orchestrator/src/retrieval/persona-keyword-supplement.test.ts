import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildEffectiveMatchingText,
  expandPersonaMatchTokens,
  supplementPersonaKeywordsFromSource,
} from './persona-keyword-supplement';

const personaCards = [
  { id: 'p1', title: '人物小传：林策', docType: 'persona_card' as const },
  { id: 'p2', title: '苏晚角色卡', docType: 'persona_card' as const },
  { id: 'w1', title: '世界观：旧港口', docType: 'world_setting' as const },
];

describe('supplementPersonaKeywordsFromSource', () => {
  it('adds persona name when present in source but missing from AI keywords', () => {
    const source = '林策在旧港口与苏晚会面。';
    const { supplementedKeywords, mergedKeywords } = supplementPersonaKeywordsFromSource(
      source,
      personaCards,
      []
    );
    assert.deepEqual(supplementedKeywords, ['林策', '苏晚']);
    assert.deepEqual(mergedKeywords, ['林策', '苏晚']);
  });

  it('does not duplicate AI keywords', () => {
    const source = '林策独自行动。';
    const { supplementedKeywords, mergedKeywords } = supplementPersonaKeywordsFromSource(
      source,
      personaCards,
      ['林策', '港口']
    );
    assert.deepEqual(supplementedKeywords, ['林策']);
    assert.deepEqual(mergedKeywords, ['林策', '港口']);
  });

  it('skips names shorter than 2 characters', () => {
    const cards = [{ title: '人物小传：甲', docType: 'persona_card' as const }];
    const { supplementedKeywords } = supplementPersonaKeywordsFromSource('甲出现了', cards, []);
    assert.deepEqual(supplementedKeywords, []);
  });

  it('ignores non-persona documents', () => {
    const source = '旧港口走私事件。';
    const { supplementedKeywords } = supplementPersonaKeywordsFromSource(source, personaCards, []);
    assert.equal(supplementedKeywords.includes('旧港口'), false);
  });

  it('returns empty when source has no persona hits', () => {
    const { supplementedKeywords, mergedKeywords } = supplementPersonaKeywordsFromSource(
      '无关情节',
      personaCards,
      ['主题']
    );
    assert.deepEqual(supplementedKeywords, []);
    assert.deepEqual(mergedKeywords, ['主题']);
  });
});

describe('expandPersonaMatchTokens', () => {
  it('returns primary, alias, and full display when parentheses present', () => {
    assert.deepEqual(expandPersonaMatchTokens('黄霄雲（面包）'), [
      '黄霄雲',
      '面包',
      '黄霄雲（面包）',
    ]);
    assert.deepEqual(expandPersonaMatchTokens('黄霄雲(面包)'), [
      '黄霄雲',
      '面包',
      '黄霄雲(面包)',
    ]);
  });

  it('returns single token when no parentheses', () => {
    assert.deepEqual(expandPersonaMatchTokens('林策'), ['林策']);
  });

  it('includes trailing nickname suffix for long display names', () => {
    assert.deepEqual(expandPersonaMatchTokens('比企谷小町'), ['比企谷小町', '小町']);
  });
});

describe('supplementPersonaKeywordsFromSource (nickname suffix)', () => {
  const card = [{ id: 'p', title: '角色卡 -> 比企谷小町', docType: 'persona_card' as const }];

  it('matches instruction that only uses trailing nickname 小町', () => {
    const source = '男主睡前想到了小町，辗转难眠。';
    const { supplementedKeywords } = supplementPersonaKeywordsFromSource(source, card, []);
    assert.deepEqual(supplementedKeywords, ['小町']);
  });
});

describe('supplementPersonaKeywordsFromSource (paren alias)', () => {
  const aliasCard = [
    { id: 'p3', title: '人物小传：黄霄雲（面包）', docType: 'persona_card' as const },
  ];

  it('matches primary name in source', () => {
    const { supplementedKeywords } = supplementPersonaKeywordsFromSource(
      '黄霄雲走上台。',
      aliasCard,
      []
    );
    assert.deepEqual(supplementedKeywords, ['黄霄雲']);
  });

  it('matches alias only in source', () => {
    const { supplementedKeywords } = supplementPersonaKeywordsFromSource(
      '面包在旁白里出现。',
      aliasCard,
      []
    );
    assert.deepEqual(supplementedKeywords, ['面包']);
  });

  it('does not fuzzy-match partial primary', () => {
    const { supplementedKeywords } = supplementPersonaKeywordsFromSource('霄雲独自', aliasCard, []);
    assert.deepEqual(supplementedKeywords, []);
  });
});

describe('buildEffectiveMatchingText', () => {
  it('appends supplemented names to AI matching text', () => {
    const effective = buildEffectiveMatchingText('旧港口 走私', ['林策']);
    assert.equal(effective, '旧港口 走私 林策');
  });

  it('uses supplements only when matching text empty', () => {
    assert.equal(buildEffectiveMatchingText('', ['林策']), '林策');
  });
});
