import { ref } from 'vue';
import { message } from 'ant-design-vue';

export type ToastVariant = 'error' | 'success' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

/** 兼容旧 Toast 列表读取；实际展示由 Ant Design message 承担 */
const toasts = ref<ToastItem[]>([]);

function pushMessage(
  content: string,
  variant: ToastVariant,
  durationSeconds: number
): void {
  const trimmed = content.trim();
  if (!trimmed) {
    return;
  }

  const duration = durationSeconds;
  if (variant === 'error') {
    void message.error(trimmed, duration);
    return;
  }
  if (variant === 'success') {
    void message.success(trimmed, duration);
    return;
  }
  void message.info(trimmed, duration);
}

export function useNotifier() {
  return {
    toasts,
    dismiss: (_id: number) => undefined,
    notifyError: (msg: string, durationMs = 5000) =>
      pushMessage(msg, 'error', durationMs / 1000),
    notifySuccess: (msg: string, durationMs = 4000) =>
      pushMessage(msg, 'success', durationMs / 1000),
    notifyInfo: (msg: string, durationMs = 4000) =>
      pushMessage(msg, 'info', durationMs / 1000),
  };
}
