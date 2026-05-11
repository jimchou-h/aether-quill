import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

type PersonaStatus = 'draft' | 'published';
type IndexMode = 'full' | 'incremental';
type IndexJobStatus = 'processing' | 'completed' | 'failed';

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
  tone: string;
  constraints: string[];
  status: PersonaStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChapterRecord {
  chapterNo: number;
  title: string;
  content: string;
  summary: string;
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

interface WriteTaskInput {
  chapterNo: number;
  goal: string;
  pov: string;
  mustInclude: string[];
  avoid: string[];
  targetWords: number;
}

export interface WorkspaceSnapshot {
  project: ProjectRecord;
  settings: ProjectSettings;
  personas: PersonaRecord[];
  knowledge: KnowledgeRecord;
  latestIndexJob: IndexJobRecord | null;
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
      chapters: Array<Omit<ChapterRecord, 'updatedAt'> & { updatedAt: string }>;
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
}

@Injectable()
export class ProjectsService {
  private readonly storagePath = join(resolve(process.cwd()), 'data', 'project-workspaces.json');

  private readonly projects: ProjectRecord[] = [
    {
      id: '1',
      name: '示例项目',
      description: '这是一个示例小说项目',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  private readonly members: ProjectMember[] = [];
  private readonly settingsStore = new Map<string, ProjectSettings>();
  private readonly personasStore = new Map<string, PersonaRecord[]>();
  private readonly knowledgeStore = new Map<string, KnowledgeRecord>();
  private readonly indexJobsStore = new Map<string, IndexJobRecord[]>();

  constructor() {
    const restored = this.restoreStateFromDisk();
    if (restored) {
      this.projects.splice(0, this.projects.length, ...restored.projects);
      this.members.splice(0, this.members.length, ...restored.members);
      this.hydrateMap(this.settingsStore, restored.settings);
      this.hydrateMap(this.personasStore, restored.personas);
      this.hydrateMap(this.knowledgeStore, restored.knowledge);
      this.hydrateMap(this.indexJobsStore, restored.indexJobs);
    }

    for (const project of this.projects) {
      this.ensureProjectState(project.id);
    }

    if (!restored) {
      this.members.push({
        userId: '1',
        projectId: '1',
        role: 'owner',
        createdAt: new Date(),
      });
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
    if (userId) {
      this.checkAccess(id, userId);
    }
    return this.getProjectOrThrow(id);
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

    return { project, settings, personas, knowledge, latestIndexJob };
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
    payload: { name: string; profile: string; tone?: string; constraints?: string[] },
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
      tone: (payload.tone || '克制、叙事清晰').trim(),
      constraints: payload.constraints?.filter((item) => item.trim().length > 0) ?? [],
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

  upsertChapter(
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

    const nextSummary = this.buildSummary(payload.content);
    const now = new Date();
    const existing = knowledge.chapters.find((item) => item.chapterNo === chapterNo);

    if (existing) {
      existing.title = payload.title.trim();
      existing.content = payload.content;
      existing.summary = nextSummary;
      existing.updatedAt = now;
      this.persistState();
      return existing;
    }

    const chapter: ChapterRecord = {
      chapterNo,
      title: payload.title.trim(),
      content: payload.content,
      summary: nextSummary,
      updatedAt: now,
    };

    knowledge.chapters.push(chapter);
    knowledge.chapters.sort((a, b) => a.chapterNo - b.chapterNo);
    this.persistState();
    return chapter;
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
        chapter.summary = this.buildSummary(chapter.content);
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

  writeChapter(projectId: string, payload: Partial<WriteTaskInput>, userId?: string) {
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

    const mustInclude = payload.mustInclude ?? [];
    const avoid = payload.avoid ?? [];
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

    const draftText = [
      `第${chapterNo}章（草稿）`,
      '',
      `【写作目标】${payload.goal?.trim() || '延续主线并推动人物关系'}`,
      `【叙事视角】${payload.pov?.trim() || '第三人称有限视角'}`,
      `【系统提示】${settings.systemPromptText}`,
      activePersona ? `【人物设定】${activePersona.profile}` : '【人物设定】未配置',
      mustInclude.length > 0 ? `【必须包含】${mustInclude.join('；')}` : '【必须包含】无',
      avoid.length > 0 ? `【避免内容】${avoid.join('；')}` : '【避免内容】无',
      '',
      '海风掠过港口的铁链，角色在旧线索与新怀疑之间做出选择。冲突在对话中升级，章节结尾留下明确悬念，推动下一章进入更高风险阶段。',
    ].join('\n');

    const autoUpdates = this.applyPostWriteUpdates(
      projectId,
      chapterNo,
      payload.goal,
      draftText,
      activePersona?.id
    );

    return {
      draftText,
      reasoningBrief:
        '已按项目维度拼接 systemPrompt + persona + outline + recent chapters 生成草稿。',
      citations,
      consistencyNotes,
      context: {
        projectId,
        chapterNo,
        usedPersonaId: activePersona?.id || null,
        outlineUsed: Boolean(knowledge.outlineSummary),
        recentChapterCount: latestChapters.length,
        targetWords: Number(payload.targetWords || 2500),
      },
      autoUpdates,
    };
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

  private applyPostWriteUpdates(
    projectId: string,
    chapterNo: number,
    goal: string | undefined,
    draftText: string,
    activePersonaId: string | null | undefined
  ) {
    const chapterTitle = goal?.trim()
      ? `第${chapterNo}章：${goal.trim().slice(0, 24)}`
      : `第${chapterNo}章：自动续写草稿`;

    this.upsertChapter(projectId, {
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

    let personaUpdated = false;
    if (activePersonaId) {
      const personas = this.personasStore.get(projectId)!;
      const activePersona = personas.find((persona) => persona.id === activePersonaId);
      if (activePersona && !activePersona.profile.includes(updateLine)) {
        activePersona.profile = `${activePersona.profile}\n${updateLine}`.trim();
        activePersona.updatedAt = new Date();
        personaUpdated = true;
      }
    }

    if (outlineUpdated || personaUpdated) {
      this.persistState();
    }

    return {
      chapterUpdated: true,
      outlineUpdated,
      personaUpdated,
      updateLine,
    };
  }

  private buildSummary(content: string) {
    const compact = content.replace(/\s+/g, ' ').trim();
    if (!compact) {
      return '暂无摘要（章节内容为空）';
    }
    return compact.length > 160 ? `${compact.slice(0, 160)}...` : compact;
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
  }

  private getProjectOrThrow(projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new NotFoundException(`未找到项目: ${projectId}`);
    }
    return project;
  }
}
