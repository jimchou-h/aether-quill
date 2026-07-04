import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRuleSegmentFix,
  buildCharacterOutlineUserPrompt,
  buildOutlineGateRecheckUserPrompt,
  buildSensoryRewriteReviseUserPrompt,
  computeFinalPolishFingerprint,
  filterPipelinePersonas,
  getPipelineInputText,
  getPostCharacterText,
  mergePipelineConfig,
  parsePipelineOutlineJson,
  resolvePipelineOutlinePassthroughVersionKey,
  resolveOutlineGenerationTemplateKey,
  resolveOutlineSourceText,
  shouldRunCharacterAdjustmentModule,
  synthesizePipelineOutlineItemText,
  shouldRunCharacterTraitsModule,
  shouldPassthroughOutlineRewrite,
  isPipelineEditableVersionKey,
  isPipelineOutlineEmpty,
  relocateRuleIssuesInText,
  resolveFinalPolishQualityStatus,
  resolvePipelineApplyText,
  resolveProtagonistContext,
  resolveRuleIssueSpanStrict,
  sanitizeRuleIssuesForText,
  sanitizeSensoryOutlineWithContentScan,
  stripPipelineOutlineJsonFence,
  CHAPTER_PIPELINE_CHARACTER_OUTLINE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_SYSTEM_PROMPT,
  CHAPTER_PIPELINE_SENSORY_OUTLINE_TEMPLATE_KEY,
  type ChapterPipelineSession,
  type PipelineRuleIssue,
} from './chapter-pipeline.util';
import type { ContentSafetyRule } from '@aether-quill/config';

