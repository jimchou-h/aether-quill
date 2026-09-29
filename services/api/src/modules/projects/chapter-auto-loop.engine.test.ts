import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeAutoLoopTimelineRounds,
  runChapterAutoLoop,
  runChapterAutoLoopWindows,
  synthesizeAutoLoopResume,
} from './chapter-auto-loop.engine';
import type {
  AutoLoopDiagnoseInput,
  AutoLoopEngineEvent,
  AutoLoopResumeState,
  AutoLoopRewriteInput,
} from './chapter-auto-loop.engine';

const PARAGRAPHS = [
  '雨下了一整夜，屋檐还在滴水，青石板上积了一层薄薄的水光。',
  '他握紧了拳头，转身离开，把那扇吱呀作响的木门带上了。',
  '院子里的老槐树落了满地叶子，风一过便打着旋儿贴上墙根。',
  '她在灯下坐了很久，手里的针线一直没有动，影子被拉得很长。',
  '天快亮的时候雨才停，远处传来第一声鸡鸣，接着是第二声。',
];

const STORED = PARAGRAPHS.join('\n\n');

function planJson(
  items: Array<{
    index: number;
    quote: string;
    severity: 'high' | 'medium' | 'low';
    instruction?: string;
  }>
): string {
  return JSON.stringify({
    items: items.map((item, position) => ({
      id: `r${position + 1}`,
      paragraphIndex: item.index,
      anchorQuote: item.quote,
      severity: item.severity,
      issue: '问题描述',
      instruction: item.instruction ?? '换成更具体的身体细节与呼吸节奏',
    })),
  });
}

/** 按原段字数的指定倍率生成替换文本，用于精确压测两级闸门的带宽 */
function replacementOfRatio(originalParagraph: string, ratio: number): string {
  const target = Math.floor(originalParagraph.length * ratio);
  let text = '改写：';
  while (text.length < target) {
    text += '他的指节泛白，呼吸压得很低，雨声盖住了脚步。';
  }
  return text.slice(0, target);
}

/** 生成与原段字数相近的合法替换，避免误触段级字数闸门 */
function legalReplacement(originalParagraph: string): string {
  return replacementOfRatio(originalParagraph, 1);
}

interface HarnessOptions {
  storedContent?: string;
  instruction?: string;
  roundBudget?: number;
  diagnoses?: string[];
  /** 按调用次序消费；用于测「首次解不开 → 重试」 */
  diagnoseSequence?: string[];
  rewrite?: (input: AutoLoopRewriteInput) => Promise<string> | string;
  abortAfterRewrites?: number;
  /** 指定轮 `round_end` 后置为中断，用于压测「下一轮复诊前」的断点 */
  abortAfterRoundEnd?: number;
  resume?: AutoLoopResumeState;
}

async function runHarness(options: HarnessOptions) {
  const events: AutoLoopEngineEvent[] = [];
  const checkpoints: AutoLoopResumeState[] = [];
  const diagnoseInputs: AutoLoopDiagnoseInput[] = [];
  const rewriteInputs: AutoLoopRewriteInput[] = [];
  let rewriteCount = 0;
  let diagnoseCall = 0;
  let aborted = false;

  const result = await runChapterAutoLoop({
    storedContent: options.storedContent ?? STORED,
    instruction: options.instruction ?? '让打斗与情绪更有临场感',
    roundBudget: options.roundBudget ?? 2,
    ...(options.resume ? { resume: options.resume } : {}),
    deps: {
      diagnose: async (input) => {
        diagnoseInputs.push(input);
        if (options.diagnoseSequence) {
          const text = options.diagnoseSequence[diagnoseCall] ?? planJson([]);
          diagnoseCall += 1;
          return text;
        }
        return options.diagnoses?.[input.roundIndex - 1] ?? planJson([]);
      },
      rewriteSegment: async (input) => {
        rewriteInputs.push(input);
        rewriteCount += 1;
        if (
          options.abortAfterRewrites !== undefined &&
          rewriteCount >= options.abortAfterRewrites
        ) {
          aborted = true;
        }
        if (options.rewrite) {
          return options.rewrite(input);
        }
        return legalReplacement(input.originalParagraph);
      },
      isAborted: () => aborted,
    },
    onEvent: (event) => {
      events.push(event);
      if (
        event.type === 'round_end' &&
        options.abortAfterRoundEnd !== undefined &&
        event.roundIndex === options.abortAfterRoundEnd
      ) {
        aborted = true;
      }
    },
    onCheckpoint: (resume) => {
      checkpoints.push(resume);
    },
  });

  return { result, events, checkpoints, diagnoseInputs, rewriteInputs };
}

function eventNames(events: AutoLoopEngineEvent[]): string[] {
  return events.map((event) => event.type);
}

// ---------------------------------------------------------------------------
// 单轮最小闭环（切片一）
// ---------------------------------------------------------------------------

test('删除第n段整段抽槽且不调用改写', async () => {
  const { result, rewriteInputs } = await runHarness({
    roundBudget: 1,
    instruction: '删除多余过渡句，让动作节奏连贯',
    diagnoses: [
      planJson([
        {
          index: 3,
          quote: '院子里的老槐树落了满地叶子',
          severity: 'high',
          instruction: '删除第3段整段。',
        },
      ]),
    ],
  });

  assert.equal(rewriteInputs.length, 0, '删除第n段整段不得调用改写模型');
  assert.equal(result.rounds[0].items[0].status, 'deleted');
  assert.ok(!result.finalDraft.includes(PARAGRAPHS[2]));
});

