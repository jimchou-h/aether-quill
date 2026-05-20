import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TraceRecord } from './types';

function sampleTrace(id: string): TraceRecord {
  return {
    id,
    projectId: 'proj-1',
    prompt: 'test',
    context: {},
    providerType: 'deepseek',
    model: 'deepseek-chat',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

test('TraceStore persists on push and restores after reload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aq-trace-'));
  const prevCwd = process.cwd();
  process.chdir(dir);

  try {
    const { TraceStore } = await import('./trace-store');
    const store1 = new TraceStore();
    store1.push(sampleTrace('trace-a'));
    store1.close();

    const store2 = new TraceStore();
    const { total, data } = store2.query({});
    assert.equal(total, 1);
    assert.equal(data[0]?.id, 'trace-a');
    store2.close();
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TraceStore persists on update', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aq-trace-update-'));
  const prevCwd = process.cwd();
  process.chdir(dir);

  try {
    const { TraceStore } = await import('./trace-store');
    const store1 = new TraceStore();
    store1.push(sampleTrace('trace-b'));
    store1.update('trace-b', { status: 'completed', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } });
    store1.close();

    const store2 = new TraceStore();
    const trace = store2.findById('trace-b');
    assert.equal(trace?.status, 'completed');
    assert.equal(trace?.usage?.totalTokens, 3);
    store2.close();
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
