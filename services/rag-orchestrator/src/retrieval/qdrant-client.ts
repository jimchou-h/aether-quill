import { QdrantClient } from '@qdrant/js-client-rest';
import type { ResolvedRagInfrastructureEnv } from '@aether-quill/config';

export function projectChunksCollectionName(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `aq_${safe}_chunks`;
}

export function createQdrantClientFromEnv(env: ResolvedRagInfrastructureEnv): QdrantClient {
  const apiKey = (process.env.QDRANT_API_KEY || '').trim() || undefined;
  return new QdrantClient({
    url: env.qdrantUrl,
    apiKey,
    // infra/docker 当前为 Qdrant 1.7.x；js-client 1.18 默认校验会拒绝连接
    checkCompatibility: false,
  });
}

export async function ensureProjectChunkCollection(
  client: QdrantClient,
  collectionName: string,
  vectorSize: number
): Promise<void> {
  try {
    await client.getCollection(collectionName);
    return;
  } catch {
    // collection missing
  }
  await client.createCollection(collectionName, {
    vectors: {
      size: vectorSize,
      distance: 'Cosine',
    },
  });
}
