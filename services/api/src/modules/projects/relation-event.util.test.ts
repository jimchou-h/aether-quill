import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRelationMemoryBlock,
  matchesRelationEventFilters,
  normalizeRelationEventDedupeKey,
  normalizeSelectedEventIds,
  parseExtractedRelationEventCandidates,
  resolveRelationEventActors,
  softDeleteChapterRelationEvents,
} from './relation-event.util';

test('buildRelationMemoryBlock returns empty string for no events', () => {
  assert.equal(buildRelationMemoryBlock([]), '');
});

test('buildRelationMemoryBlock formats selected events with constraints', () => {
  const block = buildRelationMemoryBlock([
    {
      protagonist: '男主',
      counterparty: '女主A',
      summary: '女主A误以为男主背叛',
      evidenceSnippet: '她当场质问',
      chapterNo: 12,
    },
  ]);

  assert.match(block, /【用户选择的关系事件（既定事实）】/);
  assert.match(block, /\[第12章\]\[男主-女主A\]/);
  assert.doesNotMatch(block, /\[误会\]/);
  assert.match(block, /证据：她当场质问/);
  assert.match(block, /不得无因否定/);
});

test('normalizeSelectedEventIds deduplicates ids', () => {
  assert.deepEqual(normalizeSelectedEventIds(['a', 'a', 'b']), ['a', 'b']);
});

test('resolveRelationEventActors defaults to protagonist and counterparty', () => {
  assert.deepEqual(resolveRelationEventActors(undefined, '男主', '女主A'), ['男主', '女主A']);
});

test('matchesRelationEventFilters filters by appearing characters', () => {
  const event = {
    protagonist: '男主',
    counterparty: '女主A',
    summary: '误会升级',
    actors: ['男主', '女主A'],
  };

  assert.equal(matchesRelationEventFilters(event, { appearingCharacters: ['女主A'] }), true);
  assert.equal(matchesRelationEventFilters(event, { appearingCharacters: ['女主B'] }), false);
});

test('normalizeRelationEventDedupeKey ignores whitespace in summary', () => {
  const left = normalizeRelationEventDedupeKey({
    chapterNo: 3,
    protagonist: '男主',
    counterparty: '女主A',
    summary: '两人 和解',
  });
  const right = normalizeRelationEventDedupeKey({
    chapterNo: 3,
    protagonist: '男主',
    counterparty: '女主A',
    summary: '两人和解',
  });
  assert.equal(left, right);
});

test('parseExtractedRelationEventCandidates parses fenced json arrays', () => {
  const candidates = parseExtractedRelationEventCandidates(
    '```json\n[{"counterparty":"女主A","summary":"误会加深","evidenceSnippet":"她转身离开"}]\n```'
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.counterparty, '女主A');
  assert.equal(candidates[0]?.summary, '误会加深');
  assert.equal(candidates[0]?.evidenceSnippet, '她转身离开');
});

test('softDeleteChapterRelationEvents soft-deletes only matching chapter', () => {
  const now = new Date('2026-06-11T00:00:00.000Z');
  const events = [
    {
      id: 'e1',
      chapterNo: 3,
      deletedAt: null,
      updatedAt: new Date('2026-06-10T00:00:00.000Z'),
    },
    {
      id: 'e2',
      chapterNo: 4,
      deletedAt: null,
      updatedAt: new Date('2026-06-10T00:00:00.000Z'),
    },
    {
      id: 'e3',
      chapterNo: 3,
      deletedAt: new Date('2026-06-09T00:00:00.000Z'),
      updatedAt: new Date('2026-06-09T00:00:00.000Z'),
    },
  ];

  const removedIds = softDeleteChapterRelationEvents(events, 3, now);
  assert.deepEqual(removedIds, ['e1']);
  assert.ok(events[0]?.deletedAt);
  assert.equal(events[1]?.deletedAt, null);
  assert.equal(events[2]?.deletedAt?.toISOString(), '2026-06-09T00:00:00.000Z');
});

test('parseExtractedRelationEventCandidates skips invalid items', () => {
  const candidates = parseExtractedRelationEventCandidates([
    { counterparty: '女主A', summary: '有效事件' },
    { counterparty: '', summary: '无效' },
    { counterparty: '女主B' },
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.counterparty, '女主A');
  assert.equal(candidates[0]?.summary, '有效事件');
});
