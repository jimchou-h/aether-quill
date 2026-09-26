import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  ChapterAutoLoopItem,
  ChapterAutoLoopRound,
  ChapterAutoLoopSession,
} from '../services/api';
import {
  describeAutoLoopItemStatus,
  describeAutoLoopResumeAction,
  describeAutoLoopStoppedReason,
  mergeAutoLoopItemStatus,
  resolveAutoLoopAcceptableDraft,
  restoreAutoLoopSessionView,
  summarizeAutoLoopRound,
  autoLoopRoundKey,
  upsertAutoLoopTimelineRound,
  formatAutoLoopTimelineLabel,
  resolveAutoLoopSelectedRoundKey,
  resolveAutoLoopTimelineItems,
  resolveAutoLoopTimelineLatestKey,
  shouldShowAutoLoopParagraphMismatchHint,
  AUTO_LOOP_PARAGRAPH_MISMATCH_HINT,
} from './chapterAutoLoopItems';

function makeItem(overrides: Partial<ChapterAutoLoopItem> = {}): ChapterAutoLoopItem {
  return {
    id: 'i1',
    paragraphIndex: 3,
    anchorQuote: '他握紧了刀柄',
    severity: 'high',
    issue: '动作描写空泛',
    instruction: '把握刀的动作写实',
    status: 'pending',
    ...overrides,
  };
}

function makeRound(overrides: Partial<ChapterAutoLoopRound> = {}): ChapterAutoLoopRound {
  return {
    roundIndex: 1,
    draft: '第一轮成稿',
    items: [makeItem()],
    appliedCount: 1,
    rolledBackCount: 0,
    unlocatableCount: 0,
    deferredCount: 0,
    discardedCount: 0,
    converged: false,
    rolledBack: false,
    ...overrides,
  };
}

describe('describeAutoLoopItemStatus', () => {
  it('renders a downgraded item as a visible skip rather than hiding it', () => {
    const view = describeAutoLoopItemStatus('skipped_unlocatable');
    assert.equal(view.label, '未能定位·已跳过');
    assert.equal(view.tone, 'warning');
    assert.equal(view.terminal, true);
  });

  it('distinguishes a rescued relocation from an exact hit', () => {
    assert.equal(describeAutoLoopItemStatus('applied').label, '已改写');
    assert.equal(describeAutoLoopItemStatus('relocated').label, '按引文改写');
    assert.equal(describeAutoLoopItemStatus('relocated').tone, 'warning');
    assert.equal(describeAutoLoopItemStatus('deleted').label, '已删除');
    assert.equal(describeAutoLoopItemStatus('deleted').tone, 'success');
  });

  it('surfaces the segment-level rollback separately from a failure', () => {
    assert.equal(describeAutoLoopItemStatus('rolled_back').label, '未通过校验·已还原');
    assert.equal(describeAutoLoopItemStatus('rolled_back').tone, 'danger');
    assert.equal(describeAutoLoopItemStatus('failed').label, '改写失败');
  });

  it('marks pending and deferred as non-terminal so the panel keeps them live', () => {
    assert.equal(describeAutoLoopItemStatus('pending').terminal, false);
    assert.equal(describeAutoLoopItemStatus('deferred').label, '超出本轮上限·留待下轮');
    assert.equal(describeAutoLoopItemStatus('deferred').terminal, true);
  });
});

