import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatContinuitySelfCheckSummary,
  formatFromPlanClosedRunStatus,
  shouldRunFromPlanRefinePass,
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

test('shouldRunFromPlanRefinePass only continues on material gaps', () => {
  assert.equal(shouldRunFromPlanRefinePass(true), true);
  assert.equal(shouldRunFromPlanRefinePass(false), false);
});

test('formatContinuitySelfCheckSummary covers pass and auto-fix states', () => {
  assert.equal(
    formatContinuitySelfCheckSummary({ reviewed: false, hadGaps: false, autoRefined: false }),
    ''
  );
  assert.match(
    formatContinuitySelfCheckSummary({ reviewed: true, hadGaps: false, autoRefined: false }),
    /通过/
  );
  assert.match(
    formatContinuitySelfCheckSummary({ reviewed: true, hadGaps: true, autoRefined: true }),
    /自动修订/
  );
});

test('failed review is reported as unfinished rather than passed', () => {
  const summary = formatContinuitySelfCheckSummary({
    reviewed: false,
    hadGaps: false,
    autoRefined: false,
    failed: true,
  });
  assert.match(summary, /未完成/);
  assert.doesNotMatch(summary, /通过|已收口/);
});
