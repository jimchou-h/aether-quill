import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEventRelationGraph, buildIdentityRelationGraph } from './personaGraph';
import type { PersonaIdentityRelationItem, PersonaItem, RelationEventItem } from '../services/api';

const personas: PersonaItem[] = [
  {
    id: 'p1',
    name: '沈镜川',
    profile: '',
    state: '',
    status: 'published',
    relationEventIds: [],
    appearedChapterNos: [],
    lastAppearedChapterNo: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'p2',
    name: '叶清歌',
    profile: '',
    state: '',
    status: 'draft',
    relationEventIds: [],
    appearedChapterNos: [],
    lastAppearedChapterNo: null,
    createdAt: '',
    updatedAt: '',
  },
];

test('buildIdentityRelationGraph creates directed labeled links', () => {
  const relations: PersonaIdentityRelationItem[] = [
    {
      id: 'r1',
      projectId: 'proj',
      fromPersonaId: 'p1',
      toPersonaId: 'p2',
      relation: '师父',
      source: 'llm',
      chapterNo: 3,
      createdAt: '',
      updatedAt: '',
    },
  ];

  const graph = buildIdentityRelationGraph(personas, relations);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.links.length, 1);
  assert.equal(graph.links[0]?.label, '师父');
  assert.equal(graph.links[0]?.directed, true);
});

test('buildEventRelationGraph merges undirected event pairs', () => {
  const events: RelationEventItem[] = [
    {
      id: 'e1',
      projectId: 'proj',
      protagonist: '沈镜川',
      counterparty: '叶清歌',
      actors: [],
      summary: '对峙',
      chapterNo: 3,
      protagonistPersonaId: 'p1',
      counterpartyPersonaId: 'p2',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const graph = buildEventRelationGraph(personas, events);
  assert.equal(graph.links.length, 1);
  assert.equal(graph.links[0]?.directed, false);
});
