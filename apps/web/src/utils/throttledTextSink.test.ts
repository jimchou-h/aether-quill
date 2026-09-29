import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shallowRef } from 'vue';
import { createThrottledTextSink } from './throttledTextSink';

describe('createThrottledTextSink', () => {
  it('batches appends until flush or timer', async () => {
    const target = shallowRef('');
    const sink = createThrottledTextSink(target, { intervalMs: 40 });
    sink.append('甲');
    sink.append('乙');
    assert.equal(target.value, '');
    sink.flush();
    assert.equal(target.value, '甲乙');
    sink.dispose();
  });

  it('replace clears pending and writes immediately', () => {
    const target = shallowRef('旧');
    const sink = createThrottledTextSink(target, { intervalMs: 200 });
    sink.append('新片段');
    sink.replace('整章替换');
    assert.equal(target.value, '整章替换');
    sink.flush();
    assert.equal(target.value, '整章替换');
    sink.dispose();
  });

  it('timer eventually flushes pending text', async () => {
    const target = shallowRef('');
    const sink = createThrottledTextSink(target, { intervalMs: 30 });
    sink.append('晚');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(target.value, '晚');
    sink.dispose();
  });
});