test('与邻段合并的源段抽槽且不调用改写，保留段原文不动', async () => {
  const { result, rewriteInputs } = await runHarness({
    roundBudget: 1,
    instruction: '删除多余过渡句，让动作节奏连贯',
    diagnoses: [
      planJson([
        {
          index: 3,
          quote: '院子里的老槐树落了满地叶子',
          severity: 'high',
          instruction:
            "将3段与2段合并，删除'风一过便打着旋儿贴上墙根。'整句，2段保留现有动作即可，不再追加比喻。",
        },
      ]),
    ],
  });

  assert.equal(rewriteInputs.length, 0, '合并到邻段不得调用改写模型');
  assert.equal(result.rounds[0].items[0].status, 'deleted');
  assert.ok(!result.finalDraft.includes(PARAGRAPHS[2]));
  assert.ok(result.finalDraft.includes(PARAGRAPHS[1]));
});

test('删除并整合进邻段时先改写保留段再删源段', async () => {
  const rewriteOrder: number[] = [];
  const { result, rewriteInputs } = await runHarness({
    roundBudget: 1,
    instruction: '去掉重复射精描写，节奏要紧',
    diagnoses: [
      planJson([
        {
          index: 3,
          quote: '院子里的老槐树落了满地叶子',
          severity: 'high',
          instruction: '删除[3]整句，使[2]直接衔接[4]。将老槐树与落叶细节整合进[2]段。',
        },
      ]),
    ],
    rewrite: async (input) => {
      rewriteOrder.push(input.paragraphIndex);
      return legalReplacement(input.originalParagraph);
    },
  });
  assert.deepEqual(rewriteOrder, [2], '只改写保留段');
  assert.equal(rewriteInputs.length, 1);
  const statuses = result.rounds[0].items.map((item) => [
    item.resolvedParagraphIndex ?? item.paragraphIndex,
    item.status,
  ]);
  assert.ok(statuses.some(([index, status]) => index === 2 && status === 'applied'));
  assert.ok(statuses.some(([index, status]) => index === 3 && status === 'deleted'));
  assert.ok(!result.finalDraft.includes(PARAGRAPHS[2]));
  assert.ok(result.finalDraft.includes('改写：'));
});

test('保留段改写失败时不删除源段，避免内容丢失', async () => {
  const { result } = await runHarness({
    roundBudget: 1,
    instruction: '去掉重复描写',
    diagnoses: [
      planJson([
        {
          index: 3,
          quote: '院子里的老槐树落了满地叶子',
          severity: 'high',
          instruction: '删除[3]整句，将落叶细节整合进[2]段。',
        },
      ]),
    ],
    rewrite: async () => {
      throw new Error('模拟改写失败');
    },
  });
  const items = result.rounds[0].items;
  assert.ok(items.some((item) => item.status === 'failed' || item.status === 'rolled_back'));
  assert.ok(
    items.some(
      (item) =>
        (item.resolvedParagraphIndex ?? item.paragraphIndex) === 3 && item.status === 'rolled_back'
    ),
    '源段应跳过删除'
  );
  assert.ok(result.finalDraft.includes(PARAGRAPHS[2]), '源段原文必须仍在');
});

test('上一轮 deferred 在下一轮硬入队，不依赖模型再次提出', async () => {
  const longChapter = Array.from(
    { length: 20 },
    (_, i) => `第${i + 1}段正文内容足够长以便定位引文。`
  ).join('\n\n');
  const round1Items = Array.from({ length: 15 }, (_, i) => ({
    index: i + 1,
    quote: `第${i + 1}段正文内容足够长`,
    severity: 'high' as const,
  }));
  const { result, rewriteInputs, diagnoseInputs } = await runHarness({
    storedContent: longChapter,
    roundBudget: 2,
    diagnoses: [
      planJson(round1Items),
      // 第 2 轮模型不再提出，但引擎应消化上一轮 deferred
      planJson([]),
    ],
  });
  assert.equal(diagnoseInputs.length, 2);
  assert.ok(result.rounds[0].deferredCount > 0, '第 1 轮应有顺延');
  assert.ok(
    (result.rounds[1]?.appliedCount ?? 0) > 0 ||
      rewriteInputs.length > (result.rounds[0].appliedCount ?? 0),
    '第 2 轮应继续改写顺延段'
  );
});

test('最后一轮不截断命中上限，本轮点到的条目全部改完', async () => {
  const longChapter = Array.from(
    { length: 20 },
    (_, i) => `第${i + 1}段正文内容足够长以便定位引文。`
  ).join('\n\n');
  const lastRoundItems = Array.from({ length: 15 }, (_, i) => ({
    index: i + 1,
    quote: `第${i + 1}段正文内容足够长`,
    severity: 'high' as const,
  }));
  const { result, rewriteInputs } = await runHarness({
    storedContent: longChapter,
    roundBudget: 1,
    diagnoses: [planJson(lastRoundItems)],
  });
  assert.equal(result.rounds[0].deferredCount, 0, '最后一轮不得把条目顺延后丢弃');
  assert.equal(rewriteInputs.length, 15);
  assert.equal(result.stoppedReason, 'budget');
});

test('合并指令挂在保留段上时仍走改写，不抽保留段', async () => {
  const { result, rewriteInputs } = await runHarness({
    roundBudget: 1,
    diagnoses: [
      planJson([
        {
          index: 2,
          quote: '他握紧了拳头，转身离开',
          severity: 'medium',
          instruction: '将3段与2段合并，2段保留现有动作，不再追加比喻。',
        },
      ]),
    ],
  });

  assert.equal(rewriteInputs.length, 1);
  assert.equal(result.rounds[0].items[0].status, 'applied');
  assert.ok(result.finalDraft.includes(PARAGRAPHS[2]));
});

