import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import axios from 'axios';
import { buildFallbackChapterSummary, type ChapterSummarySource } from './chapter-summary.util';
import {
  buildFallbackPersonaState,
  normalizePersonaStateOutput,
  trimForPrompt,
} from './persona-state.util';
import {
  normalizePersonaUpdateInput,
  resolveActivePersonaIdAfterDelete,
} from './persona-management.util';
import {
  buildRelationMemoryBlock,
  matchesRelationEventFilters,
  normalizeRelationEventDedupeKey,
  normalizeSelectedEventIds,
  parseExtractedRelationEventCandidates,
  resolveRelationEventActors,
  RELATION_EVENT_SELECTED_MAX_COUNT,
  RELATION_EVENT_SUMMARY_MAX_LENGTH,
} from './relation-event.util';
import {
  CHAPTER_OPTIMIZE_DRAFT_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
  ChapterVersionConflictError,
  assertDraftText,
  assertInstruction,
  assertPlanText,
  buildDraftUserPrompt,
  buildPlanUserPrompt,
  ensureChapterVersionMatches,
  makeOptimizationId,
  normalizeInstruction,
  parseExpectedUpdatedAt,
  type ChapterOptimizeUsedRelationEvent,
} from './chapter-optimize.util';

function buildTargetWordsInstruction(targetWords?: number): string {
  const parsed = Number(targetWords);
  if (Number.isFinite(parsed) && parsed > 0) {
    return `目标字数约 ${parsed} 字。`;
  }
  return '不设字数上限，在情节完整的前提下尽量充实详尽。';
}

type PersonaStatus = 'draft' | 'published';
type IndexMode = 'full' | 'incremental';
type IndexJobStatus = 'processing' | 'completed' | 'failed';
type SummaryJobStatus = 'processing' | 'completed' | 'failed';
type SummaryJobScope = 'single' | 'batch';

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectMember {
  userId: string;
  projectId: string;
  role: 'owner' | 'editor' | 'viewer';
  createdAt: Date;
}

export interface ProjectSettings {
  systemPromptText: string;
  activePersonaId: string | null;
  updatedAt: Date;
}

export interface PersonaRecord {
  id: string;
  name: string;
  profile: string;
  state: string;
  tone?: string;
  constraints?: string[];
  status: PersonaStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChapterRecord {
  chapterNo: number;
  title: string;
  content: string;
  summary: string;
  summarySource?: ChapterSummarySource;
  summaryUpdatedAt?: Date;
  updatedAt: Date;
}

export interface KnowledgeRecord {
  outlineSummary: string;
  chapters: ChapterRecord[];
  indexVersion: number;
  lastIndexedAt: Date | null;
}

export interface IndexJobRecord {
  id: string;
  projectId: string;
  mode: IndexMode;
  status: IndexJobStatus;
  totalChapters: number;
  processedChapters: number;
  createdAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
}

export interface ChapterSummaryResult {
  chapterNo: number;
  summary: string;
  summarySource: ChapterSummarySource;
}

export interface SummaryJobRecord {
  id: string;
  projectId: string;
  scope: SummaryJobScope;
  chapterNo: number | null;
  status: SummaryJobStatus;
  totalChapters: number;
  processedChapters: number;
  chapterNos: number[];
  summaries: ChapterSummaryResult[];
  createdAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
}

interface WriteTaskInput {
  chapterNo: number;
  goal: string;
  pov: string;
  mustInclude: string[];
  avoid: string[];
  targetWords?: number;
  appearingCharacters?: string[];
  selectedEventIds?: string[];
}

export interface RelationEventRecord {
  id: string;
  projectId: string;
  protagonist: string;
  counterparty: string;
  actors: string[];
  summary: string;
  evidenceSnippet?: string;
  chapterNo: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface UsedRelationEventRecord {
  id: string;
  protagonist: string;
  counterparty: string;
  summary: string;
  evidenceSnippet?: string;
  chapterNo: number | null;
}

export interface WorkspaceSnapshot {
  project: ProjectRecord;
  settings: ProjectSettings;
  personas: PersonaRecord[];
  knowledge: KnowledgeRecord;
  latestIndexJob: IndexJobRecord | null;
  latestSummaryJob: SummaryJobRecord | null;
}

export interface ProjectExportBundle {
  project: ProjectRecord;
  exportedAt: string;
  settings: {
    systemPromptText: string;
    activePersonaId: string | null;
    personas: PersonaRecord[];
  };
  summary: {
    outlineSummary: string;
    chapterCount: number;
    chapters: Array<{ chapterNo: number; title: string; summary: string; updatedAt: Date }>;
  };
}

interface PersistedProjectState {
  projects: Array<
    Omit<ProjectRecord, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string }
  >;
  members: Array<Omit<ProjectMember, 'createdAt'> & { createdAt: string }>;
  settings: Record<
    string,
    { systemPromptText: string; activePersonaId: string | null; updatedAt: string }
  >;
  personas: Record<
    string,
    Array<Omit<PersonaRecord, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string }>
  >;
  knowledge: Record<
    string,
    {
      outlineSummary: string;
      chapters: Array<
        Omit<ChapterRecord, 'updatedAt' | 'summaryUpdatedAt'> & {
          updatedAt: string;
          summaryUpdatedAt?: string;
        }
      >;
      indexVersion: number;
      lastIndexedAt: string | null;
    }
  >;
  indexJobs: Record<
    string,
    Array<
      Omit<IndexJobRecord, 'createdAt' | 'completedAt'> & {
        createdAt: string;
        completedAt: string | null;
      }
    >
  >;
  summarizeJobs: Record<
    string,
    Array<
      Omit<SummaryJobRecord, 'createdAt' | 'completedAt'> & {
        createdAt: string;
        completedAt: string | null;
      }
    >
  >;
  relationEvents: Record<
    string,
    Array<
      Omit<RelationEventRecord, 'createdAt' | 'updatedAt' | 'deletedAt'> & {
        createdAt: string;
        updatedAt: string;
        deletedAt: string | null;
      }
    >
  >;
}

@Injectable()
export class ProjectsService {
  private readonly storagePath = join(resolve(process.cwd()), 'data', 'project-workspaces.json');
  private readonly reservedProjectRouteNames = new Set([
    'workbench',
    'knowledge',
    'settings',
    'documents',
    'chapters',
    'members',
    'workspace',
    'export',
    'write',
  ]);

  private readonly projects: ProjectRecord[] = [];

  private readonly members: ProjectMember[] = [];
  private readonly settingsStore = new Map<string, ProjectSettings>();
  private readonly personasStore = new Map<string, PersonaRecord[]>();
  private readonly knowledgeStore = new Map<string, KnowledgeRecord>();
  private readonly indexJobsStore = new Map<string, IndexJobRecord[]>();
  private readonly summarizeJobsStore = new Map<string, SummaryJobRecord[]>();
  private readonly relationEventsStore = new Map<string, RelationEventRecord[]>();

  constructor() {
    const restored = this.restoreStateFromDisk();
    if (restored) {
      this.projects.splice(0, this.projects.length, ...restored.projects);
      this.members.splice(0, this.members.length, ...restored.members);
      this.hydrateMap(this.settingsStore, restored.settings);
      this.hydrateMap(this.personasStore, restored.personas);
      this.hydrateMap(this.knowledgeStore, restored.knowledge);
      this.hydrateMap(this.indexJobsStore, restored.indexJobs);
      this.hydrateMap(this.summarizeJobsStore, restored.summarizeJobs);
      this.hydrateMap(this.relationEventsStore, restored.relationEvents);
    }

    for (const project of this.projects) {
      this.ensureProjectState(project.id);
    }

    if (!restored) {
      this.persistState();
    }
  }

