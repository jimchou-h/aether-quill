import type { ContentSafetyRule } from './types';

/**
 * 默认硬线规则（首期由代码维护）。
 * 演示标记用于单测与联调；生产可追加真实词库规则。
 */
export const DEFAULT_CONTENT_SAFETY_RULES: ContentSafetyRule[] = [
  {
    ruleId: 'demo-high-block',
    severity: 'high',
    action: 'block',
    type: 'keyword',
    pattern: '【硬线违禁演示】',
  },
  {
    ruleId: 'demo-medium-rewrite',
    severity: 'medium',
    action: 'rewrite_sentence',
    type: 'keyword',
    pattern: '【中风险演示】',
  },
  {
    ruleId: 'demo-low-mark',
    severity: 'low',
    action: 'mark',
    type: 'keyword',
    pattern: '【低风险演示】',
  },
  {
    ruleId: 'demo-low-replace',
    severity: 'low',
    action: 'replace',
    type: 'keyword',
    pattern: '【可替换演示】',
    replacement: '[已处理]',
  },
];
