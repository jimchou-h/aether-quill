import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWriteChapterPromptLoggingEnabled,
  resolveWriteChapterPromptKind,
} from './generation-prompt-log';
import type { TraceRecord } from './types';

function trace(partial: Partial<TraceRecord>): TraceRecord {
  return {
    id: 't1',
    projectId: 'p1',
    prompt: 'user',
    context: {},
    providerType: 'deepseek',
    model: 'deepseek-chat',
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

test('resolveWriteChapterPromptKind 识别大纲与正文', () => {
  assert.equal(
    resolveWriteChapterPromptKind(trace({ context: { templateKey: 'write.chapter.outline' } })),
    'outline'
  );
  assert.equal(
    resolveWriteChapterPromptKind(trace({ context: { templateKey: 'write.chapter' } })),
    'draft'
  );
  assert.equal(
    resolveWriteChapterPromptKind(trace({ context: { phase: 'write.chapter.draft' } })),
    'draft'
  );
  assert.equal(
    resolveWriteChapterPromptKind(trace({ context: { templateKey: 'chapter.optimize.plan' } })),
    null
  );
});

test('isWriteChapterPromptLoggingEnabled 默认开启且可关闭', () => {
  const prev = process.env.LOG_WRITE_CHAPTER_PROMPT;
  try {
    delete process.env.LOG_WRITE_CHAPTER_PROMPT;
    assert.equal(isWriteChapterPromptLoggingEnabled(), true);

    process.env.LOG_WRITE_CHAPTER_PROMPT = 'false';
    assert.equal(isWriteChapterPromptLoggingEnabled(), false);
  } finally {
    if (prev === undefined) {
      delete process.env.LOG_WRITE_CHAPTER_PROMPT;
    } else {
      process.env.LOG_WRITE_CHAPTER_PROMPT = prev;
    }
  }
});
