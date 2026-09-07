import type { IndexStatus } from './documents.entity';

/** 内容变更后的索引状态：已索引过 → stale；否则回 pending 等待自动索引 */
export function nextIndexStatusAfterContentChange(current: IndexStatus): 'pending' | 'stale' {
  return current === 'completed' || current === 'stale' ? 'stale' : 'pending';
}
