import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import axios from 'axios';
import {
  mergeContentSafetyRules,
  sanitizeProjectContentSafetyRules,
  validateProjectContentSafetyRulesInput,
  type ProjectContentSafetyRule,
} from '@aether-quill/config';
import {
  runContentSafetyPipeline,
  formatContentSafetyBlockMessage,
  toContentSafetyScanPayload,
  type ContentSafetyProgressStage,
} from './content-safety.pipeline';
import {
  buildFallbackChapterSummary,
  resolveChapterSummaryOnContentWrite,
  resolveChapterSummaryOnOptimizeApply,
  type ChapterSummarySource,
} from './chapter-summary.util';
import {
  isRetryableChapterSummaryIndexError,
  resolveChapterSummaryIndexDelayMs,
  resolveChapterSummaryIndexMaxRetries,
  resolveChapterSummaryIndexRetryBaseMs,
  resolveChapterSummaryIndexRetryDelayMs,
  sleep,
} from './chapter-summary-index.util';
import {
  buildFallbackPersonaState,
  clampPersonaStateText,
  parseChapterPersonaStatesFromModelContent,
  resolvePersonaStateText,
  trimForPrompt,
} from './persona-state.util';
import {
  buildSummaryLineFromSnapshot,
  normalizePersonaSnapshot,
  resolvePersonaSnapshotAsOfChapter,
  snapshotFromLegacyState,
  tryParsePersonaSnapshotFromText,
  upsertPersonaChapterState,
  type PersonaChapterStateRecord,
  type PersonaSnapshot,
} from './persona-snapshot.util';
import {
  normalizePersonaUpdateInput,
  resolveActivePersonaIdAfterDelete,
} from './persona-management.util';
import {
  addChapterAppearance,
  buildAbsentPersonaConsistencyNotes,
  clearPersonaFromRelationEvents,
  computeLastAppearedChapterNo,
  createEmptyPersonaGraphFields,
  detectAbsentPersonaWarnings,
  findSimilarPersonaNameConflicts,
  IMPORT_AUTO_PERSONA_MIN_CHAPTER_COUNT,
  linkRelationEventToPersonas,
  normalizePersonaGraphFields,
  personaAppearsInChapterContent,
  rebuildPersonaAppearancesFromChapters,
  relinkAllRelationEvents,
  removeChapterFromAppearances,
  renumberAppearancesAfterDelete,
  renumberAppearancesAfterRenumber,
  unlinkRelationEventFromPersonas,
  updateAppearancesForChapter,
  countChapterAppearancesForName,
} from './persona-graph.util';
import {
  isPersonaKeywordSupplementEnabled,
  resolveStructuredMatchingTextForSync,
  supplementPersonaKeywordsFromSource,
} from './persona-keyword-supplement';
import {
  buildRelationMemoryBlock,
  matchesRelationEventFilters,
  normalizeRelationEventDedupeKey,
  normalizeSelectedEventIds,
  parseExtractedRelationEventCandidates,
  resolveRelationEventActors,
  softDeleteChapterRelationEvents,
  RELATION_EVENT_SELECTED_MAX_COUNT,
  RELATION_EVENT_SUMMARY_MAX_LENGTH,
} from './relation-event.util';
import {
  buildIdentityRelationMemoryBlock,
  mergeIdentityRelationCandidates,
  parseExtractedIdentityRelationCandidates,
  type PersonaIdentityRelationRecord,
} from './identity-relation.util';
import type { ChapterStructuredInfoPersisted } from './persisted-workspace.types';
import { DocumentsService } from '../documents/documents.service';
import { PromptTemplatesService } from '../prompt-templates/prompt-templates.service';
import { TaskPromptsService } from '../task-prompts/task-prompts.service';
import { buildChaptersExportFilename, buildChaptersTxtExport } from './chapter-export.util';
import { previewChapterImport, parseNovelContent } from './chapter-import.util';
import {
  CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_TYPO_CHECK_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_TYPO_FIX_TEMPLATE_KEY,
  ChapterVersionConflictError,
  CHAPTER_OPTIMIZE_SEGMENT_MAX_RETRIES,
  assertDraftText,
  assertInstruction,
  assertPlanText,
  buildDraftUserPrompt,
  buildPlanUserPrompt,
  buildPlanSynthesisUserPrompt,
  buildSegmentDiagnosisUserPrompt,
  buildTypoCheckUserPrompt,
  buildTypoFixUserPrompt,
  buildSegmentBoundaryAnchors,
  calculateSegmentMaxTokensForIndex,
  ensureChapterVersionMatches,
  makeOptimizationId,
  normalizeInstruction,
  parseExpectedUpdatedAt,
  parseSegmentOutput,
  parseTypoCheckIssues,
  resolveChapterOptimizeLengthStrategy,
  resolveChapterOptimizeConfigWithProjectOverride,
  clampChapterOptimizeSegmentCharSize,
  DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE,
  splitIntoSegments,
  validateMergedChapterDraft,
  type ChapterOptimizeSegmentRecovery,
  type ChapterOptimizeStage,
  type ChapterOptimizeUsedRelationEvent,
  type ChapterTypoIssueRecord,
  type Segment,
} from './chapter-optimize.util';
import {
  WRITE_CHAPTER_DRAFT_SYSTEM_PROMPT,
  WRITE_CHAPTER_DRAFT_TEMPLATE_KEY,
  WRITE_CHAPTER_OUTLINE_SYSTEM_PROMPT,
  WRITE_CHAPTER_OUTLINE_TEMPLATE_KEY,
  assertConfirmedOutlineForDraft,
  assertOutlineText,
  buildWriteDraftUserPrompt,
  buildWriteOutlineUserPrompt,
  makeWriteOutlineId,
  type WriteChapterTaskInput,
  type WriteChapterUsedRelationEvent,
} from './write-chapter.util';
import { PrismaService } from '../../prisma/prisma.service';
import { usePostgresPersistence } from '../../persistence/use-postgres';
import {
  loadWorkspaceFromPostgres,
  syncWorkspaceToPostgres,
} from '../../persistence/workspace-pg-sync';
import type { PersistedProjectState } from './persisted-workspace.types';
import { hashChapterContent } from './chapter-content-hash.util';
import {
  clampChapterSummaryMemoryCount,
  clampChapterSummaryPromptCount,
  clampContextExcerptMaxChars,
  clampGenerationTemperature,
  clampPriorChapterTailChars,
  DEFAULT_CHAPTER_SUMMARY_MEMORY_COUNT,
  DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT,
  DEFAULT_CONTEXT_EXCERPT_MAX_CHARS,
  DEFAULT_GENERATION_TEMPERATURE,
  DEFAULT_PRIOR_CHAPTER_TAIL_CHARS,
  sliceContentTail,
} from './project-settings.util';
import {
  applyProjectSettingsJsonExtensions,
  pickProjectSettingsJsonExtensions,
  serializeProjectSettingsForJsonMirror,
} from './project-settings.extensions';
import { buildWriteContextReadiness } from './write-context-readiness.util';

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
  /** 叙事上下文注入：当前章之前最近 N 章摘要，0 表示不注入 */
  chapterSummaryPromptCount: number;
  /** 语义记忆池：向量检索历史章节摘要条数 */
  chapterSummaryMemoryCount: number;
  /** 写第 N 章时注入第 N-1 章正文末尾字符数；0 关闭 */
  priorChapterTailChars: number;
  /** 无摘要章节降级 excerpt 最大长度 */
  contextExcerptMaxChars: number;
  /** 主生成链路采样温度（0~2） */
  generationTemperature: number;
  /** 保存章节时自动更新人物出场状态 */
  updatePersonaOnSave: boolean;
  /** 保存章节时自动生成关系事件 */
  generateRelationEventsOnSave: boolean;
  /** 章节优化方案分段字数；0 表示不按字数分段 */
  chapterOptimizeSegmentCharSize: number;
  /** 是否对 AI 正文执行内容安全硬规则扫描 */
  contentSafetyScanEnabled: boolean;
  /** 项目自定义禁用词 */
  contentSafetyCustomRules: ProjectContentSafetyRule[];
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
  relationEventIds: string[];
  appearedChapterNos: number[];
  lastAppearedChapterNo: number | null;
  /** 按章结构化快照（着装 + 状态），写第 N 章时取 < N 的最新记录 */
  chapterStates?: PersonaChapterStateRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChapterPendingAction {
  type: 'persona' | 'relationEvents';
  label: string;
  estimatedTokens: number;
}

export interface ChapterRecord {
  chapterNo: number;
  title: string;
  content: string;
  contentHash?: string;
  summary: string;
  summarySource?: ChapterSummarySource;
  summaryUpdatedAt?: Date;
  updatedAt: Date;
  /** 用于知识库标题匹配的结构化解析结果（AQ-124+） */
  structuredInfo?: ChapterStructuredInfoPersisted;
}

export interface KnowledgeRecord {
  outlineSummary: string;
  chapters: ChapterRecord[];
  /** 工作台「解析结构化信息」暂存（无正文时不创建空章节） */
  workbenchStructuredByChapter?: Record<number, ChapterStructuredInfoPersisted>;
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
  confirmedOutlineText?: string;
  outlineId?: string;
  outlineTraceId?: string;
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
  protagonistPersonaId: string | null;
  counterpartyPersonaId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ChapterImportPersonaBootstrap {
  createdPersonaCount: number;
  createdRelationEventCount: number;
  suspectedNameConflicts: string[];
  createdPersonas: Array<{ id: string; name: string }>;
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
  identityRelations: PersonaIdentityRelationRecord[];
  latestIndexJob: IndexJobRecord | null;
  latestSummaryJob: SummaryJobRecord | null;
}

export interface ProjectExportBundle {
  project: ProjectRecord;
  exportedAt: string;
  settings: {
    systemPromptText: string;
    activePersonaId: string | null;
    chapterSummaryPromptCount: number;
    generationTemperature: number;
    updatePersonaOnSave: boolean;
    generateRelationEventsOnSave: boolean;
    personas: PersonaRecord[];
  };
  summary: {
    outlineSummary: string;
    chapterCount: number;
    chapters: Array<{ chapterNo: number; title: string; summary: string; updatedAt: Date }>;
  };
}

type RestoredWorkspace = {
  projects: ProjectRecord[];
  members: ProjectMember[];
  settings: Record<string, ProjectSettings>;
  personas: Record<string, PersonaRecord[]>;
  knowledge: Record<string, KnowledgeRecord>;
  indexJobs: Record<string, IndexJobRecord[]>;
  summarizeJobs: Record<string, SummaryJobRecord[]>;
  relationEvents: Record<string, RelationEventRecord[]>;
  identityRelations: Record<string, PersonaIdentityRelationRecord[]>;
};

@Injectable()
export class ProjectsService implements OnModuleInit {
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
  private readonly identityRelationsStore = new Map<string, PersonaIdentityRelationRecord[]>();

