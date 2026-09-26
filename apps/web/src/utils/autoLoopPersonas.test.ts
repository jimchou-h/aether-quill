import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { suggestAutoLoopPersonaNames, toggleAutoLoopPersonaName } from './autoLoopPersonas';

describe('auto-loop persona chips', () => {
  it('defaults to names that appear in the chapter', () => {
    assert.deepEqual(
      suggestAutoLoopPersonaNames(
        [
          { name: '林默', status: 'published' },
          { name: '沈砚', status: 'published' },
          { name: '路人', status: 'draft' },
        ],
        '林默握住门把，沈砚没有出声。'
      ),
      ['林默', '沈砚']
    );
  });

  it('returns empty when no persona name is in the chapter', () => {
    assert.deepEqual(
      suggestAutoLoopPersonaNames([{ name: '林默', status: 'published' }], '只有夜色。'),
      []
    );
  });

  it('toggles a selected persona name', () => {
    assert.deepEqual(toggleAutoLoopPersonaName(['林默'], '沈砚'), ['林默', '沈砚']);
    assert.deepEqual(toggleAutoLoopPersonaName(['林默', '沈砚'], '林默'), ['沈砚']);
  });
});
