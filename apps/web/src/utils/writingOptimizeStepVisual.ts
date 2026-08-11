export type WritingOptimizeStep = 'instruction' | 'plan' | 'draft';

export type WritingOptimizeStepVisual = 'pending' | 'running' | 'awaiting' | 'done' | 'failed';

export function resolveWritingOptimizeStepVisual(input: {
  stepKey: WritingOptimizeStep;
  currentStep: WritingOptimizeStep;
  generatingPlan: boolean;
  generatingDraft: boolean;
  hasPlan: boolean;
  hasDraft: boolean;
  hasError: boolean;
}): WritingOptimizeStepVisual {
  const order: WritingOptimizeStep[] = ['instruction', 'plan', 'draft'];
  const currentIndex = order.indexOf(input.currentStep);
  const keyIndex = order.indexOf(input.stepKey);

  if (keyIndex < currentIndex) {
    return 'done';
  }

  if (keyIndex > currentIndex) {
    return 'pending';
  }

  if (input.stepKey === 'instruction') {
    if (input.generatingPlan) {
      return 'running';
    }
    return input.hasPlan ? 'done' : 'awaiting';
  }

  if (input.stepKey === 'plan') {
    if (input.generatingPlan) {
      return 'running';
    }
    if (input.hasError && !input.hasPlan) {
      return 'failed';
    }
    return input.hasPlan ? 'awaiting' : 'pending';
  }

  // draft
  if (input.generatingDraft) {
    return 'running';
  }
  if (input.hasError && !input.hasDraft) {
    return 'failed';
  }
  return input.hasDraft ? 'awaiting' : 'pending';
}
