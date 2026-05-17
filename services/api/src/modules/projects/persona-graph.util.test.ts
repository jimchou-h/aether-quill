import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addChapterAppearance,
  buildAbsentPersonaConsistencyNotes,
  countChapterAppearancesForName,
  detectAbsentPersonaWarnings,
  filterRelationEventsForCharacters,
  linkRelationEventToPersonas,
  rebuildPersonaAppearancesFromChapters,
  relinkAllRelationEvents,
  removeChapterFromAppearances,
  renumberAppearancesAfterDelete,
  unlinkRelationEventFromPersonas,
  updateAppearancesForChapter,
} from './persona-graph.util.js';

function makePersona(id: string, name: string) {
  return {
    id,
    name,
    state: '待更新',
    relationEventIds: [] as string[],
    appearedChapterNos: [] as number[],
    lastAppearedChapterNo: null as number | null,
  };
}

describe('persona-graph.util', () => {
  it('tracks chapter appearances by exact substring match', () => {
    const personas = [makePersona('p1', '林月'), makePersona('p2', '陈默')];
    updateAppearancesForChapter(personas, 3, '林月与陈默在码头相遇');
    assert.deepEqual(personas[0]?.appearedChapterNos, [3]);
    assert.deepEqual(personas[1]?.appearedChapterNos, [3]);
    updateAppearancesForChapter(personas, 3, '只有林月出现');
    assert.deepEqual(personas[0]?.appearedChapterNos, [3]);
    assert.deepEqual(personas[1]?.appearedChapterNos, []);
  });

  it('rebuilds appearances from all chapters', () => {
    const personas = [makePersona('p1', '林月')];
    rebuildPersonaAppearancesFromChapters(personas, [
      { chapterNo: 1, content: '林月出场' },
      { chapterNo: 2, content: '无角色' },
      { chapterNo: 3, content: '再见林月' },
    ]);
    assert.deepEqual(personas[0]?.appearedChapterNos, [1, 3]);
    assert.equal(personas[0]?.lastAppearedChapterNo, 3);
  });

  it('links relation events to personas bidirectionally', () => {
    const personas = [makePersona('p1', '林月'), makePersona('p2', '陈默')];
    const event = {
      id: 'e1',
      protagonist: '林月',
      counterparty: '陈默',
      protagonistPersonaId: null,
      counterpartyPersonaId: null,
      chapterNo: 3,
      summary: '决裂',
    };
    linkRelationEventToPersonas(event, personas);
    assert.equal(event.protagonistPersonaId, 'p1');
    assert.equal(event.counterpartyPersonaId, 'p2');
    assert.deepEqual(personas[0]?.relationEventIds, ['e1']);
    assert.deepEqual(personas[1]?.relationEventIds, ['e1']);
    unlinkRelationEventFromPersonas('e1', personas);
    assert.deepEqual(personas[0]?.relationEventIds, []);
    assert.deepEqual(personas[1]?.relationEventIds, []);
  });

  it('relinks all events after persona changes', () => {
    const personas = [makePersona('p1', '林月')];
    const events = [
      {
        id: 'e1',
        protagonist: '林月',
        counterparty: '王爷',
        protagonistPersonaId: null,
        counterpartyPersonaId: null,
        chapterNo: 1,
        summary: '主仆',
      },
    ];
    relinkAllRelationEvents(personas, events);
    assert.deepEqual(personas[0]?.relationEventIds, ['e1']);
  });

  it('detects absent personas and builds consistency notes', () => {
    const personas = [
      { ...makePersona('p1', '林月'), lastAppearedChapterNo: 5, appearedChapterNos: [5] },
      { ...makePersona('p2', '沈公子'), lastAppearedChapterNo: 8, appearedChapterNos: [8] },
    ];
    const warnings = detectAbsentPersonaWarnings(personas, 12, 3);
    assert.equal(warnings.length, 2);
    const notes = buildAbsentPersonaConsistencyNotes(warnings);
    assert.ok(notes.some((note) => note.message.includes('沈公子')));
  });

  it('adjusts appearances when a chapter is deleted', () => {
    const appeared = addChapterAppearance(addChapterAppearance([], 2), 4);
    assert.deepEqual(removeChapterFromAppearances(appeared, 2), [4]);
    assert.deepEqual(renumberAppearancesAfterDelete([2, 3, 4], 2), [2, 3]);
  });

  it('filters relation events for selected characters', () => {
    const ids = filterRelationEventsForCharacters(
      [
        {
          id: 'e1',
          protagonist: '林月',
          counterparty: '陈默',
          actors: ['林月', '陈默'],
        },
        {
          id: 'e2',
          protagonist: '林月',
          counterparty: '王爷',
          actors: ['林月', '王爷'],
        },
      ],
      ['陈默']
    );
    assert.deepEqual(ids, ['e1']);
  });

  it('counts chapter appearances for a name', () => {
    const count = countChapterAppearancesForName(
      [
        { chapterNo: 1, content: '林月' },
        { chapterNo: 2, content: '林月与陈默' },
        { chapterNo: 3, content: '陈默' },
      ],
      '林月'
    );
    assert.equal(count, 2);
  });
});
