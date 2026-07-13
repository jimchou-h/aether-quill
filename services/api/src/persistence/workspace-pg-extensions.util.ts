import type { Prisma } from '@prisma/client';
import type {
  ChapterStructuredInfoPersisted,
  PersistedProjectState,
} from '../modules/projects/persisted-workspace.types';

type PersistedIdentityRelation = PersistedProjectState['identityRelations'][string][number];

export function serializeWorkbenchStructuredForPg(
  workbench?: Record<string, ChapterStructuredInfoPersisted>
): Prisma.InputJsonValue | undefined {
  if (!workbench || Object.keys(workbench).length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(workbench).map(([key, value]) => [String(key), value])
  ) as unknown as Prisma.InputJsonValue;
}

export function parseWorkbenchStructuredFromPg(
  raw: unknown
): Record<string, ChapterStructuredInfoPersisted> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const result: Record<string, ChapterStructuredInfoPersisted> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = value as ChapterStructuredInfoPersisted;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function serializeIdentityRelationsForPg(
  relations: PersistedIdentityRelation[] | undefined
): Prisma.InputJsonValue {
  return (relations ?? []).map((relation) => ({
    ...relation,
    createdAt:
      typeof relation.createdAt === 'string'
        ? relation.createdAt
        : new Date(relation.createdAt).toISOString(),
    updatedAt:
      typeof relation.updatedAt === 'string'
        ? relation.updatedAt
        : new Date(relation.updatedAt).toISOString(),
  })) as Prisma.InputJsonValue;
}

export function parseIdentityRelationsFromPg(raw: unknown): PersistedIdentityRelation[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const relation = item as PersistedIdentityRelation;
      return {
        ...relation,
        source: relation.source === 'manual' ? 'manual' : 'llm',
        createdAt:
          typeof relation.createdAt === 'string'
            ? relation.createdAt
            : new Date(relation.createdAt as unknown as string).toISOString(),
        updatedAt:
          typeof relation.updatedAt === 'string'
            ? relation.updatedAt
            : new Date(relation.updatedAt as unknown as string).toISOString(),
      };
    });
}