test('character traits outline default prompt specifies required/suggested JSON', () => {
  assert.match(CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_SYSTEM_PROMPT, /"required":\[/);
  assert.match(CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_SYSTEM_PROMPT, /"suggested":\[/);
  assert.doesNotMatch(CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_SYSTEM_PROMPT, /结构同角色调整大纲/);
  assert.match(CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_SYSTEM_PROMPT, /不要根级数组/);
});

test('buildCharacterOutlineUserPrompt reinforces JSON-only output in user message', () => {
  const prompt = buildCharacterOutlineUserPrompt({
    sourceText: '正文',
    protagonistContext: '',
    personaBlock: '',
  });
  assert.match(prompt, /只输出一个 JSON 对象/);
  assert.match(prompt, /不要报告式说明/);
});

test('getPipelineInputText uses version chain', () => {
  const session: ChapterPipelineSession = {
    sessionId: 's1',
    projectId: 'p1',
    chapterNo: 5,
    sourceText: 'original',
    sourceUpdatedAt: new Date().toISOString(),
    versions: {
      original: 'original',
      afterCharacter: 'version-a',
      afterSensory: 'version-b',
      afterRules: 'version-c',
      final: 'version-final',
    },
    config: {
      pipelinePreset: 'full',
      pipelineSkipSensoryOutlineReview: false,
      pipelineSkipCharacterOutlineReview: false,
      pipelineSkipCharacterTraitsOutlineReview: false,
      pipelineCharacterAdjustmentEnabled: true,
      pipelineCharacterTraitsEnabled: true,
      pipelineRulesFixMode: 'semi',
      pipelineHomogenizationEnabled: false,
      pipelineHomogenizationPriorChapterCount: 3,
      pipelineEnabledModules: [1, 2, 3],
    },
    currentModule: 4,
    traceIds: {},
    createdAt: new Date(),
  };

  assert.equal(getPipelineInputText(session, 1), 'original');
  assert.equal(getPipelineInputText(session, 2), 'version-a');
  assert.equal(getPipelineInputText(session, 3), 'version-b');
  assert.equal(getPipelineInputText(session, 4), 'version-c');
});

test('getPostCharacterText prefers afterCharacterTraits', () => {
  const session: ChapterPipelineSession = {
    sessionId: 's2',
    projectId: 'p1',
    chapterNo: 2,
    sourceText: 'original',
    sourceUpdatedAt: new Date().toISOString(),
    versions: {
      original: 'original',
      afterCharacter: 'version-a',
      afterCharacterTraits: 'version-a-prime',
    },
    config: {
      pipelinePreset: 'full',
      pipelineSkipSensoryOutlineReview: false,
      pipelineSkipCharacterOutlineReview: false,
      pipelineSkipCharacterTraitsOutlineReview: false,
      pipelineCharacterAdjustmentEnabled: true,
      pipelineCharacterTraitsEnabled: true,
      pipelineRulesFixMode: 'semi',
      pipelineHomogenizationEnabled: false,
      pipelineHomogenizationPriorChapterCount: 3,
      pipelineEnabledModules: [1, 2, 3],
    },
    currentModule: 2,
    traceIds: {},
    createdAt: new Date(),
  };
  assert.equal(getPostCharacterText(session), 'version-a-prime');
  assert.equal(getPipelineInputText(session, 2), 'version-a-prime');
});

test('parsePipelineOutlineJson preserves persona fields', () => {
  const parsed = parsePipelineOutlineJson(
    JSON.stringify({
      required: [
        {
          id: 'r1',
          text: '补发色描写',
          priority: 'required',
          personaName: '林默',
          featureRef: '外观：及腰黑发',
          anchorHint: '初见段',
        },
      ],
      suggested: [],
    })
  );
  assert.equal(parsed.required[0]?.personaName, '林默');
  assert.equal(parsed.required[0]?.featureRef, '外观：及腰黑发');
});

test('parsePipelineOutlineJson accepts character_adjustments without text field', () => {
  const parsed = parsePipelineOutlineJson(
    JSON.stringify({
      character_adjustments: [
        {
          personaName: '林默',
          featureRef: '体脂12%，八块腹肌线条凌厉（角色卡·当前状态）',
          anchorHint: '【本章第1段】林默被唤醒后睁开眼，晨光切出光柱的描写后，可补充其体脂极低、腹肌轮廓在光影下分明的细节。',
        },
      ],
    })
  );
  assert.equal(parsed.required.length, 1);
  assert.equal(parsed.suggested.length, 0);
  assert.equal(parsed.required[0]?.personaName, '林默');
  assert.match(parsed.required[0]?.text ?? '', /林默/);
  assert.match(parsed.required[0]?.text ?? '', /体脂12%/);
});

test('parsePipelineOutlineJson maps items array by priority', () => {
  const parsed = parsePipelineOutlineJson(
    JSON.stringify({
      items: [
        { id: 'a1', text: '必须补', priority: 'required' },
        { id: 'a2', text: '可选补', priority: 'suggested' },
      ],
    })
  );
  assert.equal(parsed.required.length, 1);
  assert.equal(parsed.suggested.length, 1);
});

test('synthesizePipelineOutlineItemText joins persona fields', () => {
  const text = synthesizePipelineOutlineItemText({
    personaName: '林默',
    featureRef: '黑发',
    anchorHint: '初见段',
  });
  assert.match(text, /林默/);
  assert.match(text, /黑发/);
  assert.match(text, /初见段/);
});

test('parsePipelineOutlineJson accepts root-level persona array', () => {
  const parsed = parsePipelineOutlineJson(
    `\`\`\`json
[
  {
    "personaName": "林默",
    "featureRef": "言语掌控",
    "anchorHint": "在清晨骑乘对话中补充陈述句与疑问句。"
  },
  {
    "personaName": "田曦薇",
    "featureRef": "事后安静",
    "anchorHint": "或标记为\\"suggested：若不破坏对话节奏，可先写半秒安静\\""
  }
]
\`\`\``
  );
  assert.equal(parsed.required.length, 1);
  assert.equal(parsed.suggested.length, 1);
  assert.equal(parsed.required[0]?.personaName, '林默');
  assert.equal(parsed.suggested[0]?.personaName, '田曦薇');
});

test('filterPipelinePersonas keeps only selected published personas', () => {
  const personas = [
    { name: '甲', status: 'published' },
    { name: '乙', status: 'published' },
    { name: '丙', status: 'draft' },
  ];
  assert.deepEqual(filterPipelinePersonas(personas, ['甲']), [{ name: '甲', status: 'published' }]);
  assert.equal(filterPipelinePersonas(personas).length, 2);
});

test('shouldRunCharacterTraitsModule requires module 1 enabled', () => {
  assert.equal(
    shouldRunCharacterTraitsModule({
      pipelinePreset: 'full',
      pipelineSkipSensoryOutlineReview: false,
      pipelineSkipCharacterOutlineReview: false,
      pipelineSkipCharacterTraitsOutlineReview: false,
      pipelineCharacterAdjustmentEnabled: true,
      pipelineCharacterTraitsEnabled: true,
      pipelineRulesFixMode: 'semi',
      pipelineHomogenizationEnabled: false,
      pipelineHomogenizationPriorChapterCount: 3,
      pipelineEnabledModules: [1, 2, 3],
    }),
    true
  );
  assert.equal(
    shouldRunCharacterTraitsModule({
      pipelinePreset: 'sensory_only',
      pipelineSkipSensoryOutlineReview: false,
      pipelineSkipCharacterOutlineReview: false,
      pipelineSkipCharacterTraitsOutlineReview: false,
      pipelineCharacterAdjustmentEnabled: true,
      pipelineCharacterTraitsEnabled: true,
      pipelineRulesFixMode: 'semi',
      pipelineHomogenizationEnabled: false,
      pipelineHomogenizationPriorChapterCount: 3,
      pipelineEnabledModules: [2],
    }),
    false
  );
});

test('resolvePipelineApplyText prefers final when requested', () => {
  const session: ChapterPipelineSession = {
    sessionId: 's1',
    projectId: 'p1',
    chapterNo: 1,
    sourceText: 'o',
    sourceUpdatedAt: new Date().toISOString(),
    versions: { original: 'o', afterRules: 'c', final: 'f' },
    config: {
      pipelinePreset: 'full',
      pipelineSkipSensoryOutlineReview: false,
      pipelineSkipCharacterOutlineReview: false,
      pipelineSkipCharacterTraitsOutlineReview: false,
      pipelineCharacterAdjustmentEnabled: true,
      pipelineCharacterTraitsEnabled: true,
      pipelineRulesFixMode: 'semi',
      pipelineHomogenizationEnabled: false,
      pipelineHomogenizationPriorChapterCount: 3,
      pipelineEnabledModules: [1, 2, 3],
    },
    currentModule: 'done',
    traceIds: {},
    createdAt: new Date(),
  };
  assert.equal(resolvePipelineApplyText(session, 'final'), 'f');
  assert.equal(resolvePipelineApplyText(session, 'afterRules'), 'f');
});

test('mergePipelineConfig creative_refine excludes rules module by default', () => {
  const config = mergePipelineConfig(
    { pipelinePreset: 'creative_refine', pipelineHomogenizationEnabled: false },
    {}
  );
  assert.deepEqual(config.pipelineEnabledModules, [1, 2]);
  assert.equal(config.pipelineCharacterAdjustmentEnabled, false);
});

test('mergePipelineConfig full preset enables character adjustment by default', () => {
  const config = mergePipelineConfig(
    { pipelinePreset: 'full', pipelineHomogenizationEnabled: false },
    {}
  );
  assert.deepEqual(config.pipelineEnabledModules, [1, 2, 3]);
  assert.equal(config.pipelineCharacterAdjustmentEnabled, true);
});

test('mergePipelineConfig rules module toggle adds module 3', () => {
  const config = mergePipelineConfig(
    {
      pipelinePreset: 'creative_refine',
      pipelineHomogenizationEnabled: false,
      pipelineRulesModuleEnabled: true,
    },
    {}
  );
  assert.deepEqual(config.pipelineEnabledModules, [1, 2, 3]);
});

test('isPipelineOutlineEmpty treats whitespace-only items as empty', () => {
  assert.equal(
    isPipelineOutlineEmpty({
      required: [{ id: 'r1', text: '  ', priority: 'required' }],
      suggested: [],
    }),
    true
  );
  assert.equal(
    isPipelineOutlineEmpty({
      required: [],
      suggested: [{ id: 's1', text: '加强触觉', priority: 'suggested' }],
    }),
    false
  );
  assert.equal(
    isPipelineOutlineEmpty({ required: [], suggested: [] }),
    true
  );
});

test('shouldPassthroughOutlineRewrite requires outline and empty items', () => {
  assert.equal(shouldPassthroughOutlineRewrite(undefined), false);
  assert.equal(
    shouldPassthroughOutlineRewrite({ required: [], suggested: [] }),
    true
  );
  assert.equal(
    shouldPassthroughOutlineRewrite({
      required: [{ id: 'r1', text: '调整', priority: 'required' }],
      suggested: [],
    }),
    false
  );
});

test('resolvePipelineOutlinePassthroughVersionKey maps rewrite modules', () => {
  assert.equal(resolvePipelineOutlinePassthroughVersionKey('character'), 'afterCharacter');
  assert.equal(
    resolvePipelineOutlinePassthroughVersionKey('character-traits'),
    'afterCharacterTraits'
  );
  assert.equal(resolvePipelineOutlinePassthroughVersionKey('sensory-rewrite'), 'afterSensory');
});

test('buildSensoryRewriteReviseUserPrompt includes draft feedback and outline', () => {
  const prompt = buildSensoryRewriteReviseUserPrompt({
    draftText: '草稿正文',
    outline: [{ id: 'r1', text: '加强触觉', priority: 'required' }],
    userFeedback: '减轻嗅觉描写',
    personaBlock: '角色A',
  });
  assert.match(prompt, /<chapter-draft>/);
  assert.match(prompt, /草稿正文/);
  assert.match(prompt, /<revision-feedback>/);
  assert.match(prompt, /减轻嗅觉描写/);
  assert.match(prompt, /<sensory-outline>/);
  assert.match(prompt, /加强触觉/);
});

test('shouldRunCharacterAdjustmentModule respects config flag', () => {
  assert.equal(
    shouldRunCharacterAdjustmentModule({
      pipelinePreset: 'creative_refine',
      pipelineSkipSensoryOutlineReview: false,
      pipelineSkipCharacterOutlineReview: false,
      pipelineSkipCharacterTraitsOutlineReview: false,
      pipelineCharacterAdjustmentEnabled: false,
      pipelineCharacterTraitsEnabled: true,
      pipelineRulesFixMode: 'semi',
      pipelineHomogenizationEnabled: false,
      pipelineHomogenizationPriorChapterCount: 3,
      pipelineEnabledModules: [1, 2],
    }),
    false
  );
  assert.equal(
    shouldRunCharacterAdjustmentModule({
      pipelinePreset: 'full',
      pipelineSkipSensoryOutlineReview: false,
      pipelineSkipCharacterOutlineReview: false,
      pipelineSkipCharacterTraitsOutlineReview: false,
      pipelineCharacterAdjustmentEnabled: true,
      pipelineCharacterTraitsEnabled: true,
      pipelineRulesFixMode: 'semi',
      pipelineHomogenizationEnabled: false,
      pipelineHomogenizationPriorChapterCount: 3,
      pipelineEnabledModules: [1, 2, 3],
    }),
    true
  );
});

test('mergePipelineConfig removes module 4 when homogenization disabled', () => {
  const config = mergePipelineConfig(
    { pipelinePreset: 'full', pipelineHomogenizationEnabled: false },
    {}
  );
  assert.deepEqual(config.pipelineEnabledModules, [1, 2, 3]);
});

test('resolveProtagonistContext includes unlock rules', () => {
  const block = resolveProtagonistContext(10, [
    {
      abilityKey: '飞行',
      unlockAtChapter: 8,
      descriptionForPrompt: '可在空中飞行',
    },
  ]);
  assert.match(block, /第 10 章/);
  assert.match(block, /飞行/);
  assert.match(block, /已解锁/);
});

test('resolveRuleIssueSpanStrict requires exact offset match', () => {
  const text = '前文删除段落后文仍有男人转身';
  const issue: PipelineRuleIssue = {
    id: 'pronoun-1',
    category: 'pronoun_mismatch',
    text: '男人',
    context: '仍有男人转身',
    fixStrategy: 'auto',
    startOffset: 20,
    endOffset: 22,
    fixed: false,
    source: 'deterministic',
  };
  assert.equal(resolveRuleIssueSpanStrict(text, issue), null);
  const located = resolveRuleIssueSpanStrict(text, {
    ...issue,
    startOffset: text.indexOf('男人'),
    endOffset: text.indexOf('男人') + 2,
  });
  assert.ok(located);
});

test('applyRuleSegmentFix replaces located violation text', () => {
  const text = '他看着她，后入时低头吻住了她的唇。';
  const issue: PipelineRuleIssue = {
    id: 'rear-1',
    category: 'rear_kiss',
    text: '后入时低头吻',
    context: '看着她，后入时低头吻住了她的唇',
    fixStrategy: 'ai_segment',
    startOffset: 4,
    endOffset: 11,
    fixed: false,
  };
  const { text: fixed, applied } = applyRuleSegmentFix(text, issue, '从身后贴近，在她耳边低语');
  assert.equal(applied, true);
  assert.ok(fixed.includes('从身后贴近'));
  assert.ok(!fixed.includes('后入时低头吻'));
});

test('relocateRuleIssuesInText updates offsets when exact match exists', () => {
  const text = 'alpha beta gamma';
  const start = text.indexOf('beta');
  const issues: PipelineRuleIssue[] = [
    {
      id: 'i1',
      category: 'explanatory_text',
      text: 'beta',
      context: 'alpha beta gamma',
      fixStrategy: 'ai_segment',
      startOffset: start,
      endOffset: start + 4,
      fixed: false,
      source: 'deterministic',
    },
  ];
  const relocated = relocateRuleIssuesInText(text, issues);
  assert.equal(relocated[0].startOffset, start);
  assert.equal(relocated[0].endOffset, start + 4);
});

test('sanitizeRuleIssuesForText drops issues that cannot be located in text', () => {
  const text = 'alpha beta gamma';
  const issues: PipelineRuleIssue[] = [
    {
      id: 'i1',
      category: 'forbidden_word',
      text: 'missing',
      context: '',
      fixStrategy: 'auto',
      startOffset: 50,
      endOffset: 57,
      fixed: false,
    },
  ];
  assert.equal(sanitizeRuleIssuesForText(text, issues).length, 0);
});

test('sanitizeRuleIssuesForText forces llm issues to manual', () => {
  const text = 'alpha beta gamma';
  const issues: PipelineRuleIssue[] = [
    {
      id: 'issue-1',
      category: 'explanatory_text',
      text: 'beta',
      context: 'alpha beta gamma',
      fixStrategy: 'auto',
      startOffset: 6,
      endOffset: 10,
      fixed: false,
      source: 'llm',
    },
  ];
  const sanitized = sanitizeRuleIssuesForText(text, issues);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].fixStrategy, 'manual');
});