test('整段删除抽槽且不调用改写，前后段直接衔接', async () => {
  const { result, rewriteInputs } = await runHarness({
    roundBudget: 1,
    instruction: '删除多余过渡句，让动作节奏连贯',
    diagnoses: [
      planJson([
        {
          index: 2,
          quote: '他握紧了拳头，转身离开',
          severity: 'high',
          instruction: '删除[2]整句，使[1]结尾直接衔接[3]。',
        },
      ]),
    ],
  });

  assert.equal(rewriteInputs.length, 0, '整段删除不得调用改写模型');
  assert.equal(result.stoppedReason, 'budget');
  assert.equal(result.rounds[0].items[0].status, 'deleted');
  assert.ok(!result.finalDraft.includes(PARAGRAPHS[1]));
  assert.ok(result.finalDraft.includes(PARAGRAPHS[0]));
  assert.ok(result.finalDraft.includes(PARAGRAPHS[2]));
});

test('句内删除仍走改写，不抽槽', async () => {
  const { result, rewriteInputs } = await runHarness({
    roundBudget: 1,
    diagnoses: [
      planJson([
        {
          index: 2,
          quote: '他握紧了拳头，转身离开',
          severity: 'high',
          instruction: '删除这句里的成语，改成具体动作',
        },
      ]),
    ],
  });

  assert.equal(rewriteInputs.length, 1);
  assert.equal(result.rounds[0].items[0].status, 'applied');
  assert.ok(!result.finalDraft.includes(PARAGRAPHS[1]));
});

