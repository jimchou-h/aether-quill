import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decidePersonaCardLink,
  extractCardDisplayName,
  scorePersonaNameMatch,
} from './persona-card-link.util';

describe('persona-card-link.util', () => {
  it('extracts display name from card titles', () => {
    assert.equal(extractCardDisplayName('人物小传：林策'), '林策');
    assert.equal(extractCardDisplayName('角色卡·沐青'), '沐青');
  });

  it('links unique high-confidence matches', () => {
    const decision = decidePersonaCardLink('人物小传：林策', [
      { id: 'p1', name: '林策' },
      { id: 'p2', name: '沈晚星' },
    ]);
    assert.equal(decision.status, 'linked');
    if (decision.status === 'linked') {
      assert.equal(decision.personaId, 'p1');
      assert.ok(decision.score >= 80);
    }
  });

  it('marks orphan when no persona matches', () => {
    assert.equal(
      decidePersonaCardLink('世界观：旧港口', [{ id: 'p1', name: '林策' }]).status,
      'orphan'
    );
  });

  it('scores exact names highest', () => {
    assert.equal(scorePersonaNameMatch('人物小传：林策', '林策'), 100);
  });
});
