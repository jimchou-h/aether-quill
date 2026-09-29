import { shallowRef, watch } from 'vue';
import {
  loadWritingOptimizeRunPrefs,
  saveWritingOptimizeRunPrefs,
  clampWritingOptimizePassCount,
} from '../utils/writingOptimizeMultiPass';

export function useWritingOptimizeRunPrefs() {
  const initial = loadWritingOptimizeRunPrefs();
  const autoStartDraft = shallowRef(initial.autoStartDraft);
  const planPassCount = shallowRef(initial.planPassCount);
  const draftPassCount = shallowRef(initial.draftPassCount);

  watch([autoStartDraft, planPassCount, draftPassCount], () => {
    const nextPlan = clampWritingOptimizePassCount(planPassCount.value);
    const nextDraft = clampWritingOptimizePassCount(draftPassCount.value);
    if (nextPlan !== planPassCount.value) {
      planPassCount.value = nextPlan;
    }
    if (nextDraft !== draftPassCount.value) {
      draftPassCount.value = nextDraft;
    }
    saveWritingOptimizeRunPrefs({
      autoStartDraft: autoStartDraft.value,
      planPassCount: nextPlan,
      draftPassCount: nextDraft,
    });
  });

  return {
    autoStartDraft,
    planPassCount,
    draftPassCount,
  };
}
