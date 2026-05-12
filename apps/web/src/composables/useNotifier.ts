import { ref } from 'vue';

export type ToastVariant = 'error' | 'success' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const toasts = ref<ToastItem[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

function dismiss(id: number) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }

  toasts.value = toasts.value.filter((item) => item.id !== id);
}

function pushToast(message: string, variant: ToastVariant, durationMs: number) {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }

  const id = nextId++;
  toasts.value.push({ id, message: trimmed, variant });

  const timer = setTimeout(() => dismiss(id), durationMs);
  timers.set(id, timer);
}

export function useNotifier() {
  return {
    toasts,
    dismiss,
    notifyError: (message: string, durationMs = 5000) => pushToast(message, 'error', durationMs),
    notifySuccess: (message: string, durationMs = 4000) =>
      pushToast(message, 'success', durationMs),
    notifyInfo: (message: string, durationMs = 4000) => pushToast(message, 'info', durationMs),
  };
}
