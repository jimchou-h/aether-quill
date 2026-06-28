export type ContentSafetySeverity = 'low' | 'medium' | 'high';

export type ContentSafetyAction = 'mark' | 'replace' | 'rewrite_sentence' | 'block';

export type ContentSafetyRuleType = 'keyword' | 'regex';

export interface ProjectContentSafetyRule {
  id: string;
  pattern: string;
  severity: ContentSafetySeverity;
  enabled: boolean;
}

export interface ContentSafetyRule {
  ruleId: string;
  severity: ContentSafetySeverity;
  action: ContentSafetyAction;
  type: ContentSafetyRuleType;
  pattern: string;
  replacement?: string;
  /** 命中周围若包含白名单片段则跳过 */
  whitelist?: string[];
}

export interface ContentSafetyHit {
  ruleId: string;
  severity: ContentSafetySeverity;
  startOffset: number;
  endOffset: number;
  matchedText: string;
  normalizedMatchedText: string;
  action: ContentSafetyAction;
}

export interface ContentSafetyScanResult {
  hits: ContentSafetyHit[];
  hasHigh: boolean;
  hasMedium: boolean;
  hasLow: boolean;
}

export interface ContentSafetyProcessResult {
  text: string;
  hits: ContentSafetyHit[];
  blocked: boolean;
  blockReason?: string;
  rewriteAttempts: number;
  scanEnabled: boolean;
}

export interface AiTaskProgressEvent {
  traceId: string;
  taskKey: string;
  stage: string;
  message: string;
  currentStep?: number;
  totalSteps?: number;
  percent?: number;
}
