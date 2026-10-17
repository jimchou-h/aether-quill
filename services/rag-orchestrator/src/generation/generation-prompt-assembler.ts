import {
  hasMultiPersonaCardEvidence,
  MULTI_PERSONA_WRITING_GUARD,
  PERSONA_APPEARANCE_CONTINUITY_GUARD,
} from '../retrieval/persona-card-evidence';
import { assembleSystemMessageContent, isLegacySingleUserPrompt } from './system-prompt.util';

export interface GenerationContext {
  /** 项目级 systemPromptText（Settings） */
  systemPromptText: string;
  /** true 时不拼接项目 systemPromptText（合规检验等任务） */
  omitProjectSystemPrompt?: boolean;
  /** 任务级 system prompt（如章节优化 plan/draft override） */
  taskSystemPrompt?: string;
  /**
   * 叙事上下文：人物 + 大纲 + 近期章节摘要 + 已选关系备忘（不含向量检索证据）。
   * 与 `retrievedEvidence` 分段拼装，对应模板占位 `{{narrativeContext}}` 语义。
   */
  narrativeContext: string;
  /** 向量检索 + 重排后的证据块，对应 `{{retrievedEvidence}}` */
  retrievedEvidence?: string;
  /** 文风样本参照块（【文风参照】），插入于检索证据与用户需求之间 */
  styleSampleBlock?: string;
  /**
   * F4：精修 run 冻结的参考材料（新模板专用合同）。
   *
   * 有值时，`buildUserMessage` 直接用冻结文本组装【参考上下文】/【检索证据】/【文风参照】，
   * 完全忽略 `narrativeContext` / `retrievedEvidence` / `styleSampleBlock`（后者来自当前 projectCtx）。
   * 这样即使运行中修改人物卡 / 知识文档 / 文风样本，精修 run 的最终消息也保持冻结。
   */
  frozenReferenceMaterials?: {
    personaText: string;
    knowledgeText: string;
    styleSampleBlock: string;
  };
}

export interface LlmChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** system 角色：全局默认 + 项目 systemPromptText + 任务 taskSystemPrompt */
export function buildSystemMessage(context: GenerationContext): string {
  return assembleSystemMessageContent({
    systemPromptText: context.omitProjectSystemPrompt ? undefined : context.systemPromptText,
    taskSystemPrompt: context.taskSystemPrompt,
  });
}

/** user 角色：参考上下文、检索证据、业务 prompt（不含【系统指令】） */
export function buildUserMessage(context: GenerationContext, userPrompt: string): string {
  const sections: string[] = [];

  // F4：精修 run 冻结参考材料优先——有值时完全替代当前 projectCtx 的叙事 / 检索 / 文风块
  const frozen = context.frozenReferenceMaterials;
  const narrativeSource = frozen ? frozen.personaText : context.narrativeContext;
  const evidenceSource = frozen ? frozen.knowledgeText : context.retrievedEvidence;
  const styleSource = frozen ? frozen.styleSampleBlock : context.styleSampleBlock;

  if (narrativeSource?.trim()) {
    let narrative = narrativeSource.trim();
    if (narrative.includes('【人物当前快照】')) {
      narrative = `${PERSONA_APPEARANCE_CONTINUITY_GUARD}\n\n${narrative}`;
    }
    sections.push(`【参考上下文】\n${narrative}`);
  }
  if (evidenceSource?.trim()) {
    let evidence = evidenceSource.trim();
    if (hasMultiPersonaCardEvidence(evidence)) {
      evidence = `${MULTI_PERSONA_WRITING_GUARD}\n\n${evidence}`;
    }
    sections.push(`【检索证据】\n${evidence}`);
  }
  if (styleSource?.trim()) {
    sections.push(styleSource.trim());
  }

  sections.push(`【任务输入】\n${userPrompt}`);

  return sections.join('\n\n');
}

/**
 * 兼容旧单 user 拼装（含【系统指令】段）；亦用于审计日志拼接。
 */
export function buildLegacySingleUserPrompt(
  context: GenerationContext,
  userPrompt: string
): string {
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
