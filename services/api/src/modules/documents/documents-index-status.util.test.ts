import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextIndexStatusAfterContentChange } from './documents-index-status.util';

describe('document indexStatus lifecycle (AQ-358)', () => {
  it('marks completed/stale edits as stale', () => {
    assert.equal(nextIndexStatusAfterContentChange('completed'), 'stale');
    assert.equal(nextIndexStatusAfterContentChange('stale'), 'stale');
  });

  it('keeps never-indexed docs as pending', () => {
    assert.equal(nextIndexStatusAfterContentChange('pending'), 'pending');
    assert.equal(nextIndexStatusAfterContentChange('failed'), 'pending');
    assert.equal(nextIndexStatusAfterContentChange('indexing'), 'pending');
  });
});
