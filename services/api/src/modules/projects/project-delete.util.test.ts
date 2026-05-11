import assert from 'node:assert/strict';
import test from 'node:test';
import { listDocumentIdsForProject } from './project-delete.util';

test('listDocumentIdsForProject returns only matching project document ids', () => {
  const documents = [
    { id: 'doc-1', projectId: 'project-a' },
    { id: 'doc-2', projectId: 'project-b' },
    { id: 'doc-3', projectId: 'project-a' },
  ];

  assert.deepEqual(listDocumentIdsForProject(documents, 'project-a'), ['doc-1', 'doc-3']);
});

test('listDocumentIdsForProject returns empty array when project has no documents', () => {
  const documents = [{ id: 'doc-1', projectId: 'project-b' }];

  assert.deepEqual(listDocumentIdsForProject(documents, 'project-a'), []);
});
