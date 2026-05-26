import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hasStructuredInfoForKnowledgeMatch,
  resolveEffectiveStructuredMatchingText,
} from './structured-matching';

describe('hasStructuredInfoForKnowledgeMatch', () => {
  it('returns true when matchingText present', () => {
    assert.equal(hasStructuredInfoForKnowledgeMatch({ matchingText: '旧港口 林策' }), true);
  });

  it('returns true when only persona supplements provide effective text', () => {
    assert.equal(
      hasStructuredInfoForKnowledgeMatch({
        matchingText: '',
        personaKeywordSupplements: ['林策'],
      }),
      true
    );
    assert.equal(resolveEffectiveStructuredMatchingText({
      matchingText: '',
      personaKeywordSupplements: ['林策'],
    }), '林策');
  });

  it('returns true when only keywords present', () => {
    assert.equal(
      hasStructuredInfoForKnowledgeMatch({ matchingText: '', keywords: ['林策', '港口'] }),
      true
    );
  });

  it('returns false when structured info missing or empty', () => {
    assert.equal(hasStructuredInfoForKnowledgeMatch(undefined), false);
    assert.equal(hasStructuredInfoForKnowledgeMatch({ matchingText: '' }), false);
  });
});
