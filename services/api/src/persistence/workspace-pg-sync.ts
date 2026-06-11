import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type {
  ChapterStructuredInfoPersisted,
  PersistedProjectState,
} from '../modules/projects/persisted-workspace.types';
import {
  DEFAULT_CHAPTER_SUMMARY_MEMORY_COUNT,
  DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT,
  DEFAULT_GENERATION_TEMPERATURE,
} from '../modules/projects/project-settings.util';

export async function loadWorkspaceFromPostgres(
  prisma: PrismaClient
): Promise<PersistedProjectState | null> {
  const count = await prisma.project.count();
  if (count === 0) {
    return null;
  }

  const rows = await prisma.project.findMany({
    include: {
      members: { orderBy: { createdAt: 'asc' } },
      settings: true,
      personas: { orderBy: { createdAt: 'asc' } },
      chapters: { orderBy: { chapterNo: 'asc' } },
      indexJobs: { orderBy: { createdAt: 'desc' } },
      summaryJobs: { orderBy: { createdAt: 'desc' } },
      relationEvents: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const projects = rows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  const members: PersistedProjectState['members'] = [];
  const settings: PersistedProjectState['settings'] = {};
  const personas: PersistedProjectState['personas'] = {};
  const knowledge: PersistedProjectState['knowledge'] = {};
  const indexJobs: PersistedProjectState['indexJobs'] = {};
  const summarizeJobs: PersistedProjectState['summarizeJobs'] = {};
  const relationEvents: PersistedProjectState['relationEvents'] = {};

  for (const p of rows) {
    for (const m of p.members) {
      members.push({
        userId: m.userId,
        projectId: m.projectId,
        role: m.role as 'owner' | 'editor' | 'viewer',
        createdAt: m.createdAt.toISOString(),
      });
    }

    if (p.settings) {
      settings[p.id] = {
        systemPromptText: p.settings.systemPromptText,
        activePersonaId: p.settings.activePersonaId,
        chapterSummaryPromptCount: p.settings.chapterSummaryPromptCount,
        chapterSummaryMemoryCount: p.settings.chapterSummaryMemoryCount,
        generationTemperature: p.settings.generationTemperature,
        updatedAt: p.settings.updatedAt.toISOString(),
      };
    }

    personas[p.id] = p.personas.map((per) => ({
      id: per.id,
      name: per.name,
      profile: per.profile,
      state: per.state,
      tone: per.tone ?? undefined,
      constraints: (per.constraints as string[] | null) ?? undefined,
      status: per.status as 'draft' | 'published',
      relationEventIds: (per.relationEventIds as string[]) ?? [],
      appearedChapterNos: (per.appearedChapterNos as number[]) ?? [],
      lastAppearedChapterNo: per.lastAppearedChapterNo ?? null,
      chapterStates: Array.isArray(per.chapterStates)
        ? (per.chapterStates as PersistedProjectState['personas'][string][number]['chapterStates'])
        : undefined,
      createdAt: per.createdAt.toISOString(),
      updatedAt: per.updatedAt.toISOString(),
    }));

    knowledge[p.id] = {
      outlineSummary: p.outlineSummary,
      chapters: p.chapters.map((ch) => ({
        chapterNo: ch.chapterNo,
        title: ch.title,
        content: ch.content,
        summary: ch.summary,
        summarySource: (ch.summarySource as 'llm' | 'fallback' | undefined) ?? undefined,
        summaryUpdatedAt: ch.summaryUpdatedAt ? ch.summaryUpdatedAt.toISOString() : undefined,
        structuredInfo:
          ch.structuredInfo &&
          typeof ch.structuredInfo === 'object' &&
          !Array.isArray(ch.structuredInfo)
            ? (ch.structuredInfo as unknown as ChapterStructuredInfoPersisted)
            : undefined,
        updatedAt: ch.updatedAt.toISOString(),
      })),
      indexVersion: p.indexVersion,
      lastIndexedAt: p.lastIndexedAt ? p.lastIndexedAt.toISOString() : null,
    };

    indexJobs[p.id] = p.indexJobs.map((j) => ({
      id: j.id,
      projectId: j.projectId,
      mode: j.mode,
      status: j.status,
      totalChapters: j.totalChapters,
      processedChapters: j.processedChapters,
      createdAt: j.createdAt.toISOString(),
      completedAt: j.completedAt ? j.completedAt.toISOString() : null,
      errorMessage: j.errorMessage,
    }));

    summarizeJobs[p.id] = p.summaryJobs.map((j) => {
      const chapterNos = (j.chapterNosJson as number[]) ?? [];
      const rawSummaries =
        (j.summariesJson as Array<{
          chapterNo: number;
          summary: string;
          summarySource?: string;
        }>) ?? [];
      return {
        id: j.id,
        projectId: j.projectId,
        scope: j.scope,
        chapterNo: j.chapterNo,
        status: j.status,
        totalChapters: j.totalChapters,
        processedChapters: j.processedChapters,
        chapterNos,
        summaries: rawSummaries.map((s) => ({
          chapterNo: s.chapterNo,
          summary: s.summary,
          summarySource: s.summarySource === 'llm' ? 'llm' : 'fallback',
        })),
        createdAt: j.createdAt.toISOString(),
        completedAt: j.completedAt ? j.completedAt.toISOString() : null,
        errorMessage: j.errorMessage,
      };
    });

    relationEvents[p.id] = p.relationEvents.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      protagonist: e.protagonist,
      counterparty: e.counterparty,
      actors: (e.actors as string[]) ?? [],
      summary: e.summary,
      evidenceSnippet: e.evidenceSnippet ?? undefined,
      chapterNo: e.chapterNo,
      protagonistPersonaId: e.protagonistPersonaId ?? null,
      counterpartyPersonaId: e.counterpartyPersonaId ?? null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      deletedAt: e.deletedAt ? e.deletedAt.toISOString() : null,
    }));
  }

  return {
    projects,
    members,
    settings,
    personas,
    knowledge,
    indexJobs,
    summarizeJobs,
    relationEvents,
    /** JSON 主存；PG 专项表未建前从 PG 加载时为空，由 JSON 镜像补全 */
    identityRelations: {},
  };
}

