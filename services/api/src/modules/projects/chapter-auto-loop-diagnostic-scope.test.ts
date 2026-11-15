import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { getWarehouseDefaultTaskPromptText } from '../task-prompts/task-prompt-defaults';
import {
  CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
  buildAutoLoopPlanUserPrompt,
  parseAutoLoopPlanItems,
  resolveItemAnchor,
  splitIndexedParagraphs,
} from './chapter-auto-loop.util';

interface AssembledMessage {
  role: string;
  content: string;
}

const requireSource = createRequire(__filename);

// Exercise the independent orchestrator's public assembly functions without
// importing its source into the API's TypeScript rootDir or starting services.
const { resolveTaskSystemPromptFromContext, WAREHOUSE_TASK_PROMPT_DEFAULTS } = requireSource(
  path.resolve(__dirname, '../../../../rag-orchestrator/src/generation/task-prompt-defaults.ts')
) as {
  WAREHOUSE_TASK_PROMPT_DEFAULTS: Record<string, string>;
  resolveTaskSystemPromptFromContext(input: {
    templateKey: string;
    taskPrompts: Record<string, string>;
  }): string | undefined;
};
const { buildLlmMessages } = requireSource(
  path.resolve(
    __dirname,
    '../../../../rag-orchestrator/src/generation/generation-prompt-assembler.ts'
  )
) as {
  buildLlmMessages(
    context: { systemPromptText: string; taskSystemPrompt?: string; narrativeContext: string },
    userPrompt: string
  ): AssembledMessage[];
};
interface RegisteredTaskTemplate {
  id: string;
  version: string;
  systemPromptText?: string;
}
const { chapterOptimizeLoopPlanTemplate, templateRegistry } = requireSource(
  path.resolve(__dirname, '../../../../../packages/prompt-templates/src/templates.ts')
) as {
  chapterOptimizeLoopPlanTemplate?: RegisteredTaskTemplate;
  templateRegistry: Record<string, RegisteredTaskTemplate>;
};

function assembleDiagnosticMessages(taskPrompt: string): AssembledMessage[] {
  const resolved = resolveTaskSystemPromptFromContext({
    templateKey: CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
    taskPrompts: { [CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY]: taskPrompt },
  });
  assert.equal(resolved, taskPrompt, '已同步的任务全文须实际进入组装链');

  const userPrompt = buildAutoLoopPlanUserPrompt({
    instruction: '额外留意重复使用同一个词。',
    chapterNo: 1,
    chapterTitle: '纠错测试',
    indexedBody: '[1] 此段用于检查基础语言错误。\n\n[2] 此段用于检查指代与状态。',
    roundIndex: 1,
    roundBudget: 3,
    narrativeContext: '参考材料只用于判断，不属于本轮可编辑正文。',
    previousWindowTail: '上一窗的只读参考内容。',
  });

  const previousLegacyMode = process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
  delete process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
  try {
    return buildLlmMessages(
      {
        systemPromptText: '项目写作规则：保持人物设定与叙事视角一致。',
        taskSystemPrompt: resolved,
        narrativeContext: '',
      },
      userPrompt
    );
  } finally {
    if (previousLegacyMode === undefined) {
      delete process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
    } else {
      process.env.LLM_PROMPT_LEGACY_SINGLE_USER = previousLegacyMode;
    }
  }
}

function assertOpenDiagnosticScope(prompt: string, source: string): void {
  assert.match(prompt, /逐段主动检查基础错误/, `${source}须主动覆盖基础错误`);
  assert.match(
    prompt,
    /用户指定要求是额外重点，不是检查范围的上限/,
    `${source}不得将用户要求当成检查白名单`
  );
  assert.doesNotMatch(
    prompt,
    /只(?:允许)?出两类条目|没有这两类则输出|没有 ①② 两类问题|没有 ①② 时不要出条目/,
    `${source}不得保留旧的两类问题限制`
  );
}

