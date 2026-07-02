import { type Ref } from 'vue';
import { useAbortableSse } from './useAbortableSse';
import { cancelAiTaskProgress, type AiTaskProgressState } from './useAiTaskProgress';
import { isSseAbortError } from '../utils/sseStream';

export function useChapterSseTask(aiTaskProgress: Ref<AiTaskProgressState>) {
  const sseControl = useAbortableSse();

  function interruptStream() {
    sseControl.abort();
    cancelAiTaskProgress(aiTaskProgress);
  }

  function beginStream() {
    return sseControl.begin();
  }

  function handleStreamError(error: unknown): boolean {
    if (isSseAbortError(error)) {
      cancelAiTaskProgress(aiTaskProgress);
      return true;
    }
    return false;
  }

  function endStream() {
    sseControl.abort();
  }

  return {
    sseControl,
    interruptStream,
    beginStream,
    handleStreamError,
    endStream,
    isStreaming: sseControl.streaming,
  };
}
