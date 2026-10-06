import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatContinuitySelfCheckSummary,
  formatFromPlanClosedRunStatus,
  shouldRunFromPlanRefinePass,
} from './fromPlanClosedRun';

test('formatFromPlanClosedRunStatus names each closed-run phase', () => {
  assert.match(formatFromPlanClosedRunStatus({ phase: 'draft1' }), /按方案改写/);
  assert.match(formatFromPlanClosedRunStatus({ phase: 'review' }), /连续性自检/);
  assert.match(formatFromPlanClosedRunStatus({ phase: 'draft2' }), /自检缺口/);
  assert.match(formatFromPlanClosedRunStatus({ phase: 'mark_fix' }), /标记/);
  assert.match(formatFromPlanClosedRunStatus({ phase: 'closed' }), /自检通过/);
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
  assert.equal(formatContinuitySelfCheckSummary({ reviewed: false, hadGaps: false, autoRefined: false }), '');
  assert.match(
    formatContinuitySelfCheckSummary({ reviewed: true, hadGaps: false, autoRefined: false }),
    /通过/
  );
  assert.match(
    formatContinuitySelfCheckSummary({ reviewed: true, hadGaps: true, autoRefined: true }),
    /自动修订/
  );
});