test('sanitizeRuleIssuesForText downgrades oversized auto explanatory_text to manual', () => {
  const violation = `（换句话说，${'很长'.repeat(80)}）`;
  const text = `前文${violation}后文`;
  const issues: PipelineRuleIssue[] = [
    {
      id: 'i1',
      category: 'explanatory_text',
      text: violation,
      context: text,
      fixStrategy: 'auto',
      startOffset: 2,
      endOffset: 2 + violation.length,
      fixed: false,
      source: 'deterministic',
    },
  ];
  const sanitized = sanitizeRuleIssuesForText(text, issues);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].fixStrategy, 'manual');
});

test('applyRuleSegmentFix replaces only violation span without deleting surrounding window', () => {
  const prefix = 'A'.repeat(300);
  const suffix = 'B'.repeat(300);
  const text = `${prefix}后入时低头吻住了她的唇。${suffix}`;
  const issue: PipelineRuleIssue = {
    id: 'rear-1',
    category: 'rear_kiss',
    text: '后入时低头吻',
    context: '后入时低头吻住了她的唇',
    fixStrategy: 'ai_segment',
    startOffset: prefix.length,
    endOffset: prefix.length + 7,
    fixed: false,
  };
  const { text: fixed, applied } = applyRuleSegmentFix(text, issue, '从身后贴近低语');
  assert.equal(applied, true);
  assert.ok(fixed.startsWith(prefix));
  assert.ok(fixed.endsWith(suffix));
  assert.ok(fixed.includes('从身后贴近低语'));
});

