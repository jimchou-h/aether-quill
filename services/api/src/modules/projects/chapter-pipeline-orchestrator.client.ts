/**
 * 章节生成上游 SSE/JSON 客户端（文笔优化 / 自动循环等共用）。
 * 由原 pipeline orchestrator client 中性化而来，避免产品栈删除打断保留路径。
 */

export {
  isUpstreamAbortError,
  streamPipelineGeneration,
  generatePipelinePlainText,
  type PipelineOrchestratorStreamCallbacks,
} from './chapter-generation-stream.client';
