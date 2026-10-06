import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeEventCardsAfterExtract,
  parseExtractedEventCardCandidates,
  recallCrossChapterMemory,
  type EventCardRecord,
} from './event-card.util';

function card(partial: Partial<EventCardRecord> & Pick<EventCardRecord, 'id' | 'beat'>): EventCardRecord {
  return {
    projectId: 'p1',
    chapterNo: 1,
    entities: ['杨幂'],
    kind: 'other',
    status: 'fact',
    evidence: '',
    source: 'auto',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...partial,
  };
}

test('parseExtractedEventCardCandidates keeps at most 8 valid beats', () => {
  const raw = Array.from({ length: 12 }, (_, i) => ({
    beat: `事实${i + 1}足够长一点`,
    entities: ['林默'],
    kind: 'ability',
    evidence: '证据片段',
  }));
  const parsed = parseExtractedEventCardCandidates(raw);
  assert.equal(parsed.length, 8);
  assert.equal(parsed[0]?.kind, 'ability');
  assert.equal(parsed[0]?.status, 'fact');
});

test('mergeEventCardsAfterExtract soft-deletes auto cards but keeps user_edit', () => {
  const existing: EventCardRecord[] = [
    card({ id: 'a1', chapterNo: 9, source: 'auto', beat: '旧自动卡' }),
    card({
      id: 'u1',
      chapterNo: 9,
      source: 'user_edit',
      beat: '用户改过的卡',
      status: 'open',
      kind: 'foreshadow',
    }),
  ];
  const merged = mergeEventCardsAfterExtract({
    existing,
    projectId: 'p1',
    chapterNo: 9,
    candidates: [
      {
        beat: '新自动卡定身只锁腰腿',
        entities: ['林默', '杨幂'],
        kind: 'ability',
        status: 'fact',
        evidence: '他只锁了她的腰腿',
      },
    ],
    now: new Date('2026-09-30T00:00:00.000Z'),
    idFactory: () => 'new1',
  });

  const autoOld = merged.find((c) => c.id === 'a1');
  const user = merged.find((c) => c.id === 'u1');
  const created = merged.find((c) => c.id === 'new1');
  assert.ok(autoOld?.deletedAt);
  assert.equal(user?.deletedAt, null);
  assert.equal(user?.beat, '用户改过的卡');
  assert.equal(created?.beat, '新自动卡定身只锁腰腿');
  assert.equal(created?.source, 'auto');
});

test('recallCrossChapterMemory ranks open ability and neighbor chapter', () => {
  const cards: EventCardRecord[] = [
    card({
      id: '1',
      chapterNo: 3,
      beat: '无关天气很好',
      entities: ['路人'],
      kind: 'other',
      status: 'fact',
    }),
    card({
      id: '2',
      chapterNo: 8,
      beat: '林默具备定身能力，可锁腰腿',
      entities: ['林默', '杨幂'],
      kind: 'ability',
      status: 'fact',
      evidence: '只锁腰腿手臂可动',
    }),
    card({
      id: '3',
      chapterNo: 9,
      beat: '女儿撞破卧室',
      entities: ['刘苡馨', '杨幂'],
      kind: 'foreshadow',
      status: 'open',
      evidence: '妈妈我睡不着',
    }),
  ];

  const result = recallCrossChapterMemory({
    cards,
    currentChapterNo: 10,
    appearingCharacters: ['杨幂', '林默', '刘苡馨'],
    queryText: '母女定身内射计划',
    topK: 8,
  });

  assert.ok(result.blockText.includes('【跨章记忆'));
  assert.ok(result.used.length >= 2);
  assert.ok(result.used.some((u) => u.id === '2'));
  assert.ok(result.used.some((u) => u.id === '3'));
  assert.ok(!result.used.some((u) => u.id === '1') || result.used[0]?.id !== '1');
});

test('recallCrossChapterMemory excludes current chapter cards', () => {
  const cards: EventCardRecord[] = [
    card({
      id: 'cur',
      chapterNo: 10,
      beat: '本章自己的事不该召回',
      entities: ['杨幂'],
      kind: 'ability',
      status: 'fact',
    }),
    card({
      id: 'prev',
      chapterNo: 9,
      beat: '上章撞破',
      entities: ['杨幂'],
      kind: 'foreshadow',
      status: 'open',
    }),
  ];
  const result = recallCrossChapterMemory({
    cards,
    currentChapterNo: 10,
    appearingCharacters: ['杨幂'],
    queryText: '撞破',
  });
  assert.equal(result.used.some((u) => u.id === 'cur'), false);
  assert.equal(result.used.some((u) => u.id === 'prev'), true);
});
