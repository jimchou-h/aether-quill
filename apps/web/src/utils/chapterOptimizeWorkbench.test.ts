import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildWorkbenchDraftModeFields,
  canConfirmWorkbenchPlan,
  canGenerateWorkbenchDraft,
  describeInvalidWorkbenchRange,
  describeSceneRangeOverflow,
  describeWorkbenchRangeBinding,
  filterWorkbenchReviewItems,
  filterWorkbenchReviewItemsForProfile,
  isNearCopyWorkbenchDraft,
  locateUniqueAnchor,
  normalizeWorkbenchReviewItems,
  applyWorkbenchSseEndText,
  resolveWorkbenchApplyOffsets,
  resolveWorkbenchCreationSteps,
  resolveWorkbenchDraftProfile,
  resolveWorkbenchSseEndText,
  sliceSpanNeighborhood,
  spliceChapterRange,
  WORKBENCH_SCENE_MAX_RANGE_CHARS,
  type WorkbenchReviewItem,
} from './chapterOptimizeWorkbench';

describe('spliceChapterRange', () => {
  it('replaces the UTF-16 range and keeps the outside bytes', () => {
    const base = '客厅过场。浴室一段。走廊收束。';
    const start = base.indexOf('浴室');
    const end = base.indexOf('走廊');
    const preview = spliceChapterRange(base, start, end, '浴室加料后。');
    assert.equal(preview, '客厅过场。浴室加料后。走廊收束。');
    assert.equal(preview.slice(0, start), base.slice(0, start));
    assert.equal(preview.slice(start + '浴室加料后。'.length), base.slice(end));
  });

  it('uses JavaScript UTF-16 offsets so surrogate pairs stay aligned', () => {
    const base = '前😀后';
    assert.equal(base.length, 4);
    assert.equal(spliceChapterRange(base, 1, 3, '中'), '前中后');
  });
});

describe('locateUniqueAnchor', () => {
  it('returns the unique span', () => {
    const haystack = '钥匙掉在地毯上，水声更响。';
    const quote = '钥匙掉在地毯上';
    assert.deepEqual(locateUniqueAnchor(haystack, quote), { start: 0, end: quote.length });
  });

  it('returns null when the quote is missing', () => {
    assert.equal(locateUniqueAnchor('走廊里只剩脚步。', '钥匙掉在地毯上'), null);
  });

  it('returns null when the quote matches twice', () => {
    const quote = '她低声说好。';
    const haystack = `${quote}过场。${quote}`;
    assert.equal(locateUniqueAnchor(haystack, quote), null);
  });
});

function item(overrides: Partial<WorkbenchReviewItem> = {}): WorkbenchReviewItem {
  return {
    id: 'w1',
    kind: 'pose',
    severity: 'high',
    anchorQuote: '她抬起左腿',
    issue: '动作与空间对不上',
    instruction: '改成背靠墙、左腿仍跨在门槛上',
    ...overrides,
  };
}

describe('filterWorkbenchReviewItems', () => {
  it('keeps legal kinds and drops illegal kinds', () => {
    const kept = filterWorkbenchReviewItems([
      item({ id: 'ok' }),
      item({ id: 'bad', kind: 'tension' }),
    ]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.id, 'ok');
  });

  it('drops additive instructions matching thicken patterns', () => {
    const kept = filterWorkbenchReviewItems([
      item({ id: 'deepen', instruction: '再加深这段感官' }),
      item({ id: 'detail', instruction: '写细她的反应' }),
      item({ id: 'kiss', instruction: '补接吻再继续' }),
      item({ id: 'thicken', instruction: '这段再更色一点' }),
      item({ id: 'richer', instruction: '这段再更浓一点' }),
      item({ id: 'ok', kind: 'regression', instruction: '恢复被删的拍打接触' }),
    ]);
    assert.deepEqual(
      kept.map((entry) => entry.id),
      ['ok']
    );
  });
});

describe('filterWorkbenchReviewItemsForProfile', () => {
  it('hides pose and vocab on the prose profile', () => {
    const kept = filterWorkbenchReviewItemsForProfile(
      [
        item({ id: 'pose', kind: 'pose' }),
        item({ id: 'vocab', kind: 'vocab', instruction: '把这个词换成更贴切的说法' }),
        item({ id: 'reg', kind: 'regression', instruction: '恢复被删的拍打接触' }),
      ],
      'prose'
    );
    assert.deepEqual(
      kept.map((entry) => entry.id),
      ['reg']
    );
  });

  it('keeps pose on the sex profile', () => {
    const kept = filterWorkbenchReviewItemsForProfile([item({ id: 'pose', kind: 'pose' })], 'sex');
    assert.equal(kept[0]?.id, 'pose');
  });
});

