import assert from 'node:assert/strict';
import test from 'node:test';
import { runChapterAutoLoop } from './chapter-auto-loop.engine';
import type {
  AutoLoopDiagnoseInput,
  AutoLoopEngineEvent,
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
  diagnoses: string[];
  rewrite?: (input: AutoLoopRewriteInput) => Promise<string> | string;
  abortAfterRewrites?: number;
}

async function runHarness(options: HarnessOptions) {
  const events: AutoLoopEngineEvent[] = [];
  const diagnoseInputs: AutoLoopDiagnoseInput[] = [];
  const rewriteInputs: AutoLoopRewriteInput[] = [];
  let rewriteCount = 0;
  let aborted = false;

  const result = await runChapterAutoLoop({
    storedContent: options.storedContent ?? STORED,
    instruction: options.instruction ?? '让打斗与情绪更有临场感',
    roundBudget: options.roundBudget ?? 2,
    deps: {
      diagnose: async (input) => {
        diagnoseInputs.push(input);
        return options.diagnoses[input.roundIndex - 1] ?? planJson([]);
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
  });

  return { result, events, diagnoseInputs, rewriteInputs };
}

function eventNames(events: AutoLoopEngineEvent[]): string[] {
  return events.map((event) => event.type);
}

// ---------------------------------------------------------------------------
// 单轮最小闭环（切片一）
// ---------------------------------------------------------------------------

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

test('复诊输出无法解析时终止并保留上一稿', async () => {
  const { result } = await runHarness({
    roundBudget: 2,
    diagnoses: ['这一章写得挺好的，我觉得不用改。'],
  });
  assert.equal(result.finalDraft, STORED);
  assert.equal(result.stoppedReason, 'plan_parse_failed');
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

test('章级字数越界时整轮回滚并终止循环', async () => {
  const { result } = await runHarness({
    roundBudget: 3,
    diagnoses: [
      planJson([
        { index: 1, quote: '雨下了一整夜', severity: 'high' },
        { index: 2, quote: '他握紧了拳头', severity: 'high' },
        { index: 3, quote: '院子里的老槐树', severity: 'high' },
      ]),
    ],
    // 每段都膨胀到接近段级上限 250%，累积后突破章级上限 150%
    rewrite: (input) => replacementOfRatio(input.originalParagraph, 2.4),
  });

  assert.equal(result.finalDraft, STORED, '整轮回滚应退回上一稿');
  assert.equal(result.rounds[0].rolledBack, true);
  assert.equal(result.stoppedReason, 'round_rolled_back');
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

test('无 high 条目时提前收敛，不再发起下一轮', async () => {
  const { result, diagnoseInputs } = await runHarness({
    roundBudget: 3,
    diagnoses: [
      planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'medium' }]),
      planJson([{ index: 4, quote: '她在灯下坐了很久', severity: 'high' }]),
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

test('首轮就被中断时退回入库原文', async () => {
  const { result } = await runHarness({
    roundBudget: 2,
    diagnoses: [planJson([{ index: 2, quote: '他握紧了拳头，转身离开', severity: 'high' }])],
    abortAfterRewrites: 1,
  });

  assert.equal(result.stoppedReason, 'aborted');
  assert.equal(result.rounds.length, 0);
  assert.equal(result.finalDraft, STORED);
});