describe('summarizeAutoLoopRound', () => {
  it('spells out the skipped count so silent drops are impossible', () => {
    const summary = summarizeAutoLoopRound(
      makeRound({ appliedCount: 2, unlocatableCount: 3, deferredCount: 1 })
    );
    assert.ok(summary.includes('已改写 2 段'));
    assert.ok(summary.includes('3 条未能定位已跳过'));
    assert.ok(summary.includes('1 条留待下轮'));
  });

  it('uses chapter-level wording when the whole round was rolled back', () => {
    const summary = summarizeAutoLoopRound(
      makeRound({ rolledBack: true, rollbackReason: '整章字数超出上限' })
    );
    assert.ok(summary.includes('整轮回滚'));
    assert.ok(summary.includes('整章字数超出上限'));
  });

  it('uses segment-level wording when only some segments were restored', () => {
    const summary = summarizeAutoLoopRound(makeRound({ appliedCount: 1, rolledBackCount: 2 }));
    assert.ok(summary.includes('2 段未通过校验已还原'));
    assert.ok(!summary.includes('整轮回滚'));
  });

  it('reports convergence when a round found nothing severe', () => {
    const summary = summarizeAutoLoopRound(
      makeRound({ items: [], appliedCount: 0, converged: true })
    );
    assert.ok(summary.includes('未发现明显未落实或改坏'));
  });

  it('flags a discard-bearing round as an incomplete diagnosis, never as clean', () => {
    const summary = summarizeAutoLoopRound(
      makeRound({ items: [], appliedCount: 0, converged: false, discardedCount: 11 })
    );
    assert.ok(summary.includes('11 条格式不合法已丢弃'));
    assert.ok(summary.includes('本轮诊断不完整'));
    assert.ok(!summary.includes('可以收工'), '读不懂的诊断不能显示为可以收工');
  });
});

describe('mergeAutoLoopItemStatus', () => {
  it('replaces the matching item in place and leaves the rest untouched', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })];
    const merged = mergeAutoLoopItemStatus(items, makeItem({ id: 'b', status: 'applied' }));
    assert.deepEqual(
      merged.map((item) => [item.id, item.status]),
      [
        ['a', 'pending'],
        ['b', 'applied'],
        ['c', 'pending'],
      ]
    );
  });

  it('appends an unknown item instead of dropping a status it cannot match', () => {
    const merged = mergeAutoLoopItemStatus([makeItem({ id: 'a' })], makeItem({ id: 'z' }));
    assert.deepEqual(
      merged.map((item) => item.id),
      ['a', 'z']
    );
  });
});

describe('resolveAutoLoopAcceptableDraft', () => {
  it('hands back the latest completed round, not the stored chapter', () => {
    const draft = resolveAutoLoopAcceptableDraft({
      rounds: [
        makeRound({ roundIndex: 1, draft: '一轮稿' }),
        makeRound({ roundIndex: 2, draft: '二轮稿' }),
      ],
      storedContent: '入库原文',
    });
    assert.equal(draft, '二轮稿');
  });

  it('skips a rolled-back round so a rejected draft is never offered', () => {
    const draft = resolveAutoLoopAcceptableDraft({
      rounds: [
        makeRound({ roundIndex: 1, draft: '一轮稿' }),
        makeRound({ roundIndex: 2, draft: '一轮稿', rolledBack: true, rollbackReason: '越界' }),
      ],
      storedContent: '入库原文',
    });
    assert.equal(draft, '一轮稿');
  });

  it('returns empty when no round finished, so the caller cannot apply the original as an "optimization"', () => {
    assert.equal(resolveAutoLoopAcceptableDraft({ rounds: [], storedContent: '入库原文' }), '');
  });
});