const testForbiddenRule: ContentSafetyRule = {
  ruleId: 'test-forbidden',
  severity: 'high',
  action: 'mark',
  type: 'keyword',
  pattern: '违禁词',
};

test('sanitizeSensoryOutlineWithContentScan demotes required items with forbidden words', () => {
  const result = sanitizeSensoryOutlineWithContentScan(
    {
      required: [{ id: 'r1', text: '加强触觉描写', priority: 'required' }],
      suggested: [{ id: 's1', text: '避免使用违禁词', priority: 'suggested' }],
    },
    [testForbiddenRule],
    true
  );

  assert.equal(result.required.length, 1);
  assert.equal(result.required[0]?.id, 'r1');
  assert.equal(result.required[0]?.contentWarnings, undefined);

  assert.equal(result.suggested.length, 1);
  assert.equal(result.suggested[0]?.id, 's1');
  assert.equal(result.suggested[0]?.priority, 'suggested');
  assert.deepEqual(result.suggested[0]?.contentWarnings, ['禁用词：违禁词']);
});

test('sanitizeSensoryOutlineWithContentScan skips scan when disabled', () => {
  const result = sanitizeSensoryOutlineWithContentScan(
    {
      required: [{ id: 'r1', text: '含违禁词', priority: 'required' }],
      suggested: [],
    },
    [testForbiddenRule],
    false
  );

  assert.equal(result.required.length, 1);
  assert.equal(result.required[0]?.contentWarnings, undefined);
  assert.equal(result.suggested.length, 0);
});

