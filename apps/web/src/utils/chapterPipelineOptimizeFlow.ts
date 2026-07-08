import type {
  ChapterPipelineConfig,
  ChapterPipelineRunModule,
  ChapterPipelineSessionView,
  ChapterPipelineVersionKey,
  ChapterPipelineOutlineType,
} from '../services/api';

export type PipelineDialogStep =
  | 'ready'
  | 'character-outline'
  | 'character'
  | 'character-traits-outline'
  | 'character-traits'
  | 'sensory-outline'
  | 'sensory-rewrite'
  | 'rules'
  | 'homogenization'
  | 'done';

type OutlineGateStep = 'character-outline' | 'character-traits-outline' | 'sensory-outline';

interface PipelineBootstrapAction {
  step: PipelineDialogStep;
  module: ChapterPipelineRunModule | null;
  autoRun: boolean;
}

type MinimalPipelineSession = Pick<
  ChapterPipelineSessionView,
  | 'versions'
  | 'characterOutline'
  | 'characterTraitsOutline'
  | 'sensoryOutline'
  | 'ruleIssues'
  | 'homogenizationReport'
>;

function isVersionReady(
  session: MinimalPipelineSession | null | undefined,
  key: ChapterPipelineVersionKey
): boolean {
  return Boolean(session?.versions?.[key]?.trim());
}

function resolveOutlineGateStep(outlineType: ChapterPipelineOutlineType): OutlineGateStep {
  switch (outlineType) {
    case 'character':
      return 'character-outline';
    case 'character-traits':
      return 'character-traits-outline';
    default:
      return 'sensory-outline';
  }
}

function resolveOutlineGateModule(
  outlineType: ChapterPipelineOutlineType
): ChapterPipelineRunModule {
  switch (outlineType) {
    case 'character':
      return 'character-outline';
    case 'character-traits':
      return 'character-traits-outline';
    default:
      return 'sensory-outline';
  }
}

function resolveRewriteStep(outlineType: ChapterPipelineOutlineType): PipelineDialogStep {
  switch (outlineType) {
    case 'character':
      return 'character';
    case 'character-traits':
      return 'character-traits';
    default:
      return 'sensory-rewrite';
  }
}

function resolveRewriteModule(outlineType: ChapterPipelineOutlineType): ChapterPipelineRunModule {
  switch (outlineType) {
    case 'character':
      return 'character';
    case 'character-traits':
      return 'character-traits';
    default:
      return 'sensory-rewrite';
  }
}

function resolveOutlineAction(
  outlineType: ChapterPipelineOutlineType,
  outlineState:
    | MinimalPipelineSession['characterOutline']
    | MinimalPipelineSession['characterTraitsOutline']
    | MinimalPipelineSession['sensoryOutline']
    | undefined,
  rewriteReady: boolean
): PipelineBootstrapAction {
  if (!outlineState || !outlineState.userConfirmed) {
    return {
      step: resolveOutlineGateStep(outlineType),
      module: null,
      autoRun: false,
    };
  }

  if (!rewriteReady) {
    return {
      step: resolveRewriteStep(outlineType),
      module: resolveRewriteModule(outlineType),
      autoRun: true,
    };
  }

  return {
    step: resolveRewriteStep(outlineType),
    module: null,
    autoRun: false,
  };
}

function hasModule(enabled: number[], id: number): boolean {
  return enabled.includes(id);
}

