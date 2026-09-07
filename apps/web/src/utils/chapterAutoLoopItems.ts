/**
 * 自动优化循环的条目呈现（openspec: add-chapter-auto-optimize-loop）
 *
 * 循环的每一条降级都必须在界面上可见：局部编辑让「改错段」的风险接近零，
 * 换来的新风险是「悄悄什么都没改」。因此定位失败、超上限、闸门回滚
 * 三类结局都有各自文案，而不是统一折叠成一句"部分失败"。
 */

import type {
  ChapterAutoLoopItem,
  ChapterAutoLoopItemStatus,
  ChapterAutoLoopRound,
  ChapterAutoLoopSession,
  ChapterAutoLoopStoppedReason,
} from '../services/api';

export type AutoLoopItemTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface AutoLoopItemStatusView {
  label: string;
  tone: AutoLoopItemTone;
  /** 是否已是终态；非终态条目面板要继续显示为进行中 */
  terminal: boolean;
}

const ITEM_STATUS_VIEWS: Record<ChapterAutoLoopItemStatus, AutoLoopItemStatusView> = {
  pending: { label: '待处理', tone: 'neutral', terminal: false },
  applied: { label: '已改写', tone: 'success', terminal: true },
  relocated: { label: '按引文改写', tone: 'warning', terminal: true },
  skipped_unlocatable: { label: '未能定位·已跳过', tone: 'warning', terminal: true },
  deferred: { label: '超出本轮上限·留待下轮', tone: 'neutral', terminal: true },
  rolled_back: { label: '未通过校验·已还原', tone: 'danger', terminal: true },
  failed: { label: '改写失败', tone: 'danger', terminal: true },
};

export function describeAutoLoopItemStatus(
  status: ChapterAutoLoopItemStatus
): AutoLoopItemStatusView {
  return ITEM_STATUS_VIEWS[status] ?? ITEM_STATUS_VIEWS.pending;
}

export function summarizeAutoLoopRound(round: ChapterAutoLoopRound): string {
  if (round.rolledBack) {
    const reason = round.rollbackReason?.trim();
    return reason ? `整轮回滚：${reason}，已退回上一稿` : '整轮回滚，已退回上一稿';
  }

  const parts: string[] = [];
  if (round.appliedCount > 0) {
    parts.push(`已改写 ${round.appliedCount} 段`);
  }
  if (round.rolledBackCount > 0) {
    parts.push(`${round.rolledBackCount} 段未通过校验已还原`);
  }
  if (round.unlocatableCount > 0) {
    parts.push(`${round.unlocatableCount} 条未能定位已跳过`);
  }
  if (round.deferredCount > 0) {
    parts.push(`${round.deferredCount} 条留待下轮`);
  }
  if (round.discardedCount > 0) {
    parts.push(`${round.discardedCount} 条格式不合法已丢弃`);
  }
  if (round.converged) {
    parts.push('未发现严重问题，可以收工');
  }
  return parts.length > 0 ? parts.join('，') : '本轮没有产生改动';
}

/** 状态回填。匹配不到的条目追加而非丢弃，否则一条状态会凭空消失。 */
export function mergeAutoLoopItemStatus(
  items: ChapterAutoLoopItem[],
  incoming: ChapterAutoLoopItem
): ChapterAutoLoopItem[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index < 0) {
    return [...items, incoming];
  }
  const next = [...items];
  next[index] = incoming;
  return next;
}

/**
 * 「停在当前轮并收下」取的是**最近一个未回滚的完成轮**。
 *
 * 没有任何完成轮时返回空串而不是入库原文：把原文当成果应用下去，
 * 等于用一次乐观锁写入换一个零改动，只会让用户以为优化生效了。
 */
export function resolveAutoLoopAcceptableDraft(input: {
  rounds: ChapterAutoLoopRound[];
  storedContent: string;
}): string {
  for (let index = input.rounds.length - 1; index >= 0; index -= 1) {
    const round = input.rounds[index];
    if (round.rolledBack) {
      continue;
    }
    const draft = round.draft?.trim();
    if (draft) {
      return round.draft;
    }
  }
  return '';
}

export interface AutoLoopSessionView {
  restored: boolean;
  instruction: string;
  roundBudget: number;
  baseUpdatedAt: string;
  storedContent: string;
  rounds: ChapterAutoLoopRound[];
  finalDraft: string;
  stoppedReason: ChapterAutoLoopStoppedReason | null;
  errorMessage: string;
}

const EMPTY_SESSION_VIEW: AutoLoopSessionView = {
  restored: false,
  instruction: '',
  roundBudget: 0,
  baseUpdatedAt: '',
  storedContent: '',
  rounds: [],
  finalDraft: '',
  stoppedReason: null,
  errorMessage: '',
};

/** 会话缺失（未跑过 / TTL 过期 / API 重启）静默退回全新开始，不弹错。 */
export function restoreAutoLoopSessionView(
  session: ChapterAutoLoopSession | null | undefined
): AutoLoopSessionView {
  if (!session) {
    return { ...EMPTY_SESSION_VIEW, rounds: [] };
  }
  const rounds = Array.isArray(session.rounds) ? session.rounds : [];
  const finalDraft =
    session.finalDraft?.trim() ||
    resolveAutoLoopAcceptableDraft({ rounds, storedContent: session.storedContent ?? '' });
  return {
    restored: true,
    instruction: session.instruction ?? '',
    roundBudget: session.roundBudget ?? 0,
    baseUpdatedAt: session.baseUpdatedAt ?? '',
    storedContent: session.storedContent ?? '',
    rounds,
    finalDraft,
    stoppedReason: session.stoppedReason ?? null,
    errorMessage: session.errorMessage ?? '',
  };
}

const STOPPED_REASON_TEXT: Record<ChapterAutoLoopStoppedReason, string> = {
  converged: '已收敛：最后一轮未发现严重问题，提前结束',
  budget: '已达轮数上限，按设定停止',
  aborted: '已按你的操作停止，保留最近完成轮的成稿',
  round_rolled_back: '最后一轮越过整章闸门已回滚，循环终止',
  plan_parse_failed: '复诊输出无法解析，循环终止',
};

export function describeAutoLoopStoppedReason(reason: ChapterAutoLoopStoppedReason): string {
  return STOPPED_REASON_TEXT[reason] ?? '循环已结束';
}
