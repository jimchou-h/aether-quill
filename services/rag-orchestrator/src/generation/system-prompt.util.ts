/**
 * System 消息拼装：全局默认 + 项目 systemPromptText + 任务级 task prompt。
 * 全局默认与 `packages/prompt-templates` 的 `defaultSystemTemplate.systemPromptText` 保持一致。
 */

/** 仓库 system 层默认安全/角色约束 */
export const GLOBAL_SYSTEM_DEFAULT_TEXT =
  '你是一位专业的小说写作助手。请帮助用户进行小说创作，保持逻辑连贯和设定一致性。';

export function mergeSystemPromptSections(...sections: Array<string | undefined | null>): string {
  return sections
    .map((section) => (typeof section === 'string' ? section.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

export interface SystemMessageParts {
  systemPromptText?: string;
  taskSystemPrompt?: string;
}

/** 按治理顺序拼装 system 角色内容：全局 → 项目 → 任务 */
export function assembleSystemMessageContent(parts: SystemMessageParts): string {
  return mergeSystemPromptSections(
    GLOBAL_SYSTEM_DEFAULT_TEXT,
    parts.systemPromptText,
    parts.taskSystemPrompt
  );
}

/** `LLM_PROMPT_LEGACY_SINGLE_USER=1` 时回退旧单条 user 消息行为 */
export function isLegacySingleUserPrompt(): boolean {
  const raw = process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
  if (raw === undefined || raw.trim() === '') {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}