test('computeFinalPolishFingerprint is stable for identical inputs', () => {
  const input = {
    chapterContent: '正文A',
    chapterUpdatedAt: '2026-06-29T00:00:00.000Z',
    personasFingerprint: 'persona-hash',
    systemPromptFingerprint: 'sys-hash',
    pipelineEngineFingerprint: 'engine-hash',
    contentSafetyRulesFingerprint: 'rules-hash',
    finalPolishConfigFingerprint: 'config-hash',
    segmentConfigFingerprint: 'segment-hash',
  };
  const first = computeFinalPolishFingerprint(input);
  const second = computeFinalPolishFingerprint(input);
  assert.equal(first, second);
  assert.notEqual(first, computeFinalPolishFingerprint({ ...input, chapterContent: '正文B' }));
});

test('resolveFinalPolishQualityStatus blocks unresolved hard issues', () => {
  assert.equal(resolveFinalPolishQualityStatus([]), 'passed');
  assert.equal(
    resolveFinalPolishQualityStatus([
      {
        id: '1',
        category: 'forbidden_word',
        text: '违禁',
        context: '',
        fixStrategy: 'auto',
        startOffset: 0,
        endOffset: 2,
        fixed: false,
      },
    ]),
    'blocked'
  );
  assert.equal(
    resolveFinalPolishQualityStatus([
      {
        id: '2',
        category: 'explanatory_text',
        text: '说明',
        context: '',
        fixStrategy: 'manual',
        startOffset: 0,
        endOffset: 2,
        fixed: false,
      },
    ]),
    'blocked'
  );
});