describe('restoreAutoLoopSessionView', () => {
  it('treats a missing session as a clean first run instead of an error', () => {
    const view = restoreAutoLoopSessionView(null);
    assert.equal(view.restored, false);
    assert.deepEqual(view.rounds, []);
    assert.equal(view.finalDraft, '');
    assert.equal(view.baseUpdatedAt, '');
  });

  it('rehydrates rounds and the optimistic-lock baseline from a live session', () => {
    const session: ChapterAutoLoopSession = {
      projectId: 'p1',
      chapterNo: 7,
      instruction: '收紧战斗节奏',
      roundBudget: 2,
      baseUpdatedAt: '2026-09-08T00:00:00.000Z',
      storedContent: '入库原文',
      rounds: [makeRound({ roundIndex: 1, draft: '一轮稿' })],
      finalDraft: '一轮稿',
      stoppedReason: 'converged',
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:10:00.000Z',
    };
    const view = restoreAutoLoopSessionView(session);
    assert.equal(view.restored, true);
    assert.equal(view.instruction, '收紧战斗节奏');
    assert.equal(view.roundBudget, 2);
    assert.equal(view.baseUpdatedAt, '2026-09-08T00:00:00.000Z');
    assert.equal(view.finalDraft, '一轮稿');
    assert.equal(view.rounds.length, 1);
  });

  it('recovers the draft from the last good round when finalDraft is missing', () => {
    const view = restoreAutoLoopSessionView({
      projectId: 'p1',
      chapterNo: 7,
      instruction: '收紧战斗节奏',
      roundBudget: 3,
      baseUpdatedAt: '2026-09-08T00:00:00.000Z',
      storedContent: '入库原文',
      rounds: [makeRound({ roundIndex: 1, draft: '一轮稿' })],
      finalDraft: '',
      stoppedReason: 'aborted',
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:10:00.000Z',
    });
    assert.equal(view.finalDraft, '一轮稿');
  });

  it('surfaces a resumable rewrite checkpoint so the dialog can continue mid-round', () => {
    const view = restoreAutoLoopSessionView({
      projectId: 'p1',
      chapterNo: 7,
      instruction: '收紧战斗节奏',
      roundBudget: 3,
      baseUpdatedAt: '2026-09-08T00:00:00.000Z',
      storedContent: '入库原文',
      rounds: [makeRound({ roundIndex: 1, draft: '一轮稿' })],
      finalDraft: '一轮稿',
      stoppedReason: 'aborted',
      resumable: true,
      resumeStage: 'rewrite',
      resumeRoundIndex: 2,
      resumeSegmentIndex: 9,
      resumeSegmentTotal: 10,
      inProgressItems: [makeItem({ id: 'pending-9', status: 'pending' })],
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:10:00.000Z',
    });
    assert.equal(view.resumable, true);
    assert.equal(view.resumeStage, 'rewrite');
    assert.equal(view.resumeSegmentIndex, 9);
    assert.equal(view.inProgressItems[0]?.id, 'pending-9');
  });

  it('restores prompt-lab snapshots so the lab can reopen after a refresh', () => {
    const view = restoreAutoLoopSessionView({
      projectId: 'p1',
      chapterNo: 7,
      instruction: '收紧战斗节奏',
      roundBudget: 2,
      baseUpdatedAt: '2026-09-08T00:00:00.000Z',
      storedContent: '入库原文',
      rounds: [makeRound({ roundIndex: 1, draft: '一轮稿' })],
      finalDraft: '一轮稿',
      stoppedReason: 'converged',
      promptLabCalls: [
        {
          id: 'lab-1',
          kind: 'diagnose',
          templateKey: 'chapter.optimize.loop.plan',
          roundIndex: 1,
          windowIndex: 1,
          userPrompt: '冻住的 user',
          taskPromptText: '任务 Prompt',
          output: '诊断输出',
          frozenRetrievedEvidence: '证据',
          createdAt: '2026-09-11T00:00:00.000Z',
        },
      ],
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:10:00.000Z',
    });
    assert.equal(view.promptLabCalls[0]?.id, 'lab-1');
  });
});

describe('describeAutoLoopStoppedReason', () => {
  it('explains an early exit as convergence rather than a truncated run', () => {
    assert.ok(describeAutoLoopStoppedReason('converged').includes('未发现明显未落实或改坏'));
  });

  it('names the hard round ceiling explicitly', () => {
    assert.ok(describeAutoLoopStoppedReason('budget').includes('轮数上限'));
  });

  it('has copy for every reason the backend can emit', () => {
    for (const reason of [
      'converged',
      'budget',
      'aborted',
      'round_rolled_back',
      'plan_parse_failed',
    ] as const) {
      assert.ok(describeAutoLoopStoppedReason(reason).length > 0, reason);
    }
  });

  it('tells the author they can continue after a parse failure', () => {
    assert.ok(describeAutoLoopStoppedReason('plan_parse_failed').includes('从失败处继续'));
  });
});

