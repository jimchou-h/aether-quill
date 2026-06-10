import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStructuredKnowledgeEvidence } from './knowledge-retrieval';
import { resolveOptimizeStructuredMatchingText } from './optimize-matching-text';
import { scoreTitleAgainstMatchingText } from './title-match-score';

describe('scoreTitleAgainstMatchingText', () => {
  it('scores when matching text embeds persona name in a long instruction sentence', () => {
    const score = scoreTitleAgainstMatchingText(
      '增加林策与反派的对手戏',
      '人物小传：林策'
    );
    assert.ok(score > 0);
  });
});

describe('optimize + inferred persona docType', () => {
  it('hits persona card stored as other when title looks like persona card', () => {
    const effective = resolveOptimizeStructuredMatchingText({
      instruction: '希望加入林策的戏份',
      personaCards: [{ title: '林策人物小传', docType: 'persona_card' }],
    });
    assert.ok(effective?.includes('林策'));

    const r = buildStructuredKnowledgeEvidence(1, {
      chapterNo: 1,
      chapters: [{ chapterNo: 1, structuredMatchingText: effective }],
      knowledgeDocuments: [
        {
          id: 'd1',
          title: '林策人物小传',
          content: '林策设定正文',
          docType: 'other',
        },
      ],
    });
    assert.ok(r.titleMatchedDocumentIds.includes('d1'));
    assert.ok(r.evidenceText.includes('canonical_character=林策'));
  });
});
