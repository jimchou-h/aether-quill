import { ref, type Ref } from 'vue';
import type { components } from '@aether-quill/shared-types';

export type AiTaskProgressEvent = components['schemas']['AiTaskProgressEvent'];

export interface AiTaskProgressState {
  traceId: string | null;
  taskKey: string | null;
  stage: string | null;
  message: string | null;
  currentStep: number | null;
  totalSteps: number | null;
  active: boolean;
  cancelled: boolean;
  error: string | null;
}

export function createAiTaskProgressState(): Ref<AiTaskProgressState> {
  return ref({
    traceId: null,
    taskKey: null,
    stage: null,
    message: null,
    currentStep: null,
    totalSteps: null,
    active: false,
    cancelled: false,
    error: null,
  });
}

export function startAiTaskProgress(
  state: Ref<AiTaskProgressState>,
  payload: { traceId?: string; taskKey: string; message: string }
) {
  state.value = {
    traceId: payload.traceId ?? null,
    taskKey: payload.taskKey,
    stage: 'start',
    message: payload.message,
    currentStep: null,
    totalSteps: null,
    active: true,
    cancelled: false,
    error: null,
  };
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
    active: false,
    cancelled: false,
    error: null,
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
    active: false,
    cancelled: false,
    error,
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
  };
}

export function resetAiTaskProgress(state: Ref<AiTaskProgressState>) {
  state.value = {
    traceId: null,
    taskKey: null,
    stage: null,
    message: null,
    currentStep: null,
    totalSteps: null,
    active: false,
    cancelled: false,
    error: null,
  };
}

const TASK_PROGRESS_MESSAGES: Record<string, string> = {
  'write.chapter.outline': '正在生成章节大纲…',
  'write.chapter.draft': '正在生成章节正文…',
  'chapter.optimize.plan': '正在生成优化方案…',
  'chapter.optimize.draft': '正在生成优化正文…',
  'chapter.optimize.typo-fix': '正在自动修正错字…',
  'chapter.pipeline.run': '创作精修执行中…',
  'chapter.pipeline.run-all': '全自动精修执行中…',
  'chapter.pipeline.final-polish': '一键终稿执行中…',
  'chapter.compliance.outline': '合规大纲生成中…',
  'chapter.compliance.rewrite': '合规改写中…',
  'chapter.summarize': '正在生成章节摘要…',
  'chapter.relation-events': '正在抽取关系事件…',
  'chapter.structured-parse': '正在解析结构化信息…',
  'import.relation-events': '正在处理导入后的关系事件…',
};

export function resolveAiTaskProgressMessage(taskKey: string, fallback?: string): string {
  return TASK_PROGRESS_MESSAGES[taskKey] || fallback || '正在处理…';
}
