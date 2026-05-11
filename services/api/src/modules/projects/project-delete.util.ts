export function listDocumentIdsForProject<T extends { id: string; projectId: string }>(
  documents: T[],
  projectId: string
): string[] {
  return documents
    .filter((document) => document.projectId === projectId)
    .map((document) => document.id);
}
