import {
  hasMultiPersonaCardEvidence,
  MULTI_PERSONA_WRITING_GUARD,
  PERSONA_APPEARANCE_CONTINUITY_GUARD,
} from '../retrieval/persona-card-evidence';
import {
  assembleSystemMessageContent,
  isLegacySingleUserPrompt,
} from './system-prompt.util';

export interface GenerationContext {
  /** 项目级 systemPromptText（Settings） */
  systemPromptText: string;
  /** 任务级 system prompt（如章节优化 plan/draft override） */
  taskSystemPrompt?: string;
  /**
   * 叙事上下文：人物 + 大纲 + 近期章节摘要 + 已选关系备忘（不含向量检索证据）。
   * 与 `retrievedEvidence` 分段拼装，对应模板占位 `{{narrativeContext}}` 语义。
   */
  narrativeContext: string;
  /** 向量检索 + 重排后的证据块，对应 `{{retrievedEvidence}}` */
  retrievedEvidence?: string;
}

export interface LlmChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** system 角色：全局默认 + 项目 systemPromptText + 任务 taskSystemPrompt */
export function buildSystemMessage(context: GenerationContext): string {
  return assembleSystemMessageContent({
    systemPromptText: context.systemPromptText,
    taskSystemPrompt: context.taskSystemPrompt,
  });
}

/** user 角色：叙事上下文、检索证据、业务 prompt（不含【系统指令】） */
export function buildUserMessage(context: GenerationContext, userPrompt: string): string {
  const sections: string[] = [];

  if (context.narrativeContext?.trim()) {
    let narrative = context.narrativeContext.trim();
    if (narrative.includes('【人物当前快照】')) {
      narrative = `${PERSONA_APPEARANCE_CONTINUITY_GUARD}\n\n${narrative}`;
    }
    sections.push(`【叙事上下文】\n${narrative}`);
  }
  if (context.retrievedEvidence?.trim()) {
    let evidence = context.retrievedEvidence.trim();
    if (hasMultiPersonaCardEvidence(evidence)) {
      evidence = `${MULTI_PERSONA_WRITING_GUARD}\n\n${evidence}`;
    }
    sections.push(`【检索证据】\n${evidence}`);
  }

  sections.push(`【用户需求】\n${userPrompt}`);

  return sections.join('\n\n');
}

/**
 * 兼容旧单 user 拼装（含【系统指令】段）；亦用于审计日志拼接。
 */
export function buildLegacySingleUserPrompt(context: GenerationContext, userPrompt: string): string {
  const system = buildSystemMessage(context);
  const user = buildUserMessage(context, userPrompt);
  if (!system.trim()) {
    return user;
  }
  return `【系统指令】\n${system.trim()}\n\n${user}`;
}

export function buildLlmMessages(context: GenerationContext, userPrompt: string): LlmChatMessage[] {
  if (isLegacySingleUserPrompt()) {
    return [{ role: 'user', content: buildLegacySingleUserPrompt(context, userPrompt) }];
  }

  const systemMessage = buildSystemMessage(context);
  const userMessage = buildUserMessage(context, userPrompt);
  const messages: LlmChatMessage[] = [];

  if (systemMessage.trim()) {
    messages.push({ role: 'system', content: systemMessage.trim() });
  }
  messages.push({ role: 'user', content: userMessage });

  return messages;
}
