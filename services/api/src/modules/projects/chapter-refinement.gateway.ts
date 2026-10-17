/**
 * 章节精修生成网关（AQ-381）。
 *
 * 引擎只依赖本接口，便于用可控假实现做单测；真实实现通过 orchestrator 的
 * `/api/generate` 调用模型，并把 run 冻结的 task / project system prompt 作为 override 传入，
 * 保证运行中 Settings 改动不会污染已冻结的指导。
 *
 * 冻结语义：
 *  - `systemPromptText` 为该 templateKey 在 run 创建时冻结的已发布文本；
 *  - `projectSystemPromptText` 为冻结的项目 systemPrompt；
 *  - 只传标识与文本，不传任何密钥；密钥由 orchestrator 按当前安全配置解析。
 */

import { isUpstreamAbortError, streamPipelineGeneration } from './chapter-generation-stream.client';
import {
  resolveRefinementCompletionFailure,
  type RefinementCompletionFailureKind,
} from './chapter-refinement.util';
import type {
  RefinementFrozenReferenceMaterials,
  RefinementModelRoute,
} from './chapter-refinement.types';

export interface RefinementGenerationRequest {
  projectId: string;
  chapterNo: number;
  templateKey: string;
  /** 冻结的任务级 system prompt（覆盖运行时 Settings） */
  systemPromptText: string;
  /**
   * 冻结的项目级 system prompt。
   *
   * R12/B5（R1 修复）：工具档（inspect / plan / review）**不下发**该字段——
   * 项目长写作指导只属于写作档（rewrite / repair）。缺省即「不覆盖」，
   * orchestrator 侧同时按模板档位禁止注入当前项目设置。
   */
  projectSystemPromptText?: string;
  prompt: string;
  maxTokens?: number;
  /** 检索短 query 的补充说明（用户要求），用于结构化章节匹配加权 */
  retrievalInstruction?: string;
  /**
   * F4：run 创建时冻结的模型路由（provider / model / temperature）。
   * 经 orchestrator 透传为实际生成参数，运行中修改模型设置不影响已冻结的 run。
   */
  modelRoute?: RefinementModelRoute;
  /**
   * F4：run 创建时冻结的**实际参考材料**（人物 / 知识 / 文风样本文本与来源）。
   * orchestrator 收到后直接使用，不再从当前 projectCtx 检索或重新选样——
   * 运行中修改角色卡 / 知识文档 / 样本不影响本 run。
   */
  frozenReferenceMaterials?: RefinementFrozenReferenceMaterials;
  signal: AbortSignal;
}

export interface RefinementGenerationResult {
  ok: boolean;
  text: string;
  traceId: string;
  aborted: boolean;
  errorMessage?: string;
  /** 严格完成判定失败时的类别；非空内容但未正常收束时给出，供引擎区分降级原因 */
  completionFailure?: RefinementCompletionFailureKind;
}

export interface RefinementGenerationGateway {
  generate(request: RefinementGenerationRequest): Promise<RefinementGenerationResult>;
}

export const CHAPTER_REFINEMENT_GATEWAY = Symbol('CHAPTER_REFINEMENT_GATEWAY');

export class OrchestratorRefinementGateway implements RefinementGenerationGateway {
  constructor(private readonly resolveOrchestratorUrl: () => string) {}

  async generate(request: RefinementGenerationRequest): Promise<RefinementGenerationResult> {
    if (request.signal.aborted) {
      return { ok: false, text: '', traceId: '', aborted: true, errorMessage: 'aborted' };
    }
    try {
      const response = await streamPipelineGeneration({
        orchestratorUrl: this.resolveOrchestratorUrl(),
        projectId: request.projectId,
        prompt: request.prompt,
        templateKey: request.templateKey,
        ...(typeof request.maxTokens === 'number' ? { maxTokens: request.maxTokens } : {}),
        systemPromptOverride: request.systemPromptText,
        context: {
          chapterNo: request.chapterNo,
          ...(request.projectSystemPromptText !== undefined
            ? { projectSystemPromptOverride: request.projectSystemPromptText }
            : {}),
          ...(request.retrievalInstruction
            ? { retrievalInstruction: request.retrievalInstruction }
            : {}),
          // F4：冻结的模型路由随请求下发，orchestrator 据此解析实际生成参数，不读当前设置
          ...(request.modelRoute
            ? {
                generationRouteOverride: {
                  provider: request.modelRoute.provider,
                  model: request.modelRoute.model,
                  temperature: request.modelRoute.temperature,
                },
              }
            : {}),
          // F4：冻结的实际参考材料（人物 / 知识 / 文风样本）随请求下发；
          // orchestrator 用它们组装最终消息，不再从当前 projectCtx 检索或选样
          ...(request.frozenReferenceMaterials
            ? { frozenReferenceMaterials: request.frozenReferenceMaterials }
            : {}),
          // 精修模板 key 已由 orchestrator 的 shouldIncludePriorChapterNarrative 排除整章账本，
          // 这里只补一条用户要求做短 query，避免整章账本被塞进检索。
        },
        callbacks: {},
        signal: request.signal,
      });
      if (response.aborted) {
        return { ok: false, text: response.text, traceId: response.traceId, aborted: true };
      }
      // 严格完成判定：非空内容不等于成功（缺 end / length / 过滤 / 未知完成原因）
      const completionFailure = resolveRefinementCompletionFailure({
        completed: response.completed,
        finishReason: response.finishReason,
        text: response.text,
      });
      if (completionFailure) {
        return {
          ok: false,
          text: response.text,
          traceId: response.traceId,
          aborted: false,
          errorMessage: completionFailure.message,
          completionFailure: completionFailure.kind,
        };
      }
      return {
        ok: response.ok,
        text: response.text,
        traceId: response.traceId,
        aborted: false,
        ...(response.errorMessage ? { errorMessage: response.errorMessage } : {}),
      };
    } catch (error) {
      if (request.signal.aborted || isUpstreamAbortError(error)) {
        return { ok: false, text: '', traceId: '', aborted: true, errorMessage: 'aborted' };
      }
      return {
        ok: false,
        text: '',
        traceId: '',
        aborted: false,
        errorMessage: error instanceof Error ? error.message : '调用生成服务失败',
      };
    }
  }
}