  findAll(userId?: string) {
    if (!userId) {
      return this.projects;
    }
    const userProjectIds = this.members.filter((m) => m.userId === userId).map((m) => m.projectId);
    return this.projects.filter((p) => userProjectIds.includes(p.id));
  }

  findOne(id: string, userId?: string) {
    this.assertProjectId(id);
    if (userId) {
      this.checkAccess(id, userId);
    }
    return this.getProjectOrThrow(id);
  }

  remove(id: string, userId: string) {
    this.checkAccess(id, userId, ['owner']);

    const index = this.projects.findIndex((project) => project.id === id);
    if (index === -1) {
      throw new NotFoundException(`未找到项目: ${id}`);
    }

    this.projects.splice(index, 1);

    for (let memberIndex = this.members.length - 1; memberIndex >= 0; memberIndex -= 1) {
      if (this.members[memberIndex]?.projectId === id) {
        this.members.splice(memberIndex, 1);
      }
    }

    this.settingsStore.delete(id);
    this.personasStore.delete(id);
    this.knowledgeStore.delete(id);
    this.indexJobsStore.delete(id);
    this.summarizeJobsStore.delete(id);
    this.relationEventsStore.delete(id);
    this.persistState();

    return { id };
  }

  create(data: Partial<ProjectRecord>, userId?: string) {
    const now = new Date();
    const project: ProjectRecord = {
      id: String(Date.now()),
      name: data.name || '新项目',
      description: data.description || '',
      createdAt: now,
      updatedAt: now,
    };
    this.projects.push(project);
    this.ensureProjectState(project.id);

    if (userId) {
      this.members.push({
        userId,
        projectId: project.id,
        role: 'owner',
        createdAt: now,
      });
    }

    this.persistState();
    return project;
  }

  getWorkspace(id: string, userId?: string): WorkspaceSnapshot {
    if (userId) {
      this.checkAccess(id, userId);
    }
    const project = this.getProjectOrThrow(id);
    const settings = this.getSettings(id);
    const personas = this.getPersonas(id);
    const knowledge = this.getKnowledge(id);
    const latestIndexJob = this.getLatestIndexJob(id);
    const latestSummaryJob = this.getLatestSummaryJob(id);

    return { project, settings, personas, knowledge, latestIndexJob, latestSummaryJob };
  }

  getExportBundle(projectId: string, userId?: string): ProjectExportBundle {
    if (userId) {
      this.checkAccess(projectId, userId);
    }
    const project = this.getProjectOrThrow(projectId);
    const settings = this.getSettings(projectId);
    const personas = this.getPersonas(projectId);
    const knowledge = this.getKnowledge(projectId);

    return {
      project,
      exportedAt: new Date().toISOString(),
      settings: {
        systemPromptText: settings.systemPromptText,
        activePersonaId: settings.activePersonaId,
        personas,
      },
      summary: {
        outlineSummary: knowledge.outlineSummary,
        chapterCount: knowledge.chapters.length,
        chapters: knowledge.chapters.map((chapter) => ({
          chapterNo: chapter.chapterNo,
          title: chapter.title,
          summary: chapter.summary,
          updatedAt: chapter.updatedAt,
        })),
      },
    };
  }

