import type { InjectionKey, Ref } from 'vue';
import { inject } from 'vue';
import {
  createAiTaskProgressState,
  type AiTaskProgressState,
} from './useAiTaskProgress';

export const CHAPTER_AI_ACTIVITY_KEY: InjectionKey<Ref<AiTaskProgressState>> =
  Symbol('chapterAiActivity');

export const CHAPTER_AI_ACTIVITY_INTERRUPT_KEY: InjectionKey<Ref<(() => void) | null>> =
  Symbol('chapterAiActivityInterrupt');

/** Prefer page-provided activity SSOT; fall back to a local state for standalone use. */
export function useChapterPageAiActivity(): Ref<AiTaskProgressState> {
  const injected = inject(CHAPTER_AI_ACTIVITY_KEY, null);
  if (injected) {
    return injected;
  }
  return createAiTaskProgressState();
}

export function useChapterAiActivityInterrupt(): Ref<(() => void) | null> | null {
  return inject(CHAPTER_AI_ACTIVITY_INTERRUPT_KEY, null);
}
