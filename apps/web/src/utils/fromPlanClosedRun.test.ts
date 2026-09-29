import assert from 'node:assert/strict';
import test from 'node:test';
import { formatFromPlanClosedRunStatus, shouldRunFromPlanRefinePass } from './fromPlanClosedRun';

test('formatFromPlanClosedRunStatus names each closed-run phase', () => {
  assert.match(formatFromPlanClosedRunStatus({ phase: 'draft1' }), /按方案改写/);
  assert.match(formatFromPlanClosedRunStatus({ phase: 'review' }), /冻结合同/);
  assert.match(formatFromPlanClosedRunStatus({ phase: 'draft2' }), /补写/);
  assert.match(formatFromPlanClosedRunStatus({ phase: 'closed' }), /无实质缺口/);
  assert.match(
    formatFromPlanClosedRunStatus({ phase: 'closed', hasMaterialGaps: true }),
    /补写一刀/
  );
});

test('shouldRunFromPlanRefinePass only continues on material gaps', () => {
  assert.equal(shouldRunFromPlanRefinePass(true), true);
  assert.equal(shouldRunFromPlanRefinePass(false), false);
});
