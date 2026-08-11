import type { ChapterPendingAction } from '../services/api';

export function formatChapterPendingActionsSummary(actions: ChapterPendingAction[]): string {
  return actions.map((action) => `${action.label}（约 ${action.estimatedTokens} tokens）`).join('\n');
}

export function confirmChapterAfterSaveActions(actions: ChapterPendingAction[]): boolean {
  if (actions.length === 0) {
    return false;
  }
  return confirm(
    `内容已保存。是否执行以下后处理？\n\n${formatChapterPendingActionsSummary(actions)}`
  );
}

const AFTER_SAVE_ACTION_LABELS: Record<string, string> = {
  persona: '更新人物出场与状态',
  relationEvents: '抽取关系事件',
  structuredInfo: '解析结构化信息',
  summarize: '生成章节摘要',
};

/**
 * Human-readable after-save progress copy (never raw `action (status)` alone).
 */
export function formatChapterAfterSaveProgressMessage(
  action: string,
  status: string,
  chapterNo: number
): string {
  const label = AFTER_SAVE_ACTION_LABELS[action] ?? action;
  const normalized = status.trim().toLowerCase();

  if (normalized === 'failed' || normalized === 'error') {
    return `第 ${chapterNo} 章后处理失败：${label}`;
  }
  if (normalized === 'completed' || normalized === 'done' || normalized === 'success') {
    return `第 ${chapterNo} 章已完成：${label}`;
  }
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'aborted') {
    return `第 ${chapterNo} 章后处理已中断：${label}`;
  }
  return `第 ${chapterNo} 章：正在${label}…`;
}
