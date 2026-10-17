import assert from 'node:assert/strict';
import test from 'node:test';
import { ChapterRefinementEventBus } from './chapter-refinement-event-bus';

/**
 * 6.1：SSE 观察与执行解耦的一致性保障。
 *
 * 同一 run 的多个订阅者（例如同一作者开两个面板）必须看到逐条一致的 envelope：
 * 相同的 (attemptId, seq) 序列，才能按 (attemptId, seq) 去重而不丢事件。
 */

test('多订阅者收到逐条一致的 envelope（attemptId / seq 单调）', () => {
  const bus = new ChapterRefinementEventBus();
  const first: Array<Record<string, unknown>> = [];
  const second: Array<Record<string, unknown>> = [];

  bus.subscribe('run-1', (event) => first.push(event));
  bus.subscribe('run-1', (event) => second.push(event));

  bus.publish('run-1', {
    event: 'stage',
    revision: 2,
    attemptId: 'attempt-a',
    payload: { phase: 'reading' },
  });
  bus.publish('run-1', {
    event: 'stage',
    revision: 3,
    attemptId: 'attempt-a',
    payload: { phase: 'planning' },
  });
  bus.publish('run-1', {
    event: 'finished',
    revision: 4,
    attemptId: 'attempt-a',
    payload: { done: true },
  });

  assert.equal(first.length, 3);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((event) => event.seq),
    [1, 2, 3]
  );
  assert.ok(first.every((event) => event.runId === 'run-1' && event.attemptId === 'attempt-a'));
});

test('新 attempt 重置 seq：旧订阅者按 (attemptId, seq) 去重不串号', () => {
  const bus = new ChapterRefinementEventBus();
  const events: Array<Record<string, unknown>> = [];
  bus.subscribe('run-1', (event) => events.push(event));

  bus.publish('run-1', { event: 'stage', revision: 1, attemptId: 'attempt-a' });
  bus.publish('run-1', { event: 'paused', revision: 2, attemptId: 'attempt-a' });
  // 续跑另开 attempt：seq 从 1 重新计数，但 attemptId 不同，不构成重复
  bus.publish('run-1', { event: 'stage', revision: 3, attemptId: 'attempt-b' });

  assert.deepEqual(
    events.map((event) => [event.attemptId, event.seq]),
    [
      ['attempt-a', 1],
      ['attempt-a', 2],
      ['attempt-b', 1],
    ]
  );
});

test('单个订阅者异常不影响其他订阅者与后续发布', () => {
  const bus = new ChapterRefinementEventBus();
  const healthy: Array<Record<string, unknown>> = [];

  bus.subscribe('run-1', () => {
    throw new Error('订阅者渲染失败');
  });
  bus.subscribe('run-1', (event) => healthy.push(event));

  assert.doesNotThrow(() => bus.publish('run-1', { event: 'stage', revision: 1, attemptId: 'a' }));
  assert.doesNotThrow(() => bus.publish('run-1', { event: 'stage', revision: 2, attemptId: 'a' }));
  assert.equal(healthy.length, 2);
});

test('退订后不再收到事件；release 清理 run 的全部订阅', () => {
  const bus = new ChapterRefinementEventBus();
  const events: Array<Record<string, unknown>> = [];
  const unsubscribe = bus.subscribe('run-1', (event) => events.push(event));

  bus.publish('run-1', { event: 'stage', revision: 1, attemptId: 'a' });
  unsubscribe();
  bus.publish('run-1', { event: 'stage', revision: 2, attemptId: 'a' });
  assert.equal(events.length, 1);

  // release 后重新订阅从 seq=0 起，不会复用旧监听者
  bus.release('run-1');
  const afterRelease: Array<Record<string, unknown>> = [];
  bus.subscribe('run-1', (event) => afterRelease.push(event));
  bus.publish('run-1', { event: 'stage', revision: 3, attemptId: 'b' });
  assert.equal(events.length, 1);
  assert.equal(afterRelease.length, 1);
  assert.equal(afterRelease[0].seq, 1);
});
