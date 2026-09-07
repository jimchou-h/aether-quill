export type WritingOptimizeStep = 'instruction' | 'plan' | 'draft' | 'loop';

export type WritingOptimizeRewriteMode = 'from-plan' | 'direct' | 'auto-loop';

export type WritingOptimizeStepVisual = 'pending' | 'running' | 'awaiting' | 'done' | 'failed';

export function resolveWritingOptimizeStepperSteps(
  mode: WritingOptimizeRewriteMode
): WritingOptimizeStep[] {
  if (mode === 'auto-loop') {
    // 循环里的方案不再是用户闸门，方案与正文在后端交替跑完，
    // 拆成两个步骤反而会一直停在"方案"上不动。
    return ['instruction', 'loop'];
  }
  return mode === 'direct' ? ['instruction', 'draft'] : ['instruction', 'plan', 'draft'];
}

export function resolveWritingOptimizeStepVisual(input: {
  stepKey: WritingOptimizeStep;
  currentStep: WritingOptimizeStep;
  generatingPlan: boolean;
  generatingDraft: boolean;
  hasPlan: boolean;
  hasDraft: boolean;
  hasError: boolean;
  rewriteMode?: WritingOptimizeRewriteMode;
}): WritingOptimizeStepVisual {
  const mode = input.rewriteMode ?? 'from-plan';
  const order = resolveWritingOptimizeStepperSteps(mode);
  const currentIndex = order.indexOf(input.currentStep);
  const keyIndex = order.indexOf(input.stepKey);

  if (keyIndex < currentIndex) {
    return 'done';
  }

  if (keyIndex > currentIndex) {
    return 'pending';
  }

  if (input.stepKey === 'instruction') {
    if (input.generatingPlan || (mode !== 'from-plan' && input.generatingDraft)) {
      return 'running';
    }
    if (mode !== 'from-plan') {
      return input.hasDraft ? 'done' : 'awaiting';
    }
    return input.hasPlan ? 'done' : 'awaiting';
  }

  if (input.stepKey === 'loop') {
    if (input.generatingDraft) {
      return 'running';
    }
    // 中断或报错时只要还有完成轮的成稿就保持 awaiting：
    // 那份稿子是可直接应用的，标成 failed 会诱导用户丢掉它。
    if (input.hasDraft) {
      return 'awaiting';
    }
    return input.hasError ? 'failed' : 'pending';
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