test('单轮跑通并按序发出轮次与条目事件', async () => {
  const { result, events } = await runHarness({
    roundBudget: 1,
    diagnoses: [planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' }])],
  });

  const names = eventNames(events);
  assert.deepEqual(names, [
    'round_start',
    'plan_items',
    'segment_start',
    'item_status',
    'round_end',
  ]);
  assert.equal(result.rounds.length, 1);
  assert.equal(result.stoppedReason, 'budget');
  assert.notEqual(result.finalDraft, STORED);
});

test('条目事件先于任何改写事件到达', async () => {
  const { events } = await runHarness({
    roundBudget: 1,
    diagnoses: [planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' }])],
  });
  const planIndex = eventNames(events).indexOf('plan_items');
  const firstSegment = eventNames(events).indexOf('segment_start');
  assert.ok(planIndex >= 0 && firstSegment > planIndex);
});

test('未命中段落在成稿中逐字节保持原样', async () => {
  const { result } = await runHarness({
    roundBudget: 1,
    diagnoses: [planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' }])],
  });
  const untouched = [PARAGRAPHS[0], PARAGRAPHS[2], PARAGRAPHS[3], PARAGRAPHS[4]];
  untouched.forEach((paragraph) => {
    assert.ok(result.finalDraft.includes(paragraph), `未命中段落应原样保留：${paragraph}`);
  });
  assert.ok(!result.finalDraft.includes(PARAGRAPHS[1]), '命中段落应已被替换');
});

test('复诊输出空条目时立即收敛且不改动正文', async () => {
  const { result, events } = await runHarness({
    roundBudget: 3,
    diagnoses: [planJson([])],
  });
  assert.equal(result.finalDraft, STORED);
  assert.equal(result.stoppedReason, 'converged');
  assert.equal(result.rounds[0].converged, true);
  assert.ok(!eventNames(events).includes('segment_start'));
});

test('复诊调用中抛 AbortError 时按中断收工，不冒充解析失败', async () => {
  let aborted = false;
  const events: AutoLoopEngineEvent[] = [];
  const result = await runChapterAutoLoop({
    storedContent: STORED,
    instruction: '让打斗更有临场感',
    roundBudget: 2,
    deps: {
      diagnose: async () => {
        aborted = true;
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
      rewriteSegment: async (input) => legalReplacement(input.originalParagraph),
      isAborted: () => aborted,
    },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.stoppedReason, 'aborted');
  assert.ok(!eventNames(events).includes('segment_start'));
});

test('复诊输出无法解析时终止并保留上一稿', async () => {
  const { result } = await runHarness({
    roundBudget: 2,
    diagnoses: ['这一章写得挺好的，我觉得不用改。'],
  });
  assert.equal(result.finalDraft, STORED);
  assert.equal(result.stoppedReason, 'plan_parse_failed');
});

test('JSON 可解析但全部条目不合法时按契约失败终止，绝不冒充收敛', async () => {
  const { result } = await runHarness({
    roundBudget: 3,
    diagnoses: [
      JSON.stringify({
        items: Array.from({ length: 11 }, (_, i) => ({
          paragraphIndex: i + 1,
          severity: 'high',
          issue: '缺少 anchorQuote 与 instruction，无法安全定位改写',
        })),
      }),
    ],
  });
  assert.equal(result.stoppedReason, 'plan_parse_failed');
  assert.equal(result.finalDraft, STORED, '什么都没读懂时正文必须原样保留');
  assert.ok(
    !result.rounds.some((round) => round.converged),
    '11 条读不懂却报收敛，会让用户以为章节已经干净'
  );
});

test('复诊首次解不开时自动再诊一次，第二次成功则继续改写', async () => {
  const { result, diagnoseInputs } = await runHarness({
    roundBudget: 1,
    diagnoses: [],
    diagnoseSequence: [
      '这一章写得挺好的，我觉得不用改。',
      planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' }]),
    ],
  });
  assert.equal(diagnoseInputs.length, 2);
  assert.equal(diagnoseInputs[0].retryCount ?? 0, 0);
  assert.equal(diagnoseInputs[1].retryCount, 1);
  assert.notEqual(result.stoppedReason, 'plan_parse_failed');
  assert.notEqual(result.finalDraft, STORED);
});

// ---------------------------------------------------------------------------
// 定位降级与同段合并（切片二 / 四）
// ---------------------------------------------------------------------------

test('无法定位的条目被跳过并计数，不触发改写', async () => {
  const { result, rewriteInputs } = await runHarness({
    roundBudget: 1,
    diagnoses: [
      planJson([
        { index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' },
        { index: 3, quote: '这句引文压根不在本章任何位置出现过', severity: 'high' },
      ]),
    ],
  });
  assert.equal(rewriteInputs.length, 1);
  assert.equal(result.rounds[0].unlocatableCount, 1);
  const skipped = result.rounds[0].items.filter((item) => item.status === 'skipped_unlocatable');
  assert.equal(skipped.length, 1);
});

test('引文救回错误编号后仍执行改写并标 relocated', async () => {
  const { result, rewriteInputs } = await runHarness({
    roundBudget: 1,
    diagnoses: [planJson([{ index: 1, quote: '他握紧了拳头，转身离开', severity: 'high' }])],
  });
  assert.equal(rewriteInputs.length, 1);
  assert.equal(rewriteInputs[0].paragraphIndex, 2);
  assert.equal(result.rounds[0].items[0].status, 'relocated');
});

test('改写带上目标段前后文，而不只是相邻一段', async () => {
  const { rewriteInputs } = await runHarness({
    roundBudget: 1,
    diagnoses: [planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' }])],
  });
  assert.equal(rewriteInputs.length, 1);
  assert.match(rewriteInputs[0].precedingText ?? '', /雨下了一整夜/);
  assert.match(rewriteInputs[0].followingText ?? '', /老槐树/);
  assert.match(rewriteInputs[0].followingText ?? '', /她在灯下坐了很久/);
});

test('同段多条合并为一次改写且指令都带上', async () => {
  const { result, rewriteInputs } = await runHarness({
    roundBudget: 1,
    diagnoses: [
      planJson([
        { index: 2, quote: '他握紧了拳头', severity: 'high', instruction: '指令甲' },
        { index: 2, quote: '转身离开', severity: 'medium', instruction: '指令乙' },
      ]),
    ],
  });
  assert.equal(rewriteInputs.length, 1);
  assert.equal(rewriteInputs[0].items.length, 2);
  assert.equal(result.rounds[0].items.filter((item) => item.status === 'applied').length, 2);
});

// ---------------------------------------------------------------------------
// 分层闸门（切片三）
// ---------------------------------------------------------------------------

test('坏段只回滚该段，同轮好段的改写保留', async () => {
  const { result } = await runHarness({
    roundBudget: 1,
    diagnoses: [
      planJson([
        { index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' },
        { index: 4, quote: '她在灯下坐了很久', severity: 'high' },
      ]),
    ],
    rewrite: (input) =>
      input.paragraphIndex === 2
        ? '以下是修改后的段落：他的指节泛白，转身走进雨里，把门带上。'
        : legalReplacement(input.originalParagraph),
  });

  const round = result.rounds[0];
  const rolledBack = round.items.filter((item) => item.status === 'rolled_back');
  const applied = round.items.filter((item) => item.status === 'applied');
  assert.equal(rolledBack.length, 1);
  assert.equal(applied.length, 1);
  assert.match(rolledBack[0].note ?? '', /说明/);
  assert.ok(result.finalDraft.includes(PARAGRAPHS[1]), '坏段应回滚为原文');
  assert.ok(!result.finalDraft.includes(PARAGRAPHS[3]), '好段应已改写');
});

test('扩写后的成稿被接受，不因字数膨胀整轮回滚', async () => {
  const { result } = await runHarness({
    roundBudget: 1,
    diagnoses: [
      planJson([
        { index: 1, quote: '雨下了一整夜', severity: 'high' },
        { index: 2, quote: '他握紧了拳头', severity: 'high' },
        { index: 3, quote: '院子里的老槐树', severity: 'high' },
      ]),
    ],
    rewrite: (input) => replacementOfRatio(input.originalParagraph, 3),
  });

  assert.equal(result.rounds[0].rolledBack, false);
  assert.ok(result.finalDraft.length > STORED.length);
  assert.notEqual(result.stoppedReason, 'round_rolled_back');
});

// ---------------------------------------------------------------------------
// 多轮与收敛（切片四）
// ---------------------------------------------------------------------------

test('第 2 轮复诊的输入是第 1 轮成稿而非入库原文', async () => {
  const { result, diagnoseInputs } = await runHarness({
    roundBudget: 2,
    diagnoses: [
      planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' }]),
      planJson([{ index: 4, quote: '她在灯下坐了很久', severity: 'medium' }]),
    ],
  });

  assert.equal(diagnoseInputs.length, 2);
  assert.equal(diagnoseInputs[0].roundIndex, 1);
  assert.ok(diagnoseInputs[0].currentDraft === STORED);
  assert.equal(diagnoseInputs[1].roundIndex, 2);
  assert.notEqual(diagnoseInputs[1].currentDraft, STORED);
  assert.equal(diagnoseInputs[1].currentDraft, result.rounds[0].draft);
});

test('第 2 轮复诊带上一轮条目及其最终状态', async () => {
  const { diagnoseInputs } = await runHarness({
    roundBudget: 2,
    diagnoses: [
      planJson([
        { index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' },
        { index: 3, quote: '这句引文压根不在本章任何位置出现过', severity: 'high' },
      ]),
      planJson([]),
    ],
  });

  const previous = diagnoseInputs[1].previousItems;
  assert.equal(previous.length, 2);
  assert.ok(previous.some((item) => item.status === 'applied'));
  assert.ok(previous.some((item) => item.status === 'skipped_unlocatable'));
});

test('仅剩轻微条目时提前收敛，不再发起下一轮', async () => {
  const { result, diagnoseInputs } = await runHarness({
    roundBudget: 3,
    diagnoses: [
      planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'low' }]),
      planJson([{ index: 4, quote: '她在灯下坐了很久', severity: 'high' }]),
    ],
  });

  assert.equal(diagnoseInputs.length, 1);
  assert.equal(result.rounds.length, 1);
  assert.equal(result.stoppedReason, 'converged');
});

test('中等条目不再续跑下一轮复诊', async () => {
  const { result, diagnoseInputs } = await runHarness({
    roundBudget: 3,
    diagnoses: [
      planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'medium' }]),
      planJson([{ index: 4, quote: '她在灯下坐了很久', severity: 'low' }]),
    ],
  });

  assert.equal(diagnoseInputs.length, 1);
  assert.equal(result.rounds.length, 1);
  assert.equal(result.stoppedReason, 'converged');
});

test('仍有 high 但到达轮数上限时停止且不算收敛', async () => {
  const { result } = await runHarness({
    roundBudget: 2,
    diagnoses: [
      planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' }]),
      planJson([{ index: 4, quote: '她在灯下坐了很久', severity: 'high' }]),
    ],
  });

  assert.equal(result.rounds.length, 2);
  assert.equal(result.stoppedReason, 'budget');
  assert.equal(result.rounds[1].converged, false);
});

// ---------------------------------------------------------------------------
// 中断（切片五）
// ---------------------------------------------------------------------------

test('中断时保留最近一次已完成轮次的成稿', async () => {
  const { result } = await runHarness({
    roundBudget: 3,
    diagnoses: [
      planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' }]),
      planJson([
        { index: 4, quote: '她在灯下坐了很久', severity: 'high' },
        { index: 5, quote: '天快亮的时候雨才停', severity: 'high' },
      ]),
    ],
    // 第 1 轮 1 次改写 + 第 2 轮第 1 次改写后置为中断
    abortAfterRewrites: 2,
  });

  assert.equal(result.stoppedReason, 'aborted');
  assert.equal(result.rounds.length, 1, '被中断的轮次不计入已完成轮次');
  assert.equal(result.finalDraft, result.rounds[0].draft);
  assert.notEqual(result.finalDraft, STORED);
});

test('首轮改写中途中断时退回入库原文，并留下可续跑的段级断点', async () => {
  const { result } = await runHarness({
    roundBudget: 2,
    diagnoses: [
      planJson([
        { index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' },
        { index: 4, quote: '她在灯下坐了很久', severity: 'high' },
      ]),
    ],
    abortAfterRewrites: 1,
  });

  assert.equal(result.stoppedReason, 'aborted');
  assert.equal(result.rounds.length, 0);
  assert.equal(result.finalDraft, STORED);
  assert.equal(result.resume?.rewriteCheckpoint?.remainingTargets.length, 1);
  assert.equal(result.resume?.rewriteCheckpoint?.nextSegmentIndex, 2);
  assert.equal(result.resume?.rewriteCheckpoint?.replacements.length, 1);
});

test('复诊解析失败后可从同一轮复诊续跑，已完成轮成稿保留', async () => {
  const first = await runHarness({
    roundBudget: 2,
    diagnoses: [
      planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' }]),
      '这一章写得挺好的，我觉得不用改。',
    ],
  });
  assert.equal(first.result.stoppedReason, 'plan_parse_failed');
  assert.equal(first.result.rounds.length, 1);
  assert.ok(first.result.resume);
  assert.equal(first.result.resume?.startRoundIndex, 2);
  assert.equal(first.result.resume?.rewriteCheckpoint, undefined);

  const second = await runHarness({
    roundBudget: 2,
    diagnoses: [
      planJson([]),
      planJson([{ index: 4, quote: '她在灯下坐了很久', severity: 'high' }]),
    ],
    resume: first.result.resume,
  });
  assert.equal(second.diagnoseInputs[0].roundIndex, 2);
  assert.equal(second.result.rounds.length, 2);
  assert.equal(second.result.rounds[0].draft, first.result.rounds[0].draft);
  assert.notEqual(second.result.stoppedReason, 'plan_parse_failed');
});

test('改写中途中断后可从剩余段落续跑，不重做已改段', async () => {
  const first = await runHarness({
    roundBudget: 1,
    diagnoses: [
      planJson([
        { index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' },
        { index: 4, quote: '她在灯下坐了很久', severity: 'high' },
      ]),
    ],
    abortAfterRewrites: 1,
  });
  assert.equal(first.result.stoppedReason, 'aborted');
  assert.equal(first.rewriteInputs.length, 1);

  const second = await runHarness({
    roundBudget: 1,
    diagnoses: [planJson([])],
    resume: first.result.resume,
  });
  assert.equal(second.diagnoseInputs.length, 0, '续跑改写不得重新复诊');
  assert.equal(second.rewriteInputs.length, 1);
  assert.equal(second.rewriteInputs[0].paragraphIndex, 4);
  assert.equal(second.result.rounds.length, 1);
  assert.equal(second.result.stoppedReason, 'budget');
  assert.ok(second.result.finalDraft.includes('改写：'));
});

test('旧会话没有 checkpoint 时仍可从下一轮复诊续跑', () => {
  const resume = synthesizeAutoLoopResume({
    stoppedReason: 'plan_parse_failed',
    rounds: [
      {
        roundIndex: 1,
        draft: '第一轮成稿',
        items: [],
        appliedCount: 1,
        rolledBackCount: 0,
        unlocatableCount: 0,
        deferredCount: 0,
        discardedCount: 0,
        converged: false,
        rolledBack: false,
      },
    ],
    finalDraft: '第一轮成稿',
    storedContent: STORED,
    roundBudget: 5,
  });
  assert.ok(resume);
  assert.equal(resume?.startRoundIndex, 2);
  assert.equal(resume?.currentDraft, '第一轮成稿');
  assert.equal(resume?.rewriteCheckpoint, undefined);
});

test('已收工的会话不能合成续跑断点', () => {
  const resume = synthesizeAutoLoopResume({
    stoppedReason: 'converged',
    rounds: [],
    finalDraft: STORED,
    storedContent: STORED,
    roundBudget: 2,
  });
  assert.equal(resume, undefined);
});

test('第1轮改写全部完成后，断点必须带上本轮成稿，不得写成未发生', async () => {
  const { result, checkpoints } = await runHarness({
    roundBudget: 3,
    diagnoses: [
      planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' }]),
      planJson([{ index: 4, quote: '她在灯下坐了很久', severity: 'high' }]),
    ],
    abortAfterRoundEnd: 1,
  });

  assert.equal(result.stoppedReason, 'aborted');
  assert.equal(result.rounds.length, 1);
  assert.ok(
    checkpoints.every(
      (checkpoint) =>
        (checkpoint.rewriteCheckpoint?.remainingTargets.length ?? 0) > 0 ||
        checkpoint.completedRounds.length > 0
    ),
    '不得在本轮尚未过闸门时写入 remaining 为空且 completedRounds 为空的断点'
  );

  const afterRound = checkpoints.find(
    (checkpoint) =>
      checkpoint.completedRounds.length === 1 && checkpoint.rewriteCheckpoint === undefined
  );
  assert.ok(afterRound, '下一轮复诊开始前必须落过带本轮成稿的断点');
  assert.equal(afterRound?.startRoundIndex, 2);
  assert.equal(afterRound?.currentDraft, result.rounds[0].draft);
  assert.notEqual(afterRound?.currentDraft, STORED);
});

test('无改写目标的轮结束后，断点仍要带上该轮，避免下一轮复诊期间刷新丢进度', async () => {
  const { result, checkpoints } = await runHarness({
    roundBudget: 3,
    diagnoses: [
      planJson([{ index: 2, quote: '这段引文在正文里根本找不到啊啊啊', severity: 'high' }]),
      planJson([{ index: 4, quote: '她在灯下坐了很久', severity: 'high' }]),
    ],
    abortAfterRoundEnd: 1,
  });

  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0].appliedCount, 0);
  const afterRound = checkpoints.find(
    (checkpoint) =>
      checkpoint.completedRounds.length === 1 && checkpoint.rewriteCheckpoint === undefined
  );
  assert.ok(afterRound);
  assert.equal(afterRound?.startRoundIndex, 2);
  assert.equal(afterRound?.currentDraft, STORED);
});

const WINDOW_A = 'AAAAAAAAAA';
const WINDOW_B = 'BBBBBBBBBB';
const WINDOW_C = 'CCCCCCCCCC';
const WINDOW_D = 'DDDDDDDDDD';
const WINDOW_E = 'EEEEEEEEEE';
const WINDOW_F = 'FFFFFFFFFF';
const TWO_WINDOW_SOURCE = [WINDOW_A, WINDOW_B, WINDOW_C, WINDOW_D].join('\n\n');
const THREE_WINDOW_SOURCE = [WINDOW_A, WINDOW_B, WINDOW_C, WINDOW_D, WINDOW_E, WINDOW_F].join(
  '\n\n'
);
const WINDOWING = { segmentCharSize: 20, singleSegmentThreshold: 0 };

async function runWindowsHarness(options: HarnessOptions & { storedContent: string }) {
  const events: AutoLoopEngineEvent[] = [];
  const checkpoints: AutoLoopResumeState[] = [];
  const diagnoseInputs: AutoLoopDiagnoseInput[] = [];
  const rewriteInputs: AutoLoopRewriteInput[] = [];
  let rewriteCount = 0;
  let diagnoseCall = 0;
  let aborted = false;

  const result = await runChapterAutoLoopWindows({
    storedContent: options.storedContent,
    instruction: options.instruction ?? '让打斗与情绪更有临场感',
    roundBudget: options.roundBudget ?? 2,
    windowing: WINDOWING,
    ...(options.resume ? { resume: options.resume } : {}),
    deps: {
      diagnose: async (input) => {
        diagnoseInputs.push(input);
        if (options.diagnoseSequence) {
          const text = options.diagnoseSequence[diagnoseCall] ?? planJson([]);
          diagnoseCall += 1;
          return text;
        }
        return options.diagnoses?.[diagnoseCall++] ?? planJson([]);
      },
      rewriteSegment: async (input) => {
        rewriteInputs.push(input);
        rewriteCount += 1;
        if (
          options.abortAfterRewrites !== undefined &&
          rewriteCount >= options.abortAfterRewrites
        ) {
          aborted = true;
        }
        if (options.rewrite) {
          return options.rewrite(input);
        }
        return legalReplacement(input.originalParagraph);
      },
      isAborted: () => aborted,
    },
    onEvent: (event) => {
      events.push(event);
    },
    onCheckpoint: (resume) => {
      checkpoints.push(resume);
    },
  });

  return { result, events, checkpoints, diagnoseInputs, rewriteInputs };
}

test('分段字数为 0 时只跑一次内层循环且不发 window_start', async () => {
  const events: AutoLoopEngineEvent[] = [];
  await runChapterAutoLoopWindows({
    storedContent: TWO_WINDOW_SOURCE,
    instruction: '让打斗与情绪更有临场感',
    roundBudget: 1,
    windowing: { segmentCharSize: 0, singleSegmentThreshold: 0 },
    deps: {
      diagnose: async () => planJson([]),
      rewriteSegment: async (input) => legalReplacement(input.originalParagraph),
      isAborted: () => false,
    },
    onEvent: (event) => events.push(event),
  });
  assert.equal(events.filter((event) => event.type === 'window_start').length, 0);
});

test('每窗独立循环：顺序复诊、窗 2 不改窗 1、拼稿含两窗', async () => {
  const { result, events, diagnoseInputs, rewriteInputs } = await runWindowsHarness({
    storedContent: TWO_WINDOW_SOURCE,
    roundBudget: 1,
    diagnoses: [
      planJson([{ index: 1, quote: WINDOW_A, severity: 'high' }]),
      planJson([{ index: 1, quote: WINDOW_C, severity: 'high' }]),
    ],
  });

  assert.equal(diagnoseInputs.length, 2);
  assert.ok(diagnoseInputs[0]?.currentDraft.includes(WINDOW_A));
  assert.ok(!diagnoseInputs[0]?.currentDraft.includes(WINDOW_C));
  assert.ok(diagnoseInputs[1]?.currentDraft.includes(WINDOW_C));
  assert.ok(!diagnoseInputs[1]?.currentDraft.includes(WINDOW_A));
  assert.equal(diagnoseInputs[1]?.previousWindowTail, WINDOW_B);
  assert.deepEqual(
    rewriteInputs.map((input) => input.originalParagraph),
    [WINDOW_A, WINDOW_C]
  );
  assert.equal(events.filter((event) => event.type === 'window_start').length, 2);
  const roundStarts = events.filter((event) => event.type === 'round_start');
  assert.equal(roundStarts[0]?.windowIndex, 1);
  assert.equal(roundStarts[1]?.windowIndex, 2);
  assert.equal(roundStarts[0]?.windowTotal, 2);
  const lastDraft = events.filter((event) => event.type === 'round_end').at(-1);
  assert.ok(lastDraft && lastDraft.type === 'round_end');
  assert.ok(lastDraft.round.draft.includes(WINDOW_B));
  assert.ok(lastDraft.round.draft.includes(WINDOW_D));
  assert.ok(result.finalDraft.includes(WINDOW_B));
  assert.ok(result.finalDraft.includes(WINDOW_D));
  assert.ok(result.finalDraft.includes('改写：'));
  assert.ok(!result.finalDraft.startsWith(WINDOW_C));
  assert.equal(result.rounds.length, 2);
  assert.equal(result.rounds[0]?.windowIndex, 1);
  assert.equal(result.rounds[1]?.windowIndex, 2);
  assert.equal(result.rounds[0]?.windowTotal, 2);
  assert.equal(result.rounds[0]?.roundIndex, 1);
  assert.equal(result.rounds[1]?.roundIndex, 1);
});

test('弹窗轮数对每一窗生效，不是整章总预算', async () => {
  const { diagnoseInputs } = await runWindowsHarness({
    storedContent: TWO_WINDOW_SOURCE,
    roundBudget: 2,
    diagnoseSequence: [
      planJson([{ index: 1, quote: WINDOW_A, severity: 'high' }]),
      planJson([]),
      planJson([{ index: 1, quote: WINDOW_C, severity: 'high' }]),
      planJson([]),
    ],
  });
  assert.equal(diagnoseInputs.length, 4);
  assert.equal(diagnoseInputs[0]?.roundIndex, 1);
  assert.equal(diagnoseInputs[1]?.roundIndex, 2);
  assert.equal(diagnoseInputs[2]?.roundIndex, 1);
  assert.equal(diagnoseInputs[3]?.roundIndex, 2);
  assert.ok(diagnoseInputs[2]?.currentDraft.includes(WINDOW_C));
});

test('窗 2 复诊解析失败时停后续窗，并保留窗 1 成稿', async () => {
  const { result, diagnoseInputs } = await runWindowsHarness({
    storedContent: THREE_WINDOW_SOURCE,
    roundBudget: 1,
    diagnoseSequence: [
      planJson([{ index: 1, quote: WINDOW_A, severity: 'high' }]),
      '这一章写得挺好的，我觉得不用改。',
      '这一章写得挺好的，我觉得不用改。',
      planJson([{ index: 1, quote: WINDOW_E, severity: 'high' }]),
    ],
  });
  assert.equal(result.stoppedReason, 'plan_parse_failed');
  assert.ok(diagnoseInputs.every((input) => !input.currentDraft.includes(WINDOW_E)));
  assert.equal(result.resume?.windowPack?.windowIndex, 2);
  assert.equal(result.resume?.windowPack?.windowTotal, 3);
  assert.equal(result.resume?.windowPack?.completedWindowDrafts.length, 1);
  assert.ok(result.finalDraft.includes('改写：'));
  assert.ok(result.finalDraft.includes(WINDOW_E));
  assert.ok(result.finalDraft.includes(WINDOW_C));
});

test('resume 跳过已锁死窗，从失败窗内层断点继续', async () => {
  const failed = await runWindowsHarness({
    storedContent: THREE_WINDOW_SOURCE,
    roundBudget: 1,
    diagnoseSequence: [
      planJson([]),
      '这一章写得挺好的，我觉得不用改。',
      '这一章写得挺好的，我觉得不用改。',
    ],
  });
  assert.equal(failed.result.stoppedReason, 'plan_parse_failed');
  assert.ok(failed.result.resume);

  const resumed = await runWindowsHarness({
    storedContent: THREE_WINDOW_SOURCE,
    roundBudget: 1,
    resume: failed.result.resume,
    diagnoseSequence: [planJson([]), planJson([])],
  });
  assert.equal(resumed.diagnoseInputs[0]?.currentDraft.includes(WINDOW_A), false);
  assert.ok(resumed.diagnoseInputs[0]?.currentDraft.includes(WINDOW_C));
  assert.equal(resumed.result.stoppedReason, 'converged');
  assert.equal(resumed.result.resume, undefined);
});

test('无 windowPack 的旧断点不得把整章稿塞进第一窗', async () => {
  const events: AutoLoopEngineEvent[] = [];
  const diagnoseInputs: AutoLoopDiagnoseInput[] = [];
  const result = await runChapterAutoLoopWindows({
    storedContent: TWO_WINDOW_SOURCE,
    instruction: '让打斗与情绪更有临场感',
    roundBudget: 1,
    windowing: WINDOWING,
    resume: {
      completedRounds: [],
      currentDraft: TWO_WINDOW_SOURCE,
      previousItems: [],
      startRoundIndex: 1,
    },
    deps: {
      diagnose: async (input) => {
        diagnoseInputs.push(input);
        return planJson([]);
      },
      rewriteSegment: async (input) => legalReplacement(input.originalParagraph),
      isAborted: () => false,
    },
    onEvent: (event) => events.push(event),
  });
  assert.equal(events.filter((event) => event.type === 'window_start').length, 0);
  assert.equal(diagnoseInputs.length, 1);
  assert.equal(diagnoseInputs[0]?.currentDraft, TWO_WINDOW_SOURCE);
  assert.equal(result.finalDraft, TWO_WINDOW_SOURCE);
});

test('窗收工后落下一个指向下一窗的断点，避免崩溃后重跑锁死窗', async () => {
  const { checkpoints, result } = await runWindowsHarness({
    storedContent: TWO_WINDOW_SOURCE,
    roundBudget: 1,
    diagnoses: [planJson([]), planJson([])],
  });
  const advance = checkpoints.find(
    (checkpoint) => checkpoint.windowPack?.windowIndex === 2 && !checkpoint.rewriteCheckpoint
  );
  assert.ok(advance);
  assert.equal(advance?.windowPack?.completedWindowDrafts.length, 1);
  assert.ok(advance?.windowPack?.completedWindowDrafts[0]?.includes(WINDOW_A));
  assert.equal(advance?.windowPack?.timelineRounds?.length, 1);
  assert.equal(advance?.windowPack?.timelineRounds?.[0]?.windowIndex, 1);
  assert.equal(result.stoppedReason, 'converged');
});

test('窗间 checkpoint 的空 completedRounds 不得盖掉上一窗时间线', () => {
  const rounds = composeAutoLoopTimelineRounds({
    completedRounds: [],
    currentDraft: WINDOW_C,
    previousItems: [],
    startRoundIndex: 1,
    windowPack: {
      windowIndex: 2,
      windowTotal: 2,
      completedWindowDrafts: [WINDOW_A],
      windows: [
        { text: WINDOW_A, joinAfter: '\n\n' },
        { text: WINDOW_C, joinAfter: '' },
      ],
      timelineRounds: [
        {
          roundIndex: 1,
          draft: '窗1成稿',
          items: [],
          appliedCount: 0,
          rolledBackCount: 0,
          unlocatableCount: 0,
          deferredCount: 0,
          discardedCount: 0,
          converged: true,
          rolledBack: false,
          windowIndex: 1,
          windowTotal: 2,
        },
      ],
    },
  });
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0]?.windowIndex, 1);
  assert.equal(rounds[0]?.draft, '窗1成稿');
});

test('上一窗收工后若已中断，不得再发下一窗 window_start', async () => {
  let aborted = false;
  const events: AutoLoopEngineEvent[] = [];
  const result = await runChapterAutoLoopWindows({
    storedContent: TWO_WINDOW_SOURCE,
    instruction: '让打斗与情绪更有临场感',
    roundBudget: 1,
    windowing: WINDOWING,
    deps: {
      diagnose: async () => planJson([]),
      rewriteSegment: async (input) => legalReplacement(input.originalParagraph),
      isAborted: () => aborted,
    },
    onEvent: (event) => {
      events.push(event);
      if (event.type === 'round_end' && event.windowIndex === 1) {
        aborted = true;
      }
    },
  });
  assert.equal(events.filter((event) => event.type === 'window_start').length, 1);
  assert.equal(result.stoppedReason, 'aborted');
  assert.equal(result.resume?.windowPack?.windowIndex, 2);
  assert.equal(result.resume?.windowPack?.completedWindowDrafts.length, 1);
});