describe('describeAutoLoopResumeAction', () => {
  it('names the remaining rewrite segment', () => {
    assert.equal(
      describeAutoLoopResumeAction({
        resumeStage: 'rewrite',
        resumeRoundIndex: 5,
        resumeSegmentIndex: 9,
        resumeSegmentTotal: 10,
      }),
      '从第 5 轮第 9/10 段继续'
    );
  });

  it('names a diagnose retry when rewrite has not started', () => {
    assert.equal(
      describeAutoLoopResumeAction({
        resumeStage: 'diagnose',
        resumeRoundIndex: 2,
      }),
      '从第 2 轮复诊继续'
    );
  });

  it('names the window when the chapter was split', () => {
    assert.equal(
      describeAutoLoopResumeAction({
        resumeStage: 'diagnose',
        resumeRoundIndex: 1,
        resumeWindowIndex: 2,
        resumeWindowTotal: 4,
      }),
      '第 2/4 窗，从第 1 轮复诊继续'
    );
  });

  it('omits the window prefix when there is only one window', () => {
    assert.equal(
      describeAutoLoopResumeAction({
        resumeStage: 'diagnose',
        resumeRoundIndex: 2,
        resumeWindowIndex: 1,
        resumeWindowTotal: 1,
      }),
      '从第 2 轮复诊继续'
    );
  });
});

describe('auto-loop history timeline', () => {
  it('does not collapse the same roundIndex across windows', () => {
    const first = makeRound({ roundIndex: 1, windowIndex: 1, windowTotal: 2, draft: '窗1' });
    const second = makeRound({ roundIndex: 1, windowIndex: 2, windowTotal: 2, draft: '窗2' });
    const merged = upsertAutoLoopTimelineRound(upsertAutoLoopTimelineRound([], first), second);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.draft, '窗1');
    assert.equal(merged[1]?.draft, '窗2');
    assert.equal(autoLoopRoundKey(first), '1:1');
    assert.equal(autoLoopRoundKey(second), '2:1');
  });

  it('labels window and round on one line when split', () => {
    assert.equal(
      formatAutoLoopTimelineLabel({ roundIndex: 2, windowIndex: 1, windowTotal: 3 }),
      '第 1/3 窗 · 第 2 轮'
    );
    assert.equal(formatAutoLoopTimelineLabel({ roundIndex: 2 }), '第 2 轮');
  });

  it('keeps a locked historical selection while a later round ends', () => {
    const rounds = [
      makeRound({ roundIndex: 1, windowIndex: 1, windowTotal: 2, items: [makeItem({ id: 'a' })] }),
      makeRound({ roundIndex: 1, windowIndex: 2, windowTotal: 2, items: [makeItem({ id: 'b' })] }),
    ];
    const selectedKey = resolveAutoLoopSelectedRoundKey({
      lockedKey: autoLoopRoundKey(rounds[0]!),
      rounds,
      running: true,
      liveWindowIndex: 2,
      liveRoundIndex: 1,
    });
    assert.equal(selectedKey, '1:1');
    const latestKey = resolveAutoLoopTimelineLatestKey({
      rounds,
      running: true,
      liveWindowIndex: 2,
      liveRoundIndex: 1,
    });
    const items = resolveAutoLoopTimelineItems({
      selectedKey,
      latestKey,
      rounds,
      liveItems: [makeItem({ id: 'live' })],
      running: true,
    });
    assert.equal(items[0]?.id, 'a');
    assert.equal(
      shouldShowAutoLoopParagraphMismatchHint({ selectedKey, latestKey }),
      true
    );
    assert.ok(AUTO_LOOP_PARAGRAPH_MISMATCH_HINT.includes('段号'));
  });

  it('back-to-current (unlocked) follows live items on the latest round', () => {
    const rounds = [
      makeRound({ roundIndex: 1, windowIndex: 1, windowTotal: 2 }),
      makeRound({ roundIndex: 1, windowIndex: 2, windowTotal: 2 }),
    ];
    const selectedKey = resolveAutoLoopSelectedRoundKey({
      lockedKey: null,
      rounds,
      running: true,
      liveWindowIndex: 2,
      liveRoundIndex: 1,
    });
    const latestKey = resolveAutoLoopTimelineLatestKey({
      rounds,
      running: true,
      liveWindowIndex: 2,
      liveRoundIndex: 1,
    });
    assert.equal(selectedKey, latestKey);
    const items = resolveAutoLoopTimelineItems({
      selectedKey,
      latestKey,
      rounds,
      liveItems: [makeItem({ id: 'live' })],
      running: true,
    });
    assert.equal(items[0]?.id, 'live');
    assert.equal(shouldShowAutoLoopParagraphMismatchHint({ selectedKey, latestKey }), false);
  });
});