describe('describeInvalidWorkbenchRange', () => {
  it('rejects empty, inverted, and blank ranges', () => {
    const source = '客厅过场。浴室一段。';
    assert.equal(describeInvalidWorkbenchRange(0, 0, source), '起止为空或起止颠倒，请重新划选');
    assert.equal(describeInvalidWorkbenchRange(4, 2, source), '起止为空或起止颠倒，请重新划选');
    assert.equal(
      describeInvalidWorkbenchRange(0, source.length + 1, source),
      '划选范围超出冻结正文'
    );
    assert.equal(describeInvalidWorkbenchRange(2, 3, '  \n  '), '划选范围为空白，请重新划选');
  });

  it('accepts a non-empty continuous range', () => {
    const source = '客厅过场。浴室一段。';
    assert.equal(describeInvalidWorkbenchRange(0, 5, source), null);
  });
});

describe('sliceSpanNeighborhood', () => {
  it('keeps ~400 chars of read-only context around the span', () => {
    const text = `${'前'.repeat(500)}选区原文${'后'.repeat(500)}`;
    const start = 500;
    const end = start + '选区原文'.length;
    const sliced = sliceSpanNeighborhood(text, start, end, 400);
    assert.equal(sliced.spanText, '选区原文');
    assert.equal(sliced.beforeContext.length, 400);
    assert.equal(sliced.afterContext.length, 400);
  });
});

describe('normalizeWorkbenchReviewItems', () => {
  it('fills missing ids and ignores non-arrays', () => {
    assert.deepEqual(normalizeWorkbenchReviewItems(null), []);
    const items = normalizeWorkbenchReviewItems([
      { kind: 'pose', anchorQuote: '她抬起左腿', issue: '穿帮', instruction: '改成背靠墙' },
    ]);
    assert.equal(items[0]?.id, 'w1');
    assert.equal(items[0]?.kind, 'pose');
  });
});

describe('resolveWorkbenchSseEndText', () => {
  it('prefers finalDraftText then draftText then spanText', () => {
    assert.equal(
      resolveWorkbenchSseEndText({ finalDraftText: '成稿', draftText: '忽略', spanText: '忽略' }),
      '成稿'
    );
    assert.equal(resolveWorkbenchSseEndText({ draftText: '范围稿' }), '范围稿');
    assert.equal(resolveWorkbenchSseEndText({ spanText: '选区稿' }), '选区稿');
    assert.equal(resolveWorkbenchSseEndText({}), '');
  });
});

describe('resolveWorkbenchApplyOffsets', () => {
  it('keeps the committed generate range while a draft exists', () => {
    assert.deepEqual(
      resolveWorkbenchApplyOffsets({
        draftText: '成稿',
        committedStart: 10,
        committedEnd: 80,
        selectedStart: 0,
        selectedEnd: 4,
      }),
      { start: 10, end: 80 }
    );
  });

  it('falls back to the current selection before a draft exists', () => {
    assert.deepEqual(
      resolveWorkbenchApplyOffsets({
        draftText: '',
        committedStart: 10,
        committedEnd: 80,
        selectedStart: 2,
        selectedEnd: 9,
      }),
      { start: 2, end: 9 }
    );
  });
});

describe('isNearCopyWorkbenchDraft', () => {
  it('flags a verbatim copy and a same-length paste with intact mid windows', () => {
    const original = `${'甲段原文。'.repeat(40)}${'乙段原文。'.repeat(40)}${'丙段原文。'.repeat(40)}`;
    assert.equal(isNearCopyWorkbenchDraft(original, original), true);
    assert.equal(isNearCopyWorkbenchDraft(original, `${original}尾补一句。`), true);
    assert.equal(
      isNearCopyWorkbenchDraft(
        original,
        original.replace(/甲段原文/g, '甲段重写').replace(/乙段原文/g, '乙段重写')
      ),
      false
    );
  });
});

