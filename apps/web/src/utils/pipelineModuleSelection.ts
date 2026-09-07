import type { ChapterPipelineConfig, ProjectSettings } from '../services/api';

export interface PipelineModuleSelection {
  characterAdjustment: boolean;
  characterTraits: boolean;
  sensory: boolean;
  homogenization: boolean;
}

export function buildBasePipelineEnabledModules(
  selection: Pick<PipelineModuleSelection, 'characterAdjustment' | 'characterTraits' | 'sensory'>
): number[] {
  const modules: number[] = [];
  if (selection.characterAdjustment || selection.characterTraits) {
    modules.push(1);
  }
  if (selection.sensory) {
    modules.push(2);
  }
  return modules;
}

export function isPipelineModuleSelectionValid(selection: PipelineModuleSelection): boolean {
  return (
    selection.characterAdjustment ||
    selection.characterTraits ||
    selection.sensory ||
    selection.homogenization
  );
}

export function selectionFromPipelineConfig(
  config: Partial<ChapterPipelineConfig>
): PipelineModuleSelection {
  const modules = config.pipelineEnabledModules ?? [1, 2];
  return {
    characterAdjustment: config.pipelineCharacterAdjustmentEnabled ?? false,
    characterTraits: config.pipelineCharacterTraitsEnabled ?? true,
    sensory: modules.includes(2),
    homogenization: config.pipelineHomogenizationEnabled ?? false,
  };
}

export function selectionFromProjectSettings(
  settings: Partial<ProjectSettings> & Partial<ChapterPipelineConfig>
): PipelineModuleSelection {
  return selectionFromPipelineConfig(settings);
}

export function configOverridesFromSelection(
  selection: PipelineModuleSelection
): Partial<ChapterPipelineConfig> {
  const modules = buildBasePipelineEnabledModules(selection);
  if (selection.homogenization && !modules.includes(4)) {
    modules.push(4);
  }
  return {
    pipelineCharacterAdjustmentEnabled: selection.characterAdjustment,
    pipelineCharacterTraitsEnabled: selection.characterTraits,
    pipelineHomogenizationEnabled: selection.homogenization,
    pipelineEnabledModules: modules,
  };
}
