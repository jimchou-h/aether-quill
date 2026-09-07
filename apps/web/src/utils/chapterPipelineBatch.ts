import type { ChapterPipelineConfig } from '../services/api';

/** 批量创作精修默认跳过全部大纲 gate，跑完后统一审阅再应用 */
export const BATCH_PIPELINE_AUTO_CONFIG_OVERRIDES: Partial<ChapterPipelineConfig> = {
  pipelineSkipCharacterOutlineReview: true,
  pipelineSkipCharacterTraitsOutlineReview: true,
  pipelineSkipSensoryOutlineReview: true,
};