test('resolveOutlineGenerationTemplateKey maps outline types to module templates', () => {
  assert.equal(
    resolveOutlineGenerationTemplateKey('character'),
    CHAPTER_PIPELINE_CHARACTER_OUTLINE_TEMPLATE_KEY
  );
  assert.equal(
    resolveOutlineGenerationTemplateKey('character-traits'),
    CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_TEMPLATE_KEY
  );
  assert.equal(
    resolveOutlineGenerationTemplateKey('sensory'),
    CHAPTER_PIPELINE_SENSORY_OUTLINE_TEMPLATE_KEY
  );
});

test('resolveOutlineSourceText aligns with outline module input text', () => {
  const session = {
    chapterNo: 3,
    versions: {
      original: '原文',
      afterCharacter: '角色调整后',
      afterCharacterTraits: '特征润色后',
    },
    config: {
      pipelinePreset: 'full',
      pipelineSkipSensoryOutlineReview: false,
      pipelineSkipCharacterOutlineReview: false,
      pipelineSkipCharacterTraitsOutlineReview: false,
      pipelineCharacterAdjustmentEnabled: true,
      pipelineCharacterTraitsEnabled: true,
      pipelineRulesFixMode: 'semi',
      pipelineHomogenizationEnabled: false,
      pipelineHomogenizationPriorChapterCount: 3,
      pipelineEnabledModules: [1, 2, 3],
    },
  } as ChapterPipelineSession;

  assert.equal(resolveOutlineSourceText(session, 'character'), '原文');
  assert.equal(resolveOutlineSourceText(session, 'character-traits'), '角色调整后');
  assert.equal(resolveOutlineSourceText(session, 'sensory'), '特征润色后');
});

