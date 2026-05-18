import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeDocType } from './documents-type.util';

describe('normalizeDocType', () => {
  it('defaults to other for invalid values', () => {
    assert.equal(normalizeDocType(undefined), 'other');
    assert.equal(normalizeDocType('invalid'), 'other');
  });

  it('accepts persona_card', () => {
    assert.equal(normalizeDocType('persona_card'), 'persona_card');
  });
});