  private persistenceResolve!: () => void;
  readonly persistenceReady: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => DocumentsService))
    private readonly documentsService: DocumentsService,
    @Inject(forwardRef(() => PromptTemplatesService))
    private readonly promptTemplatesService: PromptTemplatesService,
    @Inject(forwardRef(() => TaskPromptsService))
    private readonly taskPromptsService: TaskPromptsService
  ) {
    this.persistenceReady = new Promise<void>((resolve) => {
      this.persistenceResolve = resolve;
    });

    if (usePostgresPersistence()) {
      return;
    }

    const restored = this.restoreStateFromDisk();
    if (restored) {
      this.applyRestoredWorkspace(restored);
    }

    for (const project of this.projects) {
      this.ensureProjectState(project.id);
    }

    if (!restored) {
      this.persistState();
    } else if (this.jsonMirrorNeedsExtensionBackfill()) {
      this.persistState();
    }
    this.persistenceResolve();
  }

  async onModuleInit() {
    if (!usePostgresPersistence()) {
      return;
    }
    try {
      const fromPg = await loadWorkspaceFromPostgres(this.prisma);
      if (fromPg?.projects.length) {
        this.applyRestoredWorkspace(this.mapPersistedToRuntime(fromPg));
        this.mergeJsonMirrorSettingsExtensions();
      } else {
        const fromJson = this.restoreStateFromDisk();
        if (fromJson) {
          this.applyRestoredWorkspace(fromJson);
        }
        for (const project of this.projects) {
          this.ensureProjectState(project.id);
        }
        if (this.projects.length > 0) {
          await syncWorkspaceToPostgres(this.prisma, this.buildPersistedPayload());
        }
      }
      for (const project of this.projects) {
        this.ensureProjectState(project.id);
      }
      if (this.jsonMirrorNeedsExtensionBackfill()) {
        this.persistState();
      }
    } catch (err) {
      console.error('[persistence] workspace PG 初始化失败，回退到 JSON 镜像', err);
      const fromJson = this.restoreStateFromDisk();
      if (fromJson) {
        this.applyRestoredWorkspace(fromJson);
      }
      for (const project of this.projects) {
        this.ensureProjectState(project.id);
      }
      if (this.jsonMirrorNeedsExtensionBackfill()) {
        this.persistState();
      }
    } finally {
      this.persistenceResolve();
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
    this.identityRelationsStore.delete(id);
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

    return {
      project,
      settings,
      personas,
      knowledge,
      identityRelations: this.identityRelationsStore.get(id) ?? [],
      latestIndexJob,
      latestSummaryJob,
    };
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
        chapterSummaryPromptCount: settings.chapterSummaryPromptCount,
        generationTemperature: settings.generationTemperature,
        updatePersonaOnSave: settings.updatePersonaOnSave,
        generateRelationEventsOnSave: settings.generateRelationEventsOnSave,
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

  getWriteContextReadiness(projectId: string, chapterNo: number, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const normalized = Number(chapterNo);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      throw new BadRequestException('chapterNo 必须为正整数');
    }

    const knowledge = this.knowledgeStore.get(projectId)!;
    return buildWriteContextReadiness(
      normalized,
      knowledge.chapters.map((ch) => ({
        chapterNo: ch.chapterNo,
        summary: ch.summary,
        content: ch.content,
      }))
    );
  }

  getSettings(projectId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId);
    }
    return this.getSettingsInternal(projectId);
  }

  private getSettingsInternal(projectId: string): ProjectSettings {
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);
    this.mergeJsonMirrorSettingsExtensionsForProject(projectId);
    const settings = this.settingsStore.get(projectId)!;
    this.patchSettingsDefaults(settings);
    return this.serializeProjectSettings(settings);
  }

  updateSettings(
    projectId: string,
    payload: {
      systemPromptText?: string;
      activePersonaId?: string | null;
      chapterSummaryPromptCount?: number;
      chapterSummaryMemoryCount?: number;
      priorChapterTailChars?: number;
      contextExcerptMaxChars?: number;
      generationTemperature?: number;
      updatePersonaOnSave?: boolean;
      generateRelationEventsOnSave?: boolean;
      chapterOptimizeSegmentCharSize?: number;
      contentSafetyScanEnabled?: boolean;
      contentSafetyCustomRules?: ProjectContentSafetyRule[];
    },
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

    if (payload.chapterSummaryPromptCount !== undefined) {
      settings.chapterSummaryPromptCount = clampChapterSummaryPromptCount(
        payload.chapterSummaryPromptCount
      );
    }

    if (payload.chapterSummaryMemoryCount !== undefined) {
      settings.chapterSummaryMemoryCount = clampChapterSummaryMemoryCount(
        payload.chapterSummaryMemoryCount
      );
    }

    if (payload.priorChapterTailChars !== undefined) {
      settings.priorChapterTailChars = clampPriorChapterTailChars(payload.priorChapterTailChars);
    }

    if (payload.contextExcerptMaxChars !== undefined) {
      settings.contextExcerptMaxChars = clampContextExcerptMaxChars(payload.contextExcerptMaxChars);
    }

    if (payload.generationTemperature !== undefined) {
      settings.generationTemperature = clampGenerationTemperature(payload.generationTemperature);
    }

    if (payload.updatePersonaOnSave !== undefined) {
      settings.updatePersonaOnSave = payload.updatePersonaOnSave;
    }

    if (payload.generateRelationEventsOnSave !== undefined) {
      settings.generateRelationEventsOnSave = payload.generateRelationEventsOnSave;
    }

    if (payload.chapterOptimizeSegmentCharSize !== undefined) {
      settings.chapterOptimizeSegmentCharSize = clampChapterOptimizeSegmentCharSize(
        payload.chapterOptimizeSegmentCharSize
      );
    }

    if (payload.contentSafetyScanEnabled !== undefined) {
      settings.contentSafetyScanEnabled = payload.contentSafetyScanEnabled;
    }

    if (payload.contentSafetyCustomRules !== undefined) {
      const validated = validateProjectContentSafetyRulesInput(payload.contentSafetyCustomRules);
      if (!validated.ok) {
        throw new BadRequestException(validated.message);
      }
      settings.contentSafetyCustomRules = validated.rules;
    }

    settings.updatedAt = new Date();
    this.patchSettingsDefaults(settings);
    this.persistState();
    return this.serializeProjectSettings(settings);
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
      ...createEmptyPersonaGraphFields(),
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

    const events = this.relationEventsStore.get(projectId)!;
    clearPersonaFromRelationEvents(personaId, events);
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
    const knowledge = this.knowledgeStore.get(projectId)!;
    if (this.migrateOrphanWorkbenchStructuredChapters(knowledge)) {
      this.persistState();
    }
    return knowledge;
  }

  async getProjectStats(projectId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const knowledge = this.knowledgeStore.get(projectId)!;
    const chapterCharCounts = [...knowledge.chapters]
      .sort((a, b) => a.chapterNo - b.chapterNo)
      .map((chapter) => ({
        chapterNo: chapter.chapterNo,
        charCount: (chapter.content || '').length,
      }));
    const totalCharCount = chapterCharCounts.reduce((sum, item) => sum + item.charCount, 0);

    let generationTotal = 0;
    let generationCompleted = 0;
    let generationFailed = 0;
    let totalTokens = 0;

    try {
      const { data } = await axios.get<{
        total?: number;
        completed?: number;
        failed?: number;
        totalTokens?: number;
      }>(`${this.getRagOrchestratorUrl()}/api/projects/${projectId}/generation-stats`, {
        timeout: 10000,
      });
      generationTotal = data.total ?? 0;
      generationCompleted = data.completed ?? 0;
      generationFailed = data.failed ?? 0;
      totalTokens = data.totalTokens ?? 0;
    } catch {
      // RAG 编排不可用时仍返回章节字数统计
    }

    return {
      totalCharCount,
      chapterCharCounts,
      totalTokens,
      generationTotal,
      generationCompleted,
      generationFailed,
    };
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

  deleteChapter(projectId: string, chapterNo: number, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const knowledge = this.knowledgeStore.get(projectId)!;
    const normalizedChapterNo = Number(chapterNo);

    if (!Number.isFinite(normalizedChapterNo) || normalizedChapterNo <= 0) {
      throw new BadRequestException('chapterNo 必须为正整数');
    }

    const index = knowledge.chapters.findIndex((item) => item.chapterNo === normalizedChapterNo);
    if (index === -1) {
      throw new NotFoundException(`未找到第 ${normalizedChapterNo} 章`);
    }

    const deletedChapter = knowledge.chapters.splice(index, 1)[0];

    knowledge.chapters.forEach((chapter) => {
      if (chapter.chapterNo > normalizedChapterNo) {
        chapter.chapterNo -= 1;
      }
    });

    const events = this.relationEventsStore.get(projectId)!;
    events.forEach((event) => {
      if (event.chapterNo === normalizedChapterNo) {
        event.chapterNo = null;
      } else if (event.chapterNo !== null && event.chapterNo > normalizedChapterNo) {
        event.chapterNo -= 1;
      }
    });

    const personas = this.personasStore.get(projectId)!;
    for (const persona of personas) {
      const graph = normalizePersonaGraphFields(persona);
      persona.appearedChapterNos = renumberAppearancesAfterDelete(
        graph.appearedChapterNos,
        normalizedChapterNo
      );
      persona.lastAppearedChapterNo = persona.appearedChapterNos.length
        ? Math.max(...persona.appearedChapterNos)
        : null;
      persona.updatedAt = new Date();
    }

    this.persistState();
    return { id: deletedChapter.chapterNo };
  }

  renumberChapters(projectId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const knowledge = this.knowledgeStore.get(projectId)!;
    const sorted = [...knowledge.chapters].sort((a, b) => a.chapterNo - b.chapterNo);

    const oldToNew = new Map<number, number>();
    sorted.forEach((ch, index) => {
      const newNo = index + 1;
      if (ch.chapterNo !== newNo) {
        oldToNew.set(ch.chapterNo, newNo);
        ch.chapterNo = newNo;
      }
    });

    if (oldToNew.size === 0) {
      return { renumberedCount: 0 };
    }

    const events = this.relationEventsStore.get(projectId);
    if (events) {
      events.forEach((event) => {
        if (event.chapterNo !== null) {
          const mapped = oldToNew.get(event.chapterNo);
          if (mapped !== undefined) {
            event.chapterNo = mapped;
          }
        }
      });
    }

    const personas = this.personasStore.get(projectId)!;
    for (const persona of personas) {
      const graph = normalizePersonaGraphFields(persona);
      persona.appearedChapterNos = renumberAppearancesAfterRenumber(
        graph.appearedChapterNos,
        oldToNew
      );
      persona.lastAppearedChapterNo = persona.appearedChapterNos.length
        ? Math.max(...persona.appearedChapterNos)
        : null;
      persona.updatedAt = new Date();
    }

    this.persistState();
    return { renumberedCount: oldToNew.size };
  }

  async upsertChapter(
    projectId: string,
    payload: { chapterNo: number; title: string; content: string },
    userId?: string,
    options?: { postWriteMode?: 'auto' | 'defer' }
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

    const nextHash = hashChapterContent(payload.content);
    const now = new Date();
    const existing = knowledge.chapters.find((item) => item.chapterNo === chapterNo);
    const previousHash = existing
      ? (existing.contentHash ?? hashChapterContent(existing.content))
      : null;
    const contentChanged = !existing || previousHash !== nextHash;
    const postWriteMode = options?.postWriteMode ?? 'defer';

    if (existing && !contentChanged) {
      existing.title = payload.title.trim();
      existing.contentHash = nextHash;
      existing.updatedAt = now;
      this.persistState();
      return {
        ...existing,
        contentChanged: false,
        pendingActions: [] as ChapterPendingAction[],
      };
    }

    const summaryFields = resolveChapterSummaryOnContentWrite({
      content: payload.content,
      existing,
      now,
    });

    const workbenchDraft = knowledge.workbenchStructuredByChapter?.[chapterNo];

    let targetChapter: ChapterRecord;
    if (existing) {
      existing.title = payload.title.trim();
      existing.content = payload.content;
      existing.contentHash = nextHash;
      existing.summary = summaryFields.summary;
      existing.summarySource = summaryFields.summarySource;
      existing.summaryUpdatedAt = summaryFields.summaryUpdatedAt;
      existing.updatedAt = now;
      targetChapter = existing;
    } else {
      targetChapter = {
        chapterNo,
        title: payload.title.trim(),
        content: payload.content,
        contentHash: nextHash,
        summary: summaryFields.summary,
        summarySource: summaryFields.summarySource,
        summaryUpdatedAt: summaryFields.summaryUpdatedAt,
        updatedAt: now,
      };
      knowledge.chapters.push(targetChapter);
      knowledge.chapters.sort((a, b) => a.chapterNo - b.chapterNo);
    }

    if (workbenchDraft && !targetChapter.structuredInfo) {
      targetChapter.structuredInfo = workbenchDraft;
    }
    if (workbenchDraft && knowledge.workbenchStructuredByChapter) {
      delete knowledge.workbenchStructuredByChapter[chapterNo];
    }

    this.persistState();

    void this.indexChapterSummaryVector(projectId, targetChapter).catch((error) => {
      console.error(
        `[indexChapterSummaryVector] project=${projectId} chapter=${chapterNo} failed:`,
        error
      );
    });

    const settings = this.settingsStore.get(projectId)!;
    const pendingActions = this.buildChapterPendingActions(settings);

    if (postWriteMode === 'auto') {
      await this.runChapterPostWriteActions(
        projectId,
        chapterNo,
        payload.content,
        targetChapter.title,
        {
          persona: settings.updatePersonaOnSave !== false,
          relationEvents: settings.generateRelationEventsOnSave !== false,
        }
      );
      this.relinkRelationEventsForProject(projectId);
      this.persistState();
      return {
        ...targetChapter,
        contentChanged: true,
        pendingActions: [] as ChapterPendingAction[],
      };
    }

    this.relinkRelationEventsForProject(projectId);
    this.persistState();
    return {
      ...targetChapter,
      contentChanged: true,
      pendingActions,
    };
  }

  private buildChapterPendingActions(settings: ProjectSettings): ChapterPendingAction[] {
    const actions: ChapterPendingAction[] = [];
    if (settings.updatePersonaOnSave !== false) {
      actions.push({
        type: 'persona',
        label: '更新人物出场与状态',
        estimatedTokens: 800,
      });
    }
    if (settings.generateRelationEventsOnSave !== false) {
      actions.push({
        type: 'relationEvents',
        label: '生成本章关系事件',
        estimatedTokens: 1200,
      });
    }
    return actions;
  }

  private async runChapterPostWriteActions(
    projectId: string,
    chapterNo: number,
    content: string,
    title: string,
    selected: { persona: boolean; relationEvents: boolean }
  ) {
    if (selected.persona) {
      await this.syncPersonaGraphFromChapter(projectId, chapterNo, content, title);
    }
    if (selected.relationEvents) {
      try {
        await this.generateChapterRelationEvents(projectId, chapterNo);
      } catch {
        // 自动生成失败不影响章节保存
      }
    }
  }

  async executeChapterAfterSave(
    projectId: string,
    chapterNo: number,
    payload: { actions: Array<'persona' | 'relationEvents'> },
    userId?: string,
    onProgress?: (event: { event: string; action: string; status: string }) => void
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const knowledge = this.knowledgeStore.get(projectId)!;
    const chapter = knowledge.chapters.find((ch) => ch.chapterNo === chapterNo);
    if (!chapter) {
      throw new NotFoundException(`未找到章节: ${chapterNo}`);
    }

    const selected = {
      persona: payload.actions.includes('persona'),
      relationEvents: payload.actions.includes('relationEvents'),
    };

    if (selected.persona) {
      onProgress?.({ event: 'progress', action: 'persona', status: 'started' });
      await this.syncPersonaGraphFromChapter(projectId, chapterNo, chapter.content, chapter.title);
      onProgress?.({ event: 'progress', action: 'persona', status: 'completed' });
    }

    if (selected.relationEvents) {
      onProgress?.({ event: 'progress', action: 'relationEvents', status: 'started' });
      try {
        await this.generateChapterRelationEvents(projectId, chapterNo);
        onProgress?.({ event: 'progress', action: 'relationEvents', status: 'completed' });
      } catch {
        onProgress?.({ event: 'progress', action: 'relationEvents', status: 'failed' });
      }
    }

    this.relinkRelationEventsForProject(projectId);
    this.persistState();
    return { chapterNo, completed: true };
  }

  async insertChapter(
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

    knowledge.chapters.forEach((ch) => {
      if (ch.chapterNo >= chapterNo) {
        ch.chapterNo += 1;
      }
    });

    const targetChapter: ChapterRecord = {
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

    this.persistState();
    if (knowledge.chapters.length > 0) {
      const settings = this.settingsStore.get(projectId)!;
      if (settings.updatePersonaOnSave !== false) {
        await this.syncPersonaGraphFromChapter(
          projectId,
          chapterNo,
          payload.content,
          targetChapter.title
        );
      }
      if (settings.generateRelationEventsOnSave !== false) {
        try {
          await this.generateChapterRelationEvents(projectId, chapterNo);
        } catch {
          // 自动生成失败不影响章节保存
        }
      }
    }
    this.relinkRelationEventsForProject(projectId);
    this.persistState();
    return targetChapter;
  }

  async importChapterPreview(projectId: string, content: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);

    if (!content || content.trim().length === 0) {
      throw new BadRequestException({ code: 1319, msg: '导入内容不能为空' });
    }

    try {
      return previewChapterImport(content);
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string };
      if (err.code === 1317) {
        throw new HttpException({ code: 1317, msg: '导入内容过大，请控制在 5MB 以内' }, 413);
      }
      throw new BadRequestException({
        code: err.code || 1319,
        msg: err.message || '导入内容解析失败',
      });
    }
  }

  async importChapterConfirm(
    projectId: string,
    content: string,
    userId?: string,
    options?: { chapterNos?: number[]; autoExtractRelationEvents?: boolean }
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    if (!content || content.trim().length === 0) {
      throw new BadRequestException({ code: 1319, msg: '导入内容不能为空' });
    }

    let chapters = parseNovelContent(content);

    if (options?.chapterNos && options.chapterNos.length > 0) {
      const allowed = new Set(
        options.chapterNos.filter((no) => Number.isFinite(no) && no > 0).map((no) => Math.floor(no))
      );
      chapters = chapters.filter((chapter) => allowed.has(chapter.chapterNo));
    }

    if (chapters.length === 0) {
      throw new BadRequestException({ code: 1318, msg: '导入内容中未识别到有效章节' });
    }

    const knowledge = this.knowledgeStore.get(projectId)!;
    const imported: ChapterRecord[] = [];
    const now = new Date();

    for (const chapter of chapters) {
      const existing = knowledge.chapters.find((item) => item.chapterNo === chapter.chapterNo);

      const nextSummary = buildFallbackChapterSummary(chapter.content);

      if (existing) {
        existing.title = chapter.title.trim();
        existing.content = chapter.content;
        existing.summary = nextSummary;
        existing.summarySource = 'fallback';
        existing.summaryUpdatedAt = now;
        existing.updatedAt = now;
        imported.push(existing);
      } else {
        const newChapter: ChapterRecord = {
          chapterNo: chapter.chapterNo,
          title: chapter.title.trim(),
          content: chapter.content,
          summary: nextSummary,
          summarySource: 'fallback',
          summaryUpdatedAt: now,
          updatedAt: now,
        };
        knowledge.chapters.push(newChapter);
        imported.push(newChapter);
      }
    }

    knowledge.chapters.sort((a, b) => a.chapterNo - b.chapterNo);

    const personas = this.personasStore.get(projectId)!;
    rebuildPersonaAppearancesFromChapters(personas, knowledge.chapters);

    const personaBootstrap = await this.bootstrapPersonasAfterImport(projectId, imported, {
      autoExtractRelationEvents: options?.autoExtractRelationEvents ?? true,
    });

    this.relinkRelationEventsForProject(projectId);
    this.persistState();

    return {
      importedCount: imported.length,
      chapters: imported.map((chapter) => ({
        chapterNo: chapter.chapterNo,
        title: chapter.title,
        content: chapter.content,
        summary: chapter.summary,
        summarySource: chapter.summarySource,
        summaryUpdatedAt: chapter.summaryUpdatedAt,
        updatedAt: chapter.updatedAt,
      })),
      personaBootstrap,
    };
  }

  async parseChapterStructuredInfo(
    projectId: string,
    chapterNo: number,
    body:
      | {
          mode: 'workbench';
          goal?: string;
          pov?: string;
          mustInclude?: string[];
          avoid?: string[];
        }
      | { mode: 'chapter' },
    userId?: string
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const knowledge = this.knowledgeStore.get(projectId)!;
    if (this.migrateOrphanWorkbenchStructuredChapters(knowledge)) {
      this.persistState();
    }
    const chapter = knowledge.chapters.find((item) => item.chapterNo === chapterNo);
    const workbenchDrafts = this.ensureWorkbenchStructuredDrafts(knowledge);

    if (!chapter && body.mode !== 'workbench') {
      throw new NotFoundException(`未找到第 ${chapterNo} 章`);
    }

    let sourceText = '';
    if (body.mode === 'workbench') {
      const parts = [
        body.goal?.trim(),
        body.pov?.trim(),
        ...(body.mustInclude ?? []).map(String).filter(Boolean),
        ...(body.avoid ?? []).map((a) => `避免:${String(a).trim()}`).filter(Boolean),
      ].filter(Boolean);
      sourceText = parts.join('\n');
    } else {
      sourceText = chapter!.content ?? '';
    }

    if (!sourceText.trim()) {
      throw new BadRequestException(
        '解析源文本为空：请先填写本章目标（工作台）或章节正文（章节模块）。'
      );
    }

    const knowledgeDocs = this.documentsService.findAll(projectId);

    try {
      const { data } = await axios.post(
        `${this.getRagOrchestratorUrl()}/api/parse/structured-info`,
        {
          mode: body.mode,
          sourceText: sourceText.slice(0, 50000),
        },
        { timeout: 120000 }
      );

      let matchingText =
        typeof data?.matchingText === 'string' ? data.matchingText.trim().slice(0, 2000) : '';
      const rawKeywords: unknown[] = Array.isArray(data?.keywords) ? data.keywords : [];
      const aiKeywords = rawKeywords
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((s): s is string => Boolean(s))
        .slice(0, 40);

      let keywords = [...new Set(aiKeywords)];
      let personaKeywordSupplements: string[] | undefined;

      if (isPersonaKeywordSupplementEnabled()) {
        const personaCards = knowledgeDocs
          .filter((doc) => doc.docType === 'persona_card')
          .map((doc) => ({ id: doc.id, title: doc.title, docType: doc.docType }));
        const supplement = supplementPersonaKeywordsFromSource(
          sourceText,
          personaCards,
          aiKeywords
        );
        keywords = supplement.mergedKeywords;
        if (supplement.supplementedKeywords.length > 0) {
          personaKeywordSupplements = supplement.supplementedKeywords;
        }
      }

      if (!matchingText.trim() && keywords.length > 0) {
        matchingText = keywords.join(' ').slice(0, 2000);
      }
      if (!matchingText.trim() && sourceText.trim()) {
        matchingText = sourceText.replace(/\s+/g, ' ').trim().slice(0, 400);
      }

      const narrativeSummary =
        typeof data?.narrativeSummary === 'string' ? data.narrativeSummary.trim() : undefined;

      const structuredInfo: ChapterStructuredInfoPersisted = {
        matchingText,
        keywords,
        ...(personaKeywordSupplements?.length
          ? { personaKeywordSupplements }
          : {}),
        narrativeSummary: narrativeSummary || undefined,
        parseSource: body.mode,
        parsedAt: new Date().toISOString(),
      };

      const now = new Date();
      if (chapter) {
        chapter.structuredInfo = structuredInfo;
        chapter.updatedAt = now;
        delete workbenchDrafts[chapterNo];
        this.persistState();
        return { chapter, structuredInfo: chapter.structuredInfo };
      }

      workbenchDrafts[chapterNo] = structuredInfo;
      this.persistState();
      return {
        chapter: {
          chapterNo,
          title: `第${chapterNo}章`,
          content: '',
          summary: '',
          updatedAt: now.toISOString(),
        },
        structuredInfo,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '结构化信息解析失败';
      throw new BadGatewayException(message);
    }
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

  /**
   * 重建语义记忆向量（Qdrant），不调用 LLM。
   *
   * - `existing`：将章节已有 summary（含 LLM 摘要）原样写入向量库，不改 DB
   * - `content_fallback`：用正文前 160 字刷新 summary 并写入向量库
   */
  async rebuildChapterSummaryMemory(
    projectId: string,
    payload: {
      chapterNos?: number[];
      source?: 'existing' | 'content_fallback';
    } = {},
    userId?: string
  ) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const source = payload.source === 'content_fallback' ? 'content_fallback' : 'existing';
    const knowledge = this.knowledgeStore.get(projectId)!;
    const requested = Array.isArray(payload.chapterNos)
      ? payload.chapterNos
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item) && item > 0)
      : [];

    const pool =
      requested.length > 0
        ? requested
            .map((chapterNo) => knowledge.chapters.find((item) => item.chapterNo === chapterNo))
            .filter((chapter): chapter is ChapterRecord => Boolean(chapter))
        : knowledge.chapters;

    if (pool.length === 0) {
      throw new BadRequestException('没有可处理的章节');
    }

    const now = new Date();
    const chapters: Array<{
      chapterNo: number;
      status: 'indexed' | 'skipped' | 'failed';
      summaryChars?: number;
      summarySource?: ChapterSummarySource;
      error?: string;
    }> = [];
    let indexed = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < pool.length; i++) {
      const chapter = pool[i]!;
      if (source === 'existing') {
        const summary = chapter.summary?.trim();
        if (!summary) {
          skipped += 1;
          chapters.push({ chapterNo: chapter.chapterNo, status: 'skipped' });
          continue;
        }
      } else if (!chapter.content.trim()) {
        skipped += 1;
        chapters.push({ chapterNo: chapter.chapterNo, status: 'skipped' });
        continue;
      }

      if (source === 'content_fallback') {
        const summaryFields = resolveChapterSummaryOnContentWrite({
          content: chapter.content,
          existing: chapter,
          now,
        });
        chapter.summary = summaryFields.summary;
        chapter.summarySource = summaryFields.summarySource;
        chapter.summaryUpdatedAt = summaryFields.summaryUpdatedAt;
        chapter.updatedAt = now;
      }

      try {
        await this.indexChapterSummaryVectorWithRateLimit(projectId, chapter, {
          throttleBefore: i > 0,
        });
        indexed += 1;
        chapters.push({
          chapterNo: chapter.chapterNo,
          status: 'indexed',
          summaryChars: chapter.summary.trim().length,
          summarySource: chapter.summarySource,
        });
      } catch (error) {
        failed += 1;
        chapters.push({
          chapterNo: chapter.chapterNo,
          status: 'failed',
          error: error instanceof Error ? error.message : '向量索引失败',
        });
      }
    }

    if (indexed > 0 || source === 'content_fallback') {
      knowledge.indexVersion += 1;
      knowledge.lastIndexedAt = now;
      this.persistState();
    }

    return {
      source,
      total: pool.length,
      indexed,
      failed,
      skipped,
      chapters,
    };
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

    const projectEvents = this.relationEventsStore.get(projectId)!;
    const projectPersonas = this.personasStore.get(projectId)!;
    const removedIds = softDeleteChapterRelationEvents(projectEvents, normalizedChapterNo);
    for (const eventId of removedIds) {
      unlinkRelationEventFromPersonas(eventId, projectPersonas);
    }
    const removedCount = removedIds.length;

    const existingEvents = projectEvents.filter((event) => !event.deletedAt);
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
        protagonistPersonaId: null,
        counterpartyPersonaId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      projectEvents.push(event);
      linkRelationEventToPersonas(event, projectPersonas);
      existingKeys.add(dedupeKey);
      createdEvents.push(event);
    }

    if (createdEvents.length > 0 || removedCount > 0) {
      this.persistState();
    }

    return {
      chapterNo: normalizedChapterNo,
      removedCount,
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
      protagonistPersonaId: null,
      counterpartyPersonaId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    this.relationEventsStore.get(projectId)!.push(event);
    linkRelationEventToPersonas(event, this.personasStore.get(projectId)!);
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

    unlinkRelationEventFromPersonas(eventId, this.personasStore.get(projectId)!);
    const normalized = this.normalizeRelationEventInput(projectId, payload, event.protagonist);
    Object.assign(event, normalized, { updatedAt: new Date() });
    linkRelationEventToPersonas(event, this.personasStore.get(projectId)!);
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
    unlinkRelationEventFromPersonas(eventId, this.personasStore.get(projectId)!);
    this.persistState();
    return { id: event.id };
  }

  async writeChapterOutlineStream(
    projectId: string,
    payload: Partial<WriteTaskInput>,
    userId: string | undefined,
    callbacks: {
      onStart: (event: {
        traceId: string;
        chapterNo: number;
        outlineId: string;
        basis: {
          usedPersonaId: string | null;
          outlineUsed: boolean;
          recentChapterCount: number;
          usedRelationEvents: UsedRelationEventRecord[];
        };
      }) => void;
      onContent: (text: string) => void;
      onEnd: (event: {
        traceId: string;
        outlineText: string;
        outlineId: string;
        basis: {
          usedPersonaId: string | null;
          outlineUsed: boolean;
          recentChapterCount: number;
          usedRelationEvents: UsedRelationEventRecord[];
        };
      }) => void;
      onError: (message: string, recovery?: ChapterOptimizeSegmentRecovery) => void;
    }
  ): Promise<void> {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor']);
    }
    this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const task = this.normalizeWriteTaskInput(payload);
    const knowledge = this.knowledgeStore.get(projectId)!;
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

    const userPrompt = buildWriteOutlineUserPrompt({
      task,
      selectedRelationEvents: usedRelationEvents.map(
        (event): WriteChapterUsedRelationEvent => ({
          id: event.id,
          protagonist: event.protagonist,
          counterparty: event.counterparty,
          summary: event.summary,
          evidenceSnippet: event.evidenceSnippet,
          chapterNo: event.chapterNo,
        })
      ),
    });

    const outlineId = makeWriteOutlineId();
    const activePersona =
      personas.find((item) => item.id === settings.activePersonaId) ||
      personas.find((item) => item.status === 'published') ||
      null;

    const basis = {
      usedPersonaId: activePersona?.id || null,
      outlineUsed: Boolean(knowledge.outlineSummary),
      recentChapterCount: knowledge.chapters.slice(-3).length,
      usedRelationEvents,
    };

    const structuredChapter = knowledge.chapters.find((ch) => ch.chapterNo === task.chapterNo);
    const chapterSummaryForRetrieval =
      (structuredChapter?.summary && structuredChapter.summary.trim()) ||
      structuredChapter?.content.slice(0, 160) ||
      task.goal.slice(0, 160);

    let response;
    try {
      response = await axios.post(
        `${this.getRagOrchestratorUrl()}/api/generate`,
        {
          projectId,
          prompt: userPrompt,
          useSSE: true,
          systemPromptOverride: WRITE_CHAPTER_OUTLINE_SYSTEM_PROMPT,
          templateKey: WRITE_CHAPTER_OUTLINE_TEMPLATE_KEY,
          context: {
            task: 'write.chapter.outline',
            chapterNo: task.chapterNo,
            outlineId,
            writeTask: task,
            retrievalInstruction: task.goal,
            retrievalChapterSummary: chapterSummaryForRetrieval,
            retrievalChapterTitle: structuredChapter?.title || `第${task.chapterNo}章`,
          },
        },
        { responseType: 'stream' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '调用章节大纲生成失败';
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
                chapterNo: task.chapterNo,
                outlineId,
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
                const outlineText = accumulated.trim();
                assertOutlineText(outlineText);
                callbacks.onEnd({
                  traceId,
                  outlineText,
                  outlineId,
                  basis,
                });
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : '章节大纲生成失败：大纲文本无效';
                callbacks.onError(message);
              }
              break;
            }
            case 'error': {
              sawTerminalSse = true;
              const message = typeof event.data === 'string' ? event.data : '章节大纲生成失败';
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
              assertOutlineText(fallback);
              callbacks.onEnd({
                traceId,
                outlineText: fallback,
                outlineId,
                basis,
              });
            } catch {
              callbacks.onError('章节大纲生成失败：未收到完整响应');
            }
          } else {
            callbacks.onError('章节大纲生成失败：未收到完整响应');
          }
        }
        resolveStream();
      });
      stream.on('error', (error: unknown) => rejectStream(error));
    });
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

    consistencyNotes.push(...this.buildPersonaGraphConsistencyNotes(projectId, personas));

    const usedRelationEvents = this.resolveSelectedRelationEvents(
      projectId,
      payload.selectedEventIds
    );

    let confirmedOutlineText: string;
    try {
      confirmedOutlineText = assertConfirmedOutlineForDraft(payload.confirmedOutlineText);
    } catch {
      throw new BadRequestException('生成正文前必须先确认章节大纲（confirmedOutlineText）');
    }

    const draftText = await this.generateDraftThroughOrchestrator(
      projectId,
      chapterNo,
      payload,
      settings,
      personas,
      knowledge,
      usedRelationEvents,
      confirmedOutlineText
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
        '已由 RAG Orchestrator 注入【叙事上下文】；知识库证据在已解析「结构化信息」时按文档标题匹配注入 Top10 篇全文，否则跳过知识库匹配。',
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
      existingSegmentDiagnoses?: string[];
      resumeFromSegmentIndex?: number;
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
        optimizationMode: 'single' | 'segmented';
        segmentTotal: number;
        strategyLabel: string;
        inputChapterChars: number;
      }) => void;
      onStage?: (event: {
        stage: ChapterOptimizeStage;
        segmentIndex?: number;
        segmentTotal?: number;
        retryCount?: number;
        message?: string;
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
        optimizationMode: 'single' | 'segmented';
        segmentTotal: number;
        strategyLabel: string;
        segmentDiagnoses?: string[];
      }) => void;
      onError: (message: string, recovery?: ChapterOptimizeSegmentRecovery) => void;
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

    const strategy = resolveChapterOptimizeLengthStrategy(
      chapter.content.length,
      this.resolveChapterOptimizeConfig(projectId)
    );

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

    const chapterRef = {
      chapterNo: chapter.chapterNo,
      title: chapter.title,
      content: chapter.content,
      updatedAt: chapter.updatedAt,
    };
    const relationEventRefs = usedRelationEvents.map(
      (event): ChapterOptimizeUsedRelationEvent => ({
        id: event.id,
        protagonist: event.protagonist,
        counterparty: event.counterparty,
        summary: event.summary,
        evidenceSnippet: event.evidenceSnippet,
        chapterNo: event.chapterNo,
      })
    );

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

    const chapterSummaryForRetrieval =
      (chapter.summary && chapter.summary.trim()) || chapter.content.slice(0, 160);

    const optimizationMode = strategy.mode === 'segmented' ? 'segmented' : 'single';
    let traceId = '';
    let segmentDiagnoses: string[] | undefined;

    if (strategy.mode === 'segmented') {
      const segments = splitIntoSegments(chapter.content, '', strategy.segmentCount);
      segmentDiagnoses = (Array.isArray(payload.existingSegmentDiagnoses)
        ? payload.existingSegmentDiagnoses
        : []
      )
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim());

      let startIndex = 0;
      const resumeFrom = payload.resumeFromSegmentIndex;
      if (segmentDiagnoses.length >= segments.length) {
        startIndex = segments.length;
      } else if (
        typeof resumeFrom === 'number' &&
        resumeFrom > 1 &&
        segmentDiagnoses.length > 0
      ) {
        startIndex = Math.min(resumeFrom - 1, segments.length - 1);
        segmentDiagnoses = segmentDiagnoses.slice(0, startIndex);
      }

      for (let i = startIndex; i < segments.length; i++) {
        const segment = segments[i]!;
        const diagnosisResult = await this.runSegmentDiagnosisWithRetry({
          projectId,
          chapterRef,
          instruction,
          segment,
          segments,
          segmentIndex: i,
          segmentTotal: segments.length,
          planId,
          normalizedChapterNo,
          optimizationMode,
          inputChapterChars: strategy.inputChapterChars,
          chapterSummaryForRetrieval,
          chapterTitle: chapter.title,
          appearingCharacters: payload.appearingCharacters,
          relationEventRefs,
          onStage: callbacks.onStage,
        });

        if (!diagnosisResult.ok) {
          callbacks.onError(
            `第 ${i + 1}/${segments.length} 段诊断失败：${diagnosisResult.errorMessage}`,
            {
              failedSegmentIndex: i + 1,
              segmentTotal: segments.length,
              segmentDiagnoses,
              retryable: true,
            }
          );
          return;
        }

        segmentDiagnoses.push(diagnosisResult.diagnosisText);
        segment.planExcerpt = diagnosisResult.diagnosisText;
      }

      callbacks.onStage?.({ stage: 'plan_synthesis' });
      const synthesisPrompt = buildPlanSynthesisUserPrompt({
        chapter: chapterRef,
        instruction,
        segmentDiagnoses: segmentDiagnoses.map((diagnosisText, index) => ({
          segmentIndex: index + 1,
          diagnosisText,
        })),
        appearingCharacters: payload.appearingCharacters,
        selectedRelationEvents: relationEventRefs,
      });

      let streamResult: { ok: boolean; planText: string } = { ok: false, planText: '' };
      let planStartEmitted = false;
      let lastSynthesisError = '优化方案汇总失败';
      for (let retry = 0; retry <= CHAPTER_OPTIMIZE_SEGMENT_MAX_RETRIES; retry++) {
        if (retry > 0) {
          callbacks.onStage?.({ stage: 'plan_synthesis', retryCount: retry });
        }
        let synthesisBuffer = '';
        streamResult = await this.streamOrchestratorPlanGeneration({
          projectId,
          userPrompt: synthesisPrompt,
          chapterNo: normalizedChapterNo,
          planId,
          chapterTitle: chapter.title,
          chapterSummaryForRetrieval,
          instruction,
          inputChapterChars: strategy.inputChapterChars,
          optimizationMode,
          segmentTotal: strategy.segmentCount,
          task: 'chapter.optimize.plan-synthesis',
          appearingCharacters: payload.appearingCharacters,
          callbacks: {
            onStart: (eventTraceId) => {
              traceId = eventTraceId;
              if (!planStartEmitted) {
                planStartEmitted = true;
                callbacks.onStart({
                  traceId,
                  chapterNo: normalizedChapterNo,
                  planId,
                  basis,
                  optimizationMode,
                  segmentTotal: strategy.segmentCount,
                  strategyLabel: strategy.strategyLabel,
                  inputChapterChars: strategy.inputChapterChars,
                });
              }
            },
            onContent: (text) => {
              synthesisBuffer += text;
              if (retry === 0) {
                callbacks.onContent(text);
              }
            },
            onError: (message) => {
              lastSynthesisError = message;
            },
          },
        });
        if (streamResult.ok) {
          if (retry > 0 && synthesisBuffer) {
            callbacks.onContent(synthesisBuffer);
          }
          break;
        }
      }

      if (!streamResult.ok) {
        callbacks.onError(lastSynthesisError, {
          segmentDiagnoses,
          segmentTotal: strategy.segmentCount,
          retryable: true,
        });
        return;
      }

      try {
        assertPlanText(streamResult.planText);
        callbacks.onEnd({
          traceId,
          planText: streamResult.planText,
          planId,
          basis,
          optimizationMode,
          segmentTotal: strategy.segmentCount,
          strategyLabel: strategy.strategyLabel,
          segmentDiagnoses,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '优化方案生成失败：方案文本无效';
        callbacks.onError(message);
      }
      return;
    }

    const userPrompt = buildPlanUserPrompt({
      chapter: chapterRef,
      instruction,
      appearingCharacters: payload.appearingCharacters,
      selectedRelationEvents: relationEventRefs,
    });

    const streamResult = await this.streamOrchestratorPlanGeneration({
      projectId,
      userPrompt,
      chapterNo: normalizedChapterNo,
      planId,
      chapterTitle: chapter.title,
      chapterSummaryForRetrieval,
      instruction,
      inputChapterChars: strategy.inputChapterChars,
      optimizationMode,
      segmentTotal: 1,
      task: 'chapter.optimize.plan',
      appearingCharacters: payload.appearingCharacters,
      callbacks: {
        onStart: (eventTraceId) => {
          traceId = eventTraceId;
          callbacks.onStart({
            traceId,
            chapterNo: normalizedChapterNo,
            planId,
            basis,
            optimizationMode,
            segmentTotal: 1,
            strategyLabel: strategy.strategyLabel,
            inputChapterChars: strategy.inputChapterChars,
          });
        },
        onContent: callbacks.onContent,
        onError: callbacks.onError,
      },
    });

    if (!streamResult.ok) {
      return;
    }

    try {
      assertPlanText(streamResult.planText);
      callbacks.onEnd({
        traceId,
        planText: streamResult.planText,
        planId,
        basis,
        optimizationMode,
        segmentTotal: 1,
        strategyLabel: strategy.strategyLabel,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '优化方案生成失败：方案文本无效';
      callbacks.onError(message);
    }
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
      segmentDiagnoses?: string[];
    },
    userId: string | undefined,
    callbacks: {
      onStart: (event: {
        traceId: string;
        chapterNo: number;
        optimizationMode: 'single' | 'segmented';
        segmentTotal: number;
        strategyLabel: string;
      }) => void;
      onStage?: (event: {
        stage: ChapterOptimizeStage;
        segmentIndex?: number;
        segmentTotal?: number;
        retryCount?: number;
        message?: string;
      }) => void;
      onContent: (text: string) => void;
      onEnd: (event: {
        traceId: string;
        finalDraftText?: string;
        contentSafety?: ReturnType<typeof toContentSafetyScanPayload>;
      }) => void;
      onError: (message: string, recovery?: ChapterOptimizeSegmentRecovery) => void;
      onSegmentStart?: (event: { segmentIndex: number; totalSegments: number }) => void;
      onContentReplace?: (text: string) => void;
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

    const chapterRef = {
      chapterNo: chapter.chapterNo,
      title: chapter.title,
      content: chapter.content,
      updatedAt: chapter.updatedAt,
    };
    const relationEventRefs = usedRelationEvents.map(
      (event): ChapterOptimizeUsedRelationEvent => ({
        id: event.id,
        protagonist: event.protagonist,
        counterparty: event.counterparty,
        summary: event.summary,
        evidenceSnippet: event.evidenceSnippet,
        chapterNo: event.chapterNo,
      })
    );

    const chapterSummaryForRetrieval =
      (chapter.summary && chapter.summary.trim()) || chapter.content.slice(0, 160);

    const planStrategy = resolveChapterOptimizeLengthStrategy(
      chapter.content.length,
      this.resolveChapterOptimizeConfig(projectId)
    );
    const traceId = makeOptimizationId('draft');
    callbacks.onStart({
      traceId,
      chapterNo: normalizedChapterNo,
      optimizationMode: 'single',
      segmentTotal: 1,
      strategyLabel:
        planStrategy.mode === 'segmented'
          ? '整章生成正文（方案已分段诊断）'
          : '整章生成正文',
    });

    const userPrompt = buildDraftUserPrompt({
      chapter: chapterRef,
      instruction,
      planText,
      appearingCharacters: payload.appearingCharacters,
      selectedRelationEvents: relationEventRefs,
    });

    const draftResult = await this.generateOptimizeDraftSegment({
      projectId,
      prompt: userPrompt,
      chapterNo: normalizedChapterNo,
      planId: payload.planId,
      chapterTitle: chapter.title,
      chapterSummaryForRetrieval,
      instruction,
      optimizationMode: 'single',
      segmentIndex: 0,
      segmentTotal: 1,
      inputSegmentChars: chapter.content.length,
      maxTokens: calculateSegmentMaxTokensForIndex(chapter.content, 0, 1),
      appearingCharacters: payload.appearingCharacters,
      streamToClient: true,
      onContent: callbacks.onContent,
    });

    if (!draftResult.ok) {
      callbacks.onError(draftResult.errorMessage || '优化正文生成失败');
      return;
    }

    callbacks.onStage?.({ stage: 'merge_validation' });
    const qualityCheck = validateMergedChapterDraft({
      originalContent: chapter.content,
      mergedDraft: draftResult.segmentText,
      planText,
    });

    if (!qualityCheck.passed) {
      callbacks.onError(qualityCheck.failures.join('；'));
      return;
    }

    let finalDraftText = draftResult.segmentText;
    const safety = await this.runContentSafetyForText(
      projectId,
      finalDraftText,
      traceId,
      'chapter.optimize.draft',
      (progress) => {
        callbacks.onStage?.({
          stage: progress.stage,
          message: progress.message,
        });
      }
    );

    if (safety.blocked) {
      callbacks.onError(formatContentSafetyBlockMessage(safety.blockReason, safety.hits));
      return;
    }

    finalDraftText = safety.text;
    if (finalDraftText !== draftResult.segmentText) {
      callbacks.onContentReplace?.(finalDraftText);
    }

    callbacks.onEnd({
      traceId,
      finalDraftText: finalDraftText !== draftResult.segmentText ? finalDraftText : undefined,
      contentSafety: toContentSafetyScanPayload(safety),
    });
  }

  async applyChapterOptimization(
    projectId: string,
    chapterNo: number,
    payload: {
      draftText?: string;
      expectedChapterUpdatedAt?: string;
      planId?: string;
      preserveSummary?: boolean;
    },
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

    const safety = await this.runContentSafetyForText(
      projectId,
      draftText,
      payload.planId || makeOptimizationId('draft'),
      'chapter.optimize.apply'
    );
    if (safety.blocked) {
      throw new BadRequestException({
        code: 1325,
        msg: formatContentSafetyBlockMessage(
          safety.blockReason || '内容安全扫描未通过，已阻断应用',
          safety.hits
        ),
        hits: safety.hits,
        traceId: safety.traceId,
      });
    }
    const safeDraftText = safety.text;

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

    const now = new Date();
    const summaryFields = resolveChapterSummaryOnOptimizeApply({
      preserveSummary: payload.preserveSummary,
      content: safeDraftText,
      existing: chapter,
      now,
    });

    chapter.content = safeDraftText;
    chapter.contentHash = hashChapterContent(safeDraftText);
    chapter.summary = summaryFields.summary;
    chapter.summarySource = summaryFields.summarySource;
    chapter.summaryUpdatedAt = summaryFields.summaryUpdatedAt;
    chapter.updatedAt = now;
    knowledge.indexVersion += 1;

    const settingsForApply = this.settingsStore.get(projectId)!;
    if (settingsForApply.updatePersonaOnSave !== false) {
      await this.syncPersonaGraphFromChapter(
        projectId,
        normalizedChapterNo,
        safeDraftText,
        chapter.title
      );
    }
    this.relinkRelationEventsForProject(projectId);
    this.persistState();

    if (summaryFields.reindexSummaryVector) {
      void this.indexChapterSummaryVector(projectId, chapter).catch((error) => {
        console.error(
          `[indexChapterSummaryVector] project=${projectId} chapter=${normalizedChapterNo} failed:`,
          error
        );
      });
    }

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

  async checkChapterOptimizationTypos(
    projectId: string,
    chapterNo: number,
    payload: { draftText?: string },
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

    const settings = this.settingsStore.get(projectId)!;
    const personas = this.personasStore.get(projectId)!;
    await this.syncProjectContextToOrchestrator(projectId, settings, personas, knowledge);

    const userPrompt = buildTypoCheckUserPrompt(draftText);
    const traceId = makeOptimizationId('typo-check');

    try {
      const { data } = await axios.post(
        `${this.getRagOrchestratorUrl()}/api/generate`,
        {
          projectId,
          prompt: userPrompt,
          useSSE: false,
          templateKey: CHAPTER_OPTIMIZE_TYPO_CHECK_TEMPLATE_KEY,
          context: {
            task: 'chapter.optimize.typo-check',
            chapterNo: normalizedChapterNo,
            traceId,
          },
        },
        { timeout: 120000 }
      );

      const issues = parseTypoCheckIssues(data?.content ?? data);
      return {
        issues,
        traceId,
        issueCount: issues.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '错字检查失败';
      throw new BadGatewayException({
        code: 1314,
        msg: message,
      });
    }
  }

  async fixChapterOptimizationTyposStream(
    projectId: string,
    chapterNo: number,
    payload: { draftText?: string; issues?: ChapterTypoIssueRecord[] },
    userId: string | undefined,
    callbacks: {
      onStart: (event: { traceId: string }) => void;
      onContent: (text: string) => void;
      onStage?: (event: { stage: ContentSafetyProgressStage; message?: string }) => void;
      onEnd: (event: {
        traceId: string;
        appliedIssueCount: number;
        autoCorrected: boolean;
        finalDraftText?: string;
        contentSafety?: ReturnType<typeof toContentSafetyScanPayload>;
      }) => void;
      onError: (message: string, recovery?: ChapterOptimizeSegmentRecovery) => void;
      onContentReplace?: (text: string) => void;
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

    const draftText = typeof payload.draftText === 'string' ? payload.draftText.trim() : '';
    assertDraftText(draftText);

    let issues = Array.isArray(payload.issues) ? payload.issues : [];
    if (issues.length === 0) {
      const checkResult = await this.checkChapterOptimizationTypos(
        projectId,
        normalizedChapterNo,
        { draftText },
        userId
      );
      issues = checkResult.issues;
    }

    const traceId = makeOptimizationId('typo-fix');
    const userPrompt = buildTypoFixUserPrompt(draftText, issues);

    const settings = this.settingsStore.get(projectId)!;
    const personas = this.personasStore.get(projectId)!;
    await this.syncProjectContextToOrchestrator(projectId, settings, personas, knowledge);

    let response;
    try {
      response = await axios.post(
        `${this.getRagOrchestratorUrl()}/api/generate`,
        {
          projectId,
          prompt: userPrompt,
          useSSE: true,
          templateKey: CHAPTER_OPTIMIZE_TYPO_FIX_TEMPLATE_KEY,
          context: {
            task: 'chapter.optimize.typo-fix',
            chapterNo: normalizedChapterNo,
            traceId,
            appliedIssueCount: issues.length,
          },
        },
        { responseType: 'stream' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '错字自动修正失败';
      throw new BadGatewayException({
        code: 1315,
        msg: message,
      });
    }

    let firstStartEmitted = false;
    let buffer = '';
    let accumulatedDraft = '';

    await new Promise<void>((resolveStream, rejectStream) => {
      let streamResolved = false;
      const completeStream = () => {
        if (streamResolved) {
          return;
        }
        streamResolved = true;
        resolveStream();
      };

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
              const eventTraceId = typeof event.traceId === 'string' ? event.traceId : traceId;
              if (!firstStartEmitted) {
                callbacks.onStart({ traceId: eventTraceId });
                firstStartEmitted = true;
              }
              break;
            }
            case 'content': {
              const raw = typeof event.data === 'string' ? event.data : '';
              const piece = raw.replace(/\\n/g, '\n');
              accumulatedDraft += piece;
              callbacks.onContent(piece);
              break;
            }
            case 'end': {
              const eventTraceId = typeof event.traceId === 'string' ? event.traceId : traceId;
              void (async () => {
                try {
                  const safety = await this.runContentSafetyForText(
                    projectId,
                    accumulatedDraft,
                    eventTraceId,
                    'chapter.optimize.typo-fix',
                    (progress) => {
                      callbacks.onStage?.({
                        stage: progress.stage,
                        message: progress.message,
                      });
                    }
                  );
                  if (safety.blocked) {
                    callbacks.onError(
                      formatContentSafetyBlockMessage(safety.blockReason, safety.hits)
                    );
                    resolveStream();
                    return;
                  }
                  if (safety.text !== accumulatedDraft) {
                    callbacks.onContentReplace?.(safety.text);
                  }
                  callbacks.onEnd({
                    traceId: eventTraceId,
                    appliedIssueCount: issues.length,
                    autoCorrected: true,
                    finalDraftText:
                      safety.text !== accumulatedDraft ? safety.text : undefined,
                    contentSafety: toContentSafetyScanPayload(safety),
                  });
                } catch (error) {
                  const message =
                    error instanceof Error ? error.message : '内容安全扫描失败';
                  callbacks.onError(message);
                } finally {
                  completeStream();
                }
              })();
              break;
            }
            case 'error': {
              const message = typeof event.data === 'string' ? event.data : '错字自动修正失败';
              callbacks.onError(message);
              completeStream();
              break;
            }
          }
        }
      });

      stream.on('end', () => completeStream());
      stream.on('error', (error: unknown) => rejectStream(error));
    });
  }

  exportProjectChaptersTxt(projectId: string, userId?: string) {
    if (userId) {
      this.checkAccess(projectId, userId, ['owner', 'editor', 'viewer']);
    }
    const project = this.getProjectOrThrow(projectId);
    this.ensureProjectState(projectId);

    const knowledge = this.knowledgeStore.get(projectId)!;
    const chapters = knowledge.chapters.filter((item) => item.content?.trim());
    if (chapters.length === 0) {
      throw new BadRequestException({
        code: 1316,
        msg: '当前项目暂无可导出的章节正文',
      });
    }

    const body = buildChaptersTxtExport(
      chapters.map((chapter) => ({
        chapterNo: chapter.chapterNo,
        title: chapter.title,
        content: chapter.content,
      }))
    );

    return {
      filename: buildChaptersExportFilename(project.name || projectId),
      body,
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
    const payload = this.buildPersistedPayload();
    const targetDir = dirname(this.storagePath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
    if (usePostgresPersistence()) {
      void syncWorkspaceToPostgres(this.prisma, payload).catch((err) =>
        console.error('[persistence] workspace PG 同步失败', err)
      );
    }
  }

  private buildPersistedPayload(): PersistedProjectState {
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
      identityRelations: {},
    };

    for (const [projectId, settings] of this.settingsStore.entries()) {
      this.patchSettingsDefaults(settings);
      payload.settings[projectId] = serializeProjectSettingsForJsonMirror({
        ...settings,
        activePersonaId: settings.activePersonaId ?? null,
      });
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
        ...(knowledge.workbenchStructuredByChapter &&
        Object.keys(knowledge.workbenchStructuredByChapter).length > 0
          ? {
              workbenchStructuredByChapter: Object.fromEntries(
                Object.entries(knowledge.workbenchStructuredByChapter).map(([key, value]) => [
                  String(key),
                  value,
                ])
              ),
            }
          : {}),
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

    for (const [projectId, relations] of this.identityRelationsStore.entries()) {
      payload.identityRelations[projectId] = relations.map((relation) => ({
        ...relation,
        createdAt: relation.createdAt.toISOString(),
        updatedAt: relation.updatedAt.toISOString(),
      }));
    }

    return payload;
  }

  private restoreStateFromDisk(): RestoredWorkspace | null {
    if (!existsSync(this.storagePath)) {
      return null;
    }

    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedProjectState;
      return this.mapPersistedToRuntime(parsed);
    } catch {
      return null;
    }
  }

  private mapPersistedToRuntime(parsed: PersistedProjectState): RestoredWorkspace {
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
            chapterSummaryPromptCount: clampChapterSummaryPromptCount(
              value.chapterSummaryPromptCount
            ),
            chapterSummaryMemoryCount: clampChapterSummaryMemoryCount(
              value.chapterSummaryMemoryCount
            ),
            priorChapterTailChars: clampPriorChapterTailChars(
              value.priorChapterTailChars ?? DEFAULT_PRIOR_CHAPTER_TAIL_CHARS
            ),
            contextExcerptMaxChars: clampContextExcerptMaxChars(
              value.contextExcerptMaxChars ?? DEFAULT_CONTEXT_EXCERPT_MAX_CHARS
            ),
            generationTemperature: clampGenerationTemperature(value.generationTemperature),
            updatePersonaOnSave: value.updatePersonaOnSave ?? true,
            generateRelationEventsOnSave: value.generateRelationEventsOnSave ?? true,
            chapterOptimizeSegmentCharSize: clampChapterOptimizeSegmentCharSize(
              value.chapterOptimizeSegmentCharSize ?? DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE
            ),
            contentSafetyScanEnabled: value.contentSafetyScanEnabled ?? true,
            contentSafetyCustomRules: sanitizeProjectContentSafetyRules(
              value.contentSafetyCustomRules
            ),
            updatedAt: new Date(value.updatedAt),
          },
        ])
      ),
      personas: Object.fromEntries(
        Object.entries(parsed.personas || {}).map(([projectId, personas]) => [
          projectId,
          (personas || []).map((persona) => {
            const graph = normalizePersonaGraphFields(persona);
            return {
              ...persona,
              ...graph,
              state:
                typeof persona.state === 'string' && persona.state.trim()
                  ? persona.state
                  : '待更新',
              createdAt: new Date(persona.createdAt),
              updatedAt: new Date(persona.updatedAt),
            };
          }),
        ])
      ),
      knowledge: Object.fromEntries(
        Object.entries(parsed.knowledge || {}).map(([projectId, knowledge]) => [
          projectId,
          {
            outlineSummary: knowledge.outlineSummary,
            chapters: (knowledge.chapters || []).map((chapter) => ({
              ...chapter,
              contentHash:
                typeof chapter.contentHash === 'string' ? chapter.contentHash : undefined,
              summarySource: chapter.summarySource as ChapterSummarySource | undefined,
              updatedAt: new Date(chapter.updatedAt),
              summaryUpdatedAt: chapter.summaryUpdatedAt
                ? new Date(chapter.summaryUpdatedAt)
                : undefined,
            })),
            workbenchStructuredByChapter: this.parsePersistedWorkbenchStructuredDrafts(
              knowledge.workbenchStructuredByChapter
            ),
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
            mode: job.mode as IndexMode,
            status: job.status as IndexJobStatus,
            createdAt: new Date(job.createdAt),
            completedAt: job.completedAt ? new Date(job.completedAt) : null,
          })),
        ])
      ),
      summarizeJobs: Object.fromEntries(
        Object.entries(parsed.summarizeJobs || {}).map(([projectId, jobs]) => [
          projectId,
          (jobs || []).map((job) => ({
            id: job.id,
            projectId: job.projectId,
            scope: job.scope as SummaryJobScope,
            chapterNo: job.chapterNo,
            status: job.status as SummaryJobStatus,
            totalChapters: job.totalChapters,
            processedChapters: job.processedChapters,
            chapterNos: job.chapterNos ?? [],
            summaries: (job.summaries || []).map((s) => ({
              chapterNo: s.chapterNo,
              summary: s.summary,
              summarySource: (s.summarySource === 'llm'
                ? 'llm'
                : 'fallback') as ChapterSummarySource,
            })),
            createdAt: new Date(job.createdAt),
            completedAt: job.completedAt ? new Date(job.completedAt) : null,
            errorMessage: job.errorMessage,
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
              protagonistPersonaId:
                typeof event.protagonistPersonaId === 'string' ? event.protagonistPersonaId : null,
              counterpartyPersonaId:
                typeof event.counterpartyPersonaId === 'string'
                  ? event.counterpartyPersonaId
                  : null,
              createdAt: new Date(event.createdAt),
              updatedAt: new Date(event.updatedAt),
              deletedAt: event.deletedAt ? new Date(event.deletedAt) : null,
            };
          }),
        ])
      ),
      identityRelations: Object.fromEntries(
        Object.entries(parsed.identityRelations || {}).map(([projectId, relations]) => [
          projectId,
          (relations || []).map((relation) => ({
            id: relation.id,
            projectId: relation.projectId,
            fromPersonaId: relation.fromPersonaId,
            toPersonaId: relation.toPersonaId,
            relation: relation.relation,
            source: relation.source === 'manual' ? 'manual' : 'llm',
            chapterNo:
              typeof relation.chapterNo === 'number' && Number.isFinite(relation.chapterNo)
                ? relation.chapterNo
                : null,
            evidenceSnippet: relation.evidenceSnippet,
            createdAt: new Date(relation.createdAt),
            updatedAt: new Date(relation.updatedAt),
          })),
        ])
      ),
    };
  }

  private applyRestoredWorkspace(restored: RestoredWorkspace) {
    this.projects.splice(0, this.projects.length, ...restored.projects);
    this.members.splice(0, this.members.length, ...restored.members);
    this.settingsStore.clear();
    this.personasStore.clear();
    this.knowledgeStore.clear();
    this.indexJobsStore.clear();
    this.summarizeJobsStore.clear();
    this.relationEventsStore.clear();
    this.identityRelationsStore.clear();
    this.hydrateMap(this.settingsStore, restored.settings);
    this.hydrateMap(this.personasStore, restored.personas);
    this.hydrateMap(this.knowledgeStore, restored.knowledge);
    this.hydrateMap(this.indexJobsStore, restored.indexJobs);
    this.hydrateMap(this.summarizeJobsStore, restored.summarizeJobs);
    this.hydrateMap(this.relationEventsStore, restored.relationEvents);
    this.hydrateMap(this.identityRelationsStore, restored.identityRelations ?? {});
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

  private async syncPersonaGraphFromChapter(
    projectId: string,
    chapterNo: number,
    chapterContent: string,
    chapterTitle?: string
  ) {
    const personas = this.personasStore.get(projectId)!;
    if (personas.length === 0) {
      return;
    }

    const roster = personas.map((persona) => ({ id: persona.id, name: persona.name }));
    let batchApplied = false;

    try {
      const { data } = await axios.post<{ personas?: unknown }>(
        `${this.getRagOrchestratorUrl()}/api/extract/chapter-personas`,
        {
          chapterNo,
          title: chapterTitle?.trim() || undefined,
          content: chapterContent,
          personas: personas.map((persona) => {
            const prior = resolvePersonaSnapshotAsOfChapter(persona.chapterStates, chapterNo);
            return {
              name: persona.name,
              profile: persona.profile,
              state: persona.state,
              priorSnapshot: prior?.snapshot ?? snapshotFromLegacyState(persona.state),
            };
          }),
        },
        { timeout: 120000 }
      );

      const items = parseChapterPersonaStatesFromModelContent(data?.personas ?? data);
      if (items.length > 0) {
        const byName = new Map(items.map((item) => [item.name.trim(), item]));
        for (const persona of personas) {
          const item = byName.get(persona.name.trim());
          if (item) {
            const snapshot =
              item.snapshot ??
              normalizePersonaSnapshot(snapshotFromLegacyState(item.state ?? item.summaryLine));
            const summaryLine =
              item.summaryLine?.trim() ||
              buildSummaryLineFromSnapshot(snapshot) ||
              item.state?.trim() ||
              persona.state;
            persona.chapterStates = upsertPersonaChapterState(persona.chapterStates, {
              chapterNo,
              appeared: item.appeared,
              snapshot,
              summaryLine,
            });
            if (summaryLine) {
              persona.state = summaryLine;
            }
            if (item.appeared) {
              persona.appearedChapterNos = addChapterAppearance(
                persona.appearedChapterNos,
                chapterNo
              );
            } else {
              persona.appearedChapterNos = removeChapterFromAppearances(
                persona.appearedChapterNos,
                chapterNo
              );
            }
            persona.lastAppearedChapterNo = computeLastAppearedChapterNo(
              persona.appearedChapterNos
            );
            persona.updatedAt = new Date();
            continue;
          }

          await this.applyFallbackPersonaChapterSync(
            projectId,
            persona,
            roster,
            chapterNo,
            chapterContent
          );
        }
        batchApplied = true;
      }
    } catch {
      batchApplied = false;
    }

    if (!batchApplied) {
      updateAppearancesForChapter(personas, chapterNo, chapterContent);
      for (const persona of personas) {
        await this.applyFallbackPersonaChapterSync(
          projectId,
          persona,
          roster,
          chapterNo,
          chapterContent
        );
      }
    }
  }

  private async applyFallbackPersonaChapterSync(
    projectId: string,
    persona: PersonaRecord,
    roster: Array<{ id: string; name: string }>,
    chapterNo: number,
    chapterContent: string
  ) {
    const appeared = personaAppearsInChapterContent(persona, roster, chapterContent);
    if (appeared) {
      persona.appearedChapterNos = addChapterAppearance(persona.appearedChapterNos, chapterNo);
    } else {
      persona.appearedChapterNos = removeChapterFromAppearances(
        persona.appearedChapterNos,
        chapterNo
      );
    }
    persona.lastAppearedChapterNo = computeLastAppearedChapterNo(persona.appearedChapterNos);

    if (appeared) {
      const nextState = await this.generatePersonaState({
        projectId,
        chapterNo,
        chapterContent,
        personaName: persona.name,
        personaProfile: persona.profile,
        currentState: persona.state,
        priorSnapshot:
          resolvePersonaSnapshotAsOfChapter(persona.chapterStates, chapterNo)?.snapshot ??
          snapshotFromLegacyState(persona.state),
      });

      const snapshot =
        tryParsePersonaSnapshotFromText(nextState) ??
        snapshotFromLegacyState(resolvePersonaStateText(nextState) || persona.state);
      const summaryLine =
        buildSummaryLineFromSnapshot(snapshot) ||
        resolvePersonaStateText(nextState) ||
        clampPersonaStateText(nextState);
      if (summaryLine && summaryLine !== persona.state) {
        persona.state = summaryLine;
      }
      persona.chapterStates = upsertPersonaChapterState(persona.chapterStates, {
        chapterNo,
        appeared: true,
        snapshot,
        summaryLine,
      });
    }
    persona.updatedAt = new Date();
  }

  private async generatePersonaState(input: {
    projectId: string;
    chapterNo: number;
    chapterContent: string;
    personaName: string;
    personaProfile: string;
    currentState: string;
    priorSnapshot?: PersonaSnapshot;
  }) {
    const fallbackState = buildFallbackPersonaState(input.chapterNo, input.chapterContent);
    const priorLine = buildSummaryLineFromSnapshot(input.priorSnapshot ?? {});
    const prompt = [
      `你是小说角色状态提取器。`,
      `请基于人物设定与第${input.chapterNo}章正文，输出该人物读完本章后的结构化快照（JSON）。`,
      `字段：clothing（着装）、appearance（外貌）、status（瞬时状态/情绪/伤势）、location（位置）、possessions（持有物）。`,
      `若正文未明确换装或形象变化，clothing/appearance 须与历史快照一致。`,
      `禁止输出解释、禁止 Markdown，只输出 JSON 对象。`,
      '',
      `人物名：${input.personaName}`,
      `人物设定：${input.personaProfile}`,
      `历史快照：${priorLine || input.currentState || '暂无'}`,
      '',
      `第${input.chapterNo}章正文：`,
      trimForPrompt(input.chapterContent, 2200),
      '',
      '只输出 JSON：{"clothing":"...","appearance":"...","status":"...","location":"...","possessions":"..."}',
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

      const rawContent = String(data?.content || '').trim();
      const resolved = resolvePersonaStateText(rawContent);
      if (resolved) {
        return clampPersonaStateText(resolved);
      }

      return clampPersonaStateText(fallbackState);
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

    await this.upsertChapter(
      projectId,
      {
        chapterNo,
        title: chapterTitle,
        content: draftText,
      },
      undefined,
      { postWriteMode: 'auto' }
    );

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
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i]!;
        const result = await this.summarizeChapterContent(chapter);
        chapter.summary = result.summary;
        chapter.summarySource = result.summarySource;
        chapter.summaryUpdatedAt = new Date();
        chapter.updatedAt = new Date();
        if (result.summarySource === 'llm') {
          try {
            await this.extractAndMergeIdentityRelationsFromChapter(projectId, chapter);
          } catch {
            // 身份关系抽取失败不阻断摘要任务
          }
        }
        await this.indexChapterSummaryVectorWithRateLimit(projectId, chapter, {
          throttleBefore: i > 0,
        });
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

  private async indexChapterSummaryVector(
    projectId: string,
    chapter: ChapterRecord
  ): Promise<void> {
    const summary = chapter.summary?.trim();
    if (!summary) {
      return;
    }
    await axios.post(
      `${this.getRagOrchestratorUrl()}/api/projects/${projectId}/chapters/${chapter.chapterNo}/index-summary`,
      { title: chapter.title, summary },
      { timeout: 30000 }
    );
  }

  /** 批量写入向量库时限速 + 可重试（单章保存仍走 indexChapterSummaryVector） */
  private async indexChapterSummaryVectorWithRateLimit(
    projectId: string,
    chapter: ChapterRecord,
    options?: { throttleBefore?: boolean }
  ): Promise<void> {
    if (options?.throttleBefore) {
      await sleep(resolveChapterSummaryIndexDelayMs());
    }

    const maxRetries = resolveChapterSummaryIndexMaxRetries();
    const retryBaseMs = resolveChapterSummaryIndexRetryBaseMs();
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.indexChapterSummaryVector(projectId, chapter);
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries || !isRetryableChapterSummaryIndexError(error)) {
          throw error;
        }
        await sleep(resolveChapterSummaryIndexRetryDelayMs(attempt, retryBaseMs));
      }
    }

    throw lastError;
  }

  private async extractAndMergeIdentityRelationsFromChapter(
    projectId: string,
    chapter: ChapterRecord
  ): Promise<void> {
    if (!chapter.content.trim()) {
      return;
    }

    const personas = this.personasStore.get(projectId) ?? [];
    const personaNames = personas.map((item) => item.name).filter(Boolean);
    if (personaNames.length < 2) {
      return;
    }

    let candidates;
    try {
      const response = await axios.post<{ relations?: unknown }>(
        `${this.getRagOrchestratorUrl()}/api/extract/identity-relations`,
        {
          chapterNo: chapter.chapterNo,
          title: chapter.title,
          content: chapter.content,
          personaNames,
        },
        { timeout: 120000 }
      );
      candidates = parseExtractedIdentityRelationCandidates(
        response.data?.relations ?? response.data
      );
    } catch {
      return;
    }

    if (candidates.length === 0) {
      return;
    }

    const existing = this.identityRelationsStore.get(projectId) ?? [];
    const merged = mergeIdentityRelationCandidates({
      projectId,
      chapterNo: chapter.chapterNo,
      existing,
      candidates,
      personas,
    });

    if (merged.addedCount === 0 && merged.updatedCount === 0) {
      return;
    }

    this.identityRelationsStore.set(projectId, merged.records);
    this.persistState();
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
        chapterSummaryPromptCount: DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT,
        chapterSummaryMemoryCount: DEFAULT_CHAPTER_SUMMARY_MEMORY_COUNT,
        priorChapterTailChars: DEFAULT_PRIOR_CHAPTER_TAIL_CHARS,
        contextExcerptMaxChars: DEFAULT_CONTEXT_EXCERPT_MAX_CHARS,
        generationTemperature: DEFAULT_GENERATION_TEMPERATURE,
        updatePersonaOnSave: true,
        generateRelationEventsOnSave: true,
        chapterOptimizeSegmentCharSize: DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE,
        contentSafetyScanEnabled: true,
        contentSafetyCustomRules: [],
        updatedAt: new Date(),
      });
    } else {
      this.patchSettingsDefaults(this.settingsStore.get(projectId)!);
    }

    if (!this.personasStore.has(projectId)) {
      this.personasStore.set(projectId, []);
    }

    if (!this.knowledgeStore.has(projectId)) {
      this.knowledgeStore.set(projectId, {
        outlineSummary: '',
        chapters: [],
        workbenchStructuredByChapter: {},
        indexVersion: 0,
        lastIndexedAt: null,
      });
    } else if (!this.knowledgeStore.get(projectId)!.workbenchStructuredByChapter) {
      this.knowledgeStore.get(projectId)!.workbenchStructuredByChapter = {};
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

    if (!this.identityRelationsStore.has(projectId)) {
      this.identityRelationsStore.set(projectId, []);
    }
  }

  private patchSettingsDefaults(settings: ProjectSettings) {
    settings.chapterSummaryPromptCount = clampChapterSummaryPromptCount(
      settings.chapterSummaryPromptCount
    );
    settings.chapterSummaryMemoryCount = clampChapterSummaryMemoryCount(
      settings.chapterSummaryMemoryCount
    );
    settings.priorChapterTailChars = clampPriorChapterTailChars(
      settings.priorChapterTailChars ?? DEFAULT_PRIOR_CHAPTER_TAIL_CHARS
    );
    settings.contextExcerptMaxChars = clampContextExcerptMaxChars(
      settings.contextExcerptMaxChars ?? DEFAULT_CONTEXT_EXCERPT_MAX_CHARS
    );
    settings.generationTemperature = clampGenerationTemperature(settings.generationTemperature);
    if (settings.updatePersonaOnSave === undefined) {
      settings.updatePersonaOnSave = true;
    }
    if (settings.generateRelationEventsOnSave === undefined) {
      settings.generateRelationEventsOnSave = true;
    }
    settings.chapterOptimizeSegmentCharSize = clampChapterOptimizeSegmentCharSize(
      settings.chapterOptimizeSegmentCharSize ?? DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE
    );
    if (settings.contentSafetyScanEnabled === undefined) {
      settings.contentSafetyScanEnabled = true;
    }
    settings.contentSafetyCustomRules = sanitizeProjectContentSafetyRules(
      settings.contentSafetyCustomRules
    );
  }

  private serializeProjectSettings(settings: ProjectSettings): ProjectSettings {
    this.patchSettingsDefaults(settings);
    return {
      systemPromptText: settings.systemPromptText,
      activePersonaId: settings.activePersonaId,
      chapterSummaryPromptCount: settings.chapterSummaryPromptCount,
      chapterSummaryMemoryCount: settings.chapterSummaryMemoryCount,
      priorChapterTailChars: settings.priorChapterTailChars,
      contextExcerptMaxChars: settings.contextExcerptMaxChars,
      generationTemperature: settings.generationTemperature,
      updatePersonaOnSave: settings.updatePersonaOnSave,
      generateRelationEventsOnSave: settings.generateRelationEventsOnSave,
      chapterOptimizeSegmentCharSize: settings.chapterOptimizeSegmentCharSize,
      contentSafetyScanEnabled: settings.contentSafetyScanEnabled,
      contentSafetyCustomRules: settings.contentSafetyCustomRules.map((rule) => ({ ...rule })),
      updatedAt: settings.updatedAt,
    };
  }

  private jsonMirrorNeedsExtensionBackfill(): boolean {
    if (!existsSync(this.storagePath)) {
      return false;
    }
    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedProjectState;
      for (const jsonSettings of Object.values(parsed.settings || {})) {
        if (!Array.isArray(jsonSettings.contentSafetyCustomRules)) {
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  private mergeJsonMirrorSettingsExtensionsForProject(projectId: string) {
    if (!existsSync(this.storagePath)) {
      return;
    }
    if (!this.settingsStore.has(projectId)) {
      return;
    }
    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedProjectState;
      const jsonSettings = parsed.settings?.[projectId];
      if (!jsonSettings) {
        return;
      }
      const settings = this.settingsStore.get(projectId)!;
      applyProjectSettingsJsonExtensions(
        settings,
        pickProjectSettingsJsonExtensions(jsonSettings)
      );
      this.patchSettingsDefaults(settings);
    } catch {
      // JSON 镜像损坏时跳过扩展字段合并
    }
  }

  private mergeJsonMirrorSettingsExtensions() {
    if (!existsSync(this.storagePath)) {
      return;
    }
    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedProjectState;
      for (const [projectId, settings] of this.settingsStore.entries()) {
        const jsonSettings = parsed.settings?.[projectId];
        if (!jsonSettings) {
          continue;
        }
        applyProjectSettingsJsonExtensions(
          settings,
          pickProjectSettingsJsonExtensions(jsonSettings)
        );
        this.patchSettingsDefaults(settings);
      }
    } catch {
      // JSON 镜像损坏时跳过扩展字段合并
    }
  }

  private buildContentSafetyRules(projectId: string) {
    this.ensureProjectState(projectId);
    const settings = this.settingsStore.get(projectId)!;
    return mergeContentSafetyRules(settings.contentSafetyCustomRules);
  }

  private resolveChapterOptimizeConfig(projectId: string) {
    this.ensureProjectState(projectId);
    const settings = this.settingsStore.get(projectId)!;
    return resolveChapterOptimizeConfigWithProjectOverride(
      settings.chapterOptimizeSegmentCharSize
    );
  }

  private ensureWorkbenchStructuredDrafts(
    knowledge: KnowledgeRecord
  ): Record<number, ChapterStructuredInfoPersisted> {
    if (!knowledge.workbenchStructuredByChapter) {
      knowledge.workbenchStructuredByChapter = {};
    }
    return knowledge.workbenchStructuredByChapter;
  }

  private parsePersistedWorkbenchStructuredDrafts(
    raw?: Record<string, ChapterStructuredInfoPersisted>
  ): Record<number, ChapterStructuredInfoPersisted> {
    if (!raw || typeof raw !== 'object') {
      return {};
    }
    const drafts: Record<number, ChapterStructuredInfoPersisted> = {};
    for (const [key, value] of Object.entries(raw)) {
      const chapterNo = Number(key);
      if (!Number.isFinite(chapterNo) || chapterNo <= 0 || !value || typeof value !== 'object') {
        continue;
      }
      drafts[chapterNo] = value;
    }
    return drafts;
  }

  /** 将历史误创建的空章节（仅 workbench 结构化）迁回草稿，避免章节列表出现空章 */
  private migrateOrphanWorkbenchStructuredChapters(knowledge: KnowledgeRecord): boolean {
    const drafts = this.ensureWorkbenchStructuredDrafts(knowledge);
    const retained: ChapterRecord[] = [];

    for (const chapter of knowledge.chapters) {
      const defaultTitle = `第${chapter.chapterNo}章`;
      const isOrphanWorkbenchStructured =
        !chapter.content?.trim() &&
        chapter.structuredInfo?.parseSource === 'workbench' &&
        (!chapter.title?.trim() || chapter.title.trim() === defaultTitle);

      if (isOrphanWorkbenchStructured && chapter.structuredInfo) {
        drafts[chapter.chapterNo] = chapter.structuredInfo;
        continue;
      }
      retained.push(chapter);
    }

    const changed = retained.length !== knowledge.chapters.length;
    knowledge.chapters = retained;
    return changed;
  }

  private buildOrchestratorChapterContexts(
    knowledge: KnowledgeRecord,
    settings: { priorChapterTailChars: number; contextExcerptMaxChars: number }
  ) {
    const tailK = Math.max(settings.priorChapterTailChars, settings.contextExcerptMaxChars);
    const byNo = new Map<
      number,
      {
        chapterNo: number;
        title: string;
        summary: string;
        content: string;
        contentTail: string;
        structuredMatchingText?: string;
      }
    >();

    for (const chapter of knowledge.chapters) {
      byNo.set(chapter.chapterNo, {
        chapterNo: chapter.chapterNo,
        title: chapter.title,
        summary: chapter.summary || '',
        content: chapter.content,
        contentTail: sliceContentTail(chapter.content, tailK),
        structuredMatchingText: resolveStructuredMatchingTextForSync(chapter.structuredInfo ?? {}),
      });
    }

    for (const [key, draft] of Object.entries(knowledge.workbenchStructuredByChapter ?? {})) {
      const chapterNo = Number(key);
      if (!Number.isFinite(chapterNo) || chapterNo <= 0 || byNo.has(chapterNo)) {
        continue;
      }
      byNo.set(chapterNo, {
        chapterNo,
        title: `第${chapterNo}章`,
        summary: '',
        content: '',
        contentTail: '',
        structuredMatchingText: resolveStructuredMatchingTextForSync(draft),
      });
    }

    return [...byNo.values()].sort((a, b) => a.chapterNo - b.chapterNo);
  }

  private getProjectOrThrow(projectId: string) {
    this.assertProjectId(projectId);
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new NotFoundException(`未找到项目: ${projectId}`);
    }
    return project;
  }

  /**
   * 分段诊断：失败时自动重试，最多 CHAPTER_OPTIMIZE_SEGMENT_MAX_RETRIES 次。
   */
  private async runSegmentDiagnosisWithRetry(input: {
    projectId: string;
    chapterRef: {
      chapterNo: number;
      title: string;
      content: string;
      updatedAt: Date;
    };
    instruction: string;
    segment: Segment;
    segments: Segment[];
    segmentIndex: number;
    segmentTotal: number;
    planId: string;
    normalizedChapterNo: number;
    optimizationMode: 'single' | 'segmented';
    inputChapterChars: number;
    chapterSummaryForRetrieval: string;
    chapterTitle: string;
    appearingCharacters?: string[];
    relationEventRefs: ChapterOptimizeUsedRelationEvent[];
    onStage?: (event: {
      stage: ChapterOptimizeStage;
      segmentIndex?: number;
      segmentTotal?: number;
      retryCount?: number;
    }) => void;
  }): Promise<
    { ok: true; diagnosisText: string } | { ok: false; errorMessage: string }
  > {
    const boundaryAnchors = buildSegmentBoundaryAnchors(input.segment, input.segments);
    const diagnosisPrompt = buildSegmentDiagnosisUserPrompt({
      chapter: input.chapterRef,
      instruction: input.instruction,
      segment: input.segment,
      totalSegments: input.segmentTotal,
      appearingCharacters: input.appearingCharacters,
      selectedRelationEvents: input.relationEventRefs,
      boundaryAnchors,
    });

    let lastError = '未收到有效诊断';
    for (let retry = 0; retry <= CHAPTER_OPTIMIZE_SEGMENT_MAX_RETRIES; retry++) {
      input.onStage?.({
        stage: 'segment_diagnosis',
        segmentIndex: input.segmentIndex + 1,
        segmentTotal: input.segmentTotal,
        retryCount: retry > 0 ? retry : undefined,
      });

      try {
        const diagnosisText = await this.callOrchestratorGeneratePlainText({
          projectId: input.projectId,
          prompt: diagnosisPrompt,
          templateKey: CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
          context: {
            task: 'chapter.optimize.segment-diagnosis',
            chapterNo: input.normalizedChapterNo,
            planId: input.planId,
            segmentIndex: input.segment.index,
            segmentTotal: input.segmentTotal,
            segmentOriginalChars: input.segment.originalText.length,
            optimizationMode: input.optimizationMode,
            inputChapterChars: input.inputChapterChars,
            retryCount: retry,
            retrievalInstruction: input.instruction,
            retrievalChapterSummary: input.chapterSummaryForRetrieval,
            retrievalChapterTitle: input.chapterTitle,
          },
        });

        if (diagnosisText.trim()) {
          return { ok: true, diagnosisText: diagnosisText.trim() };
        }
        lastError = '未收到有效诊断';
      } catch (error) {
        lastError = error instanceof Error ? error.message : '分段诊断失败';
      }
    }

    return { ok: false, errorMessage: lastError };
  }

  private async callOrchestratorGeneratePlainText(input: {
    projectId: string;
    prompt: string;
    templateKey: string;
    context: Record<string, unknown>;
    maxTokens?: number;
  }): Promise<string> {
    const { data } = await axios.post(
      `${this.getRagOrchestratorUrl()}/api/generate`,
      {
        projectId: input.projectId,
        prompt: input.prompt,
        useSSE: false,
        templateKey: input.templateKey,
        maxTokens: input.maxTokens,
        context: input.context,
      },
      { timeout: 180000 }
    );

    const content = typeof data?.content === 'string' ? data.content : '';
    return content.trim();
  }

  private async streamOrchestratorPlanGeneration(input: {
    projectId: string;
    userPrompt: string;
    chapterNo: number;
    planId: string;
    chapterTitle: string;
    chapterSummaryForRetrieval: string;
    instruction: string;
    inputChapterChars: number;
    optimizationMode: 'single' | 'segmented';
    segmentTotal: number;
    task: string;
    appearingCharacters?: string[];
    callbacks: {
      onStart: (traceId: string) => void;
      onContent: (text: string) => void;
      onError: (message: string, recovery?: ChapterOptimizeSegmentRecovery) => void;
    };
  }): Promise<{ ok: boolean; planText: string }> {
    let response;
    try {
      response = await axios.post(
        `${this.getRagOrchestratorUrl()}/api/generate`,
        {
          projectId: input.projectId,
          prompt: input.userPrompt,
          useSSE: true,
          templateKey: CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
          context: {
            task: input.task,
            chapterNo: input.chapterNo,
            planId: input.planId,
            inputChapterChars: input.inputChapterChars,
            inputContextChars: input.userPrompt.length,
            optimizationMode: input.optimizationMode,
            segmentTotal: input.segmentTotal,
            retrievalInstruction: input.instruction,
            retrievalChapterSummary: input.chapterSummaryForRetrieval,
            retrievalChapterTitle: input.chapterTitle,
            ...(input.appearingCharacters?.length
              ? { appearingCharacters: input.appearingCharacters }
              : {}),
          },
        },
        { responseType: 'stream' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '调用优化方案生成失败';
      input.callbacks.onError(message);
      return { ok: false, planText: '' };
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
              input.callbacks.onStart(traceId);
              break;
            }
            case 'content': {
              const raw = typeof event.data === 'string' ? event.data : '';
              const piece = raw.replace(/\\n/g, '\n');
              accumulated += piece;
              input.callbacks.onContent(piece);
              break;
            }
            case 'end': {
              sawTerminalSse = true;
              traceId = typeof event.traceId === 'string' ? event.traceId : traceId;
              break;
            }
            case 'error': {
              sawTerminalSse = true;
              const message = typeof event.data === 'string' ? event.data : '优化方案生成失败';
              input.callbacks.onError(message);
              break;
            }
          }
        }
      });

      stream.on('end', () => {
        if (!sawTerminalSse) {
          const fallback = accumulated.trim();
          if (!fallback) {
            input.callbacks.onError('优化方案生成失败：未收到完整响应');
          }
        }
        resolveStream();
      });
      stream.on('error', (error: unknown) => rejectStream(error));
    });

    const planText = accumulated.trim();
    if (!planText) {
      return { ok: false, planText: '' };
    }
    return { ok: true, planText };
  }

  private async generateOptimizeDraftSegment(input: {
    projectId: string;
    prompt: string;
    chapterNo: number;
    planId?: string;
    chapterTitle: string;
    chapterSummaryForRetrieval: string;
    instruction: string;
    optimizationMode: 'single' | 'segmented';
    segmentIndex: number;
    segmentTotal: number;
    inputSegmentChars: number;
    maxTokens: number;
    appearingCharacters?: string[];
    streamToClient: boolean;
    retryCount?: number;
    onContent?: (text: string) => void;
  }): Promise<{ ok: boolean; segmentText: string; errorMessage?: string }> {
    let response;
    try {
      response = await axios.post(
        `${this.getRagOrchestratorUrl()}/api/generate`,
        {
          projectId: input.projectId,
          prompt: input.prompt,
          useSSE: true,
          templateKey: CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
          maxTokens: input.maxTokens,
          context: {
            task: input.segmentTotal > 1 ? 'chapter.optimize.segment' : 'chapter.optimize.draft',
            chapterNo: input.chapterNo,
            planId: input.planId || null,
            segmentIndex: input.segmentIndex,
            segmentTotal: input.segmentTotal,
            inputSegmentChars: input.inputSegmentChars,
            optimizationMode: input.optimizationMode,
            maxTokens: input.maxTokens,
            retryCount: input.retryCount ?? 0,
            retrievalInstruction: input.instruction,
            retrievalChapterSummary: input.chapterSummaryForRetrieval,
            retrievalChapterTitle: input.chapterTitle,
            ...(input.appearingCharacters?.length
              ? { appearingCharacters: input.appearingCharacters }
              : {}),
          },
        },
        { responseType: 'stream' }
      );
    } catch (error) {
      return {
        ok: false,
        segmentText: '',
        errorMessage: error instanceof Error ? error.message : '优化正文生成失败',
      };
    }

    try {
      const sseResult = await this.readOrchestratorGenerateSseStream(
        response.data as NodeJS.ReadableStream,
        {
          onStreamContent: input.streamToClient
            ? (piece) => input.onContent?.(piece)
            : undefined,
        }
      );

      if (sseResult.errorMessage) {
        return { ok: false, segmentText: '', errorMessage: sseResult.errorMessage };
      }

      const rawOutput = sseResult.accumulated.trim();
      if (!rawOutput) {
        return { ok: false, segmentText: '', errorMessage: '未收到有效响应' };
      }

      const { segmentText } = parseSegmentOutput(rawOutput);
      return { ok: true, segmentText };
    } catch (error) {
      return {
        ok: false,
        segmentText: '',
        errorMessage: error instanceof Error ? error.message : '优化正文生成失败',
      };
    }
  }

  private readOrchestratorGenerateSseStream(
    stream: NodeJS.ReadableStream,
    options?: { onStreamContent?: (piece: string) => void }
  ): Promise<{
    accumulated: string;
    orchestratorTraceId: string;
    sawEnd: boolean;
    errorMessage?: string;
  }> {
    return new Promise((resolve, reject) => {
      let accumulated = '';
      let orchestratorTraceId = '';
      let sawEnd = false;
      let errorMessage: string | undefined;
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
              orchestratorTraceId =
                typeof event.traceId === 'string' ? event.traceId : orchestratorTraceId;
              break;
            }
            case 'content': {
              const raw = typeof event.data === 'string' ? event.data : '';
              const piece = raw.replace(/\\n/g, '\n');
              accumulated += piece;
              options?.onStreamContent?.(piece);
              break;
            }
            case 'end': {
              sawEnd = true;
              orchestratorTraceId =
                typeof event.traceId === 'string' ? event.traceId : orchestratorTraceId;
              break;
            }
            case 'error': {
              errorMessage = typeof event.data === 'string' ? event.data : '生成失败';
              break;
            }
          }
        }
      });

      stream.on('end', () => {
        resolve({
          accumulated,
          orchestratorTraceId,
          sawEnd,
          errorMessage,
        });
      });
      stream.on('error', (error: unknown) => reject(error));
    });
  }

  private getRagOrchestratorUrl() {
    return process.env.RAG_ORCHESTRATOR_URL || 'http://localhost:3001';
  }

  private isContentSafetyEnabled(projectId: string): boolean {
    this.ensureProjectState(projectId);
    this.mergeJsonMirrorSettingsExtensionsForProject(projectId);
    const settings = this.settingsStore.get(projectId)!;
    return settings.contentSafetyScanEnabled !== false;
  }

  private async rewriteSentenceForContentSafety(
    projectId: string,
    sentence: string,
    traceId: string
  ): Promise<string> {
    const settings = this.settingsStore.get(projectId)!;
    const personas = this.personasStore.get(projectId)!;
    const knowledge = this.knowledgeStore.get(projectId)!;
    await this.syncProjectContextToOrchestrator(projectId, settings, personas, knowledge);

    const userPrompt = [
      '请改写以下小说句子，使其符合平台内容规范，保持原意、人物语气与叙事连贯。',
      '只输出改写后的单句，不要解释。',
      '',
      sentence,
    ].join('\n');

    const response = await axios.post(
      `${this.getRagOrchestratorUrl()}/api/generate`,
      {
        projectId,
        prompt: userPrompt,
        useSSE: true,
        context: {
          task: 'content-safety.rewrite',
          traceId,
        },
      },
      { responseType: 'stream' }
    );

    const sseResult = await this.readOrchestratorGenerateSseStream(
      response.data as NodeJS.ReadableStream
    );
    if (sseResult.errorMessage) {
      throw new Error(sseResult.errorMessage);
    }
    const rewritten = sseResult.accumulated.trim();
    if (!rewritten) {
      throw new Error('内容安全句子改写未返回有效文本');
    }
    return rewritten;
  }

  private async runContentSafetyForText(
    projectId: string,
    text: string,
    traceId: string,
    taskKey: string,
    onProgress?: (payload: { stage: ContentSafetyProgressStage; message: string }) => void
  ) {
    return runContentSafetyPipeline({
      text,
      traceId,
      taskKey,
      enabled: this.isContentSafetyEnabled(projectId),
      rules: this.buildContentSafetyRules(projectId),
      rewriteSentence: (sentence) =>
        this.rewriteSentenceForContentSafety(projectId, sentence, traceId),
      onProgress,
    });
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

    const docs = this.documentsService.findAll(projectId);

    const personaConsistencyNotes = this.buildPersonaGraphConsistencyNotes(projectId, personas);
    const identityRelations = this.identityRelationsStore.get(projectId) ?? [];
    const identityRelationMemory = buildIdentityRelationMemoryBlock(identityRelations, personas);

    await axios.post(`${this.getRagOrchestratorUrl()}/api/projects/${projectId}/context`, {
      systemPromptText: this.promptTemplatesService.resolveProjectSystemPromptText(projectId),
      taskPrompts: this.taskPromptsService.getEffectivePublishedTaskPromptsMap(projectId),
      personaProfile: activePersona
        ? `${activePersona.name}\n人物设定：${activePersona.profile}\n当前状态：${activePersona.state}`
        : '未配置人物设定',
      outlineSummary: knowledge.outlineSummary,
      chapterSummaryPromptCount: settings.chapterSummaryPromptCount,
      chapterSummaryMemoryCount: settings.chapterSummaryMemoryCount,
      priorChapterTailChars: settings.priorChapterTailChars,
      contextExcerptMaxChars: settings.contextExcerptMaxChars,
      generationTemperature: settings.generationTemperature,
      contentSafetyScanEnabled: settings.contentSafetyScanEnabled !== false,
      contentSafetyCustomRules: settings.contentSafetyCustomRules,
      chapters: this.buildOrchestratorChapterContexts(knowledge, settings),
      knowledgeDocuments: docs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        docType: doc.docType,
      })),
      selectedRelationMemory: buildRelationMemoryBlock(usedRelationEvents),
      identityRelationMemory,
      usedRelationEvents,
      personaConsistencyNotes,
      personas: personas.map((persona) => ({
        name: persona.name,
        profile: persona.profile,
        state: persona.state,
        status: persona.status,
        chapterStates: persona.chapterStates?.map((record) => ({
          chapterNo: record.chapterNo,
          appeared: record.appeared,
          snapshot: record.snapshot,
          summaryLine: record.summaryLine,
          updatedAt: record.updatedAt,
        })),
      })),
    });
  }

  private normalizeWriteTaskInput(payload: Partial<WriteTaskInput>): WriteChapterTaskInput {
    const chapterNo = Number(payload.chapterNo || 0);
    if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
      throw new BadRequestException('chapterNo 必须为正整数');
    }
    const goal = typeof payload.goal === 'string' ? payload.goal.trim() : '';
    if (!goal) {
      throw new BadRequestException('goal 不能为空');
    }
    const pov = typeof payload.pov === 'string' && payload.pov.trim() ? payload.pov.trim() : '第三人称';
    return {
      chapterNo,
      goal,
      pov,
      mustInclude: Array.isArray(payload.mustInclude)
        ? payload.mustInclude.map((item) => String(item).trim()).filter(Boolean)
        : [],
      avoid: Array.isArray(payload.avoid)
        ? payload.avoid.map((item) => String(item).trim()).filter(Boolean)
        : [],
      ...(Number.isFinite(Number(payload.targetWords)) && Number(payload.targetWords) > 0
        ? { targetWords: Number(payload.targetWords) }
        : {}),
      appearingCharacters: Array.isArray(payload.appearingCharacters)
        ? payload.appearingCharacters.map((item) => String(item).trim()).filter(Boolean)
        : [],
      selectedEventIds: Array.isArray(payload.selectedEventIds)
        ? payload.selectedEventIds.map((item) => String(item).trim()).filter(Boolean)
        : [],
    };
  }

  private async generateDraftThroughOrchestrator(
    projectId: string,
    chapterNo: number,
    payload: Partial<WriteTaskInput>,
    settings: ProjectSettings,
    personas: PersonaRecord[],
    knowledge: KnowledgeRecord,
    usedRelationEvents: UsedRelationEventRecord[] = [],
    confirmedOutlineText?: string
  ) {
    await this.syncProjectContextToOrchestrator(
      projectId,
      settings,
      personas,
      knowledge,
      usedRelationEvents
    );

    const task = this.normalizeWriteTaskInput({ ...payload, chapterNo });
    const outlineText =
      confirmedOutlineText ?? assertConfirmedOutlineForDraft(payload.confirmedOutlineText);

    const usedForPrompt = usedRelationEvents.map(
      (event): WriteChapterUsedRelationEvent => ({
        id: event.id,
        protagonist: event.protagonist,
        counterparty: event.counterparty,
        summary: event.summary,
        evidenceSnippet: event.evidenceSnippet,
        chapterNo: event.chapterNo,
      })
    );

    const prompt = buildWriteDraftUserPrompt({
      task,
      confirmedOutlineText: outlineText,
      selectedRelationEvents: usedForPrompt,
    });

    try {
      const { data } = await axios.post(`${this.getRagOrchestratorUrl()}/api/generate`, {
        projectId,
        prompt,
        useSSE: false,
        systemPromptOverride: WRITE_CHAPTER_DRAFT_SYSTEM_PROMPT,
        templateKey: WRITE_CHAPTER_DRAFT_TEMPLATE_KEY,
        context: {
          task: 'write.chapter.draft',
          chapterNo,
          outlineId: payload.outlineId || null,
          outlineTraceId: payload.outlineTraceId || null,
          confirmedOutlineText: outlineText,
          writeTask: task,
        },
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

  private relinkRelationEventsForProject(projectId: string) {
    const personas = this.personasStore.get(projectId)!;
    const events = this.relationEventsStore.get(projectId)!.filter((event) => !event.deletedAt);
    relinkAllRelationEvents(personas, events);
  }

  private buildPersonaGraphConsistencyNotes(
    projectId: string,
    personas: PersonaRecord[]
  ): Array<{ level: 'warning'; message: string }> {
    const knowledge = this.knowledgeStore.get(projectId);
    if (!knowledge || knowledge.chapters.length === 0) {
      return [];
    }
    const maxChapterNo = Math.max(...knowledge.chapters.map((chapter) => chapter.chapterNo));
    const warnings = detectAbsentPersonaWarnings(personas, maxChapterNo);
    return buildAbsentPersonaConsistencyNotes(warnings);
  }

  private async bootstrapPersonasAfterImport(
    projectId: string,
    importedChapters: ChapterRecord[],
    options?: { autoExtractRelationEvents?: boolean }
  ): Promise<ChapterImportPersonaBootstrap> {
    const knowledge = this.knowledgeStore.get(projectId)!;
    const personas = this.personasStore.get(projectId)!;
    const existingNames = personas.map((persona) => persona.name);
    const candidateNames = new Set<string>();
    let createdRelationEventCount = 0;
    const shouldExtractRelationEvents = options?.autoExtractRelationEvents !== false;

    if (shouldExtractRelationEvents) {
      for (const chapter of importedChapters) {
        if (!chapter.content.trim()) {
          continue;
        }
        try {
          const result = await this.generateChapterRelationEvents(
            projectId,
            chapter.chapterNo,
            undefined
          );
          createdRelationEventCount += result.createdCount;
          for (const event of result.events) {
            candidateNames.add(event.protagonist);
            candidateNames.add(event.counterparty);
            for (const actor of event.actors) {
              candidateNames.add(actor);
            }
          }
        } catch {
          // 导入流程不因单章抽取失败而中断
        }
      }
    }

    const createdPersonas: Array<{ id: string; name: string }> = [];
    const roster = () => personas.map((persona) => ({ id: persona.id, name: persona.name }));
    for (const rawName of candidateNames) {
      const name = rawName.trim();
      if (!name || existingNames.some((item) => item.trim() === name)) {
        continue;
      }
      const chapterHits = countChapterAppearancesForName(knowledge.chapters, name, roster());
      if (chapterHits < IMPORT_AUTO_PERSONA_MIN_CHAPTER_COUNT) {
        continue;
      }

      const now = new Date();
      const persona: PersonaRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        profile: '由导入小说自动创建，请补充详细设定',
        state: '待更新',
        status: 'draft',
        ...createEmptyPersonaGraphFields(),
        createdAt: now,
        updatedAt: now,
      };
      personas.push(persona);
      existingNames.push(name);
      createdPersonas.push({ id: persona.id, name: persona.name });
    }

    rebuildPersonaAppearancesFromChapters(personas, knowledge.chapters);

    const suspectedNameConflicts = findSimilarPersonaNameConflicts(
      [...candidateNames],
      personas.map((persona) => persona.name)
    );

    return {
      createdPersonaCount: createdPersonas.length,
      createdRelationEventCount,
      suspectedNameConflicts,
      createdPersonas,
    };
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
