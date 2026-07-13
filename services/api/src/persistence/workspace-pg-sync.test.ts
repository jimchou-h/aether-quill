import assert from 'node:assert/strict';
import test from 'node:test';
import { createManyInBatches } from './workspace-pg-sync';

test('createManyInBatches 按批次调用 createBatch', async () => {
  const batches: number[][] = [];
  await createManyInBatches([1, 2, 3, 4, 5], 2, async (batch) => {
    batches.push(batch);
  });
  assert.deepEqual(batches, [[1, 2], [3, 4], [5]]);
});
