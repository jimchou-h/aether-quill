import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSystemPromptSections } from './system-prompt.util';

describe('mergeSystemPromptSections', () => {
  it('joins non-empty sections with blank line', () => {
    assert.equal(
      mergeSystemPromptSections('项目约束 A', '任务约束 B'),
      '项目约束 A\n\n任务约束 B'
    );
  });

  it('skips empty and whitespace-only sections', () => {
    assert.equal(mergeSystemPromptSections('  项目约束  ', '', '  ', null, undefined), '项目约束');
  });

  it('returns empty string when all sections are empty', () => {
    assert.equal(mergeSystemPromptSections('', '   ', null), '');
  });
});
