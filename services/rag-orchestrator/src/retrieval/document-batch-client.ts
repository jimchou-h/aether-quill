import axios from 'axios';

export interface BatchDocumentRecord {
  id: string;
  title: string;
  content: string;
  type: string;
}

export async function fetchDocumentsBatch(
  apiBaseUrl: string,
  projectId: string,
  documentIds: string[]
): Promise<BatchDocumentRecord[]> {
  const ids = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return [];
  }

  const res = await axios.post(`${apiBaseUrl}/api/documents/batch-get`, {
    projectId,
    documentIds: ids,
  });
  const envelope = res.data;
  const data = envelope?.data ?? envelope;
  const documents = data?.documents;
  if (!Array.isArray(documents)) {
    return [];
  }
  return documents.map((d: Record<string, unknown>) => ({
    id: String(d.id ?? ''),
    title: String(d.title ?? ''),
    content: String(d.content ?? ''),
    type: String(d.type ?? 'document'),
  }));
}
