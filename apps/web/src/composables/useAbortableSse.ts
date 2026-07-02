import { ref, type Ref } from 'vue';

export function useAbortableSse(): {
  streaming: Ref<boolean>;
  begin: () => AbortSignal;
  abort: () => void;
  currentSignal: () => AbortSignal | undefined;
} {
  let controller: AbortController | null = null;
  const streaming = ref(false);

  function abort() {
    if (controller) {
      controller.abort();
      controller = null;
    }
    streaming.value = false;
  }

  function begin() {
    abort();
    controller = new AbortController();
    streaming.value = true;
    return controller.signal;
  }

  function currentSignal() {
    return controller?.signal;
  }

  return { streaming, begin, abort, currentSignal };
}
