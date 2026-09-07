import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBasePipelineEnabledModules,
  configOverridesFromSelection,
  isPipelineModuleSelectionValid,
  selectionFromPipelineConfig,
} from './pipelineModuleSelection';

test('buildBasePipelineEnabledModules maps selection to module ids', () => {
  assert.deepEqual(
    buildBasePipelineEnabledModules({
      characterAdjustment: false,
      characterTraits: true,
      sensory: false,
    }),
    [1]
  );
  assert.deepEqual(
    buildBasePipelineEnabledModules({
      characterAdjustment: false,
      characterTraits: false,
      sensory: true,
    }),
    [2]
  );
});

test('configOverridesFromSelection supports sensory-only run', () => {
  const overrides = configOverridesFromSelection({
    characterAdjustment: false,
    characterTraits: false,
    sensory: true,
    homogenization: false,
  });
  assert.deepEqual(overrides.pipelineEnabledModules, [2]);
  assert.equal(overrides.pipelineCharacterAdjustmentEnabled, false);
  assert.equal(overrides.pipelineCharacterTraitsEnabled, false);
});

test('selectionFromPipelineConfig reads stored modules', () => {
  const selection = selectionFromPipelineConfig({
    pipelineEnabledModules: [2],
    pipelineCharacterAdjustmentEnabled: true,
    pipelineCharacterTraitsEnabled: true,
    pipelineHomogenizationEnabled: false,
  });
  assert.equal(selection.sensory, true);
  assert.equal(selection.characterAdjustment, true);
});

test('isPipelineModuleSelectionValid requires at least one module', () => {
  assert.equal(
    isPipelineModuleSelectionValid({
      characterAdjustment: false,
      characterTraits: false,
      sensory: false,
      homogenization: false,
    }),
    false
  );
  assert.equal(
    isPipelineModuleSelectionValid({
      characterAdjustment: false,
      characterTraits: false,
      sensory: true,
      homogenization: false,
    }),
    true
  );
});
