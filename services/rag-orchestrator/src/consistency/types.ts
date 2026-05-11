export type ConsistencyLevel = 'pass' | 'warn' | 'block';

export interface ConsistencyCheckResult {
  level: ConsistencyLevel;
  category: 'character' | 'timeline' | 'world_rule';
  message: string;
  detail?: string;
  locations?: Array<{ line?: number; text: string }>;
}

export interface ConsistencyReport {
  overall: ConsistencyLevel;
  results: ConsistencyCheckResult[];
  checkedAt: string;
}

export interface CharacterProfile {
  name: string;
  aliases?: string[];
  age?: string;
  identity?: string;
  traits?: string[];
  relationships?: Array<{ target: string; relation: string }>;
  status?: 'alive' | 'deceased' | 'unknown';
}

export interface TimelineEvent {
  label: string;
  chapterNo?: number;
  position?: string;
  description: string;
}

export interface WorldRule {
  domain: string;
  rule: string;
}

export interface ConsistencyContext {
  characters?: CharacterProfile[];
  timeline?: TimelineEvent[];
  worldRules?: WorldRule[];
}