export async function syncWorkspaceToPostgres(
  prisma: PrismaClient,
  payload: PersistedProjectState
): Promise<void> {
  const projectIds = payload.projects.map((p) => p.id);
  if (projectIds.length === 0) {
    await prisma.project.deleteMany();
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.project.deleteMany({
      where: { id: { notIn: projectIds } },
    });

    for (const p of payload.projects) {
      const k = payload.knowledge[p.id];
      await tx.project.upsert({
        where: { id: p.id },
        create: {
          id: p.id,
          name: p.name,
          description: p.description ?? '',
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          outlineSummary: k?.outlineSummary ?? '',
          indexVersion: k?.indexVersion ?? 0,
          lastIndexedAt: k?.lastIndexedAt ? new Date(k.lastIndexedAt) : null,
        },
        update: {
          name: p.name,
          description: p.description ?? '',
          updatedAt: new Date(p.updatedAt),
          outlineSummary: k?.outlineSummary ?? '',
          indexVersion: k?.indexVersion ?? 0,
          lastIndexedAt: k?.lastIndexedAt ? new Date(k.lastIndexedAt) : null,
        },
      });
    }

    await tx.projectMember.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    const memberRows = payload.members
      .filter((m) => projectIds.includes(m.projectId))
      .map((m) => ({
        userId: m.userId,
        projectId: m.projectId,
        role: m.role,
        createdAt: new Date(m.createdAt),
      }));
    if (memberRows.length > 0) {
      await tx.projectMember.createMany({ data: memberRows });
    }

    for (const pid of projectIds) {
      const s = payload.settings[pid];
      if (!s) continue;
      await tx.projectSettings.upsert({
        where: { projectId: pid },
        create: {
          projectId: pid,
          systemPromptText: s.systemPromptText,
          activePersonaId: s.activePersonaId,
          chapterSummaryPromptCount:
            s.chapterSummaryPromptCount ?? DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT,
          chapterSummaryMemoryCount:
            s.chapterSummaryMemoryCount ?? DEFAULT_CHAPTER_SUMMARY_MEMORY_COUNT,
          generationTemperature: s.generationTemperature ?? DEFAULT_GENERATION_TEMPERATURE,
          updatedAt: new Date(s.updatedAt),
        },
        update: {
          systemPromptText: s.systemPromptText,
          activePersonaId: s.activePersonaId,
          chapterSummaryPromptCount:
            s.chapterSummaryPromptCount ?? DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT,
          chapterSummaryMemoryCount:
            s.chapterSummaryMemoryCount ?? DEFAULT_CHAPTER_SUMMARY_MEMORY_COUNT,
          generationTemperature: s.generationTemperature ?? DEFAULT_GENERATION_TEMPERATURE,
          updatedAt: new Date(s.updatedAt),
        },
      });
    }

    await tx.persona.deleteMany({ where: { projectId: { in: projectIds } } });
    const personaRows: Prisma.PersonaCreateManyInput[] = [];
    for (const pid of projectIds) {
      for (const per of payload.personas[pid] ?? []) {
        personaRows.push({
          id: per.id,
          projectId: pid,
          name: per.name,
          profile: per.profile,
          state: per.state?.trim() ? per.state : '待更新',
          tone: per.tone ?? null,
          constraints: per.constraints ?? Prisma.JsonNull,
          status: per.status,
          relationEventIds: per.relationEventIds ?? [],
          appearedChapterNos: per.appearedChapterNos ?? [],
          lastAppearedChapterNo: per.lastAppearedChapterNo ?? null,
          chapterStates: per.chapterStates ?? Prisma.JsonNull,
          createdAt: new Date(per.createdAt),
          updatedAt: new Date(per.updatedAt),
        });
      }
    }
    if (personaRows.length > 0) {
      await tx.persona.createMany({ data: personaRows });
    }

    await tx.chapter.deleteMany({ where: { projectId: { in: projectIds } } });
    const chapterRows: Prisma.ChapterCreateManyInput[] = [];
    for (const pid of projectIds) {
      const k = payload.knowledge[pid];
      if (!k?.chapters?.length) continue;
      for (const ch of k.chapters) {
        chapterRows.push({
          projectId: pid,
          chapterNo: ch.chapterNo,
          title: ch.title,
          content: ch.content,
          summary: ch.summary ?? '',
          summarySource: ch.summarySource ?? null,
          summaryUpdatedAt: ch.summaryUpdatedAt ? new Date(ch.summaryUpdatedAt) : null,
          ...(ch.structuredInfo !== undefined && ch.structuredInfo !== null
            ? { structuredInfo: ch.structuredInfo as unknown as Prisma.InputJsonValue }
            : {}),
          updatedAt: new Date(ch.updatedAt),
        });
      }
    }
    if (chapterRows.length > 0) {
      await tx.chapter.createMany({ data: chapterRows });
    }

    await tx.indexJob.deleteMany({ where: { projectId: { in: projectIds } } });
    const indexRows: Prisma.IndexJobCreateManyInput[] = [];
    for (const pid of projectIds) {
      for (const j of payload.indexJobs[pid] ?? []) {
        indexRows.push({
          id: j.id,
          projectId: pid,
          mode: j.mode,
          status: j.status,
          totalChapters: j.totalChapters,
          processedChapters: j.processedChapters,
          createdAt: new Date(j.createdAt),
          completedAt: j.completedAt ? new Date(j.completedAt) : null,
          errorMessage: j.errorMessage,
        });
      }
    }
    if (indexRows.length > 0) {
      await tx.indexJob.createMany({ data: indexRows });
    }

    await tx.summaryJob.deleteMany({ where: { projectId: { in: projectIds } } });
    const summaryRows: Prisma.SummaryJobCreateManyInput[] = [];
    for (const pid of projectIds) {
      for (const j of payload.summarizeJobs[pid] ?? []) {
        summaryRows.push({
          id: j.id,
          projectId: pid,
          scope: j.scope,
          chapterNo: j.chapterNo,
          status: j.status,
          totalChapters: j.totalChapters,
          processedChapters: j.processedChapters,
          chapterNosJson: j.chapterNos as Prisma.InputJsonValue,
          summariesJson: j.summaries as Prisma.InputJsonValue,
          createdAt: new Date(j.createdAt),
          completedAt: j.completedAt ? new Date(j.completedAt) : null,
          errorMessage: j.errorMessage,
        });
      }
    }
    if (summaryRows.length > 0) {
      await tx.summaryJob.createMany({ data: summaryRows });
    }

    await tx.relationEvent.deleteMany({ where: { projectId: { in: projectIds } } });
    const relRows: Prisma.RelationEventCreateManyInput[] = [];
    for (const pid of projectIds) {
      for (const e of payload.relationEvents[pid] ?? []) {
        relRows.push({
          id: e.id,
          projectId: pid,
          protagonist: e.protagonist,
          counterparty: e.counterparty,
          actors: e.actors,
          summary: e.summary,
          evidenceSnippet: e.evidenceSnippet ?? null,
          chapterNo: e.chapterNo,
          protagonistPersonaId: e.protagonistPersonaId ?? null,
          counterpartyPersonaId: e.counterpartyPersonaId ?? null,
          createdAt: new Date(e.createdAt),
          updatedAt: new Date(e.updatedAt),
          deletedAt: e.deletedAt ? new Date(e.deletedAt) : null,
        });
      }
    }
    if (relRows.length > 0) {
      await tx.relationEvent.createMany({ data: relRows });
    }
  });
}
