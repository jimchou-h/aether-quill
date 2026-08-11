import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveWritingOptimizeStepVisual } from './writingOptimizeStepVisual';

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
