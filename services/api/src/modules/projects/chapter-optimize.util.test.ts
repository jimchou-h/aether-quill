import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChapterVersionConflictError,
  assertDraftText,
  assertInstruction,
  assertPlanText,
  buildDraftUserPrompt,
  buildPlanUserPrompt,
  ensureChapterVersionMatches,
  makeOptimizationId,
  normalizeInstruction,
  parseExpectedUpdatedAt,
} from './chapter-optimize.util';

const sampleChapter = {
  chapterNo: 3,
  title: '试炼之夜',
  content: '原章节正文内容，主角在地下城遇袭，姐姐尤里乌丝赶到救援。',
  updatedAt: new Date('2026-05-13T01:00:00.000Z'),
};

test('normalizeInstruction trims whitespace and tolerates non-string', () => {
  assert.equal(normalizeInstruction('  增加心理描写  '), '增加心理描写');
  assert.equal(normalizeInstruction(undefined), '');
  assert.equal(normalizeInstruction(123), '');
});

test('assertInstruction rejects empty and overly long strings', () => {
  assert.throws(() => assertInstruction(''), /不能为空/);
  assert.throws(() => assertInstruction('x'.repeat(2001)), /2000/);
  assert.doesNotThrow(() => assertInstruction('增加心理描写'));
});

test('assertPlanText rejects empty plan', () => {
  assert.throws(() => assertPlanText(''), /planText/);
  assert.throws(() => assertPlanText('   '), /planText/);
  assert.doesNotThrow(() => assertPlanText('1. 改写第一段；2. 调整节奏'));
});

test('assertDraftText rejects empty draft', () => {
  assert.throws(() => assertDraftText(''), /draftText/);
  assert.doesNotThrow(() => assertDraftText('优化后的正文'));
});

test('buildPlanUserPrompt always wraps original chapter in <chapter-original> tag', () => {
  const prompt = buildPlanUserPrompt({
    chapter: sampleChapter,
    instruction: '增加心理描写',
  });

  assert.match(prompt, /<chapter-original chapter-no="3">/);
  assert.match(prompt, /<\/chapter-original>/);
  assert.match(prompt, /原章节正文内容，主角在地下城遇袭/);
  assert.match(prompt, /【用户优化要求】[\s\S]*增加心理描写/);
  assert.match(prompt, /禁止直接输出新的正文/);
});

test('buildPlanUserPrompt includes appearing characters and relation events when provided', () => {
  const prompt = buildPlanUserPrompt({
    chapter: sampleChapter,
    instruction: '增加心理描写',
    appearingCharacters: ['菲伦', '尤里乌丝'],
    selectedRelationEvents: [
      {
        id: 'evt-1',
        protagonist: '菲伦',
        counterparty: '尤里乌丝',
        summary: '尤里乌丝救下菲伦',
        chapterNo: 3,
      },
    ],
  });

  assert.match(prompt, /菲伦、尤里乌丝/);
  assert.match(prompt, /菲伦 ↔ 尤里乌丝（第3章）：尤里乌丝救下菲伦/);
});

test('buildDraftUserPrompt enforces both <chapter-original> and <optimization-plan> blocks', () => {
  const prompt = buildDraftUserPrompt({
    chapter: sampleChapter,
    instruction: '让节奏更紧凑',
    planText: '1. 删去重复内心独白\n2. 把战斗场面拆为短句',
  });

  assert.match(prompt, /<optimization-plan chapter-no="3">/);
  assert.match(prompt, /1\. 删去重复内心独白/);
  assert.match(prompt, /<chapter-original chapter-no="3">/);
  assert.match(prompt, /原章节正文内容/);
  assert.match(prompt, /请直接输出「优化后的章节正文」纯文本/);
});

test('parseExpectedUpdatedAt validates ISO timestamps', () => {
  assert.throws(() => parseExpectedUpdatedAt(undefined), /必须为 ISO 时间字符串/);
  assert.throws(() => parseExpectedUpdatedAt('not-a-date'), /合法的 ISO/);
  const parsed = parseExpectedUpdatedAt('2026-05-13T01:00:00.000Z');
  assert.equal(parsed.toISOString(), '2026-05-13T01:00:00.000Z');
});

test('ensureChapterVersionMatches throws ChapterVersionConflictError on mismatch', () => {
  const expected = new Date('2026-05-13T01:00:00.000Z');
  const actual = new Date('2026-05-13T02:00:00.000Z');

  assert.throws(
    () => ensureChapterVersionMatches(3, expected, actual),
    (error: unknown) =>
      error instanceof ChapterVersionConflictError &&
      error.chapterNo === 3 &&
      error.expected === expected.toISOString() &&
      error.actual === actual.toISOString()
  );
});

test('ensureChapterVersionMatches passes when timestamps match exactly', () => {
  const ts = new Date('2026-05-13T01:00:00.000Z');
  assert.doesNotThrow(() => ensureChapterVersionMatches(3, ts, new Date(ts.getTime())));
});

test('makeOptimizationId generates prefixed ids', () => {
  const planId = makeOptimizationId('plan');
  const draftId = makeOptimizationId('draft');
  assert.match(planId, /^plan-/);
  assert.match(draftId, /^draft-/);
  assert.notEqual(planId, draftId);
});
