import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canRefineFromPlanReview,
  formatContinuitySelfCheckSummary,
  formatFromPlanClosedRunStatus,
} from './fromPlanClosedRun';

test('formatFromPlanClosedRunStatus names each closed-run phase', () => {
  assert.match(formatFromPlanClosedRunStatus({ phase: 'draft1' }), /按方案改写/);
  assert.match(formatFromPlanClosedRunStatus({ phase: 'review' }), /方案验收/);
  assert.match(formatFromPlanClosedRunStatus({ phase: 'draft2' }), /自检缺口/);
  assert.match(formatFromPlanClosedRunStatus({ phase: 'mark_fix' }), /标记/);
  assert.match(formatFromPlanClosedRunStatus({ phase: 'closed' }), /验收通过/);
  assert.match(
    formatFromPlanClosedRunStatus({ phase: 'closed', hasMaterialGaps: true }),
    /修订一刀/
  );
});

test('second pass requires an unchanged reviewed draft and plan', () => {
  const reviewed = {
    reviewGaps: '【验收结论】GAPS\n缺少人物反应',
    reviewedDraft: '首稿',
    reviewedPlan: '方案',
    currentDraft: '首稿',
    currentPlan: '方案',
  };
  assert.equal(canRefineFromPlanReview(reviewed), true);
  assert.equal(canRefineFromPlanReview({ ...reviewed, currentDraft: '作者修改的首稿' }), false);
  assert.equal(canRefineFromPlanReview({ ...reviewed, currentPlan: '作者修改的方案' }), false);
  assert.equal(canRefineFromPlanReview({ ...reviewed, reviewGaps: '' }), false);
});

test('formatContinuitySelfCheckSummary offers a choice instead of claiming auto-fix', () => {
  assert.equal(
    formatContinuitySelfCheckSummary({ reviewed: false, hadGaps: false, refined: false }),
    ''
  );
  assert.match(
    formatContinuitySelfCheckSummary({ reviewed: true, hadGaps: false, refined: false }),
    /通过/
  );
  const gaps = formatContinuitySelfCheckSummary({ reviewed: true, hadGaps: true, refined: false });
  assert.match(gaps, /可选择/);
  assert.doesNotMatch(gaps, /自动修订|已收口/);
  assert.match(
    formatContinuitySelfCheckSummary({ reviewed: true, hadGaps: true, refined: true }),
    /已按验收缺口/
  );
});

test('failed review is reported as unfinished rather than passed', () => {
  const summary = formatContinuitySelfCheckSummary({
    reviewed: false,
    hadGaps: false,
    refined: false,
    failed: true,
  });
  assert.match(summary, /未完成/);
  assert.doesNotMatch(summary, /通过|已收口/);
});
