import { ref, type Ref } from 'vue';
import type { components } from '@aether-quill/shared-types';

export type AiTaskProgressEvent = components['schemas']['AiTaskProgressEvent'];

export type AiActivitySource = 'page' | 'after-save' | `dialog:${string}`;

export type AiActivityStage =
  | 'idle'
  | 'queued'
  | 'running'
  | 'awaiting-user'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | string;

export interface AiTaskProgressState {
  traceId: string | null;
  taskKey: string | null;
  stage: AiActivityStage | null;
  message: string | null;
  currentStep: number | null;
  totalSteps: number | null;
  percent: number | null;
  active: boolean;
  cancelled: boolean;
  error: string | null;
  source: AiActivitySource | null;
  chapterNo: number | null;
  interruptible: boolean;
}

export type TryStartAiTaskResult =
  | { ok: true }
  | { ok: false; reason: 'busy'; current: AiTaskProgressState };

export interface StartAiTaskPayload {
  traceId?: string;
  taskKey: string;
  message: string;
  source?: AiActivitySource;
  chapterNo?: number | null;
  interruptible?: boolean;
  force?: boolean;
}

export function emptyAiTaskProgressState(): AiTaskProgressState {
  return {
    traceId: null,
    taskKey: null,
    stage: null,
    message: null,
    currentStep: null,
    totalSteps: null,
    percent: null,
    active: false,
    cancelled: false,
    error: null,
    source: null,
    chapterNo: null,
    interruptible: false,
  };
}

export function createAiTaskProgressState(): Ref<AiTaskProgressState> {
  return ref(emptyAiTaskProgressState());
}

export function tryStartAiTaskProgress(
  state: Ref<AiTaskProgressState>,
  payload: StartAiTaskPayload
): TryStartAiTaskResult {
  if (state.value.active && !payload.force) {
    return { ok: false, reason: 'busy', current: { ...state.value } };
  }

  state.value = {
    traceId: payload.traceId ?? null,
    taskKey: payload.taskKey,
    stage: 'running',
    message: payload.message,
    currentStep: null,
    totalSteps: null,
    percent: null,
    active: true,
    cancelled: false,
    error: null,
    source: payload.source ?? 'page',
    chapterNo: payload.chapterNo ?? null,
    interruptible: payload.interruptible === true,
  };
  return { ok: true };
}

/** Legacy helper — does not force-overwrite; prefer tryStartAiTaskProgress. */
export function startAiTaskProgress(
  state: Ref<AiTaskProgressState>,
  payload: { traceId?: string; taskKey: string; message: string } & Partial<StartAiTaskPayload>
): TryStartAiTaskResult {
  return tryStartAiTaskProgress(state, { ...payload, force: payload.force === true });
}

export function applyAiTaskProgressEvent(
  state: Ref<AiTaskProgressState>,
  event: Partial<AiTaskProgressEvent>
) {
  state.value = {
    ...state.value,
    traceId: event.traceId ?? state.value.traceId,
    taskKey: event.taskKey ?? state.value.taskKey,
    stage: event.stage ?? state.value.stage,
    message: event.message ?? state.value.message,
    currentStep:
      typeof event.currentStep === 'number' ? event.currentStep : state.value.currentStep,
    totalSteps:
      typeof event.totalSteps === 'number' ? event.totalSteps : state.value.totalSteps,
    percent: typeof event.percent === 'number' ? event.percent : state.value.percent,
    active: true,
    cancelled: false,
    error: null,
  };
}

export function completeAiTaskProgress(
  state: Ref<AiTaskProgressState>,
  message = '已完成'
) {
  state.value = {
    ...state.value,
    message,
    stage: 'completed',
    active: false,
    cancelled: false,
    error: null,
    interruptible: false,
  };
}

export function failAiTaskProgress(
  state: Ref<AiTaskProgressState>,
  error: string,
  traceId?: string
) {
  state.value = {
    ...state.value,
    traceId: traceId ?? state.value.traceId,
    stage: 'failed',
    active: false,
    cancelled: false,
    error,
    interruptible: false,
  };
}

export function cancelAiTaskProgress(state: Ref<AiTaskProgressState>, message = '已中断') {
  state.value = {
    ...state.value,
    stage: 'cancelled',
    message,
    active: false,
    cancelled: true,
    error: null,
    interruptible: false,
  };
}

export function resetAiTaskProgress(state: Ref<AiTaskProgressState>) {
  state.value = emptyAiTaskProgressState();
}

const TASK_PROGRESS_MESSAGES: Record<string, string> = {
  'write.chapter.outline': '正在生成章节大纲…',
  'write.chapter.draft': '正在生成章节正文…',
  'chapter.optimize.plan': '正在生成优化方案…',
  'chapter.optimize.draft': '正在生成优化正文…',
  'chapter.optimize.typo-fix': '正在自动修正错字…',
  'chapter.pipeline.run': '创作精修执行中…',
  'chapter.pipeline.run-all': '全自动精修执行中…',
  'chapter.pipeline.sensory-rewrite.revise': '感官正文按意见修订中…',
  'chapter.pipeline.character.revise': '角色正文按意见修订中…',
  'chapter.pipeline.coverage.verify': '对照大纲验收落实中…',
  'chapter.pipeline.rewrite.fix-items': '按清单补修正文中…',
  'chapter.pipeline.final-polish': '一键终稿执行中…',
  'chapter.compliance.outline': '合规大纲生成中…',
  'chapter.compliance.rewrite': '合规改写中…',
  'chapter.compliance.coverage.verify': '合规大纲落实验收中…',
  'chapter.compliance.rewrite.fix-items': '合规按项补修中…',
  'chapter.summarize': '正在生成章节摘要…',
  'chapter.relation-events': '正在抽取关系事件…',
  'chapter.structured-parse': '正在解析结构化信息…',
  'import.relation-events': '正在处理导入后的关系事件…',
};

export function resolveAiTaskProgressMessage(taskKey: string, fallback?: string): string {
  return TASK_PROGRESS_MESSAGES[taskKey] || fallback || '正在处理…';
}

export function formatAiActivityBusyMessage(current: AiTaskProgressState): string {
  const chapter =
    typeof current.chapterNo === 'number' ? `第 ${current.chapterNo} 章` : '当前';
  const detail = current.message?.trim() || '有任务进行中';
  return `${chapter} AI 任务进行中：${detail}。请先等待完成或中断后再试。`;
}