describe('describeWorkbenchRangeBinding', () => {
  it('says the current selection only affects the next generate when it drifts', () => {
    const text = describeWorkbenchRangeBinding({
      hasSelectedRange: true,
      selectedStart: 0,
      selectedEnd: 4,
      selectedChars: 4,
      hasDraft: true,
      committedStart: 10,
      committedEnd: 80,
      committedChars: 70,
    });
    assert.match(text, /成稿仍按 10–80/);
    assert.match(text, /当前划选 0–4/);
  });
});

describe('applyWorkbenchSseEndText', () => {
  it('keeps the streamed text when end repeats the same draft', () => {
    assert.equal(applyWorkbenchSseEndText('范围内成稿', '范围内成稿'), '范围内成稿');
    assert.equal(applyWorkbenchSseEndText('范围内成稿', ''), '范围内成稿');
  });

  it('uses end text when the server sent a different final draft', () => {
    assert.equal(applyWorkbenchSseEndText('流式半截', '完整成稿'), '完整成稿');
  });
});

describe('resolveWorkbenchCreationSteps', () => {
  it('keeps four steps without a plan step for the two direct tiers', () => {
    for (const mode of ['sex', 'prose'] as const) {
      const keys = resolveWorkbenchCreationSteps(mode).map((entry) => entry.key);
      assert.deepEqual(keys, ['range', 'generate', 'review', 'apply']);
      assert.equal(keys.includes('plan'), false);
    }
  });

  it('inserts a plan step right after range for scene rewrite', () => {
    assert.deepEqual(
      resolveWorkbenchCreationSteps('scene').map((entry) => entry.key),
      ['range', 'plan', 'generate', 'review', 'apply']
    );
  });
});

describe('resolveWorkbenchDraftProfile', () => {
  it('maps the scene mode onto the prose tier for the draft endpoint', () => {
    assert.equal(resolveWorkbenchDraftProfile('scene'), 'prose');
    assert.equal(resolveWorkbenchDraftProfile('sex'), 'sex');
    assert.equal(resolveWorkbenchDraftProfile('prose'), 'prose');
  });
});

describe('describeSceneRangeOverflow', () => {
  it('stays silent at or under one window and warns above it', () => {
    assert.equal(describeSceneRangeOverflow(WORKBENCH_SCENE_MAX_RANGE_CHARS), null);
    const hint = describeSceneRangeOverflow(WORKBENCH_SCENE_MAX_RANGE_CHARS + 1);
    assert.match(String(hint), /5200/);
    assert.match(String(hint), /划小/);
  });
});

describe('canConfirmWorkbenchPlan', () => {
  it('requires a non-blank plan', () => {
    assert.equal(canConfirmWorkbenchPlan(''), false);
    assert.equal(canConfirmWorkbenchPlan('   \n'), false);
    assert.equal(canConfirmWorkbenchPlan('第一拍删除，第二拍扩写。'), true);
  });
});

describe('canGenerateWorkbenchDraft', () => {
  const base = {
    hasRange: true,
    rangeChars: 800,
    instruction: '把这一场改写得更紧凑',
    busy: false,
  };

  it('keeps the direct behaviour: instruction + range + not busy', () => {
    assert.equal(canGenerateWorkbenchDraft({ ...base, mode: 'prose', planConfirmed: false }), true);
    assert.equal(canGenerateWorkbenchDraft({ ...base, mode: 'prose', instruction: '  ' }), false);
  });

  it('blocks scene rewrite until the plan is confirmed', () => {
    assert.equal(
      canGenerateWorkbenchDraft({ ...base, mode: 'scene', planConfirmed: false }),
      false
    );
    assert.equal(canGenerateWorkbenchDraft({ ...base, mode: 'scene', planConfirmed: true }), true);
  });

  it('blocks scene rewrite when the range exceeds one window', () => {
    assert.equal(
      canGenerateWorkbenchDraft({
        ...base,
        mode: 'scene',
        rangeChars: WORKBENCH_SCENE_MAX_RANGE_CHARS + 1,
        planConfirmed: true,
      }),
      false
    );
  });
});

describe('buildWorkbenchDraftModeFields', () => {
  it('sends nothing extra for the direct tiers so the legacy body is unchanged', () => {
    assert.deepEqual(buildWorkbenchDraftModeFields('prose', '忽略'), {});
    assert.deepEqual(buildWorkbenchDraftModeFields('sex', ''), {});
  });

  it('sends mode=from-plan plus the confirmed plan text for scene rewrite', () => {
    assert.deepEqual(buildWorkbenchDraftModeFields('scene', '已确认方案'), {
      mode: 'from-plan',
      planText: '已确认方案',
    });
  });
});
