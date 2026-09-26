import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

test('TraceStore defers disk write until flush and persists compact JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aq-trace-defer-'));
  const prevCwd = process.cwd();
  process.chdir(dir);

  try {
    const { TraceStore } = await import('./trace-store');
    const store = new TraceStore();
    store.push(sampleTrace('trace-c'));
    assert.equal(existsSync(join(dir, 'data', 'traces.json')), false);
    store.close();

    const raw = readFileSync(join(dir, 'data', 'traces.json'), 'utf8');
    assert.equal(raw.includes('\n  "traces"'), false);
    assert.equal(JSON.parse(raw).traces[0]?.id, 'trace-c');
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TraceStore 落盘去掉完整 prompt 与模型返回', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aq-trace-slim-'));
  const prevCwd = process.cwd();
  process.chdir(dir);

  try {
    const { TraceStore } = await import('./trace-store');
    const store = new TraceStore();
    store.push({
      id: 'trace-fat',
      projectId: 'proj-1',
      prompt: '这是很长的用户 prompt'.repeat(50),
      context: {
        templateKey: 'chapter.optimize.draft',
        assembled_prompt: '完整拼装'.repeat(80),
        user_message: 'user 全文'.repeat(80),
        system_message: 'system 全文'.repeat(40),
        systemChars: 12,
        userChars: 34,
        full_documents: [{ documentId: 'd1', title: '杨幂角色卡', content: '角色卡全文'.repeat(200) }],
      },
      result: '模型返回正文'.repeat(80),
      providerType: 'deepseek',
      model: 'deepseek-v4-flash',
      status: 'completed',
      createdAt: new Date().toISOString(),
    });
    store.close();

    const raw = readFileSync(join(dir, 'data', 'traces.json'), 'utf8');
    const saved = JSON.parse(raw).traces[0];
    assert.equal(saved.prompt, '');
    assert.equal(saved.result, undefined);
    assert.equal(saved.context.assembled_prompt, undefined);
    assert.equal(saved.context.user_message, undefined);
    assert.equal(saved.context.system_message, undefined);
    assert.equal(saved.context.templateKey, 'chapter.optimize.draft');
    assert.equal(saved.context.systemChars, 12);
    assert.equal(saved.context.userChars, 34);
    assert.equal(raw.includes('完整拼装'), false);
    assert.equal(raw.includes('模型返回正文'), false);
    assert.equal(raw.includes('角色卡全文'), false);
    assert.equal(String(saved.context.full_documents[0].content).includes('omitted'), true);
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TraceStore 落盘截断 full_documents 正文，启动恢复也不把长文本读回内存', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aq-trace-docs-'));
  const prevCwd = process.cwd();
  process.chdir(dir);

  try {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(dir, 'data'), { recursive: true });
    const fatContent = '角色卡全文'.repeat(200);
    writeFileSync(
      join(dir, 'data', 'traces.json'),
      JSON.stringify({
        traces: [
          {
            id: 'trace-docs',
            projectId: 'proj-1',
            prompt: fatContent,
            context: {
              templateKey: 'chapter.optimize.draft',
              confirmedOutlineText: fatContent,
              full_documents: [{ documentId: 'd1', title: '杨幂角色卡', content: fatContent }],
            },
            result: fatContent,
            providerType: 'deepseek',
            model: 'deepseek-v4-flash',
            status: 'completed',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      'utf8'
    );

    const { TraceStore } = await import('./trace-store');
    const store = new TraceStore();
    const restored = store.findById('trace-docs');
    assert.equal(restored?.prompt, '');
    assert.equal(restored?.result, undefined);
    assert.equal(restored?.context.templateKey, 'chapter.optimize.draft');
    assert.equal(String(restored?.context.confirmedOutlineText).includes('omitted'), true);
    const docs = restored?.context.full_documents as Array<{ content: string }>;
    assert.equal(docs[0]?.content.includes('omitted'), true);
    assert.equal(JSON.stringify(restored).includes('角色卡全文'), false);
    store.close();
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