  getSettings(projectId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);
    return this.settingsStore.get(projectId)!;
  }

  updateSettings(
    projectId: string,
    payload: { systemPromptText?: string; activePersonaId?: string | null },
    userId?: string
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const settings = this.settingsStore.get(projectId)!;
    const personas = this.personasStore.get(projectId)!;

    if (typeof payload.systemPromptText === 'string') {
      settings.systemPromptText = payload.systemPromptText;
    }

    if (payload.activePersonaId !== undefined) {
      const personaId = payload.activePersonaId;
      if (personaId === null) {
        settings.activePersonaId = null;
      } else {
        const persona = personas.find((item) => item.id === personaId);
        if (!persona) {
          throw new NotFoundException(`未找到 persona: ${personaId}`);
        }
        settings.activePersonaId = persona.id;
      }
    }

    settings.updatedAt = new Date();
    this.persistState();
    return settings;
  }

  getPersonas(projectId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);
    return this.personasStore.get(projectId)!;
  }

  createPersona(
    projectId: string,
    payload: { name: string; profile: string; state?: string },
    userId?: string
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const name = payload.name?.trim();
    const profile = payload.profile?.trim();
    if (!name || !profile) {
      throw new BadRequestException('name 与 profile 不能为空');
    }

    const now = new Date();
    const persona: PersonaRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      profile,
      state: payload.state?.trim() || '待更新',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };

    this.personasStore.get(projectId)!.push(persona);
    this.persistState();
    return persona;
  }

  publishPersona(projectId: string, personaId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const personas = this.personasStore.get(projectId)!;
    const persona = personas.find((item) => item.id === personaId);
    if (!persona) {
      throw new NotFoundException(`未找到 persona: ${personaId}`);
    }

    for (const item of personas) {
      item.status = item.id === personaId ? 'published' : 'draft';
      item.updatedAt = new Date();
    }

    const settings = this.settingsStore.get(projectId)!;
    settings.activePersonaId = personaId;
    settings.updatedAt = new Date();

    this.persistState();
    return persona;
  }

  updatePersona(
    projectId: string,
    personaId: string,
    payload: { name?: string; profile?: string; state?: string },
    userId?: string
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const personas = this.personasStore.get(projectId)!;
    const persona = personas.find((item) => item.id === personaId);
    if (!persona) {
      throw new NotFoundException(`未找到 persona: ${personaId}`);
    }

    const normalized = normalizePersonaUpdateInput(payload);
    if (normalized.name !== undefined) {
      if (!normalized.name) {
        throw new BadRequestException('name 不能为空');
      }
      persona.name = normalized.name;
    }
    if (normalized.profile !== undefined) {
      if (!normalized.profile) {
        throw new BadRequestException('profile 不能为空');
      }
      persona.profile = normalized.profile;
    }
    if (normalized.state !== undefined) {
      persona.state = normalized.state || '待更新';
    }

    persona.updatedAt = new Date();
    this.persistState();
    return persona;
  }

  deletePersona(projectId: string, personaId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const personas = this.personasStore.get(projectId)!;
    const index = personas.findIndex((item) => item.id === personaId);
    if (index < 0) {
      throw new NotFoundException(`未找到 persona: ${personaId}`);
    }

    personas.splice(index, 1);

    const settings = this.settingsStore.get(projectId)!;
    settings.activePersonaId = resolveActivePersonaIdAfterDelete(
      settings.activePersonaId,
      personaId
    );
    settings.updatedAt = new Date();

    this.persistState();
    return { id: personaId };
  }

  getKnowledge(projectId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);
    return this.knowledgeStore.get(projectId)!;
  }

  updateOutline(projectId: string, payload: { outlineSummary: string }, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const knowledge = this.knowledgeStore.get(projectId)!;
    knowledge.outlineSummary = payload.outlineSummary.trim();
    this.persistState();
    return knowledge;
  }

  async upsertChapter(
    projectId: string,
    payload: { chapterNo: number; title: string; content: string },
    userId?: string
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const knowledge = this.knowledgeStore.get(projectId)!;
    const chapterNo = Number(payload.chapterNo);

    if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
      throw new BadRequestException('chapterNo 必须为正整数');
    }

    const nextSummary = buildFallbackChapterSummary(payload.content);
    const now = new Date();
    const existing = knowledge.chapters.find((item) => item.chapterNo === chapterNo);

    let targetChapter: ChapterRecord;
    if (existing) {
      existing.title = payload.title.trim();
      existing.content = payload.content;
      existing.summary = nextSummary;
      existing.summarySource = 'fallback';
      existing.summaryUpdatedAt = now;
      existing.updatedAt = now;
      targetChapter = existing;
    } else {
      targetChapter = {
        chapterNo,
        title: payload.title.trim(),
        content: payload.content,
        summary: nextSummary,
        summarySource: 'fallback',
        summaryUpdatedAt: now,
        updatedAt: now,
      };

      knowledge.chapters.push(targetChapter);
      knowledge.chapters.sort((a, b) => a.chapterNo - b.chapterNo);
    }

    this.persistState();
    await this.updateActivePersonaStateFromChapter(projectId, chapterNo, payload.content);
    return targetChapter;
  }

  createIndexJob(projectId: string, payload: { mode?: IndexMode }, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const mode: IndexMode = payload.mode ?? 'full';
    const knowledge = this.knowledgeStore.get(projectId)!;
    const job: IndexJobRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      mode,
      status: 'processing',
      totalChapters: knowledge.chapters.length,
      processedChapters: 0,
      createdAt: new Date(),
      completedAt: null,
      errorMessage: null,
    };

    const jobs = this.indexJobsStore.get(projectId)!;
    jobs.unshift(job);

    try {
      for (const chapter of knowledge.chapters) {
        chapter.summary = buildFallbackChapterSummary(chapter.content);
        chapter.summarySource = 'fallback';
        chapter.summaryUpdatedAt = new Date();
        job.processedChapters += 1;
      }
      knowledge.indexVersion += 1;
      knowledge.lastIndexedAt = new Date();
      job.status = 'completed';
      job.completedAt = new Date();
    } catch (error) {
      job.status = 'failed';
      job.errorMessage = error instanceof Error ? error.message : '索引失败';
      job.completedAt = new Date();
    }

    this.persistState();
    return job;
  }

  getIndexJob(projectId: string, jobId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const jobs = this.indexJobsStore.get(projectId)!;
    const job = jobs.find((item) => item.id === jobId);
    if (!job) {
      throw new NotFoundException(`未找到索引任务: ${jobId}`);
    }
    return job;
  }

  async createSingleChapterSummaryJob(projectId: string, chapterNo: number, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const normalizedChapterNo = Number(chapterNo);
    if (!Number.isFinite(normalizedChapterNo) || normalizedChapterNo <= 0) {
      throw new BadRequestException('chapterNo 必须为正整数');
    }

    const knowledge = this.knowledgeStore.get(projectId)!;
    const chapter = knowledge.chapters.find((item) => item.chapterNo === normalizedChapterNo);
    if (!chapter) {
      throw new NotFoundException(`未找到章节: ${normalizedChapterNo}`);
    }

    if (!chapter.content.trim()) {
      throw new BadRequestException('章节正文为空，无法生成摘要');
    }

    const job = this.createSummaryJobRecord(
      projectId,
      'single',
      [normalizedChapterNo],
      normalizedChapterNo
    );
    return this.runSummaryJob(projectId, job, [chapter]);
  }

  async createBatchChapterSummaryJob(
    projectId: string,
    payload: { chapterNos?: number[] } = {},
    userId?: string
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const knowledge = this.knowledgeStore.get(projectId)!;
    const requestedChapterNos = Array.isArray(payload.chapterNos)
      ? payload.chapterNos
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item) && item > 0)
      : knowledge.chapters.map((item) => item.chapterNo);

    if (requestedChapterNos.length === 0) {
      throw new BadRequestException('没有可生成摘要的章节');
    }

    const chapters = requestedChapterNos
      .map((chapterNo) => knowledge.chapters.find((item) => item.chapterNo === chapterNo))
      .filter((chapter): chapter is ChapterRecord => Boolean(chapter));

    if (chapters.length === 0) {
      throw new NotFoundException('未找到可生成摘要的章节');
    }

    const job = this.createSummaryJobRecord(
      projectId,
      'batch',
      chapters.map((chapter) => chapter.chapterNo),
      null
    );
    return this.runSummaryJob(projectId, job, chapters);
  }

  getSummaryJob(projectId: string, jobId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const jobs = this.summarizeJobsStore.get(projectId)!;
    const job = jobs.find((item) => item.id === jobId);
    if (!job) {
      throw new NotFoundException(`未找到摘要任务: ${jobId}`);
    }
    return job;
  }

  async generateChapterRelationEvents(projectId: string, chapterNo: number, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const normalizedChapterNo = Number(chapterNo);
    if (!Number.isFinite(normalizedChapterNo) || normalizedChapterNo <= 0) {
      throw new BadRequestException('chapterNo 必须为正整数');
    }

    const knowledge = this.knowledgeStore.get(projectId)!;
    const chapter = knowledge.chapters.find((item) => item.chapterNo === normalizedChapterNo);
    if (!chapter) {
      throw new NotFoundException(`未找到章节: ${normalizedChapterNo}`);
    }

    if (!chapter.content.trim()) {
      throw new BadRequestException('章节正文为空，无法生成关系事件');
    }

    const protagonist = this.resolveActivePersona(projectId)?.name || '主角';
    const personas = this.personasStore.get(projectId)!;
    const personaNames = personas.map((item) => item.name).filter(Boolean);

    let extracted;
    try {
      const response = await axios.post<{ events?: unknown }>(
        `${this.getRagOrchestratorUrl()}/api/extract/relation-events`,
        {
          chapterNo: chapter.chapterNo,
          title: chapter.title,
          content: chapter.content,
          protagonist,
          personaNames,
        },
        { timeout: 120000 }
      );
      extracted = parseExtractedRelationEventCandidates(response.data?.events ?? response.data);
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : '调用关系事件抽取服务失败';
      throw new BadGatewayException(message);
    }

    const existingEvents = this.relationEventsStore
      .get(projectId)!
      .filter((event) => !event.deletedAt);
    const existingKeys = new Set(
      existingEvents.map((event) =>
        normalizeRelationEventDedupeKey({
          chapterNo: event.chapterNo,
          protagonist: event.protagonist,
          counterparty: event.counterparty,
          summary: event.summary,
        })
      )
    );

    const createdEvents: RelationEventRecord[] = [];
    let skippedCount = 0;

    for (const candidate of extracted) {
      const dedupeKey = normalizeRelationEventDedupeKey({
        chapterNo: normalizedChapterNo,
        protagonist,
        counterparty: candidate.counterparty,
        summary: candidate.summary,
      });
      if (existingKeys.has(dedupeKey)) {
        skippedCount += 1;
        continue;
      }

      const normalized = this.normalizeRelationEventInput(
        projectId,
        {
          protagonist,
          counterparty: candidate.counterparty,
          actors: candidate.actors,
          summary: candidate.summary,
          evidenceSnippet: candidate.evidenceSnippet,
          chapterNo: normalizedChapterNo,
        },
        protagonist
      );

      const now = new Date();
      const event: RelationEventRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        projectId,
        ...normalized,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      this.relationEventsStore.get(projectId)!.push(event);
      existingKeys.add(dedupeKey);
      createdEvents.push(event);
    }

    if (createdEvents.length > 0) {
      this.persistState();
    }

    return {
      chapterNo: normalizedChapterNo,
      createdCount: createdEvents.length,
      skippedCount,
      events: createdEvents,
    };
  }

  getRelationEvents(
    projectId: string,
    filters: {
      counterparty?: string;
      chapterNo?: number;
      keyword?: string;
      appearingCharacters?: string[];
    } = {},
    userId?: string
  ) {
    if (userId) {
      this.checkAccess(projectId, userId);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const events = this.relationEventsStore
      .get(projectId)!
      .filter((event) => !event.deletedAt)
      .filter((event) =>
        matchesRelationEventFilters(
          {
            protagonist: event.protagonist,
            counterparty: event.counterparty,
            summary: event.summary,
            evidenceSnippet: event.evidenceSnippet,
            chapterNo: event.chapterNo,
            actors: event.actors,
          },
          filters
        )
      )
      .sort((left, right) => {
        const leftChapter = left.chapterNo ?? 0;
        const rightChapter = right.chapterNo ?? 0;
        if (leftChapter !== rightChapter) {
          return rightChapter - leftChapter;
        }
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      });

    return events;
  }

  createRelationEvent(
    projectId: string,
    payload: {
      protagonist?: string;
      counterparty: string;
      actors?: string[];
      summary: string;
      evidenceSnippet?: string;
      chapterNo?: number | null;
    },
    userId?: string
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const normalized = this.normalizeRelationEventInput(projectId, payload);
    const now = new Date();
    const event: RelationEventRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      ...normalized,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    this.relationEventsStore.get(projectId)!.push(event);
    this.persistState();
    return event;
  }

  updateRelationEvent(
    projectId: string,
    eventId: string,
    payload: {
      protagonist?: string;
      counterparty: string;
      actors?: string[];
      summary: string;
      evidenceSnippet?: string;
      chapterNo?: number | null;
    },
    userId?: string
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const events = this.relationEventsStore.get(projectId)!;
    const event = events.find((item) => item.id === eventId && !item.deletedAt);
    if (!event) {
      throw new NotFoundException(`未找到关系事件: ${eventId}`);
    }

    const normalized = this.normalizeRelationEventInput(projectId, payload, event.protagonist);
    Object.assign(event, normalized, { updatedAt: new Date() });
    this.persistState();
    return event;
  }

  deleteRelationEvent(projectId: string, eventId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const events = this.relationEventsStore.get(projectId)!;
    const event = events.find((item) => item.id === eventId && !item.deletedAt);
    if (!event) {
      throw new NotFoundException(`未找到关系事件: ${eventId}`);
    }

    event.deletedAt = new Date();
    event.updatedAt = new Date();
    this.persistState();
    return { id: event.id };
  }

  async writeChapter(projectId: string, payload: Partial<WriteTaskInput>, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const knowledge = this.knowledgeStore.get(projectId)!;
    const settings = this.settingsStore.get(projectId)!;
    const personas = this.personasStore.get(projectId)!;
    const chapterNo = Number(payload.chapterNo || 0);

    if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
      throw new BadRequestException('chapterNo 必须为正整数');
    }

    const activePersona =
      personas.find((item) => item.id === settings.activePersonaId) ||
      personas.find((item) => item.status === 'published') ||
      null;

    const latestChapters = knowledge.chapters.slice(-3);

    const citations = [
      ...(knowledge.outlineSummary
        ? [
            {
              sourceType: 'outline',
              sourceId: 'outline-summary',
              snippet: knowledge.outlineSummary.slice(0, 120),
            },
          ]
        : []),
      ...latestChapters.map((chapter) => ({
        sourceType: 'chapter-summary',
        sourceId: `chapter-${chapter.chapterNo}`,
        snippet: chapter.summary,
      })),
    ];

    const consistencyNotes: Array<{ level: 'info' | 'warning'; message: string }> = [];
    if (!activePersona) {
      consistencyNotes.push({
        level: 'warning',
        message: '当前项目未发布人物设定，将使用系统默认叙事风格。',
      });
    } else {
      consistencyNotes.push({
        level: 'info',
        message: `已应用人物设定：${activePersona.name}。`,
      });
    }

    if (!knowledge.outlineSummary) {
      consistencyNotes.push({
        level: 'warning',
        message: '尚未填写大纲总结，连续性提示能力会受影响。',
      });
    }

    const usedRelationEvents = this.resolveSelectedRelationEvents(
      projectId,
      payload.selectedEventIds
    );

    const draftText = await this.generateDraftThroughOrchestrator(
      projectId,
      chapterNo,
      payload,
      settings,
      personas,
      knowledge,
      usedRelationEvents
    );

    const autoUpdates = await this.applyPostWriteUpdates(
      projectId,
      chapterNo,
      payload.goal,
      draftText
    );

    return {
      draftText,
      reasoningBrief:
        '已按项目维度拼接 systemPrompt + persona + outline + recent chapters 生成草稿。',
      citations,
      consistencyNotes,
      usedRelationEvents,
      context: {
        projectId,
        chapterNo,
        usedPersonaId: activePersona?.id || null,
        outlineUsed: Boolean(knowledge.outlineSummary),
        recentChapterCount: latestChapters.length,
        targetWords:
          Number.isFinite(Number(payload.targetWords)) && Number(payload.targetWords) > 0
            ? Number(payload.targetWords)
            : null,
      },
      autoUpdates,
    };
  }

  async optimizeChapterPlanStream(
    projectId: string,
    chapterNo: number,
    payload: {
      instruction?: string;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
    },
    userId: string | undefined,
    callbacks: {
      onStart: (event: {
        traceId: string;
        chapterNo: number;
        planId: string;
        basis: {
          usedPersonaId: string | null;
          outlineUsed: boolean;
          chapterSummaryCount: number;
          usedRelationEvents: UsedRelationEventRecord[];
        };
      }) => void;
      onContent: (text: string) => void;
      onEnd: (event: {
        traceId: string;
        planText: string;
        planId: string;
        basis: {
          usedPersonaId: string | null;
          outlineUsed: boolean;
          chapterSummaryCount: number;
          usedRelationEvents: UsedRelationEventRecord[];
        };
      }) => void;
      onError: (message: string) => void;
    }
  ): Promise<void> {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const normalizedChapterNo = this.normalizeChapterNo(chapterNo);
    const knowledge = this.knowledgeStore.get(projectId)!;
    const chapter = knowledge.chapters.find((item) => item.chapterNo === normalizedChapterNo);
    if (!chapter) {
      throw new NotFoundException(`未找到第${normalizedChapterNo}章`);
    }

    if (!chapter.content?.trim()) {
      throw new BadRequestException(`第${normalizedChapterNo}章正文为空，无法优化`);
    }

    const instruction = normalizeInstruction(payload.instruction);
    assertInstruction(instruction);

    const settings = this.settingsStore.get(projectId)!;
    const personas = this.personasStore.get(projectId)!;
    const usedRelationEvents = this.resolveSelectedRelationEvents(
      projectId,
      payload.selectedEventIds
    );

    await this.syncProjectContextToOrchestrator(
      projectId,
      settings,
      personas,
      knowledge,
      usedRelationEvents
    );

    const userPrompt = buildPlanUserPrompt({
      chapter: {
        chapterNo: chapter.chapterNo,
        title: chapter.title,
        content: chapter.content,
        updatedAt: chapter.updatedAt,
      },
      instruction,
      appearingCharacters: payload.appearingCharacters,
      selectedRelationEvents: usedRelationEvents.map(
        (event): ChapterOptimizeUsedRelationEvent => ({
          id: event.id,
          protagonist: event.protagonist,
          counterparty: event.counterparty,
          summary: event.summary,
          evidenceSnippet: event.evidenceSnippet,
          chapterNo: event.chapterNo,
        })
      ),
    });

    const planId = makeOptimizationId('plan');

    const activePersona =
      personas.find((item) => item.id === settings.activePersonaId) ||
      personas.find((item) => item.status === 'published') ||
      null;

    const basis = {
      usedPersonaId: activePersona?.id || null,
      outlineUsed: Boolean(knowledge.outlineSummary),
      chapterSummaryCount: knowledge.chapters.filter((item) => item.summary).length,
      usedRelationEvents,
    };

    let response;
    try {
      response = await axios.post(
        `${this.getRagOrchestratorUrl()}/api/generate`,
        {
          projectId,
          prompt: userPrompt,
          useSSE: true,
          systemPromptOverride: CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT,
          templateKey: CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
          context: {
            task: 'chapter.optimize.plan',
            chapterNo: normalizedChapterNo,
            planId,
            inputChapterChars: chapter.content.length,
            inputContextChars: userPrompt.length,
          },
        },
        { responseType: 'stream' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '调用优化方案生成失败';
      throw new BadGatewayException(message);
    }

    let accumulated = '';
    let traceId = '';
    let sawTerminalSse = false;

    await new Promise<void>((resolveStream, rejectStream) => {
      const stream = response.data as NodeJS.ReadableStream;
      let buffer = '';

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        const segments = buffer.split('\n\n');
        buffer = segments.pop() || '';

        for (const segment of segments) {
          const trimmedSegment = segment.trim();
          if (!trimmedSegment.startsWith('data:')) {
            continue;
          }
          const dataPart = trimmedSegment.replace(/^data:\s*/, '');
          if (!dataPart) {
            continue;
          }
          let event: { event?: string; data?: string; traceId?: string };
          try {
            event = JSON.parse(dataPart);
          } catch {
            continue;
          }

          switch (event.event) {
            case 'start': {
              traceId = typeof event.traceId === 'string' ? event.traceId : '';
              callbacks.onStart({
                traceId,
                chapterNo: normalizedChapterNo,
                planId,
                basis,
              });
              break;
            }
            case 'content': {
              const raw = typeof event.data === 'string' ? event.data : '';
              const piece = raw.replace(/\\n/g, '\n');
              accumulated += piece;
              callbacks.onContent(piece);
              break;
            }
            case 'end': {
              sawTerminalSse = true;
              traceId = typeof event.traceId === 'string' ? event.traceId : traceId;
              try {
                const planText = accumulated.trim();
                assertPlanText(planText);
                callbacks.onEnd({
                  traceId,
                  planText,
                  planId,
                  basis,
                });
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : '优化方案生成失败：方案文本无效';
                callbacks.onError(message);
              }
              break;
            }
            case 'error': {
              sawTerminalSse = true;
              const message = typeof event.data === 'string' ? event.data : '优化方案生成失败';
              callbacks.onError(message);
              break;
            }
          }
        }
      });

      stream.on('end', () => {
        if (!sawTerminalSse) {
          const fallback = accumulated.trim();
          if (fallback) {
            try {
              assertPlanText(fallback);
              callbacks.onEnd({
                traceId,
                planText: fallback,
                planId,
                basis,
              });
            } catch {
              callbacks.onError('优化方案生成失败：未收到完整响应');
            }
          } else {
            callbacks.onError('优化方案生成失败：未收到完整响应');
          }
        }
        resolveStream();
      });
      stream.on('error', (error: unknown) => rejectStream(error));
    });
  }

  async optimizeChapterDraftStream(
    projectId: string,
    chapterNo: number,
    payload: {
      instruction?: string;
      planText?: string;
      planId?: string;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
    },
    userId: string | undefined,
    callbacks: {
      onStart: (event: { traceId: string; chapterNo: number }) => void;
      onContent: (text: string) => void;
      onEnd: (event: { traceId: string }) => void;
      onError: (message: string) => void;
    }
  ): Promise<void> {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const normalizedChapterNo = this.normalizeChapterNo(chapterNo);
    const knowledge = this.knowledgeStore.get(projectId)!;
    const chapter = knowledge.chapters.find((item) => item.chapterNo === normalizedChapterNo);
    if (!chapter) {
      throw new NotFoundException(`未找到第${normalizedChapterNo}章`);
    }

    if (!chapter.content?.trim()) {
      throw new BadRequestException(`第${normalizedChapterNo}章正文为空，无法优化`);
    }

    const instruction = normalizeInstruction(payload.instruction);
    assertInstruction(instruction);

    const planText = typeof payload.planText === 'string' ? payload.planText.trim() : '';
    assertPlanText(planText);

    const settings = this.settingsStore.get(projectId)!;
    const personas = this.personasStore.get(projectId)!;
    const usedRelationEvents = this.resolveSelectedRelationEvents(
      projectId,
      payload.selectedEventIds
    );

    await this.syncProjectContextToOrchestrator(
      projectId,
      settings,
      personas,
      knowledge,
      usedRelationEvents
    );

    const userPrompt = buildDraftUserPrompt({
      chapter: {
        chapterNo: chapter.chapterNo,
        title: chapter.title,
        content: chapter.content,
        updatedAt: chapter.updatedAt,
      },
      instruction,
      planText,
      appearingCharacters: payload.appearingCharacters,
      selectedRelationEvents: usedRelationEvents.map(
        (event): ChapterOptimizeUsedRelationEvent => ({
          id: event.id,
          protagonist: event.protagonist,
          counterparty: event.counterparty,
          summary: event.summary,
          evidenceSnippet: event.evidenceSnippet,
          chapterNo: event.chapterNo,
        })
      ),
    });

    let response;
    try {
      response = await axios.post(
        `${this.getRagOrchestratorUrl()}/api/generate`,
        {
          projectId,
          prompt: userPrompt,
          useSSE: true,
          systemPromptOverride: CHAPTER_OPTIMIZE_DRAFT_SYSTEM_PROMPT,
          templateKey: CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
          context: {
            task: 'chapter.optimize.draft',
            chapterNo: normalizedChapterNo,
            planId: payload.planId || null,
            inputChapterChars: chapter.content.length,
            inputContextChars: userPrompt.length,
          },
        },
        { responseType: 'stream' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '调用优化正文生成失败';
      throw new BadGatewayException(message);
    }

    let firstStartEmitted = false;
    let buffer = '';

    await new Promise<void>((resolveStream, rejectStream) => {
      const stream = response.data as NodeJS.ReadableStream;

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        const segments = buffer.split('\n\n');
        buffer = segments.pop() || '';

        for (const segment of segments) {
          const trimmedSegment = segment.trim();
          if (!trimmedSegment.startsWith('data:')) {
            continue;
          }
          const dataPart = trimmedSegment.replace(/^data:\s*/, '');
          if (!dataPart) {
            continue;
          }
          let event: { event?: string; data?: string; traceId?: string };
          try {
            event = JSON.parse(dataPart);
          } catch {
            continue;
          }

          switch (event.event) {
            case 'start': {
              const traceId = typeof event.traceId === 'string' ? event.traceId : '';
              if (!firstStartEmitted) {
                callbacks.onStart({ traceId, chapterNo: normalizedChapterNo });
                firstStartEmitted = true;
              }
              break;
            }
            case 'content': {
              const raw = typeof event.data === 'string' ? event.data : '';
              callbacks.onContent(raw.replace(/\\n/g, '\n'));
              break;
            }
            case 'end': {
              const traceId = typeof event.traceId === 'string' ? event.traceId : '';
              callbacks.onEnd({ traceId });
              break;
            }
            case 'error': {
              const message = typeof event.data === 'string' ? event.data : '优化正文生成失败';
              callbacks.onError(message);
              break;
            }
          }
        }
      });

      stream.on('end', () => resolveStream());
      stream.on('error', (error: unknown) => rejectStream(error));
    });
  }

  async applyChapterOptimization(
    projectId: string,
    chapterNo: number,
    payload: { draftText?: string; expectedChapterUpdatedAt?: string; planId?: string },
    userId?: string
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const normalizedChapterNo = this.normalizeChapterNo(chapterNo);
    const knowledge = this.knowledgeStore.get(projectId)!;
    const chapter = knowledge.chapters.find((item) => item.chapterNo === normalizedChapterNo);
    if (!chapter) {
      throw new NotFoundException(`未找到第${normalizedChapterNo}章`);
    }

    const draftText = typeof payload.draftText === 'string' ? payload.draftText.trim() : '';
    assertDraftText(draftText);

    const expected = parseExpectedUpdatedAt(payload.expectedChapterUpdatedAt);
    try {
      ensureChapterVersionMatches(normalizedChapterNo, expected, chapter.updatedAt);
    } catch (error) {
      if (error instanceof ChapterVersionConflictError) {
        throw new BadRequestException({
          code: 1307,
          msg: '章节正文已被其他操作更新，请重新拉取后再发起优化',
          chapterNo: normalizedChapterNo,
          expected: error.expected,
          actual: error.actual,
        });
      }
      throw error;
    }

    chapter.content = draftText;
    chapter.updatedAt = new Date();
    knowledge.indexVersion += 1;
    this.persistState();

    return {
      chapter: {
        chapterNo: chapter.chapterNo,
        title: chapter.title,
        content: chapter.content,
        summary: chapter.summary,
        summarySource: chapter.summarySource,
        summaryUpdatedAt: chapter.summaryUpdatedAt,
        updatedAt: chapter.updatedAt,
      },
    };
  }

  private normalizeChapterNo(chapterNo: number) {
    const normalized = Number(chapterNo);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      throw new BadRequestException('chapterNo 必须为正整数');
    }
    return normalized;
  }

  addMember(projectId: string, userId: string, role: 'editor' | 'viewer') {
    this.checkAccess(projectId, userId, ['owner']);

    const existing = this.members.find((m) => m.projectId === projectId && m.userId === userId);
    if (existing) {
      existing.role = role;
      existing.createdAt = new Date();
    } else {
      this.members.push({
        userId,
        projectId,
        role,
        createdAt: new Date(),
      });
    }

    this.persistState();
    return this.members.filter((m) => m.projectId === projectId);
  }

  removeMember(projectId: string, userId: string, currentUserId: string) {
    this.checkAccess(projectId, currentUserId, ['owner']);

    const index = this.members.findIndex((m) => m.projectId === projectId && m.userId === userId);
    if (index !== -1) {
      this.members.splice(index, 1);
      this.persistState();
    }

    return this.members.filter((m) => m.projectId === projectId);
  }

  getMembers(projectId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId);
    }
    return this.members.filter((m) => m.projectId === projectId);
  }

  checkAccess(projectId: string, userId: string, allowedRoles?: ('owner' | 'editor' | 'viewer')[]) {
    this.assertProjectId(projectId);
    const member = this.members.find((m) => m.projectId === projectId && m.userId === userId);
    if (!member) {
      throw new NotFoundException(`用户无权访问项目: ${projectId}`);
    }

    if (allowedRoles && !allowedRoles.includes(member.role)) {
      throw new NotFoundException(`用户权限不足，需要: ${allowedRoles.join('或')}`);
    }

    return member;
  }

  private getLatestIndexJob(projectId: string) {
    this.ensureProjectState(projectId);
    return this.indexJobsStore.get(projectId)![0] || null;
  }

  private getLatestSummaryJob(projectId: string) {
    this.ensureProjectState(projectId);
    return this.summarizeJobsStore.get(projectId)![0] || null;
  }

  private persistState() {
    const payload: PersistedProjectState = {
      projects: this.projects.map((project) => ({
        ...project,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      })),
      members: this.members.map((member) => ({
        ...member,
        createdAt: member.createdAt.toISOString(),
      })),
      settings: {},
      personas: {},
      knowledge: {},
      indexJobs: {},
      summarizeJobs: {},
      relationEvents: {},
    };

    for (const [projectId, settings] of this.settingsStore.entries()) {
      payload.settings[projectId] = {
        ...settings,
        updatedAt: settings.updatedAt.toISOString(),
      };
    }

    for (const [projectId, personas] of this.personasStore.entries()) {
      payload.personas[projectId] = personas.map((persona) => ({
        ...persona,
        createdAt: persona.createdAt.toISOString(),
        updatedAt: persona.updatedAt.toISOString(),
      }));
    }

    for (const [projectId, knowledge] of this.knowledgeStore.entries()) {
      payload.knowledge[projectId] = {
        outlineSummary: knowledge.outlineSummary,
        chapters: knowledge.chapters.map((chapter) => ({
          ...chapter,
          updatedAt: chapter.updatedAt.toISOString(),
          summaryUpdatedAt: chapter.summaryUpdatedAt
            ? chapter.summaryUpdatedAt.toISOString()
            : undefined,
        })),
        indexVersion: knowledge.indexVersion,
        lastIndexedAt: knowledge.lastIndexedAt ? knowledge.lastIndexedAt.toISOString() : null,
      };
    }

    for (const [projectId, jobs] of this.indexJobsStore.entries()) {
      payload.indexJobs[projectId] = jobs.map((job) => ({
        ...job,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      }));
    }

    for (const [projectId, jobs] of this.summarizeJobsStore.entries()) {
      payload.summarizeJobs[projectId] = jobs.map((job) => ({
        ...job,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      }));
    }

    for (const [projectId, events] of this.relationEventsStore.entries()) {
      payload.relationEvents[projectId] = events.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
        deletedAt: event.deletedAt ? event.deletedAt.toISOString() : null,
      }));
    }

    const targetDir = dirname(this.storagePath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private restoreStateFromDisk(): {
    projects: ProjectRecord[];
    members: ProjectMember[];
    settings: Record<string, ProjectSettings>;
    personas: Record<string, PersonaRecord[]>;
    knowledge: Record<string, KnowledgeRecord>;
    indexJobs: Record<string, IndexJobRecord[]>;
    summarizeJobs: Record<string, SummaryJobRecord[]>;
    relationEvents: Record<string, RelationEventRecord[]>;
  } | null {
    if (!existsSync(this.storagePath)) {
      return null;
    }

    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedProjectState;
      return {
        projects: (parsed.projects || []).map((project) => ({
          ...project,
          createdAt: new Date(project.createdAt),
          updatedAt: new Date(project.updatedAt),
        })),
        members: (parsed.members || []).map((member) => ({
          ...member,
          createdAt: new Date(member.createdAt),
        })),
        settings: Object.fromEntries(
          Object.entries(parsed.settings || {}).map(([projectId, value]) => [
            projectId,
            {
              systemPromptText: value.systemPromptText,
              activePersonaId: value.activePersonaId,
              updatedAt: new Date(value.updatedAt),
            },
          ])
        ),
        personas: Object.fromEntries(
          Object.entries(parsed.personas || {}).map(([projectId, personas]) => [
            projectId,
            (personas || []).map((persona) => ({
              ...persona,
              state:
                typeof persona.state === 'string' && persona.state.trim()
                  ? persona.state
                  : '待更新',
              createdAt: new Date(persona.createdAt),
              updatedAt: new Date(persona.updatedAt),
            })),
          ])
        ),
        knowledge: Object.fromEntries(
          Object.entries(parsed.knowledge || {}).map(([projectId, knowledge]) => [
            projectId,
            {
              outlineSummary: knowledge.outlineSummary,
              chapters: (knowledge.chapters || []).map((chapter) => ({
                ...chapter,
                updatedAt: new Date(chapter.updatedAt),
                summaryUpdatedAt: chapter.summaryUpdatedAt
                  ? new Date(chapter.summaryUpdatedAt)
                  : undefined,
              })),
              indexVersion: knowledge.indexVersion,
              lastIndexedAt: knowledge.lastIndexedAt ? new Date(knowledge.lastIndexedAt) : null,
            },
          ])
        ),
        indexJobs: Object.fromEntries(
          Object.entries(parsed.indexJobs || {}).map(([projectId, jobs]) => [
            projectId,
            (jobs || []).map((job) => ({
              ...job,
              createdAt: new Date(job.createdAt),
              completedAt: job.completedAt ? new Date(job.completedAt) : null,
            })),
          ])
        ),
        summarizeJobs: Object.fromEntries(
          Object.entries(parsed.summarizeJobs || {}).map(([projectId, jobs]) => [
            projectId,
            (jobs || []).map((job) => ({
              ...job,
              createdAt: new Date(job.createdAt),
              completedAt: job.completedAt ? new Date(job.completedAt) : null,
            })),
          ])
        ),
        relationEvents: Object.fromEntries(
          Object.entries(parsed.relationEvents || {}).map(([projectId, events]) => [
            projectId,
            (events || []).map((event) => {
              const protagonist = event.protagonist?.trim() || '主角';
              const counterparty = event.counterparty?.trim() || '';
              return {
                id: event.id,
                projectId: event.projectId,
                protagonist,
                counterparty,
                actors: resolveRelationEventActors(event.actors, protagonist, counterparty),
                summary: event.summary,
                evidenceSnippet: event.evidenceSnippet,
                chapterNo:
                  typeof event.chapterNo === 'number' && Number.isFinite(event.chapterNo)
                    ? event.chapterNo
                    : null,
                createdAt: new Date(event.createdAt),
                updatedAt: new Date(event.updatedAt),
                deletedAt: event.deletedAt ? new Date(event.deletedAt) : null,
              };
            }),
          ])
        ),
      };
    } catch {
      return null;
    }
  }

  private hydrateMap<T>(target: Map<string, T>, source: Record<string, T>) {
    for (const [key, value] of Object.entries(source)) {
      target.set(key, value);
    }
  }

  private resolveActivePersona(projectId: string): PersonaRecord | null {
    const personas = this.personasStore.get(projectId)!;
    const settings = this.settingsStore.get(projectId)!;
    return (
      personas.find((item) => item.id === settings.activePersonaId) ||
      personas.find((item) => item.status === 'published') ||
      null
    );
  }

  private async updateActivePersonaStateFromChapter(
    projectId: string,
    chapterNo: number,
    chapterContent: string
  ) {
    const activePersona = this.resolveActivePersona(projectId);
    if (!activePersona) {
      return;
    }

    const nextState = await this.generatePersonaState({
      projectId,
      chapterNo,
      chapterContent,
      personaName: activePersona.name,
      personaProfile: activePersona.profile,
      currentState: activePersona.state,
    });

    if (!nextState || nextState === activePersona.state) {
      return;
    }

    activePersona.state = nextState;
    activePersona.updatedAt = new Date();
    this.persistState();
  }

  private async generatePersonaState(input: {
    projectId: string;
    chapterNo: number;
    chapterContent: string;
    personaName: string;
    personaProfile: string;
    currentState: string;
  }) {
    const fallbackState = buildFallbackPersonaState(input.chapterNo, input.chapterContent);
    const prompt = [
      `你是小说角色状态提取器。`,
      `请基于人物设定与第${input.chapterNo}章正文，输出该人物的"当前状态"（一句中文，<=60字）。`,
      `禁止输出解释、禁止编号、禁止Markdown。`,
      '',
      `人物名：${input.personaName}`,
      `人物设定：${input.personaProfile}`,
      `历史状态：${input.currentState || '暂无'}`,
      '',
      `第${input.chapterNo}章正文：`,
      trimForPrompt(input.chapterContent, 2200),
      '',
      '只输出状态短句。',
    ].join('\n');

    try {
      const { data } = await axios.post(
        `${this.getRagOrchestratorUrl()}/api/generate`,
        {
          projectId: input.projectId,
          prompt,
          useSSE: false,
          context: { task: { chapterNo: input.chapterNo, purpose: 'persona-state-update' } },
        },
        { timeout: 90000 }
      );

      const generated = normalizePersonaStateOutput(String(data?.content || ''));

      return generated || fallbackState;
    } catch {
      return fallbackState;
    }
  }

  private async applyPostWriteUpdates(
    projectId: string,
    chapterNo: number,
    goal: string | undefined,
    draftText: string
  ) {
    const chapterTitle = goal?.trim()
      ? `第${chapterNo}章：${goal.trim().slice(0, 24)}`
      : `第${chapterNo}章：自动续写草稿`;

    await this.upsertChapter(projectId, {
      chapterNo,
      title: chapterTitle,
      content: draftText,
    });

    const knowledge = this.knowledgeStore.get(projectId)!;
    const updateLine = `第${chapterNo}章进展：${goal?.trim() || '完成续写并写入章节草稿'}`;

    let outlineUpdated = false;
    if (!knowledge.outlineSummary.includes(updateLine)) {
      knowledge.outlineSummary = knowledge.outlineSummary
        ? `${knowledge.outlineSummary}\n${updateLine}`
        : updateLine;
      outlineUpdated = true;
    }

    if (outlineUpdated) {
      this.persistState();
    }

    return {
      chapterUpdated: true,
      outlineUpdated,
      personaUpdated: false,
      updateLine,
    };
  }

  private createSummaryJobRecord(
    projectId: string,
    scope: SummaryJobScope,
    chapterNos: number[],
    chapterNo: number | null
  ) {
    const job: SummaryJobRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      scope,
      chapterNo,
      status: 'processing',
      totalChapters: chapterNos.length,
      processedChapters: 0,
      chapterNos,
      summaries: [],
      createdAt: new Date(),
      completedAt: null,
      errorMessage: null,
    };

    const jobs = this.summarizeJobsStore.get(projectId)!;
    jobs.unshift(job);
    this.persistState();
    return job;
  }

  private async runSummaryJob(projectId: string, job: SummaryJobRecord, chapters: ChapterRecord[]) {
    const knowledge = this.knowledgeStore.get(projectId)!;

    try {
      for (const chapter of chapters) {
        const result = await this.summarizeChapterContent(chapter);
        chapter.summary = result.summary;
        chapter.summarySource = result.summarySource;
        chapter.summaryUpdatedAt = new Date();
        chapter.updatedAt = new Date();
        job.summaries.push({
          chapterNo: chapter.chapterNo,
          summary: result.summary,
          summarySource: result.summarySource,
        });
        job.processedChapters += 1;
      }

      knowledge.indexVersion += 1;
      knowledge.lastIndexedAt = new Date();
      job.status = 'completed';
      job.completedAt = new Date();
    } catch (error) {
      job.status = 'failed';
      job.errorMessage = error instanceof Error ? error.message : '摘要生成失败';
      job.completedAt = new Date();
    }

    this.persistState();
    return job;
  }

  private async summarizeChapterContent(chapter: ChapterRecord): Promise<ChapterSummaryResult> {
    try {
      const response = await axios.post<{ summary?: string }>(
        `${this.getRagOrchestratorUrl()}/api/summarize`,
        {
          chapterNo: chapter.chapterNo,
          title: chapter.title,
          content: chapter.content,
        },
        { timeout: 90000 }
      );

      const summary = String(response.data?.summary || '').trim();
      if (summary) {
        return {
          chapterNo: chapter.chapterNo,
          summary,
          summarySource: 'llm',
        };
      }
    } catch {
      // fall through to rule-based summary
    }

    return {
      chapterNo: chapter.chapterNo,
      summary: buildFallbackChapterSummary(chapter.content),
      summarySource: 'fallback',
    };
  }

  private ensureProjectState(projectId: string) {
    if (!this.settingsStore.has(projectId)) {
      this.settingsStore.set(projectId, {
        systemPromptText: '你是一位专业的小说写作助手，请保持设定一致与剧情连贯。',
        activePersonaId: null,
        updatedAt: new Date(),
      });
    }

    if (!this.personasStore.has(projectId)) {
      this.personasStore.set(projectId, []);
    }

    if (!this.knowledgeStore.has(projectId)) {
      this.knowledgeStore.set(projectId, {
        outlineSummary: '',
        chapters: [],
        indexVersion: 0,
        lastIndexedAt: null,
      });
    }

    if (!this.indexJobsStore.has(projectId)) {
      this.indexJobsStore.set(projectId, []);
    }

    if (!this.summarizeJobsStore.has(projectId)) {
      this.summarizeJobsStore.set(projectId, []);
    }

    if (!this.relationEventsStore.has(projectId)) {
      this.relationEventsStore.set(projectId, []);
    }
  }

  private getProjectOrThrow(projectId: string) {
    this.assertProjectId(projectId);
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new NotFoundException(`未找到项目: ${projectId}`);
    }
    return project;
  }

  private getRagOrchestratorUrl() {
    return process.env.RAG_ORCHESTRATOR_URL || 'http://localhost:3001';
  }

  private async syncProjectContextToOrchestrator(
    projectId: string,
    settings: ProjectSettings,
    personas: PersonaRecord[],
    knowledge: KnowledgeRecord,
    usedRelationEvents: UsedRelationEventRecord[] = []
  ) {
    const activePersona =
      personas.find((item) => item.id === settings.activePersonaId) ||
      personas.find((item) => item.status === 'published') ||
      null;

    await axios.post(`${this.getRagOrchestratorUrl()}/api/projects/${projectId}/context`, {
      systemPromptText: settings.systemPromptText,
      personaProfile: activePersona
        ? `${activePersona.name}\n人物设定：${activePersona.profile}\n当前状态：${activePersona.state}`
        : '未配置人物设定',
      outlineSummary: knowledge.outlineSummary,
      chapters: knowledge.chapters.map((chapter) => ({
        chapterNo: chapter.chapterNo,
        title: chapter.title,
        summary: chapter.summary || chapter.content.slice(0, 160),
      })),
      selectedRelationMemory: buildRelationMemoryBlock(usedRelationEvents),
      usedRelationEvents,
    });
  }

  private async generateDraftThroughOrchestrator(
    projectId: string,
    chapterNo: number,
    payload: Partial<WriteTaskInput>,
    settings: ProjectSettings,
    personas: PersonaRecord[],
    knowledge: KnowledgeRecord,
    usedRelationEvents: UsedRelationEventRecord[] = []
  ) {
    await this.syncProjectContextToOrchestrator(
      projectId,
      settings,
      personas,
      knowledge,
      usedRelationEvents
    );

    const goal = payload.goal?.trim() || '推进主线并保持人物一致性';
    const pov = payload.pov?.trim() || '第三人称';
    const mustInclude = payload.mustInclude ?? [];
    const avoid = payload.avoid ?? [];
    const prompt = [
      `请撰写第${chapterNo}章小说正文。`,
      `写作目标：${goal}`,
      `叙事视角：${pov}`,
      mustInclude.length > 0 ? `必须包含：${mustInclude.join('；')}` : '',
      avoid.length > 0 ? `避免内容：${avoid.join('；')}` : '',
      buildTargetWordsInstruction(payload.targetWords),
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const { data } = await axios.post(`${this.getRagOrchestratorUrl()}/api/generate`, {
        projectId,
        prompt,
        useSSE: false,
        context: { task: payload },
      });

      if (!data?.content || typeof data.content !== 'string') {
        throw new BadGatewayException('生成服务未返回章节正文');
      }

      return data.content;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : '调用生成服务失败';
      throw new BadGatewayException(message);
    }
  }

  private assertProjectId(projectId: string) {
    const normalizedId = projectId.trim().toLowerCase();
    if (!normalizedId) {
      throw new BadRequestException('projectId 不能为空');
    }

    if (this.reservedProjectRouteNames.has(normalizedId)) {
      throw new BadRequestException(
        `projectId 无效: ${projectId}。该值是前端页面路由名，不是项目 ID。请先调用 GET /api/projects 获取真实项目 ID。`
      );
    }
  }

  private normalizeRelationEventInput(
    projectId: string,
    payload: {
      protagonist?: string;
      counterparty: string;
      actors?: string[];
      summary: string;
      evidenceSnippet?: string;
      chapterNo?: number | null;
    },
    fallbackProtagonist?: string
  ) {
    const protagonist =
      payload.protagonist?.trim() ||
      fallbackProtagonist ||
      this.resolveActivePersona(projectId)?.name ||
      '主角';
    const counterparty = payload.counterparty?.trim();
    const summary = payload.summary?.trim();
    const chapterNo =
      payload.chapterNo === null || payload.chapterNo === undefined
        ? null
        : Number(payload.chapterNo);

    if (!counterparty) {
      throw new BadRequestException('counterparty 不能为空');
    }
    if (!summary) {
      throw new BadRequestException('summary 不能为空');
    }
    if (summary.length > RELATION_EVENT_SUMMARY_MAX_LENGTH) {
      throw new BadRequestException(`summary 不能超过 ${RELATION_EVENT_SUMMARY_MAX_LENGTH} 字`);
    }
    if (chapterNo !== null && (!Number.isFinite(chapterNo) || chapterNo <= 0)) {
      throw new BadRequestException('chapterNo 必须为正整数');
    }

    const actors = resolveRelationEventActors(payload.actors, protagonist, counterparty);

    return {
      protagonist,
      counterparty,
      actors,
      summary,
      evidenceSnippet: payload.evidenceSnippet?.trim() || undefined,
      chapterNo,
    };
  }

  private resolveSelectedRelationEvents(
    projectId: string,
    selectedEventIds?: string[]
  ): UsedRelationEventRecord[] {
    const normalizedIds = normalizeSelectedEventIds(selectedEventIds);
    if (normalizedIds.length === 0) {
      return [];
    }
    if (normalizedIds.length > RELATION_EVENT_SELECTED_MAX_COUNT) {
      throw new BadRequestException(
        `selectedEventIds 不能超过 ${RELATION_EVENT_SELECTED_MAX_COUNT} 条`
      );
    }

    this.ensureProjectState(projectId);
    const events = this.relationEventsStore.get(projectId)!;
    const resolved: UsedRelationEventRecord[] = [];

    for (const eventId of normalizedIds) {
      const event = events.find((item) => item.id === eventId && !item.deletedAt);
      if (!event) {
        throw new BadRequestException(`未找到可用关系事件: ${eventId}`);
      }

      resolved.push({
        id: event.id,
        protagonist: event.protagonist,
        counterparty: event.counterparty,
        summary: event.summary,
        evidenceSnippet: event.evidenceSnippet,
        chapterNo: event.chapterNo,
      });
    }

    return resolved;
  }
}