test('buildOutlineGateRecheckUserPrompt recheck mirrors first-run output contract', () => {
  const baseUserPrompt = buildCharacterOutlineUserPrompt({
    sourceText: '章节正文',
    protagonistContext: '主角上下文',
    personaBlock: '人物A',
  });
  const prompt = buildOutlineGateRecheckUserPrompt({
    baseUserPrompt,
    currentOutline: {
      required: [{ id: 'r1', text: '待改项', priority: 'required' }],
      suggested: [],
    },
    mode: 'recheck',
    revisionRound: 2,
  });

  assert.match(prompt, /<chapter-original>\n章节正文\n<\/chapter-original>/);
  assert.match(prompt, /<current-outline>/);
  assert.match(prompt, /与首次生成完全相同/);
  assert.doesNotMatch(prompt, /大纲复核说明/);
  assert.doesNotMatch(prompt, /重新诊断/);
});

test('buildOutlineGateRecheckUserPrompt revise mode includes user feedback', () => {
  const prompt = buildOutlineGateRecheckUserPrompt({
    baseUserPrompt: '<chapter-original>\nx\n</chapter-original>',
    currentOutline: { required: [], suggested: [] },
    mode: 'revise',
    revisionRound: 1,
    userFeedback: '删掉第二条',
  });

  assert.match(prompt, /<user-feedback>\n删掉第二条\n<\/user-feedback>/);
  assert.match(prompt, /与首次生成相同诊断流程/);
  assert.doesNotMatch(prompt, /按意见修订/);
});

test('parsePipelineOutlineJson normalizes diagnostic split fields into text', () => {
  const parsed = parsePipelineOutlineJson(
    JSON.stringify({
      required: [
        {
          id: 'r3',
          character: '田曦薇',
          category: '核心算法偏离',
          priority: 'required',
          location: '第52段“右侧脸颊上的梨涡因为哭泣而深深陷着”',
          problem: '梨涡情绪晴雨表规则：痛苦/被强迫时梨涡应消失或若隐若现，深陷是开心标志',
          fix: '改为梨涡消失或若隐若现',
        },
      ],
      suggested: [],
    })
  );

  assert.equal(parsed.required.length, 1);
  assert.match(parsed.required[0]?.text ?? '', /田曦薇/);
  assert.match(parsed.required[0]?.text ?? '', /核心算法偏离/);
  assert.match(parsed.required[0]?.text ?? '', /梨涡/);
  assert.match(parsed.required[0]?.text ?? '', /修改方向：改为梨涡消失或若隐若现/);
  assert.equal(parsed.required[0]?.personaName, '田曦薇');
});

test('stripPipelineOutlineJsonFence extracts JSON object after prose preamble', () => {
  const raw = [
    '好的，作为资深小说编辑，我已根据诊断步骤，对章节正文进行角色维度诊断。以下是修订后的完整调整大纲。',
    '{"required":[{"id":"r1","text":"调整口吻","priority":"required"}],"suggested":[]}',
  ].join('\n');

  const cleaned = stripPipelineOutlineJsonFence(raw);
  const parsed = parsePipelineOutlineJson(raw);
  assert.equal(cleaned.startsWith('{'), true);
  assert.equal(parsed.required.length, 1);
  assert.equal(parsed.required[0]?.text, '调整口吻');
});

test('stripPipelineOutlineJsonFence extracts fenced JSON from mixed output', () => {
  const raw = [
    '说明文字',
    '```json',
    '{"required":[],"suggested":[{"id":"s1","text":"建议项","priority":"suggested"}]}',
    '```',
  ].join('\n');

  const parsed = parsePipelineOutlineJson(raw);
  assert.equal(parsed.suggested.length, 1);
  assert.equal(parsed.suggested[0]?.text, '建议项');
});

test('isPipelineEditableVersionKey accepts pipeline version keys only', () => {
  assert.equal(isPipelineEditableVersionKey('afterCharacterTraits'), true);
  assert.equal(isPipelineEditableVersionKey('final'), true);
  assert.equal(isPipelineEditableVersionKey('original'), false);
  assert.equal(isPipelineEditableVersionKey('unknown'), false);
});
