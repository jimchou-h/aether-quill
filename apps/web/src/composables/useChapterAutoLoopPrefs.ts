import { shallowRef, watch } from 'vue';
import {
  clampAutoLoopRoundBudget,
  loadChapterAutoLoopPrefs,
  saveChapterAutoLoopPrefs,
} from '../utils/chapterAutoLoopPrefs';

export function useChapterAutoLoopPrefs() {
  const roundBudget = shallowRef(loadChapterAutoLoopPrefs().roundBudget);

  watch(roundBudget, () => {
    const next = clampAutoLoopRoundBudget(roundBudget.value);
    if (next !== roundBudget.value) {
      roundBudget.value = next;
      return;
    }
    saveChapterAutoLoopPrefs({ roundBudget: next });
  });

  return { roundBudget };
}