export function resolvePipelineBootstrapAction(
  runAll: boolean,
  config: ChapterPipelineConfig,
  session?: MinimalPipelineSession | null
): PipelineBootstrapAction {
  const enabled = config.pipelineEnabledModules ?? [1, 2];

  if (runAll) {
    if (hasModule(enabled, 1)) {
      if (config.pipelineCharacterAdjustmentEnabled) {
        return { step: 'character-outline', module: 'run-all', autoRun: true };
      }
      if (config.pipelineCharacterTraitsEnabled !== false) {
        return { step: 'character-traits-outline', module: 'run-all', autoRun: true };
      }
    }
    if (hasModule(enabled, 2)) {
      return { step: 'sensory-outline', module: 'run-all', autoRun: true };
    }
    if (hasModule(enabled, 3)) {
      return { step: 'rules', module: 'run-all', autoRun: true };
    }
    return { step: 'done', module: 'run-all', autoRun: true };
  }

  if (hasModule(enabled, 1) && config.pipelineCharacterAdjustmentEnabled) {
    return resolveOutlineAction(
      'character',
      session?.characterOutline,
      isVersionReady(session, 'afterCharacter')
    );
  }

  if (hasModule(enabled, 1) && config.pipelineCharacterTraitsEnabled !== false) {
    return resolveOutlineAction(
      'character-traits',
      session?.characterTraitsOutline,
      isVersionReady(session, 'afterCharacterTraits')
    );
  }

  if (hasModule(enabled, 2)) {
    return resolveOutlineAction(
      'sensory',
      session?.sensoryOutline,
      isVersionReady(session, 'afterSensory')
    );
  }

  if (hasModule(enabled, 3)) {
    return {
      step: 'rules',
      module: session?.ruleIssues?.length ? 'rules-fix' : 'rules-scan',
      autoRun: true,
    };
  }

  if (hasModule(enabled, 4) && config.pipelineHomogenizationEnabled) {
    return {
      step: 'homogenization',
      module: session?.homogenizationReport?.length
        ? 'homogenization-rewrite'
        : 'homogenization-scan',
      autoRun: true,
    };
  }

  return { step: 'done', module: null, autoRun: false };
}

export function resolveManualContinueAction(
  currentStep: PipelineDialogStep,
  config: ChapterPipelineConfig,
  session: MinimalPipelineSession | null | undefined
): PipelineBootstrapAction {
  const enabled = config.pipelineEnabledModules ?? [1, 2];

  if (
    currentStep === 'character' &&
    hasModule(enabled, 1) &&
    config.pipelineCharacterTraitsEnabled !== false
  ) {
    return resolveOutlineAction(
      'character-traits',
      session?.characterTraitsOutline,
      isVersionReady(session, 'afterCharacterTraits')
    );
  }

  if (
    (currentStep === 'character' &&
      (!hasModule(enabled, 1) || config.pipelineCharacterTraitsEnabled === false)) ||
    currentStep === 'character-traits'
  ) {
    if (hasModule(enabled, 2)) {
      return resolveOutlineAction(
        'sensory',
        session?.sensoryOutline,
        isVersionReady(session, 'afterSensory')
      );
    }
  }

  if (currentStep === 'sensory-rewrite' && hasModule(enabled, 3)) {
    return {
      step: 'rules',
      module: session?.ruleIssues?.length ? 'rules-fix' : 'rules-scan',
      autoRun: true,
    };
  }

  if ((currentStep === 'sensory-rewrite' && !hasModule(enabled, 3)) || currentStep === 'rules') {
    if (hasModule(enabled, 4) && config.pipelineHomogenizationEnabled) {
      return {
        step: 'homogenization',
        module: session?.homogenizationReport?.length
          ? 'homogenization-rewrite'
          : 'homogenization-scan',
        autoRun: true,
      };
    }
  }

  return { step: 'done', module: null, autoRun: false };
}

export function resolveOutlineTypeForStep(
  step: PipelineDialogStep
): ChapterPipelineOutlineType | null {
  switch (step) {
    case 'character-outline':
      return 'character';
    case 'character-traits-outline':
      return 'character-traits';
    case 'sensory-outline':
      return 'sensory';
    default:
      return null;
  }
}

export function resolveGenerateModuleForOutlineStep(
  step: PipelineDialogStep
): ChapterPipelineRunModule | null {
  const outlineType = resolveOutlineTypeForStep(step);
  return outlineType ? resolveOutlineGateModule(outlineType) : null;
}
