import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTO_LOOP_PROMPT_LAB_CHAT_HINT,
  AUTO_LOOP_PROMPT_LAB_PUBLISH_HINT,
  AUTO_LOOP_PROMPT_LAB_SYSTEM_PUBLISH_HINT,
} from './autoLoopPromptLabCopy';
import {
  applyPromptLabSuggestionToLayer,
  canOpenPromptLabKind,
  findPromptLabCall,
  type PromptLabCallView,
} from './autoLoopPromptLab';

function call(overrides: Partial<PromptLabCallView> = {}): PromptLabCallView {
  return {
    id: 'lab-1',
    kind: 'diagnose',
    roundIndex: 1,
    windowIndex: 1,
    ...overrides,
  };
}

describe('auto-loop prompt lab', () => {
  it('binds diagnose entry to that window and round', () => {
    const found = findPromptLabCall(
      [call({ id: 'a', windowIndex: 1 }), call({ id: 'b', windowIndex: 2 })],
      { kind: 'diagnose', roundIndex: 1, windowIndex: 1 }
    );
    assert.equal(found?.id, 'a');
  });

  it('prefers the latest diagnose snapshot after a retry', () => {
    const found = findPromptLabCall([call({ id: 'first' }), call({ id: 'retry' })], {
      kind: 'diagnose',
      roundIndex: 1,
      windowIndex: 1,
    });
    assert.equal(found?.id, 'retry');
  });

  it('does not offer a rewrite lab entry', () => {
    assert.equal(canOpenPromptLabKind('diagnose'), true);
    assert.equal(canOpenPromptLabKind('rewrite'), false);
  });

  it('writes suggestion only into the layer the author clicks', () => {
    const current = { projectSystem: '旧 system', diagnose: '旧诊断' };
    assert.deepEqual(
      applyPromptLabSuggestionToLayer(current, new Error('bad'), 'diagnose'),
      current
    );
    assert.deepEqual(
      applyPromptLabSuggestionToLayer(current, { suggestedText: '新诊断' }, 'diagnose'),
      { projectSystem: '旧 system', diagnose: '新诊断' }
    );
    assert.deepEqual(
      applyPromptLabSuggestionToLayer(current, { suggestedText: '新 system' }, 'project_system'),
      { projectSystem: '新 system', diagnose: '旧诊断' }
    );
  });

  it('tells the author publish will not hijack the open loop', () => {
    assert.ok(AUTO_LOOP_PROMPT_LAB_PUBLISH_HINT.includes('再开一次'));
    assert.ok(AUTO_LOOP_PROMPT_LAB_SYSTEM_PUBLISH_HINT.includes('所有生成'));
    assert.ok(AUTO_LOOP_PROMPT_LAB_CHAT_HINT.includes('点写入'));
  });
});
