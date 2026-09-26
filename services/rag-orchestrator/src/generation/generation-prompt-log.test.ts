import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGenerationPromptFullLoggingEnabled,
  isGenerationPromptLoggingEnabled,
  isWriteChapterPromptLoggingEnabled,
  resolveGenerationPromptLogKind,
  resolveGenerationPromptLogMode,
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
      trace({ context: { templateKey: 'chapter.optimize.direct-draft' } })
    ),
    'optimize-draft'
  );
  assert.equal(
    resolveGenerationPromptLogKind(
      trace({ context: { templateKey: 'chapter.optimize.workbench-draft-sex' } })
    ),
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

test('isGenerationPromptLoggingEnabled 默认摘要、可关、可打全文', () => {
  const prevGen = process.env.LOG_GENERATION_PROMPT;
  const prevWrite = process.env.LOG_WRITE_CHAPTER_PROMPT;
  try {
    delete process.env.LOG_GENERATION_PROMPT;
    delete process.env.LOG_WRITE_CHAPTER_PROMPT;
    assert.equal(resolveGenerationPromptLogMode(), 'summary');
    assert.equal(isGenerationPromptLoggingEnabled(), true);
    assert.equal(isGenerationPromptFullLoggingEnabled(), false);
    assert.equal(isWriteChapterPromptLoggingEnabled(), true);

    process.env.LOG_WRITE_CHAPTER_PROMPT = 'false';
    assert.equal(resolveGenerationPromptLogMode(), 'off');
    assert.equal(isGenerationPromptLoggingEnabled(), false);
    assert.equal(isGenerationPromptFullLoggingEnabled(), false);

    delete process.env.LOG_WRITE_CHAPTER_PROMPT;
    process.env.LOG_GENERATION_PROMPT = 'off';
    assert.equal(isGenerationPromptLoggingEnabled(), false);

    process.env.LOG_GENERATION_PROMPT = 'true';
    assert.equal(resolveGenerationPromptLogMode(), 'full');
    assert.equal(isGenerationPromptFullLoggingEnabled(), true);
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
