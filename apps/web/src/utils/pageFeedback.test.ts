import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { presentError, presentErrorFromCaught, presentInfo, presentSuccess } from './pageFeedback';

describe('pageFeedback', () => {
  it('presentError trims and returns the message', () => {
    assert.equal(presentError('  加载失败  '), '加载失败');
  });

  it('presentError ignores empty messages', () => {
    assert.equal(presentError('   '), '');
  });

  it('presentErrorFromCaught prefers Error.message', () => {
    assert.equal(presentErrorFromCaught(new Error('接口异常'), '默认失败'), '接口异常');
  });

  it('presentErrorFromCaught falls back when Error message is empty', () => {
    assert.equal(presentErrorFromCaught(new Error('   '), '默认失败'), '默认失败');
  });

  it('presentSuccess and presentInfo return trimmed messages', () => {
    assert.equal(presentSuccess('  已保存  '), '已保存');
    assert.equal(presentInfo('  提示  '), '提示');
  });
});
