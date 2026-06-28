import {
  processContentSafety,
  type ContentSafetyProcessResult,
  type ContentSafetyRule,
} from '@aether-quill/config';

export type ContentSafetyProgressStage = 'content_safety_scan' | 'content_safety_rewrite';

export interface ContentSafetyPipelineInput {
  text: string;
  traceId: string;
  taskKey: string;
  enabled: boolean;
  rules?: ContentSafetyRule[];
  rewriteSentence?: (sentence: string) => Promise<string>;
  onProgress?: (payload: { stage: ContentSafetyProgressStage; message: string }) => void;
}

export interface ContentSafetyPipelineResult extends ContentSafetyProcessResult {
  traceId: string;
  taskKey: string;
}

export function toContentSafetyScanPayload(result: ContentSafetyPipelineResult) {
  return {
    hits: result.hits,
    blocked: result.blocked,
    blockReason: result.blockReason,
    scanEnabled: result.scanEnabled,
    rewriteAttempts: result.rewriteAttempts,
    finalText: result.text,
  };
}

export { formatContentSafetyBlockMessage, summarizeContentSafetyHits } from '@aether-quill/config';

export async function runContentSafetyPipeline(
  input: ContentSafetyPipelineInput
): Promise<ContentSafetyPipelineResult> {
  input.onProgress?.({
    stage: 'content_safety_scan',
    message: '正在执行内容安全扫描…',
  });

  const processed = await processContentSafety(input.text, {
    enabled: input.enabled,
    rules: input.rules,
    rewriteSentence: input.enabled ? input.rewriteSentence : undefined,
    onRewriteAttempt: (progress) => {
      input.onProgress?.({
        stage: 'content_safety_rewrite',
        message: `正在批量重写命中句子（第 ${progress.batch} 轮，${progress.indexInBatch}/${progress.batchSize}）…`,
      });
    },
  });

  return {
    ...processed,
    traceId: input.traceId,
    taskKey: input.taskKey,
  };
}
