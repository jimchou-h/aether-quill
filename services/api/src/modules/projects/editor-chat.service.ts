/**
 * 项目内编辑对话（issue #47）：只读章节问答编排。
 *
 * 服务端决定读取材料（鉴权 → 章号锚点 → 最新正文 + 出场角色卡 → 生效主 Prompt），
 * 模型只负责回答；绝不修改章节/角色卡/Prompt。
 */

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  streamPipelineGeneration,
  type PipelineOrchestratorStreamCallbacks,
} from './chapter-generation-stream.client';
import { extractChapterNoFromQuestion } from './editor-chat-chapter.util';
import {
  EDITOR_CHAT_TASK_INSTRUCTION,
  EDITOR_CHAT_TASK_INSTRUCTION_VERSION,
  assembleEditorChatPrompt,
  type EditorChatHistoryMessage,
} from './editor-chat-prompt.util';
import type { SseStreamContext } from '../../common/sse-stream.util';

export const EDITOR_CHAT_TEMPLATE_KEY = 'editor_chat';

export class EditorChatAccessDeniedError extends ForbiddenException {
  constructor() {
    super({ code: 1003, message: '无权访问该项目', error: 'FORBIDDEN' });
  }
}

export interface EditorChatChapterInput {
  chapterNo: number;
  title: string;
  content: string;
  updatedAt: Date;
}

export interface EditorChatPersonaInput {
  id: string;
  name: string;
  profile: string;
  state: string;
  appearedChapterNos: number[];
}

/** projects.service 的读取端口（测试注入替身）。 */
export interface EditorChatProjectsPort {
  checkAccess(projectId: string, userId: string): void;
  getChapter(projectId: string, chapterNo: number): EditorChatChapterInput | null;
  getPersonas(projectId: string): EditorChatPersonaInput[];
  resolveProjectSystemPromptText(projectId: string): string;
  getRagOrchestratorUrl(): string;
}

export interface EditorChatStreamResult {
  ok: boolean;
  text: string;
  traceId: string;
  errorMessage?: string;
  completed?: boolean;
  finishReason?: string | null;
}

export interface EditorChatGenerationGateway {
  streamGeneration(input: {
    orchestratorUrl: string;
    projectId: string;
    prompt: string;
    templateKey: string;
    systemPromptOverride?: string;
    context: Record<string, unknown>;
    callbacks: PipelineOrchestratorStreamCallbacks;
    signal?: AbortSignal;
  }): Promise<EditorChatStreamResult>;
}

@Injectable()
export class OrchestratorEditorChatGateway implements EditorChatGenerationGateway {
  async streamGeneration(input: Parameters<EditorChatGenerationGateway['streamGeneration']>[0]) {
    return streamPipelineGeneration(input);
  }
}

const GUIDANCE_MESSAGE =
  '请指定章节后再继续，例如在问题里写明「第 7 章有什么优化想法」。我还不知道你在讨论哪一章。';

@Injectable()
export class EditorChatService {
  constructor(
    private readonly projects: EditorChatProjectsPort,
    private readonly gateway: EditorChatGenerationGateway
  ) {}

  /**
   * SSE 头写出后无法再改 HTTP 状态码：鉴权与缺章异常必须在建流前抛出。
   * 空问题与无锚点指导语不属于 HTTP 错误，留给 streamChat 在流内处理。
   */
  validate(input: {
    projectId: string;
    userId: string;
    question: string;
    currentChapterNo?: number;
  }): void {
    const question = (input.question ?? '').trim();
    if (!question) {
      return;
    }
    const chapterNo =
      extractChapterNoFromQuestion(question) ?? normalizeAnchor(input.currentChapterNo);
    if (chapterNo === null) {
      return;
    }
    this.projects.checkAccess(input.projectId, input.userId);
    if (!this.projects.getChapter(input.projectId, chapterNo)) {
      throw new NotFoundException({
        code: 1101,
        message: `第 ${chapterNo} 章不存在`,
        error: 'CHAPTER_NOT_FOUND',
      });
    }
  }

  async streamChat(input: {
    projectId: string;
    userId: string;
    question: string;
    history?: EditorChatHistoryMessage[];
    currentChapterNo?: number;
    sse: Pick<SseStreamContext, 'writeEvent' | 'isAborted' | 'abortSignal'>;
  }): Promise<void> {
    const question = (input.question ?? '').trim();
    if (!question) {
      throw new Error('问题不能为空');
    }
    this.validate(input);

    const chapterNo = extractChapterNoFromQuestion(question) ?? normalizeAnchor(input.currentChapterNo);

    if (chapterNo === null) {
      input.sse.writeEvent({ event: 'start', stage: EDITOR_CHAT_TEMPLATE_KEY });
      input.sse.writeEvent({ event: 'content', data: GUIDANCE_MESSAGE });
      input.sse.writeEvent({ event: 'end', traceId: '', completed: true, guidance: true });
      return;
    }

    // 流开始前完成鉴权与材料读取：缺章/越权走标准 HTTP 错误语义，不向模型发送任何材料。
    this.projects.checkAccess(input.projectId, input.userId);
    const chapter = this.projects.getChapter(input.projectId, chapterNo);
    if (!chapter) {
      throw new NotFoundException({
        code: 1101,
        message: `第 ${chapterNo} 章不存在`,
        error: 'CHAPTER_NOT_FOUND',
      });
    }

    const personaCards = this.projects
      .getPersonas(input.projectId)
      .filter((p) => p.appearedChapterNos?.includes(chapterNo))
      .map((p) => ({
        name: p.name,
        content: [p.profile, p.state].filter((s) => s && s.trim()).join('\n'),
      }));

    const systemPromptText = this.projects.resolveProjectSystemPromptText(input.projectId);

    const prompt = assembleEditorChatPrompt({
      question,
      chapterNo,
      chapterTitle: chapter.title,
      chapterContent: chapter.content,
      personaCards,
      history: input.history,
    });

    input.sse.writeEvent({
      event: 'start',
      traceId: '',
      chapterNo,
      stage: EDITOR_CHAT_TEMPLATE_KEY,
    });

    let streamTraceId = '';
    const result = await this.gateway.streamGeneration({
      orchestratorUrl: this.projects.getRagOrchestratorUrl(),
      projectId: input.projectId,
      prompt,
      templateKey: EDITOR_CHAT_TEMPLATE_KEY,
      systemPromptOverride: systemPromptText || undefined,
      context: {
        chapterNo,
        editorChatInstructionVersion: EDITOR_CHAT_TASK_INSTRUCTION_VERSION,
        editorChatTaskInstruction: EDITOR_CHAT_TASK_INSTRUCTION,
        omitNextChapterHead: true,
      },
      callbacks: {
        onStart: (traceId) => {
          streamTraceId = traceId;
        },
        onContent: (piece) => {
          input.sse.writeEvent({ event: 'content', data: piece });
        },
        onError: (message) => {
          input.sse.writeEvent({ event: 'error', data: message });
        },
      },
      signal: input.sse.abortSignal,
    });

    if (input.sse.isAborted()) {
      return;
    }

    if (result.errorMessage) {
      input.sse.writeEvent({
        event: 'end',
        traceId: result.traceId,
        chapterNo,
        completed: false,
        error: result.errorMessage,
      });
      return;
    }
    input.sse.writeEvent({
      event: 'end',
      traceId: result.traceId || streamTraceId,
      chapterNo,
      completed: result.completed === true,
      finishReason: result.finishReason ?? null,
    });
  }
}

function normalizeAnchor(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}
