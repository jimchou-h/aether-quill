import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAsyncSerialQueue } from './async-serial-queue';

describe('createAsyncSerialQueue', () => {
  it('runs tasks serially even when enqueued concurrently', async () => {
    const queue = createAsyncSerialQueue();
    const order: number[] = [];
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const p1 = queue.enqueue(async () => {
      await delay(30);
      order.push(1);
    });
    const p2 = queue.enqueue(async () => {
      await delay(5);
      order.push(2);
    });
    const p3 = queue.enqueue(async () => {
      order.push(3);
    });

    await Promise.all([p1, p2, p3]);
    assert.deepEqual(order, [1, 2, 3]);
  });

  it('continues after a failed task', async () => {
    const queue = createAsyncSerialQueue();
    const order: string[] = [];

    const failed = queue.enqueue(async () => {
      order.push('a');
      throw new Error('boom');
    });
    const ok = queue.enqueue(async () => {
      order.push('b');
    });

    await assert.rejects(() => failed, /boom/);
    await ok;
    assert.deepEqual(order, ['a', 'b']);
  });
});
