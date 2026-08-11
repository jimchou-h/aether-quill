import type { ChapterOptimizeStage } from '../services/api';

export const CHAPTER_OPTIMIZE_PREP_TOTAL_STEPS = 4;

const PREP_STEP: Partial<Record<ChapterOptimizeStage, number>> = {
  syncing_context: 1,
  retrieving: 2,
  waiting_llm: 3,
  segment_diagnosis: 3,
  plan_synthesis: 3,
  draft_segment: 3,
  merge_validation: 4,
  content_safety_scan: 4,
  content_safety_rewrite: 4,
};

export function resolveChapterOptimizePrepProgress(stage: ChapterOptimizeStage): {
  currentStep: number;
  totalSteps: number;
  percent: number;
} {
  const currentStep = PREP_STEP[stage] ?? 2;
  const totalSteps = CHAPTER_OPTIMIZE_PREP_TOTAL_STEPS;
  const percent = Math.min(95, Math.round((currentStep / totalSteps) * 100));
  return { currentStep, totalSteps, percent };
}
