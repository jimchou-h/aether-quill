import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildStyleSamplePromptBlock,
  isWritingStyleInjectionTemplateKey,
  selectWritingStyleSamplesForTask,
  type WritingStyleSample,
} from '@aether-quill/config';
import { buildUserMessage } from './generation-prompt-assembler';

const sampleText = (scene: string) =>
  `这是一段用于文风注入回归的${scene}样本，强调句长节奏与用词密度的变化，不复用任何具体情节意象，只作语感参照。`;

const makeSample = (overrides: Partial<WritingStyleSample>): WritingStyleSample => ({
  id: 'sample',
  text: sampleText('通用'),
  sceneType: 'dialogue',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/**
 * 复刻 main.ts `applyWritingStyleSamplesToContext` 的组合路径，作为端到端注入回归锚点。
 */
function resolveInjectedBlock(input: {
  samples: WritingStyleSample[];
  templateKey: string;
  chapterNo?: number;
}): { block?: string; ids: string[] } {
  if (!isWritingStyleInjectionTemplateKey(input.templateKey)) {
    return { ids: [] };
  }
  const selected = selectWritingStyleSamplesForTask({
    samples: input.samples,
    templateKey: input.templateKey,
    chapterNo: input.chapterNo,
  });
  if (selected.length === 0) {
    return { ids: [] };
  }
  return {
    block: buildStyleSamplePromptBlock(selected).trim(),
    ids: selected.map((item) => item.id),
  };
}

describe('AQ-339 writing style injection regression', () => {
  const samples: WritingStyleSample[] = [
    makeSample({ id: 'dlg', sceneType: 'dialogue', text: sampleText('对白'), sourceChapterNo: 4 }),
    makeSample({ id: 'act', sceneType: 'action', text: sampleText('动作'), sourceChapterNo: 5 }),
    makeSample({ id: 'int', sceneType: 'intimate', text: sampleText('亲密'), sourceChapterNo: 6 }),
  ];

  it('writing task assembles 【文风参照】 block into user message with at most 2 samples', () => {
    const { block, ids } = resolveInjectedBlock({
      samples,
      templateKey: 'chapter.pipeline.character',
      chapterNo: 1,
    });
    assert.ok(block);
    assert.ok(ids.length <= 2, `expected <= 2 injected samples, got ${ids.length}`);

    const user = buildUserMessage(
      {
        systemPromptText: '',
        narrativeContext: '【大纲】主角赴宴',
        retrievedEvidence: 'chunk-1 宴会设定',
        styleSampleBlock: block,
      },
      '请按人物口吻改写本章'
    );
    assert.match(user, /【检索证据】[\s\S]*【文风参照】[\s\S]*【用户需求】/);
    const styleTagCount = (user.match(/<style-sample /g) ?? []).length;
    assert.ok(styleTagCount <= 2 && styleTagCount >= 1);
  });

  it('excludes samples sourced from the current chapter', () => {
    const { ids } = resolveInjectedBlock({
      samples: [
        makeSample({ id: 'self', sceneType: 'dialogue', sourceChapterNo: 7 }),
        makeSample({ id: 'other', sceneType: 'intimate', sourceChapterNo: 8 }),
      ],
      templateKey: 'chapter.pipeline.character',
      chapterNo: 7,
    });
    assert.ok(!ids.includes('self'));
    assert.ok(ids.includes('other'));
  });

  it('degrades to no block when no samples exist', () => {
    const { block, ids } = resolveInjectedBlock({
      samples: [],
      templateKey: 'chapter.optimize.draft',
      chapterNo: 2,
    });
    assert.equal(block, undefined);
    assert.equal(ids.length, 0);
  });

  it('never injects for non-writing (tool) tasks', () => {
    for (const templateKey of [
      'chapter.pipeline.sensory.outline',
      'chapter.pipeline.sensory.coverage.verify',
      'chapter.pipeline.brief.synthesize',
      'chapter.optimize.plan',
      'write.chapter.outline',
    ]) {
      const { block, ids } = resolveInjectedBlock({ samples, templateKey, chapterNo: 1 });
      assert.equal(block, undefined, `${templateKey} should not inject a style block`);
      assert.equal(ids.length, 0);
    }
  });
});
