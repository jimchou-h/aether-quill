import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyProjectSettingsJsonExtensions,
  pickProjectSettingsJsonExtensions,
  serializeProjectSettingsForJsonMirror,
} from './project-settings.extensions';

test('pickProjectSettingsJsonExtensions keeps content safety rules', () => {
  const picked = pickProjectSettingsJsonExtensions({
    contentSafetyCustomRules: [{ id: 'a', pattern: '词', severity: 'low', enabled: true }],
    chapterOptimizeSegmentCharSize: 2000,
  });
  assert.equal(picked.contentSafetyCustomRules?.length, 1);
  assert.equal(picked.chapterOptimizeSegmentCharSize, 2000);
});

test('applyProjectSettingsJsonExtensions writes sanitized rules', () => {
  const target: Record<string, unknown> = {
    contentSafetyCustomRules: [],
  };
  applyProjectSettingsJsonExtensions(target, {
    contentSafetyCustomRules: [
      { id: 'ok', pattern: '  违禁  ', severity: 'high', enabled: true },
      { id: '', pattern: 'x', severity: 'low', enabled: true },
    ],
  });
  const rules = target.contentSafetyCustomRules as Array<{ pattern: string }>;
  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.pattern, '违禁');
});

test('serializeProjectSettingsForJsonMirror always writes contentSafetyCustomRules', () => {
  const row = serializeProjectSettingsForJsonMirror({
    systemPromptText: 'sys',
    activePersonaId: null,
    chapterSummaryPromptCount: 3,
    chapterSummaryMemoryCount: 3,
    generationTemperature: 0.7,
    contentSafetyCustomRules: [{ id: 'r1', pattern: '词A', severity: 'medium', enabled: true }],
    updatedAt: new Date('2026-06-27T00:00:00.000Z'),
  });
  assert.equal(row.contentSafetyCustomRules?.length, 1);
  assert.equal(row.contentSafetyCustomRules?.[0]?.pattern, '词A');
  assert.equal(row.contentSafetyScanEnabled, true);
});

test('pickProjectSettingsJsonExtensions ignores null contentSafetyCustomRules', () => {
  const picked = pickProjectSettingsJsonExtensions({
    contentSafetyCustomRules: null as unknown as undefined,
    chapterOptimizeSegmentCharSize: 1000,
  });
  assert.equal('contentSafetyCustomRules' in picked, false);
  assert.equal(picked.chapterOptimizeSegmentCharSize, 1000);
});
