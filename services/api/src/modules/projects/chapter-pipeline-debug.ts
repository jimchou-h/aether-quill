/**
 * 分步精修 prompt 调试日志（API 侧：人物卡注入 + user prompt + LLM 原始返回）
 * 默认开启；设置 LOG_PIPELINE_PROMPT=false 或 LOG_GENERATION_PROMPT=false 可关闭。
 */

export function isPipelinePromptLoggingEnabled(): boolean {
  const raw = process.env.LOG_PIPELINE_PROMPT ?? process.env.LOG_GENERATION_PROMPT;
  if (raw === undefined || raw.trim() === '') {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off' && normalized !== 'no';
}

export function logPipelinePlainTextDebug(input: {
  module: string;
  traceId?: string;
  projectId: string;
  chapterNo: number;
  templateKey: string;
  selectedPersonaNames?: string[];
  resolvedPersonaNames: string[];
  personaBlock: string;
  userPrompt: string;
  rawResponse?: string;
}): void {
  if (!isPipelinePromptLoggingEnabled()) {
    return;
  }

  const header = [
    '',
    '='.repeat(72),
    `[api/chapter-pipeline] ${input.module}`,
    `projectId=${input.projectId}`,
    `chapterNo=${input.chapterNo}`,
    `templateKey=${input.templateKey}`,
    input.traceId ? `traceId=${input.traceId}` : null,
    `selectedPersonaNames=${input.selectedPersonaNames?.length ? input.selectedPersonaNames.join('、') : '(未指定，使用全部已发布人物)'}`,
    `resolvedPersonaNames=${input.resolvedPersonaNames.length ? input.resolvedPersonaNames.join('、') : '(空)'}`,
    `personaBlockChars=${input.personaBlock.length}`,
    '='.repeat(72),
  ]
    .filter(Boolean)
    .join('\n');

  const personaSection = input.personaBlock.trim()
    ? `【人物卡 / personaBlock】\n${input.personaBlock}`
    : '【人物卡 / personaBlock】\n(空 — 未注入任何人物卡，模型无法对照特征)';

  const body = [
    personaSection,
    '',
    '【user prompt（送入 orchestrator 的 prompt 字段）】',
    input.userPrompt,
  ].join('\n');

  const responseSection =
    input.rawResponse !== undefined
      ? `\n${'='.repeat(72)}\n【LLM 原始返回】\n${input.rawResponse}\n${'='.repeat(72)}\n`
      : `\n${'='.repeat(72)}\n`;

  console.log(`${header}\n${body}${responseSection}`);
}
