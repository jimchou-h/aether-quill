import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGenerationPromptLoggingEnabled,
  isWriteChapterPromptLoggingEnabled,
  resolveGenerationPromptLogKind,
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

test('resolveGenerationPromptLogKind 识别写作工作台与章节优化', () => {
  assert.equal(
    resolveGenerationPromptLogKind(trace({ context: { templateKey: 'write.chapter.outline' } })),
    'outline'
  );
  assert.equal(
    resolveGenerationPromptLogKind(trace({ context: { templateKey: 'write.chapter' } })),
    'draft'
  );
  assert.equal(
    resolveGenerationPromptLogKind(trace({ context: { phase: 'write.chapter.draft' } })),
    'draft'
  );
  assert.equal(
    resolveGenerationPromptLogKind(trace({ context: { templateKey: 'chapter.optimize.plan' } })),
    'optimize-plan'
  );
  assert.equal(
    resolveGenerationPromptLogKind(trace({ context: { templateKey: 'chapter.optimize.draft' } })),
    'optimize-draft'
  );
  assert.equal(
    resolveGenerationPromptLogKind(
      trace({ context: { templateKey: 'chapter.pipeline.character-traits.outline' } })
    ),
    'pipeline'
  );
  assert.equal(resolveWriteChapterPromptKind, resolveGenerationPromptLogKind);
});

test('isGenerationPromptLoggingEnabled 默认开启且可关闭', () => {
  const prevGen = process.env.LOG_GENERATION_PROMPT;
  const prevWrite = process.env.LOG_WRITE_CHAPTER_PROMPT;
  try {
    delete process.env.LOG_GENERATION_PROMPT;
    delete process.env.LOG_WRITE_CHAPTER_PROMPT;
    assert.equal(isGenerationPromptLoggingEnabled(), true);
    assert.equal(isWriteChapterPromptLoggingEnabled(), true);

    process.env.LOG_WRITE_CHAPTER_PROMPT = 'false';
    assert.equal(isGenerationPromptLoggingEnabled(), false);

    delete process.env.LOG_WRITE_CHAPTER_PROMPT;
    process.env.LOG_GENERATION_PROMPT = 'off';
    assert.equal(isGenerationPromptLoggingEnabled(), false);
  } finally {
    if (prevGen === undefined) {
      delete process.env.LOG_GENERATION_PROMPT;
    } else {
      process.env.LOG_GENERATION_PROMPT = prevGen;
    }
    if (prevWrite === undefined) {
      delete process.env.LOG_WRITE_CHAPTER_PROMPT;
    } else {
      process.env.LOG_WRITE_CHAPTER_PROMPT = prevWrite;
    }
  }
});
