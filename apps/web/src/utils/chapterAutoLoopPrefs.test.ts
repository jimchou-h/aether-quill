import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTO_LOOP_ROUND_BUDGET_DEFAULT,
  AUTO_LOOP_ROUND_BUDGET_MAX,
  AUTO_LOOP_ROUND_BUDGET_MIN,
  CHAPTER_AUTO_LOOP_PREFS_STORAGE_KEY,
  clampAutoLoopRoundBudget,
  loadChapterAutoLoopPrefs,
  parseChapterAutoLoopPrefs,
  saveChapterAutoLoopPrefs,
} from './chapterAutoLoopPrefs';

function makeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe('clampAutoLoopRoundBudget', () => {
  it('defaults to 2 rounds so the loop is a critique-revise pair out of the box', () => {
    assert.equal(AUTO_LOOP_ROUND_BUDGET_DEFAULT, 2);
    assert.equal(clampAutoLoopRoundBudget(undefined), AUTO_LOOP_ROUND_BUDGET_DEFAULT);
    assert.equal(clampAutoLoopRoundBudget(null), AUTO_LOOP_ROUND_BUDGET_DEFAULT);
    assert.equal(clampAutoLoopRoundBudget('abc'), AUTO_LOOP_ROUND_BUDGET_DEFAULT);
    assert.equal(clampAutoLoopRoundBudget(Number.NaN), AUTO_LOOP_ROUND_BUDGET_DEFAULT);
  });

  it('clamps into the 1..3 band rather than trusting caller input', () => {
    assert.equal(clampAutoLoopRoundBudget(0), AUTO_LOOP_ROUND_BUDGET_MIN);
    assert.equal(clampAutoLoopRoundBudget(-5), AUTO_LOOP_ROUND_BUDGET_MIN);
    assert.equal(clampAutoLoopRoundBudget(99), AUTO_LOOP_ROUND_BUDGET_MAX);
    assert.equal(clampAutoLoopRoundBudget(2.4), 2);
    assert.equal(clampAutoLoopRoundBudget('3'), 3);
  });
});

describe('parseChapterAutoLoopPrefs', () => {
  it('falls back to defaults for non-object input', () => {
    assert.deepEqual(parseChapterAutoLoopPrefs(null), {
      roundBudget: AUTO_LOOP_ROUND_BUDGET_DEFAULT,
    });
    assert.deepEqual(parseChapterAutoLoopPrefs('nope'), {
      roundBudget: AUTO_LOOP_ROUND_BUDGET_DEFAULT,
    });
  });

  it('clamps a persisted out-of-band budget instead of propagating it', () => {
    assert.deepEqual(parseChapterAutoLoopPrefs({ roundBudget: 42 }), {
      roundBudget: AUTO_LOOP_ROUND_BUDGET_MAX,
    });
  });
});

describe('chapter auto-loop prefs storage', () => {
  it('round-trips through storage', () => {
    const storage = makeStorage();
    saveChapterAutoLoopPrefs({ roundBudget: 3 }, storage);
    assert.deepEqual(loadChapterAutoLoopPrefs(storage), { roundBudget: 3 });
  });

  it('normalizes on write so corrupt values never reach storage', () => {
    const storage = makeStorage();
    saveChapterAutoLoopPrefs({ roundBudget: 99 }, storage);
    assert.equal(
      storage.map.get(CHAPTER_AUTO_LOOP_PREFS_STORAGE_KEY),
      JSON.stringify({ roundBudget: AUTO_LOOP_ROUND_BUDGET_MAX })
    );
  });

  it('treats unreadable or malformed storage as first run', () => {
    assert.deepEqual(loadChapterAutoLoopPrefs(null), {
      roundBudget: AUTO_LOOP_ROUND_BUDGET_DEFAULT,
    });
    const broken = makeStorage({ [CHAPTER_AUTO_LOOP_PREFS_STORAGE_KEY]: '{not json' });
    assert.deepEqual(loadChapterAutoLoopPrefs(broken), {
      roundBudget: AUTO_LOOP_ROUND_BUDGET_DEFAULT,
    });
  });
});
