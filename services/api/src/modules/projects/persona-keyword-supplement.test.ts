import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildEffectiveMatchingText,
  resolveStructuredMatchingTextForSync,
  supplementPersonaKeywordsFromSource,
} from './persona-keyword-supplement';

describe('persona-keyword-supplement (api)', () => {
  it('merges supplemented persona into effective sync text', () => {
    const { supplementedKeywords } = supplementPersonaKeywordsFromSource(
      '林策抵达旧港口。',
      [{ title: '人物小传：林策', docType: 'persona_card' }],
      []
    );
    assert.deepEqual(supplementedKeywords, ['林策']);
    const effective = resolveStructuredMatchingTextForSync({
      matchingText: '旧港口 走私',
      personaKeywordSupplements: supplementedKeywords,
    });
    assert.equal(effective, '旧港口 走私 林策');
    assert.equal(buildEffectiveMatchingText('旧港口', ['林策']), '旧港口 林策');
  });
});