test('默认自动复诊任务经过真实消息组装后主动覆盖基础错误及用户额外重点', () => {
  const messages = assembleDiagnosticMessages(
    getWarehouseDefaultTaskPromptText(CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY)
  );
  const system = messages.find((message) => message.role === 'system')?.content ?? '';
  assertOpenDiagnosticScope(system, '默认任务 system');
  for (const category of [
    /错别字、病句、搭配不当/,
    /同义叠加、无作用的重复解释/,
    /指代含混、动作主体混乱/,
    /衣着、持物、位置、时序及身体状态矛盾/,
    /固定设定冲突、视角越界或无依据的动机断言/,
  ]) {
    assert.match(system, category, '基础检查不应依赖用户逐项列出');
  }
});

test('合成已发布任务允许基础检查时真实 user 尾部不得重新缩窄成只查两类或用户清单', () => {
  const publishedTask =
    '合成已发布复诊任务：逐段主动检查基础错误；用户指定要求是额外重点，不是检查范围的上限。只输出 JSON。';
  const messages = assembleDiagnosticMessages(publishedTask);
  const system = messages.find((message) => message.role === 'system')?.content ?? '';
  const user = messages.find((message) => message.role === 'user')?.content ?? '';
  assert.ok(system.includes(publishedTask), '自定义已发布全文须优先于编排默认');
  const scopeTail = user.slice(user.lastIndexOf('</indexed-chapter>'));
  assertOpenDiagnosticScope(scopeTail, '运行时 user 尾部');
  assert.match(user, /【用户优化要求】\n额外留意重复使用同一个词。/);
  assert.match(scopeTail, /paragraphIndex.*\[n\]/);
  assert.match(scopeTail, /anchorQuote.*连续摘录/);
  assert.match(scopeTail, /不得摘录【参考上下文】、【下章衔接】/);
  assert.match(scopeTail, /【上一窗末文·只读】/);
  assert.match(scopeTail, /JSON/);
});

test('自动复诊 API 默认、编排兜底和模板包逐字一致并登记 v1.0.0', () => {
  const apiDefault = getWarehouseDefaultTaskPromptText(CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY);
  assert.equal(
    WAREHOUSE_TASK_PROMPT_DEFAULTS[CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY],
    apiDefault,
    '编排兜底不能保留旧的诊断范围'
  );
  assert.ok(chapterOptimizeLoopPlanTemplate, '模板包须导出自动复诊任务模板');
  assert.equal(chapterOptimizeLoopPlanTemplate.id, CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY);
  assert.equal(chapterOptimizeLoopPlanTemplate.version, '1.0.0');
  assert.equal(chapterOptimizeLoopPlanTemplate.systemPromptText, apiDefault);
  const registered = templateRegistry[CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY];
  assert.ok(registered, '自动复诊模板须进入 templateRegistry');
  assert.equal(registered.version, '1.0.0');
  assert.equal(registered.systemPromptText, apiDefault);
});

test('不足八字的短段全文锚点可解析并按正确编号定位，错号时仍不冒险重定位', () => {
  const { paragraphs } = splitIndexedParagraphs('流程记录。\n\n灯灭了。');
  const parsed = parseAutoLoopPlanItems(
    JSON.stringify({
      items: [
        {
          id: 'short-anchor',
          paragraphIndex: 2,
          anchorQuote: '灯灭了。',
          severity: 'high',
          issue: '根据前文记录核对状态用词。',
          instruction: '修正状态用词，保留本段其余内容。',
        },
      ],
    })
  );
  assert.equal(parsed.parseFailed, false);
  assert.equal(parsed.discardedCount, 0);
  const item = parsed.items[0];
  assert.ok(item);
  assert.deepEqual(resolveItemAnchor({ item, paragraphs }), {
    outcome: 'exact',
    resolvedParagraphIndex: 2,
  });
  assert.equal(
    resolveItemAnchor({ item: { ...item, paragraphIndex: 1 }, paragraphs }).outcome,
    'unlocatable'
  );
});
