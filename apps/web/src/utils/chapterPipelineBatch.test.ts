import assert from 'node:assert/strict';
import test from 'node:test';
import { BATCH_PIPELINE_AUTO_CONFIG_OVERRIDES } from './chapterPipelineBatch';

test('BATCH_PIPELINE_AUTO_CONFIG_OVERRIDES skips all outline gates', () => {
  assert.equal(BATCH_PIPELINE_AUTO_CONFIG_OVERRIDES.pipelineSkipCharacterOutlineReview, true);
  assert.equal(BATCH_PIPELINE_AUTO_CONFIG_OVERRIDES.pipelineSkipCharacterTraitsOutlineReview, true);
  assert.equal(BATCH_PIPELINE_AUTO_CONFIG_OVERRIDES.pipelineSkipSensoryOutlineReview, true);
});
