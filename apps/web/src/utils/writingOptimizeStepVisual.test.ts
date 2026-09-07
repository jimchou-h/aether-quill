import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveWritingOptimizeStepperSteps,
  resolveWritingOptimizeStepVisual,
} from './writingOptimizeStepVisual';

describe('resolveWritingOptimizeStepVisual', () => {
  it('marks plan as running while generating plan', () => {
    assert.equal(
      resolveWritingOptimizeStepVisual({
        stepKey: 'plan',
        currentStep: 'plan',
        generatingPlan: true,
        generatingDraft: false,
        hasPlan: false,
        hasDraft: false,
        hasError: false,
      }),
      'running'
    );
  });

  it('marks plan as awaiting when plan exists and idle', () => {
    assert.equal(
      resolveWritingOptimizeStepVisual({
        stepKey: 'plan',
        currentStep: 'plan',
        generatingPlan: false,
        generatingDraft: false,
        hasPlan: true,
        hasDraft: false,
        hasError: false,
      }),
      'awaiting'
    );
  });

  it('uses two stepper steps in direct rewrite mode', () => {
    assert.deepEqual(resolveWritingOptimizeStepperSteps('direct'), ['instruction', 'draft']);
    assert.deepEqual(resolveWritingOptimizeStepperSteps('from-plan'), [
      'instruction',
      'plan',
      'draft',
    ]);
  });

  it('marks instruction as running while generating draft in direct mode', () => {
    assert.equal(
      resolveWritingOptimizeStepVisual({
        stepKey: 'instruction',
        currentStep: 'instruction',
        generatingPlan: false,
        generatingDraft: true,
        hasPlan: false,
        hasDraft: false,
        hasError: false,
        rewriteMode: 'direct',
      }),
      'running'
    );
  });

  it('collapses auto-loop into instruction + loop, since planning is no longer a user gate', () => {
    assert.deepEqual(resolveWritingOptimizeStepperSteps('auto-loop'), ['instruction', 'loop']);
  });

  it('runs the loop step while the backend stream is live', () => {
    assert.equal(
      resolveWritingOptimizeStepVisual({
        stepKey: 'loop',
        currentStep: 'loop',
        generatingPlan: false,
        generatingDraft: true,
        hasPlan: false,
        hasDraft: false,
        hasError: false,
        rewriteMode: 'auto-loop',
      }),
      'running'
    );
  });

  it('awaits on the loop step once a round produced an applyable draft', () => {
    assert.equal(
      resolveWritingOptimizeStepVisual({
        stepKey: 'loop',
        currentStep: 'loop',
        generatingPlan: false,
        generatingDraft: false,
        hasPlan: false,
        hasDraft: true,
        hasError: false,
        rewriteMode: 'auto-loop',
      }),
      'awaiting'
    );
  });

  it('keeps a partial draft as awaiting even when the loop errored, so aborted rounds stay applyable', () => {
    assert.equal(
      resolveWritingOptimizeStepVisual({
        stepKey: 'loop',
        currentStep: 'loop',
        generatingPlan: false,
        generatingDraft: false,
        hasPlan: false,
        hasDraft: true,
        hasError: true,
        rewriteMode: 'auto-loop',
      }),
      'awaiting'
    );
    assert.equal(
      resolveWritingOptimizeStepVisual({
        stepKey: 'loop',
        currentStep: 'loop',
        generatingPlan: false,
        generatingDraft: false,
        hasPlan: false,
        hasDraft: false,
        hasError: true,
        rewriteMode: 'auto-loop',
      }),
      'failed'
    );
  });

  it('marks instruction as done once the auto-loop moved on', () => {
    assert.equal(
      resolveWritingOptimizeStepVisual({
        stepKey: 'instruction',
        currentStep: 'loop',
        generatingPlan: false,
        generatingDraft: true,
        hasPlan: false,
        hasDraft: false,
        hasError: false,
        rewriteMode: 'auto-loop',
      }),
      'done'
    );
  });

  it('marks draft as running while streaming and awaiting after draft ready', () => {
    assert.equal(
      resolveWritingOptimizeStepVisual({
        stepKey: 'draft',
        currentStep: 'draft',
        generatingPlan: false,
        generatingDraft: true,
        hasPlan: true,
        hasDraft: false,
        hasError: false,
      }),
      'running'
    );
    assert.equal(
      resolveWritingOptimizeStepVisual({
        stepKey: 'draft',
        currentStep: 'draft',
        generatingPlan: false,
        generatingDraft: false,
        hasPlan: true,
        hasDraft: true,
        hasError: false,
      }),
      'awaiting'
    );
  });
});
