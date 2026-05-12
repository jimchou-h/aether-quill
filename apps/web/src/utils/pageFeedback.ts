import { useNotifier } from '../composables/useNotifier';

function notifier() {
  return useNotifier();
}

export function presentError(message: string): string {
  const trimmed = message.trim();
  if (trimmed) {
    notifier().notifyError(trimmed);
  }
  return trimmed;
}

export function presentSuccess(message: string): string {
  const trimmed = message.trim();
  if (trimmed) {
    notifier().notifySuccess(trimmed);
  }
  return trimmed;
}

export function presentInfo(message: string): string {
  const trimmed = message.trim();
  if (trimmed) {
    notifier().notifyInfo(trimmed);
  }
  return trimmed;
}

export function presentErrorFromCaught(error: unknown, fallback: string): string {
  const message = error instanceof Error && error.message.trim() ? error.message : fallback;
  return presentError(message);
}
